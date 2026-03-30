/**
 * Hue bridge HTTP client with retry and connection reuse.
 */

import https from 'node:https';
import {
  HueApiError,
  HueBridgeUnreachableError,
  HueNotConfiguredError,
} from './types.js';
import type {
  HueResponse,
  HueLight,
  HueRoom,
  HueGroupedLight,
  HueScene,
  HueDevice,
  HueBridge,
  HueZone,
  HueMotionSensor,
  HueTemperatureSensor,
  HueLightLevelSensor,
  HueButton,
} from './types.js';

// =============================================================================
// Configuration
// =============================================================================

export interface HueConfig {
  bridgeIp: string;
  apiKey: string;
}

const BRIDGE_IP_RE = /^[a-zA-Z0-9._-]+$/;

export function getConfig(): HueConfig {
  const bridgeIp = process.env.HUE_BRIDGE_IP;
  const apiKey = process.env.HUE_API_KEY;
  if (!bridgeIp || !apiKey) {
    throw new HueNotConfiguredError();
  }
  if (!BRIDGE_IP_RE.test(bridgeIp)) {
    throw new HueNotConfiguredError();
  }
  return { bridgeIp, apiKey };
}

// =============================================================================
// HTTPS Agent (connection reuse)
// =============================================================================

const agent = new https.Agent({
  keepAlive: true,
  maxSockets: 4,
  // Hue bridge uses a self-signed certificate — intentional
  rejectUnauthorized: false,
});

// =============================================================================
// Retry Logic
// =============================================================================

const MAX_RETRIES = 3;
const RETRY_DELAYS = [500, 1000, 2000];

const TRANSIENT_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE']);

export function isTransientError(err: unknown): boolean {
  if (err instanceof HueApiError && err.statusCode === 503) return true;
  if (err instanceof Error && 'code' in err && typeof (err as NodeJS.ErrnoException).code === 'string') {
    return TRANSIENT_CODES.has((err as NodeJS.ErrnoException).code!);
  }
  if (err instanceof HueBridgeUnreachableError) return true;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// Core HTTP Request
// =============================================================================

const REQUEST_TIMEOUT_MS = 5000;
const MAX_RESPONSE_BODY = 1_048_576; // 1MB

function hueRequestOnce<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<HueResponse<T>> {
  const { bridgeIp, apiKey } = getConfig();

  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : undefined;
    const req = https.request(
      {
        hostname: bridgeIp,
        port: 443,
        path: `/clip/v2/resource${path}`,
        method,
        headers: {
          'hue-application-key': apiKey,
          'Content-Type': 'application/json',
        },
        agent,
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => {
          data += chunk.toString();
          if (data.length > MAX_RESPONSE_BODY) {
            req.destroy();
            reject(new HueApiError('Response body too large', res.statusCode));
          }
        });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data) as HueResponse<T>;
            if (parsed.errors?.length > 0) {
              reject(new HueApiError(`Hue API error: ${parsed.errors[0].description}`, res.statusCode));
            } else {
              resolve(parsed);
            }
          } catch {
            reject(new HueApiError(`Hue API returned invalid JSON: ${data.slice(0, 200)}`, res.statusCode));
          }
        });
      },
    );

    req.on('error', (err) => {
      reject(new HueBridgeUnreachableError(bridgeIp, err.message));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new HueBridgeUnreachableError(bridgeIp, `timed out after ${REQUEST_TIMEOUT_MS}ms`));
    });

    if (postData) req.write(postData);
    req.end();
  });
}

export async function hueRequest<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<HueResponse<T>> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await hueRequestOnce<T>(method, path, body);
    } catch (err) {
      lastError = err;
      if (!isTransientError(err) || attempt === MAX_RETRIES - 1) {
        throw err;
      }
      await sleep(RETRY_DELAYS[attempt]);
    }
  }

  throw lastError;
}

// =============================================================================
// API Helpers
// =============================================================================

export async function getLights(): Promise<HueLight[]> {
  const res = await hueRequest<HueLight>('GET', '/light');
  return res.data;
}

export async function getRooms(): Promise<HueRoom[]> {
  const res = await hueRequest<HueRoom>('GET', '/room');
  return res.data;
}

export async function getGroupedLights(): Promise<HueGroupedLight[]> {
  const res = await hueRequest<HueGroupedLight>('GET', '/grouped_light');
  return res.data;
}

export async function getGroupedLight(groupedLightId: string): Promise<HueGroupedLight> {
  const res = await hueRequest<HueGroupedLight>('GET', `/grouped_light/${groupedLightId}`);
  return res.data[0];
}

export async function getScenes(): Promise<HueScene[]> {
  const res = await hueRequest<HueScene>('GET', '/scene');
  return res.data;
}

export async function getLight(lightId: string): Promise<HueLight> {
  const res = await hueRequest<HueLight>('GET', `/light/${lightId}`);
  return res.data[0];
}

export async function controlLight(
  lightId: string,
  body: Record<string, unknown>,
): Promise<void> {
  await hueRequest('PUT', `/light/${lightId}`, body);
}

export async function controlGroupedLight(
  groupedLightId: string,
  body: Record<string, unknown>,
): Promise<void> {
  await hueRequest('PUT', `/grouped_light/${groupedLightId}`, body);
}

export async function activateScene(sceneId: string): Promise<void> {
  await hueRequest('PUT', `/scene/${sceneId}`, { recall: { action: 'active' } });
}

export async function getDevices(): Promise<HueDevice[]> {
  const res = await hueRequest<HueDevice>('GET', '/device');
  return res.data;
}

export async function getDevice(deviceId: string): Promise<HueDevice> {
  const res = await hueRequest<HueDevice>('GET', `/device/${deviceId}`);
  return res.data[0];
}

export async function getBridge(): Promise<HueBridge[]> {
  const res = await hueRequest<HueBridge>('GET', '/bridge');
  return res.data;
}

export async function getZones(): Promise<HueZone[]> {
  const res = await hueRequest<HueZone>('GET', '/zone');
  return res.data;
}

export async function createScene(
  name: string,
  roomId: string,
  actions: Array<{ target: { rid: string; rtype: string }; action: Record<string, unknown> }>,
): Promise<string> {
  const res = await hueRequest<{ id: string }>('POST', '/scene', {
    metadata: { name },
    group: { rid: roomId, rtype: 'room' },
    actions,
  });
  return res.data[0].id;
}

export async function updateScene(
  sceneId: string,
  body: Record<string, unknown>,
): Promise<void> {
  await hueRequest('PUT', `/scene/${sceneId}`, body);
}

export async function deleteScene(sceneId: string): Promise<void> {
  await hueRequest('DELETE', `/scene/${sceneId}`);
}

export async function createZone(
  name: string,
  children: Array<{ rid: string; rtype: string }>,
): Promise<string> {
  const res = await hueRequest<{ id: string }>('POST', '/zone', {
    metadata: { name, archetype: 'other' },
    children,
  });
  return res.data[0].id;
}

export async function updateZone(
  zoneId: string,
  body: Record<string, unknown>,
): Promise<void> {
  await hueRequest('PUT', `/zone/${zoneId}`, body);
}

export async function deleteZone(zoneId: string): Promise<void> {
  await hueRequest('DELETE', `/zone/${zoneId}`);
}

export async function getMotionSensors(): Promise<HueMotionSensor[]> {
  const res = await hueRequest<HueMotionSensor>('GET', '/motion');
  return res.data;
}

export async function getTemperatureSensors(): Promise<HueTemperatureSensor[]> {
  const res = await hueRequest<HueTemperatureSensor>('GET', '/temperature');
  return res.data;
}

export async function getLightLevelSensors(): Promise<HueLightLevelSensor[]> {
  const res = await hueRequest<HueLightLevelSensor>('GET', '/light_level');
  return res.data;
}

export async function getButtons(): Promise<HueButton[]> {
  const res = await hueRequest<HueButton>('GET', '/button');
  return res.data;
}

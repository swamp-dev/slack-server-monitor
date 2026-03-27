/**
 * Hue Plugin - Philips Hue Smart Light Control
 *
 * Control Philips Hue lights from Slack via slash commands and Claude AI tools.
 *
 * Commands:
 * - /hue                        - Dashboard: all lights grouped by room
 * - /hue rooms                  - List rooms with grouped state
 * - /hue scenes                 - List available scenes
 * - /hue on [name]              - Turn on light or room (all if omitted)
 * - /hue off [name]             - Turn off light or room (all if omitted)
 * - /hue dim [name] [0-100]     - Set brightness
 * - /hue scene [name]           - Activate a scene
 * - /hue color [name] [color]   - Set color (red, blue, warm white, etc.)
 * - /hue help                   - Show command help
 *
 * Claude AI Tools (via /ask):
 * - hue:get_lights              - List all lights with state
 * - hue:control_light           - Control a light by name
 * - hue:activate_scene          - Activate a scene by name
 *
 * Configuration (environment variables):
 * - HUE_BRIDGE_IP               - Bridge IP address
 * - HUE_API_KEY                 - API key (from bridge link button)
 *
 * Uses Hue v2 API with direct HTTPS calls.
 * The bridge must be reachable from the container/host network.
 *
 * To use:
 *   cp plugins.example/hue.ts plugins.local/
 *   # Set HUE_BRIDGE_IP and HUE_API_KEY in .env
 *   npm run dev
 */

import https from 'node:https';
import type { Block, KnownBlock } from '@slack/types';
import type { Plugin } from '../src/plugins/index.js';
import type { ToolDefinition, ToolConfig } from '../src/services/tools/types.js';
import {
  header,
  section,
  divider,
  context,
  buildResponse,
  success,
  error as errorBlock,
  statusEmoji,
  helpTip,
  formatTable,
} from '../src/formatters/blocks.js';
import { logger } from '../src/utils/logger.js';

// =============================================================================
// Types
// =============================================================================

interface HueLight {
  id: string;
  metadata: { name: string; archetype: string };
  on: { on: boolean };
  dimming?: { brightness: number };
  color?: { xy: { x: number; y: number } };
  color_temperature?: { mirek: number | null };
  owner: { rid: string; rtype: string };
}

interface HueRoom {
  id: string;
  metadata: { name: string };
  children: Array<{ rid: string; rtype: string }>;
  services: Array<{ rid: string; rtype: string }>;
}

interface HueGroupedLight {
  id: string;
  on: { on: boolean };
  dimming?: { brightness: number };
  owner: { rid: string; rtype: string };
}

interface HueScene {
  id: string;
  metadata: { name: string };
  group: { rid: string; rtype: string };
}

interface HueResponse<T> {
  data: T[];
  errors: Array<{ description: string }>;
}

// =============================================================================
// Constants
// =============================================================================

const COLORS: Record<string, { x: number; y: number }> = {
  red: { x: 0.675, y: 0.322 },
  blue: { x: 0.167, y: 0.04 },
  green: { x: 0.17, y: 0.7 },
  yellow: { x: 0.44, y: 0.517 },
  purple: { x: 0.25, y: 0.1 },
  orange: { x: 0.58, y: 0.39 },
  pink: { x: 0.4, y: 0.2 },
  'warm white': { x: 0.4578, y: 0.4101 },
  'cool white': { x: 0.3174, y: 0.3207 },
  warm: { x: 0.4578, y: 0.4101 },
  cool: { x: 0.3174, y: 0.3207 },
};

// =============================================================================
// Hue HTTP Client
// =============================================================================

function getConfig(): { bridgeIp: string; apiKey: string } {
  const bridgeIp = process.env.HUE_BRIDGE_IP;
  const apiKey = process.env.HUE_API_KEY;
  if (!bridgeIp || !apiKey) {
    throw new Error(
      'Hue not configured. Set HUE_BRIDGE_IP and HUE_API_KEY environment variables.'
    );
  }
  return { bridgeIp, apiKey };
}

function hueRequest<T>(method: string, path: string, body?: unknown): Promise<HueResponse<T>> {
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
        // Hue bridge uses a self-signed certificate — intentional
        rejectUnauthorized: false,
        timeout: 5000,
      } as https.RequestOptions,
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data) as HueResponse<T>;
            if (parsed.errors?.length > 0) {
              reject(new Error(`Hue API error: ${parsed.errors[0].description}`));
            } else {
              resolve(parsed);
            }
          } catch {
            reject(new Error(`Hue API returned invalid JSON: ${data.slice(0, 200)}`));
          }
        });
      }
    );

    req.on('error', (err) => {
      reject(new Error(`Could not reach Hue bridge at ${bridgeIp}: ${err.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Hue bridge at ${bridgeIp} timed out after 5 seconds`));
    });

    if (postData) req.write(postData);
    req.end();
  });
}

// =============================================================================
// API Helpers
// =============================================================================

async function getLights(): Promise<HueLight[]> {
  const res = await hueRequest<HueLight>('GET', '/light');
  return res.data;
}

async function getRooms(): Promise<HueRoom[]> {
  const res = await hueRequest<HueRoom>('GET', '/room');
  return res.data;
}

async function getGroupedLights(): Promise<HueGroupedLight[]> {
  const res = await hueRequest<HueGroupedLight>('GET', '/grouped_light');
  return res.data;
}

async function getScenes(): Promise<HueScene[]> {
  const res = await hueRequest<HueScene>('GET', '/scene');
  return res.data;
}

async function controlLight(
  lightId: string,
  body: Record<string, unknown>
): Promise<void> {
  await hueRequest('PUT', `/light/${lightId}`, body);
}

async function controlGroupedLight(
  groupedLightId: string,
  body: Record<string, unknown>
): Promise<void> {
  await hueRequest('PUT', `/grouped_light/${groupedLightId}`, body);
}

async function activateScene(sceneId: string): Promise<void> {
  await hueRequest('PUT', `/scene/${sceneId}`, { recall: { action: 'active' } });
}

// =============================================================================
// Name Matching
// =============================================================================

function findByName<T extends { metadata: { name: string }; id: string }>(
  items: T[],
  query: string
): T | undefined {
  const q = query.toLowerCase();
  // Exact match first
  const exact = items.find((item) => item.metadata.name.toLowerCase() === q);
  if (exact) return exact;
  // Substring match
  return items.find((item) => item.metadata.name.toLowerCase().includes(q));
}

function listNames<T extends { metadata: { name: string } }>(items: T[]): string {
  return items.map((item) => item.metadata.name).join(', ');
}

/**
 * Find a target to control. Tries lights first, then rooms (via grouped_light).
 */
async function findTarget(
  name: string
): Promise<{ id: string; type: 'light' | 'grouped_light'; displayName: string }> {
  const lights = await getLights();
  const light = findByName(lights, name);
  if (light) {
    return { id: light.id, type: 'light', displayName: light.metadata.name };
  }

  const rooms = await getRooms();
  const room = findByName(rooms, name);
  if (room) {
    const groupedLights = await getGroupedLights();
    const gl = groupedLights.find(
      (g) => g.owner.rid === room.id && g.owner.rtype === 'room'
    );
    if (gl) {
      return { id: gl.id, type: 'grouped_light', displayName: room.metadata.name };
    }
  }

  const allNames = [
    ...lights.map((l) => l.metadata.name),
    ...rooms.map((r) => r.metadata.name),
  ];
  throw new Error(`No light or room matching "${name}". Available: ${allNames.join(', ')}`);
}

async function controlTarget(
  target: { id: string; type: 'light' | 'grouped_light' },
  body: Record<string, unknown>
): Promise<void> {
  if (target.type === 'light') {
    await controlLight(target.id, body);
  } else {
    await controlGroupedLight(target.id, body);
  }
}

// =============================================================================
// Slack Formatters
// =============================================================================

function lightStatusLine(light: HueLight): string {
  const name = light.metadata.name;
  const on = light.on.on;
  const emoji = on ? statusEmoji('ok') : statusEmoji('unknown');
  const brightness = light.dimming ? ` ${Math.round(light.dimming.brightness)}%` : '';
  const state = on ? `on${brightness}` : 'off';
  return `${emoji} *${name}* — ${state}`;
}

async function buildDashboard(): Promise<ReturnType<typeof buildResponse>> {
  const [lights, rooms] = await Promise.all([getLights(), getRooms()]);

  const blocks: (Block | KnownBlock)[] = [header('Hue Lights')];

  // Group lights by room via device->room mapping
  const deviceToRoom = new Map<string, string>();
  for (const room of rooms) {
    for (const child of room.children) {
      deviceToRoom.set(child.rid, room.metadata.name);
    }
  }

  const roomLights = new Map<string, HueLight[]>();
  const ungrouped: HueLight[] = [];

  for (const light of lights) {
    const roomName = deviceToRoom.get(light.owner.rid);
    if (roomName) {
      const arr = roomLights.get(roomName) ?? [];
      arr.push(light);
      roomLights.set(roomName, arr);
    } else {
      ungrouped.push(light);
    }
  }

  const onCount = lights.filter((l) => l.on.on).length;
  const offCount = lights.length - onCount;
  blocks.push(
    section(
      `${statusEmoji('ok')} ${onCount} on  ·  ${statusEmoji('unknown')} ${offCount} off`
    )
  );
  blocks.push(divider());

  for (const [roomName, roomLightList] of roomLights) {
    const lines = roomLightList.map(lightStatusLine).join('\n');
    blocks.push(section(`*${roomName}*\n${lines}`));
  }

  if (ungrouped.length > 0) {
    const lines = ungrouped.map(lightStatusLine).join('\n');
    blocks.push(section(`*Other*\n${lines}`));
  }

  blocks.push(
    helpTip(['`/hue on <name>` · `/hue off <name>` · `/hue scene <name>` · `/hue help`'])
  );

  return buildResponse(blocks);
}

// =============================================================================
// Command Handler
// =============================================================================

function parseArgs(text: string): string[] {
  return text
    .trim()
    .split(/\s+/)
    .filter((s) => s.length > 0);
}

async function handleHueCommand(
  args: string[]
): Promise<ReturnType<typeof buildResponse>> {
  const sub = args[0]?.toLowerCase() ?? '';
  const rest = args.slice(1).join(' ').trim();

  try {
    switch (sub) {
      case '':
        return buildDashboard();

      case 'help':
        return buildResponse([
          header('Hue Commands'),
          section(
            '`/hue` — Light dashboard\n' +
              '`/hue rooms` — List rooms\n' +
              '`/hue scenes` — List scenes\n' +
              '`/hue on [name]` — Turn on light/room\n' +
              '`/hue off [name]` — Turn off light/room\n' +
              '`/hue dim <name> <0-100>` — Set brightness\n' +
              '`/hue scene <name>` — Activate scene\n' +
              '`/hue color <name> <color>` — Set color\n'
          ),
          context(`Colors: ${Object.keys(COLORS).join(', ')}`),
        ]);

      case 'rooms': {
        const [rooms, groupedLights] = await Promise.all([
          getRooms(),
          getGroupedLights(),
        ]);
        const blocks: (Block | KnownBlock)[] = [header('Rooms')];
        for (const room of rooms) {
          const gl = groupedLights.find(
            (g) => g.owner.rid === room.id && g.owner.rtype === 'room'
          );
          const on = gl?.on?.on ?? false;
          const brightness = gl?.dimming
            ? ` ${Math.round(gl.dimming.brightness)}%`
            : '';
          const emoji = on ? statusEmoji('ok') : statusEmoji('unknown');
          const lightCount = room.children.filter(
            (c) => c.rtype === 'device'
          ).length;
          blocks.push(
            section(
              `${emoji} *${room.metadata.name}* — ${on ? `on${brightness}` : 'off'} (${lightCount} lights)`
            )
          );
        }
        return buildResponse(blocks);
      }

      case 'scenes': {
        const [scenes, rooms] = await Promise.all([getScenes(), getRooms()]);
        const roomMap = new Map(rooms.map((r) => [r.id, r.metadata.name]));
        const blocks: (Block | KnownBlock)[] = [header('Scenes')];
        const rows = scenes.map((s) => [
          s.metadata.name,
          roomMap.get(s.group.rid) ?? 'Unknown',
        ]);
        blocks.push(section(formatTable(['Scene', 'Room'], rows)));
        blocks.push(helpTip(['`/hue scene <name>` to activate']));
        return buildResponse(blocks);
      }

      case 'on': {
        if (!rest) {
          // Turn on all rooms (not zones, to avoid duplicate commands)
          const groupedLights = await getGroupedLights();
          const roomLights = groupedLights.filter(
            (gl) => gl.owner.rtype === 'room'
          );
          await Promise.all(
            roomLights.map((gl) =>
              controlGroupedLight(gl.id, { on: { on: true } })
            )
          );
          return buildResponse([success('All lights turned on')]);
        }
        const target = await findTarget(rest);
        await controlTarget(target, { on: { on: true } });
        return buildResponse([success(`*${target.displayName}* turned on`)]);
      }

      case 'off': {
        if (!rest) {
          const groupedLights = await getGroupedLights();
          const roomLights = groupedLights.filter(
            (gl) => gl.owner.rtype === 'room'
          );
          await Promise.all(
            roomLights.map((gl) =>
              controlGroupedLight(gl.id, { on: { on: false } })
            )
          );
          return buildResponse([success('All lights turned off')]);
        }
        const target = await findTarget(rest);
        await controlTarget(target, { on: { on: false } });
        return buildResponse([success(`*${target.displayName}* turned off`)]);
      }

      case 'dim': {
        if (!rest) {
          return buildResponse([errorBlock('Usage: `/hue dim <name> <0-100>`')]);
        }
        const dimArgs = rest.split(/\s+/);
        if (dimArgs.length < 2) {
          return buildResponse([errorBlock('Usage: `/hue dim <name> <0-100>`')]);
        }
        const brightnessStr = dimArgs.pop()!;
        const name = dimArgs.join(' ');
        const brightness = Number(brightnessStr);
        if (isNaN(brightness) || brightness < 0 || brightness > 100) {
          return buildResponse([errorBlock('Usage: `/hue dim <name> <0-100>`')]);
        }
        const target = await findTarget(name);
        await controlTarget(target, {
          on: { on: brightness > 0 },
          dimming: { brightness },
        });
        return buildResponse([
          success(`*${target.displayName}* set to ${brightness}%`),
        ]);
      }

      case 'scene': {
        if (!rest) {
          return buildResponse([errorBlock('Usage: `/hue scene <name>`')]);
        }
        const scenes = await getScenes();
        const scene = findByName(scenes, rest);
        if (!scene) {
          return buildResponse([
            errorBlock(
              `No scene matching "${rest}". Available: ${listNames(scenes)}`
            ),
          ]);
        }
        await activateScene(scene.id);
        return buildResponse([
          success(`Scene *${scene.metadata.name}* activated`),
        ]);
      }

      case 'color': {
        if (!rest) {
          return buildResponse([
            errorBlock(
              `Usage: \`/hue color <name> <color>\`\nColors: ${Object.keys(COLORS).join(', ')}`
            ),
          ]);
        }
        const colorArgs = rest.split(/\s+/);
        let colorName: string | undefined;
        let targetName: string | undefined;

        // Try matching last two words as color (e.g., "warm white")
        if (colorArgs.length >= 3) {
          const twoWord =
            `${colorArgs[colorArgs.length - 2]} ${colorArgs[colorArgs.length - 1]}`.toLowerCase();
          if (COLORS[twoWord]) {
            colorName = twoWord;
            targetName = colorArgs.slice(0, -2).join(' ');
          }
        }
        // Try matching last word as color
        if (!colorName && colorArgs.length >= 2) {
          const oneWord = colorArgs[colorArgs.length - 1].toLowerCase();
          if (COLORS[oneWord]) {
            colorName = oneWord;
            targetName = colorArgs.slice(0, -1).join(' ');
          }
        }

        if (!colorName || !targetName) {
          return buildResponse([
            errorBlock(
              `Usage: \`/hue color <name> <color>\`\nColors: ${Object.keys(COLORS).join(', ')}`
            ),
          ]);
        }

        const xy = COLORS[colorName];
        const target = await findTarget(targetName);
        await controlTarget(target, { on: { on: true }, color: { xy } });
        return buildResponse([
          success(`*${target.displayName}* set to ${colorName}`),
        ]);
      }

      default:
        return buildResponse([
          errorBlock(`Unknown command: \`${sub}\`. Try \`/hue help\`.`),
        ]);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Hue command error', { sub, rest, error: message });
    return buildResponse([errorBlock(message)]);
  }
}

// =============================================================================
// Claude AI Tools
// =============================================================================

const tools: ToolDefinition[] = [
  {
    spec: {
      name: 'get_lights',
      description:
        'List all Philips Hue lights with their current state (on/off, brightness, color, room). Use this to check what lights are available and their status.',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    execute: async (_input: Record<string, unknown>, _config: ToolConfig) => {
      try {
        const [lights, rooms] = await Promise.all([getLights(), getRooms()]);

        const deviceToRoom = new Map<string, string>();
        for (const room of rooms) {
          for (const child of room.children) {
            deviceToRoom.set(child.rid, room.metadata.name);
          }
        }

        const lines = lights.map((l) => {
          const room = deviceToRoom.get(l.owner.rid) ?? 'Unknown';
          const on = l.on.on;
          const brightness = l.dimming
            ? `${Math.round(l.dimming.brightness)}%`
            : 'N/A';
          return `- ${l.metadata.name} (${room}): ${on ? `on, ${brightness}` : 'off'}`;
        });

        return `Lights (${lights.length}):\n${lines.join('\n')}`;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  },
  {
    spec: {
      name: 'control_light',
      description:
        'Control a Hue light or room. Can turn on/off, set brightness, or set color. Use the light or room name (fuzzy matching supported).',
      input_schema: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            description:
              'Light or room name (e.g., "Office Desk", "Living room")',
          },
          action: {
            type: 'string',
            enum: ['on', 'off', 'dim', 'color'],
            description: 'Action to perform',
          },
          brightness: {
            type: 'number',
            description: 'Brightness 0-100 (for dim action)',
          },
          color_name: {
            type: 'string',
            description: `Color name: ${Object.keys(COLORS).join(', ')}`,
          },
        },
        required: ['target', 'action'],
      },
    },
    execute: async (input: Record<string, unknown>, _config: ToolConfig) => {
      try {
        const targetName = input.target as string;
        const action = input.action as string;
        const target = await findTarget(targetName);

        switch (action) {
          case 'on':
            await controlTarget(target, { on: { on: true } });
            return `Turned on ${target.displayName}`;

          case 'off':
            await controlTarget(target, { on: { on: false } });
            return `Turned off ${target.displayName}`;

          case 'dim': {
            const brightness = input.brightness as number;
            if (
              brightness === undefined ||
              brightness < 0 ||
              brightness > 100
            ) {
              return 'Error: brightness must be 0-100';
            }
            await controlTarget(target, {
              on: { on: brightness > 0 },
              dimming: { brightness },
            });
            return `Set ${target.displayName} to ${brightness}%`;
          }

          case 'color': {
            const colorName = (input.color_name as string)?.toLowerCase();
            const xy = COLORS[colorName];
            if (!xy) {
              return `Unknown color "${colorName}". Available: ${Object.keys(COLORS).join(', ')}`;
            }
            await controlTarget(target, { on: { on: true }, color: { xy } });
            return `Set ${target.displayName} to ${colorName}`;
          }

          default:
            return `Unknown action: ${action}. Use on, off, dim, or color.`;
        }
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  },
  {
    spec: {
      name: 'activate_scene',
      description:
        'Activate a Hue scene by name (fuzzy matching supported). Scenes are predefined lighting configurations like "Relax", "Concentrate", "Energize", etc.',
      input_schema: {
        type: 'object',
        properties: {
          scene_name: {
            type: 'string',
            description:
              'Scene name (e.g., "Relax", "Energize", "Nightlight")',
          },
        },
        required: ['scene_name'],
      },
    },
    execute: async (input: Record<string, unknown>, _config: ToolConfig) => {
      try {
        const sceneName = input.scene_name as string;
        const scenes = await getScenes();
        const scene = findByName(scenes, sceneName);
        if (!scene) {
          return `No scene matching "${sceneName}". Available: ${listNames(scenes)}`;
        }
        await activateScene(scene.id);
        return `Activated scene: ${scene.metadata.name}`;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  },
];

// =============================================================================
// Plugin Export
// =============================================================================

const huePlugin: Plugin = {
  name: 'hue',
  version: '1.0.0',
  description: 'Philips Hue smart light control',

  helpEntries: [
    { command: '/hue', description: 'Light dashboard', group: 'Hue Lights' },
    { command: '/hue rooms', description: 'List rooms', group: 'Hue Lights' },
    {
      command: '/hue scenes',
      description: 'List scenes',
      group: 'Hue Lights',
    },
    {
      command: '/hue on [name]',
      description: 'Turn on light/room',
      group: 'Hue Lights',
    },
    {
      command: '/hue off [name]',
      description: 'Turn off light/room',
      group: 'Hue Lights',
    },
    {
      command: '/hue dim <name> <0-100>',
      description: 'Set brightness',
      group: 'Hue Lights',
    },
    {
      command: '/hue scene <name>',
      description: 'Activate scene',
      group: 'Hue Lights',
    },
    {
      command: '/hue color <name> <color>',
      description: 'Set color',
      group: 'Hue Lights',
    },
  ],

  registerCommands(app) {
    app.command('/hue', async ({ command, ack, respond }) => {
      await ack();
      const args = parseArgs(command.text);
      const response = await handleHueCommand(args);
      await respond(response);
    });
  },

  tools,
};

export default huePlugin;

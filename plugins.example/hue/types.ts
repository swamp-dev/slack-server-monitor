/**
 * Hue API v2 types and custom error classes.
 */

// =============================================================================
// API Resource Types
// =============================================================================

export interface HueRef {
  rid: string;
  rtype: string;
}

export interface HueLight {
  id: string;
  metadata: { name: string; archetype: string };
  on: { on: boolean };
  dimming?: { brightness: number };
  color?: { xy: { x: number; y: number } };
  color_temperature?: { mirek: number | null };
  owner: HueRef;
}

export interface HueRoom {
  id: string;
  metadata: { name: string };
  children: HueRef[];
  services: HueRef[];
}

export interface HueGroupedLight {
  id: string;
  on: { on: boolean };
  dimming?: { brightness: number };
  owner: HueRef;
}

export interface HueScene {
  id: string;
  metadata: { name: string };
  group: HueRef;
}

export interface HueDevice {
  id: string;
  metadata: { name: string; archetype: string };
  product_data?: {
    model_id: string;
    manufacturer_name: string;
    product_name: string;
    software_version: string;
  };
  services: HueRef[];
}

export interface HueBridge {
  id: string;
  bridge_id: string;
  time_zone?: { time_zone: string };
}

export interface HueZone {
  id: string;
  metadata: { name: string };
  children: HueRef[];
  services: HueRef[];
}

export interface HueMotionSensor {
  id: string;
  enabled: boolean;
  motion: { motion: boolean; motion_valid: boolean };
  owner: HueRef;
}

export interface HueTemperatureSensor {
  id: string;
  enabled: boolean;
  temperature: { temperature: number; temperature_valid: boolean };
  owner: HueRef;
}

export interface HueLightLevelSensor {
  id: string;
  enabled: boolean;
  light: { light_level: number; light_level_valid: boolean };
  owner: HueRef;
}

export interface HueButton {
  id: string;
  metadata: { control_id: number };
  button: { last_event: string };
  owner: HueRef;
}

export interface HueResponse<T> {
  data: T[];
  errors: Array<{ description: string }>;
}

// =============================================================================
// Target Resolution
// =============================================================================

export interface ResolvedTarget {
  id: string;
  type: 'light' | 'grouped_light';
  displayName: string;
}

// =============================================================================
// Error Classes
// =============================================================================

export class HueApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'HueApiError';
  }
}

export class HueBridgeUnreachableError extends Error {
  constructor(
    public readonly bridgeIp: string,
    public readonly cause_message: string,
  ) {
    super(`Could not reach Hue bridge at ${bridgeIp}: ${cause_message}`);
    this.name = 'HueBridgeUnreachableError';
  }
}

export class HueNotConfiguredError extends Error {
  constructor() {
    super('Hue not configured. Set HUE_BRIDGE_IP and HUE_API_KEY environment variables.');
    this.name = 'HueNotConfiguredError';
  }
}

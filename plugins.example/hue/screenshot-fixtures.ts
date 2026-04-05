/**
 * Mock Hue bridge data for screenshot capture.
 *
 * Pre-populates the response cache so Hue web pages render
 * without a real bridge connection.
 */

import type {
  HueResponse,
  HueLight,
  HueRoom,
  HueGroupedLight,
  HueScene,
  HueMotionSensor,
  HueTemperatureSensor,
  HueLightLevelSensor,
  HueDevice,
} from './types.js';
import { getResponseCache } from './client.js';

// =============================================================================
// Device IDs (consistent cross-references)
// =============================================================================

const DEVICE_LIVING = 'dev-living-01';
const DEVICE_KITCHEN = 'dev-kitchen-01';
const DEVICE_BEDROOM = 'dev-bedroom-01';
const DEVICE_OFFICE = 'dev-office-01';
const DEVICE_SENSOR = 'dev-sensor-01';

const ROOM_LIVING = 'room-living';
const ROOM_KITCHEN = 'room-kitchen';
const ROOM_BEDROOM = 'room-bedroom';
const ROOM_OFFICE = 'room-office';

const GL_LIVING = 'gl-living';
const GL_KITCHEN = 'gl-kitchen';
const GL_BEDROOM = 'gl-bedroom';
const GL_OFFICE = 'gl-office';

// =============================================================================
// Lights
// =============================================================================

const lights: HueLight[] = [
  { id: 'light-1', metadata: { name: 'Ceiling Light', archetype: 'sultan_bulb' }, on: { on: true }, dimming: { brightness: 80 }, color: { xy: { x: 0.4575, y: 0.4099 } }, owner: { rid: DEVICE_LIVING, rtype: 'device' } },
  { id: 'light-2', metadata: { name: 'Floor Lamp', archetype: 'floor_shade' }, on: { on: true }, dimming: { brightness: 45 }, color: { xy: { x: 0.3, y: 0.3 } }, owner: { rid: DEVICE_LIVING, rtype: 'device' } },
  { id: 'light-3', metadata: { name: 'Kitchen Strip', archetype: 'flexible_lamp' }, on: { on: true }, dimming: { brightness: 100 }, color_temperature: { mirek: 250 }, owner: { rid: DEVICE_KITCHEN, rtype: 'device' } },
  { id: 'light-4', metadata: { name: 'Under Cabinet', archetype: 'flexible_lamp' }, on: { on: false }, dimming: { brightness: 60 }, owner: { rid: DEVICE_KITCHEN, rtype: 'device' } },
  { id: 'light-5', metadata: { name: 'Bedside Lamp', archetype: 'table_shade' }, on: { on: false }, dimming: { brightness: 30 }, color: { xy: { x: 0.5, y: 0.38 } }, owner: { rid: DEVICE_BEDROOM, rtype: 'device' } },
  { id: 'light-6', metadata: { name: 'Desk Lamp', archetype: 'desk_lamp' }, on: { on: true }, dimming: { brightness: 90 }, color_temperature: { mirek: 200 }, owner: { rid: DEVICE_OFFICE, rtype: 'device' } },
];

// =============================================================================
// Rooms
// =============================================================================

const rooms: HueRoom[] = [
  { id: ROOM_LIVING, metadata: { name: 'Living Room' }, children: [{ rid: DEVICE_LIVING, rtype: 'device' }], services: [{ rid: GL_LIVING, rtype: 'grouped_light' }] },
  { id: ROOM_KITCHEN, metadata: { name: 'Kitchen' }, children: [{ rid: DEVICE_KITCHEN, rtype: 'device' }], services: [{ rid: GL_KITCHEN, rtype: 'grouped_light' }] },
  { id: ROOM_BEDROOM, metadata: { name: 'Bedroom' }, children: [{ rid: DEVICE_BEDROOM, rtype: 'device' }], services: [{ rid: GL_BEDROOM, rtype: 'grouped_light' }] },
  { id: ROOM_OFFICE, metadata: { name: 'Office' }, children: [{ rid: DEVICE_OFFICE, rtype: 'device' }], services: [{ rid: GL_OFFICE, rtype: 'grouped_light' }] },
];

// =============================================================================
// Grouped Lights
// =============================================================================

const groupedLights: HueGroupedLight[] = [
  { id: GL_LIVING, on: { on: true }, dimming: { brightness: 62 }, owner: { rid: ROOM_LIVING, rtype: 'room' } },
  { id: GL_KITCHEN, on: { on: true }, dimming: { brightness: 80 }, owner: { rid: ROOM_KITCHEN, rtype: 'room' } },
  { id: GL_BEDROOM, on: { on: false }, dimming: { brightness: 30 }, owner: { rid: ROOM_BEDROOM, rtype: 'room' } },
  { id: GL_OFFICE, on: { on: true }, dimming: { brightness: 90 }, owner: { rid: ROOM_OFFICE, rtype: 'room' } },
];

// =============================================================================
// Scenes
// =============================================================================

const scenes: HueScene[] = [
  { id: 'scene-1', metadata: { name: 'Movie Night' }, group: { rid: ROOM_LIVING, rtype: 'room' } },
  { id: 'scene-2', metadata: { name: 'Bright' }, group: { rid: ROOM_LIVING, rtype: 'room' } },
  { id: 'scene-3', metadata: { name: 'Relax' }, group: { rid: ROOM_LIVING, rtype: 'room' } },
  { id: 'scene-4', metadata: { name: 'Cooking' }, group: { rid: ROOM_KITCHEN, rtype: 'room' } },
  { id: 'scene-5', metadata: { name: 'Nightlight' }, group: { rid: ROOM_BEDROOM, rtype: 'room' } },
  { id: 'scene-6', metadata: { name: 'Reading' }, group: { rid: ROOM_BEDROOM, rtype: 'room' } },
  { id: 'scene-7', metadata: { name: 'Focus' }, group: { rid: ROOM_OFFICE, rtype: 'room' } },
  { id: 'scene-8', metadata: { name: 'Meeting' }, group: { rid: ROOM_OFFICE, rtype: 'room' } },
];

// =============================================================================
// Sensors
// =============================================================================

const motionSensors: HueMotionSensor[] = [
  { id: 'motion-1', enabled: true, motion: { motion: false, motion_valid: true }, owner: { rid: DEVICE_SENSOR, rtype: 'device' } },
  { id: 'motion-2', enabled: true, motion: { motion: true, motion_valid: true }, owner: { rid: DEVICE_SENSOR, rtype: 'device' } },
];

const temperatureSensors: HueTemperatureSensor[] = [
  { id: 'temp-1', enabled: true, temperature: { temperature: 22.4, temperature_valid: true }, owner: { rid: DEVICE_SENSOR, rtype: 'device' } },
  { id: 'temp-2', enabled: true, temperature: { temperature: 19.1, temperature_valid: true }, owner: { rid: DEVICE_SENSOR, rtype: 'device' } },
];

const lightLevelSensors: HueLightLevelSensor[] = [
  { id: 'lux-1', enabled: true, light: { light_level: 15000, light_level_valid: true }, owner: { rid: DEVICE_SENSOR, rtype: 'device' } },
];

// =============================================================================
// Devices (for sensor name lookups)
// =============================================================================

const devices: HueDevice[] = [
  { id: DEVICE_LIVING, metadata: { name: 'Living Room Bulbs', archetype: 'sultan_bulb' }, services: [{ rid: 'light-1', rtype: 'light' }, { rid: 'light-2', rtype: 'light' }] },
  { id: DEVICE_KITCHEN, metadata: { name: 'Kitchen Lights', archetype: 'flexible_lamp' }, services: [{ rid: 'light-3', rtype: 'light' }, { rid: 'light-4', rtype: 'light' }] },
  { id: DEVICE_BEDROOM, metadata: { name: 'Bedroom Lamp', archetype: 'table_shade' }, services: [{ rid: 'light-5', rtype: 'light' }] },
  { id: DEVICE_OFFICE, metadata: { name: 'Office Lamp', archetype: 'desk_lamp' }, services: [{ rid: 'light-6', rtype: 'light' }] },
  { id: DEVICE_SENSOR, metadata: { name: 'Hallway Sensor', archetype: 'unknown_archetype' }, product_data: { model_id: 'SML001', manufacturer_name: 'Signify', product_name: 'Hue Motion Sensor', software_version: '1.1.27' }, services: [{ rid: 'motion-1', rtype: 'motion' }, { rid: 'temp-1', rtype: 'temperature' }, { rid: 'lux-1', rtype: 'light_level' }] },
];

// =============================================================================
// Cache population
// =============================================================================

function wrap<T>(data: T[]): HueResponse<T> {
  return { data, errors: [] };
}

/** Populate the Hue response cache with fixture data. */
export function populateScreenshotCache(): void {
  const cache = getResponseCache();

  cache.set('/light', wrap(lights), 600_000);
  cache.set('/room', wrap(rooms), 600_000);
  cache.set('/grouped_light', wrap(groupedLights), 600_000);
  cache.set('/scene', wrap(scenes), 600_000);
  cache.set('/motion', wrap(motionSensors), 600_000);
  cache.set('/temperature', wrap(temperatureSensors), 600_000);
  cache.set('/light_level', wrap(lightLevelSensors), 600_000);
  cache.set('/device', wrap(devices), 600_000);
}

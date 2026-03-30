/**
 * Claude AI tool definitions for querying Hue system state.
 * Read-only tools for lights, devices, bridge, and sensors.
 */

import type { ToolDefinition, ToolConfig } from '../../src/services/tools/types.js';
import {
  getLights,
  getRooms,
  getLight,
  getDevices,
  getDevice,
  getBridge,
  getZones,
  getMotionSensors,
  getTemperatureSensors,
  getLightLevelSensors,
  getButtons,
} from './client.js';
import { findByName, listNames } from './matching.js';
import { validate, GetLightStateSchema, GetDeviceSchema } from './validation.js';

export const queryTools: ToolDefinition[] = [
  {
    spec: {
      name: 'get_light_state',
      description:
        'Get the full state of a specific light including on/off, brightness, color coordinates, color temperature, and capabilities.',
      input_schema: {
        type: 'object',
        properties: {
          light_name: { type: 'string', description: 'Light name (fuzzy match)' },
        },
        required: ['light_name'],
      },
    },
    execute: async (input: Record<string, unknown>, _config: ToolConfig) => {
      const parsed = validate(GetLightStateSchema, input);
      if (!parsed.success) return `Validation error: ${parsed.error}`;

      try {
        const lights = await getLights();
        const light = findByName(lights, parsed.data.light_name);
        if (!light) return `No light matching "${parsed.data.light_name}". Available: ${listNames(lights)}`;

        const state = await getLight(light.id);
        const lines = [
          `Light: ${state.metadata.name}`,
          `ID: ${state.id}`,
          `On: ${state.on.on}`,
        ];
        if (state.dimming) lines.push(`Brightness: ${Math.round(state.dimming.brightness)}%`);
        if (state.color) lines.push(`Color XY: (${state.color.xy.x}, ${state.color.xy.y})`);
        if (state.color_temperature?.mirek != null) {
          lines.push(`Color Temperature: ${state.color_temperature.mirek} mirek`);
        }
        lines.push(`Archetype: ${state.metadata.archetype}`);

        return lines.join('\n');
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  },
  {
    spec: {
      name: 'bridge_info',
      description: 'Get Hue bridge system information including bridge ID and time zone.',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    execute: async (_input: Record<string, unknown>, _config: ToolConfig) => {
      try {
        const bridges = await getBridge();
        if (bridges.length === 0) return 'No bridge information available.';

        const b = bridges[0];
        const lines = [
          `Bridge ID: ${b.bridge_id}`,
          `Resource ID: ${b.id}`,
        ];
        if (b.time_zone) lines.push(`Time Zone: ${b.time_zone.time_zone}`);

        // Also get counts
        const [lights, rooms, zones, devices] = await Promise.all([
          getLights(),
          getRooms(),
          getZones(),
          getDevices(),
        ]);
        lines.push(`Lights: ${lights.length}`);
        lines.push(`Rooms: ${rooms.length}`);
        lines.push(`Zones: ${zones.length}`);
        lines.push(`Devices: ${devices.length}`);

        return lines.join('\n');
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  },
  {
    spec: {
      name: 'list_devices',
      description: 'List all Hue devices with their product information and services.',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    execute: async (_input: Record<string, unknown>, _config: ToolConfig) => {
      try {
        const devices = await getDevices();
        if (devices.length === 0) return 'No devices found.';

        const lines = devices.map((d) => {
          const product = d.product_data
            ? `${d.product_data.manufacturer_name} ${d.product_data.product_name} (${d.product_data.model_id})`
            : 'Unknown product';
          const version = d.product_data?.software_version ?? 'N/A';
          return `- ${d.metadata.name}: ${product}, SW: ${version}`;
        });

        return `Devices (${devices.length}):\n${lines.join('\n')}`;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  },
  {
    spec: {
      name: 'get_device',
      description: 'Get detailed information about a specific device by name.',
      input_schema: {
        type: 'object',
        properties: {
          device_name: { type: 'string', description: 'Device name (fuzzy match)' },
        },
        required: ['device_name'],
      },
    },
    execute: async (input: Record<string, unknown>, _config: ToolConfig) => {
      const parsed = validate(GetDeviceSchema, input);
      if (!parsed.success) return `Validation error: ${parsed.error}`;

      try {
        const devices = await getDevices();
        const device = findByName(devices, parsed.data.device_name);
        if (!device) return `No device matching "${parsed.data.device_name}". Available: ${listNames(devices)}`;

        const detail = await getDevice(device.id);
        const lines = [
          `Device: ${detail.metadata.name}`,
          `ID: ${detail.id}`,
          `Archetype: ${detail.metadata.archetype}`,
        ];

        if (detail.product_data) {
          lines.push(`Manufacturer: ${detail.product_data.manufacturer_name}`);
          lines.push(`Product: ${detail.product_data.product_name}`);
          lines.push(`Model: ${detail.product_data.model_id}`);
          lines.push(`Software: ${detail.product_data.software_version}`);
        }

        if (detail.services.length > 0) {
          lines.push(`Services: ${detail.services.map((s) => s.rtype).join(', ')}`);
        }

        return lines.join('\n');
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  },
  // =========================================================================
  // Sensors
  // =========================================================================
  {
    spec: {
      name: 'list_motion_sensors',
      description: 'List all Hue motion sensors with their current state (motion detected or not).',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    execute: async (_input: Record<string, unknown>, _config: ToolConfig) => {
      try {
        const sensors = await getMotionSensors();
        if (sensors.length === 0) return 'No motion sensors found.';

        const lines = sensors.map((s) => {
          const state = s.motion.motion ? 'MOTION DETECTED' : 'no motion';
          const enabled = s.enabled ? '' : ' (disabled)';
          return `- ${s.id}: ${state}${enabled}`;
        });

        return `Motion sensors (${sensors.length}):\n${lines.join('\n')}`;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  },
  {
    spec: {
      name: 'list_temperature_sensors',
      description: 'List all Hue temperature sensors with current readings in Celsius and Fahrenheit.',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    execute: async (_input: Record<string, unknown>, _config: ToolConfig) => {
      try {
        const sensors = await getTemperatureSensors();
        if (sensors.length === 0) return 'No temperature sensors found.';

        const lines = sensors.map((s) => {
          const celsius = s.temperature.temperature;
          const fahrenheit = Math.round(celsius * 9 / 5 + 32);
          const enabled = s.enabled ? '' : ' (disabled)';
          return `- ${s.id}: ${celsius}°C / ${fahrenheit}°F${enabled}`;
        });

        return `Temperature sensors (${sensors.length}):\n${lines.join('\n')}`;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  },
  {
    spec: {
      name: 'list_light_level_sensors',
      description: 'List all Hue ambient light level sensors with readings in lux.',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    execute: async (_input: Record<string, unknown>, _config: ToolConfig) => {
      try {
        const sensors = await getLightLevelSensors();
        if (sensors.length === 0) return 'No light level sensors found.';

        const lines = sensors.map((s) => {
          // Hue light_level is in 10000 * log10(lux) + 1
          const lux = Math.round(Math.pow(10, (s.light.light_level - 1) / 10000));
          const enabled = s.enabled ? '' : ' (disabled)';
          return `- ${s.id}: ${lux} lux (raw: ${s.light.light_level})${enabled}`;
        });

        return `Light level sensors (${sensors.length}):\n${lines.join('\n')}`;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  },
  {
    spec: {
      name: 'list_buttons',
      description: 'List all Hue buttons and dimmer switches with their last event.',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    execute: async (_input: Record<string, unknown>, _config: ToolConfig) => {
      try {
        const buttons = await getButtons();
        if (buttons.length === 0) return 'No buttons found.';

        const lines = buttons.map((b) => {
          return `- ${b.id} (control ${b.metadata.control_id}): last event: ${b.button.last_event}`;
        });

        return `Buttons (${buttons.length}):\n${lines.join('\n')}`;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  },
];

/**
 * Hue Plugin - Philips Hue Smart Light Control
 *
 * Control Philips Hue lights from Slack via slash commands and Claude AI tools.
 * See planning/hue-plugin-extension.md for full documentation.
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
 * Configuration (environment variables):
 * - HUE_BRIDGE_IP               - Bridge IP address
 * - HUE_API_KEY                 - API key (from bridge link button)
 *
 * Uses Hue v2 API with direct HTTPS calls.
 *
 * To use:
 *   cp plugins.example/hue.ts plugins.local/
 *   cp -r plugins.example/hue/ plugins.local/hue/
 *   # Set HUE_BRIDGE_IP and HUE_API_KEY in .env
 *   npm run dev
 */

import type { Plugin } from '../src/plugins/index.js';
import type { ToolDefinition, ToolConfig } from '../src/services/tools/types.js';
import { parseArgs, handleHueCommand } from './hue/commands.js';
import { getLights, getRooms, getScenes, activateScene } from './hue/client.js';
import { findByName, listNames, findTarget, controlTarget } from './hue/matching.js';
import { COLORS, resolveColor } from './hue/colors.js';
import { validate, ControlLightSchema, ActivateSceneSchema } from './hue/validation.js';
import { effectTools } from './hue/tools-effects.js';
import { controlTools } from './hue/tools-control.js';
import { sceneTools } from './hue/tools-scenes.js';
import { queryTools } from './hue/tools-query.js';
import { stopAll } from './hue/effects-registry.js';
import { initSceneCache } from './hue/scene-cache.js';
import { registerHueWebRoutes, getHueWidgets, startSSEPolling, stopSSEPolling } from './hue/web.js';
import { populateScreenshotCache } from './hue/screenshot-fixtures.js';

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
        'Control a Hue light or room. Can turn on/off, set brightness, or set color. Use the light or room name (fuzzy matching supported). Colors: named (red, blue, warm white, etc.) or hex (#FF0000).',
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
            description: `Color name or hex (#RRGGBB): ${Object.keys(COLORS).join(', ')}`,
          },
        },
        required: ['target', 'action'],
      },
    },
    execute: async (input: Record<string, unknown>, _config: ToolConfig) => {
      const parsed = validate(ControlLightSchema, input);
      if (!parsed.success) return `Validation error: ${parsed.error}`;

      try {
        const { target: targetName, action, brightness, color_name } = parsed.data;
        const target = await findTarget(targetName);

        switch (action) {
          case 'on':
            await controlTarget(target, { on: { on: true } });
            return `Turned on ${target.displayName}`;

          case 'off':
            await controlTarget(target, { on: { on: false } });
            return `Turned off ${target.displayName}`;

          case 'dim': {
            if (brightness === undefined || brightness < 0 || brightness > 100) {
              return 'Error: brightness must be 0-100';
            }
            await controlTarget(target, {
              on: { on: brightness > 0 },
              dimming: { brightness },
            });
            return `Set ${target.displayName} to ${brightness}%`;
          }

          case 'color': {
            const colorName = color_name?.toLowerCase();
            if (!colorName) return 'Error: color_name is required for color action';
            const xy = resolveColor(colorName);
            if (!xy) {
              return `Unknown color "${colorName}". Use named colors (${Object.keys(COLORS).join(', ')}) or hex (#RRGGBB).`;
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
      const parsed = validate(ActivateSceneSchema, input);
      if (!parsed.success) return `Validation error: ${parsed.error}`;

      try {
        const { scene_name: sceneName } = parsed.data;
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
  version: '2.0.0',
  description: 'Philips Hue smart light control',

  helpEntries: [
    { command: '/hue', description: 'Light dashboard', group: 'Hue Lights' },
    { command: '/hue rooms', description: 'List rooms', group: 'Hue Lights' },
    { command: '/hue scenes', description: 'List scenes', group: 'Hue Lights' },
    { command: '/hue on [name]', description: 'Turn on light/room', group: 'Hue Lights' },
    { command: '/hue off [name]', description: 'Turn off light/room', group: 'Hue Lights' },
    { command: '/hue dim <name> <0-100>', description: 'Set brightness', group: 'Hue Lights' },
    { command: '/hue scene <name>', description: 'Activate scene', group: 'Hue Lights' },
    { command: '/hue color <name> <color>', description: 'Set color', group: 'Hue Lights' },
  ],

  registerCommands(app) {
    app.command('/hue', async ({ command, ack, respond }) => {
      await ack();
      const args = parseArgs(command.text);
      const response = await handleHueCommand(args);
      await respond(response);
    });
  },

  webNavEntry: { label: 'Hue', icon: 'lightbulb' },

  registerWebRoutes: registerHueWebRoutes,

  getWidgets: getHueWidgets,

  tools: [...tools, ...effectTools, ...controlTools, ...sceneTools, ...queryTools],

  init: async (ctx) => {
    initSceneCache(ctx.db);
    startSSEPolling(ctx);
  },

  destroy: async () => {
    stopSSEPolling();
    stopAll();
  },

  screenshotPages: [
    { name: 'dashboard', path: '/' },
    { name: 'scenes', path: '/scenes' },
    { name: 'sensors', path: '/sensors' },
  ],

  screenshotSetup: async () => {
    populateScreenshotCache();
  },
};

export default huePlugin;

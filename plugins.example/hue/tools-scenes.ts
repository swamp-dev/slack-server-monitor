/**
 * Claude AI tool definitions for scene CRUD and custom scene cache.
 */

import type { ToolDefinition, ToolConfig } from '../../src/services/tools/types.js';
import {
  validate,
  CreateSceneSchema,
  UpdateSceneSchema,
  DeleteSceneSchema,
  RecallCustomSceneSchema,
  ClearCustomSceneSchema,
} from './validation.js';
import {
  getLights,
  getRooms,
  getScenes,
  createScene as bridgeCreateScene,
  updateScene as bridgeUpdateScene,
  deleteScene as bridgeDeleteScene,
} from './client.js';
import { findByName, listNames } from './matching.js';
import {
  recallScene,
  readScene,
  listScenes as listCachedScenes,
  deleteScene as deleteCachedScene,
  exportScene,
} from './scene-cache.js';
import { runSequence } from './sequences.js';

export const sceneTools: ToolDefinition[] = [
  // =========================================================================
  // Bridge Scene CRUD
  // =========================================================================
  {
    spec: {
      name: 'create_scene',
      description:
        'Create a new Hue scene on the bridge from the current state of lights in a room. The scene captures the current on/off, brightness, and color of all lights.',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name for the new scene' },
          room_name: { type: 'string', description: 'Room to capture the scene from' },
        },
        required: ['name', 'room_name'],
      },
    },
    execute: async (input: Record<string, unknown>, _config: ToolConfig) => {
      const parsed = validate(CreateSceneSchema, input);
      if (!parsed.success) return `Validation error: ${parsed.error}`;

      try {
        const rooms = await getRooms();
        const room = findByName(rooms, parsed.data.room_name);
        if (!room) return `No room matching "${parsed.data.room_name}". Available: ${listNames(rooms)}`;

        // Get current light states for the room
        const lights = await getLights();
        const roomDeviceIds = new Set(room.children.map((c) => c.rid));
        const roomLights = lights.filter((l) => roomDeviceIds.has(l.owner.rid));

        if (roomLights.length === 0) return `No lights found in room "${room.metadata.name}"`;

        const actions = roomLights.map((light) => ({
          target: { rid: light.id, rtype: 'light' as const },
          action: {
            on: { on: light.on.on },
            ...(light.dimming ? { dimming: { brightness: light.dimming.brightness } } : {}),
            ...(light.color ? { color: { xy: light.color.xy } } : {}),
          },
        }));

        const sceneId = await bridgeCreateScene(parsed.data.name, room.id, actions);
        return `Created scene "${parsed.data.name}" in ${room.metadata.name} (${roomLights.length} lights). Scene ID: ${sceneId}`;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  },
  {
    spec: {
      name: 'update_scene',
      description: 'Update a Hue scene name on the bridge.',
      input_schema: {
        type: 'object',
        properties: {
          scene_name: { type: 'string', description: 'Current scene name (fuzzy match)' },
          new_name: { type: 'string', description: 'New name for the scene' },
        },
        required: ['scene_name'],
      },
    },
    execute: async (input: Record<string, unknown>, _config: ToolConfig) => {
      const parsed = validate(UpdateSceneSchema, input);
      if (!parsed.success) return `Validation error: ${parsed.error}`;

      try {
        const scenes = await getScenes();
        const scene = findByName(scenes, parsed.data.scene_name);
        if (!scene) return `No scene matching "${parsed.data.scene_name}". Available: ${listNames(scenes)}`;

        const body: Record<string, unknown> = {};
        if (parsed.data.new_name) body.metadata = { name: parsed.data.new_name };

        if (Object.keys(body).length === 0) return 'Nothing to update. Provide new_name.';

        await bridgeUpdateScene(scene.id, body);
        return `Updated scene "${scene.metadata.name}"${parsed.data.new_name ? ` → "${parsed.data.new_name}"` : ''}`;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  },
  {
    spec: {
      name: 'delete_scene',
      description: 'Delete a Hue scene from the bridge.',
      input_schema: {
        type: 'object',
        properties: {
          scene_name: { type: 'string', description: 'Scene name to delete (fuzzy match)' },
        },
        required: ['scene_name'],
      },
    },
    execute: async (input: Record<string, unknown>, _config: ToolConfig) => {
      const parsed = validate(DeleteSceneSchema, input);
      if (!parsed.success) return `Validation error: ${parsed.error}`;

      try {
        const scenes = await getScenes();
        const scene = findByName(scenes, parsed.data.scene_name);
        if (!scene) return `No scene matching "${parsed.data.scene_name}". Available: ${listNames(scenes)}`;

        await bridgeDeleteScene(scene.id);
        return `Deleted scene "${scene.metadata.name}"`;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  },

  // =========================================================================
  // Custom Scene Cache
  // =========================================================================
  {
    spec: {
      name: 'list_custom_scenes',
      description:
        'List all saved custom scenes (local, not Hue bridge scenes). Custom scenes are batch command sequences saved for instant recall.',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    execute: async (_input: Record<string, unknown>, _config: ToolConfig) => {
      try {
        const scenes = listCachedScenes();
        if (scenes.length === 0) return 'No custom scenes saved. Use batch_commands with cache_name to save one.';

        const lines = scenes.map((s) => {
          const used = s.lastUsedAt
            ? `last used ${new Date(s.lastUsedAt).toISOString()}`
            : 'never used';
          return `- ${s.name}: ${s.description || '(no description)'} (${s.commands.length} commands, used ${s.useCount}x, ${used})`;
        });
        return `Custom scenes (${scenes.length}):\n${lines.join('\n')}`;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  },
  {
    spec: {
      name: 'recall_custom_scene',
      description:
        'Recall and execute a saved custom scene by name. Runs the saved batch commands.',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Custom scene name' },
        },
        required: ['name'],
      },
    },
    execute: async (input: Record<string, unknown>, _config: ToolConfig) => {
      const parsed = validate(RecallCustomSceneSchema, input);
      if (!parsed.success) return `Validation error: ${parsed.error}`;

      try {
        const scene = recallScene(parsed.data.name);
        if (!scene) return `No custom scene named "${parsed.data.name}". Use list_custom_scenes to see available scenes.`;

        const id = runSequence(scene.commands, { name: scene.name });
        return `Recalled custom scene "${scene.name}" (${scene.commands.length} commands). Sequence ID: ${id}`;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  },
  {
    spec: {
      name: 'clear_custom_scene',
      description: 'Delete a saved custom scene.',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Custom scene name to delete' },
        },
        required: ['name'],
      },
    },
    execute: async (input: Record<string, unknown>, _config: ToolConfig) => {
      const parsed = validate(ClearCustomSceneSchema, input);
      if (!parsed.success) return `Validation error: ${parsed.error}`;

      const deleted = deleteCachedScene(parsed.data.name);
      return deleted
        ? `Deleted custom scene "${parsed.data.name}"`
        : `No custom scene named "${parsed.data.name}"`;
    },
  },
  {
    spec: {
      name: 'export_custom_scene',
      description: 'Export a custom scene as JSON for sharing or backup.',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Custom scene name' },
        },
        required: ['name'],
      },
    },
    execute: async (input: Record<string, unknown>, _config: ToolConfig) => {
      const parsed = validate(RecallCustomSceneSchema, input);
      if (!parsed.success) return `Validation error: ${parsed.error}`;

      const json = exportScene(parsed.data.name);
      return json ?? `No custom scene named "${parsed.data.name}"`;
    },
  },
];

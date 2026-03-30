import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';

vi.mock('../../../plugins.example/hue/client.js', () => ({
  getLights: vi.fn().mockResolvedValue([
    { id: 'light-1', metadata: { name: 'Desk', archetype: 'table_shade' }, on: { on: true }, dimming: { brightness: 80 }, color: { xy: { x: 0.3, y: 0.3 } }, owner: { rid: 'device-1', rtype: 'device' } },
  ]),
  getRooms: vi.fn().mockResolvedValue([
    { id: 'room-1', metadata: { name: 'Office' }, children: [{ rid: 'device-1', rtype: 'device' }], services: [] },
  ]),
  getGroupedLights: vi.fn().mockResolvedValue([
    { id: 'gl-1', on: { on: true }, dimming: { brightness: 80 }, owner: { rid: 'room-1', rtype: 'room' } },
  ]),
  getScenes: vi.fn().mockResolvedValue([
    { id: 'scene-1', metadata: { name: 'Relax' }, group: { rid: 'room-1', rtype: 'room' } },
  ]),
  createScene: vi.fn().mockResolvedValue('new-scene-id'),
  updateScene: vi.fn().mockResolvedValue(undefined),
  deleteScene: vi.fn().mockResolvedValue(undefined),
  activateScene: vi.fn().mockResolvedValue(undefined),
  controlLight: vi.fn().mockResolvedValue(undefined),
  controlGroupedLight: vi.fn().mockResolvedValue(undefined),
  getLight: vi.fn().mockResolvedValue({
    id: 'light-1', on: { on: true }, dimming: { brightness: 50 },
    metadata: { name: 'Desk', archetype: 'table_shade' },
    owner: { rid: 'device-1', rtype: 'device' },
  }),
  getGroupedLight: vi.fn().mockResolvedValue({ id: 'gl-1', on: { on: true }, dimming: { brightness: 50 }, owner: { rid: 'room-1', rtype: 'room' } }),
}));

import { createScene, updateScene, deleteScene } from '../../../plugins.example/hue/client.js';
import { sceneTools } from '../../../plugins.example/hue/tools-scenes.js';
import { initSceneCache, saveScene } from '../../../plugins.example/hue/scene-cache.js';
import { _reset } from '../../../plugins.example/hue/effects-registry.js';

const mockCreateScene = vi.mocked(createScene);
const mockUpdateScene = vi.mocked(updateScene);
const mockDeleteScene = vi.mocked(deleteScene);

const dummyConfig = { allowedDirs: [], maxFileSizeKb: 100, maxLogLines: 50 };

function findTool(name: string) {
  const tool = sceneTools.find((t) => t.spec.name === name);
  if (!tool) throw new Error(`Tool ${name} not found`);
  return tool;
}

function createTestDb() {
  const raw = new Database(':memory:');
  return {
    exec: (sql: string) => raw.exec(sql),
    prepare: (sql: string) => {
      const stmt = raw.prepare(sql);
      return {
        run: (...params: unknown[]) => stmt.run(...params) as { changes: number },
        get: (...params: unknown[]) => stmt.get(...params) as Record<string, unknown> | undefined,
        all: (...params: unknown[]) => stmt.all(...params) as Record<string, unknown>[],
      };
    },
    prefix: 'plugin_hue_',
  };
}

describe('hue tools-scenes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _reset();
    initSceneCache(createTestDb());
  });

  describe('create_scene', () => {
    it('should create a scene from room lights', async () => {
      const tool = findTool('create_scene');
      const result = await tool.execute({ name: 'Cozy', room_name: 'Office' }, dummyConfig);
      expect(result).toContain('Created scene "Cozy"');
      expect(result).toContain('Office');
      expect(mockCreateScene).toHaveBeenCalledWith(
        'Cozy',
        'room-1',
        expect.arrayContaining([
          expect.objectContaining({ target: { rid: 'light-1', rtype: 'light' } }),
        ]),
      );
    });

    it('should error for unknown room', async () => {
      const tool = findTool('create_scene');
      const result = await tool.execute({ name: 'Cozy', room_name: 'Kitchen' }, dummyConfig);
      expect(result).toContain('No room matching');
    });

    it('should error for empty name', async () => {
      const tool = findTool('create_scene');
      const result = await tool.execute({ name: '', room_name: 'Office' }, dummyConfig);
      expect(result).toContain('Validation error');
    });
  });

  describe('update_scene', () => {
    it('should rename a scene', async () => {
      const tool = findTool('update_scene');
      const result = await tool.execute({ scene_name: 'Relax', new_name: 'Chill' }, dummyConfig);
      expect(result).toContain('Updated scene');
      expect(result).toContain('Chill');
      expect(mockUpdateScene).toHaveBeenCalledWith('scene-1', { metadata: { name: 'Chill' } });
    });

    it('should error for unknown scene', async () => {
      const tool = findTool('update_scene');
      const result = await tool.execute({ scene_name: 'NonExistent', new_name: 'X' }, dummyConfig);
      expect(result).toContain('No scene matching');
    });
  });

  describe('delete_scene', () => {
    it('should delete a scene', async () => {
      const tool = findTool('delete_scene');
      const result = await tool.execute({ scene_name: 'Relax' }, dummyConfig);
      expect(result).toContain('Deleted scene "Relax"');
      expect(mockDeleteScene).toHaveBeenCalledWith('scene-1');
    });

    it('should error for unknown scene', async () => {
      const tool = findTool('delete_scene');
      const result = await tool.execute({ scene_name: 'NonExistent' }, dummyConfig);
      expect(result).toContain('No scene matching');
    });
  });

  describe('list_custom_scenes', () => {
    it('should return empty message when no scenes', async () => {
      const tool = findTool('list_custom_scenes');
      const result = await tool.execute({}, dummyConfig);
      expect(result).toContain('No custom scenes');
    });

    it('should list saved scenes', async () => {
      saveScene('party', [{ action: 'on', target: 'All' }], 'Party mode');
      const tool = findTool('list_custom_scenes');
      const result = await tool.execute({}, dummyConfig);
      expect(result).toContain('party');
      expect(result).toContain('Party mode');
    });
  });

  describe('recall_custom_scene', () => {
    it('should recall and execute a custom scene', async () => {
      vi.useFakeTimers();
      saveScene('party', [{ action: 'on', target: 'Desk' }], 'Party mode');
      const tool = findTool('recall_custom_scene');
      const result = await tool.execute({ name: 'party' }, dummyConfig);
      expect(result).toContain('Recalled custom scene "party"');
      expect(result).toContain('Sequence ID');
      vi.useRealTimers();
      _reset();
    });

    it('should error for unknown scene', async () => {
      const tool = findTool('recall_custom_scene');
      const result = await tool.execute({ name: 'nonexistent' }, dummyConfig);
      expect(result).toContain('No custom scene');
    });
  });

  describe('clear_custom_scene', () => {
    it('should delete a custom scene', async () => {
      saveScene('party', [{ action: 'on', target: 'All' }]);
      const tool = findTool('clear_custom_scene');
      const result = await tool.execute({ name: 'party' }, dummyConfig);
      expect(result).toContain('Deleted custom scene');
    });

    it('should error for unknown scene', async () => {
      const tool = findTool('clear_custom_scene');
      const result = await tool.execute({ name: 'nonexistent' }, dummyConfig);
      expect(result).toContain('No custom scene');
    });
  });

  describe('export_custom_scene', () => {
    it('should export as JSON', async () => {
      saveScene('party', [{ action: 'on', target: 'All' }], 'Party mode');
      const tool = findTool('export_custom_scene');
      const result = await tool.execute({ name: 'party' }, dummyConfig);
      const parsed = JSON.parse(result);
      expect(parsed.name).toBe('party');
      expect(parsed.commands).toHaveLength(1);
    });

    it('should error for unknown scene', async () => {
      const tool = findTool('export_custom_scene');
      const result = await tool.execute({ name: 'nonexistent' }, dummyConfig);
      expect(result).toContain('No custom scene');
    });
  });
});

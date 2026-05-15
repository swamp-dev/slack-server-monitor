import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  initSceneCache,
  saveScene,
  readScene,
  recallScene,
  listScenes,
  deleteScene,
  exportScene,
} from './scene-cache.js';
import type { SequenceStep } from './sequences.js';

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

const sampleCommands: SequenceStep[] = [
  { action: 'on', target: 'Desk' },
  { action: 'color', target: 'Desk', value: '#FF0000' },
  { action: 'brightness', target: 'Lamp', value: '80' },
];

describe('scene cache', () => {
  beforeEach(() => {
    const db = createTestDb();
    initSceneCache(db);
  });

  describe('saveScene / recallScene', () => {
    it('should save and retrieve a scene', () => {
      saveScene('cozy', sampleCommands, 'A cozy setup');
      const scene = recallScene('cozy');
      expect(scene).not.toBeNull();
      expect(scene?.name).toBe('cozy');
      expect(scene?.commands).toEqual(sampleCommands);
      expect(scene?.description).toBe('A cozy setup');
      expect(scene?.createdAt).toBeGreaterThan(0);
    });

    it('should increment use count on recallScene', () => {
      saveScene('cozy', sampleCommands);
      const first = recallScene('cozy');
      expect(first?.useCount).toBe(1);

      const second = recallScene('cozy');
      expect(second?.useCount).toBe(2);
    });

    it('should return null for nonexistent scene', () => {
      expect(recallScene('nonexistent')).toBeNull();
    });

    it('should overwrite existing scene with same name', () => {
      saveScene('cozy', sampleCommands, 'Version 1');
      saveScene('cozy', [{ action: 'off', target: 'All' }], 'Version 2');

      const scene = recallScene('cozy');
      expect(scene?.commands).toEqual([{ action: 'off', target: 'All' }]);
      expect(scene?.description).toBe('Version 2');
    });
  });

  describe('listScenes', () => {
    it('should return empty array when no scenes', () => {
      expect(listScenes()).toEqual([]);
    });

    it('should return all scenes sorted by use count', () => {
      saveScene('a', sampleCommands, 'Scene A');
      saveScene('b', sampleCommands, 'Scene B');

      // Use 'b' twice to boost its ranking
      recallScene('b');
      recallScene('b');
      recallScene('a');

      const scenes = listScenes();
      expect(scenes).toHaveLength(2);
      expect(scenes[0].name).toBe('b');
      expect(scenes[1].name).toBe('a');
    });
  });

  describe('deleteScene', () => {
    it('should delete an existing scene', () => {
      saveScene('cozy', sampleCommands);
      expect(deleteScene('cozy')).toBe(true);
      expect(recallScene('cozy')).toBeNull();
    });

    it('should return false for nonexistent scene', () => {
      expect(deleteScene('nonexistent')).toBe(false);
    });
  });

  describe('readScene (no side effects)', () => {
    it('should read without incrementing use count', () => {
      saveScene('cozy', sampleCommands);
      readScene('cozy');
      readScene('cozy');
      readScene('cozy');

      const scene = readScene('cozy');
      expect(scene?.useCount).toBe(0);
    });

    it('should return null for nonexistent scene', () => {
      expect(readScene('nonexistent')).toBeNull();
    });
  });

  describe('exportScene', () => {
    it('should export as JSON', () => {
      saveScene('cozy', sampleCommands, 'A cozy setup');
      const json = exportScene('cozy');
      expect(json).not.toBeNull();

      const parsed = JSON.parse(json as string);
      expect(parsed.name).toBe('cozy');
      expect(parsed.commands).toEqual(sampleCommands);
      expect(parsed.description).toBe('A cozy setup');
    });

    it('should return null for nonexistent scene', () => {
      expect(exportScene('nonexistent')).toBeNull();
    });
  });
});

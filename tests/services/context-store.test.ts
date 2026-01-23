import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ContextStore } from '../../src/services/context-store.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('ContextStore', () => {
  let store: ContextStore;
  let testDbPath: string;

  beforeEach(() => {
    // Create a unique temp path for each test
    testDbPath = path.join(os.tmpdir(), `test-context-${Date.now()}.db`);
    store = new ContextStore(testDbPath);
  });

  afterEach(() => {
    store.close();
    // Clean up test database
    try {
      fs.unlinkSync(testDbPath);
      fs.unlinkSync(testDbPath + '-wal');
      fs.unlinkSync(testDbPath + '-shm');
    } catch {
      // Files may not exist
    }
  });

  describe('channel context management', () => {
    it('should return null for channel with no context set', () => {
      const result = store.getChannelContext('C123ABC');
      expect(result).toBeNull();
    });

    it('should set and get channel context', () => {
      store.setChannelContext('C123ABC', 'homelab');

      const result = store.getChannelContext('C123ABC');
      expect(result).toBe('homelab');
    });

    it('should update existing channel context', () => {
      store.setChannelContext('C123ABC', 'homelab');
      store.setChannelContext('C123ABC', 'infra');

      const result = store.getChannelContext('C123ABC');
      expect(result).toBe('infra');
    });

    it('should handle multiple channels independently', () => {
      store.setChannelContext('C123ABC', 'homelab');
      store.setChannelContext('C456DEF', 'infra');

      expect(store.getChannelContext('C123ABC')).toBe('homelab');
      expect(store.getChannelContext('C456DEF')).toBe('infra');
    });

    it('should clear channel context and return true', () => {
      store.setChannelContext('C123ABC', 'homelab');

      const result = store.clearChannelContext('C123ABC');
      expect(result).toBe(true);
      expect(store.getChannelContext('C123ABC')).toBeNull();
    });

    it('should return false when clearing non-existent context', () => {
      const result = store.clearChannelContext('C123ABC');
      expect(result).toBe(false);
    });
  });

  describe('getAllChannelContexts', () => {
    it('should return empty array when no contexts set', () => {
      const result = store.getAllChannelContexts();
      expect(result).toEqual([]);
    });

    it('should return all channel contexts', () => {
      store.setChannelContext('C123ABC', 'homelab');
      store.setChannelContext('C456DEF', 'infra');

      const result = store.getAllChannelContexts();
      expect(result).toHaveLength(2);

      const homelab = result.find((c) => c.channelId === 'C123ABC');
      expect(homelab?.contextAlias).toBe('homelab');
      expect(homelab?.updatedAt).toBeDefined();

      const infra = result.find((c) => c.channelId === 'C456DEF');
      expect(infra?.contextAlias).toBe('infra');
    });
  });
});

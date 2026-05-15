import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock the config module before importing the command
vi.mock('../../src/config/index.js', () => ({
  config: {
    claude: {
      dbPath: '',
      contextDir: '/opt/default',
      contextOptions: [
        { alias: 'homelab', path: '/opt/homelab' },
        { alias: 'infra', path: '/opt/infrastructure' },
      ],
    },
  },
}));

// Mock the logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { type ContextStore, getContextStore, closeContextStore } from '../../src/services/context-store.js';
import { config } from '../../src/config/index.js';

describe('ContextCommand', () => {
  let testDbPath: string;
  let store: ContextStore;

  beforeEach(() => {
    // Create a unique temp path for each test
    testDbPath = path.join(os.tmpdir(), `test-context-cmd-${Date.now()}.db`);
    // Update the mock config to use test db path
    (config.claude as { dbPath: string }).dbPath = testDbPath;
    store = getContextStore(testDbPath);
  });

  afterEach(() => {
    closeContextStore();
    // Clean up test database
    try {
      fs.unlinkSync(testDbPath);
      fs.unlinkSync(testDbPath + '-wal');
      fs.unlinkSync(testDbPath + '-shm');
    } catch {
      // Files may not exist
    }
  });

  describe('context selection logic', () => {
    it('should return null when no context is set for channel', () => {
      const result = store.getChannelContext('C123ABC');
      expect(result).toBeNull();
    });

    it('should set context for channel', () => {
      store.setChannelContext('C123ABC', 'homelab');
      expect(store.getChannelContext('C123ABC')).toBe('homelab');
    });

    it('should clear context for channel', () => {
      store.setChannelContext('C123ABC', 'homelab');
      const cleared = store.clearChannelContext('C123ABC');
      expect(cleared).toBe(true);
      expect(store.getChannelContext('C123ABC')).toBeNull();
    });

    it('should validate alias exists in options', () => {
      const contextOptions = config.claude?.contextOptions ?? [];
      const validAlias = 'homelab';
      const invalidAlias = 'nonexistent';

      const validOption = contextOptions.find((o) => o.alias === validAlias);
      const invalidOption = contextOptions.find((o) => o.alias === invalidAlias);

      expect(validOption).toBeDefined();
      expect(validOption?.path).toBe('/opt/homelab');
      expect(invalidOption).toBeUndefined();
    });
  });

  describe('context options configuration', () => {
    it('should have configured context options', () => {
      const contextOptions = config.claude?.contextOptions ?? [];
      expect(contextOptions).toHaveLength(2);
      expect(contextOptions[0]).toEqual({ alias: 'homelab', path: '/opt/homelab' });
      expect(contextOptions[1]).toEqual({ alias: 'infra', path: '/opt/infrastructure' });
    });

    it('should have a default context directory', () => {
      expect(config.claude?.contextDir).toBe('/opt/default');
    });
  });
});

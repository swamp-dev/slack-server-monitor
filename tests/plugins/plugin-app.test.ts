import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { App } from '@slack/bolt';
import {
  createPluginApp,
  clearRegisteredCommands,
  getRegisteredCommands,
} from '../../src/plugins/plugin-app.js';

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFunction = (...args: any[]) => unknown;

describe('PluginApp', () => {
  let mockApp: App;
  let commandHandlers: Map<string, AnyFunction>;

  beforeEach(() => {
    clearRegisteredCommands();
    commandHandlers = new Map();

    // Create a mock Bolt App
    mockApp = {
      command: vi.fn((name: string, handler: AnyFunction) => {
        commandHandlers.set(name, handler);
      }),
    } as unknown as App;
  });

  afterEach(() => {
    clearRegisteredCommands();
  });

  describe('createPluginApp', () => {
    it('should create a PluginApp with the plugin name', () => {
      const pluginApp = createPluginApp(mockApp, 'test-plugin');
      expect(pluginApp.pluginName).toBe('test-plugin');
    });
  });

  describe('command registration', () => {
    it('should register valid commands', () => {
      const pluginApp = createPluginApp(mockApp, 'test-plugin');
      const handler = vi.fn();

      pluginApp.command('/mycommand', handler);

      expect(mockApp.command).toHaveBeenCalledWith('/mycommand', expect.any(Function));
      expect(getRegisteredCommands()).toContain('/mycommand');
    });

    it('should reject commands without leading slash', () => {
      const pluginApp = createPluginApp(mockApp, 'test-plugin');

      expect(() => {
        pluginApp.command('mycommand', vi.fn());
      }).toThrow('Invalid command name');
    });

    it('should reject commands with uppercase letters', () => {
      const pluginApp = createPluginApp(mockApp, 'test-plugin');

      expect(() => {
        pluginApp.command('/MyCommand', vi.fn());
      }).toThrow('Invalid command name');
    });

    it('should reject commands with invalid characters', () => {
      const pluginApp = createPluginApp(mockApp, 'test-plugin');

      expect(() => {
        pluginApp.command('/my_command', vi.fn());
      }).toThrow('Invalid command name');

      expect(() => {
        pluginApp.command('/my command', vi.fn());
      }).toThrow('Invalid command name');
    });

    it('should reject commands longer than 21 characters', () => {
      const pluginApp = createPluginApp(mockApp, 'test-plugin');

      expect(() => {
        pluginApp.command('/a'.padEnd(23, 'a'), vi.fn());
      }).toThrow('Invalid command name');
    });

    it('should accept commands with hyphens', () => {
      const pluginApp = createPluginApp(mockApp, 'test-plugin');
      pluginApp.command('/my-command', vi.fn());

      expect(getRegisteredCommands()).toContain('/my-command');
    });

    it('should reject duplicate command registration', () => {
      const pluginApp1 = createPluginApp(mockApp, 'plugin1');
      const pluginApp2 = createPluginApp(mockApp, 'plugin2');

      pluginApp1.command('/shared', vi.fn());

      expect(() => {
        pluginApp2.command('/shared', vi.fn());
      }).toThrow('Command "/shared" is already registered');
    });

    it('should reject duplicate commands within same plugin', () => {
      const pluginApp = createPluginApp(mockApp, 'test-plugin');

      pluginApp.command('/mycommand', vi.fn());

      expect(() => {
        pluginApp.command('/mycommand', vi.fn());
      }).toThrow('already registered');
    });

    it('should wrap handler with logging', async () => {
      const pluginApp = createPluginApp(mockApp, 'test-plugin');
      const originalHandler = vi.fn().mockResolvedValue(undefined);

      pluginApp.command('/mycommand', originalHandler);

      // Get the wrapped handler
      const wrappedHandler = commandHandlers.get('/mycommand');
      expect(wrappedHandler).toBeDefined();
      if (!wrappedHandler) throw new Error('Handler not found');

      // Call the wrapped handler
      const mockArgs = {
        command: {
          user_id: 'U123',
          channel_id: 'C456',
        },
        ack: vi.fn(),
        respond: vi.fn(),
      };

      await wrappedHandler(mockArgs);

      // Original handler should have been called
      expect(originalHandler).toHaveBeenCalledWith(mockArgs);
    });

    it('should log errors from handler', async () => {
      const pluginApp = createPluginApp(mockApp, 'test-plugin');
      const error = new Error('Handler failed');
      const failingHandler = vi.fn().mockRejectedValue(error);

      pluginApp.command('/failing', failingHandler);

      const wrappedHandler = commandHandlers.get('/failing');
      if (!wrappedHandler) throw new Error('Handler not found');

      const mockArgs = {
        command: {
          user_id: 'U123',
          channel_id: 'C456',
        },
      };

      await expect(wrappedHandler(mockArgs)).rejects.toThrow('Handler failed');
    });
  });

  describe('clearRegisteredCommands', () => {
    it('should clear all registered commands', () => {
      const pluginApp = createPluginApp(mockApp, 'test-plugin');
      pluginApp.command('/cmd1', vi.fn());
      pluginApp.command('/cmd2', vi.fn());

      expect(getRegisteredCommands()).toHaveLength(2);

      clearRegisteredCommands();

      expect(getRegisteredCommands()).toHaveLength(0);
    });
  });

  describe('getRegisteredCommands', () => {
    it('should return list of registered commands', () => {
      const pluginApp = createPluginApp(mockApp, 'test-plugin');
      pluginApp.command('/first', vi.fn());
      pluginApp.command('/second', vi.fn());

      const commands = getRegisteredCommands();
      expect(commands).toContain('/first');
      expect(commands).toContain('/second');
    });

    it('should return empty array when no commands registered', () => {
      expect(getRegisteredCommands()).toEqual([]);
    });
  });
});

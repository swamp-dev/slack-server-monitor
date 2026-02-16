import { describe, it, expect } from 'vitest';
import { isValidPlugin } from '../../src/plugins/types.js';

describe('isValidPlugin', () => {
  describe('with valid plugins', () => {
    it('should accept minimal valid plugin', () => {
      const plugin = {
        name: 'test-plugin',
        version: '1.0.0',
      };

      expect(isValidPlugin(plugin)).toBe(true);
    });

    it('should accept full valid plugin', () => {
      const plugin = {
        name: 'test-plugin',
        version: '1.0.0',
        description: 'A test plugin',
        registerCommands: () => {
          /* noop for testing */
        },
        tools: [],
        init: async () => {
          /* noop for testing */
        },
        destroy: async () => {
          /* noop for testing */
        },
      };

      expect(isValidPlugin(plugin)).toBe(true);
    });

    it('should accept plugin with only some optional fields', () => {
      const plugin = {
        name: 'test-plugin',
        version: '1.0.0',
        description: 'Has description only',
      };

      expect(isValidPlugin(plugin)).toBe(true);
    });

    it('should accept plugin with tools array', () => {
      const plugin = {
        name: 'test-plugin',
        version: '1.0.0',
        tools: [
          {
            spec: { name: 'test_tool', description: 'A tool', input_schema: { type: 'object', properties: {} } },
            execute: async () => 'result',
          },
        ],
      };

      expect(isValidPlugin(plugin)).toBe(true);
    });
  });

  describe('with invalid plugins', () => {
    it('should reject null', () => {
      expect(isValidPlugin(null)).toBe(false);
    });

    it('should reject undefined', () => {
      expect(isValidPlugin(undefined)).toBe(false);
    });

    it('should reject non-object', () => {
      expect(isValidPlugin('string')).toBe(false);
      expect(isValidPlugin(123)).toBe(false);
      expect(isValidPlugin(true)).toBe(false);
    });

    it('should reject empty object', () => {
      expect(isValidPlugin({})).toBe(false);
    });

    it('should reject missing name', () => {
      const plugin = {
        version: '1.0.0',
      };

      expect(isValidPlugin(plugin)).toBe(false);
    });

    it('should reject missing version', () => {
      const plugin = {
        name: 'test-plugin',
      };

      expect(isValidPlugin(plugin)).toBe(false);
    });

    it('should reject empty name', () => {
      const plugin = {
        name: '',
        version: '1.0.0',
      };

      expect(isValidPlugin(plugin)).toBe(false);
    });

    it('should reject whitespace-only name', () => {
      const plugin = {
        name: '   ',
        version: '1.0.0',
      };

      expect(isValidPlugin(plugin)).toBe(false);
    });

    it('should reject empty version', () => {
      const plugin = {
        name: 'test-plugin',
        version: '',
      };

      expect(isValidPlugin(plugin)).toBe(false);
    });

    it('should reject non-string name', () => {
      const plugin = {
        name: 123,
        version: '1.0.0',
      };

      expect(isValidPlugin(plugin)).toBe(false);
    });

    it('should reject non-string version', () => {
      const plugin = {
        name: 'test-plugin',
        version: 1,
      };

      expect(isValidPlugin(plugin)).toBe(false);
    });

    it('should reject non-string description', () => {
      const plugin = {
        name: 'test-plugin',
        version: '1.0.0',
        description: 123,
      };

      expect(isValidPlugin(plugin)).toBe(false);
    });

    it('should reject non-function registerCommands', () => {
      const plugin = {
        name: 'test-plugin',
        version: '1.0.0',
        registerCommands: 'not a function',
      };

      expect(isValidPlugin(plugin)).toBe(false);
    });

    it('should reject non-array tools', () => {
      const plugin = {
        name: 'test-plugin',
        version: '1.0.0',
        tools: 'not an array',
      };

      expect(isValidPlugin(plugin)).toBe(false);
    });

    it('should reject non-function init', () => {
      const plugin = {
        name: 'test-plugin',
        version: '1.0.0',
        init: 'not a function',
      };

      expect(isValidPlugin(plugin)).toBe(false);
    });

    it('should reject non-function destroy', () => {
      const plugin = {
        name: 'test-plugin',
        version: '1.0.0',
        destroy: {},
      };

      expect(isValidPlugin(plugin)).toBe(false);
    });
  });

  describe('helpEntries validation', () => {
    it('should accept plugin with valid helpEntries', () => {
      const plugin = {
        name: 'test-plugin',
        version: '1.0.0',
        helpEntries: [
          { command: '/test', description: 'Test command' },
          { command: '/test sub', description: 'Subcommand', group: 'Test Group' },
        ],
      };

      expect(isValidPlugin(plugin)).toBe(true);
    });

    it('should accept plugin without helpEntries (backward compat)', () => {
      const plugin = {
        name: 'test-plugin',
        version: '1.0.0',
      };

      expect(isValidPlugin(plugin)).toBe(true);
    });

    it('should reject non-array helpEntries', () => {
      const plugin = {
        name: 'test-plugin',
        version: '1.0.0',
        helpEntries: 'not an array',
      };

      expect(isValidPlugin(plugin)).toBe(false);
    });

    it('should reject entries with missing command', () => {
      const plugin = {
        name: 'test-plugin',
        version: '1.0.0',
        helpEntries: [
          { description: 'Missing command field' },
        ],
      };

      expect(isValidPlugin(plugin)).toBe(false);
    });

    it('should reject entries with missing description', () => {
      const plugin = {
        name: 'test-plugin',
        version: '1.0.0',
        helpEntries: [
          { command: '/test' },
        ],
      };

      expect(isValidPlugin(plugin)).toBe(false);
    });

    it('should accept entries with optional group', () => {
      const plugin = {
        name: 'test-plugin',
        version: '1.0.0',
        helpEntries: [
          { command: '/test', description: 'No group' },
          { command: '/test sub', description: 'With group', group: 'My Group' },
        ],
      };

      expect(isValidPlugin(plugin)).toBe(true);
    });

    it('should reject entries with non-string group', () => {
      const plugin = {
        name: 'test-plugin',
        version: '1.0.0',
        helpEntries: [
          { command: '/test', description: 'Bad group', group: 123 },
        ],
      };

      expect(isValidPlugin(plugin)).toBe(false);
    });

    it('should reject entries that are not objects', () => {
      const plugin = {
        name: 'test-plugin',
        version: '1.0.0',
        helpEntries: ['not an object'],
      };

      expect(isValidPlugin(plugin)).toBe(false);
    });

    it('should accept empty helpEntries array', () => {
      const plugin = {
        name: 'test-plugin',
        version: '1.0.0',
        helpEntries: [],
      };

      expect(isValidPlugin(plugin)).toBe(true);
    });
  });
});

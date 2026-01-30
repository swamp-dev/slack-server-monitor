import { describe, it, expect } from 'vitest';
import {
  validateToolName,
  validateToolSpec,
  validateToolDefinition,
  validatePluginTools,
  isBuiltInToolName,
  BUILTIN_TOOL_NAMES,
} from '../../../src/services/tools/validation.js';

describe('tool validation', () => {
  describe('validateToolName', () => {
    it('should accept valid tool names', () => {
      const validNames = [
        'abc', // minimum length
        'my_tool',
        'calculate_score',
        'tool123',
        'a'.repeat(50), // maximum length
      ];

      for (const name of validNames) {
        const result = validateToolName(name);
        expect(result.valid, `Expected "${name}" to be valid`).toBe(true);
        expect(result.errors).toEqual([]);
      }
    });

    it('should reject empty names', () => {
      const result = validateToolName('');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Tool name cannot be empty');
    });

    it('should reject names shorter than 3 characters', () => {
      const result = validateToolName('ab');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Tool name must be at least 3 characters');
    });

    it('should reject names longer than 50 characters', () => {
      const result = validateToolName('a'.repeat(51));
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Tool name must be at most 50 characters');
    });

    it('should reject names starting with a number', () => {
      const result = validateToolName('1tool');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'Tool name must be lowercase, start with a letter, and contain only letters, numbers, and underscores'
      );
    });

    it('should reject names with uppercase letters', () => {
      const result = validateToolName('MyTool');
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should reject names with hyphens', () => {
      const result = validateToolName('my-tool');
      expect(result.valid).toBe(false);
    });

    it('should reject names with spaces', () => {
      const result = validateToolName('my tool');
      expect(result.valid).toBe(false);
    });

    it('should reject non-string names', () => {
      expect(validateToolName(undefined).valid).toBe(false);
      expect(validateToolName(null).valid).toBe(false);
      expect(validateToolName(123).valid).toBe(false);
      expect(validateToolName({}).valid).toBe(false);
    });

    it('should error when name conflicts with a built-in tool', () => {
      const result = validateToolName('get_container_status');
      expect(result.valid).toBe(false); // Now invalid - error, not warning
      expect(result.errors).toContain(
        'Tool name "get_container_status" conflicts with built-in tool (will be namespaced as pluginname:get_container_status)'
      );
    });
  });

  describe('isBuiltInToolName', () => {
    it('should return true for built-in tool names', () => {
      expect(isBuiltInToolName('get_container_status')).toBe(true);
      expect(isBuiltInToolName('get_container_logs')).toBe(true);
      expect(isBuiltInToolName('get_system_resources')).toBe(true);
      expect(isBuiltInToolName('get_disk_usage')).toBe(true);
      expect(isBuiltInToolName('get_network_info')).toBe(true);
      expect(isBuiltInToolName('run_command')).toBe(true);
      expect(isBuiltInToolName('read_file')).toBe(true);
    });

    it('should return false for non-built-in names', () => {
      expect(isBuiltInToolName('my_custom_tool')).toBe(false);
      expect(isBuiltInToolName('calculate_score')).toBe(false);
    });

    it('should have correct set of built-in tools', () => {
      expect(BUILTIN_TOOL_NAMES.size).toBe(7);
    });
  });

  describe('validateToolSpec', () => {
    const validSpec = {
      name: 'my_tool',
      description: 'A tool that does something useful',
      input_schema: {
        type: 'object',
        properties: {
          arg1: { type: 'string' },
        },
      },
    };

    it('should accept a valid tool spec', () => {
      const result = validateToolSpec(validSpec);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should reject non-object specs', () => {
      expect(validateToolSpec(null).valid).toBe(false);
      expect(validateToolSpec(undefined).valid).toBe(false);
      expect(validateToolSpec('string').valid).toBe(false);
    });

    it('should reject missing description', () => {
      const result = validateToolSpec({
        name: 'my_tool',
        input_schema: { type: 'object', properties: {} },
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Tool spec must have a description string');
    });

    it('should reject empty description', () => {
      const result = validateToolSpec({
        ...validSpec,
        description: '',
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Tool description cannot be empty');
    });

    it('should warn on very short descriptions', () => {
      const result = validateToolSpec({
        ...validSpec,
        description: 'Too short',
      });
      expect(result.valid).toBe(true);
      expect(result.warnings).toContain(
        'Tool description is very short, consider adding more detail'
      );
    });

    it('should reject missing input_schema', () => {
      const result = validateToolSpec({
        name: 'my_tool',
        description: 'A useful tool for doing things',
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Tool spec must have an input_schema object');
    });

    it('should reject input_schema with wrong type', () => {
      const result = validateToolSpec({
        ...validSpec,
        input_schema: { type: 'string', properties: {} },
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Tool input_schema.type must be "object"');
    });

    it('should reject input_schema without properties', () => {
      const result = validateToolSpec({
        ...validSpec,
        input_schema: { type: 'object' },
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Tool input_schema must have a properties object');
    });
  });

  describe('validateToolDefinition', () => {
    const validTool = {
      spec: {
        name: 'my_tool',
        description: 'A tool that does something useful',
        input_schema: {
          type: 'object',
          properties: {},
        },
      },
      execute: async () => 'result',
    };

    it('should accept a valid tool definition', () => {
      const result = validateToolDefinition(validTool);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should reject non-object definitions', () => {
      expect(validateToolDefinition(null).valid).toBe(false);
      expect(validateToolDefinition(undefined).valid).toBe(false);
    });

    it('should reject missing execute function', () => {
      const result = validateToolDefinition({
        spec: validTool.spec,
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Tool definition must have an execute function');
    });

    it('should reject non-function execute', () => {
      const result = validateToolDefinition({
        spec: validTool.spec,
        execute: 'not a function',
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Tool definition must have an execute function');
    });
  });

  describe('validatePluginTools', () => {
    const validTool = {
      spec: {
        name: 'my_tool',
        description: 'A tool that does something useful',
        input_schema: {
          type: 'object',
          properties: {},
        },
      },
      execute: async () => 'result',
    };

    it('should accept an array of valid tools', () => {
      const result = validatePluginTools([validTool], 'test-plugin');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should accept empty array', () => {
      const result = validatePluginTools([], 'test-plugin');
      expect(result.valid).toBe(true);
    });

    it('should reject non-array input', () => {
      const result = validatePluginTools('not an array' as unknown as unknown[], 'test-plugin');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Plugin tools must be an array');
    });

    it('should detect duplicate tool names', () => {
      const duplicateTool = {
        ...validTool,
        spec: { ...validTool.spec, name: 'my_tool' },
      };
      const result = validatePluginTools([validTool, duplicateTool], 'test-plugin');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Duplicate tool name "my_tool" in plugin "test-plugin"');
    });

    it('should prefix errors with tool index', () => {
      const invalidTool = {
        spec: {
          name: 'x', // Too short
          description: 'A valid description for testing',
          input_schema: { type: 'object', properties: {} },
        },
        execute: async () => 'result',
      };
      const result = validatePluginTools([validTool, invalidTool], 'test-plugin');
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.startsWith('Tool 1:'))).toBe(true);
    });
  });
});

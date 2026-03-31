import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the plugin loader before importing tools/index
vi.mock('../../../src/plugins/index.js', () => ({
  getPluginTools: vi.fn(() => []),
}));

import { getToolSpecs, getToolNames, executeTool, refreshToolMap } from '../../../src/services/tools/index.js';
import { getPluginTools } from '../../../src/plugins/index.js';
import type { ToolConfig } from '../../../src/services/tools/types.js';

describe('tools/index', () => {
  const mockConfig: ToolConfig = {
    allowedDirs: ['/tmp'],
    maxFileSizeKb: 100,
    maxLogLines: 50,
  };

  beforeEach(() => {
    vi.mocked(getPluginTools).mockReturnValue([]);
    // Reset tool map between tests
    refreshToolMap();
  });

  describe('getToolSpecs', () => {
    it('should return all tool specifications', () => {
      const specs = getToolSpecs();

      expect(specs.length).toBeGreaterThan(0);

      for (const spec of specs) {
        expect(spec.name).toBeDefined();
        expect(spec.description).toBeDefined();
        expect(spec.input_schema).toBeDefined();
      }
    });

    it('should include server monitoring tools', () => {
      const specs = getToolSpecs();
      const names = specs.map(s => s.name);

      expect(names).toContain('get_container_status');
      expect(names).toContain('get_container_logs');
      expect(names).toContain('search_container_logs');
      expect(names).toContain('get_system_resources');
      expect(names).toContain('get_disk_usage');
      expect(names).toContain('get_network_info');
      expect(names).toContain('get_docker_images');
    });

    it('should include file tools', () => {
      const specs = getToolSpecs();
      const names = specs.map(s => s.name);

      expect(names).toContain('read_file');
    });

    it('should include github tools', () => {
      const specs = getToolSpecs();
      const names = specs.map(s => s.name);

      expect(names).toContain('create_github_issue');
      expect(names).toContain('list_github_issues');
      expect(names).toContain('view_github_issue');
    });

    it('should exclude disabled tools', () => {
      const specs = getToolSpecs(['read_file', 'get_container_logs']);
      const names = specs.map(s => s.name);

      expect(names).not.toContain('read_file');
      expect(names).not.toContain('get_container_logs');
      expect(names).toContain('get_container_status');
    });

    it('should include namespaced plugin tools', () => {
      vi.mocked(getPluginTools).mockReturnValue([
        {
          spec: {
            name: 'my_tool',
            description: 'A plugin tool',
            input_schema: { type: 'object' as const, properties: {} },
          },
          execute: vi.fn(async () => 'result'),
          _pluginName: 'myplugin',
        },
      ]);

      const specs = getToolSpecs();
      const names = specs.map(s => s.name);

      expect(names).toContain('myplugin:my_tool');
    });
  });

  describe('getToolNames', () => {
    it('should return all tool names', () => {
      const names = getToolNames();

      expect(names).toContain('get_container_status');
      expect(names).toContain('get_container_logs');
      expect(names).toContain('search_container_logs');
      expect(names).toContain('get_system_resources');
      expect(names).toContain('get_disk_usage');
      expect(names).toContain('get_network_info');
      expect(names).toContain('get_docker_images');
      expect(names).toContain('read_file');
      expect(names).toContain('create_github_issue');
      expect(names).toContain('list_github_issues');
      expect(names).toContain('view_github_issue');
    });

    it('should include namespaced plugin tool names', () => {
      vi.mocked(getPluginTools).mockReturnValue([
        {
          spec: {
            name: 'check_weather',
            description: 'Check weather',
            input_schema: { type: 'object' as const, properties: {} },
          },
          execute: vi.fn(async () => 'sunny'),
          _pluginName: 'weather',
        },
      ]);

      const names = getToolNames();
      expect(names).toContain('weather:check_weather');
    });
  });

  describe('refreshToolMap', () => {
    it('should rebuild the tool map with current tools', () => {
      // Initially no plugin tools
      refreshToolMap();
      const namesBefore = getToolNames();
      expect(namesBefore).not.toContain('test:new_tool');

      // Add a plugin tool
      vi.mocked(getPluginTools).mockReturnValue([
        {
          spec: {
            name: 'new_tool',
            description: 'New tool',
            input_schema: { type: 'object' as const, properties: {} },
          },
          execute: vi.fn(async () => 'done'),
          _pluginName: 'test',
        },
      ]);

      refreshToolMap();

      // Now executeTool should find it
      const namesAfter = getToolNames();
      expect(namesAfter).toContain('test:new_tool');
    });
  });

  describe('executeTool', () => {
    it('should return error for unknown tool', async () => {
      refreshToolMap();
      const result = await executeTool('id-1', 'nonexistent_tool', {}, mockConfig);

      expect(result.toolUseId).toBe('id-1');
      expect(result.content).toContain('Error: Unknown tool "nonexistent_tool"');
      expect(result.isError).toBe(true);
    });

    it('should execute a built-in tool and return scrubbed string result', async () => {
      refreshToolMap();
      // Use a built-in tool — result will vary by environment but should always be a string
      const result = await executeTool('id-2', 'get_disk_usage', {}, mockConfig);

      expect(result.toolUseId).toBe('id-2');
      expect(typeof result.content).toBe('string');
      expect(result.content.length).toBeGreaterThan(0);
    });

    it('should execute a plugin tool by namespaced name', async () => {
      const mockExecute = vi.fn(async () => 'plugin result');
      vi.mocked(getPluginTools).mockReturnValue([
        {
          spec: {
            name: 'do_thing',
            description: 'Do a thing',
            input_schema: { type: 'object' as const, properties: {} },
          },
          execute: mockExecute,
          _pluginName: 'myplugin',
        },
      ]);
      refreshToolMap();

      const result = await executeTool('id-3', 'myplugin:do_thing', { key: 'val' }, mockConfig);

      expect(result.toolUseId).toBe('id-3');
      expect(result.content).toContain('plugin result');
      expect(result.isError).toBeUndefined();
      expect(mockExecute).toHaveBeenCalledWith({ key: 'val' }, mockConfig);
    });

    it('should scrub sensitive data from tool output', async () => {
      const mockExecute = vi.fn(async () => 'password: supersecretpassword123');
      vi.mocked(getPluginTools).mockReturnValue([
        {
          spec: {
            name: 'leaky_tool',
            description: 'Returns sensitive data',
            input_schema: { type: 'object' as const, properties: {} },
          },
          execute: mockExecute,
          _pluginName: 'test',
        },
      ]);
      refreshToolMap();

      const result = await executeTool('id-4', 'test:leaky_tool', {}, mockConfig);

      expect(result.content).not.toContain('supersecretpassword123');
    });

    it('should catch tool execution errors and return error result', async () => {
      const mockExecute = vi.fn(async () => { throw new Error('Tool exploded'); });
      vi.mocked(getPluginTools).mockReturnValue([
        {
          spec: {
            name: 'broken_tool',
            description: 'Always fails',
            input_schema: { type: 'object' as const, properties: {} },
          },
          execute: mockExecute,
          _pluginName: 'test',
        },
      ]);
      refreshToolMap();

      const result = await executeTool('id-5', 'test:broken_tool', {}, mockConfig);

      expect(result.toolUseId).toBe('id-5');
      expect(result.content).toContain('Error executing test:broken_tool: Tool exploded');
      expect(result.isError).toBe(true);
    });

    it('should handle non-Error exceptions', async () => {
      const mockExecute = vi.fn(async () => { throw 'string error'; });
      vi.mocked(getPluginTools).mockReturnValue([
        {
          spec: {
            name: 'weird_error_tool',
            description: 'Throws string',
            input_schema: { type: 'object' as const, properties: {} },
          },
          execute: mockExecute,
          _pluginName: 'test',
        },
      ]);
      refreshToolMap();

      const result = await executeTool('id-6', 'test:weird_error_tool', {}, mockConfig);

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Unknown error');
    });
  });

  describe('plugin tool namespacing', () => {
    it('should throw if plugin tool is missing _pluginName', () => {
      vi.mocked(getPluginTools).mockReturnValue([
        {
          spec: {
            name: 'orphan_tool',
            description: 'No plugin name',
            input_schema: { type: 'object' as const, properties: {} },
          },
          execute: vi.fn(async () => 'result'),
          // Missing _pluginName
        },
      ]);

      expect(() => getToolNames()).toThrow('missing _pluginName');
    });
  });
});

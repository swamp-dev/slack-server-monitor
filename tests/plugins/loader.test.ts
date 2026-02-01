import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import type { App } from '@slack/bolt';

// Mock the logger to avoid console noise
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock the config module to avoid validation errors in tests
vi.mock('../../src/config/index.js', () => ({
  config: {
    claude: undefined, // Claude not enabled in tests by default
  },
}));

// Mock the ask module to avoid circular dependency issues
vi.mock('../../src/commands/ask.js', () => ({
  checkAndRecordClaudeRequest: vi.fn().mockReturnValue(true),
}));

// Import after mocking
const { discoverPlugins, getPluginTools, destroyPlugins, getLoadedPlugins, registerPlugins } =
  await import('../../src/plugins/loader.js');
const { clearRegisteredCommands } = await import('../../src/plugins/plugin-app.js');

const TEST_PLUGINS_DIR = resolve(process.cwd(), 'plugins.local');

// Helper to create a valid plugin file
function createValidPluginContent(
  name: string,
  options: {
    toolName?: string;
    hasInit?: boolean;
    hasDestroy?: boolean;
    initDelay?: number;
    destroyDelay?: number;
    throwInInit?: boolean;
  } = {}
): string {
  const toolPart = options.toolName
    ? `
  tools: [{
    spec: {
      name: '${options.toolName}',
      description: 'A test tool for validation',
      input_schema: { type: 'object', properties: {} },
    },
    execute: async () => 'result',
  }],`
    : '';

  const initPart = options.hasInit
    ? `
  init: async () => {
    ${options.initDelay ? `await new Promise(r => setTimeout(r, ${String(options.initDelay)}));` : ''}
    ${options.throwInInit ? `throw new Error('Init failed');` : ''}
  },`
    : '';

  const destroyPart = options.hasDestroy
    ? `
  destroy: async () => {
    ${options.destroyDelay ? `await new Promise(r => setTimeout(r, ${String(options.destroyDelay)}));` : ''}
  },`
    : '';

  return `
export default {
  name: '${name}',
  version: '1.0.0',
  description: 'Test plugin',${toolPart}${initPart}${destroyPart}
};
`;
}

describe('plugin loader', () => {
  let mockApp: App;

  beforeEach(async () => {
    // Clean up any existing test plugins
    if (existsSync(TEST_PLUGINS_DIR)) {
      await rm(TEST_PLUGINS_DIR, { recursive: true });
    }
    clearRegisteredCommands();

    // Create mock app
    mockApp = {
      command: vi.fn(),
    } as unknown as App;
  });

  afterEach(async () => {
    // Clean up and reset state
    await destroyPlugins();
    if (existsSync(TEST_PLUGINS_DIR)) {
      await rm(TEST_PLUGINS_DIR, { recursive: true });
    }
    clearRegisteredCommands();
  });

  describe('discoverPlugins', () => {
    it('should return empty array when plugins.local does not exist', async () => {
      const plugins = await discoverPlugins();
      expect(plugins).toEqual([]);
    });

    it('should find .ts files in plugins.local', async () => {
      await mkdir(TEST_PLUGINS_DIR);
      await writeFile(join(TEST_PLUGINS_DIR, 'test.ts'), 'export default {}');

      const plugins = await discoverPlugins();
      expect(plugins).toHaveLength(1);
      expect(plugins[0]).toContain('test.ts');
    });

    it('should find .js files in plugins.local', async () => {
      await mkdir(TEST_PLUGINS_DIR);
      await writeFile(join(TEST_PLUGINS_DIR, 'test.js'), 'export default {}');

      const plugins = await discoverPlugins();
      expect(plugins).toHaveLength(1);
      expect(plugins[0]).toContain('test.js');
    });

    it('should ignore non-js/ts files', async () => {
      await mkdir(TEST_PLUGINS_DIR);
      await writeFile(join(TEST_PLUGINS_DIR, 'readme.md'), '# Readme');
      await writeFile(join(TEST_PLUGINS_DIR, 'config.json'), '{}');

      const plugins = await discoverPlugins();
      expect(plugins).toEqual([]);
    });

    it('should ignore directories', async () => {
      await mkdir(TEST_PLUGINS_DIR);
      await mkdir(join(TEST_PLUGINS_DIR, 'subdir'));
      await writeFile(join(TEST_PLUGINS_DIR, 'subdir', 'test.ts'), 'export default {}');

      const plugins = await discoverPlugins();
      expect(plugins).toEqual([]);
    });
  });

  describe('getPluginTools', () => {
    it('should return empty array when no plugins loaded', () => {
      const tools = getPluginTools();
      expect(tools).toEqual([]);
    });
  });

  describe('getLoadedPlugins', () => {
    it('should return empty array when no plugins loaded', () => {
      const plugins = getLoadedPlugins();
      expect(plugins).toEqual([]);
    });
  });

  describe('destroyPlugins', () => {
    it('should not throw when no plugins loaded', async () => {
      await expect(destroyPlugins()).resolves.not.toThrow();
    });
  });

  describe('tool namespacing', () => {
    it('should tag tools with _pluginName for namespacing', async () => {
      await mkdir(TEST_PLUGINS_DIR);
      await writeFile(
        join(TEST_PLUGINS_DIR, 'toolplugin.js'),
        createValidPluginContent('toolplugin', { toolName: 'my_custom_tool' })
      );

      await registerPlugins(mockApp);

      const tools = getPluginTools();
      expect(tools).toHaveLength(1);
      expect(tools[0]._pluginName).toBe('toolplugin');
    });

    it('should preserve original tool name in spec', async () => {
      await mkdir(TEST_PLUGINS_DIR);
      await writeFile(
        join(TEST_PLUGINS_DIR, 'toolplugin.js'),
        createValidPluginContent('toolplugin', { toolName: 'my_custom_tool' })
      );

      await registerPlugins(mockApp);

      const tools = getPluginTools();
      expect(tools[0].spec.name).toBe('my_custom_tool');
    });
  });

  describe('tool validation', () => {
    it('should reject plugins with invalid tool names', async () => {
      await mkdir(TEST_PLUGINS_DIR);
      // Tool name too short (less than 3 chars)
      await writeFile(
        join(TEST_PLUGINS_DIR, 'badtool.js'),
        `export default {
          name: 'badtool',
          version: '1.0.0',
          tools: [{
            spec: {
              name: 'ab',
              description: 'Tool with short name',
              input_schema: { type: 'object', properties: {} },
            },
            execute: async () => 'result',
          }],
        };`
      );

      await registerPlugins(mockApp);

      // Plugin should not have loaded
      expect(getLoadedPlugins()).toHaveLength(0);
      expect(getPluginTools()).toHaveLength(0);
    });

    it('should reject plugins with missing tool execute function', async () => {
      await mkdir(TEST_PLUGINS_DIR);
      await writeFile(
        join(TEST_PLUGINS_DIR, 'noexec.js'),
        `export default {
          name: 'noexec',
          version: '1.0.0',
          tools: [{
            spec: {
              name: 'missing_execute',
              description: 'Tool without execute function',
              input_schema: { type: 'object', properties: {} },
            },
          }],
        };`
      );

      await registerPlugins(mockApp);

      expect(getLoadedPlugins()).toHaveLength(0);
    });
  });

  describe('atomic loading', () => {
    it('should not load plugin if init throws', async () => {
      await mkdir(TEST_PLUGINS_DIR);
      await writeFile(
        join(TEST_PLUGINS_DIR, 'failing.js'),
        createValidPluginContent('failing', {
          hasInit: true,
          throwInInit: true,
          toolName: 'should_not_load',
        })
      );

      await registerPlugins(mockApp);

      expect(getLoadedPlugins()).toHaveLength(0);
      expect(getPluginTools()).toHaveLength(0);
    });

    it('should load other plugins even if one fails', async () => {
      await mkdir(TEST_PLUGINS_DIR);

      // Working plugin
      await writeFile(
        join(TEST_PLUGINS_DIR, 'good.js'),
        createValidPluginContent('good', { toolName: 'good_tool' })
      );

      // Failing plugin
      await writeFile(
        join(TEST_PLUGINS_DIR, 'bad.js'),
        createValidPluginContent('bad', { hasInit: true, throwInInit: true })
      );

      await registerPlugins(mockApp);

      const loaded = getLoadedPlugins();
      expect(loaded).toHaveLength(1);
      expect(loaded[0]).toBe('good@1.0.0');
    });
  });

  describe('lifecycle timeouts', () => {
    it('should timeout slow init', async () => {
      await mkdir(TEST_PLUGINS_DIR);
      // Create plugin with slow init (11 seconds, exceeds 10s timeout)
      await writeFile(
        join(TEST_PLUGINS_DIR, 'slow.js'),
        createValidPluginContent('slow', {
          hasInit: true,
          initDelay: 11000, // 11 seconds
          toolName: 'slow_tool',
        })
      );

      await registerPlugins(mockApp);

      // Plugin should not have loaded due to timeout
      expect(getLoadedPlugins()).toHaveLength(0);
    }, 15000); // Test timeout of 15s
  });
});

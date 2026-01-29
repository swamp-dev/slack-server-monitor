import { readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import type { App } from '@slack/bolt';
import type { Plugin, PluginToolDefinition } from './types.js';
import { isValidPlugin } from './types.js';
import { createPluginApp, clearRegisteredCommands } from './plugin-app.js';
import { validatePluginTools } from '../services/tools/validation.js';
import { logger } from '../utils/logger.js';

/**
 * Lifecycle timeouts (in milliseconds)
 */
const INIT_TIMEOUT_MS = 10_000;   // 10 seconds for init()
const DESTROY_TIMEOUT_MS = 5_000; // 5 seconds for destroy()

/**
 * Directory for local plugins (gitignored)
 */
const PLUGINS_DIR = resolve(process.cwd(), 'plugins.local');

/**
 * Loaded plugins registry (with tagged tools)
 */
interface LoadedPlugin extends Plugin {
  /** Tools with _pluginName tagged for namespacing */
  taggedTools?: PluginToolDefinition[];
}

const loadedPlugins: LoadedPlugin[] = [];

/**
 * Wrap a promise with a timeout
 * @param promise - Promise to wrap
 * @param ms - Timeout in milliseconds
 * @param operation - Description for error message
 */
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  operation: string
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${operation} timed out after ${String(ms)}ms`));
    }, ms);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    return result;
  } catch (error) {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * Discover plugin files in the plugins.local directory
 * @returns Array of absolute file paths
 */
export async function discoverPlugins(): Promise<string[]> {
  if (!existsSync(PLUGINS_DIR)) {
    logger.debug('No plugins.local directory found, skipping plugin discovery');
    return [];
  }

  try {
    const entries = await readdir(PLUGINS_DIR, { withFileTypes: true });
    const pluginFiles = entries
      .filter((entry) => entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js')))
      .map((entry) => join(PLUGINS_DIR, entry.name));

    logger.debug('Discovered plugin files', { count: pluginFiles.length, files: pluginFiles });
    return pluginFiles;
  } catch (error) {
    logger.error('Failed to read plugins directory', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Load a single plugin from file
 * @param filePath - Absolute path to the plugin file
 * @returns Plugin instance or null if loading failed
 */
async function loadPlugin(filePath: string): Promise<Plugin | null> {
  try {
    // Convert to file URL for ESM import
    const fileUrl = pathToFileURL(filePath).href;
    const module = await import(fileUrl) as { default?: unknown };

    if (!module.default) {
      logger.warn('Plugin has no default export', { file: filePath });
      return null;
    }

    if (!isValidPlugin(module.default)) {
      logger.warn('Plugin has invalid structure', { file: filePath });
      return null;
    }

    return module.default;
  } catch (error) {
    logger.error('Failed to load plugin', {
      file: filePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Register all discovered plugins with the Bolt app
 *
 * Uses atomic loading: a plugin either loads completely or not at all.
 * If any step fails (validation, init, command registration), the
 * plugin is not added to the registry.
 *
 * @param app - Slack Bolt app instance
 */
export async function registerPlugins(app: App): Promise<void> {
  const pluginFiles = await discoverPlugins();

  if (pluginFiles.length === 0) {
    logger.debug('No plugins to register');
    return;
  }

  logger.info('Loading plugins', { count: pluginFiles.length });

  for (const filePath of pluginFiles) {
    const plugin = await loadPlugin(filePath);

    if (!plugin) {
      continue;
    }

    try {
      // SECURITY: Validate tools before any initialization
      if (plugin.tools && plugin.tools.length > 0) {
        const toolValidation = validatePluginTools(plugin.tools, plugin.name);

        // Log warnings but continue
        for (const warning of toolValidation.warnings) {
          logger.warn('Plugin tool warning', { plugin: plugin.name, warning });
        }

        // Errors are blocking
        if (!toolValidation.valid) {
          logger.error('Plugin has invalid tools', {
            name: plugin.name,
            errors: toolValidation.errors,
          });
          continue; // Skip this plugin entirely
        }
      }

      // Run init hook with timeout
      if (plugin.init) {
        await withTimeout(
          plugin.init(),
          INIT_TIMEOUT_MS,
          `Plugin "${plugin.name}" init()`
        );
      }

      // Create constrained PluginApp wrapper for command registration
      const pluginApp = createPluginApp(app, plugin.name);

      // Register commands with constrained wrapper
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      if (plugin.registerCommands) {
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        await plugin.registerCommands(pluginApp);
      }

      // Tag tools with plugin name for namespacing
      const taggedTools: PluginToolDefinition[] = (plugin.tools ?? []).map((tool) => ({
        ...tool,
        _pluginName: plugin.name,
      }));

      // Atomic: Only add to registry after all steps succeed
      loadedPlugins.push({
        ...plugin,
        taggedTools,
      });

      logger.info('Plugin loaded successfully', {
        name: plugin.name,
        version: plugin.version,
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        hasCommands: !!plugin.registerCommands,
        toolCount: taggedTools.length,
      });
    } catch (error) {
      logger.error('Failed to initialize plugin', {
        name: plugin.name,
        error: error instanceof Error ? error.message : String(error),
      });
      // Plugin not added to registry (atomic loading)
    }
  }

  logger.info('Plugin registration complete', { loaded: loadedPlugins.length });
}

/**
 * Get all tools from loaded plugins
 * Returns tools with _pluginName tagged for namespacing
 * @returns Array of tool definitions from all plugins
 */
export function getPluginTools(): PluginToolDefinition[] {
  return loadedPlugins.flatMap((plugin) => plugin.taggedTools ?? []);
}

/**
 * Cleanup all loaded plugins on shutdown
 * Uses timeout to prevent hanging on misbehaving plugins
 */
export async function destroyPlugins(): Promise<void> {
  logger.debug('Cleaning up plugins', { count: loadedPlugins.length });

  for (const plugin of loadedPlugins) {
    if (plugin.destroy) {
      try {
        await withTimeout(
          plugin.destroy(),
          DESTROY_TIMEOUT_MS,
          `Plugin "${plugin.name}" destroy()`
        );
        logger.debug('Plugin destroyed', { name: plugin.name });
      } catch (error) {
        logger.error('Failed to destroy plugin', {
          name: plugin.name,
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue destroying other plugins even if one fails
      }
    }
  }

  // Clear the registries
  loadedPlugins.length = 0;
  clearRegisteredCommands();
}

/**
 * Get list of loaded plugin names (for debugging/info)
 */
export function getLoadedPlugins(): string[] {
  return loadedPlugins.map((plugin) => `${plugin.name}@${plugin.version}`);
}

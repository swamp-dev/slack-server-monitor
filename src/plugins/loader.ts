import { readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { createJiti } from 'jiti';
import type { App } from '@slack/bolt';
import type { Plugin, PluginToolDefinition, PluginContext, PluginClaude, PluginHelpEntry, DashboardWidget } from './types.js';
import { isValidPlugin } from './types.js';
import { createPluginApp, clearRegisteredCommands } from './plugin-app.js';
import { validatePluginTools } from '../services/tools/validation.js';
import { getPluginDatabase, closePluginDatabases, removePluginDatabase } from '../services/plugin-database.js';
import { createPluginClaude, createDisabledPluginClaude } from '../services/plugin-claude.js';
import { getProvider, type ProviderConfig } from '../services/providers/index.js';
import { getNotificationStore } from '../services/notification-store.js';
import { createPluginRouter, clearPluginRoutes } from '../web/plugin-router.js';
import { getSharedSSEManager } from '../web/sse.js';
import type { PluginSSE } from './types.js';
import { logger } from '../utils/logger.js';

import type { Config } from '../config/schema.js';

// Lazy-loaded to avoid config validation issues in tests
interface ConfigModule {
  config: Config;
}
interface AskModule {
  checkAndRecordClaudeRequest: (userId: string) => boolean;
}

let configModule: ConfigModule | null = null;
let askModule: AskModule | null = null;

async function getConfig() {
  configModule ??= await import('../config/index.js');
  return configModule.config;
}

async function getCheckAndRecordClaudeRequest() {
  askModule ??= await import('../commands/ask.js');
  return askModule.checkAndRecordClaudeRequest;
}

/**
 * Create a jiti instance for dynamic TypeScript imports
 * This allows plugins to be written in TypeScript without pre-compilation
 */
const jiti = createJiti(import.meta.url, {
  // Use native ESM when possible
  interopDefault: true,
});

/**
 * Lifecycle timeouts (in milliseconds)
 */
const INIT_TIMEOUT_MS = 10_000;   // 10 seconds for init()
const DESTROY_TIMEOUT_MS = 5_000; // 5 seconds for destroy()

/**
 * Directories scanned for plugins at startup.
 *
 * - `plugins.example/` ships with the repo and contains "default-feature"
 *   plugins (e.g. agentbox). These load by default on every fresh clone.
 * - `plugins.local/` is gitignored and contains local-only customizations
 *   or overrides. A plugin file with the same basename as one in
 *   `plugins.example/` replaces it, so users can patch a bundled plugin
 *   without forking the repo.
 */
const PLUGINS_DIR = resolve(process.cwd(), 'plugins.local');
const BUNDLED_PLUGINS_DIR = resolve(process.cwd(), 'plugins.example');

/**
 * Loaded plugins registry (with tagged tools and context)
 */
interface LoadedPlugin extends Plugin {
  /** Tools with _pluginName tagged for namespacing */
  taggedTools?: PluginToolDefinition[];
  /** Plugin context for destroy() hook */
  _context?: PluginContext;
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
 * Discover plugin files in a single directory (default `plugins.local/`).
 * Used by callers that want to inspect just one source — e.g. the
 * screenshot harness scans only `plugins.example/`.
 *
 * For production startup, prefer `discoverAllPlugins()` which merges
 * bundled and local with the local-overrides-bundled rule.
 *
 * @returns Array of absolute file paths
 */
export async function discoverPlugins(dir?: string): Promise<string[]> {
  const pluginsDir = dir ?? PLUGINS_DIR;
  if (!existsSync(pluginsDir)) {
    logger.debug('No plugins directory found, skipping plugin discovery', { dir: pluginsDir });
    return [];
  }

  try {
    const entries = await readdir(pluginsDir, { withFileTypes: true });
    const pluginFiles = entries
      .filter((entry) => entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js')) && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.test.js'))
      .map((entry) => join(pluginsDir, entry.name));

    logger.debug('Discovered plugin files', { dir: pluginsDir, count: pluginFiles.length, files: pluginFiles });
    return pluginFiles;
  } catch (error) {
    logger.error('Failed to read plugins directory', {
      dir: pluginsDir,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Discover plugins across both bundled and local dirs, with local
 * filenames overriding bundled ones (so a user can patch a default
 * plugin without forking the repo).
 *
 * Conflict resolution is by basename — `plugins.local/agentbox.ts`
 * replaces `plugins.example/agentbox.ts` regardless of subdirectories.
 */
export async function discoverAllPlugins(): Promise<string[]> {
  const [bundled, local] = await Promise.all([
    discoverPlugins(BUNDLED_PLUGINS_DIR),
    discoverPlugins(PLUGINS_DIR),
  ]);

  const merged = new Map<string, string>();
  for (const file of bundled) merged.set(basenameOf(file), file);
  // local entries written second so they replace bundled on collision
  for (const file of local) merged.set(basenameOf(file), file);

  return Array.from(merged.values());
}

function basenameOf(filePath: string): string {
  const lastSlash = filePath.lastIndexOf('/');
  return lastSlash === -1 ? filePath : filePath.slice(lastSlash + 1);
}

/**
 * Load a single plugin from file
 * @param filePath - Absolute path to the plugin file
 * @returns Plugin instance or null if loading failed
 */
async function loadPlugin(filePath: string): Promise<Plugin | null> {
  try {
    let module: { default?: unknown };

    // Use jiti for TypeScript files to handle dynamic imports properly
    // This allows plugins to be written in TypeScript without pre-compilation
    if (filePath.endsWith('.ts')) {
      // jiti.import with { default: true } returns the default export directly,
      // so we wrap it to match the expected { default: ... } structure
      const imported = await jiti.import(filePath, { default: true });
      module = { default: imported };
    } else {
      // For JavaScript files, use native ESM import
      const fileUrl = pathToFileURL(filePath).href;
      module = await import(fileUrl) as { default?: unknown };
    }

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
export async function registerPlugins(app: App, pluginsDir?: string): Promise<void> {
  // When a specific directory is passed (e.g. by tests), scan only that.
  // Otherwise scan both bundled and local with the override rule.
  const pluginFiles = pluginsDir
    ? await discoverPlugins(pluginsDir)
    : await discoverAllPlugins();

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

      // Create plugin context with scoped database accessor
      const pluginDb = getPluginDatabase(plugin.name);

      // Create PluginClaude if Claude is enabled
      const config = await getConfig();
      let pluginClaude: PluginClaude | undefined;
      if (config.claude) {
        const providerConfig: ProviderConfig = {
          provider: config.claude.provider,
          apiKey: config.claude.apiKey,
          cliPath: config.claude.cliPath,
          cliModel: config.claude.cliModel,
          sdkModel: config.claude.sdkModel,
          maxTokens: config.claude.maxTokens,
          maxToolCalls: config.claude.maxToolCalls,
          maxIterations: config.claude.maxIterations,
          cliTimeoutMs: config.claude.cliTimeoutMs,
          contextWindowTokens: config.claude.contextWindowTokens,
          contextTruncationThreshold: config.claude.contextTruncationThreshold,
          contextWarningThreshold: config.claude.contextWarningThreshold,
        };
        const provider = getProvider(providerConfig);
        const checkAndRecordClaudeRequest = await getCheckAndRecordClaudeRequest();

        // Create namespaced tools for this plugin
        const namespacedTools = (plugin.tools ?? []).map((tool) => ({
          ...tool,
          spec: {
            ...tool.spec,
            name: `${plugin.name}:${tool.spec.name}`,
          },
        }));

        pluginClaude = createPluginClaude({
          provider,
          pluginName: plugin.name,
          pluginTools: namespacedTools,
          checkRateLimit: checkAndRecordClaudeRequest,
          toolConfig: {
            allowedDirs: config.claude.allowedDirs,
            maxFileSizeKb: config.claude.maxFileSizeKb,
            maxLogLines: config.claude.maxLogLines,
            githubRepo: config.claude.githubRepo,
            githubDefaultLabels: config.claude.githubDefaultLabels,
          },
        });
      } else {
        pluginClaude = createDisabledPluginClaude();
      }

      const notifStore = getNotificationStore(config.claude?.dbPath ?? './data/claude.db');

      // Create scoped SSE channel for this plugin.
      // Always create the wrapper — closures check the shared manager at call time,
      // so SSE works regardless of startup order (web server vs plugin loader).
      const sseChannel = `plugin:${plugin.name}`;
      const pluginSSE: PluginSSE = {
        broadcast: (event, data) => { getSharedSSEManager()?.broadcast(sseChannel, event, data); },
        clientCount: () => getSharedSSEManager()?.clientCount(sseChannel) ?? 0,
      };

      const ctx: PluginContext = {
        db: pluginDb,
        name: plugin.name,
        version: plugin.version,
        claude: pluginClaude,
        notify: (title, opts) => {
          try {
            notifStore.createNotification(
              plugin.name,
              opts?.level ?? 'info',
              title,
              opts?.body,
              opts?.link,
            );
          } catch (error) {
            logger.error('Plugin notification failed', {
              plugin: plugin.name,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        },
        sse: pluginSSE,  // Always present — no-ops silently when web server disabled
      };

      // Run init hook with timeout
      if (plugin.init) {
        await withTimeout(
          plugin.init(ctx),
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

      // Register web routes if plugin provides them
      if (plugin.registerWebRoutes) {
        try {
          const pages = plugin.webPages ?? plugin.screenshotPages ?? [];
          const pluginRouter = createPluginRouter(plugin.name, ctx, plugin.webNavEntry ? { ...plugin.webNavEntry, pages } : undefined, plugin.public ?? false);
          plugin.registerWebRoutes(pluginRouter);
        } catch (routeError) {
          logger.error('Plugin web route registration failed', {
            name: plugin.name,
            error: routeError instanceof Error ? routeError.message : String(routeError),
          });
          // Continue loading — web routes are optional
        }
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
        _context: ctx,
      });

      logger.info('Plugin loaded successfully', {
        name: plugin.name,
        version: plugin.version,
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        hasCommands: !!plugin.registerCommands,
        toolCount: taggedTools.length,
      });
    } catch (error) {
      // Clean up database accessor to prevent memory leak
      removePluginDatabase(plugin.name);

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
    if (plugin.destroy && plugin._context) {
      try {
        await withTimeout(
          plugin.destroy(plugin._context),
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
  clearPluginRoutes();

  // Close all plugin database connections
  closePluginDatabases();
}

/**
 * Get list of loaded plugin names (for debugging/info)
 */
export function getLoadedPlugins(): string[] {
  return loadedPlugins.map((plugin) => `${plugin.name}@${plugin.version}`);
}

/**
 * Structured help data exposed by a loaded plugin
 */
export interface PluginHelpData {
  name: string;
  description?: string;
  helpEntries?: PluginHelpEntry[];
}

/**
 * Get help metadata from all loaded plugins
 * Used by /help to render plugin documentation
 */
export function getPluginHelpData(): PluginHelpData[] {
  return loadedPlugins.map((p) => ({
    name: p.name,
    description: p.description,
    helpEntries: p.helpEntries,
  }));
}

/**
 * Collect dashboard widgets from all loaded plugins
 *
 * Calls getWidgets() on each plugin that implements it.
 * Errors are caught per-plugin so one failing plugin does not
 * break the dashboard.
 *
 * @returns Flat array of widgets sorted by priority (lower first)
 */
export function getPluginWidgets(publicOnly = false): DashboardWidget[] {
  const widgets: DashboardWidget[] = [];

  for (const plugin of loadedPlugins) {
    if (!plugin.getWidgets) continue;
    if (publicOnly && !plugin.public) continue;

    try {
      const start = Date.now();
      const pluginWidgets = plugin.getWidgets();
      const elapsed = Date.now() - start;
      if (elapsed > 100) {
        logger.warn('Slow plugin widget load', { name: plugin.name, durationMs: elapsed });
      }
      if (Array.isArray(pluginWidgets)) {
        widgets.push(...pluginWidgets);
      }
    } catch (error) {
      logger.error('Failed to get widgets from plugin', {
        name: plugin.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return widgets.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
}

import type { App } from '@slack/bolt';
import type { ToolDefinition } from '../services/tools/types.js';
import type { PluginApp } from './plugin-app.js';
import type { PluginDatabase } from '../services/plugin-database.js';

/**
 * Context provided to plugins during lifecycle hooks
 *
 * Contains resources the plugin can use, including a scoped database accessor.
 * The database accessor is pre-configured to only allow access to tables
 * prefixed with "plugin_{name}_".
 */
export interface PluginContext {
  /** Scoped database accessor for persistent storage */
  db: PluginDatabase;
  /** Plugin's unique name */
  name: string;
  /** Plugin's version string */
  version: string;
}

/**
 * Plugin interface for extending the Slack Server Monitor
 *
 * SECURITY WARNING: Plugins run with full process privileges.
 * Only install plugins from trusted sources. Plugins can:
 * - Access all environment variables
 * - Execute arbitrary code
 * - Make network requests
 *
 * The PluginApp wrapper provides defense-in-depth, not true sandboxing.
 *
 * Plugins can:
 * - Register custom slash commands
 * - Provide Claude AI tools (namespaced as pluginname:toolname)
 * - Run async initialization/cleanup (with timeouts)
 */
export interface Plugin {
  /** Unique identifier for the plugin */
  name: string;

  /** Semver version string */
  version: string;

  /** Optional description for help text */
  description?: string;

  /**
   * Register slash commands with the Bolt app
   * Called during app startup after built-in commands
   *
   * Receives PluginApp (constrained wrapper) instead of raw App
   * for validation and logging.
   *
   * @deprecated Use PluginApp signature for better type safety
   */
  registerCommands?: (app: App | PluginApp) => void | Promise<void>;

  /**
   * Claude AI tool definitions
   * Tools are namespaced as "pluginname:toolname" to prevent collision
   * with built-in tools.
   */
  tools?: ToolDefinition[];

  /**
   * Async initialization hook
   * Called before registerCommands
   *
   * Receives PluginContext with:
   * - db: Scoped database accessor for persistent storage
   * - name: Plugin's unique name
   * - version: Plugin's version string
   *
   * TIMEOUT: Must complete within 10 seconds or plugin loading fails.
   */
  init?: (ctx: PluginContext) => Promise<void>;

  /**
   * Cleanup hook called on app shutdown
   *
   * Receives the same PluginContext as init().
   *
   * TIMEOUT: Must complete within 5 seconds.
   */
  destroy?: (ctx: PluginContext) => Promise<void>;
}

/**
 * Internal: ToolDefinition with plugin ownership info
 * Used for namespacing plugin tools
 */
export interface PluginToolDefinition extends ToolDefinition {
  /** Internal: Name of the plugin that owns this tool */
  _pluginName?: string;
}

// Re-export PluginApp for plugin authors
export type { PluginApp } from './plugin-app.js';

/**
 * Type guard to validate plugin structure at runtime
 */
export function isValidPlugin(obj: unknown): obj is Plugin {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const plugin = obj as Record<string, unknown>;

  // Required fields
  if (typeof plugin.name !== 'string' || plugin.name.trim() === '') {
    return false;
  }

  if (typeof plugin.version !== 'string' || plugin.version.trim() === '') {
    return false;
  }

  // Optional fields with type validation
  if (plugin.description !== undefined && typeof plugin.description !== 'string') {
    return false;
  }

  if (plugin.registerCommands !== undefined && typeof plugin.registerCommands !== 'function') {
    return false;
  }

  if (plugin.tools !== undefined && !Array.isArray(plugin.tools)) {
    return false;
  }

  if (plugin.init !== undefined && typeof plugin.init !== 'function') {
    return false;
  }

  if (plugin.destroy !== undefined && typeof plugin.destroy !== 'function') {
    return false;
  }

  return true;
}

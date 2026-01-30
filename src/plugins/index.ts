/**
 * Plugin System
 *
 * Allows extending the Slack Server Monitor with custom slash commands
 * and Claude AI tools.
 *
 * Plugins are placed in `plugins.local/` (gitignored) and auto-discovered.
 *
 * Example plugin:
 * ```typescript
 * import type { Plugin } from '../src/plugins/index.js';
 *
 * const myPlugin: Plugin = {
 *   name: 'my-plugin',
 *   version: '1.0.0',
 *   registerCommands(app) {
 *     app.command('/mycommand', async ({ ack, respond }) => {
 *       await ack();
 *       await respond('Hello from my plugin!');
 *     });
 *   },
 * };
 *
 * export default myPlugin;
 * ```
 */

// Types for plugin authors
export type { Plugin, PluginApp } from './types.js';
export { isValidPlugin } from './types.js';

// Loader functions for internal use
export { registerPlugins, getPluginTools, destroyPlugins, getLoadedPlugins } from './loader.js';

// Plugin app wrapper (for advanced plugin authors)
export { createPluginApp, clearRegisteredCommands, getRegisteredCommands } from './plugin-app.js';

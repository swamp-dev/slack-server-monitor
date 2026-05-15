/**
 * PluginApp - Constrained wrapper around Slack Bolt App
 *
 * Provides a limited subset of App functionality to plugins:
 * - Command registration with validation
 * - Logging of all plugin commands
 * - Protection against duplicate commands
 *
 * SECURITY: Plugins run with full process privileges.
 * This wrapper provides defense-in-depth, not true sandboxing.
 */

import type { App, SlackCommandMiddlewareArgs, AllMiddlewareArgs } from '@slack/bolt';
import { logger } from '../utils/logger.js';

/**
 * Command handler type (matches Bolt's command handler signature)
 */
type CommandHandler = (
  args: SlackCommandMiddlewareArgs & AllMiddlewareArgs
) => Promise<void>;

/**
 * Constrained App interface for plugins
 *
 * Plugins receive this instead of the full App to:
 * - Limit what plugins can register
 * - Add validation and logging
 * - Track which commands belong to which plugin
 */
export interface PluginApp {
  /** Name of the owning plugin (for logging) */
  readonly pluginName: string;

  /**
   * Register a slash command
   * @param name - Command name including leading slash (e.g., '/mycommand')
   * @param handler - Async handler function
   */
  command(name: string, handler: CommandHandler): void;
}

/**
 * Validate command name format
 */
function isValidCommandName(name: string): boolean {
  // Must start with / and contain only lowercase letters, numbers, hyphens
  return /^\/[a-z][a-z0-9-]{0,20}$/.test(name);
}

/**
 * Set of registered command names (prevents duplicates across plugins)
 */
const registeredCommands = new Set<string>();

/**
 * Clear registered commands (for testing)
 */
export function clearRegisteredCommands(): void {
  registeredCommands.clear();
}

/**
 * Get list of registered plugin commands (for debugging)
 */
export function getRegisteredCommands(): string[] {
  return Array.from(registeredCommands);
}

/**
 * Create a constrained PluginApp wrapper around the real Bolt App
 *
 * @param app - The real Slack Bolt App instance
 * @param pluginName - Name of the plugin (for logging and namespacing)
 * @returns PluginApp interface for the plugin to use
 */
export function createPluginApp(app: App, pluginName: string): PluginApp {
  return {
    pluginName,

    command(name: string, handler: CommandHandler): void {
      // Validate command name format
      if (!isValidCommandName(name)) {
        logger.error('Plugin registered invalid command name', {
          plugin: pluginName,
          command: name,
          reason: 'Must start with /, contain only lowercase letters, numbers, hyphens, max 21 chars',
        });
        throw new Error(
          `Invalid command name "${name}": must start with /, contain only lowercase letters, numbers, hyphens, max 21 chars`
        );
      }

      // Check for duplicate registration
      if (registeredCommands.has(name)) {
        logger.error('Plugin attempted to register duplicate command', {
          plugin: pluginName,
          command: name,
        });
        throw new Error(`Command "${name}" is already registered`);
      }

      // Log command registration
      logger.debug('Plugin registering command', {
        plugin: pluginName,
        command: name,
      });

      // Wrap handler with logging
      const wrappedHandler: CommandHandler = async (args) => {
        const { command } = args;
        logger.info('Plugin command invoked', {
          plugin: pluginName,
          command: name,
          user: command.user_id,
          channel: command.channel_id,
        });

        try {
          await handler(args);
        } catch (error) {
          logger.error('Plugin command error', {
            plugin: pluginName,
            command: name,
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      };

      // Register with real app
      app.command(name, wrappedHandler);
      registeredCommands.add(name);
    },
  };
}

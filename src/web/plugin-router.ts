/**
 * Plugin web route registration
 *
 * Provides a constrained Express Router that plugins use to register
 * web pages. Routes are mounted under /p/{pluginName}/.
 */

import { Router, type Request, type Response } from 'express';

/**
 * Route handler type for plugin routes
 */
export type PluginRouteHandler = (req: Request, res: Response) => void | Promise<void>;

/**
 * Constrained router interface exposed to plugins.
 * Only allows GET and POST — no middleware, no use(), no delete.
 */
export interface PluginRouter {
  readonly pluginName: string;
  get(path: string, handler: PluginRouteHandler): void;
  post(path: string, handler: PluginRouteHandler): void;
  /** Internal: the underlying Express Router for mounting */
  readonly expressRouter: Router;
}

/**
 * Navigation entry for a plugin's web pages
 */
export interface PluginNavEntry {
  label: string;
  path: string;
  icon?: string;
}

// Collected nav entries from all loaded plugins
const navEntries: PluginNavEntry[] = [];

/**
 * Create a constrained router for a plugin.
 *
 * @param pluginName - The plugin's unique name (used for URL prefix)
 * @param navEntry - Optional navigation entry for the shell nav bar
 */
export function createPluginRouter(
  pluginName: string,
  navEntry?: { label: string; icon?: string },
): { router: PluginRouter } {
  const expressRouter = Router();

  if (navEntry) {
    navEntries.push({
      label: navEntry.label,
      path: `/p/${pluginName}`,
      icon: navEntry.icon,
    });
  }

  const router: PluginRouter = {
    pluginName,
    expressRouter,
    get(path: string, handler: PluginRouteHandler) {
      expressRouter.get(path, handler);
    },
    post(path: string, handler: PluginRouteHandler) {
      expressRouter.post(path, handler);
    },
  };

  return { router };
}

/**
 * Get all registered plugin nav entries.
 */
export function getPluginNavEntries(): PluginNavEntry[] {
  return [...navEntries];
}

/**
 * Clear all nav entries (used in tests and on shutdown).
 */
export function clearPluginNavEntries(): void {
  navEntries.length = 0;
}

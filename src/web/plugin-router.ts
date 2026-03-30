/**
 * Plugin web route registration
 *
 * Creates constrained Express routers for plugins, scoped to /p/{pluginName}/.
 * Mirrors the PluginApp pattern for slash commands.
 */

import { Router, type Request, type Response } from 'express';
import type { PluginContext } from '../plugins/types.js';
import { logger } from '../utils/logger.js';

/**
 * Handler function for plugin web routes.
 * Receives the Express req/res plus the plugin's context.
 */
export type PluginRouteHandler = (
  req: Request,
  res: Response,
  ctx: PluginContext,
) => void | Promise<void>;

/**
 * Constrained router for plugin web routes.
 * All paths are relative to /p/{pluginName}/.
 */
export interface PluginRouter {
  readonly pluginName: string;
  get(path: string, handler: PluginRouteHandler): void;
  post(path: string, handler: PluginRouteHandler): void;
}

/**
 * Nav entry for a plugin
 */
export interface PluginNavEntry {
  pluginName: string;
  label: string;
  icon?: string;
}

/**
 * Web nav entry options passed when creating a router
 */
export interface WebNavEntryOptions {
  label: string;
  icon?: string;
}

// Shared Express router for all plugin routes
let sharedRouter: ReturnType<typeof Router> | null = null;
const navEntries: PluginNavEntry[] = [];

/**
 * Validate a route path — reject traversal attempts
 */
function validatePath(path: string): void {
  const decoded = decodeURIComponent(path);
  if (decoded.includes('..')) {
    throw new Error(`Invalid plugin route path: "${path}" — path traversal not allowed`);
  }
}

/**
 * Get or create the shared Express router for all plugin routes
 */
function getOrCreateRouter(): ReturnType<typeof Router> {
  sharedRouter ??= Router();
  return sharedRouter;
}

/**
 * Create a PluginRouter for a specific plugin.
 * Routes are mounted at /p/{pluginName}/ on the shared router.
 */
export function createPluginRouter(
  pluginName: string,
  ctx: PluginContext,
  navEntry?: WebNavEntryOptions,
): PluginRouter {
  const router = getOrCreateRouter();

  if (navEntry) {
    navEntries.push({
      pluginName,
      label: navEntry.label,
      icon: navEntry.icon,
    });
  }

  /**
   * Wrap a plugin handler with error handling and context injection
   */
  function wrapHandler(handler: PluginRouteHandler) {
    return (req: Request, res: Response, _next: () => void) => {
      try {
        const result = handler(req, res, ctx);
        // Handle async handlers
        if (result instanceof Promise) {
          result.catch((error: unknown) => {
            logger.error('Plugin route error', {
              plugin: pluginName,
              path: req.path,
              error: error instanceof Error ? error.message : String(error),
            });
            if (!res.headersSent) {
              res.status(500).send('Internal plugin error');
            }
          });
        }
      } catch (error) {
        logger.error('Plugin route error', {
          plugin: pluginName,
          path: req.path,
          error: error instanceof Error ? error.message : String(error),
        });
        if (!res.headersSent) {
          res.status(500).send('Internal plugin error');
        }
      }
    };
  }

  return {
    pluginName,
    get(path: string, handler: PluginRouteHandler): void {
      validatePath(path);
      const fullPath = `/${pluginName}${path.startsWith('/') ? path : `/${path}`}`;
      router.get(fullPath, wrapHandler(handler));
      logger.debug('Plugin web route registered', { plugin: pluginName, method: 'GET', path: fullPath });
    },
    post(path: string, handler: PluginRouteHandler): void {
      validatePath(path);
      const fullPath = `/${pluginName}${path.startsWith('/') ? path : `/${path}`}`;
      router.post(fullPath, wrapHandler(handler));
      logger.debug('Plugin web route registered', { plugin: pluginName, method: 'POST', path: fullPath });
    },
  };
}

/**
 * Get the shared Express router with all plugin routes mounted.
 * Returns the router to be mounted at /p/ in the main app.
 */
export function getPluginExpressRouter(): ReturnType<typeof Router> {
  return getOrCreateRouter();
}

/**
 * Get nav entries from all plugins that registered web routes
 */
export function getPluginNavEntries(): PluginNavEntry[] {
  return [...navEntries];
}

/**
 * Clear all plugin routes and nav entries (for testing/shutdown)
 */
export function clearPluginRoutes(): void {
  sharedRouter = null;
  navEntries.length = 0;
}

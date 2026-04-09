/**
 * Plugin web route registration
 *
 * Creates constrained Express routers for plugins, scoped to /p/{pluginName}/.
 * Mirrors the PluginApp pattern for slash commands.
 */

import { Router, type Request, type Response } from 'express';
import type { PluginContext } from '../plugins/types.js';
import { getSharedSSEManager } from './sse.js';
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
  pages?: { name: string; path: string }[];
  public?: boolean;
}

/**
 * Web nav entry options passed when creating a router
 */
export interface WebNavEntryOptions {
  label: string;
  icon?: string;
  pages?: { name: string; path: string }[];
}

// Shared Express router for all plugin routes
let sharedRouter: ReturnType<typeof Router> | null = null;
const navEntries: PluginNavEntry[] = [];
const registeredStreamPlugins = new Set<string>();
const publicPlugins = new Set<string>();

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
  isPublic?: boolean,
): PluginRouter {
  const router = getOrCreateRouter();

  if (isPublic) {
    publicPlugins.add(pluginName);
  }

  if (navEntry) {
    navEntries.push({
      pluginName,
      label: navEntry.label,
      icon: navEntry.icon,
      pages: navEntry.pages ?? [],
      public: isPublic ?? false,
    });
  }

  // Auto-mount SSE stream endpoint for this plugin (guard against duplicate registration)
  if (!registeredStreamPlugins.has(pluginName)) {
    registeredStreamPlugins.add(pluginName);
    const streamPath = `/${pluginName}/stream`;
    router.get(streamPath, (_req: Request, res: Response) => {
      try {
        const manager = getSharedSSEManager();
        if (!manager) {
          res.status(503).json({ error: 'SSE not available' });
          return;
        }
        manager.addClient(`plugin:${pluginName}`, res);
      } catch (err) {
        logger.error('Plugin SSE stream error', { plugin: pluginName, error: err instanceof Error ? err.message : String(err) });
        if (!res.headersSent) {
          res.status(500).send('SSE error');
        }
      }
    });
    logger.debug('Plugin SSE stream registered', { plugin: pluginName, path: streamPath });
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
 * Check if a plugin is marked as public (no auth required)
 */
export function isPluginPublic(pluginName: string): boolean {
  return publicPlugins.has(pluginName);
}

/**
 * Clear all plugin routes and nav entries (for testing/shutdown)
 */
export function clearPluginRoutes(): void {
  sharedRouter = null;
  navEntries.length = 0;
  registeredStreamPlugins.clear();
  publicPlugins.clear();
}

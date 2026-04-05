/**
 * Standalone screenshot server.
 *
 * Minimal Express app serving real templates with seed data.
 * No auth, no Slack connection — just the web UI for screenshots.
 * Discovers plugins from plugins.example/ and loads their screenshot hooks.
 *
 * Usage:
 *   npx tsx scripts/screenshot-server.ts          # start on port 18970
 *   SCREENSHOT_PORT=3333 npx tsx scripts/...      # custom port
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import type { Server } from 'http';
import type { Plugin, PluginContext } from '../src/plugins/index.js';
import { discoverPlugins } from '../src/plugins/loader.js';
import { isValidPlugin } from '../src/plugins/types.js';
import { createPluginRouter, getPluginExpressRouter, clearPluginRoutes } from '../src/web/plugin-router.js';
import { PluginDatabase } from '../src/services/plugin-database.js';
import { getStaticCss } from '../src/web/templates/styles.js';
import {
  renderDashboard,
  renderSessionList,
  renderConversation,
  renderNotificationPage,
  renderLogin,
  render404,
} from '../src/web/templates/index.js';
import {
  seedStats,
  seedRecent,
  seedFavorites,
  seedFavCount,
  seedAllTags,
  seedQuickLinks,
  seedWidgets,
  seedHealth,
  seedSessions,
  seedPagination,
  seedMessages,
  seedToolCalls,
  seedConversationMeta,
  seedNotifications,
  emptyStats,
  degradedHealth,
  archivedSessions,
  branchedConversationMeta,
} from './screenshot-fixtures.js';

const PORT = parseInt(process.env.SCREENSHOT_PORT ?? '', 10) || 18970;
const ROOT_DIR = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PLUGINS_EXAMPLE_DIR = path.join(ROOT_DIR, 'plugins.example');

let server: Server | null = null;

/** Plugin pages discovered during startup, exported for the harness. */
export let pluginPages: Array<{ pluginName: string; name: string; path: string }> = [];

/** Track initialized plugins for cleanup. */
const initializedPlugins: Array<{ plugin: Plugin; ctx: PluginContext }> = [];

/**
 * Load a single plugin file using jiti (same approach as loader.ts).
 */
async function loadPluginFile(filePath: string): Promise<Plugin | null> {
  try {
    const { createJiti } = await import('jiti');
    const jiti = createJiti(import.meta.url, { interopDefault: true });
    const imported = await jiti.import(filePath, { default: true });
    const module = { default: imported };
    if (!module.default || !isValidPlugin(module.default)) return null;
    return module.default;
  } catch (err) {
    console.warn(`[screenshot] Failed to load plugin ${filePath}:`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * Create a minimal PluginContext for screenshot mode.
 * No Slack, no Claude — just a database and no-op stubs.
 */
function createMockContext(plugin: Plugin): PluginContext {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  const pluginDb = new PluginDatabase(db, plugin.name);

  return {
    db: pluginDb,
    name: plugin.name,
    version: plugin.version,
    notify: () => {},
    sse: { broadcast: () => {}, clientCount: () => 0 },
  };
}

/**
 * Discover and initialize plugins that have screenshot support.
 */
async function loadScreenshotPlugins(app: ReturnType<typeof express>): Promise<void> {
  const files = await discoverPlugins(PLUGINS_EXAMPLE_DIR);
  const pages: typeof pluginPages = [];

  for (const filePath of files) {
    const plugin = await loadPluginFile(filePath);
    if (!plugin) continue;
    if (!plugin.screenshotPages?.length) continue;

    const ctx = createMockContext(plugin);

    // Run screenshot setup (populate caches, seed DB, etc.)
    if (plugin.screenshotSetup) {
      await plugin.screenshotSetup(ctx);
    }

    // Run init if present (may set up state needed by routes)
    if (plugin.init) {
      try {
        await plugin.init(ctx);
      } catch (err) {
        console.warn(`[screenshot] Plugin "${plugin.name}" init failed:`, err instanceof Error ? err.message : String(err));
      }
    }

    initializedPlugins.push({ plugin, ctx });

    // Register web routes
    if (plugin.registerWebRoutes) {
      const router = createPluginRouter(plugin.name, ctx, plugin.webNavEntry);
      plugin.registerWebRoutes(router);
    }

    // Collect screenshot pages
    for (const page of plugin.screenshotPages) {
      pages.push({ pluginName: plugin.name, name: page.name, path: page.path });
    }
  }

  // Mount the shared plugin router at /p/
  if (pages.length > 0) {
    app.use('/p', getPluginExpressRouter());
  }

  pluginPages = pages;
}

export async function startScreenshotServer(): Promise<number> {
  clearPluginRoutes();
  pluginPages = [];

  return new Promise((resolve, reject) => {
    const app = express();

    // Static CSS (needed for the shell's <link> tag)
    app.get('/static/styles.css', (_req, res) => {
      res.type('text/css').send(getStaticCss());
    });

    // Dashboard — variants: empty, degraded
    app.get('/', (req, res) => {
      const variant = req.query.variant as string | undefined;
      let html: string;
      if (variant === 'empty') {
        html = renderDashboard(
          emptyStats, [], [], 0, [], 'admin', [], 0, [], null,
        );
      } else if (variant === 'degraded') {
        html = renderDashboard(
          seedStats, seedRecent, seedFavorites, seedFavCount,
          seedAllTags, 'admin', seedWidgets, 2, seedQuickLinks, degradedHealth,
        );
      } else {
        html = renderDashboard(
          seedStats, seedRecent, seedFavorites, seedFavCount,
          seedAllTags, 'admin', seedWidgets, 2, seedQuickLinks, seedHealth,
        );
      }
      res.type('html').send(html);
    });

    // Session list — variants: empty, search-no-results, favorites, archived
    app.get('/c', (req, res) => {
      const variant = req.query.variant as string | undefined;
      const emptyPagination = { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 };
      let html: string;
      if (variant === 'empty') {
        html = renderSessionList([], emptyPagination, {
          allTags: [],
          currentUserId: 'admin',
        });
      } else if (variant === 'search-no-results') {
        html = renderSessionList([], emptyPagination, {
          allTags: seedAllTags,
          currentUserId: 'admin',
          searchQuery: 'kubernetes cluster migration',
        });
      } else if (variant === 'favorites') {
        html = renderSessionList(seedFavorites, { page: 1, pageSize: 20, totalItems: seedFavorites.length, totalPages: 1 }, {
          allTags: seedAllTags,
          currentUserId: 'admin',
          favorites: true,
        });
      } else if (variant === 'archived') {
        html = renderSessionList(archivedSessions, { page: 1, pageSize: 20, totalItems: archivedSessions.length, totalPages: 1 }, {
          allTags: seedAllTags,
          currentUserId: 'admin',
          archived: true,
        });
      } else {
        html = renderSessionList(seedSessions, seedPagination, {
          allTags: seedAllTags,
          currentUserId: 'admin',
        });
      }
      res.type('html').send(html);
    });

    // Conversation detail — variants: branched
    app.get('/c/:threadTs/:channelId', (req, res) => {
      const variant = req.query.variant as string | undefined;
      const meta = variant === 'branched' ? branchedConversationMeta : seedConversationMeta;
      const html = renderConversation(seedMessages, seedToolCalls, meta);
      res.type('html').send(html);
    });

    // Notifications — variants: empty
    app.get('/notifications', (req, res) => {
      const variant = req.query.variant as string | undefined;
      const html = variant === 'empty'
        ? renderNotificationPage([], 0)
        : renderNotificationPage(seedNotifications, 2);
      res.type('html').send(html);
    });

    // Login — variants: error
    app.get('/login', (req, res) => {
      const variant = req.query.variant as string | undefined;
      const html = variant === 'error'
        ? renderLogin('Invalid access token. Please check your token and try again.')
        : renderLogin();
      res.type('html').send(html);
    });

    // API stubs for client-side JS in the shell
    app.get('/api/notifications', (_req, res) => {
      res.json({ notifications: seedNotifications, unreadCount: 2 });
    });

    app.get('/api/health/server', (_req, res) => {
      res.json(seedHealth);
    });

    app.get('/api/links', (_req, res) => {
      res.json({ links: seedQuickLinks });
    });

    app.get('/api/search', (_req, res) => {
      res.json({ results: [] });
    });

    // Load plugins with screenshot support
    loadScreenshotPlugins(app).then(() => {
      // 404 catch-all (must be registered after plugin routes)
      app.use((_req, res) => {
        res.status(404).type('html').send(render404());
      });

      server = app.listen(PORT, () => {
        resolve(PORT);
      });

      server.on('error', reject);
    }).catch(reject);
  });
}

export async function stopScreenshotServer(): Promise<void> {
  // Destroy plugins to stop intervals (e.g., SSE polling)
  for (const { plugin, ctx } of initializedPlugins) {
    if (plugin.destroy) {
      try {
        await plugin.destroy(ctx);
      } catch {
        // Best-effort cleanup
      }
    }
  }
  initializedPlugins.length = 0;

  return new Promise((resolve) => {
    if (server) {
      const s = server;
      server = null;
      s.close(() => resolve());
    } else {
      resolve();
    }
  });
}

// Run directly
if (process.argv[1]?.endsWith('screenshot-server.ts')) {
  startScreenshotServer().then((port) => {
    console.log(`Screenshot server running on http://localhost:${port}`);
    console.log('Press Ctrl+C to stop');
  });
}

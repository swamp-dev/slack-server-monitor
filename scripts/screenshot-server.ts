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
import { fileURLToPath, pathToFileURL } from 'url';
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
  renderRegister,
  renderAdminUsers,
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
export let pluginPages: Array<{ pluginName: string; name: string; path: string; fullPage?: boolean }> = [];

/** Track initialized plugins for cleanup. */
const initializedPlugins: Array<{ plugin: Plugin; ctx: PluginContext }> = [];

/**
 * Load a single plugin file via native dynamic import().
 *
 * The screenshot server runs under tsx which handles .ts files natively.
 * Using jiti on top of tsx causes two problems:
 * 1. CJS/ESM interop conflicts (e.g. winston.format becomes undefined)
 * 2. Module instance duplication — jiti creates separate module instances
 *    from tsx, so shared state (like the plugin router) diverges
 */
async function loadPluginFile(filePath: string): Promise<Plugin | null> {
  try {
    const fileUrl = pathToFileURL(filePath).href;
    const mod = await import(fileUrl);
    const plugin = mod.default;
    if (!plugin) {
      console.warn(`[screenshot] Plugin ${filePath} has no default export, skipping`);
      return null;
    }
    if (!isValidPlugin(plugin)) return null;
    return plugin;
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
      const webPages = plugin.webPages ?? plugin.screenshotPages ?? [];
      const router = createPluginRouter(plugin.name, ctx, plugin.webNavEntry ? { ...plugin.webNavEntry, pages: webPages } : undefined, plugin.public ?? false);
      plugin.registerWebRoutes(router);
    }

    // Collect screenshot pages
    for (const page of plugin.screenshotPages) {
      pages.push({ pluginName: plugin.name, name: page.name, path: page.path, fullPage: page.fullPage });
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

    // Set a consistent userId for plugin routes (plugins read res.locals.userId)
    app.use((_req, res, next) => {
      res.locals.userId = 'web-user';
      next();
    });

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

    // Admin users page — variants: empty, populated, with-flash
    app.get('/admin/users', (req, res) => {
      const variant = req.query.variant as string | undefined;
      const now = Date.now();
      const sampleUsers = variant === 'empty' ? [] : [
        { id: 1, slackId: 'U01ALICE', username: 'alice', displayName: 'Alice', role: 'admin' as const, isActive: true, createdAt: now - 30 * 86400_000, updatedAt: now },
        { id: 2, slackId: 'U02BOB', username: null, displayName: 'Bob', role: 'user' as const, isActive: true, createdAt: now - 14 * 86400_000, updatedAt: now },
        { id: 3, slackId: null, username: 'carol', displayName: null, role: 'user' as const, isActive: true, createdAt: now - 7 * 86400_000, updatedAt: now },
        { id: 4, slackId: 'U04DAVE', username: null, displayName: null, role: 'user' as const, isActive: false, createdAt: now - 60 * 86400_000, updatedAt: now },
      ];
      const sampleInvites = variant === 'empty' ? [] : [
        { code: 'abc123def456abc123def456abc123de', createdBy: 1, role: 'user' as const, slackUserId: null, createdAt: now, expiresAt: now + 72 * 3600_000, usedAt: null, usedBy: null },
        { code: 'fed654cba321fed654cba321fed654cb', createdBy: 1, role: 'admin' as const, slackUserId: 'U05NEW', createdAt: now, expiresAt: now + 24 * 3600_000, usedAt: null, usedBy: null },
      ];
      const flash = variant === 'with-flash' ? 'Invite created.' : undefined;
      res.type('html').send(renderAdminUsers({
        users: sampleUsers,
        invites: sampleInvites,
        baseUrl: 'http://localhost:8080',
        flash,
      }));
    });

    // Login — variants: error
    app.get('/login', (req, res) => {
      const variant = req.query.variant as string | undefined;
      const showRegister = req.query.register !== 'false';
      const html = variant === 'error'
        ? renderLogin('Invalid credentials.', undefined, showRegister)
        : renderLogin(undefined, undefined, showRegister);
      res.type('html').send(html);
    });

    // Register — variants: error, prefilled
    app.get('/register', (req, res) => {
      const variant = req.query.variant as string | undefined;
      let html: string;
      if (variant === 'error') {
        html = renderRegister('Invite code is invalid, expired, or already used.', { inviteCode: 'abc123def456abc123def456abc123de', username: 'alice' });
      } else if (variant === 'prefilled') {
        html = renderRegister(undefined, { inviteCode: 'abc123def456abc123def456abc123de' });
      } else {
        html = renderRegister();
      }
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

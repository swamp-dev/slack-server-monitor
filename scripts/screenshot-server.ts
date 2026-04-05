/**
 * Standalone screenshot server.
 *
 * Minimal Express app serving real templates with seed data.
 * No auth, no Slack connection — just the web UI for screenshots.
 *
 * Usage:
 *   npx tsx scripts/screenshot-server.ts          # start on port 18970
 *   SCREENSHOT_PORT=3333 npx tsx scripts/...      # custom port
 */

import express from 'express';
import type { Server } from 'http';
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

let server: Server | null = null;

export function startScreenshotServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    const app = express();

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

    // 404 catch-all
    app.use((_req, res) => {
      res.status(404).type('html').send(render404());
    });

    server = app.listen(PORT, () => {
      resolve(PORT);
    });

    server.on('error', reject);
  });
}

export function stopScreenshotServer(): Promise<void> {
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

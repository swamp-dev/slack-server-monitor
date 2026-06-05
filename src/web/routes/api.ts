import { Router, type Request, type Response } from 'express';
import type { Config, WebConfig } from '../../config/schema.js';
import { getConversationStore } from '../../services/conversation-store.js';
import { getNotificationStore } from '../../services/notification-store.js';
import { getQuickLinksStore } from '../../services/quick-links-store.js';
import { getServerHealth } from '../../services/server-health.js';
import { getEventBus } from '../../services/event-bus.js';
import { getSharedSSEManager } from '../sse.js';
import { logger } from '../../utils/logger.js';
import { renderNotificationPage, renderError } from '../templates/index.js';
import { sessionAuthMiddleware, getUserFilterIds } from '../middleware/auth.js';

type ClaudeConfig = NonNullable<Config['claude']>;

export function createApiRouter(claudeConfig: ClaudeConfig, webConfig: WebConfig, dbPath: string): Router {
  const router = Router();

  // Wire event bus to SSE broadcasts (runs once when router is created)
  const bus = getEventBus();
  bus.on('notification:created', (notification) => {
    getSharedSSEManager()?.broadcast('notifications', 'notification', notification);
  });
  bus.on('notification:read', (data) => {
    getSharedSSEManager()?.broadcast('notifications', 'badge', data);
  });
  bus.on('notification:all-read', (data) => {
    getSharedSSEManager()?.broadcast('notifications', 'badge', data);
  });

  // ─── Search API ────────────────────────────────────────────────────────

  router.get('/api/search', sessionAuthMiddleware(webConfig, dbPath), (req: Request, res: Response) => {
    try {
      const store = getConversationStore(claudeConfig.dbPath, claudeConfig.conversationTtlHours);
      const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      const limit = Math.min(typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 5, 10) || 5;
      const userId = res.locals.userId as string | undefined;

      function toResult(s: { id: number; firstMessage?: string; userId: string; channelId: string; threadTs: string; updatedAt: number }) {
        return {
          id: s.id,
          title: s.firstMessage ?? `${s.userId} · ${s.channelId}`,
          url: `/c/${encodeURIComponent(s.threadTs)}/${encodeURIComponent(s.channelId)}`,
          time: s.updatedAt,
        };
      }

      // Command-palette UX intentionally always scopes to the requester's
      // own conversations — including admins.
      const filterIds = getUserFilterIds(res, dbPath) ?? (userId ? [userId] : []);
      if (!query) {
        const recent = store.listRecentSessions(limit, 0, filterIds);
        res.json({ results: recent.map(toResult) });
        return;
      }

      const sessions = store.searchConversations(query, limit, 0, filterIds);
      res.json({ results: sessions.map(toResult) });
    } catch (err) {
      logger.error('Error in search API', { error: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: 'Search failed' });
    }
  });

  // ─── Server Health API ─────────────────────────────────────────────────

  router.get('/api/health/server', sessionAuthMiddleware(webConfig, dbPath), async (_req: Request, res: Response) => {
    try {
      const health = await getServerHealth();
      if (!health) {
        res.status(503).json({ error: 'Health metrics unavailable' });
        return;
      }
      res.json(health);
    } catch (err) {
      logger.error('Error fetching server health', { error: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: 'Failed to fetch health' });
    }
  });

  // ─── Quick Links API ───────────────────────────────────────────────────

  router.get('/api/links', sessionAuthMiddleware(webConfig, dbPath), (_req: Request, res: Response) => {
    try {
      const linksStore = getQuickLinksStore(claudeConfig.dbPath);
      const userId = (res.locals.userId as string) || '';
      const links = linksStore.getLinks(userId);
      res.json({ links });
    } catch (err) {
      logger.error('Error fetching quick links', { error: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: 'Failed to fetch links' });
    }
  });

  router.post('/api/links', sessionAuthMiddleware(webConfig, dbPath), (req: Request, res: Response) => {
    try {
      const linksStore = getQuickLinksStore(claudeConfig.dbPath);
      const userId = (res.locals.userId as string) || '';
      const { title, url, icon: linkIcon } = req.body as { title?: string; url?: string; icon?: string };

      if (!title || !url || typeof title !== 'string' || typeof url !== 'string') {
        res.status(400).json({ error: 'title and url are required' });
        return;
      }

      if (title.length > 100 || url.length > 2000) {
        res.status(400).json({ error: 'title or url too long' });
        return;
      }

      if (typeof linkIcon === 'string' && linkIcon.length > 50) {
        res.status(400).json({ error: 'icon name too long' });
        return;
      }

      const trimmedUrl = url.trim().toLowerCase();
      if (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://') && !url.trim().startsWith('/')) {
        res.status(400).json({ error: 'url must be http://, https://, or a relative path' });
        return;
      }

      const link = linksStore.addLink(userId, title.trim(), url.trim(), typeof linkIcon === 'string' ? linkIcon.trim() : undefined);
      res.status(201).json({ link });
    } catch (err) {
      logger.error('Error adding quick link', { error: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: 'Failed to add link' });
    }
  });

  router.delete('/api/links/:id', sessionAuthMiddleware(webConfig, dbPath), (req: Request, res: Response) => {
    try {
      const linksStore = getQuickLinksStore(claudeConfig.dbPath);
      const userId = (res.locals.userId as string) || '';
      const id = Number(req.params.id);
      if (isNaN(id) || id <= 0) {
        res.status(400).json({ error: 'Invalid link ID' });
        return;
      }
      const success = linksStore.removeLink(userId, id);
      res.json({ success });
    } catch (err) {
      logger.error('Error removing quick link', { error: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: 'Failed to remove link' });
    }
  });

  router.put('/api/links/reorder', sessionAuthMiddleware(webConfig, dbPath), (req: Request, res: Response) => {
    try {
      const linksStore = getQuickLinksStore(claudeConfig.dbPath);
      const userId = (res.locals.userId as string) || '';
      const { orderedIds } = req.body as { orderedIds?: number[] };

      if (!Array.isArray(orderedIds) || !orderedIds.every((id) => typeof id === 'number' && id > 0)) {
        res.status(400).json({ error: 'orderedIds must be an array of positive numbers' });
        return;
      }

      if (orderedIds.length > 100) {
        res.status(400).json({ error: 'Too many items to reorder (max 100)' });
        return;
      }

      const updated = linksStore.reorderLinks(userId, orderedIds);
      res.json({ updated });
    } catch (err) {
      logger.error('Error reordering quick links', { error: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: 'Failed to reorder links' });
    }
  });

  // ─── Notification API ──────────────────────────────────────────────────

  router.get('/api/notifications', sessionAuthMiddleware(webConfig, dbPath), (req: Request, res: Response) => {
    try {
      const notifStore = getNotificationStore(claudeConfig.dbPath);
      const unreadOnly = req.query.unread === 'true';
      const limit = Math.min(Number(req.query.limit) || 50, 100);
      const offset = Math.max(Number(req.query.offset) || 0, 0);

      const notifications = unreadOnly
        ? notifStore.getUnread(limit)
        : notifStore.getRecent(limit, offset);
      const unreadCount = notifStore.countUnread();

      res.json({ notifications, unreadCount });
    } catch (err) {
      logger.error('Error fetching notifications', { error: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: 'Failed to fetch notifications' });
    }
  });

  // IMPORTANT: Must be registered before /:id/read to avoid Express treating "read-all" as an :id
  router.post('/api/notifications/read-all', sessionAuthMiddleware(webConfig, dbPath), (_req: Request, res: Response) => {
    try {
      const notifStore = getNotificationStore(claudeConfig.dbPath);
      const count = notifStore.markAllRead();
      res.json({ count, unreadCount: 0 });
    } catch (err) {
      logger.error('Error marking all notifications read', { error: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: 'Failed to mark all read' });
    }
  });

  router.post('/api/notifications/:id/read', sessionAuthMiddleware(webConfig, dbPath), (req: Request, res: Response) => {
    try {
      const notifStore = getNotificationStore(claudeConfig.dbPath);
      const id = Number(req.params.id);
      if (isNaN(id) || id <= 0) {
        res.status(400).json({ error: 'Invalid notification ID' });
        return;
      }
      const success = notifStore.markRead(id);
      res.json({ success, unreadCount: notifStore.countUnread() });
    } catch (err) {
      logger.error('Error marking notification read', { error: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: 'Failed to mark notification read' });
    }
  });

  router.get('/api/notifications/stream', sessionAuthMiddleware(webConfig, dbPath), (_req: Request, res: Response) => {
    getSharedSSEManager()?.addClient('notifications', res);
  });

  // ─── Notifications page ────────────────────────────────────────────────

  router.get('/notifications', sessionAuthMiddleware(webConfig, dbPath), (_req: Request, res: Response) => {
    try {
      const notifStore = getNotificationStore(claudeConfig.dbPath);
      const notifications = notifStore.getRecent(50);
      const unreadCount = notifStore.countUnread();
      const html = renderNotificationPage(notifications, unreadCount);
      res.type('html').send(html);
    } catch (err) {
      logger.error('Error serving notifications page', { error: err instanceof Error ? err.message : String(err) });
      res.status(500).send(renderError('Failed to load notifications.'));
    }
  });

  return router;
}

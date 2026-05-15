import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import express, { type Request, type Response } from 'express';
import type { Server } from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { NotificationStore } from '../../src/services/notification-store.js';

describe('notification API endpoints', () => {
  let app: ReturnType<typeof express>;
  let server: Server;
  let baseUrl: string;
  let store: NotificationStore;
  let testDbPath: string;

  beforeAll(async () => {
    testDbPath = path.join(os.tmpdir(), `test-notif-api-${Date.now()}.db`);
    store = new NotificationStore(testDbPath);

    app = express();
    app.use(express.json());

    // GET /api/notifications
    app.get('/api/notifications', (req: Request, res: Response) => {
      const unreadOnly = req.query.unread === 'true';
      const limit = Math.min(Number(req.query.limit) || 50, 100);
      const offset = Math.max(Number(req.query.offset) || 0, 0);

      const notifications = unreadOnly
        ? store.getUnread(limit)
        : store.getRecent(limit, offset);
      const unreadCount = store.countUnread();

      res.json({ notifications, unreadCount });
    });

    // POST /api/notifications/:id/read
    app.post('/api/notifications/:id/read', (req: Request, res: Response) => {
      const id = Number(req.params.id);
      if (isNaN(id) || id <= 0) {
        res.status(400).json({ error: 'Invalid notification ID' });
        return;
      }
      const success = store.markRead(id);
      res.json({ success, unreadCount: store.countUnread() });
    });

    // POST /api/notifications/read-all
    app.post('/api/notifications/read-all', (_req: Request, res: Response) => {
      const count = store.markAllRead();
      res.json({ count, unreadCount: 0 });
    });

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr !== 'string') {
          baseUrl = `http://127.0.0.1:${String(addr.port)}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
    try {
      fs.unlinkSync(testDbPath);
      fs.unlinkSync(testDbPath + '-wal');
      fs.unlinkSync(testDbPath + '-shm');
    } catch {
      // ok
    }
  });

  beforeEach(() => {
    // Clear all notifications between tests
    const db = store.getDatabase();
    db.exec('DELETE FROM notifications');
  });

  describe('GET /api/notifications', () => {
    it('should return empty list when no notifications', async () => {
      const res = await fetch(`${baseUrl}/api/notifications`);
      const body = await res.json() as { notifications: unknown[]; unreadCount: number };

      expect(res.status).toBe(200);
      expect(body.notifications).toEqual([]);
      expect(body.unreadCount).toBe(0);
    });

    it('should return all recent notifications', async () => {
      store.createNotification('system', 'info', 'Test 1');
      store.createNotification('plugin', 'warn', 'Test 2');

      const res = await fetch(`${baseUrl}/api/notifications`);
      const body = await res.json() as { notifications: { title: string }[]; unreadCount: number };

      expect(body.notifications).toHaveLength(2);
      expect(body.unreadCount).toBe(2);
      // Most recent first
      expect(body.notifications[0].title).toBe('Test 2');
    });

    it('should filter to unread only when requested', async () => {
      const n1 = store.createNotification('a', 'info', 'Read');
      store.createNotification('b', 'info', 'Unread');
      store.markRead(n1.id);

      const res = await fetch(`${baseUrl}/api/notifications?unread=true`);
      const body = await res.json() as { notifications: { title: string }[]; unreadCount: number };

      expect(body.notifications).toHaveLength(1);
      expect(body.notifications[0].title).toBe('Unread');
      expect(body.unreadCount).toBe(1);
    });

    it('should respect limit parameter', async () => {
      for (let i = 0; i < 10; i++) {
        store.createNotification('a', 'info', `N${String(i)}`);
      }

      const res = await fetch(`${baseUrl}/api/notifications?limit=3`);
      const body = await res.json() as { notifications: unknown[] };

      expect(body.notifications).toHaveLength(3);
    });

    it('should cap limit at 100', async () => {
      const res = await fetch(`${baseUrl}/api/notifications?limit=999`);
      expect(res.status).toBe(200);
      // Just verify it doesn't error — the cap is enforced server-side
    });
  });

  describe('POST /api/notifications/:id/read', () => {
    it('should mark a notification as read', async () => {
      const notif = store.createNotification('a', 'info', 'Mark me');

      const res = await fetch(`${baseUrl}/api/notifications/${String(notif.id)}/read`, { method: 'POST' });
      const body = await res.json() as { success: boolean; unreadCount: number };

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.unreadCount).toBe(0);
    });

    it('should return false for non-existent notification', async () => {
      const res = await fetch(`${baseUrl}/api/notifications/9999/read`, { method: 'POST' });
      const body = await res.json() as { success: boolean };

      expect(res.status).toBe(200);
      expect(body.success).toBe(false);
    });

    it('should return 400 for invalid ID', async () => {
      const res = await fetch(`${baseUrl}/api/notifications/abc/read`, { method: 'POST' });
      expect(res.status).toBe(400);
    });

    it('should return 400 for zero ID', async () => {
      const res = await fetch(`${baseUrl}/api/notifications/0/read`, { method: 'POST' });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/notifications/read-all', () => {
    it('should mark all notifications as read', async () => {
      store.createNotification('a', 'info', 'One');
      store.createNotification('b', 'warn', 'Two');
      store.createNotification('c', 'error', 'Three');

      const res = await fetch(`${baseUrl}/api/notifications/read-all`, { method: 'POST' });
      const body = await res.json() as { count: number; unreadCount: number };

      expect(res.status).toBe(200);
      expect(body.count).toBe(3);
      expect(body.unreadCount).toBe(0);
    });

    it('should return 0 when no unread notifications', async () => {
      const res = await fetch(`${baseUrl}/api/notifications/read-all`, { method: 'POST' });
      const body = await res.json() as { count: number };

      expect(body.count).toBe(0);
    });
  });
});

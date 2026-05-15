import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import express, { type Request, type Response } from 'express';
import type { Server } from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { QuickLinksStore } from '../../src/services/quick-links-store.js';

describe('quick links API endpoints', () => {
  let app: ReturnType<typeof express>;
  let server: Server;
  let baseUrl: string;
  let store: QuickLinksStore;
  let testDbPath: string;
  const testUserId = 'U01TEST';

  beforeAll(async () => {
    testDbPath = path.join(os.tmpdir(), `test-links-api-${Date.now()}.db`);
    store = new QuickLinksStore(testDbPath);

    app = express();
    app.use(express.json());

    // Simulate auth middleware setting userId
    app.use((_req, res, next) => {
      res.locals.userId = testUserId;
      next();
    });

    app.get('/api/links', (_req: Request, res: Response) => {
      const links = store.getLinks((res.locals.userId as string) || '');
      res.json({ links });
    });

    app.post('/api/links', (req: Request, res: Response) => {
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
      const link = store.addLink(userId, title.trim(), url.trim(), typeof linkIcon === 'string' ? linkIcon.trim() : undefined);
      res.status(201).json({ link });
    });

    app.delete('/api/links/:id', (req: Request, res: Response) => {
      const userId = (res.locals.userId as string) || '';
      const id = Number(req.params.id);
      if (isNaN(id) || id <= 0) {
        res.status(400).json({ error: 'Invalid link ID' });
        return;
      }
      const success = store.removeLink(userId, id);
      res.json({ success });
    });

    app.put('/api/links/reorder', (req: Request, res: Response) => {
      const userId = (res.locals.userId as string) || '';
      const { orderedIds } = req.body as { orderedIds?: number[] };
      if (!Array.isArray(orderedIds) || !orderedIds.every((id) => typeof id === 'number' && id > 0)) {
        res.status(400).json({ error: 'orderedIds must be an array of positive numbers' });
        return;
      }
      const updated = store.reorderLinks(userId, orderedIds);
      res.json({ updated });
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
    } catch { /* ok */ }
  });

  beforeEach(() => {
    const db = store.getDatabase();
    db.exec('DELETE FROM quick_links');
  });

  describe('GET /api/links', () => {
    it('should return empty array when no links', async () => {
      const res = await fetch(`${baseUrl}/api/links`);
      const body = await res.json() as { links: unknown[] };
      expect(res.status).toBe(200);
      expect(body.links).toEqual([]);
    });

    it('should return user links', async () => {
      store.addLink(testUserId, 'Google', 'https://google.com');
      store.addLink(testUserId, 'GitHub', 'https://github.com');

      const res = await fetch(`${baseUrl}/api/links`);
      const body = await res.json() as { links: { title: string }[] };
      expect(body.links).toHaveLength(2);
      expect(body.links[0].title).toBe('Google');
    });
  });

  describe('POST /api/links', () => {
    it('should create a quick link', async () => {
      const res = await fetch(`${baseUrl}/api/links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Test', url: 'https://test.com' }),
      });
      const body = await res.json() as { link: { id: number; title: string; url: string } };
      expect(res.status).toBe(201);
      expect(body.link.title).toBe('Test');
      expect(body.link.url).toBe('https://test.com');
    });

    it('should return 400 without title', async () => {
      const res = await fetch(`${baseUrl}/api/links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://test.com' }),
      });
      expect(res.status).toBe(400);
    });

    it('should return 400 without url', async () => {
      const res = await fetch(`${baseUrl}/api/links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Test' }),
      });
      expect(res.status).toBe(400);
    });

    it('should create link with icon', async () => {
      const res = await fetch(`${baseUrl}/api/links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Grafana', url: 'https://grafana.local', icon: 'chart' }),
      });
      const body = await res.json() as { link: { icon: string } };
      expect(res.status).toBe(201);
      expect(body.link.icon).toBe('chart');
    });
  });

  describe('DELETE /api/links/:id', () => {
    it('should delete a link', async () => {
      const link = store.addLink(testUserId, 'Delete me', 'https://del.com');
      const res = await fetch(`${baseUrl}/api/links/${String(link.id)}`, { method: 'DELETE' });
      const body = await res.json() as { success: boolean };
      expect(body.success).toBe(true);
      expect(store.getLinks(testUserId)).toHaveLength(0);
    });

    it('should return false for non-existent link', async () => {
      const res = await fetch(`${baseUrl}/api/links/9999`, { method: 'DELETE' });
      const body = await res.json() as { success: boolean };
      expect(body.success).toBe(false);
    });

    it('should return 400 for invalid ID', async () => {
      const res = await fetch(`${baseUrl}/api/links/abc`, { method: 'DELETE' });
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /api/links/reorder', () => {
    it('should reorder links', async () => {
      const l1 = store.addLink(testUserId, 'A', 'https://a.com');
      const l2 = store.addLink(testUserId, 'B', 'https://b.com');

      const res = await fetch(`${baseUrl}/api/links/reorder`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedIds: [l2.id, l1.id] }),
      });
      const body = await res.json() as { updated: number };
      expect(body.updated).toBe(2);

      const links = store.getLinks(testUserId);
      expect(links[0].title).toBe('B');
      expect(links[1].title).toBe('A');
    });

    it('should return 400 for invalid orderedIds', async () => {
      const res = await fetch(`${baseUrl}/api/links/reorder`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedIds: 'not-an-array' }),
      });
      expect(res.status).toBe(400);
    });
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import { createPluginRouter, getPluginNavEntries, clearPluginNavEntries } from '../../src/web/plugin-router.js';

// Simple supertest-style helper
async function request(app: express.Express) {
  return {
    get: async (path: string) => {
      return new Promise<{ status: number; body: string }>((resolve) => {
        const server = app.listen(0, () => {
          const addr = server.address();
          const port = typeof addr === 'object' && addr ? addr.port : 0;
          fetch(`http://localhost:${port}${path}`)
            .then((res) => res.text().then((body) => ({ status: res.status, body })))
            .then((result) => {
              server.close();
              resolve(result);
            })
            .catch(() => {
              server.close();
              resolve({ status: 500, body: 'fetch error' });
            });
        });
      });
    },
  };
}

describe('PluginRouter', () => {
  beforeEach(() => {
    clearPluginNavEntries();
  });

  describe('createPluginRouter', () => {
    it('should create a router scoped to plugin name', async () => {
      const app = express();
      const { router } = createPluginRouter('test-plugin');

      router.get('/dashboard', (_req, res) => {
        res.send('plugin dashboard');
      });

      app.use('/p/test-plugin', router.expressRouter);
      const r = await request(app);
      const res = await r.get('/p/test-plugin/dashboard');

      expect(res.status).toBe(200);
      expect(res.body).toBe('plugin dashboard');
    });

    it('should expose pluginName on the router', () => {
      const { router } = createPluginRouter('my-plugin');
      expect(router.pluginName).toBe('my-plugin');
    });

    it('should support POST routes', async () => {
      const app = express();
      app.use(express.json());
      const { router } = createPluginRouter('test-plugin');

      router.post('/action', (req, res) => {
        res.json({ received: true });
      });

      app.use('/p/test-plugin', router.expressRouter);

      const server: Server = await new Promise((resolve) => {
        const s = app.listen(0, () => resolve(s));
      });
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;

      const res = await fetch(`http://localhost:${port}/p/test-plugin/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test: true }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.received).toBe(true);

      server.close();
    });
  });

  describe('nav entries', () => {
    it('should register a nav entry', () => {
      createPluginRouter('hue', { label: 'Hue Lights', icon: 'sun' });

      const entries = getPluginNavEntries();

      expect(entries).toHaveLength(1);
      expect(entries[0]?.label).toBe('Hue Lights');
      expect(entries[0]?.path).toBe('/p/hue');
      expect(entries[0]?.icon).toBe('sun');
    });

    it('should not register nav entry if not provided', () => {
      createPluginRouter('background-plugin');

      expect(getPluginNavEntries()).toHaveLength(0);
    });

    it('should collect nav entries from multiple plugins', () => {
      createPluginRouter('hue', { label: 'Hue', icon: 'sun' });
      createPluginRouter('lift', { label: 'Lifting', icon: 'wrench' });

      const entries = getPluginNavEntries();

      expect(entries).toHaveLength(2);
    });

    it('should clear nav entries', () => {
      createPluginRouter('hue', { label: 'Hue' });
      clearPluginNavEntries();

      expect(getPluginNavEntries()).toHaveLength(0);
    });
  });
});

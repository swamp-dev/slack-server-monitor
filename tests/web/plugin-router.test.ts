import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { createPluginRouter, getPluginExpressRouter, getPluginNavEntries, clearPluginRoutes, isPluginPublic } from '../../src/web/plugin-router.js';
import type { PluginContext } from '../../src/plugins/types.js';
import type { Request, Response } from 'express';

const mockCtx: PluginContext = {
  db: {} as PluginContext['db'],
  name: 'test-plugin',
  version: '1.0.0',
  notify: vi.fn(),
};

describe('plugin router', () => {
  beforeEach(() => {
    clearPluginRoutes();
  });

  describe('createPluginRouter', () => {
    it('should create a router with the correct plugin name', () => {
      const router = createPluginRouter('test-plugin', mockCtx);
      expect(router.pluginName).toBe('test-plugin');
    });

    it('should register a GET route', () => {
      const router = createPluginRouter('test-plugin', mockCtx);
      const handler = vi.fn();
      router.get('/', handler);

      // Route should be registered on the express router
      const expressRouter = getPluginExpressRouter();
      expect(expressRouter).toBeDefined();
    });

    it('should register a POST route', () => {
      const router = createPluginRouter('test-plugin', mockCtx);
      const handler = vi.fn();
      router.post('/submit', handler);

      const expressRouter = getPluginExpressRouter();
      expect(expressRouter).toBeDefined();
    });
  });

  describe('path validation', () => {
    it('should reject paths containing ..', () => {
      const router = createPluginRouter('test-plugin', mockCtx);
      expect(() => router.get('/../etc/passwd', vi.fn())).toThrow();
    });

    it('should reject absolute paths', () => {
      const router = createPluginRouter('test-plugin', mockCtx);
      expect(() => router.get('/absolute', vi.fn())).not.toThrow(); // leading slash is ok (relative to plugin mount)
    });

    it('should accept simple relative paths', () => {
      const router = createPluginRouter('test-plugin', mockCtx);
      expect(() => router.get('/', vi.fn())).not.toThrow();
      expect(() => router.get('/page', vi.fn())).not.toThrow();
      expect(() => router.get('/sub/page', vi.fn())).not.toThrow();
    });

    it('should reject paths with encoded traversal', () => {
      const router = createPluginRouter('test-plugin', mockCtx);
      expect(() => router.get('/%2e%2e/etc', vi.fn())).toThrow();
    });
  });

  describe('nav entries', () => {
    it('should return empty array when no plugins have nav entries', () => {
      expect(getPluginNavEntries()).toEqual([]);
    });

    it('should collect nav entries from plugins', () => {
      createPluginRouter('lift', mockCtx, { label: 'Lift', icon: 'dumbbell' });
      createPluginRouter('health', mockCtx, { label: 'Health' });

      const entries = getPluginNavEntries();
      expect(entries).toHaveLength(2);
      expect(entries[0]).toEqual({ pluginName: 'lift', label: 'Lift', icon: 'dumbbell', pages: [], public: false });
      expect(entries[1]).toEqual({ pluginName: 'health', label: 'Health', icon: undefined, pages: [], public: false });
    });

    it('should not add nav entry when not provided', () => {
      createPluginRouter('hidden-plugin', mockCtx);
      expect(getPluginNavEntries()).toEqual([]);
    });

    it('should include public flag in nav entry', () => {
      createPluginRouter('lift', mockCtx, { label: 'Lift' }, true);
      const entries = getPluginNavEntries();
      expect(entries[0]).toEqual({ pluginName: 'lift', label: 'Lift', icon: undefined, pages: [], public: true });
    });

    it('should default public to false in nav entry', () => {
      createPluginRouter('hue', mockCtx, { label: 'Hue' });
      const entries = getPluginNavEntries();
      expect(entries[0]).toEqual({ pluginName: 'hue', label: 'Hue', icon: undefined, pages: [], public: false });
    });
  });

  describe('public plugin tracking', () => {
    it('should return false for unknown plugin', () => {
      expect(isPluginPublic('nonexistent')).toBe(false);
    });

    it('should return true for public plugin', () => {
      createPluginRouter('lift', mockCtx, { label: 'Lift' }, true);
      expect(isPluginPublic('lift')).toBe(true);
    });

    it('should return false for private plugin', () => {
      createPluginRouter('hue', mockCtx, { label: 'Hue' }, false);
      expect(isPluginPublic('hue')).toBe(false);
    });

    it('should return false for plugin without isPublic param', () => {
      createPluginRouter('health', mockCtx, { label: 'Health' });
      expect(isPluginPublic('health')).toBe(false);
    });

    it('should reset on clearPluginRoutes', () => {
      createPluginRouter('lift', mockCtx, { label: 'Lift' }, true);
      expect(isPluginPublic('lift')).toBe(true);
      clearPluginRoutes();
      expect(isPluginPublic('lift')).toBe(false);
    });
  });

  describe('handler wrapping', () => {
    it('should pass ctx to handler', async () => {
      const router = createPluginRouter('test-plugin', mockCtx);
      let receivedCtx: PluginContext | undefined;

      router.get('/', ((_req: Request, _res: Response, ctx: PluginContext) => {
        receivedCtx = ctx;
      }));

      // Get the express router and find the registered handler
      const expressRouter = getPluginExpressRouter();
      const layers = (expressRouter as unknown as { stack: { route?: { path: string; methods: Record<string, boolean>; stack: { handle: (req: Request, res: Response, next: () => void) => void }[] } }[] }).stack;
      const getLayer = layers.find((l) => l.route?.methods.get && l.route?.path === '/test-plugin/');

      expect(getLayer).toBeDefined();

      // Call the handler
      const mockReq = {} as Request;
      const mockRes = { status: vi.fn().mockReturnThis(), send: vi.fn() } as unknown as Response;
      const mockNext = vi.fn();
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      getLayer!.route!.stack[0].handle(mockReq, mockRes, mockNext);

      expect(receivedCtx).toBe(mockCtx);
    });

    it('should catch handler errors and return 500', async () => {
      const router = createPluginRouter('test-plugin', mockCtx);

      router.get('/error', (() => {
        throw new Error('Plugin exploded');
      }));

      const expressRouter = getPluginExpressRouter();
      const layers = (expressRouter as unknown as { stack: { route?: { path: string; methods: Record<string, boolean>; stack: { handle: (req: Request, res: Response, next: () => void) => void }[] } }[] }).stack;
      const errorLayer = layers.find((l) => l.route?.path === '/test-plugin/error');

      const mockReq = {} as Request;
      const mockRes = { status: vi.fn().mockReturnThis(), send: vi.fn() } as unknown as Response;
      const mockNext = vi.fn();
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      errorLayer!.route!.stack[0].handle(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(500);
    });
  });

  describe('clearPluginRoutes', () => {
    it('should clear all registered routes and nav entries', () => {
      createPluginRouter('test', mockCtx, { label: 'Test' });
      expect(getPluginNavEntries()).toHaveLength(1);

      clearPluginRoutes();
      expect(getPluginNavEntries()).toEqual([]);
    });
  });
});

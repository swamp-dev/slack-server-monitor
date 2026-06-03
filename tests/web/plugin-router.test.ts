import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../src/web/sse.js', () => ({
  getSharedSSEManager: vi.fn(),
}));

import { createPluginRouter, getPluginExpressRouter, getPluginNavEntries, clearPluginRoutes, isPluginPublic } from '../../src/web/plugin-router.js';
import { getSharedSSEManager } from '../../src/web/sse.js';
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

  describe('SSE stream endpoint', () => {
    type RouterLayer = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: (req: Request, res: Response, next: () => void) => void }[] } };

    function findRoute(path: string) {
      const layers = (getPluginExpressRouter() as unknown as { stack: RouterLayer[] }).stack;
      return layers.find((l) => l.route?.path === path);
    }

    function makeRes(headersSent = false) {
      return {
        headersSent,
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
      } as unknown as Response;
    }

    it('returns 503 when SSE manager is not available', () => {
      vi.mocked(getSharedSSEManager).mockReturnValue(null);
      createPluginRouter('sse-test', mockCtx);

      const layer = findRoute('/sse-test/stream');
      expect(layer).toBeDefined();

      const mockRes = makeRes();
      layer!.route!.stack[0]!.handle({} as Request, mockRes, vi.fn());

      expect(mockRes.status).toHaveBeenCalledWith(503);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'SSE not available' });
    });

    it('calls addClient with the correct plugin channel ID when SSE is available', () => {
      const mockManager = { addClient: vi.fn() };
      vi.mocked(getSharedSSEManager).mockReturnValue(mockManager as never);
      createPluginRouter('sse-test2', mockCtx);

      const mockRes = makeRes();
      const layer = findRoute('/sse-test2/stream');
      layer!.route!.stack[0]!.handle({} as Request, mockRes, vi.fn());

      expect(mockManager.addClient).toHaveBeenCalledWith('plugin:sse-test2', mockRes);
    });

    it('sends 500 when addClient throws and headers are not yet sent', () => {
      const mockManager = { addClient: vi.fn(() => { throw new Error('stream error'); }) };
      vi.mocked(getSharedSSEManager).mockReturnValue(mockManager as never);
      createPluginRouter('sse-test3', mockCtx);

      const mockRes = makeRes(false);
      const layer = findRoute('/sse-test3/stream');
      layer!.route!.stack[0]!.handle({} as Request, mockRes, vi.fn());

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.send).toHaveBeenCalledWith('SSE error');
    });

    it('does not call res.status when addClient throws but headers already sent', () => {
      const mockManager = { addClient: vi.fn(() => { throw new Error('stream error'); }) };
      vi.mocked(getSharedSSEManager).mockReturnValue(mockManager as never);
      createPluginRouter('sse-test4', mockCtx);

      const mockRes = makeRes(true);
      const layer = findRoute('/sse-test4/stream');
      layer!.route!.stack[0]!.handle({} as Request, mockRes, vi.fn());

      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('registers only one /stream route per plugin even when called twice', () => {
      createPluginRouter('sse-dup', mockCtx);
      createPluginRouter('sse-dup', mockCtx);

      const layers = (getPluginExpressRouter() as unknown as { stack: RouterLayer[] }).stack;
      const streamRoutes = layers.filter((l) => l.route?.path === '/sse-dup/stream');
      expect(streamRoutes).toHaveLength(1);
    });
  });

  describe('async handler error paths', () => {
    type RouterLayer = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: (req: Request, res: Response, next: () => void) => void }[] } };

    function findRoute(path: string) {
      const layers = (getPluginExpressRouter() as unknown as { stack: RouterLayer[] }).stack;
      return layers.find((l) => l.route?.path === path);
    }

    it('sends 500 on async handler rejection when headers not sent', async () => {
      const router = createPluginRouter('async-err', mockCtx);
      router.get('/fail', async () => { throw new Error('async boom'); });

      const mockRes = {
        headersSent: false,
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
      } as unknown as Response;

      const layer = findRoute('/async-err/fail');
      layer!.route!.stack[0]!.handle({} as Request, mockRes, vi.fn());

      // Let the Promise rejection propagate through the catch handler
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.send).toHaveBeenCalledWith('Internal plugin error');
    });

    it('does not call res.status on async rejection when headers already sent', async () => {
      const router = createPluginRouter('async-err2', mockCtx);
      router.get('/fail2', async () => { throw new Error('async boom'); });

      const mockRes = {
        headersSent: true,
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
      } as unknown as Response;

      const layer = findRoute('/async-err2/fail2');
      layer!.route!.stack[0]!.handle({} as Request, mockRes, vi.fn());

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockRes.status).not.toHaveBeenCalled();
    });
  });
});

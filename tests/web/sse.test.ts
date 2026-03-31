import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SSEConnectionManager } from '../../src/web/sse.js';

/**
 * Create a mock Express Response for SSE testing
 */
function createMockResponse() {
  const written: string[] = [];
  let ended = false;
  const closeHandlers: (() => void)[] = [];

  const res = {
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn((data: string) => {
      if (ended) return false;
      written.push(data);
      return true;
    }),
    end: vi.fn(() => { ended = true; }),
    on: vi.fn((event: string, handler: () => void) => {
      if (event === 'close') closeHandlers.push(handler);
    }),
    // Test helpers
    _written: written,
    _ended: () => ended,
    _simulateClose: () => { closeHandlers.forEach((h) => h()); },
  };

  return res;
}

describe('SSEConnectionManager', () => {
  let manager: SSEConnectionManager;

  beforeEach(() => {
    manager = new SSEConnectionManager();
  });

  afterEach(() => {
    manager.shutdown();
  });

  describe('addClient', () => {
    it('should set SSE headers on the response', () => {
      const res = createMockResponse();
      manager.addClient('test-channel', res as never);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache');
      expect(res.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
      expect(res.setHeader).toHaveBeenCalledWith('X-Accel-Buffering', 'no');
    });

    it('should write initial :ok comment', () => {
      const res = createMockResponse();
      manager.addClient('test-channel', res as never);

      expect(res.write).toHaveBeenCalledWith(':ok\n\n');
    });

    it('should register close handler for cleanup', () => {
      const res = createMockResponse();
      manager.addClient('test-channel', res as never);

      expect(res.on).toHaveBeenCalledWith('close', expect.any(Function));
    });

    it('should remove client on close event', () => {
      const res = createMockResponse();
      manager.addClient('test-channel', res as never);

      expect(manager.clientCount('test-channel')).toBe(1);

      res._simulateClose();

      expect(manager.clientCount('test-channel')).toBe(0);
    });
  });

  describe('broadcast', () => {
    it('should send event to all clients on a channel', () => {
      const res1 = createMockResponse();
      const res2 = createMockResponse();
      manager.addClient('ch1', res1 as never);
      manager.addClient('ch1', res2 as never);

      manager.broadcast('ch1', 'test-event', { message: 'hello' });

      expect(res1._written).toContain('event: test-event\ndata: {"message":"hello"}\n\n');
      expect(res2._written).toContain('event: test-event\ndata: {"message":"hello"}\n\n');
    });

    it('should not send to clients on different channels', () => {
      const res1 = createMockResponse();
      const res2 = createMockResponse();
      manager.addClient('ch1', res1 as never);
      manager.addClient('ch2', res2 as never);

      manager.broadcast('ch1', 'test-event', { data: 1 });

      // res1 gets :ok + event, res2 only gets :ok
      expect(res1._written).toHaveLength(2);
      expect(res2._written).toHaveLength(1);
    });

    it('should handle broadcasting to empty channel', () => {
      // Should not throw
      manager.broadcast('nonexistent', 'event', {});
    });
  });

  describe('broadcastAll', () => {
    it('should send to all clients across all channels', () => {
      const res1 = createMockResponse();
      const res2 = createMockResponse();
      manager.addClient('ch1', res1 as never);
      manager.addClient('ch2', res2 as never);

      manager.broadcastAll('global-event', { count: 5 });

      expect(res1._written).toContain('event: global-event\ndata: {"count":5}\n\n');
      expect(res2._written).toContain('event: global-event\ndata: {"count":5}\n\n');
    });
  });

  describe('clientCount', () => {
    it('should return 0 for unknown channel', () => {
      expect(manager.clientCount('unknown')).toBe(0);
    });

    it('should track clients per channel', () => {
      const res1 = createMockResponse();
      const res2 = createMockResponse();
      manager.addClient('ch1', res1 as never);
      manager.addClient('ch1', res2 as never);
      manager.addClient('ch2', createMockResponse() as never);

      expect(manager.clientCount('ch1')).toBe(2);
      expect(manager.clientCount('ch2')).toBe(1);
    });
  });

  describe('shutdown', () => {
    it('should end all client connections', () => {
      const res1 = createMockResponse();
      const res2 = createMockResponse();
      manager.addClient('ch1', res1 as never);
      manager.addClient('ch2', res2 as never);

      manager.shutdown();

      expect(res1.end).toHaveBeenCalled();
      expect(res2.end).toHaveBeenCalled();
    });

    it('should clear all channels', () => {
      manager.addClient('ch1', createMockResponse() as never);
      manager.shutdown();

      expect(manager.clientCount('ch1')).toBe(0);
    });
  });

  describe('heartbeat', () => {
    it('should send heartbeat comments to all clients', () => {
      vi.useFakeTimers();

      const mgr = new SSEConnectionManager(5000); // 5s heartbeat for testing
      const res = createMockResponse();
      mgr.addClient('ch1', res as never);

      vi.advanceTimersByTime(5000);

      expect(res._written).toContain(':heartbeat\n\n');

      mgr.shutdown();
      vi.useRealTimers();
    });
  });
});

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

  describe('terminal event buffer clearing', () => {
    it('should clear buffer when done event is broadcast', () => {
      manager.broadcast('ch1', 'tool_call_start', { toolName: 'test' });
      manager.broadcast('ch1', 'tool_call_end', { toolName: 'test', durationMs: 100 });

      // Buffer should have 2 events
      const lateClient1 = createMockResponse();
      manager.addClient('ch1', lateClient1 as never);
      // :ok + 2 replayed events = 3 writes
      expect(lateClient1._written).toHaveLength(3);
      lateClient1._simulateClose();

      // Broadcast done — should clear buffer
      manager.broadcast('ch1', 'done', { type: 'done' });

      // New client after done should get no replay
      const lateClient2 = createMockResponse();
      manager.addClient('ch1', lateClient2 as never);
      // Only :ok, no replayed events
      expect(lateClient2._written).toHaveLength(1);
      expect(lateClient2._written[0]).toBe(':ok\n\n');
    });

    it('should clear buffer when error event is broadcast', () => {
      manager.broadcast('ch1', 'text', { text: 'partial response' });

      // Broadcast error — should clear buffer
      manager.broadcast('ch1', 'error', { type: 'error', message: 'failed' });

      // New client should get no replay
      const lateClient = createMockResponse();
      manager.addClient('ch1', lateClient as never);
      expect(lateClient._written).toHaveLength(1);
      expect(lateClient._written[0]).toBe(':ok\n\n');
    });

    it('should not buffer done or error events', () => {
      // Broadcast done to a channel with no clients
      manager.broadcast('ch1', 'done', { type: 'done' });

      // A new client should not see the done event replayed
      const client = createMockResponse();
      manager.addClient('ch1', client as never);
      expect(client._written).toHaveLength(1);
      expect(client._written[0]).toBe(':ok\n\n');
    });

    it('should still deliver done event to connected clients', () => {
      const res = createMockResponse();
      manager.addClient('ch1', res as never);

      manager.broadcast('ch1', 'done', { type: 'done' });

      expect(res._written).toContain('event: done\ndata: {"type":"done"}\n\n');
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

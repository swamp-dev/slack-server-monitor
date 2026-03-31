import { describe, it, expect, beforeEach } from 'vitest';
import { getEventBus, resetEventBus } from '../../src/services/event-bus.js';

describe('EventBus', () => {
  beforeEach(() => {
    resetEventBus();
  });

  it('should return a singleton instance', () => {
    const bus1 = getEventBus();
    const bus2 = getEventBus();
    expect(bus1).toBe(bus2);
  });

  it('should return a new instance after reset', () => {
    const bus1 = getEventBus();
    resetEventBus();
    const bus2 = getEventBus();
    expect(bus1).not.toBe(bus2);
  });

  it('should emit and receive notification:created events', () => {
    const bus = getEventBus();
    const received: unknown[] = [];

    bus.on('notification:created', (data) => {
      received.push(data);
    });

    const notification = { id: 1, source: 'test', level: 'info' as const, title: 'Test', body: null, link: null, createdAt: Date.now(), readAt: null };
    bus.emit('notification:created', notification);

    expect(received).toHaveLength(1);
    expect(received[0]).toBe(notification);
  });

  it('should emit and receive notification:read events', () => {
    const bus = getEventBus();
    const received: unknown[] = [];

    bus.on('notification:read', (data) => {
      received.push(data);
    });

    bus.emit('notification:read', { id: 5, unreadCount: 3 });

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ id: 5, unreadCount: 3 });
  });

  it('should emit and receive notification:all-read events', () => {
    const bus = getEventBus();
    const received: unknown[] = [];

    bus.on('notification:all-read', (data) => {
      received.push(data);
    });

    bus.emit('notification:all-read', { unreadCount: 0 });

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ unreadCount: 0 });
  });

  it('should support multiple listeners for same event', () => {
    const bus = getEventBus();
    let count = 0;

    bus.on('notification:created', () => { count++; });
    bus.on('notification:created', () => { count++; });

    bus.emit('notification:created', { id: 1, source: 'test', level: 'info' as const, title: 'T', body: null, link: null, createdAt: 0, readAt: null });

    expect(count).toBe(2);
  });

  it('should remove listeners on reset', () => {
    const bus = getEventBus();
    let called = false;

    bus.on('notification:created', () => { called = true; });
    resetEventBus();

    // Old bus should still work but the new singleton won't have the listener
    const newBus = getEventBus();
    newBus.emit('notification:created', { id: 1, source: 'test', level: 'info' as const, title: 'T', body: null, link: null, createdAt: 0, readAt: null });

    expect(called).toBe(false);
  });

  it('should have high max listeners to support many SSE clients', () => {
    const bus = getEventBus();
    expect(bus.getMaxListeners()).toBeGreaterThanOrEqual(200);
  });
});

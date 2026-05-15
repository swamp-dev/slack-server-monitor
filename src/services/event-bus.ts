/**
 * Typed event bus for in-process pub/sub.
 *
 * Used by SSE infrastructure to push notifications and conversation
 * progress events to connected web clients.
 */

import { EventEmitter } from 'events';
import type { Notification } from './notification-store.js';

/**
 * Event map for the application event bus
 */
export interface EventMap {
  'notification:created': [Notification];
  'notification:read': [{ id: number; unreadCount: number }];
  'notification:all-read': [{ unreadCount: number }];
}

/**
 * Typed event bus extending Node's EventEmitter
 */
export class TypedEventBus extends EventEmitter {
  emit<K extends keyof EventMap>(event: K, ...args: EventMap[K]): boolean;
  emit(event: string, ...args: unknown[]): boolean {
    return super.emit(event, ...args);
  }

  on<K extends keyof EventMap>(event: K, listener: (...args: EventMap[K]) => void): this;
  on(event: string, listener: (...args: unknown[]) => void): this {
    return super.on(event, listener);
  }

  off<K extends keyof EventMap>(event: K, listener: (...args: EventMap[K]) => void): this;
  off(event: string, listener: (...args: unknown[]) => void): this {
    return super.off(event, listener);
  }
}

let instance: TypedEventBus | null = null;

/**
 * Get the singleton event bus instance
 */
export function getEventBus(): TypedEventBus {
  if (!instance) {
    instance = new TypedEventBus();
    instance.setMaxListeners(200);
  }
  return instance;
}

/**
 * Reset the event bus (removes all listeners, creates new instance)
 */
export function resetEventBus(): void {
  if (instance) {
    instance.removeAllListeners();
    instance = null;
  }
}

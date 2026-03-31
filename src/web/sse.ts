/**
 * Server-Sent Events (SSE) connection manager.
 *
 * Manages SSE connections organized by channel. Provides broadcast
 * methods for pushing events to connected clients. Includes heartbeat
 * to prevent reverse proxy timeouts.
 */

import type { Response } from 'express';
import { logger } from '../utils/logger.js';

/**
 * Write a single SSE event to a response.
 * Silently catches write errors from closed connections.
 */
export function sendSSE(res: Response, event: string, data: unknown): void {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    // Connection closed — caller should handle cleanup via 'close' event
  }
}

/**
 * Manages Server-Sent Events connections organized by channel.
 *
 * Channels are arbitrary string keys (e.g., "notifications",
 * "conversation:1234567890.123456:C123ABC").
 */
/** Buffered event for replay on late-connecting clients */
interface BufferedEvent {
  event: string;
  data: string;
  timestamp: number;
}

const EVENT_BUFFER_TTL_MS = 30_000;
const EVENT_BUFFER_MAX = 50;

export class SSEConnectionManager {
  private clients = new Map<string, Set<Response>>();
  private eventBuffer = new Map<string, BufferedEvent[]>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(heartbeatIntervalMs = 30_000) {
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
      this.pruneEventBuffer();
    }, heartbeatIntervalMs);
  }

  /**
   * Add an SSE client to a channel.
   * Sets required headers, replays buffered events, and registers cleanup.
   */
  addClient(channel: string, res: Response): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    res.flushHeaders();

    res.write(':ok\n\n');

    // Replay buffered events for this channel (handles race condition
    // where processing starts before SSE client connects)
    const buffered = this.eventBuffer.get(channel);
    if (buffered) {
      for (const entry of buffered) {
        try { res.write(`event: ${entry.event}\ndata: ${entry.data}\n\n`); } catch { break; }
      }
    }

    let channelClients = this.clients.get(channel);
    if (!channelClients) {
      channelClients = new Set();
      this.clients.set(channel, channelClients);
    }
    channelClients.add(res);

    res.on('close', () => {
      this.removeClient(channel, res);
    });

    logger.debug('SSE client connected', { channel, clients: this.clientCount(channel) });
  }

  /**
   * Remove a client from a channel.
   */
  removeClient(channel: string, res: Response): void {
    const channelClients = this.clients.get(channel);
    if (channelClients) {
      channelClients.delete(res);
      if (channelClients.size === 0) {
        this.clients.delete(channel);
      }
    }
    logger.debug('SSE client disconnected', { channel, clients: this.clientCount(channel) });
  }

  /**
   * Broadcast an event to all clients on a specific channel.
   * Also buffers the event for late-connecting clients.
   */
  broadcast(channel: string, event: string, data: unknown): void {
    const serialized = JSON.stringify(data);

    // Buffer for late-connecting clients (handles SSE race condition)
    let buffer = this.eventBuffer.get(channel);
    if (!buffer) {
      buffer = [];
      this.eventBuffer.set(channel, buffer);
    }
    buffer.push({ event, data: serialized, timestamp: Date.now() });
    if (buffer.length > EVENT_BUFFER_MAX) {
      buffer.shift();
    }

    const channelClients = this.clients.get(channel);
    if (!channelClients) return;

    for (const res of channelClients) {
      try { res.write(`event: ${event}\ndata: ${serialized}\n\n`); } catch { /* closed */ }
    }
  }

  /**
   * Broadcast an event to ALL connected clients across all channels.
   */
  broadcastAll(event: string, data: unknown): void {
    for (const channelClients of this.clients.values()) {
      for (const res of channelClients) {
        sendSSE(res, event, data);
      }
    }
  }

  /**
   * Get the number of clients on a channel.
   */
  clientCount(channel: string): number {
    return this.clients.get(channel)?.size ?? 0;
  }

  /**
   * Shut down the manager — clear heartbeat and end all connections.
   */
  shutdown(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    for (const channelClients of this.clients.values()) {
      for (const res of channelClients) {
        try {
          res.end();
        } catch {
          // Already closed
        }
      }
    }
    this.clients.clear();
    this.eventBuffer.clear();
  }

  /**
   * Remove expired events from the buffer.
   */
  private pruneEventBuffer(): void {
    const cutoff = Date.now() - EVENT_BUFFER_TTL_MS;
    for (const [channel, buffer] of this.eventBuffer) {
      const pruned = buffer.filter((e) => e.timestamp > cutoff);
      if (pruned.length === 0) {
        this.eventBuffer.delete(channel);
      } else {
        this.eventBuffer.set(channel, pruned);
      }
    }
  }

  /**
   * Send heartbeat comment to all connected clients.
   */
  private sendHeartbeat(): void {
    for (const channelClients of this.clients.values()) {
      for (const res of channelClients) {
        try {
          res.write(':heartbeat\n\n');
        } catch {
          // Connection closed — will be cleaned up on next 'close' event
        }
      }
    }
  }
}

// ─── Shared Instance ──────────────────────────────────────────────────

let sharedManager: SSEConnectionManager | null = null;

/**
 * Set the shared SSE manager instance (called by web server on start/stop)
 */
export function setSharedSSEManager(manager: SSEConnectionManager | null): void {
  sharedManager = manager;
}

/**
 * Get the shared SSE manager instance.
 * Returns null if the web server is not running.
 */
export function getSharedSSEManager(): SSEConnectionManager | null {
  return sharedManager;
}

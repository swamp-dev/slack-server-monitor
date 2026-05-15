import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { logger } from '../utils/logger.js';
import { getEventBus } from './event-bus.js';

/**
 * Notification record
 */
export interface Notification {
  id: number;
  source: string;
  level: 'info' | 'warn' | 'error';
  title: string;
  body: string | null;
  link: string | null;
  createdAt: number;
  readAt: number | null;
}

/**
 * Notification level type
 */
export type NotificationLevel = 'info' | 'warn' | 'error';

/**
 * SQLite-backed notification store
 *
 * Provides persistent storage for system and plugin notifications.
 * Follows the same singleton pattern as ConversationStore.
 */
export class NotificationStore {
  private db: ReturnType<typeof Database>;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        level TEXT NOT NULL DEFAULT 'info',
        title TEXT NOT NULL,
        body TEXT,
        link TEXT,
        created_at INTEGER NOT NULL,
        read_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_notifications_unread
        ON notifications (read_at, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_notifications_recent
        ON notifications (created_at DESC);
    `);
    logger.debug('Notification store schema initialized');
  }

  /**
   * Create a new notification
   */
  createNotification(
    source: string,
    level: NotificationLevel,
    title: string,
    body?: string,
    link?: string,
  ): Notification {
    const now = Date.now();
    const result = this.db.prepare(`
      INSERT INTO notifications (source, level, title, body, link, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(source, level, title, body ?? null, link ?? null, now);

    const notification: Notification = {
      id: Number(result.lastInsertRowid),
      source,
      level,
      title,
      body: body ?? null,
      link: link ?? null,
      createdAt: now,
      readAt: null,
    };

    getEventBus().emit('notification:created', notification);

    return notification;
  }

  /**
   * Get unread notifications, most recent first
   */
  getUnread(limit = 50): Notification[] {
    const rows = this.db.prepare(`
      SELECT id, source, level, title, body, link, created_at, read_at
      FROM notifications
      WHERE read_at IS NULL
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).all(limit) as Record<string, unknown>[];

    return rows.map(mapRow);
  }

  /**
   * Get recent notifications (read and unread), most recent first
   */
  getRecent(limit = 50, offset = 0): Notification[] {
    const rows = this.db.prepare(`
      SELECT id, source, level, title, body, link, created_at, read_at
      FROM notifications
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset) as Record<string, unknown>[];

    return rows.map(mapRow);
  }

  /**
   * Mark a single notification as read
   * @returns true if the notification was marked (false if already read or not found)
   */
  markRead(id: number): boolean {
    const result = this.db.prepare(`
      UPDATE notifications SET read_at = ? WHERE id = ? AND read_at IS NULL
    `).run(Date.now(), id);

    if (result.changes > 0) {
      getEventBus().emit('notification:read', { id, unreadCount: this.countUnread() });
    }

    return result.changes > 0;
  }

  /**
   * Mark all unread notifications as read
   * @returns count of notifications marked
   */
  markAllRead(): number {
    const result = this.db.prepare(`
      UPDATE notifications SET read_at = ? WHERE read_at IS NULL
    `).run(Date.now());

    if (result.changes > 0) {
      getEventBus().emit('notification:all-read', { unreadCount: 0 });
    }

    return result.changes;
  }

  /**
   * Count unread notifications
   */
  countUnread(): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) as count FROM notifications WHERE read_at IS NULL
    `).get() as { count: number };

    return row.count;
  }

  /**
   * Delete read notifications older than the specified number of days
   * @returns count of deleted notifications
   */
  cleanup(olderThanDays: number): number {
    const cutoff = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
    const result = this.db.prepare(`
      DELETE FROM notifications WHERE read_at IS NOT NULL AND created_at < ?
    `).run(cutoff);

    if (result.changes > 0) {
      logger.info('Cleaned up old notifications', { count: result.changes });
    }

    return result.changes;
  }

  /**
   * Expose database for testing
   */
  getDatabase(): ReturnType<typeof Database> {
    return this.db;
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }
}

/**
 * Map a database row to a Notification object
 */
function mapRow(row: Record<string, unknown>): Notification {
  return {
    id: row.id as number,
    source: row.source as string,
    level: row.level as NotificationLevel,
    title: row.title as string,
    body: (row.body as string | null) ?? null,
    link: (row.link as string | null) ?? null,
    createdAt: row.created_at as number,
    readAt: (row.read_at as number | null) ?? null,
  };
}

// ─── Singleton ───────────────────────────────────────────────────────

let store: NotificationStore | null = null;

/**
 * Get the notification store singleton
 */
export function getNotificationStore(dbPath: string): NotificationStore {
  store ??= new NotificationStore(dbPath);
  return store;
}

/**
 * Close the notification store
 */
export function closeNotificationStore(): void {
  if (store) {
    store.close();
    store = null;
  }
}

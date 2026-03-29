import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { logger } from '../utils/logger.js';

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
 * SQLite-based notification store for cross-cutting alerts
 *
 * Used by both core and plugins (via PluginContext.notify()).
 */
export class NotificationStore {
  private db: Database.Database;

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
        ON notifications(read_at, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_notifications_created
        ON notifications(created_at DESC);
    `);

    logger.debug('Notification store schema initialized');
  }

  /**
   * Create a notification.
   */
  createNotification(
    source: string,
    level: 'info' | 'warn' | 'error',
    title: string,
    body?: string,
    link?: string,
  ): Notification {
    const now = Date.now();
    const result = this.db
      .prepare('INSERT INTO notifications (source, level, title, body, link, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(source, level, title, body ?? null, link ?? null, now);

    return {
      id: result.lastInsertRowid as number,
      source,
      level,
      title,
      body: body ?? null,
      link: link ?? null,
      createdAt: now,
      readAt: null,
    };
  }

  /**
   * Get unread notifications, most recent first.
   */
  getUnread(limit = 50): Notification[] {
    const rows = this.db
      .prepare('SELECT * FROM notifications WHERE read_at IS NULL ORDER BY created_at DESC, id DESC LIMIT ?')
      .all(limit) as Row[];

    return rows.map(toNotification);
  }

  /**
   * Get recent notifications (read and unread), most recent first.
   */
  getRecent(limit = 50): Notification[] {
    const rows = this.db
      .prepare('SELECT * FROM notifications ORDER BY created_at DESC, id DESC LIMIT ?')
      .all(limit) as Row[];

    return rows.map(toNotification);
  }

  /**
   * Mark a single notification as read.
   */
  markRead(notificationId: number): boolean {
    const result = this.db
      .prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND read_at IS NULL')
      .run(Date.now(), notificationId);
    return result.changes > 0;
  }

  /**
   * Mark all unread notifications as read. Returns count marked.
   */
  markAllRead(): number {
    const result = this.db
      .prepare('UPDATE notifications SET read_at = ? WHERE read_at IS NULL')
      .run(Date.now());
    return result.changes;
  }

  /**
   * Count unread notifications.
   */
  countUnread(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM notifications WHERE read_at IS NULL')
      .get() as { count: number };
    return row.count;
  }

  /**
   * Delete read notifications older than `days` days. Returns count deleted.
   */
  cleanup(days: number): number {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const result = this.db
      .prepare('DELETE FROM notifications WHERE read_at IS NOT NULL AND created_at < ?')
      .run(cutoff);

    if (result.changes > 0) {
      logger.info('Cleaned up old notifications', { count: result.changes });
    }
    return result.changes;
  }

  /**
   * Expose database for testing.
   */
  getDatabase(): Database.Database {
    return this.db;
  }

  close(): void {
    this.db.close();
  }
}

// ─── Row mapping ──────────────────────────────────────────────────────

interface Row {
  id: number;
  source: string;
  level: string;
  title: string;
  body: string | null;
  link: string | null;
  created_at: number;
  read_at: number | null;
}

function toNotification(row: Row): Notification {
  return {
    id: row.id,
    source: row.source,
    level: row.level as 'info' | 'warn' | 'error',
    title: row.title,
    body: row.body,
    link: row.link,
    createdAt: row.created_at,
    readAt: row.read_at,
  };
}

// ─── Singleton ────────────────────────────────────────────────────────

let store: NotificationStore | null = null;

/**
 * Get the notification store singleton.
 */
export function getNotificationStore(dbPath: string): NotificationStore {
  store ??= new NotificationStore(dbPath);
  return store;
}

/**
 * Close the notification store.
 */
export function closeNotificationStore(): void {
  if (store) {
    store.close();
    store = null;
  }
}

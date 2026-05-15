import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { logger } from '../utils/logger.js';

/**
 * Channel context selection record
 */
export interface ChannelContext {
  channelId: string;
  contextAlias: string;
  updatedAt: number;
}

/**
 * SQLite-based store for channel context selections
 * Uses the same database as conversation store
 */
export class ContextStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    // Ensure directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initSchema();
  }

  /**
   * Initialize database schema for channel context
   */
  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS channel_context (
        channel_id TEXT PRIMARY KEY,
        context_alias TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    logger.debug('Context store schema initialized');
  }

  /**
   * Get the context alias for a channel
   */
  getChannelContext(channelId: string): string | null {
    const row = this.db
      .prepare('SELECT context_alias FROM channel_context WHERE channel_id = ?')
      .get(channelId) as { context_alias: string } | undefined;

    return row?.context_alias ?? null;
  }

  /**
   * Set the context alias for a channel
   */
  setChannelContext(channelId: string, contextAlias: string): void {
    const now = Date.now();
    this.db
      .prepare(`
        INSERT INTO channel_context (channel_id, context_alias, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(channel_id) DO UPDATE SET context_alias = ?, updated_at = ?
      `)
      .run(channelId, contextAlias, now, contextAlias, now);

    logger.info('Channel context set', { channelId, contextAlias });
  }

  /**
   * Clear the context selection for a channel
   */
  clearChannelContext(channelId: string): boolean {
    const result = this.db
      .prepare('DELETE FROM channel_context WHERE channel_id = ?')
      .run(channelId);

    if (result.changes > 0) {
      logger.info('Channel context cleared', { channelId });
      return true;
    }
    return false;
  }

  /**
   * Get all channel context selections
   */
  getAllChannelContexts(): ChannelContext[] {
    const rows = this.db
      .prepare('SELECT channel_id, context_alias, updated_at FROM channel_context')
      .all() as { channel_id: string; context_alias: string; updated_at: number }[];

    return rows.map((row) => ({
      channelId: row.channel_id,
      contextAlias: row.context_alias,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }
}

// Singleton instance - lazily initialized
let store: ContextStore | null = null;

/**
 * Get the context store singleton
 */
export function getContextStore(dbPath: string): ContextStore {
  store ??= new ContextStore(dbPath);
  return store;
}

/**
 * Close the context store
 */
export function closeContextStore(): void {
  if (store) {
    store.close();
    store = null;
  }
}

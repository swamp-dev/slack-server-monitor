import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { logger } from '../utils/logger.js';
import { createStoreSingleton } from './store-factory.js';

/**
 * Quick link record
 */
export interface QuickLink {
  id: number;
  userId: string;
  title: string;
  url: string;
  icon: string | null;
  position: number;
  createdAt: number;
}

/**
 * SQLite-backed quick links store
 *
 * Per-user bookmarks for the dashboard.
 * Follows the same singleton pattern as other stores.
 */
export class QuickLinksStore {
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
      CREATE TABLE IF NOT EXISTS quick_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        icon TEXT,
        position INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_quick_links_user
        ON quick_links (user_id, position);
    `);
    logger.debug('Quick links store schema initialized');
  }

  /**
   * Add a quick link for a user
   */
  addLink(userId: string, title: string, url: string, icon?: string): QuickLink {
    const now = Date.now();
    // Set position to max+1 for this user
    const maxPos = this.db.prepare(
      'SELECT COALESCE(MAX(position), -1) as maxPos FROM quick_links WHERE user_id = ?'
    ).get(userId) as { maxPos: number };
    const position = maxPos.maxPos + 1;

    const result = this.db.prepare(`
      INSERT INTO quick_links (user_id, title, url, icon, position, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, title, url, icon ?? null, position, now);

    return {
      id: Number(result.lastInsertRowid),
      userId,
      title,
      url,
      icon: icon ?? null,
      position,
      createdAt: now,
    };
  }

  /**
   * Remove a quick link (must belong to the user)
   * @returns true if deleted
   */
  removeLink(userId: string, linkId: number): boolean {
    const result = this.db.prepare(
      'DELETE FROM quick_links WHERE id = ? AND user_id = ?'
    ).run(linkId, userId);

    return result.changes > 0;
  }

  /**
   * Get all quick links for a user, ordered by position
   */
  getLinks(userId: string): QuickLink[] {
    const rows = this.db.prepare(`
      SELECT id, user_id, title, url, icon, position, created_at
      FROM quick_links
      WHERE user_id = ?
      ORDER BY position ASC, id ASC
    `).all(userId) as Record<string, unknown>[];

    return rows.map(mapRow);
  }

  /**
   * Reorder quick links by providing an ordered array of IDs
   * Only updates links belonging to the specified user.
   * @returns number of links reordered
   */
  reorderLinks(userId: string, orderedIds: number[]): number {
    let updated = 0;
    const stmt = this.db.prepare(
      'UPDATE quick_links SET position = ? WHERE id = ? AND user_id = ?'
    );

    const runAll = this.db.transaction(() => {
      for (let i = 0; i < orderedIds.length; i++) {
        const result = stmt.run(i, orderedIds[i], userId);
        updated += result.changes;
      }
    });
    runAll();

    return updated;
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
 * Map a database row to a QuickLink object
 */
function mapRow(row: Record<string, unknown>): QuickLink {
  return {
    id: row.id as number,
    userId: row.user_id as string,
    title: row.title as string,
    url: row.url as string,
    icon: (row.icon as string | null) ?? null,
    position: row.position as number,
    createdAt: row.created_at as number,
  };
}

// ─── Singleton ───────────────────────────────────────────────────────

const quickLinksSingleton = createStoreSingleton<QuickLinksStore>('QuickLinksStore');

export function getQuickLinksStore(dbPath: string): QuickLinksStore {
  return quickLinksSingleton.get(dbPath, () => new QuickLinksStore(dbPath));
}

export function closeQuickLinksStore(): void {
  quickLinksSingleton.close();
}

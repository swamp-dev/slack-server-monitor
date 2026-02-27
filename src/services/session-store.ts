import crypto from 'crypto';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { logger } from '../utils/logger.js';

/**
 * Web session record
 */
export interface WebSession {
  sessionId: string;
  userId: string;
  isAdmin: boolean;
  createdAt: number;
  expiresAt: number;
}

/**
 * SQLite-based session store for web UI authentication
 * Uses the same database as conversation store
 */
export class SessionStore {
  private db: Database.Database;
  private ttlHours: number;

  constructor(dbPath: string, ttlHours = 72) {
    this.ttlHours = ttlHours;

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
   * Initialize database schema for sessions
   */
  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS web_sessions (
        session_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        is_admin INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_web_sessions_expires
        ON web_sessions(expires_at);
    `);

    logger.debug('Session store schema initialized');
  }

  /**
   * Create a new session
   */
  createSession(userId: string, isAdmin: boolean): WebSession {
    const sessionId = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    const expiresAt = now + this.ttlHours * 60 * 60 * 1000;

    this.db
      .prepare(`
        INSERT INTO web_sessions (session_id, user_id, is_admin, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(sessionId, userId, isAdmin ? 1 : 0, now, expiresAt);

    logger.debug('Session created', { userId, isAdmin });

    return { sessionId, userId, isAdmin, createdAt: now, expiresAt };
  }

  /**
   * Get a valid (non-expired) session by ID
   * Returns null if session doesn't exist or is expired
   */
  getSession(sessionId: string): WebSession | null {
    const now = Date.now();
    const row = this.db
      .prepare('SELECT * FROM web_sessions WHERE session_id = ? AND expires_at > ?')
      .get(sessionId, now) as {
        session_id: string;
        user_id: string;
        is_admin: number;
        created_at: number;
        expires_at: number;
      } | undefined;

    if (!row) {
      return null;
    }

    return {
      sessionId: row.session_id,
      userId: row.user_id,
      isAdmin: row.is_admin !== 0,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  }

  /**
   * Delete a session
   */
  deleteSession(sessionId: string): void {
    this.db
      .prepare('DELETE FROM web_sessions WHERE session_id = ?')
      .run(sessionId);
  }

  /**
   * Remove all expired sessions
   * Returns the number of sessions cleaned up
   */
  cleanupExpired(): number {
    const now = Date.now();
    const result = this.db
      .prepare('DELETE FROM web_sessions WHERE expires_at <= ?')
      .run(now);

    if (result.changes > 0) {
      logger.info('Cleaned up expired web sessions', { count: result.changes });
    }

    return result.changes;
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }
}

// Singleton instance
let store: SessionStore | null = null;

/**
 * Get the session store singleton
 */
export function getSessionStore(dbPath: string, ttlHours = 72): SessionStore {
  store ??= new SessionStore(dbPath, ttlHours);
  return store;
}

/**
 * Close the session store
 */
export function closeSessionStore(): void {
  if (store) {
    store.close();
    store = null;
  }
}

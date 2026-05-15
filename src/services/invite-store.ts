import crypto from 'crypto';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { z } from 'zod';
import { logger } from '../utils/logger.js';
import {
  SlackUserIdSchema,
  UserRoleSchema,
  type UserRole,
} from '../types/user.js';

const CleanupRetentionMs = 7 * 24 * 60 * 60 * 1000;
const DefaultTtlHours = 72;

const TtlHoursSchema = z.number().int().positive();

export interface InviteCode {
  code: string;
  createdBy: number;
  role: UserRole;
  slackUserId: string | null;
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
  usedBy: number | null;
}

export interface CreateInviteOptions {
  role?: UserRole;
  slackUserId?: string;
  ttlHours?: number;
}

interface InviteRow {
  code: string;
  created_by: number;
  role: string;
  slack_user_id: string | null;
  created_at: number;
  expires_at: number;
  used_at: number | null;
  used_by: number | null;
}

export class InviteStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS invite_codes (
        code TEXT PRIMARY KEY,
        created_by INTEGER NOT NULL,
        role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin', 'user')),
        slack_user_id TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at INTEGER,
        used_by INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_invites_expires ON invite_codes(expires_at);
      CREATE INDEX IF NOT EXISTS idx_invites_used ON invite_codes(used_at);
    `);
    logger.debug('Invite store schema initialized');
  }

  createInvite(createdBy: number, opts: CreateInviteOptions = {}): InviteCode {
    const role = opts.role !== undefined ? UserRoleSchema.parse(opts.role) : 'user';
    const slackUserId = opts.slackUserId !== undefined
      ? SlackUserIdSchema.parse(opts.slackUserId)
      : null;
    const ttlHours = opts.ttlHours !== undefined
      ? TtlHoursSchema.parse(opts.ttlHours)
      : DefaultTtlHours;

    const code = crypto.randomBytes(16).toString('hex');
    const now = Date.now();
    const expiresAt = now + ttlHours * 60 * 60 * 1000;

    this.db
      .prepare(
        `INSERT INTO invite_codes (code, created_by, role, slack_user_id, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(code, createdBy, role, slackUserId, now, expiresAt);

    return {
      code,
      createdBy,
      role,
      slackUserId,
      createdAt: now,
      expiresAt,
      usedAt: null,
      usedBy: null,
    };
  }

  getInvite(code: string): InviteCode | null {
    const row = this.db
      .prepare('SELECT * FROM invite_codes WHERE code = ?')
      .get(code) as InviteRow | undefined;
    return row ? mapRow(row) : null;
  }

  /**
   * Atomically claim an invite. The UPDATE only matches when the invite
   * is unused and not yet expired, so concurrent redeem attempts are
   * guaranteed to mark only one winner — the loser sees `result.changes === 0`
   * and gets `null`, regardless of interleaving.
   *
   * The follow-up `getInvite` re-reads the row to return its full state.
   * That assumes no concurrent writer deletes the row between the two
   * statements; in practice only `deleteInvite` and `cleanupExpired` do
   * that, and neither can target a just-redeemed row (cleanup retains
   * settled invites for 7 days; deleteInvite is admin-driven).
   */
  redeemInvite(code: string, redeemedBy: number): InviteCode | null {
    const now = Date.now();
    const result = this.db
      .prepare(
        `UPDATE invite_codes
         SET used_at = ?, used_by = ?
         WHERE code = ? AND used_at IS NULL AND expires_at > ?`,
      )
      .run(now, redeemedBy, code, now);

    if (result.changes === 0) return null;
    return this.getInvite(code);
  }

  listActive(): InviteCode[] {
    const now = Date.now();
    const rows = this.db
      .prepare(
        `SELECT * FROM invite_codes
         WHERE used_at IS NULL AND expires_at > ?
         ORDER BY created_at DESC`,
      )
      .all(now) as InviteRow[];
    return rows.map(mapRow);
  }

  listAll(): InviteCode[] {
    const rows = this.db
      .prepare('SELECT * FROM invite_codes ORDER BY created_at DESC')
      .all() as InviteRow[];
    return rows.map(mapRow);
  }

  deleteInvite(code: string): void {
    this.db.prepare('DELETE FROM invite_codes WHERE code = ?').run(code);
  }

  /**
   * Remove invites that have been "settled" for more than 7 days. Two arms:
   * - Used invites whose `used_at` is older than 7 days (audit window).
   * - Unused invites whose `expires_at` passed more than 7 days ago.
   * Recently-used and recently-expired invites are retained so an admin
   * can audit redemptions and recent expiries.
   */
  cleanupExpired(): number {
    const cutoff = Date.now() - CleanupRetentionMs;
    const result = this.db
      .prepare(
        `DELETE FROM invite_codes
         WHERE (used_at IS NOT NULL AND used_at <= ?)
            OR (used_at IS NULL AND expires_at <= ?)`,
      )
      .run(cutoff, cutoff);
    if (result.changes > 0) {
      logger.info('Cleaned up old invite codes', { count: result.changes });
    }
    return result.changes;
  }

  getDatabase(): Database.Database {
    return this.db;
  }

  close(): void {
    this.db.close();
  }
}

function mapRow(row: InviteRow): InviteCode {
  return {
    code: row.code,
    createdBy: row.created_by,
    role: row.role as UserRole,
    slackUserId: row.slack_user_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    usedBy: row.used_by,
  };
}

let store: InviteStore | null = null;
let storeDbPath: string | null = null;

export function getInviteStore(dbPath: string): InviteStore {
  if (store && storeDbPath !== dbPath) {
    throw new Error(
      `InviteStore already initialized at ${storeDbPath ?? '<unknown>'} — ` +
        `cannot re-initialize at ${dbPath}. Call closeInviteStore() first.`,
    );
  }
  if (!store) {
    store = new InviteStore(dbPath);
    storeDbPath = dbPath;
  }
  return store;
}

export function closeInviteStore(): void {
  if (store) {
    store.close();
    store = null;
    storeDbPath = null;
  }
}

import crypto from 'crypto';
import { promisify } from 'util';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { logger } from '../utils/logger.js';
import {
  CreateUserInputSchema,
  PasswordSchema,
  SlackUserIdSchema,
  UserRoleSchema,
  UsernameSchema,
  type CreateUserInput,
  type UpdateProfileInput,
  type User,
  type UserRole,
} from '../types/user.js';

const scryptAsync = promisify(crypto.scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

const SCRYPT_KEY_LEN = 64;
const SCRYPT_SALT_BYTES = 32;
export const WEB_IDENTITY_PREFIX = 'web:';

interface UserRow {
  id: number;
  slack_id: string | null;
  username: string | null;
  password_hash: string | null;
  display_name: string | null;
  role: string;
  is_active: number;
  created_at: number;
  updated_at: number;
}

export class UserStore {
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
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slack_id TEXT,
        username TEXT COLLATE NOCASE,
        password_hash TEXT,
        display_name TEXT,
        role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin', 'user')),
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_slack_id
        ON users(slack_id) WHERE slack_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username
        ON users(username) WHERE username IS NOT NULL;
    `);
    logger.debug('User store schema initialized');
  }

  async create(input: CreateUserInput): Promise<User> {
    const parsed = CreateUserInputSchema.parse(input);
    const passwordHash = parsed.password
      ? await hashPassword(parsed.password)
      : null;
    const now = Date.now();

    const result = this.db
      .prepare(
        `INSERT INTO users (slack_id, username, password_hash, display_name, role, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(
        parsed.slackId ?? null,
        parsed.username ?? null,
        passwordHash,
        parsed.displayName ?? null,
        parsed.role,
        now,
        now,
      );

    const created = this.getById(Number(result.lastInsertRowid));
    if (!created) {
      throw new Error('Failed to load just-created user');
    }
    return created;
  }

  getById(id: number): User | null {
    const row = this.db
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(id) as UserRow | undefined;
    return row ? mapRow(row) : null;
  }

  getBySlackId(slackId: string): User | null {
    const row = this.db
      .prepare('SELECT * FROM users WHERE slack_id = ?')
      .get(slackId) as UserRow | undefined;
    return row ? mapRow(row) : null;
  }

  getByUsername(username: string): User | null {
    const row = this.db
      .prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE')
      .get(username) as UserRow | undefined;
    return row ? mapRow(row) : null;
  }

  /**
   * Verify a username/password pair.
   *
   * Always performs a scrypt computation even when the user is missing or
   * has no password hash, to keep timing roughly constant and avoid
   * leaking whether an account exists.
   */
  async verifyPassword(username: string, password: string): Promise<User | null> {
    const row = this.db
      .prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE')
      .get(username) as UserRow | undefined;

    const hashToCompare = row?.password_hash ?? DUMMY_HASH;
    const ok = await verifyPasswordHash(password, hashToCompare);

    if (!row?.password_hash || !ok || row.is_active === 0) {
      return null;
    }
    return mapRow(row);
  }

  updateRole(id: number, role: string): void {
    const validated = UserRoleSchema.parse(role);
    this.db
      .prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?')
      .run(validated, Date.now(), id);
  }

  /**
   * Atomically demote a user, refusing to leave the table with zero active
   * admins. Returns true if the role changed, false if the demotion would
   * have stranded the system without an admin (TOCTOU-safe — the count
   * check and the UPDATE happen in one statement).
   */
  demoteIfNotLastAdmin(id: number, newRole: 'user'): boolean {
    UserRoleSchema.parse(newRole);
    const result = this.db
      .prepare(`
        UPDATE users SET role = ?, updated_at = ?
        WHERE id = ?
          AND (
            role != 'admin'
            OR (SELECT COUNT(*) FROM users WHERE role = 'admin' AND is_active = 1) > 1
          )
      `)
      .run(newRole, Date.now(), id);
    return result.changes > 0;
  }

  /**
   * Atomically delete a user, refusing to leave the table with zero active
   * admins. Returns true if the row was deleted, false if the delete would
   * have stranded the system without an admin or the user does not exist.
   */
  deleteIfNotLastAdmin(id: number): boolean {
    const result = this.db
      .prepare(`
        DELETE FROM users
        WHERE id = ?
          AND (
            role != 'admin'
            OR (SELECT COUNT(*) FROM users WHERE role = 'admin' AND is_active = 1) > 1
          )
      `)
      .run(id);
    return result.changes > 0;
  }

  updateProfile(id: number, updates: UpdateProfileInput): void {
    const fields: string[] = [];
    const values: (string | null)[] = [];

    if ('displayName' in updates) {
      fields.push('display_name = ?');
      values.push(updates.displayName ?? null);
    }
    if ('slackId' in updates) {
      const slackId = updates.slackId ?? null;
      if (slackId !== null) SlackUserIdSchema.parse(slackId);
      fields.push('slack_id = ?');
      values.push(slackId);
    }
    if ('username' in updates) {
      const username = updates.username ?? null;
      if (username !== null) UsernameSchema.parse(username);
      fields.push('username = ?');
      values.push(username);
    }

    if (fields.length === 0) return;

    fields.push('updated_at = ?');
    const sql = `UPDATE users SET ${fields.join(', ')} WHERE id = ?`;
    this.db.prepare(sql).run(...values, Date.now(), id);
  }

  async updatePassword(id: number, newPassword: string): Promise<void> {
    PasswordSchema.parse(newPassword);
    const hash = await hashPassword(newPassword);
    this.db
      .prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
      .run(hash, Date.now(), id);
  }

  /**
   * Hard-delete a user by primary key. Used by routes that have already
   * decided the deletion is safe (e.g. rolling back a half-finished
   * registration when an invite redeem races and loses).
   */
  deleteById(id: number): void {
    this.db.prepare('DELETE FROM users WHERE id = ?').run(id);
  }

  deactivate(id: number): void {
    this.db
      .prepare('UPDATE users SET is_active = 0, updated_at = ? WHERE id = ?')
      .run(Date.now(), id);
  }

  activate(id: number): void {
    this.db
      .prepare('UPDATE users SET is_active = 1, updated_at = ? WHERE id = ?')
      .run(Date.now(), id);
  }

  /**
   * Seed the users table from a list of Slack IDs. Idempotent: if the table
   * already has any rows, this is a no-op. Otherwise the first valid ID
   * becomes admin and the rest are regular users.
   *
   * Invalid Slack IDs are skipped (logged + reported in the result) so a
   * single typo in env config doesn't block the rest of the seed. The
   * actual inserts run inside a single SQLite transaction so a crash
   * mid-loop can't leave a partial seed behind (which would leave the
   * table non-empty and cause subsequent bootstraps to no-op).
   */
  bootstrap(slackIds: string[]): { created: number; skipped: string[] } {
    const skipped: string[] = [];
    if (slackIds.length === 0) return { created: 0, skipped };

    const existing = this.db
      .prepare('SELECT COUNT(*) AS n FROM users')
      .get() as { n: number };
    if (existing.n > 0) {
      logger.debug('Bootstrap skipped — users table already populated', {
        existingCount: existing.n,
      });
      return { created: 0, skipped };
    }

    const valid: string[] = [];
    for (const id of slackIds) {
      if (SlackUserIdSchema.safeParse(id).success) {
        valid.push(id);
      } else {
        skipped.push(id);
        logger.warn('Bootstrap skipping invalid Slack ID', { slackId: id });
      }
    }
    if (valid.length === 0) return { created: 0, skipped };

    const insert = this.db.prepare(
      `INSERT INTO users (slack_id, username, password_hash, display_name, role, is_active, created_at, updated_at)
       VALUES (?, NULL, NULL, NULL, ?, 1, ?, ?)`,
    );
    const seedAll = this.db.transaction((rows: { slackId: string; role: UserRole }[]) => {
      const now = Date.now();
      for (const row of rows) {
        insert.run(row.slackId, row.role, now, now);
      }
    });
    const rows: { slackId: string; role: UserRole }[] = valid.map((slackId, i) => ({
      slackId,
      role: i === 0 ? 'admin' : 'user',
    }));
    seedAll(rows);

    logger.info('Bootstrapped users from Slack ID list', {
      created: rows.length,
      adminId: valid[0],
      skippedCount: skipped.length,
    });
    return { created: rows.length, skipped };
  }

  listAll(): User[] {
    const rows = this.db
      .prepare('SELECT * FROM users ORDER BY id ASC')
      .all() as UserRow[];
    return rows.map(mapRow);
  }

  countByRole(role: string): number {
    const validated = UserRoleSchema.parse(role);
    const result = this.db
      .prepare('SELECT COUNT(*) AS n FROM users WHERE role = ? AND is_active = 1')
      .get(validated) as { n: number };
    return result.n;
  }

  /**
   * Resolve a session userId to all identity strings the user can see
   * conversations under. Admins return undefined (no filter = see all).
   *
   * userId formats:
   * - `web:<username>` for password-auth web sessions
   * - `U...` (Slack user ID) for Slack-linked sessions
   *
   * If the user is unknown, returns the input as a single-element array
   * so callers always get a valid filter.
   */
  resolveIdentities(userId: string): string[] | undefined {
    const user = userId.startsWith(WEB_IDENTITY_PREFIX)
      ? this.getByUsername(userId.slice(WEB_IDENTITY_PREFIX.length))
      : this.getBySlackId(userId);

    if (user?.role === 'admin') return undefined;
    if (!user) return [userId];

    const identities: string[] = [userId];
    if (userId.startsWith(WEB_IDENTITY_PREFIX) && user.slackId) {
      identities.push(user.slackId);
    } else if (!userId.startsWith(WEB_IDENTITY_PREFIX) && user.username) {
      identities.push(`${WEB_IDENTITY_PREFIX}${user.username}`);
    }
    return identities;
  }

  getDatabase(): Database.Database {
    return this.db;
  }

  close(): void {
    this.db.close();
  }
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(SCRYPT_SALT_BYTES);
  const derived = await scryptAsync(password, salt, SCRYPT_KEY_LEN);
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

async function verifyPasswordHash(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltHex, 'hex');
    expected = Buffer.from(hashHex, 'hex');
  } catch {
    return false;
  }
  if (expected.length !== SCRYPT_KEY_LEN) return false;

  const derived = await scryptAsync(password, salt, SCRYPT_KEY_LEN);
  return crypto.timingSafeEqual(derived, expected);
}

// Pre-computed dummy hash used to keep verifyPassword timing roughly constant
// when the lookup misses or the user has no password set, so an attacker can't
// distinguish those cases by response time. Salt and password are random and
// discarded — only the resulting hash matters, so an attacker can never produce
// a password that "matches" it via timingSafeEqual.
const DUMMY_HASH = (() => {
  const salt = crypto.randomBytes(SCRYPT_SALT_BYTES);
  const derived = crypto.scryptSync(crypto.randomBytes(48), salt, SCRYPT_KEY_LEN);
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
})();

function mapRow(row: UserRow): User {
  return {
    id: row.id,
    slackId: row.slack_id,
    username: row.username,
    displayName: row.display_name,
    role: row.role as UserRole,
    isActive: row.is_active !== 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Resolve the configured user-store DB path. Single source of truth shared
 * between app startup (bootstrap) and the authorize middleware so both
 * always refer to the same SQLite file.
 *
 * Auth must work whether or not Claude is configured. When Claude is enabled
 * the user store shares its database; otherwise it falls back to a default
 * `./data/users.db` so the bot can still authorize slash commands.
 */
export function resolveUserStoreDbPath(claudeDbPath: string | undefined): string {
  return claudeDbPath ?? './data/users.db';
}

let store: UserStore | null = null;
let storeDbPath: string | null = null;

export function getUserStore(dbPath: string): UserStore {
  if (store && storeDbPath !== dbPath) {
    throw new Error(
      `UserStore already initialized at ${storeDbPath ?? '<unknown>'} — ` +
        `cannot re-initialize at ${dbPath}. Call closeUserStore() first.`,
    );
  }
  if (!store) {
    store = new UserStore(dbPath);
    storeDbPath = dbPath;
  }
  return store;
}

export function closeUserStore(): void {
  if (store) {
    store.close();
    store = null;
    storeDbPath = null;
  }
}

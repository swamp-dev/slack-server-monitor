import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { UserStore, getUserStore, closeUserStore } from '../../src/services/user-store.js';

describe('UserStore', () => {
  let store: UserStore;
  let testDbPath: string;

  beforeEach(() => {
    testDbPath = path.join(os.tmpdir(), `test-users-${String(Date.now())}-${String(Math.random()).slice(2, 8)}.db`);
    store = new UserStore(testDbPath);
  });

  afterEach(() => {
    store.close();
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        fs.unlinkSync(testDbPath + suffix);
      } catch {
        // ok
      }
    }
  });

  describe('create', () => {
    it('creates a Slack-only user', async () => {
      const user = await store.create({ slackId: 'U01ABC' });
      expect(user.id).toBeGreaterThan(0);
      expect(user.slackId).toBe('U01ABC');
      expect(user.username).toBeNull();
      expect(user.role).toBe('user');
      expect(user.isActive).toBe(true);
      expect(user.createdAt).toBeGreaterThan(0);
    });

    it('creates a username/password user', async () => {
      const user = await store.create({
        username: 'alice',
        password: 'hunter2hunter',
      });
      expect(user.username).toBe('alice');
      expect(user.slackId).toBeNull();
    });

    it('creates a user linked to both Slack and a username/password', async () => {
      const user = await store.create({
        slackId: 'U01ABC',
        username: 'alice',
        password: 'hunter2hunter',
        displayName: 'Alice',
        role: 'admin',
      });
      expect(user.slackId).toBe('U01ABC');
      expect(user.username).toBe('alice');
      expect(user.displayName).toBe('Alice');
      expect(user.role).toBe('admin');
    });

    it('rejects when neither slackId nor username is provided', async () => {
      await expect(store.create({} as never)).rejects.toThrow();
    });

    it('rejects when username is provided without password', async () => {
      await expect(store.create({ username: 'alice' } as never)).rejects.toThrow();
    });

    it('rejects invalid Slack user ID format', async () => {
      await expect(store.create({ slackId: 'invalid' } as never)).rejects.toThrow();
    });

    it('rejects username with invalid characters', async () => {
      await expect(
        store.create({ username: '1bad', password: 'longenough' } as never),
      ).rejects.toThrow();
    });

    it('rejects password shorter than 8 characters', async () => {
      await expect(
        store.create({ username: 'alice', password: 'short' } as never),
      ).rejects.toThrow();
    });

    it('rejects duplicate slack_id', async () => {
      await store.create({ slackId: 'U01ABC' });
      await expect(store.create({ slackId: 'U01ABC' })).rejects.toThrow();
    });

    it('rejects duplicate username (case-insensitive)', async () => {
      await store.create({ username: 'alice', password: 'longenough' });
      await expect(
        store.create({ username: 'ALICE', password: 'longenough' }),
      ).rejects.toThrow();
    });
  });

  describe('lookup methods', () => {
    it('getById returns user by primary key', async () => {
      const created = await store.create({ slackId: 'U01ABC' });
      const found = store.getById(created.id);
      expect(found?.id).toBe(created.id);
    });

    it('getById returns null for unknown id', () => {
      expect(store.getById(9999)).toBeNull();
    });

    it('getBySlackId returns the user', async () => {
      await store.create({ slackId: 'U01ABC', displayName: 'Alice' });
      const found = store.getBySlackId('U01ABC');
      expect(found?.displayName).toBe('Alice');
    });

    it('getBySlackId returns null for unknown id', () => {
      expect(store.getBySlackId('U99XYZ')).toBeNull();
    });

    it('getByUsername is case-insensitive', async () => {
      await store.create({ username: 'alice', password: 'longenough' });
      expect(store.getByUsername('ALICE')?.username).toBe('alice');
      expect(store.getByUsername('Alice')?.username).toBe('alice');
    });

    it('getByUsername returns null for unknown user', () => {
      expect(store.getByUsername('nobody')).toBeNull();
    });
  });

  describe('verifyPassword', () => {
    it('returns the user for correct credentials', async () => {
      await store.create({ username: 'alice', password: 'correct-horse' });
      const result = await store.verifyPassword('alice', 'correct-horse');
      expect(result?.username).toBe('alice');
    });

    it('returns null for wrong password', async () => {
      await store.create({ username: 'alice', password: 'correct-horse' });
      const result = await store.verifyPassword('alice', 'wrong-password');
      expect(result).toBeNull();
    });

    it('returns null for unknown user (timing-safe path)', async () => {
      const result = await store.verifyPassword('nobody', 'whatever-pwd');
      expect(result).toBeNull();
    });

    it('returns null for inactive user even with correct password', async () => {
      const user = await store.create({ username: 'alice', password: 'correct-horse' });
      store.deactivate(user.id);
      const result = await store.verifyPassword('alice', 'correct-horse');
      expect(result).toBeNull();
    });

    it('returns null for Slack-only user (no password set)', async () => {
      await store.create({ slackId: 'U01ABC' });
      const result = await store.verifyPassword('U01ABC', 'anything-here');
      expect(result).toBeNull();
    });

    it('is case-insensitive on username', async () => {
      await store.create({ username: 'alice', password: 'correct-horse' });
      const result = await store.verifyPassword('ALICE', 'correct-horse');
      expect(result?.username).toBe('alice');
    });
  });

  describe('updateRole', () => {
    it('updates a user role', async () => {
      const u = await store.create({ slackId: 'U01ABC' });
      store.updateRole(u.id, 'admin');
      expect(store.getById(u.id)?.role).toBe('admin');
    });

    it('rejects invalid role', async () => {
      const u = await store.create({ slackId: 'U01ABC' });
      expect(() => store.updateRole(u.id, 'superuser' as never)).toThrow();
    });
  });

  describe('updateProfile', () => {
    it('updates display name', async () => {
      const u = await store.create({ slackId: 'U01ABC' });
      store.updateProfile(u.id, { displayName: 'Alice' });
      expect(store.getById(u.id)?.displayName).toBe('Alice');
    });

    it('links a Slack ID to an existing username user', async () => {
      const u = await store.create({ username: 'alice', password: 'longenough' });
      store.updateProfile(u.id, { slackId: 'U01ABC' });
      expect(store.getById(u.id)?.slackId).toBe('U01ABC');
    });

    it('clears a field when set to null', async () => {
      const u = await store.create({ slackId: 'U01ABC', displayName: 'Alice' });
      store.updateProfile(u.id, { displayName: null });
      expect(store.getById(u.id)?.displayName).toBeNull();
    });

    it('rejects invalid slack id', async () => {
      const u = await store.create({ username: 'alice', password: 'longenough' });
      expect(() => store.updateProfile(u.id, { slackId: 'bad' })).toThrow();
    });

    it('is a no-op when called with an empty update object', async () => {
      const u = await store.create({ slackId: 'U01ABC', displayName: 'Alice' });
      const before = store.getById(u.id);
      store.updateProfile(u.id, {});
      const after = store.getById(u.id);
      expect(after?.displayName).toBe(before?.displayName);
      expect(after?.updatedAt).toBe(before?.updatedAt);
    });
  });

  describe('updatePassword', () => {
    it('rehashes password with new salt', async () => {
      const u = await store.create({ username: 'alice', password: 'old-password' });
      await store.updatePassword(u.id, 'new-password-456');
      expect(await store.verifyPassword('alice', 'old-password')).toBeNull();
      expect(await store.verifyPassword('alice', 'new-password-456')).not.toBeNull();
    });

    it('rejects password shorter than 8 characters', async () => {
      const u = await store.create({ username: 'alice', password: 'longenough' });
      await expect(store.updatePassword(u.id, 'short')).rejects.toThrow();
    });
  });

  describe('deactivate / activate', () => {
    it('deactivate sets is_active to false', async () => {
      const u = await store.create({ slackId: 'U01ABC' });
      store.deactivate(u.id);
      expect(store.getById(u.id)?.isActive).toBe(false);
    });

    it('activate restores is_active to true', async () => {
      const u = await store.create({ slackId: 'U01ABC' });
      store.deactivate(u.id);
      store.activate(u.id);
      expect(store.getById(u.id)?.isActive).toBe(true);
    });
  });

  describe('bootstrap', () => {
    it('seeds an empty table with the first id as admin and the rest as users', () => {
      const result = store.bootstrap(['U01ABC', 'U02DEF', 'U03GHI']);
      expect(result.created).toBe(3);
      expect(store.getBySlackId('U01ABC')?.role).toBe('admin');
      expect(store.getBySlackId('U02DEF')?.role).toBe('user');
      expect(store.getBySlackId('U03GHI')?.role).toBe('user');
    });

    it('is a no-op when the table is already populated', async () => {
      await store.create({ slackId: 'U99XYZ', role: 'user' });
      const result = store.bootstrap(['U01ABC', 'U02DEF']);
      expect(result.created).toBe(0);
      expect(store.getBySlackId('U01ABC')).toBeNull();
      expect(store.getBySlackId('U99XYZ')?.role).toBe('user');
    });

    it('does nothing when the input is empty', () => {
      const result = store.bootstrap([]);
      expect(result.created).toBe(0);
      expect(store.listAll()).toHaveLength(0);
    });

    it('skips invalid Slack IDs and logs them but still seeds valid ones', () => {
      const result = store.bootstrap(['U01ABC', 'not-a-slack-id', 'U02DEF']);
      expect(result.created).toBe(2);
      expect(result.skipped).toEqual(['not-a-slack-id']);
      expect(store.getBySlackId('U01ABC')?.role).toBe('admin');
      expect(store.getBySlackId('U02DEF')?.role).toBe('user');
    });

    it('promotes the first valid id to admin even when earlier ids are skipped', () => {
      const result = store.bootstrap(['bad', 'U01ABC', 'U02DEF']);
      expect(result.created).toBe(2);
      expect(store.getBySlackId('U01ABC')?.role).toBe('admin');
      expect(store.getBySlackId('U02DEF')?.role).toBe('user');
    });

    it('inserts atomically — a duplicate slack_id later in the list rolls back earlier rows', () => {
      // The list contains a duplicate; the unique index on slack_id should
      // make the second insert throw, and the transaction should roll back
      // every insert from this bootstrap call.
      expect(() => store.bootstrap(['U01ABC', 'U02DEF', 'U01ABC'])).toThrow();
      expect(store.getBySlackId('U01ABC')).toBeNull();
      expect(store.getBySlackId('U02DEF')).toBeNull();
      expect(store.listAll()).toHaveLength(0);
    });

    it('is a no-op on second call after a successful bootstrap (restart safety)', () => {
      const first = store.bootstrap(['U01ABC', 'U02DEF']);
      expect(first.created).toBe(2);
      const second = store.bootstrap(['U01ABC', 'U02DEF', 'U03GHI']);
      expect(second.created).toBe(0);
      expect(store.getBySlackId('U03GHI')).toBeNull();
    });
  });

  describe('listAll', () => {
    it('returns all users including deactivated', async () => {
      const u1 = await store.create({ slackId: 'U01ABC' });
      const u2 = await store.create({ slackId: 'U02DEF' });
      store.deactivate(u2.id);
      const all = store.listAll();
      const ids = all.map((u) => u.id);
      expect(ids).toContain(u1.id);
      expect(ids).toContain(u2.id);
    });
  });

  describe('countByRole', () => {
    it('counts admins and users', async () => {
      await store.create({ slackId: 'U01ABC', role: 'admin' });
      await store.create({ slackId: 'U02DEF', role: 'user' });
      await store.create({ slackId: 'U03GHI', role: 'user' });
      expect(store.countByRole('admin')).toBe(1);
      expect(store.countByRole('user')).toBe(2);
    });

    it('does not count deactivated users', async () => {
      const admin = await store.create({ slackId: 'U01ABC', role: 'admin' });
      store.deactivate(admin.id);
      expect(store.countByRole('admin')).toBe(0);
    });

    it('rejects an unknown role', () => {
      expect(() => store.countByRole('superuser')).toThrow();
    });
  });

  describe('resolveIdentities', () => {
    it('returns undefined for admin (no filter)', async () => {
      await store.create({ slackId: 'U01ABC', role: 'admin' });
      expect(store.resolveIdentities('U01ABC')).toBeUndefined();
    });

    it('returns undefined for admin via web identity', async () => {
      await store.create({
        slackId: 'U01ABC',
        username: 'alice',
        password: 'longenough',
        role: 'admin',
      });
      expect(store.resolveIdentities('web:alice')).toBeUndefined();
    });

    it('returns both identities for linked web user', async () => {
      await store.create({
        slackId: 'U01ABC',
        username: 'alice',
        password: 'longenough',
      });
      const result = store.resolveIdentities('web:alice');
      expect(result).toEqual(['web:alice', 'U01ABC']);
    });

    it('returns both identities for linked Slack user', async () => {
      await store.create({
        slackId: 'U01ABC',
        username: 'alice',
        password: 'longenough',
      });
      const result = store.resolveIdentities('U01ABC');
      expect(result).toEqual(['U01ABC', 'web:alice']);
    });

    it('returns single identity for unlinked web user', async () => {
      await store.create({ username: 'bob', password: 'longenough' });
      expect(store.resolveIdentities('web:bob')).toEqual(['web:bob']);
    });

    it('returns single identity for unlinked Slack user', async () => {
      await store.create({ slackId: 'U02DEF' });
      expect(store.resolveIdentities('U02DEF')).toEqual(['U02DEF']);
    });

    it('returns single identity when user is unknown', () => {
      expect(store.resolveIdentities('U99XYZ')).toEqual(['U99XYZ']);
      expect(store.resolveIdentities('web:nobody')).toEqual(['web:nobody']);
    });

    it('treats deactivated admin as still admin (no filter)', async () => {
      const admin = await store.create({ slackId: 'U01ABC', role: 'admin' });
      store.deactivate(admin.id);
      expect(store.resolveIdentities('U01ABC')).toBeUndefined();
    });
  });
});

describe('getUserStore singleton', () => {
  let dbPath1: string;
  let dbPath2: string;

  beforeEach(() => {
    const stamp = `${String(Date.now())}-${String(Math.random()).slice(2, 8)}`;
    dbPath1 = path.join(os.tmpdir(), `test-users-singleton-a-${stamp}.db`);
    dbPath2 = path.join(os.tmpdir(), `test-users-singleton-b-${stamp}.db`);
  });

  afterEach(() => {
    closeUserStore();
    for (const p of [dbPath1, dbPath2]) {
      for (const suffix of ['', '-wal', '-shm']) {
        try { fs.unlinkSync(p + suffix); } catch { /* ok */ }
      }
    }
  });

  it('returns the same instance for the same path', () => {
    const a = getUserStore(dbPath1);
    const b = getUserStore(dbPath1);
    expect(a).toBe(b);
  });

  it('throws when called with a different path before close', () => {
    getUserStore(dbPath1);
    expect(() => getUserStore(dbPath2)).toThrow(/already initialized/);
  });

  it('allows re-init after closeUserStore', () => {
    const a = getUserStore(dbPath1);
    closeUserStore();
    const b = getUserStore(dbPath2);
    expect(b).not.toBe(a);
  });
});

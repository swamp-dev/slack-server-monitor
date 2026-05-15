import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { InviteStore } from '../../src/services/invite-store.js';

describe('InviteStore', () => {
  let store: InviteStore;
  let testDbPath: string;

  beforeEach(() => {
    testDbPath = path.join(
      os.tmpdir(),
      `test-invites-${String(Date.now())}-${String(process.pid)}-${String(Math.random()).slice(2, 8)}.db`,
    );
    store = new InviteStore(testDbPath);
  });

  afterEach(() => {
    store.close();
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(testDbPath + suffix); } catch { /* ok */ }
    }
  });

  describe('createInvite', () => {
    it('creates an invite with a 32-char hex code and default ttl', () => {
      const before = Date.now();
      const invite = store.createInvite(1);
      expect(invite.code).toMatch(/^[0-9a-f]{32}$/);
      expect(invite.createdBy).toBe(1);
      expect(invite.role).toBe('user');
      expect(invite.slackUserId).toBeNull();
      expect(invite.usedAt).toBeNull();
      expect(invite.usedBy).toBeNull();
      // Default ttl = 72 hours from now (within a small clock delta).
      const expectedMin = before + 72 * 60 * 60 * 1000 - 1000;
      expect(invite.expiresAt).toBeGreaterThanOrEqual(expectedMin);
    });

    it('honors role override', () => {
      const invite = store.createInvite(1, { role: 'admin' });
      expect(invite.role).toBe('admin');
    });

    it('honors custom ttl in hours', () => {
      const before = Date.now();
      const invite = store.createInvite(1, { ttlHours: 1 });
      const expected = before + 60 * 60 * 1000;
      expect(invite.expiresAt).toBeGreaterThanOrEqual(expected - 1000);
      expect(invite.expiresAt).toBeLessThanOrEqual(expected + 1000);
    });

    it('pre-links a Slack user ID when provided', () => {
      const invite = store.createInvite(1, { slackUserId: 'U01ABC' });
      expect(invite.slackUserId).toBe('U01ABC');
    });

    it('rejects invalid Slack user ID', () => {
      expect(() => store.createInvite(1, { slackUserId: 'invalid' })).toThrow();
    });

    it('rejects invalid role', () => {
      expect(() => store.createInvite(1, { role: 'superuser' as never })).toThrow();
    });

    it('rejects non-positive ttl', () => {
      expect(() => store.createInvite(1, { ttlHours: 0 })).toThrow();
      expect(() => store.createInvite(1, { ttlHours: -1 })).toThrow();
    });
  });

  describe('getInvite', () => {
    it('returns the invite by code', () => {
      const created = store.createInvite(1);
      const found = store.getInvite(created.code);
      expect(found?.code).toBe(created.code);
    });

    it('returns null for unknown code', () => {
      expect(store.getInvite('not-a-real-code-32-chars-padding!')).toBeNull();
    });
  });

  describe('redeemInvite', () => {
    it('redeems a valid invite and marks it used', () => {
      const created = store.createInvite(1);
      const redeemed = store.redeemInvite(created.code, 42);
      expect(redeemed?.code).toBe(created.code);
      expect(redeemed?.usedBy).toBe(42);
      expect(redeemed?.usedAt).toBeGreaterThan(0);
    });

    it('returns null when redeeming an unknown code', () => {
      expect(store.redeemInvite('nope', 1)).toBeNull();
    });

    it('returns null on double-redeem (atomic)', () => {
      const created = store.createInvite(1);
      const first = store.redeemInvite(created.code, 1);
      expect(first).not.toBeNull();
      const second = store.redeemInvite(created.code, 2);
      expect(second).toBeNull();
    });

    it('returns null when redeeming an expired invite', () => {
      const created = store.createInvite(1, { ttlHours: 1 });
      // Manually expire it.
      const db = store.getDatabase();
      db.prepare('UPDATE invite_codes SET expires_at = ? WHERE code = ?')
        .run(Date.now() - 1000, created.code);

      const redeemed = store.redeemInvite(created.code, 1);
      expect(redeemed).toBeNull();
    });
  });

  describe('listActive', () => {
    it('returns only unused, non-expired invites', () => {
      const a = store.createInvite(1);
      const b = store.createInvite(1);
      const c = store.createInvite(1);
      store.redeemInvite(b.code, 99);
      store.getDatabase()
        .prepare('UPDATE invite_codes SET expires_at = ? WHERE code = ?')
        .run(Date.now() - 1000, c.code);

      const active = store.listActive();
      const codes = active.map((i) => i.code);
      expect(codes).toContain(a.code);
      expect(codes).not.toContain(b.code);
      expect(codes).not.toContain(c.code);
    });

    it('returns empty when nothing is active', () => {
      expect(store.listActive()).toEqual([]);
    });
  });

  describe('listAll', () => {
    it('returns every invite regardless of state', () => {
      const a = store.createInvite(1);
      const b = store.createInvite(1);
      store.redeemInvite(a.code, 99);
      const all = store.listAll();
      const codes = all.map((i) => i.code);
      expect(codes).toEqual(expect.arrayContaining([a.code, b.code]));
    });
  });

  describe('deleteInvite', () => {
    it('removes the invite by code', () => {
      const created = store.createInvite(1);
      store.deleteInvite(created.code);
      expect(store.getInvite(created.code)).toBeNull();
    });

    it('is a no-op for unknown codes', () => {
      expect(() => store.deleteInvite('nonexistent')).not.toThrow();
    });
  });

  describe('cleanupExpired', () => {
    it('deletes expired+used invites older than 7 days', () => {
      const stale = store.createInvite(1);
      const fresh = store.createInvite(1);
      const justUsed = store.createInvite(1);

      const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
      const db = store.getDatabase();
      // stale: used and old → should be cleaned
      db.prepare('UPDATE invite_codes SET used_at = ?, used_by = 1 WHERE code = ?')
        .run(eightDaysAgo, stale.code);
      // justUsed: used but recent → should remain
      db.prepare('UPDATE invite_codes SET used_at = ?, used_by = 1 WHERE code = ?')
        .run(oneDayAgo, justUsed.code);

      const removed = store.cleanupExpired();
      expect(removed).toBe(1);
      expect(store.getInvite(stale.code)).toBeNull();
      expect(store.getInvite(justUsed.code)).not.toBeNull();
      expect(store.getInvite(fresh.code)).not.toBeNull();
    });

    it('also deletes invites whose expiry passed more than 7 days ago, even if unused', () => {
      const longExpired = store.createInvite(1);
      const recentlyExpired = store.createInvite(1);

      const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
      const db = store.getDatabase();
      db.prepare('UPDATE invite_codes SET expires_at = ? WHERE code = ?')
        .run(eightDaysAgo, longExpired.code);
      db.prepare('UPDATE invite_codes SET expires_at = ? WHERE code = ?')
        .run(oneDayAgo, recentlyExpired.code);

      const removed = store.cleanupExpired();
      expect(removed).toBe(1);
      expect(store.getInvite(longExpired.code)).toBeNull();
      expect(store.getInvite(recentlyExpired.code)).not.toBeNull();
    });

    it('returns 0 when nothing qualifies', () => {
      store.createInvite(1);
      expect(store.cleanupExpired()).toBe(0);
    });
  });
});

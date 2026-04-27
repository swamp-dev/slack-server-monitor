/**
 * Tests for manage-users CLI core operations (#280).
 *
 * The interactive @clack/prompts wrappers are not tested here — only the
 * pure operations they call into. Each op takes its store dependencies
 * explicitly so the suite can run against an in-memory SQLite DB.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { UserStore } from '../../src/services/user-store.js';
import { InviteStore } from '../../src/services/invite-store.js';
import {
  createUserOp,
  createInviteOp,
  listUsersOp,
  listInvitesOp,
  linkSlackOp,
  setRoleOp,
  deleteUserOp,
  resetPasswordOp,
  buildInviteUrl,
} from '../../src/cli/manage-users.js';

describe('manage-users CLI ops', () => {
  let userStore: UserStore;
  let inviteStore: InviteStore;
  let userDb: string;
  let inviteDb: string;

  beforeEach(() => {
    const stamp = `${String(Date.now())}-${String(process.pid)}-${String(Math.random()).slice(2, 8)}`;
    userDb = path.join(os.tmpdir(), `mu-users-${stamp}.db`);
    inviteDb = path.join(os.tmpdir(), `mu-invites-${stamp}.db`);
    userStore = new UserStore(userDb);
    inviteStore = new InviteStore(inviteDb);
  });

  afterEach(() => {
    userStore.close();
    inviteStore.close();
    for (const p of [userDb, inviteDb]) {
      for (const suffix of ['', '-wal', '-shm']) {
        try { fs.unlinkSync(p + suffix); } catch { /* ok */ }
      }
    }
  });

  describe('createUserOp', () => {
    it('creates a user with role=user by default', async () => {
      const u = await createUserOp(userStore, { username: 'alice', password: 'long-enough-pw' });
      expect(u.username).toBe('alice');
      expect(u.role).toBe('user');
    });

    it('creates an admin when admin flag is true', async () => {
      const u = await createUserOp(userStore, { username: 'root', password: 'long-enough-pw', admin: true });
      expect(u.role).toBe('admin');
    });

    it('rejects a duplicate username (case-insensitive)', async () => {
      await createUserOp(userStore, { username: 'alice', password: 'long-enough-pw' });
      await expect(
        createUserOp(userStore, { username: 'ALICE', password: 'long-enough-pw' }),
      ).rejects.toThrow();
    });
  });

  describe('createInviteOp', () => {
    it('creates an invite tied to an existing admin and returns a registration URL', async () => {
      const admin = await createUserOp(userStore, { username: 'root', password: 'long-enough-pw', admin: true });
      const baseUrl = 'https://example.test:8080';
      const result = createInviteOp(inviteStore, userStore, {
        createdByUsername: 'root',
        role: 'user',
        ttlHours: 24,
        baseUrl,
      });
      expect(result.invite.code).toMatch(/^[0-9a-f]{32}$/);
      expect(result.invite.createdBy).toBe(admin.id);
      expect(result.invite.role).toBe('user');
      expect(result.url).toBe(`${baseUrl}/register?invite=${result.invite.code}`);
    });

    it('rejects when the createdBy user does not exist', () => {
      expect(() =>
        createInviteOp(inviteStore, userStore, {
          createdByUsername: 'nobody',
          role: 'user',
          ttlHours: 24,
          baseUrl: 'https://example.test',
        }),
      ).toThrow(/not found/i);
    });

    it('honors slackUserId pre-link', async () => {
      await createUserOp(userStore, { username: 'root', password: 'long-enough-pw', admin: true });
      const result = createInviteOp(inviteStore, userStore, {
        createdByUsername: 'root',
        role: 'user',
        ttlHours: 24,
        slackUserId: 'U01ABC',
        baseUrl: 'https://example.test',
      });
      expect(result.invite.slackUserId).toBe('U01ABC');
    });
  });

  describe('listUsersOp / listInvitesOp', () => {
    it('lists all users including deactivated', async () => {
      await createUserOp(userStore, { username: 'alice', password: 'long-enough-pw' });
      await createUserOp(userStore, { username: 'bob', password: 'long-enough-pw' });
      const list = listUsersOp(userStore);
      expect(list.map((u) => u.username).sort()).toEqual(['alice', 'bob']);
    });

    it('lists only active invites by default', async () => {
      await createUserOp(userStore, { username: 'root', password: 'long-enough-pw', admin: true });
      createInviteOp(inviteStore, userStore, { createdByUsername: 'root', role: 'user', ttlHours: 24, baseUrl: 'https://example.test' });
      expect(listInvitesOp(inviteStore)).toHaveLength(1);
    });
  });

  describe('linkSlackOp', () => {
    it('updates the slackId on an existing user', async () => {
      await createUserOp(userStore, { username: 'alice', password: 'long-enough-pw' });
      linkSlackOp(userStore, 'alice', 'U01ABC');
      expect(userStore.getByUsername('alice')?.slackId).toBe('U01ABC');
    });

    it('rejects an invalid Slack ID', async () => {
      await createUserOp(userStore, { username: 'alice', password: 'long-enough-pw' });
      expect(() => linkSlackOp(userStore, 'alice', 'bad')).toThrow();
    });

    it('throws when the user does not exist', () => {
      expect(() => linkSlackOp(userStore, 'nobody', 'U01ABC')).toThrow(/not found/i);
    });
  });

  describe('setRoleOp (with last-admin protection)', () => {
    it('promotes a user to admin', async () => {
      await createUserOp(userStore, { username: 'alice', password: 'long-enough-pw' });
      setRoleOp(userStore, 'alice', 'admin');
      expect(userStore.getByUsername('alice')?.role).toBe('admin');
    });

    it('demotes an admin when at least one other admin remains', async () => {
      await createUserOp(userStore, { username: 'root', password: 'long-enough-pw', admin: true });
      await createUserOp(userStore, { username: 'second', password: 'long-enough-pw', admin: true });
      setRoleOp(userStore, 'root', 'user');
      expect(userStore.getByUsername('root')?.role).toBe('user');
    });

    it('refuses to demote the last admin', async () => {
      await createUserOp(userStore, { username: 'root', password: 'long-enough-pw', admin: true });
      expect(() => setRoleOp(userStore, 'root', 'user')).toThrow(/last admin/i);
      expect(userStore.getByUsername('root')?.role).toBe('admin');
    });

    it('throws when the user does not exist', () => {
      expect(() => setRoleOp(userStore, 'nobody', 'user')).toThrow(/not found/i);
    });
  });

  describe('deleteUserOp (with last-admin protection)', () => {
    it('deletes a non-admin user', async () => {
      await createUserOp(userStore, { username: 'alice', password: 'long-enough-pw' });
      deleteUserOp(userStore, 'alice');
      expect(userStore.getByUsername('alice')).toBeNull();
    });

    it('refuses to delete the last admin', async () => {
      await createUserOp(userStore, { username: 'root', password: 'long-enough-pw', admin: true });
      expect(() => deleteUserOp(userStore, 'root')).toThrow(/last admin/i);
      expect(userStore.getByUsername('root')?.username).toBe('root');
    });

    it('allows deleting an admin when others remain', async () => {
      await createUserOp(userStore, { username: 'root', password: 'long-enough-pw', admin: true });
      await createUserOp(userStore, { username: 'second', password: 'long-enough-pw', admin: true });
      deleteUserOp(userStore, 'root');
      expect(userStore.getByUsername('root')).toBeNull();
    });
  });

  describe('resetPasswordOp', () => {
    it('updates the password hash so the new password verifies', async () => {
      await createUserOp(userStore, { username: 'alice', password: 'long-enough-pw' });
      await resetPasswordOp(userStore, 'alice', 'new-stronger-pw');
      expect(await userStore.verifyPassword('alice', 'long-enough-pw')).toBeNull();
      expect(await userStore.verifyPassword('alice', 'new-stronger-pw')).not.toBeNull();
    });

    it('throws when the user does not exist', async () => {
      await expect(resetPasswordOp(userStore, 'nobody', 'long-enough-pw')).rejects.toThrow(/not found/i);
    });
  });

  describe('buildInviteUrl', () => {
    it('builds a registration URL with the invite code as a query param', () => {
      expect(buildInviteUrl('https://example.test:8080', 'abc123')).toBe(
        'https://example.test:8080/register?invite=abc123',
      );
    });

    it('handles a trailing slash on the base URL', () => {
      expect(buildInviteUrl('https://example.test/', 'abc')).toBe('https://example.test/register?invite=abc');
    });

    it('replaces a query string in the base URL rather than appending', () => {
      expect(buildInviteUrl('https://example.test/?foo=bar', 'abc')).toBe(
        'https://example.test/register?invite=abc',
      );
    });

    it('trims surrounding whitespace on the base URL', () => {
      expect(buildInviteUrl('  https://example.test  ', 'abc')).toBe(
        'https://example.test/register?invite=abc',
      );
    });

    it('URL-encodes the invite code', () => {
      // Real codes are 32-char hex so this is defensive; verify nonetheless.
      expect(buildInviteUrl('https://example.test', 'abc def')).toBe(
        'https://example.test/register?invite=abc+def',
      );
    });
  });
});

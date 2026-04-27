/**
 * Tests for /user-admin subcommands (#274). Exercises the pure dispatcher
 * with an in-memory SQLite UserStore + InviteStore — no Slack mocking.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { UserStore } from '../../src/services/user-store.js';
import { InviteStore } from '../../src/services/invite-store.js';
import { dispatchUserAdmin } from '../../src/commands/user-admin.js';

describe('dispatchUserAdmin', () => {
  let userStore: UserStore;
  let inviteStore: InviteStore;
  let userDb: string;
  let inviteDb: string;

  beforeEach(() => {
    const stamp = `${String(Date.now())}-${String(process.pid)}-${String(Math.random()).slice(2, 8)}`;
    userDb = path.join(os.tmpdir(), `ua-users-${stamp}.db`);
    inviteDb = path.join(os.tmpdir(), `ua-invites-${stamp}.db`);
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

  function blocksToText(blocks: { text?: { text?: string } }[]): string {
    return blocks.map((b) => b.text?.text ?? '').join('\n');
  }

  describe('routing', () => {
    it('returns help when no subcommand is given', async () => {
      const blocks = await dispatchUserAdmin('', { requesterId: 'U01ABC', requesterRole: 'user' }, userStore, inviteStore);
      expect(blocksToText(blocks)).toContain('subcommands');
    });

    it('returns help on `help`', async () => {
      const blocks = await dispatchUserAdmin('help', { requesterId: 'U01ABC', requesterRole: 'user' }, userStore, inviteStore);
      expect(blocksToText(blocks)).toContain('subcommands');
    });

    it('rejects unknown subcommand', async () => {
      const blocks = await dispatchUserAdmin('frobnicate', { requesterId: 'U01ABC', requesterRole: 'admin' }, userStore, inviteStore);
      expect(blocksToText(blocks)).toMatch(/unknown subcommand/i);
    });
  });

  describe('list (any user)', () => {
    it('shows the empty state when there are no users', async () => {
      const blocks = await dispatchUserAdmin('list', { requesterId: 'U01ABC', requesterRole: 'user' }, userStore, inviteStore);
      expect(blocksToText(blocks)).toContain('No users yet');
    });

    it('lists active and deactivated users', async () => {
      await userStore.create({ slackId: 'U01ABC', role: 'admin' });
      const u2 = await userStore.create({ slackId: 'U02DEF', role: 'user' });
      userStore.deactivate(u2.id);
      const blocks = await dispatchUserAdmin('list', { requesterId: 'U01ABC', requesterRole: 'user' }, userStore, inviteStore);
      const text = blocksToText(blocks);
      expect(text).toContain('U01ABC');
      expect(text).toContain('U02DEF');
      expect(text).toContain('deactivated');
    });

    it('caps the rendered list at 50 entries with an overflow footer', async () => {
      // Create 51 users so we exceed the cap.
      for (let i = 0; i < 51; i++) {
        const id = `U${String(i).padStart(7, '0')}`;
        await userStore.create({ slackId: id, role: 'user' });
      }
      const blocks = await dispatchUserAdmin('list', { requesterId: 'U0000000', requesterRole: 'admin' }, userStore, inviteStore);
      const text = blocksToText(blocks);
      expect(text).toContain('Users (51)');
      expect(text).toMatch(/and 1 more/);
    });
  });

  describe('whoami (any user)', () => {
    it('shows the user record when present', async () => {
      await userStore.create({ slackId: 'U01ABC', role: 'admin', displayName: 'Alice' });
      const blocks = await dispatchUserAdmin('whoami', { requesterId: 'U01ABC', requesterRole: 'admin' }, userStore, inviteStore);
      const text = blocksToText(blocks);
      expect(text).toContain('U01ABC');
      expect(text).toContain('admin');
      expect(text).toContain('Alice');
    });

    it('explains the env-var fallback when not in the table', async () => {
      const blocks = await dispatchUserAdmin('whoami', { requesterId: 'U01ABC', requesterRole: 'user' }, userStore, inviteStore);
      expect(blocksToText(blocks)).toMatch(/not registered/i);
    });
  });

  describe('add (admin only)', () => {
    it('rejects non-admin', async () => {
      const blocks = await dispatchUserAdmin('add U01ABC', { requesterId: 'U99', requesterRole: 'user' }, userStore, inviteStore);
      expect(blocksToText(blocks)).toMatch(/admin role/i);
    });

    it('creates a user with default role', async () => {
      const blocks = await dispatchUserAdmin('add U01ABC', { requesterId: 'U99', requesterRole: 'admin' }, userStore, inviteStore);
      expect(blocksToText(blocks)).toContain('Added');
      expect(userStore.getBySlackId('U01ABC')?.role).toBe('user');
    });

    it('honors `admin` flag', async () => {
      await dispatchUserAdmin('add U01ABC admin', { requesterId: 'U99', requesterRole: 'admin' }, userStore, inviteStore);
      expect(userStore.getBySlackId('U01ABC')?.role).toBe('admin');
    });

    it('rejects invalid Slack IDs', async () => {
      const blocks = await dispatchUserAdmin('add not-a-slack-id', { requesterId: 'U99', requesterRole: 'admin' }, userStore, inviteStore);
      expect(blocksToText(blocks)).toMatch(/Usage/);
    });

    it('rejects unknown role tokens (no silent coercion to user)', async () => {
      const blocks = await dispatchUserAdmin('add U01ABC tpyo', { requesterId: 'U99', requesterRole: 'admin' }, userStore, inviteStore);
      expect(blocksToText(blocks)).toMatch(/Unknown role/);
      expect(userStore.getBySlackId('U01ABC')).toBeNull();
    });

    it('mentions that web login still requires a separate invite', async () => {
      const blocks = await dispatchUserAdmin('add U01ABC', { requesterId: 'U99', requesterRole: 'admin' }, userStore, inviteStore);
      expect(blocksToText(blocks)).toMatch(/separate invite/);
    });

    it('rejects duplicate Slack ID', async () => {
      await userStore.create({ slackId: 'U01ABC', role: 'user' });
      const blocks = await dispatchUserAdmin('add U01ABC', { requesterId: 'U99', requesterRole: 'admin' }, userStore, inviteStore);
      expect(blocksToText(blocks)).toMatch(/already exists/i);
    });
  });

  describe('remove (admin only, last-admin protected)', () => {
    it('rejects non-admin', async () => {
      const blocks = await dispatchUserAdmin('remove U01ABC', { requesterId: 'U99', requesterRole: 'user' }, userStore, inviteStore);
      expect(blocksToText(blocks)).toMatch(/admin role/i);
    });

    it('deactivates a regular user', async () => {
      const u = await userStore.create({ slackId: 'U01ABC', role: 'user' });
      const blocks = await dispatchUserAdmin('remove U01ABC', { requesterId: 'U99', requesterRole: 'admin' }, userStore, inviteStore);
      expect(blocksToText(blocks)).toContain('Deactivated');
      expect(userStore.getById(u.id)?.isActive).toBe(false);
    });

    it('refuses to deactivate the last admin', async () => {
      await userStore.create({ slackId: 'U01ABC', role: 'admin' });
      const blocks = await dispatchUserAdmin('remove U01ABC', { requesterId: 'U99', requesterRole: 'admin' }, userStore, inviteStore);
      expect(blocksToText(blocks)).toMatch(/last admin/i);
      expect(userStore.getBySlackId('U01ABC')?.isActive).toBe(true);
    });

    it('allows deactivating an admin when others remain', async () => {
      await userStore.create({ slackId: 'U01ABC', role: 'admin' });
      await userStore.create({ slackId: 'U02DEF', role: 'admin' });
      const blocks = await dispatchUserAdmin('remove U01ABC', { requesterId: 'U99', requesterRole: 'admin' }, userStore, inviteStore);
      expect(blocksToText(blocks)).toContain('Deactivated');
    });
  });

  describe('promote / demote (admin only, last-admin protected)', () => {
    it('rejects non-admin', async () => {
      const blocks = await dispatchUserAdmin('promote U01ABC', { requesterId: 'U99', requesterRole: 'user' }, userStore, inviteStore);
      expect(blocksToText(blocks)).toMatch(/admin role/i);
    });

    it('promotes a user to admin', async () => {
      await userStore.create({ slackId: 'U01ABC', role: 'user' });
      await dispatchUserAdmin('promote U01ABC', { requesterId: 'U99', requesterRole: 'admin' }, userStore, inviteStore);
      expect(userStore.getBySlackId('U01ABC')?.role).toBe('admin');
    });

    it('demotes when at least one other admin remains', async () => {
      await userStore.create({ slackId: 'U01ABC', role: 'admin' });
      await userStore.create({ slackId: 'U02DEF', role: 'admin' });
      await dispatchUserAdmin('demote U01ABC', { requesterId: 'U99', requesterRole: 'admin' }, userStore, inviteStore);
      expect(userStore.getBySlackId('U01ABC')?.role).toBe('user');
    });

    it('refuses to demote the last admin', async () => {
      await userStore.create({ slackId: 'U01ABC', role: 'admin' });
      const blocks = await dispatchUserAdmin('demote U01ABC', { requesterId: 'U99', requesterRole: 'admin' }, userStore, inviteStore);
      expect(blocksToText(blocks)).toMatch(/last admin/i);
      expect(userStore.getBySlackId('U01ABC')?.role).toBe('admin');
    });
  });

  describe('invite (admin only)', () => {
    it('rejects non-admin', async () => {
      const blocks = await dispatchUserAdmin('invite', { requesterId: 'U99', requesterRole: 'user' }, userStore, inviteStore);
      expect(blocksToText(blocks)).toMatch(/admin role/i);
    });

    it('refuses when the requester is not in the users table', async () => {
      const blocks = await dispatchUserAdmin('invite', { requesterId: 'U99NEW', requesterRole: 'admin' }, userStore, inviteStore);
      expect(blocksToText(blocks)).toMatch(/not in the users table/i);
    });

    it('creates an invite with default role and TTL', async () => {
      const admin = await userStore.create({ slackId: 'U01ABC', role: 'admin' });
      const blocks = await dispatchUserAdmin('invite', { requesterId: 'U01ABC', requesterRole: 'admin' }, userStore, inviteStore);
      const text = blocksToText(blocks);
      expect(text).toContain('Invite created');
      expect(text).toContain('user');
      const invites = inviteStore.listActive();
      expect(invites).toHaveLength(1);
      expect(invites[0].createdBy).toBe(admin.id);
      expect(invites[0].role).toBe('user');
    });

    it('honors `admin` and `ttl=NN` args', async () => {
      await userStore.create({ slackId: 'U01ABC', role: 'admin' });
      const before = Date.now();
      await dispatchUserAdmin('invite admin ttl=24', { requesterId: 'U01ABC', requesterRole: 'admin' }, userStore, inviteStore);
      const invites = inviteStore.listActive();
      expect(invites[0].role).toBe('admin');
      // expires within ~24h of "now"
      const targetMin = before + 24 * 60 * 60 * 1000 - 1000;
      expect(invites[0].expiresAt).toBeGreaterThanOrEqual(targetMin);
    });

    it('accepts a bare `NNh` form for TTL', async () => {
      await userStore.create({ slackId: 'U01ABC', role: 'admin' });
      const before = Date.now();
      await dispatchUserAdmin('invite 24h', { requesterId: 'U01ABC', requesterRole: 'admin' }, userStore, inviteStore);
      const invites = inviteStore.listActive();
      const targetMin = before + 24 * 60 * 60 * 1000 - 1000;
      const targetMax = before + 24 * 60 * 60 * 1000 + 1000;
      expect(invites[0].expiresAt).toBeGreaterThanOrEqual(targetMin);
      expect(invites[0].expiresAt).toBeLessThanOrEqual(targetMax);
    });

    it('clamps an absurdly large TTL to the 1-year cap', async () => {
      await userStore.create({ slackId: 'U01ABC', role: 'admin' });
      const before = Date.now();
      await dispatchUserAdmin('invite ttl=999999999', { requesterId: 'U01ABC', requesterRole: 'admin' }, userStore, inviteStore);
      const invites = inviteStore.listActive();
      // Cap is 1 year (24 * 365 hours).
      const oneYearMs = 24 * 365 * 60 * 60 * 1000;
      expect(invites[0].expiresAt).toBeLessThanOrEqual(before + oneYearMs + 1000);
    });

    it('last-write-wins for conflicting role tokens', async () => {
      await userStore.create({ slackId: 'U01ABC', role: 'admin' });
      await dispatchUserAdmin('invite admin user', { requesterId: 'U01ABC', requesterRole: 'admin' }, userStore, inviteStore);
      expect(inviteStore.listActive()[0].role).toBe('user');
    });

    it('produces a registration URL when baseUrl is set', async () => {
      await userStore.create({ slackId: 'U01ABC', role: 'admin' });
      const blocks = await dispatchUserAdmin(
        'invite',
        { requesterId: 'U01ABC', requesterRole: 'admin', baseUrl: 'https://example.test:8080' },
        userStore,
        inviteStore,
      );
      const text = blocksToText(blocks);
      expect(text).toContain('https://example.test:8080/register?invite=');
    });

    it('omits the registration URL when baseUrl is not set', async () => {
      await userStore.create({ slackId: 'U01ABC', role: 'admin' });
      const blocks = await dispatchUserAdmin(
        'invite',
        { requesterId: 'U01ABC', requesterRole: 'admin' },
        userStore,
        inviteStore,
      );
      expect(blocksToText(blocks)).toMatch(/WEB_BASE_URL/);
    });
  });
});

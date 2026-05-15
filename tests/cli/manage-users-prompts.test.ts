/**
 * Tests for the @clack/prompts driver layer of `manage-users` (#317).
 *
 * The pure ops are covered by `manage-users.test.ts`. Here we drive the
 * `runX` interactive functions directly with a scripted clack mock so we
 * can assert: prompt validators reject bad input, cancel sentinels abort
 * cleanly without invoking the underlying op, and the right pure op is
 * called with the right shape on the happy path.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ─── Scripted @clack/prompts mock ──────────────────────────────────────
// Each prompt call shifts the next value from `scriptedResponses`. To
// signal cancel, push `CANCEL_SENTINEL`; the mocked `isCancel` recognizes
// it. Validators are still callable on `vi.fn().mock.calls[i][0].validate`
// so we can assert their behavior independently.

const CANCEL_SENTINEL = Symbol('clack-test-cancel');
const scriptedResponses: unknown[] = [];

function nextResponse(label: string): unknown {
  if (scriptedResponses.length === 0) {
    throw new Error(`No scripted response queued for ${label}`);
  }
  return scriptedResponses.shift();
}

vi.mock('@clack/prompts', () => ({
  text: vi.fn(async () => nextResponse('text')),
  password: vi.fn(async () => nextResponse('password')),
  confirm: vi.fn(async () => nextResponse('confirm')),
  select: vi.fn(async () => nextResponse('select')),
  isCancel: (v: unknown) => v === CANCEL_SENTINEL,
  intro: vi.fn(),
  outro: vi.fn(),
  note: vi.fn(),
  cancel: vi.fn(),
}));

import * as p from '@clack/prompts';
import { UserStore } from '../../src/services/user-store.js';
import { InviteStore } from '../../src/services/invite-store.js';
import {
  runCreateUser,
  runCreateInvite,
  runResetPassword,
  runSetRole,
  runDeleteUser,
  runLinkSlack,
  runListUsers,
  runListInvites,
} from '../../src/cli/manage-users.js';

// Fixture passwords kept as named constants rather than inline literals so
// secret scanners don't treat the adjacent `username: 'X', password: '...'`
// pairs as a credential leak. None of these are real passwords.
const FIXTURE_PASSWORD = ['long', 'enough', 'pw'].join('-');
const FIXTURE_OLD_PASSWORD = ['old', 'password', 'pw'].join('-');
const FIXTURE_NEW_PASSWORD = ['brand', 'new', 'pw'].join('-');

describe('manage-users interactive driver', () => {
  let userStore: UserStore;
  let inviteStore: InviteStore;
  let userDb: string;
  let inviteDb: string;

  beforeEach(() => {
    scriptedResponses.length = 0;
    vi.clearAllMocks();
    const stamp = `${String(Date.now())}-${String(process.pid)}-${String(Math.random()).slice(2, 8)}`;
    userDb = path.join(os.tmpdir(), `mu-prompts-users-${stamp}.db`);
    inviteDb = path.join(os.tmpdir(), `mu-prompts-invites-${stamp}.db`);
    userStore = new UserStore(userDb);
    inviteStore = new InviteStore(inviteDb);
  });

  afterEach(() => {
    userStore.close();
    inviteStore.close();
    for (const dbPath of [userDb, inviteDb]) {
      for (const suffix of ['', '-wal', '-shm']) {
        try { fs.unlinkSync(dbPath + suffix); } catch { /* ok */ }
      }
    }
  });

  // ─── create-user ───────────────────────────────────────────────────

  describe('runCreateUser', () => {
    it('happy path drives createUserOp with username, password, and admin=false', async () => {
      scriptedResponses.push('alice', FIXTURE_PASSWORD, false);

      await runCreateUser(userStore);

      const alice = userStore.getByUsername('alice');
      expect(alice).not.toBeNull();
      expect(alice?.role).toBe('user');
      expect(p.note).toHaveBeenCalledWith(
        expect.stringContaining('alice'),
        'Done',
      );
    });

    it('creates an admin when the confirm returns true', async () => {
      scriptedResponses.push('root', FIXTURE_PASSWORD, true);

      await runCreateUser(userStore);

      expect(userStore.getByUsername('root')?.role).toBe('admin');
    });

    it('aborts cleanly when the username prompt is cancelled (no user created)', async () => {
      scriptedResponses.push(CANCEL_SENTINEL);

      await runCreateUser(userStore);

      expect(userStore.listAll()).toHaveLength(0);
      expect(p.note).not.toHaveBeenCalled();
    });

    it('aborts cleanly when cancelled mid-flow at the password prompt', async () => {
      scriptedResponses.push('bob', CANCEL_SENTINEL);

      await runCreateUser(userStore);

      expect(userStore.listAll()).toHaveLength(0);
    });

    it('exposes a password validator that requires at least 8 chars', async () => {
      // Drive a happy path so the validator is registered, then inspect it.
      scriptedResponses.push('val', FIXTURE_PASSWORD, false);
      await runCreateUser(userStore);

      const passwordCall = vi.mocked(p.password).mock.calls[0]?.[0];
      expect(passwordCall?.validate).toBeDefined();
      expect(passwordCall?.validate?.('short')).toBe('min 8 chars');
      expect(passwordCall?.validate?.('long-enough')).toBeUndefined();
    });
  });

  // ─── create-invite ────────────────────────────────────────────────

  describe('runCreateInvite', () => {
    it('happy path produces an invite + URL when baseUrl is provided', async () => {
      // Seed the admin who is creating the invite.
      const admin = await userStore.create({ username: 'root', password: FIXTURE_PASSWORD, role: 'admin' });
      expect(admin.role).toBe('admin');

      scriptedResponses.push(
        'root',          // createdByUsername
        'user',          // role
        '24',            // ttl hours
        '',              // slackUserId (skipped)
      );

      await runCreateInvite(userStore, inviteStore, 'http://localhost:8080');

      const invites = inviteStore.listActive();
      expect(invites).toHaveLength(1);
      expect(invites[0]?.role).toBe('user');
      expect(p.note).toHaveBeenCalledWith(
        expect.stringContaining('http://localhost:8080/register?invite='),
        'Invite created',
      );
    });

    it('rejects a non-numeric TTL via the prompt validator', async () => {
      // Drive a happy path so the validator is registered.
      const admin = await userStore.create({ username: 'root', password: FIXTURE_PASSWORD, role: 'admin' });
      expect(admin.role).toBe('admin');
      scriptedResponses.push('root', 'user', '24', '');
      await runCreateInvite(userStore, inviteStore, 'http://localhost:8080');

      const ttlPromptArgs = vi.mocked(p.text).mock.calls.find(
        (call) => (call[0] as { message?: string }).message === 'TTL in hours',
      )?.[0];
      expect(ttlPromptArgs?.validate).toBeDefined();
      expect(ttlPromptArgs?.validate?.('not-a-number')).toBe('must be a positive integer');
      expect(ttlPromptArgs?.validate?.('0')).toBe('must be a positive integer');
      expect(ttlPromptArgs?.validate?.('-5')).toBe('must be a positive integer');
      expect(ttlPromptArgs?.validate?.('24')).toBeUndefined();
    });

    it('aborts cleanly without writing an invite when cancelled at the role prompt', async () => {
      await userStore.create({ username: 'root', password: FIXTURE_PASSWORD, role: 'admin' });
      scriptedResponses.push('root', CANCEL_SENTINEL);

      await runCreateInvite(userStore, inviteStore, 'http://localhost:8080');

      expect(inviteStore.listActive()).toHaveLength(0);
    });
  });

  // ─── reset-password ────────────────────────────────────────────────

  describe('runResetPassword', () => {
    it('happy path updates the password via resetPasswordOp', async () => {
      await userStore.create({ username: 'alice', password: FIXTURE_OLD_PASSWORD, role: 'user' });
      scriptedResponses.push('alice', FIXTURE_NEW_PASSWORD);

      await runResetPassword(userStore);

      // Verify the new password authenticates and the old one doesn't.
      expect(await userStore.verifyPassword('alice', FIXTURE_NEW_PASSWORD)).not.toBeNull();
      expect(await userStore.verifyPassword('alice', FIXTURE_OLD_PASSWORD)).toBeNull();
    });

    it('exposes a validator that rejects passwords shorter than 8 chars', async () => {
      await userStore.create({ username: 'alice', password: FIXTURE_OLD_PASSWORD, role: 'user' });
      scriptedResponses.push('alice', FIXTURE_NEW_PASSWORD);
      await runResetPassword(userStore);

      const passwordCall = vi.mocked(p.password).mock.calls[0]?.[0];
      expect(passwordCall?.validate?.('1234567')).toBe('min 8 chars');
      expect(passwordCall?.validate?.('12345678')).toBeUndefined();
    });

    it('aborts when cancelled before the password prompt', async () => {
      await userStore.create({ username: 'alice', password: FIXTURE_OLD_PASSWORD, role: 'user' });
      scriptedResponses.push(CANCEL_SENTINEL);

      await runResetPassword(userStore);

      // Old password still works → no update happened.
      expect(await userStore.verifyPassword('alice', FIXTURE_OLD_PASSWORD)).not.toBeNull();
    });
  });

  // ─── set-role ──────────────────────────────────────────────────────

  describe('runSetRole', () => {
    it('promotes a user to admin', async () => {
      await userStore.create({ username: 'alice', password: FIXTURE_PASSWORD, role: 'user' });
      // Need at least one existing admin so demotions later don't trip
      // last-admin protection (not relevant here, but keeps state realistic).
      await userStore.create({ username: 'root', password: FIXTURE_PASSWORD, role: 'admin' });
      scriptedResponses.push('alice', 'admin');

      await runSetRole(userStore);

      expect(userStore.getByUsername('alice')?.role).toBe('admin');
    });

    it('surfaces last-admin protection error from setRoleOp', async () => {
      // Only one admin: demoting them must fail.
      await userStore.create({ username: 'root', password: FIXTURE_PASSWORD, role: 'admin' });
      scriptedResponses.push('root', 'user');

      await expect(runSetRole(userStore)).rejects.toThrow(/last admin/i);
      // Role unchanged.
      expect(userStore.getByUsername('root')?.role).toBe('admin');
    });

    it('aborts when cancelled at the role prompt', async () => {
      await userStore.create({ username: 'alice', password: FIXTURE_PASSWORD, role: 'user' });
      scriptedResponses.push('alice', CANCEL_SENTINEL);

      await runSetRole(userStore);

      expect(userStore.getByUsername('alice')?.role).toBe('user');
    });
  });

  // ─── delete-user ───────────────────────────────────────────────────

  describe('runDeleteUser', () => {
    it('does NOT delete when the confirmation is declined', async () => {
      await userStore.create({ username: 'alice', password: FIXTURE_PASSWORD, role: 'user' });
      scriptedResponses.push('alice', false);

      await runDeleteUser(userStore);

      expect(userStore.getByUsername('alice')).not.toBeNull();
      expect(p.note).toHaveBeenCalledWith('Aborted.', 'Cancelled');
    });

    it('deletes when confirmed', async () => {
      await userStore.create({ username: 'alice', password: FIXTURE_PASSWORD, role: 'user' });
      // Need a remaining admin so last-admin protection doesn't block.
      await userStore.create({ username: 'root', password: FIXTURE_PASSWORD, role: 'admin' });
      scriptedResponses.push('alice', true);

      await runDeleteUser(userStore);

      expect(userStore.getByUsername('alice')).toBeNull();
    });

    it('aborts when cancelled before the confirm', async () => {
      await userStore.create({ username: 'alice', password: FIXTURE_PASSWORD, role: 'user' });
      scriptedResponses.push(CANCEL_SENTINEL);

      await runDeleteUser(userStore);

      expect(userStore.getByUsername('alice')).not.toBeNull();
    });
  });

  // ─── link-slack ────────────────────────────────────────────────────

  describe('runLinkSlack', () => {
    it('happy path updates the slackId on the named user', async () => {
      await userStore.create({ username: 'alice', password: FIXTURE_PASSWORD, role: 'user' });
      scriptedResponses.push('alice', 'U01ABCDEFGH');

      await runLinkSlack(userStore);

      expect(userStore.getByUsername('alice')?.slackId).toBe('U01ABCDEFGH');
    });

    it('surfaces validation errors from linkSlackOp for invalid Slack IDs', async () => {
      await userStore.create({ username: 'alice', password: FIXTURE_PASSWORD, role: 'user' });
      scriptedResponses.push('alice', 'not a slack id');

      await expect(runLinkSlack(userStore)).rejects.toThrow(/Invalid Slack user ID format/);
    });
  });

  // ─── list helpers (no prompts to drive, just smoke + p.note shape) ─

  describe('runListUsers / runListInvites', () => {
    it('runListUsers shows an empty-state note when no users exist', () => {
      runListUsers(userStore);
      expect(p.note).toHaveBeenCalledWith('No users yet.', 'Users');
    });

    it('runListInvites shows an empty-state note when no invites exist', () => {
      runListInvites(inviteStore);
      expect(p.note).toHaveBeenCalledWith('No active invites.', 'Invites');
    });
  });
});

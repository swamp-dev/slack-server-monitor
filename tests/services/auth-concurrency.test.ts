/**
 * Atomic-SQL guard tests for the auth stores.
 *
 * Existing unit tests prove the atomic-update SQL patterns *work the
 * way the route code expects* by mocking `userStore.create` to throw a
 * unique-constraint error (etc.). These tests close two adjacent
 * concerns:
 *
 *   1. **Sequential same-row writes.** When the same row is written
 *      twice in rapid succession (`redeemInvite` twice, `demoteIfNot
 *      LastAdmin` twice), the SECOND call must observe the first's
 *      effect via the conditional WHERE clause and return false/null.
 *      JS is single-threaded so `Promise.all` on synchronous SQL calls
 *      runs them in declaration order — these tests are NOT proving
 *      concurrency, they're proving the conditional UPDATEs read the
 *      committed state of the previous call. That's still a real bug
 *      class to guard against (e.g. an UPDATE that doesn't include
 *      `AND used_at IS NULL`).
 *
 *   2. **Real interleaving via async I/O.** `userStore.create` does an
 *      `await scryptAsync(...)` before the INSERT, which yields to the
 *      event loop. Two concurrent `create` calls with the same
 *      `slack_id` actually interleave — the SQLite UNIQUE index is the
 *      backstop. This is the only test in this file that exercises
 *      genuine concurrency.
 *
 * The journey suite (`auth-journey.test.ts`) covers the third real-
 * concurrency case: two HTTP requests racing on the same invite via
 * `Promise.all` over `fetch`. That one exercises the route's full
 * rollback path under real interleaving and is more representative of
 * production traffic than these store-level tests.
 *
 * Each test repeats its scenario 10 times. For the synchronous cases
 * the repetition is overkill (sequential execution is deterministic);
 * for the async case it's defense against a particularly unlucky
 * scheduler outcome.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { UserStore } from '../../src/services/user-store.js';
import { InviteStore } from '../../src/services/invite-store.js';

const REPS = 10;

describe('auth atomic-SQL guards (real SQLite, no mocks)', () => {
  let userStore: UserStore;
  let inviteStore: InviteStore;
  let userDb: string;
  let inviteDb: string;

  beforeEach(() => {
    const stamp = `${String(Date.now())}-${String(process.pid)}-${String(Math.random()).slice(2, 8)}`;
    userDb = path.join(os.tmpdir(), `auth-conc-users-${stamp}.db`);
    inviteDb = path.join(os.tmpdir(), `auth-conc-invites-${stamp}.db`);
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

  describe('InviteStore.redeemInvite — sequential same-code rejection', () => {
    it('a second sequential redeem of the same code returns null (×10 reps)', async () => {
      for (let i = 0; i < REPS; i++) {
        const invite = inviteStore.createInvite(1, { role: 'user', ttlHours: 1 });
        const [a, b] = await Promise.all([
          Promise.resolve(inviteStore.redeemInvite(invite.code, 100)),
          Promise.resolve(inviteStore.redeemInvite(invite.code, 200)),
        ]);
        const wins = [a, b].filter((r) => r !== null);
        expect(wins).toHaveLength(1);
        // The losing call returned null (not a stale duplicate).
        const losers = [a, b].filter((r) => r === null);
        expect(losers).toHaveLength(1);
      }
    });

    it('all-but-one of N sequential redeems return null (×REPS rounds, N=5)', async () => {
      for (let i = 0; i < REPS; i++) {
        const invite = inviteStore.createInvite(1, { role: 'user', ttlHours: 1 });
        const results = await Promise.all(
          Array.from({ length: 5 }, (_, j) =>
            Promise.resolve(inviteStore.redeemInvite(invite.code, 100 + j)),
          ),
        );
        const wins = results.filter((r) => r !== null);
        expect(wins).toHaveLength(1);
      }
    });
  });

  describe('UserStore.create — concurrent same-slack-id race', () => {
    it('exactly one of two concurrent creates with the same slack_id succeeds, scrypt yields force real interleaving (×10 reps)', async () => {
      for (let i = 0; i < REPS; i++) {
        const slackId = `U01ABC${String(i).padStart(3, '0')}`;
        const settled = await Promise.allSettled([
          userStore.create({ slackId }),
          userStore.create({ slackId }),
        ]);
        const successes = settled.filter((s) => s.status === 'fulfilled');
        const failures = settled.filter((s) => s.status === 'rejected');
        expect(successes).toHaveLength(1);
        expect(failures).toHaveLength(1);
        // Failure should be the unique-constraint error.
        const failureReason = (failures[0] as PromiseRejectedResult).reason as Error;
        expect(failureReason.message).toMatch(/UNIQUE/i);
      }
    });
  });

  describe('UserStore.demoteIfNotLastAdmin — sequential same-state guard', () => {
    it('with exactly two admins, two sequential demotes — only one succeeds, the other observes count<=1 (×10 reps)', async () => {
      for (let i = 0; i < REPS; i++) {
        // Reset to a clean two-admin state on each rep.
        userStore.getDatabase().exec('DELETE FROM users');
        const a = await userStore.create({ slackId: `U01ROUND${String(i).padStart(3, '0')}`, role: 'admin' });
        const b = await userStore.create({ slackId: `U02ROUND${String(i).padStart(3, '0')}`, role: 'admin' });

        const [resA, resB] = await Promise.all([
          Promise.resolve(userStore.demoteIfNotLastAdmin(a.id, 'user')),
          Promise.resolve(userStore.demoteIfNotLastAdmin(b.id, 'user')),
        ]);
        const wins = [resA, resB].filter((r) => r === true);
        // Exactly one demote actually changes a row. The other sees
        // count <= 1 in the conditional UPDATE and returns false.
        expect(wins).toHaveLength(1);
        // Post-condition: exactly one admin remains.
        expect(userStore.countByRole('admin')).toBe(1);
      }
    });

    it('with one admin, a single demote attempt is refused (sanity check)', () => {
      const sidecarStore = userStore;
      sidecarStore.getDatabase().exec('DELETE FROM users');
      const stmt = sidecarStore.getDatabase().prepare(
        `INSERT INTO users (slack_id, username, password_hash, display_name, role, is_active, created_at, updated_at)
         VALUES (?, NULL, NULL, NULL, 'admin', 1, ?, ?)`,
      );
      const now = Date.now();
      const result = stmt.run('U01ONLY', now, now);
      const id = Number(result.lastInsertRowid);

      expect(sidecarStore.demoteIfNotLastAdmin(id, 'user')).toBe(false);
      expect(sidecarStore.countByRole('admin')).toBe(1);
    });
  });
});

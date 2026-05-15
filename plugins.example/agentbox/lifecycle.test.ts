/**
 * Full run-lifecycle integration tests (#351).
 *
 * Drives the executor against a real Node subprocess fixture
 * (tests/fixtures/agentbox/fake-agentbox.mjs) that writes journal
 * entries to a SQLite at <workDir>/.agentbox/agentbox.db, then exits
 * with a configurable code. This exercises the assembled system end
 * to end:
 *
 *   executor.executeRun → spawn → agentbox journal SQLite write →
 *   journal-reader read → executor exit handler → status row
 *
 * Existing executor.test.ts mocks `child_process.spawn`, so it
 * cannot catch regressions in the spawn path itself, the
 * journal-reader handshake, or the kill escalation under real
 * signal delivery. Those are the bugs this file is here to surface.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { PluginDatabase } from '../../src/services/plugin-database.js';
import { createSchema } from './schema.js';
import { migrateRunsTable } from '../agentbox.js';
import {
  executeRun,
  cancelActiveRun,
  pauseActiveRun,
  getActiveRunId,
  _resetActiveProcess,
} from './executor.js';
import { readJournalEntries } from './journal-reader.js';

const FIXTURE_BIN = path.resolve(
  // import.meta.url points at this file; the fixture is colocated
  // under tests/fixtures/agentbox/.
  new URL('../../tests/fixtures/agentbox/fake-agentbox.mjs', import.meta.url).pathname,
);

let rawDb: Database.Database;
let pluginDb: PluginDatabase;
let workDirRoot: string;

async function freshWorkDir(name: string): Promise<string> {
  const wd = path.join(workDirRoot, name);
  await mkdir(wd, { recursive: true });
  return wd;
}

beforeEach(async () => {
  rawDb = new Database(':memory:');
  rawDb.pragma('journal_mode = WAL');
  pluginDb = new PluginDatabase(rawDb, 'agentbox');
  createSchema(pluginDb);
  migrateRunsTable(pluginDb);
  workDirRoot = await mkdtemp(path.join(tmpdir(), 'agentbox-lifecycle-'));
  // Defensive: clear any FAKE_* env vars that a prior spec might have
  // leaked (e.g. if an `expect` threw before the finally block).
  for (const k of ['FAKE_EXIT_CODE', 'FAKE_ENTRIES', 'FAKE_ENTRY_DELAY_MS', 'FAKE_HANG_MS']) {
    delete process.env[k];
  }
});

afterEach(async () => {
  rawDb.close();
  await rm(workDirRoot, { recursive: true, force: true }).catch(() => { /* best-effort */ });
  _resetActiveProcess();
});

function getRunRow(runId: number): Record<string, unknown> | undefined {
  return rawDb
    .prepare(`SELECT * FROM ${pluginDb.prefix}runs WHERE id = ?`)
    .get(runId) as Record<string, unknown> | undefined;
}

describe('agentbox lifecycle integration (#351)', () => {
  describe('happy path', () => {
    it('transitions pending → running → success and produces readable journal entries', async () => {
      const workDir = await freshWorkDir('happy');

      const result = await executeRun({
        db: pluginDb,
        issueNumber: 42,
        repo: 'test-org/test-repo',
        workDir,
        mode: 'sprint',
        binaryPath: FIXTURE_BIN,
        timeoutMs: 10_000,
      });

      expect(result.status).toBe('success');
      expect(result.exitCode).toBe(0);

      const row = getRunRow(result.runId);
      expect(row?.status).toBe('success');
      expect(row?.started_at).toEqual(expect.any(Number));
      expect(row?.finished_at).toEqual(expect.any(Number));
      expect(Number(row?.finished_at) - Number(row?.started_at)).toBeGreaterThanOrEqual(0);
      // Journal-reader sees the entries the fake binary wrote.
      const entries = readJournalEntries(workDir);
      expect(entries).toHaveLength(2);
      expect(entries[0]).toMatchObject({ summary: 'Entry 1', iteration: 1 });
      expect(entries[1]).toMatchObject({ summary: 'Entry 2', iteration: 2 });
    });

    it('cursor query (sinceId) returns only newer entries', async () => {
      const workDir = await freshWorkDir('cursor');

      const result = await executeRun({
        db: pluginDb,
        issueNumber: 7,
        repo: 'org/r',
        workDir,
        mode: 'sprint',
        binaryPath: FIXTURE_BIN,
        timeoutMs: 10_000,
      });
      expect(result.status).toBe('success');

      const all = readJournalEntries(workDir, 0);
      expect(all).toHaveLength(2);
      const newer = readJournalEntries(workDir, all[0]!.id);
      expect(newer).toHaveLength(1);
      expect(newer[0]!.id).toBe(all[1]!.id);
      expect(readJournalEntries(workDir, all[1]!.id)).toHaveLength(0);
    });
  });

  describe('failure path', () => {
    it('non-zero exit transitions the row to failed with an error message', async () => {
      const workDir = await freshWorkDir('fail');
      const oldEnv = process.env.FAKE_EXIT_CODE;
      process.env.FAKE_EXIT_CODE = '1';
      try {
        const result = await executeRun({
          db: pluginDb,
          issueNumber: 100,
          repo: 'org/r',
          workDir,
          mode: 'sprint',
          binaryPath: FIXTURE_BIN,
          timeoutMs: 10_000,
        });
        expect(result.status).toBe('failed');
        expect(result.exitCode).toBe(1);
        const row = getRunRow(result.runId);
        expect(row?.status).toBe('failed');
        expect(row?.error).toContain('agentbox exited with code 1');
      } finally {
        if (oldEnv === undefined) delete process.env.FAKE_EXIT_CODE;
        else process.env.FAKE_EXIT_CODE = oldEnv;
      }
    });
  });

  describe('cancel path', () => {
    it('cancelActiveRun() during a long-running subprocess transitions to cancelled', async () => {
      const workDir = await freshWorkDir('cancel');
      const oldHang = process.env.FAKE_HANG_MS;
      process.env.FAKE_HANG_MS = '5000';
      try {
        const runPromise = executeRun({
          db: pluginDb,
          issueNumber: 50,
          repo: 'org/r',
          workDir,
          mode: 'sprint',
          binaryPath: FIXTURE_BIN,
          timeoutMs: 10_000,
        });

        // Wait until the binary has written its first journal entry —
        // proves the subprocess is alive AND has installed its
        // SIGTERM handler. Asserting only on getActiveRunId() races
        // the OS signal against the binary's handler installation.
        for (let i = 0; i < 100; i++) {
          if (getActiveRunId() !== null && readJournalEntries(workDir).length > 0) break;
          await delay(20);
        }
        expect(getActiveRunId()).not.toBeNull();
        expect(readJournalEntries(workDir).length).toBeGreaterThan(0);

        const cancelled = cancelActiveRun();
        expect(cancelled).toBe(true);

        const result = await runPromise;
        // The fake binary catches SIGTERM and writes a checkpoint
        // before exiting 0; the executor sees cancelRequested and
        // records 'cancelled' regardless of exit code.
        expect(result.status).toBe('cancelled');
        const row = getRunRow(result.runId);
        expect(row?.status).toBe('cancelled');
        expect(row?.finished_at).toEqual(expect.any(Number));
      } finally {
        if (oldHang === undefined) delete process.env.FAKE_HANG_MS;
        else process.env.FAKE_HANG_MS = oldHang;
      }
    });

    it('cancelActiveRun() returns false when no run is active', () => {
      expect(cancelActiveRun()).toBe(false);
    });
  });

  describe('pause path', () => {
    it('pauseActiveRun() during a long-running subprocess transitions to paused with paused_at set', async () => {
      const workDir = await freshWorkDir('pause');
      const oldHang = process.env.FAKE_HANG_MS;
      process.env.FAKE_HANG_MS = '5000';
      try {
        const runPromise = executeRun({
          db: pluginDb,
          issueNumber: 60,
          repo: 'org/r',
          workDir,
          mode: 'sprint',
          binaryPath: FIXTURE_BIN,
          timeoutMs: 10_000,
        });

        // Wait until the binary has installed its SIGTERM handler
        // and written its first journal entry. Sending the signal
        // earlier could land before the handler is registered, in
        // which case the default action (terminate) fires instead
        // of our checkpoint write.
        for (let i = 0; i < 100; i++) {
          if (getActiveRunId() !== null && readJournalEntries(workDir).length > 0) break;
          await delay(20);
        }
        expect(readJournalEntries(workDir).length).toBeGreaterThan(0);

        const paused = pauseActiveRun();
        expect(paused).toBe(true);

        const result = await runPromise;
        expect(result.status).toBe('paused');
        const row = getRunRow(result.runId);
        expect(row?.status).toBe('paused');
        // Paused rows leave finished_at null (the run isn't done).
        expect(row?.finished_at).toBeNull();
        expect(row?.paused_at).toEqual(expect.any(Number));
        // The fake binary's SIGTERM handler writes a checkpoint
        // entry — assert it's visible to the journal-reader.
        const entries = readJournalEntries(workDir);
        const checkpoint = entries.find((e) => e.kind === 'checkpoint');
        expect(checkpoint).toBeDefined();
        expect(checkpoint?.summary).toContain('Checkpoint on SIGTERM');
      } finally {
        if (oldHang === undefined) delete process.env.FAKE_HANG_MS;
        else process.env.FAKE_HANG_MS = oldHang;
      }
    });

    it('pauseActiveRun() returns false when no run is active', () => {
      expect(pauseActiveRun()).toBe(false);
    });
  });

  describe('busy guard', () => {
    it('a second executeRun while one is in flight rejects with ExecutorBusyError', async () => {
      const wd1 = await freshWorkDir('busy-a');
      const wd2 = await freshWorkDir('busy-b');
      const oldHang = process.env.FAKE_HANG_MS;
      process.env.FAKE_HANG_MS = '2000';
      try {
        const first = executeRun({
          db: pluginDb,
          issueNumber: 1,
          repo: 'org/r',
          workDir: wd1,
          mode: 'sprint',
          binaryPath: FIXTURE_BIN,
        });
        // Spin until first is alive.
        for (let i = 0; i < 50; i++) {
          if (getActiveRunId() !== null) break;
          await delay(20);
        }
        // executeRun is `async`, so the synchronous throw is wrapped
        // in a rejected promise — assert via `rejects`.
        await expect(executeRun({
          db: pluginDb,
          issueNumber: 2,
          repo: 'org/r',
          workDir: wd2,
          mode: 'sprint',
          binaryPath: FIXTURE_BIN,
        })).rejects.toThrow(/busy/i);
        // Drain the first run.
        const r1 = await first;
        expect(r1.status).toBe('success');
      } finally {
        if (oldHang === undefined) delete process.env.FAKE_HANG_MS;
        else process.env.FAKE_HANG_MS = oldHang;
      }
    });
  });
});

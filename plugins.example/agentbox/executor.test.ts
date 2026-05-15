/**
 * Tests for the executor service (#238 / T5).
 *
 * `child_process.spawn` is mocked at the module level so we can drive
 * exit/error/timeout paths without actually running a binary. The
 * mocked process is an EventEmitter with stub stdout/stderr streams
 * so the executor can pipe output into the log file. Filesystem ops
 * use per-test temp dirs.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import { PluginDatabase } from '../../src/services/plugin-database.js';

interface SpawnCall {
  bin: string;
  args: string[];
  opts: unknown;
}

let spawnCalls: SpawnCall[] = [];
// Each test's spawn handler returns a mock child. Override per test
// for happy-path / error / timeout / cancellation scenarios.
type MockChild = EventEmitter & {
  stdout: Readable;
  stderr: Readable;
  kill: (signal?: string) => boolean;
  killSignals: string[];
};

let spawnHandler: (bin: string, args: string[]) => MockChild = () => makeChild();

function makeChild(): MockChild {
  const ee = new EventEmitter() as MockChild;
  ee.stdout = Readable.from([]);
  ee.stderr = Readable.from([]);
  ee.killSignals = [];
  ee.kill = (signal?: string) => {
    ee.killSignals.push(signal ?? 'SIGTERM');
    return true;
  };
  return ee;
}

vi.mock('node:child_process', () => ({
  spawn: vi.fn((bin: string, args: string[], opts: unknown) => {
    spawnCalls.push({ bin, args, opts });
    return spawnHandler(bin, args);
  }),
  // execFile is unused by the executor itself but is imported
  // transitively through scheduler.js (via migrateRunsTable's
  // sibling). Provide a stub so the module graph loads.
  execFile: vi.fn(),
}));

import {
  executeRun,
  getActiveProcess,
  getActiveRunId,
  cancelActiveRun,
  pauseActiveRun,
  resumeRun as executorResumeRun,
  ExecutorBusyError,
  _resetActiveProcess,
} from './executor.js';
import { createSchema } from './schema.js';
import { migrateRunsTable } from '../agentbox.js';

let rawDb: Database.Database;
let pluginDb: PluginDatabase;
let workDir: string;
let workDirRoot: string;

async function setupWorkspace(): Promise<void> {
  workDirRoot = path.join(os.tmpdir(), `executor-test-${String(Date.now())}-${String(process.pid)}-${String(Math.random()).slice(2, 8)}`);
  workDir = path.join(workDirRoot, 'workspace');
  await mkdir(workDir, { recursive: true });
}

async function teardownWorkspace(): Promise<void> {
  await rm(workDirRoot, { recursive: true, force: true }).catch(() => { /* best-effort */ });
}

describe('executor (#238)', () => {
  beforeEach(async () => {
    spawnCalls = [];
    spawnHandler = () => makeChild();
    _resetActiveProcess();
    rawDb = new Database(':memory:');
    rawDb.pragma('journal_mode = WAL');
    pluginDb = new PluginDatabase(rawDb, 'agentbox');
    createSchema(pluginDb);
    // Adds T10 columns (session_id, paused_at, etc.) and the T14
    // CHECK widening for 'paused' status.
    migrateRunsTable(pluginDb);
    await setupWorkspace();
  });
  afterEach(async () => { rawDb.close(); await teardownWorkspace(); _resetActiveProcess(); });

  describe('argument construction', () => {
    it('ralph mode passes --prd and --project-dir', async () => {
      spawnHandler = () => {
        const c = makeChild();
        setImmediate(() => c.emit('exit', 0, null));
        return c;
      };

      await executeRun({
        db: pluginDb,
        issueNumber: 1,
        repo: 'org/r',
        workDir,
        prdPath: path.join(workDir, 'prd.json'),
        mode: 'ralph',
        binaryPath: '/fake/agentbox',
      });

      expect(spawnCalls).toHaveLength(1);
      const args = spawnCalls[0]!.args;
      expect(args[0]).toBe('ralph');
      expect(args[args.indexOf('--prd') + 1]).toBe(path.join(workDir, 'prd.json'));
      expect(args[args.indexOf('--project-dir') + 1]).toBe(workDir);
    });

    it('sprint mode passes --project-dir and skips --prd', async () => {
      spawnHandler = () => {
        const c = makeChild();
        setImmediate(() => c.emit('exit', 0, null));
        return c;
      };

      await executeRun({
        db: pluginDb,
        issueNumber: 1,
        repo: 'org/r',
        workDir,
        mode: 'sprint',
        binaryPath: '/fake/agentbox',
      });

      const args = spawnCalls[0]!.args;
      expect(args[0]).toBe('sprint');
      expect(args).not.toContain('--prd');
      expect(args[args.indexOf('--project-dir') + 1]).toBe(workDir);
    });

    it('ralph without prdPath rejects synchronously', async () => {
      await expect(
        executeRun({
          db: pluginDb,
          issueNumber: 1,
          repo: 'org/r',
          workDir,
          mode: 'ralph',
          binaryPath: '/fake/agentbox',
        }),
      ).rejects.toThrow(/prdPath/);
    });
  });

  describe('status transitions', () => {
    it('inserts a pending row, transitions to running, then to success on exit code 0', async () => {
      let child: MockChild | null = null;
      spawnHandler = () => {
        child = makeChild();
        return child;
      };

      const promise = executeRun({
        db: pluginDb,
        issueNumber: 7,
        repo: 'org/r',
        workDir,
        mode: 'sprint',
        binaryPath: '/fake/agentbox',
      });

      // After spawn, the row should be 'running'.
      await new Promise((r) => setImmediate(r));
      let row = rawDb.prepare(`SELECT status, started_at, finished_at FROM ${pluginDb.prefix}runs ORDER BY id DESC LIMIT 1`).get() as { status: string; started_at: number | null; finished_at: number | null };
      expect(row.status).toBe('running');
      expect(row.started_at).toBeGreaterThan(0);
      expect(row.finished_at).toBeNull();

      child!.emit('exit', 0, null);
      const result = await promise;

      expect(result.status).toBe('success');
      row = rawDb.prepare(`SELECT status, finished_at, error FROM ${pluginDb.prefix}runs WHERE id = ?`).get(result.runId) as { status: string; finished_at: number; error: string | null };
      expect(row.status).toBe('success');
      expect(row.finished_at).toBeGreaterThan(0);
      expect(row.error).toBeNull();
    });

    it('transitions to failed with error on non-zero exit code', async () => {
      let child: MockChild | null = null;
      spawnHandler = () => { child = makeChild(); return child; };

      const promise = executeRun({
        db: pluginDb,
        issueNumber: 7,
        repo: 'org/r',
        workDir,
        mode: 'sprint',
        binaryPath: '/fake/agentbox',
      });

      await new Promise((r) => setImmediate(r));
      child!.emit('exit', 2, null);
      const result = await promise;

      expect(result.status).toBe('failed');
      expect(result.error).toMatch(/exited with code 2/);
      const row = rawDb.prepare(`SELECT status, error FROM ${pluginDb.prefix}runs WHERE id = ?`).get(result.runId) as { status: string; error: string };
      expect(row.status).toBe('failed');
      expect(row.error).toMatch(/code 2/);
    });

    it('transitions to failed when spawn emits error (e.g., binary not found)', async () => {
      let child: MockChild | null = null;
      spawnHandler = () => { child = makeChild(); return child; };

      const promise = executeRun({
        db: pluginDb,
        issueNumber: 7,
        repo: 'org/r',
        workDir,
        mode: 'sprint',
        binaryPath: '/fake/agentbox',
      });

      await new Promise((r) => setImmediate(r));
      child!.emit('error', new Error('ENOENT spawn /fake/agentbox'));
      const result = await promise;

      expect(result.status).toBe('failed');
      expect(result.error).toMatch(/ENOENT/);
    });
  });

  describe('single-run lock', () => {
    it('rejects a second concurrent call with ExecutorBusyError', async () => {
      let child: MockChild | null = null;
      spawnHandler = () => { child = makeChild(); return child; };

      const first = executeRun({
        db: pluginDb,
        issueNumber: 1,
        repo: 'org/r',
        workDir,
        mode: 'sprint',
        binaryPath: '/fake/agentbox',
      });

      await new Promise((r) => setImmediate(r));

      await expect(
        executeRun({
          db: pluginDb,
          issueNumber: 2,
          repo: 'org/r',
          workDir,
          mode: 'sprint',
          binaryPath: '/fake/agentbox',
        }),
      ).rejects.toBeInstanceOf(ExecutorBusyError);

      // Resolve first to clean up.
      child!.emit('exit', 0, null);
      await first;
    });

    it('releases the lock when the run finishes so the next call succeeds', async () => {
      let child1: MockChild | null = null;
      let child2: MockChild | null = null;
      spawnHandler = () => { child1 = makeChild(); return child1; };

      const first = executeRun({
        db: pluginDb,
        issueNumber: 1,
        repo: 'org/r',
        workDir,
        mode: 'sprint',
        binaryPath: '/fake/agentbox',
      });
      await new Promise((r) => setImmediate(r));
      child1!.emit('exit', 0, null);
      await first;

      spawnHandler = () => { child2 = makeChild(); return child2; };
      const second = executeRun({
        db: pluginDb,
        issueNumber: 2,
        repo: 'org/r',
        workDir,
        mode: 'sprint',
        binaryPath: '/fake/agentbox',
      });
      await new Promise((r) => setImmediate(r));
      child2!.emit('exit', 0, null);
      const result = await second;
      expect(result.status).toBe('success');
    });

    it('exposes the active process and run id for cancellation', async () => {
      let child: MockChild | null = null;
      spawnHandler = () => { child = makeChild(); return child; };

      expect(getActiveProcess()).toBeNull();
      expect(getActiveRunId()).toBeNull();

      const promise = executeRun({
        db: pluginDb,
        issueNumber: 1,
        repo: 'org/r',
        workDir,
        mode: 'sprint',
        binaryPath: '/fake/agentbox',
      });
      await new Promise((r) => setImmediate(r));

      expect(getActiveProcess()).toBe(child);
      expect(getActiveRunId()).not.toBeNull();

      child!.emit('exit', 0, null);
      await promise;

      expect(getActiveProcess()).toBeNull();
      expect(getActiveRunId()).toBeNull();
    });
  });

  describe('timeout SIGTERM → SIGKILL escalation', () => {
    it('sends SIGTERM after the timeout, then SIGKILL after the grace period', async () => {
      vi.useFakeTimers();
      let child: MockChild | null = null;
      spawnHandler = () => { child = makeChild(); return child; };

      const promise = executeRun({
        db: pluginDb,
        issueNumber: 1,
        repo: 'org/r',
        workDir,
        mode: 'sprint',
        binaryPath: '/fake/agentbox',
        timeoutMs: 10_000,
      });
      await Promise.resolve();
      await Promise.resolve();

      // Advance past the timeout — should send SIGTERM.
      vi.advanceTimersByTime(10_000);
      expect(child!.killSignals).toContain('SIGTERM');
      expect(child!.killSignals).not.toContain('SIGKILL');

      // Advance past the grace period — should send SIGKILL.
      vi.advanceTimersByTime(5_000);
      expect(child!.killSignals).toContain('SIGKILL');

      // Simulate the process dying after SIGKILL.
      child!.emit('exit', null, 'SIGKILL');
      vi.useRealTimers();
      const result = await promise;

      expect(result.status).toBe('cancelled');
      expect(result.error).toMatch(/timeout/i);
      const row = rawDb.prepare(`SELECT status FROM ${pluginDb.prefix}runs WHERE id = ?`).get(result.runId) as { status: string };
      expect(row.status).toBe('cancelled');
    });
  });

  describe('cancelActiveRun() (#238)', () => {
    it('returns false when no run is active', () => {
      expect(cancelActiveRun()).toBe(false);
    });

    it('sends SIGTERM and lands the row at status=cancelled', async () => {
      let child: MockChild | null = null;
      spawnHandler = () => { child = makeChild(); return child; };

      const promise = executeRun({
        db: pluginDb,
        issueNumber: 1,
        repo: 'org/r',
        workDir,
        mode: 'sprint',
        binaryPath: '/fake/agentbox',
      });
      await new Promise((r) => setImmediate(r));

      expect(cancelActiveRun()).toBe(true);
      expect(child!.killSignals).toContain('SIGTERM');

      // The killed subprocess emits exit with a signal.
      child!.emit('exit', null, 'SIGTERM');
      const result = await promise;

      expect(result.status).toBe('cancelled');
      const row = rawDb.prepare(`SELECT status, error FROM ${pluginDb.prefix}runs WHERE id = ?`).get(result.runId) as { status: string; error: string };
      expect(row.status).toBe('cancelled');
      expect(row.error).toMatch(/cancelled by request/i);
    });
  });

  describe('pauseActiveRun() (#244 / T14)', () => {
    it('returns false when no run is active', () => {
      expect(pauseActiveRun()).toBe(false);
    });

    it('sends SIGTERM and lands the row at status=paused with paused_at set', async () => {
      let child: MockChild | null = null;
      spawnHandler = () => { child = makeChild(); return child; };

      const promise = executeRun({
        db: pluginDb, issueNumber: 1, repo: 'org/r', workDir,
        mode: 'sprint', binaryPath: '/fake/agentbox',
      });
      await new Promise((r) => setImmediate(r));

      expect(pauseActiveRun()).toBe(true);
      expect(child!.killSignals).toContain('SIGTERM');

      // agentbox catches SIGTERM, checkpoints, exits cleanly.
      child!.emit('exit', 0, 'SIGTERM');
      const result = await promise;

      expect(result.status).toBe('paused');
      const row = rawDb
        .prepare(`SELECT status, paused_at, finished_at, error FROM ${pluginDb.prefix}runs WHERE id = ?`)
        .get(result.runId) as { status: string; paused_at: number | null; finished_at: number | null; error: string | null };
      expect(row.status).toBe('paused');
      expect(row.paused_at).toBeTypeOf('number');
      // Paused isn't terminal — finished_at must remain null so the
      // run detail page doesn't claim a duration.
      expect(row.finished_at).toBeNull();
      expect(row.error).toBeNull();
    });
  });

  describe('resumeRun() (#244 / T14)', () => {
    it('throws when the row does not exist', async () => {
      await expect(executorResumeRun({
        db: pluginDb, runId: 99999, workDir, binaryPath: '/fake/agentbox',
      })).rejects.toThrow(/does not exist/);
    });

    it('throws when the row is not in paused state', async () => {
      rawDb.prepare(
        `INSERT INTO ${pluginDb.prefix}runs (issue_number, repo, status, output_path, created_at) VALUES (?, ?, ?, ?, ?)`,
      ).run(1, 'org/r', 'success', `${workDir}/run.log`, Date.now());
      const id = (rawDb.prepare(`SELECT id FROM ${pluginDb.prefix}runs LIMIT 1`).get() as { id: number }).id;

      await expect(executorResumeRun({
        db: pluginDb, runId: id, workDir, binaryPath: '/fake/agentbox',
      })).rejects.toThrow(/is not paused/);
    });

    it('flips a paused row back to running, then through to terminal status', async () => {
      // Seed a paused row pointing at our temp workDir.
      rawDb.prepare(
        `INSERT INTO ${pluginDb.prefix}runs (issue_number, repo, status, output_path, paused_at, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(7, 'org/r', 'paused', `${workDir}/run.log`, Date.now(), Date.now());
      const id = (rawDb.prepare(`SELECT id FROM ${pluginDb.prefix}runs LIMIT 1`).get() as { id: number }).id;

      let child: MockChild | null = null;
      spawnHandler = () => { child = makeChild(); return child; };

      const promise = executorResumeRun({
        db: pluginDb, runId: id, workDir, binaryPath: '/fake/agentbox',
      });
      await new Promise((r) => setImmediate(r));

      // Row should already be running before the subprocess exits.
      const midRow = rawDb.prepare(`SELECT status FROM ${pluginDb.prefix}runs WHERE id = ?`).get(id) as { status: string };
      expect(midRow.status).toBe('running');

      // Subprocess exits successfully.
      child!.emit('exit', 0, null);
      const result = await promise;

      expect(result.status).toBe('success');
      const finalRow = rawDb.prepare(`SELECT status, finished_at FROM ${pluginDb.prefix}runs WHERE id = ?`).get(id) as { status: string; finished_at: number | null };
      expect(finalRow.status).toBe('success');
      expect(finalRow.finished_at).toBeTypeOf('number');
    });

    it('rejects with ExecutorBusyError if another run is in flight', async () => {
      // Seed a paused row.
      rawDb.prepare(
        `INSERT INTO ${pluginDb.prefix}runs (issue_number, repo, status, output_path, created_at) VALUES (?, ?, ?, ?, ?)`,
      ).run(7, 'org/r', 'paused', `${workDir}/run.log`, Date.now());
      const id = (rawDb.prepare(`SELECT id FROM ${pluginDb.prefix}runs LIMIT 1`).get() as { id: number }).id;

      // Start a regular run to occupy the executor lock.
      let firstChild: MockChild | null = null;
      spawnHandler = () => { firstChild = makeChild(); return firstChild; };
      const blocking = executeRun({
        db: pluginDb, issueNumber: 99, repo: 'org/r', workDir,
        mode: 'sprint', binaryPath: '/fake/agentbox',
      });
      await new Promise((r) => setImmediate(r));

      await expect(executorResumeRun({
        db: pluginDb, runId: id, workDir, binaryPath: '/fake/agentbox',
      })).rejects.toBeInstanceOf(ExecutorBusyError);

      // Cleanup — let the blocking run finish.
      firstChild!.emit('exit', 0, null);
      await blocking;
    });
  });

  describe('output capture', () => {
    it('streams stdout and stderr to {workDir}/run.log', async () => {
      let child: MockChild | null = null;
      spawnHandler = () => {
        child = makeChild();
        child.stdout = Readable.from(['hello\n', 'from stdout\n']);
        child.stderr = Readable.from(['warning\n']);
        return child;
      };

      const promise = executeRun({
        db: pluginDb,
        issueNumber: 1,
        repo: 'org/r',
        workDir,
        mode: 'sprint',
        binaryPath: '/fake/agentbox',
      });
      await new Promise((r) => setImmediate(r));
      child!.emit('exit', 0, null);
      const result = await promise;

      const log = await readFile(result.logPath, 'utf-8');
      expect(log).toContain('hello');
      expect(log).toContain('from stdout');
      expect(log).toContain('warning');
    });
  });
});

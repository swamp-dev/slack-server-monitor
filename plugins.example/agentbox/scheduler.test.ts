/**
 * Tests for the AgentBox issue picker scheduler (#239 / T6).
 *
 * gh and git CLI invocations are mocked at the child_process level —
 * the mock dispatches by argv to differentiate `gh issue list`,
 * `gh issue edit --add-label`, `gh issue edit --remove-label`,
 * `gh issue comment`, and `git clone`. The executor's spawn() is also
 * mocked here because the scheduler invokes executeRun().
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import { PluginDatabase } from '../../src/services/plugin-database.js';

interface ExecResult { stdout?: string; stderr?: string; err?: Error }
type MockChild = EventEmitter & {
  stdout: Readable;
  stderr: Readable;
  kill: (signal?: string) => boolean;
  killSignals: string[];
};
function makeChild(): MockChild {
  const ee = new EventEmitter() as MockChild;
  ee.stdout = Readable.from([]);
  ee.stderr = Readable.from([]);
  ee.killSignals = [];
  ee.kill = (signal?: string) => { ee.killSignals.push(signal ?? 'SIGTERM'); return true; };
  return ee;
}

// Real `node:child_process.execFile` ships with a custom
// promisify symbol that makes `util.promisify(execFile)` resolve to
// `{stdout, stderr}`. Without it, the standard promisify path returns
// just the first non-error arg (stdout as a string), which then breaks
// destructuring `{ stdout } = await execFileAsync(...)` in the SUT.
// Define the custom symbol on the mock so it round-trips correctly.
//
// `vi.mock` is hoisted, so the factory below has to reach values by
// dereferencing a globalThis-keyed bag rather than closing over file-
// level `let` bindings (which aren't initialized when the factory runs).
declare global {
  // eslint-disable-next-line no-var
  var __schedulerTestBag: {
    execCalls: { bin: string; args: string[] }[];
    spawnCalls: { bin: string; args: string[] }[];
    execHandler: (bin: string, args: string[]) => ExecResult;
    spawnHandler: (bin: string, args: string[]) => MockChild;
  } | undefined;
}
globalThis.__schedulerTestBag = {
  execCalls: [],
  spawnCalls: [],
  execHandler: () => ({ stdout: '' }),
  spawnHandler: (() => {
    const c = makeChild();
    setImmediate(() => c.emit('exit', 0, null));
    return c;
  }),
};

vi.mock('node:child_process', () => {
  const PROMISIFY_CUSTOM = Symbol.for('nodejs.util.promisify.custom');
  const bag = (): NonNullable<typeof globalThis.__schedulerTestBag> => globalThis.__schedulerTestBag!;

  function execFileImpl(
    bin: string,
    args: string[],
    _opts: unknown,
    cb: (err: Error | null, stdout: string, stderr: string) => void,
  ): void {
    bag().execCalls.push({ bin, args });
    const result = bag().execHandler(bin, args);
    cb(result.err ?? null, result.stdout ?? '', result.stderr ?? '');
  }
  Object.defineProperty(execFileImpl, PROMISIFY_CUSTOM, {
    value: (bin: string, args: string[]) =>
      new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        bag().execCalls.push({ bin, args });
        const result = bag().execHandler(bin, args);
        if (result.err) reject(result.err);
        else resolve({ stdout: result.stdout ?? '', stderr: result.stderr ?? '' });
      }),
  });

  return {
    execFile: execFileImpl,
    spawn: (bin: string, args: string[]) => {
      bag().spawnCalls.push({ bin, args });
      return bag().spawnHandler(bin, args);
    },
  };
});

import {
  startScheduler,
  pickEligibleIssue,
  cancelRun,
  pauseRun,
  resumeRun,
  _resetSchedulerState,
  type ReadyIssue,
} from './scheduler.js';

// Accessors over the global bag — keep call sites readable.
const bag = (): NonNullable<typeof globalThis.__schedulerTestBag> => globalThis.__schedulerTestBag!;
function execCalls(): { bin: string; args: string[] }[] { return bag().execCalls; }
function spawnCalls(): { bin: string; args: string[] }[] { return bag().spawnCalls; }
function setExecHandler(fn: (bin: string, args: string[]) => ExecResult): void { bag().execHandler = fn; }
function setSpawnHandler(fn: (bin: string, args: string[]) => MockChild): void { bag().spawnHandler = fn; }
import { _resetActiveProcess } from './executor.js';
import { createSchema } from './schema.js';
import { migrateRunsTable } from '../agentbox.js';

let rawDb: Database.Database;
let pluginDb: PluginDatabase;
let workDirRoot: string;
let mockCtx: { db: PluginDatabase; name: string; version: string; notify: () => void; sse: { broadcast: ReturnType<typeof vi.fn>; clientCount: () => number } };

async function setup(): Promise<void> {
  bag().execCalls = [];
  bag().spawnCalls = [];
  _resetActiveProcess();
  _resetSchedulerState();
  rawDb = new Database(':memory:');
  rawDb.pragma('journal_mode = WAL');
  pluginDb = new PluginDatabase(rawDb, 'agentbox');
  createSchema(pluginDb);
  // Adds T10 columns + the T14 'paused' status CHECK widening so
  // pauseRun/resumeRun tests can write through cleanly.
  migrateRunsTable(pluginDb);
  workDirRoot = path.join(os.tmpdir(), `sched-test-${String(Date.now())}-${String(process.pid)}-${String(Math.random()).slice(2, 8)}`);
  await mkdir(workDirRoot, { recursive: true });
  mockCtx = {
    db: pluginDb,
    name: 'agentbox',
    version: '1.0.0',
    notify: vi.fn(),
    sse: { broadcast: vi.fn(), clientCount: () => 0 },
  };
}

async function teardown(): Promise<void> {
  rawDb.close();
  await rm(workDirRoot, { recursive: true, force: true }).catch(() => { /* best-effort */ });
  _resetActiveProcess();
  _resetSchedulerState();
}

// Helper to drive the gh+git mock for a successful pipeline
function defaultExecHandler(issues: ReadyIssue[]): (bin: string, args: string[]) => ExecResult {
  return (bin, args) => {
    if (bin === '/usr/bin/gh' && args[0] === 'issue' && args[1] === 'list') {
      return { stdout: JSON.stringify(issues) };
    }
    if (bin === '/usr/bin/git' && args[0] === 'clone') {
      // Side effect: create the target dir + a fake CLAUDE.md
      const target = args[args.length - 1]!;
      void mkdir(target, { recursive: true }).then(() =>
        writeFile(path.join(target, 'CLAUDE.md'), '# ctx\n', 'utf-8'),
      );
      return { stdout: '' };
    }
    // gh issue edit / comment / etc.
    return { stdout: '' };
  };
}

describe('pickEligibleIssue (#239)', () => {
  beforeEach(async () => { await setup(); });
  afterEach(async () => { await teardown(); });

  function issue(num: number, createdAt: string, labels: string[] = []): ReadyIssue {
    return { number: num, title: `t${String(num)}`, body: '', createdAt, labels: labels.map((name) => ({ name })) };
  }

  it('returns null for an empty list', () => {
    expect(pickEligibleIssue([], pluginDb)).toBeNull();
  });

  it('skips issues already running or completed', () => {
    pluginDb
      .prepare(`INSERT INTO ${pluginDb.prefix}runs (issue_number, repo, status, created_at) VALUES (?, ?, ?, ?)`)
      .run(1, 'org/r', 'running', Date.now());
    pluginDb
      .prepare(`INSERT INTO ${pluginDb.prefix}runs (issue_number, repo, status, created_at) VALUES (?, ?, ?, ?)`)
      .run(2, 'org/r', 'success', Date.now());

    const picked = pickEligibleIssue(
      [issue(1, '2026-01-01'), issue(2, '2026-01-02'), issue(3, '2026-01-03')],
      pluginDb,
    );
    expect(picked?.number).toBe(3);
  });

  it('does NOT skip issues that previously failed (gives them a retry)', () => {
    pluginDb
      .prepare(`INSERT INTO ${pluginDb.prefix}runs (issue_number, repo, status, created_at) VALUES (?, ?, ?, ?)`)
      .run(1, 'org/r', 'failed', Date.now());

    const picked = pickEligibleIssue([issue(1, '2026-01-01')], pluginDb);
    expect(picked?.number).toBe(1);
  });

  it('orders priority:high before unlabeled', () => {
    const picked = pickEligibleIssue(
      [issue(1, '2026-01-01'), issue(2, '2026-01-02', ['priority:high'])],
      pluginDb,
    );
    expect(picked?.number).toBe(2);
  });

  it('among same priority, picks the oldest', () => {
    const picked = pickEligibleIssue(
      [
        issue(3, '2026-03-03', ['priority:high']),
        issue(2, '2026-02-02', ['priority:high']),
        issue(1, '2026-01-01', ['priority:high']),
      ],
      pluginDb,
    );
    expect(picked?.number).toBe(1);
  });
});

describe('startScheduler (#239)', () => {
  beforeEach(async () => { await setup(); });
  afterEach(async () => { await teardown(); });

  it('no-ops when config.enabled is false', () => {
    const handle = startScheduler({
      db: pluginDb,
      ctx: mockCtx,
      config: {
        enabled: false,
        intervalMinutes: 1,
        repo: 'org/r',
        workDirRoot,
      },
    });
    expect(handle).toBeDefined();
    expect(execCalls).toHaveLength(0);
  });

  it('runs the full pipeline on the initial tick when an eligible issue exists', async () => {
    const issues: ReadyIssue[] = [
      { number: 42, title: 'feat: x', body: '## Summary\n\nGo.', createdAt: '2026-01-01', labels: [{ name: 'agentbox-ready' }] },
    ];
    setExecHandler(defaultExecHandler(issues));

    const handle = startScheduler({
      db: pluginDb,
      ctx: mockCtx,
      config: {
        enabled: true,
        intervalMinutes: 60,
        repo: 'org/r',
        workDirRoot,
        agentboxBinaryPath: '/fake/agentbox',
        initialDelayMs: 5,
      },
    });

    // Wait through: initialDelay → list issues → prepareEnv (clone) → executeRun
    await new Promise((r) => setTimeout(r, 80));

    // Issues were listed
    expect(execCalls().some((c) => c.bin === '/usr/bin/gh' && c.args[0] === 'issue' && c.args[1] === 'list')).toBe(true);
    // ready label removed
    expect(execCalls().some((c) => c.args.includes('--remove-label') && c.args.includes('agentbox-ready'))).toBe(true);
    // running label added
    expect(execCalls().some((c) => c.args.includes('--add-label') && c.args.includes('agentbox-running'))).toBe(true);
    // git clone happened (via prepareEnvironment)
    expect(execCalls().some((c) => c.bin === '/usr/bin/git' && c.args[0] === 'clone')).toBe(true);
    // executor spawned the agentbox binary
    expect(spawnCalls().some((c) => c.bin === '/fake/agentbox' && c.args[0] === 'ralph')).toBe(true);
    // running label removed + done label added on success
    expect(execCalls().some((c) => c.args.includes('--remove-label') && c.args.includes('agentbox-running'))).toBe(true);
    expect(execCalls().some((c) => c.args.includes('--add-label') && c.args.includes('agentbox-done'))).toBe(true);
    // SSE broadcast fired for the finish event
    expect(mockCtx.sse.broadcast).toHaveBeenCalledWith('agentbox:run_finished', expect.objectContaining({ status: 'success' }));

    await handle.shutdown();
  });

  it('adds agentbox-failed label when executeRun reports failure', async () => {
    const issues: ReadyIssue[] = [
      { number: 1, title: 't', body: '## Summary\n\nx', createdAt: '2026-01-01', labels: [{ name: 'agentbox-ready' }] },
    ];
    setExecHandler(defaultExecHandler(issues));
    setSpawnHandler(() => {
      const c = makeChild();
      setImmediate(() => c.emit('exit', 2, null));
      return c;
    });

    const handle = startScheduler({
      db: pluginDb,
      ctx: mockCtx,
      config: { enabled: true, intervalMinutes: 60, repo: 'org/r', workDirRoot, agentboxBinaryPath: '/fake/agentbox', initialDelayMs: 5 },
    });
    await new Promise((r) => setTimeout(r, 80));

    expect(execCalls().some((c) => c.args.includes('--add-label') && c.args.includes('agentbox-failed'))).toBe(true);
    await handle.shutdown();
  });

  it('does nothing on a tick when there are no ready issues', async () => {
    setExecHandler(defaultExecHandler([]));

    const handle = startScheduler({
      db: pluginDb,
      ctx: mockCtx,
      config: { enabled: true, intervalMinutes: 60, repo: 'org/r', workDirRoot, agentboxBinaryPath: '/fake/agentbox', initialDelayMs: 5 },
    });
    await new Promise((r) => setTimeout(r, 50));

    expect(execCalls().some((c) => c.bin === '/usr/bin/gh' && c.args[0] === 'issue' && c.args[1] === 'list')).toBe(true);
    expect(spawnCalls).toHaveLength(0);
    expect(execCalls().some((c) => c.args.includes('--add-label'))).toBe(false);
    await handle.shutdown();
  });

  it('shutdown stops the loops and is idempotent', async () => {
    setExecHandler(defaultExecHandler([]));
    const handle = startScheduler({
      db: pluginDb,
      ctx: mockCtx,
      config: { enabled: true, intervalMinutes: 60, repo: 'org/r', workDirRoot, agentboxBinaryPath: '/fake/agentbox', initialDelayMs: 5 },
    });
    await new Promise((r) => setTimeout(r, 30));
    await handle.shutdown();
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });

  it('shutdown waits for an in-flight tick to settle', async () => {
    let resolveSpawn: (() => void) | null = null;
    const issues: ReadyIssue[] = [
      { number: 1, title: 't', body: '## Summary\n\nx', createdAt: '2026-01-01', labels: [{ name: 'agentbox-ready' }] },
    ];
    setExecHandler(defaultExecHandler(issues));
    setSpawnHandler(() => {
      const c = makeChild();
      // Don't emit exit until shutdown unblocks us — simulates a long run.
      resolveSpawn = () => c.emit('exit', 0, null);
      return c;
    });

    const handle = startScheduler({
      db: pluginDb,
      ctx: mockCtx,
      config: { enabled: true, intervalMinutes: 60, repo: 'org/r', workDirRoot, agentboxBinaryPath: '/fake/agentbox', initialDelayMs: 5 },
    });
    await new Promise((r) => setTimeout(r, 30));

    const shutdownPromise = handle.shutdown();
    // Resolve the simulated subprocess so the in-flight tick can complete.
    resolveSpawn?.();
    await shutdownPromise;

    // After shutdown, the labels should have transitioned through to done.
    expect(execCalls().some((c) => c.args.includes('--add-label') && c.args.includes('agentbox-done'))).toBe(true);
  });
});

describe('cancelRun (#239)', () => {
  beforeEach(async () => { await setup(); });
  afterEach(async () => { await teardown(); });

  it('throws when the runId does not exist', async () => {
    await expect(cancelRun(999, 'alice', { db: pluginDb, repo: 'org/r' })).rejects.toThrow(/does not exist/i);
  });

  it('is a no-op for a run already in terminal state (success/failed/cancelled)', async () => {
    pluginDb
      .prepare(`INSERT INTO ${pluginDb.prefix}runs (issue_number, repo, status, created_at) VALUES (?, ?, ?, ?)`)
      .run(1, 'org/r', 'success', Date.now());
    const row = rawDb.prepare(`SELECT id FROM ${pluginDb.prefix}runs ORDER BY id DESC LIMIT 1`).get() as { id: number };

    await expect(cancelRun(row.id, 'alice', { db: pluginDb, repo: 'org/r' })).resolves.toBeUndefined();

    // No gh calls should fire for an already-settled run.
    expect(execCalls().some((c) => c.args.includes('--add-label'))).toBe(false);
    expect(execCalls().some((c) => c.args[0] === 'issue' && c.args[1] === 'comment')).toBe(false);
  });

  it('is a no-op when the runs row says running but the executor is idle (race with natural exit)', async () => {
    pluginDb
      .prepare(`INSERT INTO ${pluginDb.prefix}runs (issue_number, repo, status, created_at) VALUES (?, ?, ?, ?)`)
      .run(1, 'org/r', 'running', Date.now());
    const row = rawDb.prepare(`SELECT id FROM ${pluginDb.prefix}runs ORDER BY id DESC LIMIT 1`).get() as { id: number };

    // No active executor process — getActiveRunId() returns null.
    await expect(cancelRun(row.id, 'alice', { db: pluginDb, repo: 'org/r' })).resolves.toBeUndefined();
    expect(execCalls().some((c) => c.args[0] === 'issue' && c.args[1] === 'comment')).toBe(false);
  });

  it('kills the active subprocess, transitions labels, and posts a comment', async () => {
    const issues: ReadyIssue[] = [
      { number: 7, title: 't', body: '## Summary\n\nx', createdAt: '2026-01-01', labels: [{ name: 'agentbox-ready' }] },
    ];
    setExecHandler(defaultExecHandler(issues));

    let activeChild: MockChild | null = null;
    setSpawnHandler(() => {
      activeChild = makeChild();
      // Don't auto-exit — wait for cancelRun to fire SIGTERM.
      return activeChild;
    });

    const handle = startScheduler({
      db: pluginDb,
      ctx: mockCtx,
      config: { enabled: true, intervalMinutes: 60, repo: 'org/r', workDirRoot, agentboxBinaryPath: '/fake/agentbox', initialDelayMs: 5 },
    });
    // Let the pipeline reach the spawn point.
    await new Promise((r) => setTimeout(r, 40));

    const row = rawDb.prepare(`SELECT id FROM ${pluginDb.prefix}runs ORDER BY id DESC LIMIT 1`).get() as { id: number };
    await cancelRun(row.id, 'alice', { db: pluginDb, repo: 'org/r' });

    expect(activeChild!.killSignals).toContain('SIGTERM');
    expect(execCalls().some((c) => c.args.includes('--remove-label') && c.args.includes('agentbox-running'))).toBe(true);
    expect(execCalls().some((c) => c.args.includes('--add-label') && c.args.includes('agentbox-failed'))).toBe(true);
    expect(execCalls().some((c) => c.args[0] === 'issue' && c.args[1] === 'comment' && c.args.includes('--body'))).toBe(true);
    const commentCall = execCalls().find((c) => c.args[0] === 'issue' && c.args[1] === 'comment');
    expect(commentCall?.args[commentCall.args.indexOf('--body') + 1]).toMatch(/cancelled by alice/i);

    activeChild!.emit('exit', null, 'SIGTERM');
    await handle.shutdown();
  });
});

describe('runIssuePipeline paused-exit cleanup (#244 / T14)', () => {
  beforeEach(async () => { await setup(); });
  afterEach(async () => { await teardown(); });

  it('preserves the workdir when executeRun exits paused — required for resume to find the checkpoint', async () => {
    const issues: ReadyIssue[] = [
      { number: 7, title: 't', body: '## Summary\n\nx', createdAt: '2026-01-01', labels: [{ name: 'agentbox-ready' }] },
    ];
    setExecHandler(defaultExecHandler(issues));

    let activeChild: MockChild | null = null;
    setSpawnHandler(() => {
      activeChild = makeChild();
      return activeChild;
    });

    const handle = startScheduler({
      db: pluginDb,
      ctx: mockCtx,
      config: { enabled: true, intervalMinutes: 60, repo: 'org/r', workDirRoot, agentboxBinaryPath: '/fake/agentbox', initialDelayMs: 5 },
    });
    await new Promise((r) => setTimeout(r, 40));

    // Pause the active subprocess; agentbox checkpoints and exits.
    const row = rawDb.prepare(`SELECT id FROM ${pluginDb.prefix}runs ORDER BY id DESC LIMIT 1`).get() as { id: number };
    await pauseRun(row.id, { db: pluginDb, repo: 'org/r' });
    activeChild!.emit('exit', 0, 'SIGTERM');
    await handle.shutdown();

    // The workdir recorded on the row must still exist on disk.
    // Without this, executor.resumeRun's `cwd: workDir` spawn would
    // fail to find the agentbox session.
    const finalRow = rawDb
      .prepare(`SELECT status, output_path FROM ${pluginDb.prefix}runs WHERE id = ?`)
      .get(row.id) as { status: string; output_path: string };
    expect(finalRow.status).toBe('paused');
    expect(finalRow.output_path).toBeTruthy();

    const workDir = path.dirname(finalRow.output_path);
    const fs = await import('node:fs/promises');
    const stat = await fs.stat(workDir).catch(() => null);
    expect(stat?.isDirectory()).toBe(true);
  });
});

describe('pauseRun (#244 / T14)', () => {
  beforeEach(async () => { await setup(); });
  afterEach(async () => { await teardown(); });

  it('throws when the runId does not exist', async () => {
    await expect(pauseRun(999, { db: pluginDb, repo: 'org/r' })).rejects.toThrow(/does not exist/i);
  });

  it('is a no-op for terminal runs', async () => {
    pluginDb
      .prepare(`INSERT INTO ${pluginDb.prefix}runs (issue_number, repo, status, created_at) VALUES (?, ?, ?, ?)`)
      .run(1, 'org/r', 'success', Date.now());
    const row = rawDb.prepare(`SELECT id FROM ${pluginDb.prefix}runs ORDER BY id DESC LIMIT 1`).get() as { id: number };

    await expect(pauseRun(row.id, { db: pluginDb, repo: 'org/r' })).resolves.toBeUndefined();
    // No label transitions for an already-settled run.
    expect(execCalls().some((c) => c.args.includes('--add-label'))).toBe(false);
  });

  it('is a no-op for already-paused runs (idempotent)', async () => {
    pluginDb
      .prepare(`INSERT INTO ${pluginDb.prefix}runs (issue_number, repo, status, created_at) VALUES (?, ?, ?, ?)`)
      .run(1, 'org/r', 'paused', Date.now());
    const row = rawDb.prepare(`SELECT id FROM ${pluginDb.prefix}runs ORDER BY id DESC LIMIT 1`).get() as { id: number };

    await expect(pauseRun(row.id, { db: pluginDb, repo: 'org/r' })).resolves.toBeUndefined();
    expect(execCalls().some((c) => c.args.includes('--add-label'))).toBe(false);
  });

  it('SIGTERMs the active subprocess and transitions labels', async () => {
    const issues: ReadyIssue[] = [
      { number: 7, title: 't', body: '## Summary\n\nx', createdAt: '2026-01-01', labels: [{ name: 'agentbox-ready' }] },
    ];
    setExecHandler(defaultExecHandler(issues));

    let activeChild: MockChild | null = null;
    setSpawnHandler(() => {
      activeChild = makeChild();
      return activeChild;
    });

    const handle = startScheduler({
      db: pluginDb,
      ctx: mockCtx,
      config: { enabled: true, intervalMinutes: 60, repo: 'org/r', workDirRoot, agentboxBinaryPath: '/fake/agentbox', initialDelayMs: 5 },
    });
    await new Promise((r) => setTimeout(r, 40));

    const row = rawDb.prepare(`SELECT id FROM ${pluginDb.prefix}runs ORDER BY id DESC LIMIT 1`).get() as { id: number };
    await pauseRun(row.id, { db: pluginDb, repo: 'org/r' });

    expect(activeChild!.killSignals).toContain('SIGTERM');
    expect(execCalls().some((c) => c.args.includes('--remove-label') && c.args.includes('agentbox-running'))).toBe(true);
    expect(execCalls().some((c) => c.args.includes('--add-label') && c.args.includes('agentbox-paused'))).toBe(true);
    // No issue comment — pause is reversible, unlike cancel.
    expect(execCalls().some((c) => c.args[0] === 'issue' && c.args[1] === 'comment')).toBe(false);

    // Clean exit with code 0 — agentbox checkpointed.
    activeChild!.emit('exit', 0, 'SIGTERM');
    await handle.shutdown();

    const finalRow = rawDb.prepare(`SELECT status, paused_at FROM ${pluginDb.prefix}runs WHERE id = ?`).get(row.id) as { status: string; paused_at: number | null };
    expect(finalRow.status).toBe('paused');
    expect(finalRow.paused_at).toBeTypeOf('number');
  });
});

describe('resumeRun (#244 / T14)', () => {
  beforeEach(async () => { await setup(); });
  afterEach(async () => { await teardown(); });

  it('throws when the runId does not exist', async () => {
    await expect(resumeRun(999, { db: pluginDb, repo: 'org/r' })).rejects.toThrow(/does not exist/i);
  });

  it('throws when the run is not paused', async () => {
    pluginDb
      .prepare(`INSERT INTO ${pluginDb.prefix}runs (issue_number, repo, status, output_path, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(1, 'org/r', 'success', '/tmp/r.log', Date.now());
    const row = rawDb.prepare(`SELECT id FROM ${pluginDb.prefix}runs ORDER BY id DESC LIMIT 1`).get() as { id: number };
    await expect(resumeRun(row.id, { db: pluginDb, repo: 'org/r' })).rejects.toThrow(/is not paused/i);
  });

  it('throws when the row has no recorded workDir', async () => {
    pluginDb
      .prepare(`INSERT INTO ${pluginDb.prefix}runs (issue_number, repo, status, output_path, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(1, 'org/r', 'paused', null, Date.now());
    const row = rawDb.prepare(`SELECT id FROM ${pluginDb.prefix}runs ORDER BY id DESC LIMIT 1`).get() as { id: number };
    await expect(resumeRun(row.id, { db: pluginDb, repo: 'org/r' })).rejects.toThrow(/no recorded workDir/i);
  });

  it('transitions labels and dispatches the executor for a paused run', async () => {
    // Seed a paused row pointing at our temp work dir.
    const logPath = path.join(workDirRoot, 'run.log');
    pluginDb
      .prepare(`INSERT INTO ${pluginDb.prefix}runs (issue_number, repo, status, output_path, paused_at, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(7, 'org/r', 'paused', logPath, Date.now(), Date.now());
    const row = rawDb.prepare(`SELECT id FROM ${pluginDb.prefix}runs ORDER BY id DESC LIMIT 1`).get() as { id: number };

    setExecHandler(() => ({ stdout: '', stderr: '', code: 0 }));
    let activeChild: MockChild | null = null;
    setSpawnHandler((bin, args) => {
      activeChild = makeChild();
      // The resume path should invoke `agentbox sprint --resume`.
      expect(args).toEqual(['sprint', '--resume']);
      return activeChild;
    });

    const promise = resumeRun(row.id, { db: pluginDb, repo: 'org/r', binaryPath: '/fake/agentbox' });
    await new Promise((r) => setImmediate(r));

    // Subprocess exits cleanly.
    activeChild!.emit('exit', 0, null);
    const result = await promise;

    expect(result.status).toBe('success');
    expect(execCalls().some((c) => c.args.includes('--remove-label') && c.args.includes('agentbox-paused'))).toBe(true);
    expect(execCalls().some((c) => c.args.includes('--add-label') && c.args.includes('agentbox-running'))).toBe(true);
    expect(execCalls().some((c) => c.args.includes('--add-label') && c.args.includes('agentbox-done'))).toBe(true);
  });
});

/**
 * Executor service (#238 / T5).
 *
 * Wraps the agentbox CLI: spawns a subprocess for `agentbox ralph` or
 * `agentbox sprint`, streams stdout+stderr to a per-run log file,
 * tracks status transitions in the plugin DB, enforces a single-run
 * lock, and gracefully escalates SIGTERM → SIGKILL on timeout/cancel.
 *
 * Uses `child_process.spawn` (no shell) so caller-supplied args aren't
 * interpreted by /bin/sh. The agentbox binary path is configurable via
 * AGENTBOX_BINARY_PATH; the binary is also added to the secure shell
 * allowlist so other tools that go through `secureExec` can invoke
 * its read-only subcommands (status, journal, task-list).
 */
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { createWriteStream, type WriteStream } from 'node:fs';
import path from 'node:path';
import { logger } from '../../src/utils/logger.js';
import type { PluginDatabase } from '../../src/services/plugin-database.js';

export type ExecutorMode = 'ralph' | 'sprint';

export interface ExecuteRunOpts {
  /** Plugin database — used to insert and update the runs row. */
  db: PluginDatabase;
  /** Issue number associated with this run (for the runs row). */
  issueNumber: number;
  /** Owner/repo string (for the runs row). */
  repo: string;
  /** Workspace root prepared by `prepareEnvironment` (#237). */
  workDir: string;
  /** Path to the prd.json the agent will consume (ralph mode only). */
  prdPath?: string;
  /** Mode dispatched to the CLI: "ralph" runs a single ticket; "sprint" runs a planned sprint. */
  mode: ExecutorMode;
  /** Path to the agentbox binary. Defaults to AGENTBOX_BINARY_PATH or /root/agentbox/agentbox. */
  binaryPath?: string;
  /** Hard timeout in ms. After this, SIGTERM is sent, then SIGKILL after 5s. Default 1h. */
  timeoutMs?: number;
}

export interface ExecuteRunResult {
  /** runs.id of the created row. */
  runId: number;
  /** Final status the row landed on. */
  status: 'success' | 'failed' | 'cancelled';
  /** Absolute path to the captured log file. */
  logPath: string;
  /** Raw exit code from the CLI (null if the process was killed before exit). */
  exitCode: number | null;
  /** Optional error message persisted on failure. */
  error?: string;
}

const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000; // 1h
const SIGKILL_GRACE_MS = 5_000;

let activeProcess: ChildProcess | null = null;
let activeRunId: number | null = null;

export class ExecutorBusyError extends Error {
  constructor(currentRunId: number) {
    super(`agentbox executor is busy (active run: ${String(currentRunId)})`);
    this.name = 'ExecutorBusyError';
  }
}

export function getActiveProcess(): ChildProcess | null {
  return activeProcess;
}

export function getActiveRunId(): number | null {
  return activeRunId;
}

/** For tests: clear the module-level lock between describes. */
export function _resetActiveProcess(): void {
  activeProcess = null;
  activeRunId = null;
  cancelRequested = false;
}

/**
 * Resolve the agentbox binary. Caller can override per-call; otherwise
 * fall back to env, then to the same default the rest of the plugin uses.
 */
function resolveBinary(opts: ExecuteRunOpts): string {
  return opts.binaryPath ?? process.env.AGENTBOX_BINARY_PATH ?? '/root/agentbox/agentbox';
}

function buildArgs(opts: ExecuteRunOpts): string[] {
  if (opts.mode === 'ralph') {
    if (!opts.prdPath) {
      throw new Error('ralph mode requires prdPath');
    }
    return ['ralph', '--prd', opts.prdPath, '--project-dir', opts.workDir];
  }
  return ['sprint', '--project-dir', opts.workDir];
}

/**
 * Insert a row into the runs table for this execution. Status starts
 * as `pending` so the row is visible to /agentbox status before the
 * subprocess actually starts.
 */
function insertPendingRun(db: PluginDatabase, opts: ExecuteRunOpts, logPath: string): number {
  const now = Date.now();
  const result = db
    .prepare(
      `INSERT INTO ${db.prefix}runs (issue_number, repo, status, output_path, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(opts.issueNumber, opts.repo, 'pending', logPath, now);
  return Number(result.lastInsertRowid);
}

function setStatus(db: PluginDatabase, runId: number, status: string, fields: Record<string, unknown> = {}): void {
  const allowed = ['started_at', 'finished_at', 'error'];
  const setClauses: string[] = ['status = ?'];
  const values: unknown[] = [status];
  for (const key of allowed) {
    if (key in fields) {
      setClauses.push(`${key} = ?`);
      values.push(fields[key]);
    }
  }
  values.push(runId);
  db.prepare(`UPDATE ${db.prefix}runs SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
}

/**
 * Module-level kill state. The timeout timer flips this to mark the
 * exit as cancellation rather than failure; cancelActiveRun() does
 * the same when called externally.
 */
let cancelRequested = false;

/**
 * Cancel the active run, if any, by sending SIGTERM and marking the
 * exit as cancelled (so the resulting status row reads `cancelled`
 * rather than `failed`). The caller doesn't need to await; the
 * outstanding executeRun promise will resolve when the subprocess
 * actually exits.
 *
 * Returns true if a cancel was issued, false if no run was active.
 */
export function cancelActiveRun(): boolean {
  if (activeProcess === null) return false;
  cancelRequested = true;
  try {
    activeProcess.kill('SIGTERM');
  } catch {
    /* already gone — exit handler will fire */
  }
  return true;
}

/**
 * Run agentbox ralph or sprint. Resolves with the final status. Most
 * operational errors (binary not found, timeout, non-zero exit) are
 * recorded on the runs row and surfaced as the result without
 * throwing.
 *
 * Throws synchronously in two cases the caller should handle:
 *   - `ExecutorBusyError` — another run is in flight; back off.
 *   - validation `Error` — e.g. ralph mode missing prdPath.
 */
export async function executeRun(opts: ExecuteRunOpts): Promise<ExecuteRunResult> {
  if (activeProcess !== null) {
    throw new ExecutorBusyError(activeRunId ?? -1);
  }
  cancelRequested = false;

  const logPath = path.join(opts.workDir, 'run.log');
  const runId = insertPendingRun(opts.db, opts, logPath);

  const binary = resolveBinary(opts);
  const args = buildArgs(opts);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let logStream: WriteStream | null = null;
  try {
    logStream = createWriteStream(logPath, { flags: 'w' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setStatus(opts.db, runId, 'failed', { finished_at: Date.now(), error: `Failed to open log: ${msg}` });
    return { runId, status: 'failed', logPath, exitCode: null, error: msg };
  }

  const spawnOpts: SpawnOptions = {
    cwd: opts.workDir,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  };

  const child = spawn(binary, args, spawnOpts);
  activeProcess = child;
  activeRunId = runId;

  setStatus(opts.db, runId, 'running', { started_at: Date.now() });

  // Track stdout/stderr pipe completion so the log stream can be
  // closed only after both streams have drained — avoids truncation
  // when `exit` fires before the OS pipe buffers flush.
  const drainPromises: Promise<void>[] = [];
  function attachPipe(src: NodeJS.ReadableStream | null): void {
    if (!src) return;
    src.pipe(logStream!, { end: false });
    drainPromises.push(new Promise<void>((resolve) => {
      src.on('end', () => resolve());
      src.on('close', () => resolve());
      src.on('error', () => resolve());
    }));
  }
  attachPipe(child.stdout);
  attachPipe(child.stderr);

  return new Promise<ExecuteRunResult>((resolve) => {
    let resolved = false;
    let timeoutFired = false;
    let killTimer: NodeJS.Timeout | null = null;

    const timeoutTimer = setTimeout(() => {
      if (resolved) return;
      timeoutFired = true;
      cancelRequested = true; // shared flag with cancelActiveRun
      logger.warn('AgentBox executor timeout — sending SIGTERM', { runId, timeoutMs });
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
      killTimer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* already gone */ }
      }, SIGKILL_GRACE_MS);
    }, timeoutMs);

    async function finalize(status: ExecuteRunResult['status'], code: number | null, error: string | undefined): Promise<void> {
      // Wait for piped streams to drain before closing the log file.
      // Using `Promise.allSettled` so a stream error doesn't block.
      await Promise.allSettled(drainPromises);
      logStream?.end();
      activeProcess = null;
      activeRunId = null;
      cancelRequested = false;
      setStatus(opts.db, runId, status, { finished_at: Date.now(), error: error ?? null });
      resolve({ runId, status, logPath, exitCode: code, error });
    }

    child.on('error', (err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      void finalize('failed', null, err.message);
    });

    child.on('exit', (code, signal) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);

      let status: ExecuteRunResult['status'];
      let error: string | undefined;
      if (cancelRequested) {
        status = 'cancelled';
        error = timeoutFired
          ? `Killed after ${String(timeoutMs)}ms timeout (signal ${signal ?? 'unknown'})`
          : `Cancelled by request (signal ${signal ?? 'unknown'})`;
      } else if (code === 0) {
        status = 'success';
      } else {
        status = 'failed';
        error = `agentbox exited with code ${String(code)}${signal ? ` (signal ${signal})` : ''}`;
      }
      void finalize(status, code, error);
    });
  });
}

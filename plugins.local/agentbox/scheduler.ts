/**
 * AgentBox issue picker scheduler (#239 / T6).
 *
 * Two timer-driven loops:
 *   1. Issue picker — every `intervalMinutes`, polls GitHub for issues
 *      labelled `agentbox-ready`, filters out anything already running
 *      or completed, sorts by priority (high first) then age (oldest
 *      first), and runs the prepare → execute → label-update pipeline
 *      for the first eligible issue.
 *   2. Status poller — every 10s while a run is active, broadcasts a
 *      progress event over the plugin's SSE channel.
 *
 * Plus a `cancelRun(runId, cancelledBy)` entry point that kills the
 * active subprocess, transitions the labels, and posts a cancellation
 * comment to the issue.
 *
 * The scheduler enforces serial execution — only one issue runs at a
 * time, gated by the executor's `ExecutorBusyError`.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../../src/utils/logger.js';
import type { PluginContext } from '../../src/plugins/types.js';
import type { PluginDatabase } from '../../src/services/plugin-database.js';
import { prepareEnvironment, cleanupEnvironment } from './environment.js';
import { executeRun, cancelActiveRun, getActiveRunId, ExecutorBusyError } from './executor.js';

const execFileAsync = promisify(execFile);

export interface SchedulerConfig {
  /** Master switch — false disables both loops entirely. */
  enabled: boolean;
  /** Issue-picker interval in minutes. Default 15. */
  intervalMinutes: number;
  /** Owner/repo to poll for `agentbox-ready` issues. */
  repo: string;
  /** Parent dir for workspaces; passed through to prepareEnvironment. */
  workDirRoot: string;
  /** Optional override of the executor's binary path. */
  agentboxBinaryPath?: string;
  /**
   * Initial delay before the first tick. Tests use a small value to
   * exercise the pipeline; production defaults to 5s so the bot has
   * time to finish bootstrapping.
   */
  initialDelayMs?: number;
}

export interface SchedulerHandle {
  /** Stop both loops; awaits any in-flight tick. Idempotent. */
  shutdown(): Promise<void>;
}

export interface ReadyIssue {
  number: number;
  title: string;
  body: string;
  labels: { name: string }[];
  createdAt: string;
}

const GH_TIMEOUT_MS = 30_000;
const STATUS_POLL_INTERVAL_MS = 10_000;
const DEFAULT_INITIAL_DELAY_MS = 5_000;

interface SchedulerState {
  config: SchedulerConfig;
  db: PluginDatabase;
  ctx: PluginContext;
  pickerTimer: NodeJS.Timeout | null;
  pollerTimer: NodeJS.Timeout | null;
  initialTimer: NodeJS.Timeout | null;
  inflight: Promise<void> | null;
  shuttingDown: boolean;
}

let state: SchedulerState | null = null;

export function getSchedulerState(): SchedulerState | null {
  return state;
}

/**
 * Start both scheduler loops. No-ops if `enabled` is false. Returns
 * a handle the plugin's destroy() should call.
 */
export function startScheduler(opts: { db: PluginDatabase; ctx: PluginContext; config: SchedulerConfig }): SchedulerHandle {
  if (state) {
    logger.warn('AgentBox scheduler already started — returning existing handle');
    return makeHandle();
  }
  if (!opts.config.enabled) {
    logger.info('AgentBox scheduler disabled by config');
    return { shutdown: async () => { /* no-op */ } };
  }

  state = {
    config: opts.config,
    db: opts.db,
    ctx: opts.ctx,
    pickerTimer: null,
    pollerTimer: null,
    initialTimer: null,
    inflight: null,
    shuttingDown: false,
  };

  const tick = (): void => {
    if (!state || state.shuttingDown) return;
    if (state.inflight) return; // serial: skip if a run is in flight
    state.inflight = pickAndRun(state)
      .catch((err) => {
        logger.error('AgentBox scheduler tick failed', { error: err instanceof Error ? err.message : String(err) });
      })
      .finally(() => {
        if (state) state.inflight = null;
      });
  };

  const initialDelay = opts.config.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  state.initialTimer = setTimeout(tick, initialDelay);
  state.pickerTimer = setInterval(tick, opts.config.intervalMinutes * 60_000);

  state.pollerTimer = setInterval(() => {
    if (!state || state.shuttingDown) return;
    const runId = getActiveRunId();
    if (runId === null) return;
    const row = state.db
      .prepare(`SELECT id, issue_number, status, started_at FROM ${state.db.prefix}runs WHERE id = ?`)
      .get(runId);
    if (row) state.ctx.sse.broadcast('agentbox:progress', row);
  }, STATUS_POLL_INTERVAL_MS);

  logger.info('AgentBox scheduler started', { intervalMinutes: opts.config.intervalMinutes, repo: opts.config.repo });
  return makeHandle();
}

function makeHandle(): SchedulerHandle {
  return {
    shutdown: async () => {
      if (!state) return;
      state.shuttingDown = true;
      if (state.initialTimer) clearTimeout(state.initialTimer);
      if (state.pickerTimer) clearInterval(state.pickerTimer);
      if (state.pollerTimer) clearInterval(state.pollerTimer);
      const inflight = state.inflight;
      state = null;
      if (inflight) await inflight.catch(() => { /* swallow */ });
    },
  };
}

/**
 * Pick the first eligible `agentbox-ready` issue and run it through
 * the full pipeline: label transition → environment → execution →
 * label transition → cleanup. No-op if no eligible issue exists.
 */
async function pickAndRun(s: SchedulerState): Promise<void> {
  const issues = await listReadyIssues(s.config.repo);
  const picked = pickEligibleIssue(issues, s.db);
  if (!picked) {
    logger.debug('AgentBox scheduler tick — no eligible issues');
    return;
  }

  logger.info('AgentBox scheduler picking issue', { issue: picked.number, title: picked.title });
  await runIssuePipeline(s.db, s.ctx, s.config, picked);
}

/**
 * Run the full pipeline for a specific issue: label transition →
 * environment → execution → label transition → cleanup. Used by both
 * the scheduler's polling loop and the manual `triggerRun` entry
 * point. Best-effort: a label-transition failure is logged but
 * doesn't abort the run.
 */
export async function runIssuePipeline(
  db: PluginDatabase,
  ctx: PluginContext,
  config: SchedulerConfig,
  picked: ReadyIssue,
): Promise<{ runId: number; status: 'success' | 'failed' | 'cancelled' } | null> {
  await ghLabelRemove(picked.number, config.repo, 'agentbox-ready').catch(() => { /* best-effort */ });
  await ghLabelAdd(picked.number, config.repo, 'agentbox-running').catch(() => { /* best-effort */ });

  let envWorkDir: string | null = null;
  try {
    const env = await prepareEnvironment({
      issueNumber: picked.number,
      repo: config.repo,
      issueTitle: picked.title,
      issueBody: picked.body,
      workDirRoot: config.workDirRoot,
    });
    envWorkDir = env.workDir;

    const result = await executeRun({
      db,
      issueNumber: picked.number,
      repo: config.repo,
      workDir: env.workDir,
      prdPath: env.prdPath,
      mode: 'ralph',
      binaryPath: config.agentboxBinaryPath,
    });

    await ghLabelRemove(picked.number, config.repo, 'agentbox-running').catch(() => { /* best-effort */ });
    const finalLabel = result.status === 'success' ? 'agentbox-done' : 'agentbox-failed';
    await ghLabelAdd(picked.number, config.repo, finalLabel).catch(() => { /* best-effort */ });

    ctx.sse.broadcast('agentbox:run_finished', {
      runId: result.runId,
      issueNumber: picked.number,
      status: result.status,
    });
    return { runId: result.runId, status: result.status };
  } catch (err) {
    // ExecutorBusyError means another run is already in flight — the
    // pipeline never started, so don't transition labels or mark this
    // issue as failed. Re-throw so the caller can decide how to
    // surface it (Slack response, retry, etc).
    if (err instanceof ExecutorBusyError) {
      throw err;
    }
    logger.error('AgentBox pipeline failed', {
      issue: picked.number,
      error: err instanceof Error ? err.message : String(err),
    });
    await ghLabelRemove(picked.number, config.repo, 'agentbox-running').catch(() => { /* best-effort */ });
    await ghLabelAdd(picked.number, config.repo, 'agentbox-failed').catch(() => { /* best-effort */ });
    return null;
  } finally {
    if (envWorkDir) {
      await cleanupEnvironment(envWorkDir).catch(() => { /* best-effort */ });
    }
  }
}

/**
 * Manually trigger a run for a specific issue number, bypassing the
 * scheduler's polling loop but going through the same pipeline. Used
 * by the `/agentbox run <issue#>` slash command and the `trigger_run`
 * Claude tool. Fetches the issue via gh first so the manual path
 * works for issues that don't have the `agentbox-ready` label.
 *
 * Throws if the issue can't be fetched. The pipeline itself is
 * best-effort — any pipeline failure is logged and reflected in the
 * runs row.
 */
export async function triggerRun(
  deps: { db: PluginDatabase; ctx: PluginContext },
  config: SchedulerConfig,
  issueNumber: number,
): Promise<{ runId: number; status: 'success' | 'failed' | 'cancelled' } | null> {
  const issue = await fetchIssueDetails(config.repo, issueNumber);
  return runIssuePipeline(deps.db, deps.ctx, config, issue);
}

async function fetchIssueDetails(repo: string, issueNumber: number): Promise<ReadyIssue> {
  const { stdout } = await execFileAsync(
    '/usr/bin/gh',
    [
      'issue', 'view', String(issueNumber),
      '--repo', repo,
      '--json', 'number,title,body,labels,createdAt',
    ],
    { timeout: GH_TIMEOUT_MS },
  );
  const trimmed = stdout.trim();
  if (trimmed === '') {
    throw new Error(`Issue ${repo}#${String(issueNumber)} not found`);
  }
  return JSON.parse(trimmed) as ReadyIssue;
}

/**
 * List `agentbox-ready` open issues via the gh CLI. Returns parsed
 * objects matching the schema requested in the --json flag.
 */
export async function listReadyIssues(repo: string): Promise<ReadyIssue[]> {
  const { stdout } = await execFileAsync(
    '/usr/bin/gh',
    [
      'issue', 'list',
      '--repo', repo,
      '--label', 'agentbox-ready',
      '--state', 'open',
      '--json', 'number,title,body,labels,createdAt',
      '--limit', '50',
    ],
    { timeout: GH_TIMEOUT_MS },
  );
  const trimmed = stdout.trim();
  if (trimmed === '') return [];
  try {
    return JSON.parse(trimmed) as ReadyIssue[];
  } catch (err) {
    logger.warn('AgentBox scheduler: gh returned malformed JSON', {
      error: err instanceof Error ? err.message : String(err),
      stdoutPreview: trimmed.slice(0, 200),
    });
    return [];
  }
}

/**
 * Pick the first eligible issue: filter out anything already running
 * or completed in the runs table, then sort by priority (high first)
 * and age (oldest first). Returns null if none are eligible.
 */
export function pickEligibleIssue(issues: ReadyIssue[], db: PluginDatabase): ReadyIssue | null {
  const eligible = issues.filter((iss) => {
    const row = db
      .prepare(
        `SELECT 1 FROM ${db.prefix}runs WHERE issue_number = ? AND status IN ('running', 'success') LIMIT 1`,
      )
      .get(iss.number);
    return !row;
  });
  eligible.sort((a, b) => {
    const aHigh = hasPriority(a, 'high');
    const bHigh = hasPriority(b, 'high');
    if (aHigh && !bHigh) return -1;
    if (!aHigh && bHigh) return 1;
    return a.createdAt.localeCompare(b.createdAt);
  });
  return eligible[0] ?? null;
}

function hasPriority(iss: ReadyIssue, level: string): boolean {
  return iss.labels.some((l) => l.name === `priority:${level}`);
}

async function ghLabelAdd(issueNumber: number, repo: string, label: string): Promise<void> {
  await execFileAsync(
    '/usr/bin/gh',
    ['issue', 'edit', String(issueNumber), '--repo', repo, '--add-label', label],
    { timeout: GH_TIMEOUT_MS },
  );
}

async function ghLabelRemove(issueNumber: number, repo: string, label: string): Promise<void> {
  await execFileAsync(
    '/usr/bin/gh',
    ['issue', 'edit', String(issueNumber), '--repo', repo, '--remove-label', label],
    { timeout: GH_TIMEOUT_MS },
  );
}

/**
 * Cancel an in-flight run. Kills the subprocess, transitions labels,
 * and posts a comment so the issue thread reflects what happened.
 *
 * Throws if the named runId isn't currently active — the caller can
 * decide whether to surface that as a 404 or a no-op.
 */
export async function cancelRun(
  runId: number,
  cancelledBy: string,
  opts: { db: PluginDatabase; repo: string },
): Promise<void> {
  const row = opts.db
    .prepare(`SELECT issue_number, status FROM ${opts.db.prefix}runs WHERE id = ?`)
    .get(runId) as { issue_number: number; status: string } | undefined;
  if (!row) {
    throw new Error(`Run ${String(runId)} does not exist`);
  }

  // Idempotent: if the run already settled (success/failed/cancelled),
  // there's nothing to cancel. Avoid a TOCTOU error when an operator
  // clicks cancel just as a run finishes naturally.
  if (row.status === 'success' || row.status === 'failed' || row.status === 'cancelled') {
    logger.debug('cancelRun: run already terminal, no-op', { runId, status: row.status });
    return;
  }

  const activeId = getActiveRunId();
  if (activeId !== runId) {
    // The runs row says pending/running but the executor is no longer
    // tracking it. Race: it must have just exited. Treat as no-op.
    logger.debug('cancelRun: not the active run, no-op', { runId, activeId });
    return;
  }

  cancelActiveRun();

  await ghLabelRemove(row.issue_number, opts.repo, 'agentbox-running').catch(() => { /* best-effort */ });
  await ghLabelAdd(row.issue_number, opts.repo, 'agentbox-failed').catch(() => { /* best-effort */ });
  await execFileAsync(
    '/usr/bin/gh',
    [
      'issue', 'comment', String(row.issue_number),
      '--repo', opts.repo,
      '--body', `Run cancelled by ${cancelledBy}.`,
    ],
    { timeout: GH_TIMEOUT_MS },
  ).catch(() => { /* best-effort */ });
}

/**
 * Test-only hook to clear the module singleton between tests so a
 * forgotten shutdown() in one test doesn't blow up isolation in the
 * next. Production callers use shutdown() instead.
 */
export function _resetSchedulerState(): void {
  if (state) {
    if (state.initialTimer) clearTimeout(state.initialTimer);
    if (state.pickerTimer) clearInterval(state.pickerTimer);
    if (state.pollerTimer) clearInterval(state.pollerTimer);
  }
  state = null;
}

/**
 * AgentBox Plugin — GitHub Issue Agent Runner
 */

import type { Plugin, PluginContext } from '../src/plugins/index.js';
import type { PluginDatabase } from '../src/services/plugin-database.js';
import type { ToolDefinition } from '../src/services/tools/types.js';
import type { AgentboxConfig } from './agentbox/types.js';
import { linkIssueToThread, getLinkForIssue } from './agentbox/linking.js';
import { logger } from '../src/utils/logger.js';
import { execFile } from 'node:child_process';
import { listReadyIssues, triggerRun, cancelRun, type SchedulerConfig } from './agentbox/scheduler.js';
import { getActiveRunId } from './agentbox/executor.js';
import {
  registerAgentboxWebRoutes,
  setWebPluginDb,
  setWebDefaultRepo,
  startSSEPolling,
  stopSSEPolling,
  getAgentboxWidgets,
} from './agentbox/web.js';

let pluginDb: PluginDatabase | null = null;
let pluginCtx: PluginContext | null = null;

const config: AgentboxConfig = {
  enabled: process.env.AGENTBOX_ENABLED === 'true',
  binaryPath: process.env.AGENTBOX_BINARY_PATH ?? '/root/agentbox/agentbox',
  workDir: process.env.AGENTBOX_WORK_DIR ?? './data/agentbox-runs',
  defaultRepo: process.env.AGENTBOX_DEFAULT_REPO || undefined,
};

export function getPluginDb(): PluginDatabase | null {
  return pluginDb;
}

export function getConfig(): AgentboxConfig {
  return config;
}

export function handleStatus(db: PluginDatabase): string {
  const rows = db
    .prepare(
      `SELECT id, issue_number, repo, status, branch, pr_url, started_at, finished_at, error, created_at
       FROM ${db.prefix}runs ORDER BY created_at DESC LIMIT 5`,
    )
    .all() as Array<Record<string, unknown>>;

  if (rows.length === 0) {
    return 'No AgentBox runs yet.';
  }

  const lines = rows.map((r) => {
    const status = String(r.status).toUpperCase();
    const issue = `#${r.issue_number}`;
    const repo = String(r.repo);
    return `\u2022 ${repo}${issue} \u2014 ${status}`;
  });

  return `*Recent AgentBox Runs*\n${lines.join('\n')}`;
}

/**
 * Idempotent schema migration — adds columns introduced in T10 (ingestion layer)
 * and widens the status CHECK constraint to allow 'paused' (T14, #244).
 *
 * Adding a column is a single ALTER TABLE; widening a CHECK constraint
 * isn't supported in SQLite, so for the latter we do the standard
 * rename-create-copy-drop dance — gated on detecting the old CHECK in
 * sqlite_master so the migration is a no-op on already-migrated tables.
 */
export function migrateRunsTable(db: PluginDatabase): void {
  const columns = db
    .prepare(`PRAGMA table_info(${db.prefix}runs)`)
    .all() as Array<{ name: string }>;
  const existing = new Set(columns.map((c) => c.name));

  const newColumns: Array<{ name: string; definition: string }> = [
    { name: 'session_id', definition: 'TEXT' },
    { name: 'progress_pct', definition: 'INTEGER DEFAULT 0' },
    { name: 'tasks_total', definition: 'INTEGER' },
    { name: 'tasks_completed', definition: 'INTEGER' },
    { name: 'prd_path', definition: 'TEXT' },
    { name: 'cancelled_by', definition: 'TEXT' },
    { name: 'paused_at', definition: 'INTEGER' },
  ];

  const toAdd = newColumns.filter((col) => !existing.has(col.name));
  if (toAdd.length > 0) {
    db.transaction(() => {
      for (const col of toAdd) {
        db.exec(`ALTER TABLE ${db.prefix}runs ADD COLUMN ${col.name} ${col.definition}`);
      }
    });
  }

  migrateStatusCheckForPaused(db);
}

/**
 * Rebuild the runs table to add 'paused' to the status CHECK
 * constraint. SQLite can't ALTER a CHECK in place, so we rename the
 * existing table, recreate it with the new CHECK, copy rows back, and
 * drop the old table. Skipped if 'paused' is already present.
 */
function migrateStatusCheckForPaused(db: PluginDatabase): void {
  const tableName = `${db.prefix}runs`;
  const row = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name = ?`)
    .get(tableName) as { sql?: string } | undefined;
  if (!row?.sql || row.sql.includes("'paused'")) return;

  // Capture the current column list (in original order) so the
  // INSERT...SELECT copies every value, including the ones T10 added.
  const cols = (db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>)
    .map((c) => c.name);
  const colList = cols.join(', ');
  const oldName = `${tableName}_pre244`;

  db.transaction(() => {
    db.exec(`ALTER TABLE ${tableName} RENAME TO ${oldName}`);
    db.exec(`
      CREATE TABLE ${tableName} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        issue_number INTEGER,
        repo TEXT,
        status TEXT CHECK(status IN ('pending','running','paused','success','failed','cancelled')),
        branch TEXT,
        pr_url TEXT,
        started_at INTEGER,
        finished_at INTEGER,
        output_path TEXT,
        error TEXT,
        created_at INTEGER NOT NULL,
        session_id TEXT,
        progress_pct INTEGER DEFAULT 0,
        tasks_total INTEGER,
        tasks_completed INTEGER,
        prd_path TEXT,
        cancelled_by TEXT,
        paused_at INTEGER
      )
    `);
    db.exec(`INSERT INTO ${tableName} (${colList}) SELECT ${colList} FROM ${oldName}`);
    db.exec(`DROP TABLE ${oldName}`);
  });
}

const REPO_FORMAT = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;

function resolveRepo(input: Record<string, unknown>): string {
  const repo = (input.repo as string | undefined) || config.defaultRepo;
  if (!repo) throw new Error('No repo specified and AGENTBOX_DEFAULT_REPO is not configured');
  if (!REPO_FORMAT.test(repo)) throw new Error(`Invalid repo format: ${repo}`);
  return repo;
}

function validateIssueNumber(input: Record<string, unknown>): number {
  const n = input.issue_number;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) {
    throw new Error(`Invalid issue number: ${String(n)}`);
  }
  return n;
}

/**
 * Build a SchedulerConfig from the plugin's env-driven config plus a
 * caller-supplied repo override. Used by `triggerRun` invocations
 * from slash commands and Claude tools where the scheduler isn't
 * running but we still need its pipeline.
 */
function makeSchedulerConfig(repo: string): SchedulerConfig {
  return {
    enabled: false, // bypass; we're triggering directly
    intervalMinutes: 60,
    repo,
    workDirRoot: config.workDir,
    agentboxBinaryPath: config.binaryPath,
  };
}

interface AgentboxRunRow {
  id: number;
  issue_number: number;
  repo: string;
  status: string;
  started_at: number | null;
  finished_at: number | null;
  pr_url: string | null;
  error: string | null;
}

/** Format an `/agentbox queue` response listing pending issues. */
export async function handleQueue(repo: string): Promise<string> {
  let issues;
  try {
    issues = await listReadyIssues(repo);
  } catch (err) {
    return `Failed to list ready issues: ${err instanceof Error ? err.message : String(err)}`;
  }
  if (issues.length === 0) return 'No `agentbox-ready` issues in queue.';
  const lines = issues.slice(0, 10).map((iss) => {
    const labels = iss.labels.map((l) => l.name).filter((n) => n.startsWith('priority:')).join(', ');
    return `• #${String(iss.number)} ${iss.title}${labels ? ` _(${labels})_` : ''}`;
  });
  return `*Ready queue (${String(issues.length)})*\n${lines.join('\n')}`;
}

/** Format an `/agentbox runs` response showing the last 10 runs. */
export function handleRunsHistory(db: PluginDatabase): string {
  const rows = db
    .prepare(
      `SELECT id, issue_number, repo, status, started_at, finished_at, pr_url, error
       FROM ${db.prefix}runs ORDER BY id DESC LIMIT 10`,
    )
    .all() as AgentboxRunRow[];
  if (rows.length === 0) return 'No AgentBox runs yet.';
  const lines = rows.map((r) => {
    const dur = r.started_at && r.finished_at ? formatDurationMs(r.finished_at - r.started_at) : '—';
    const prSuffix = r.pr_url ? ` ${r.pr_url}` : '';
    return `• #${String(r.issue_number)} — ${r.status.toUpperCase()} (${dur})${prSuffix}`;
  });
  return `*Recent runs*\n${lines.join('\n')}`;
}

/** Parse `/agentbox run <issue#>` text and dispatch through the pipeline. */
export async function handleRunCommand(
  text: string,
  deps: { db: PluginDatabase; ctx: PluginContext },
  repo: string,
): Promise<string> {
  const match = text.trim().match(/^(\d+)$/);
  if (!match) return 'Usage: `/agentbox run <issue#>` — issue number must be a positive integer.';
  const issueNumber = parseInt(match[1]!, 10);
  if (!Number.isInteger(issueNumber) || issueNumber < 1) {
    return `Invalid issue number: ${match[1]}`;
  }
  try {
    const result = await triggerRun(deps, makeSchedulerConfig(repo), issueNumber);
    if (!result) return `Run for #${String(issueNumber)} failed to start.`;
    return `Run #${String(result.runId)} for issue #${String(issueNumber)} finished: ${result.status}`;
  } catch (err) {
    // ExecutorBusyError surfaces as a regular Error — distinguish by
    // its name so users get a readable "another run is in flight"
    // message rather than the raw "agentbox executor is busy" log line.
    if (err instanceof Error && err.name === 'ExecutorBusyError') {
      return `Cannot start run: another AgentBox run is already in flight. Use \`/agentbox cancel\` to stop it first.`;
    }
    return `Failed to trigger run: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/**
 * Cancel the active run. Reports the active run id even when no repo
 * is configured so the operator knows what's running and can pass the
 * repo explicitly via the tool surface.
 */
export async function handleCancelCommand(
  cancelledBy: string,
  db: PluginDatabase,
  repo: string,
): Promise<string> {
  const activeId = getActiveRunId();
  if (activeId === null) return 'No active run to cancel.';
  if (!repo) {
    return (
      `Run #${String(activeId)} is active, but AGENTBOX_DEFAULT_REPO is not configured. ` +
      `Set the env var or use the \`cancel_run\` Claude tool with an explicit \`repo\`.`
    );
  }
  try {
    await cancelRun(activeId, cancelledBy, { db, repo });
    return `Cancelled run #${String(activeId)}.`;
  } catch (err) {
    return `Failed to cancel run #${String(activeId)}: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${String(ms)}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${String(s)}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${String(m)}m ${String(s % 60)}s`;
  const h = Math.floor(m / 60);
  return `${String(h)}h ${String(m % 60)}m`;
}

function ghLabelAdd(issueNumber: number, repo: string, label: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      '/usr/bin/gh',
      ['issue', 'edit', String(issueNumber), '--repo', repo, '--add-label', label],
      { timeout: 30_000 },
      (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve(stdout.trim() || `Label "${label}" added to ${repo}#${issueNumber}`);
      },
    );
  });
}

interface GhIssueSummary {
  number: number;
  title: string;
  state: string;
  labels: { name: string }[];
  url: string;
  updatedAt: string;
}

/**
 * Search GitHub issues via `gh issue list --search`. Returns an array of
 * issue summaries the caller can rank by relevance. State defaults to
 * "all" so the caller can decide whether closed issues are useful context.
 */
function ghSearchIssues(repo: string, query: string, state: 'open' | 'closed' | 'all', limit: number): Promise<GhIssueSummary[]> {
  return new Promise((resolve, reject) => {
    execFile(
      '/usr/bin/gh',
      [
        'issue', 'list', '--repo', repo,
        '--search', query,
        '--state', state,
        '--limit', String(limit),
        '--json', 'number,title,state,labels,url,updatedAt',
      ],
      { timeout: 30_000 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(stderr || err.message));
          return;
        }
        try {
          const trimmed = stdout.trim();
          const parsed = trimmed === '' ? [] : (JSON.parse(trimmed) as GhIssueSummary[]);
          resolve(parsed);
        } catch (parseErr) {
          reject(new Error(`Failed to parse gh issue list output: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`));
        }
      },
    );
  });
}

/**
 * GitHub's issue comment body cap is 65,536 chars. Truncate slightly
 * shy of that so we always have room for the truncation marker, and
 * so we fail with a clear in-tool message rather than a cryptic 422
 * from the API.
 */
const ISSUE_COMMENT_MAX_LENGTH = 60_000;
const ISSUE_COMMENT_TRUNCATION_MARKER = '\n\n[…truncated by agentbox to fit GitHub comment size limit]';

function capCommentBody(body: string): string {
  if (body.length <= ISSUE_COMMENT_MAX_LENGTH) return body;
  return body.slice(0, ISSUE_COMMENT_MAX_LENGTH - ISSUE_COMMENT_TRUNCATION_MARKER.length) + ISSUE_COMMENT_TRUNCATION_MARKER;
}

/**
 * Add a comment to an existing GitHub issue via `gh issue comment`.
 * Used by Claude when investigation findings or proposed subtasks
 * belong on an existing ticket rather than as a new issue.
 */
function ghIssueComment(issueNumber: number, repo: string, body: string): Promise<string> {
  const safeBody = capCommentBody(body);
  return new Promise((resolve, reject) => {
    execFile(
      '/usr/bin/gh',
      ['issue', 'comment', String(issueNumber), '--repo', repo, '--body', safeBody],
      { timeout: 30_000 },
      (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve(stdout.trim() || `Comment added to ${repo}#${issueNumber}`);
      },
    );
  });
}

function createTools(): ToolDefinition[] {
  return [
    {
      spec: {
        name: 'link_issue',
        description: 'Link a GitHub issue to a Slack thread so agentbox results can be posted back',
        input_schema: {
          type: 'object',
          properties: {
            issue_number: { type: 'number', description: 'GitHub issue number' },
            repo: { type: 'string', description: 'GitHub repo (owner/repo). Defaults to AGENTBOX_DEFAULT_REPO.' },
            thread_ts: { type: 'string', description: 'Slack thread timestamp' },
            channel_id: { type: 'string', description: 'Slack channel ID' },
          },
          required: ['issue_number', 'thread_ts', 'channel_id'],
        },
      },
      execute: async (input) => {
        if (!pluginDb) return 'AgentBox plugin is not initialized';
        try {
          const repo = resolveRepo(input);
          const issueNumber = validateIssueNumber(input);
          linkIssueToThread(pluginDb, {
            issueNumber,
            repo,
            threadTs: input.thread_ts as string,
            channelId: input.channel_id as string,
            createdBy: 'claude',
            createdAt: Date.now(),
          });
          return `Linked ${repo}#${issueNumber} to thread ${input.thread_ts}`;
        } catch (err) {
          return `Failed to link issue: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    {
      spec: {
        name: 'mark_for_automation',
        description: 'Add the "agentbox-ready" label to a GitHub issue for automated execution',
        input_schema: {
          type: 'object',
          properties: {
            issue_number: { type: 'number', description: 'GitHub issue number' },
            repo: { type: 'string', description: 'GitHub repo (owner/repo). Defaults to AGENTBOX_DEFAULT_REPO.' },
          },
          required: ['issue_number'],
        },
      },
      execute: async (input) => {
        try {
          const repo = resolveRepo(input);
          const issueNumber = validateIssueNumber(input);
          return await ghLabelAdd(issueNumber, repo, 'agentbox-ready');
        } catch (err) {
          return `Failed to mark for automation: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    {
      spec: {
        name: 'get_issue_link',
        description: 'Get the Slack thread linked to a GitHub issue',
        input_schema: {
          type: 'object',
          properties: {
            issue_number: { type: 'number', description: 'GitHub issue number' },
            repo: { type: 'string', description: 'GitHub repo (owner/repo). Defaults to AGENTBOX_DEFAULT_REPO.' },
          },
          required: ['issue_number'],
        },
      },
      execute: async (input) => {
        if (!pluginDb) return 'AgentBox plugin is not initialized';
        try {
          const repo = resolveRepo(input);
          const issueNumber = validateIssueNumber(input);
          const link = getLinkForIssue(pluginDb, issueNumber, repo);
          if (!link) return `No link found for ${repo}#${issueNumber}`;
          return JSON.stringify(link);
        } catch (err) {
          return `Failed to get issue link: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    {
      spec: {
        name: 'search_related_issues',
        description:
          'Search existing GitHub issues by keyword, label, and state before creating a new one. ' +
          'Use this to detect duplicates, related issues, or epics this work belongs under. ' +
          'Returns an array of {number, title, state, labels, url, updatedAt}.',
        input_schema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search keywords (e.g. "rate limit auth"). Required.' },
            repo: { type: 'string', description: 'GitHub repo (owner/repo). Defaults to AGENTBOX_DEFAULT_REPO.' },
            state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Issue state to search. Defaults to "all".' },
            limit: { type: 'number', description: 'Max issues to return (1-50). Defaults to 10.' },
          },
          required: ['query'],
        },
      },
      execute: async (input) => {
        try {
          const repo = resolveRepo(input);
          const query = (input.query as string | undefined)?.trim();
          if (!query) return 'Failed to search issues: query is required';
          const stateInput = input.state as string | undefined;
          const state: 'open' | 'closed' | 'all' =
            stateInput === 'open' || stateInput === 'closed' ? stateInput : 'all';
          const limitInput = input.limit;
          const limit =
            typeof limitInput === 'number' && Number.isInteger(limitInput) && limitInput > 0 && limitInput <= 50
              ? limitInput
              : 10;
          const results = await ghSearchIssues(repo, query, state, limit);
          if (results.length === 0) {
            return JSON.stringify({ query, state, results: [], note: 'No matching issues found.' });
          }
          return JSON.stringify({ query, state, results });
        } catch (err) {
          return `Failed to search issues: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    {
      spec: {
        name: 'add_to_issue',
        description:
          'Add a comment to an existing GitHub issue with investigation findings, proposed subtasks, ' +
          'or additional context. Use this instead of creating a duplicate issue when the existing ' +
          'one already covers the same problem. The comment body is added verbatim — pre-format it.',
        input_schema: {
          type: 'object',
          properties: {
            issue_number: { type: 'number', description: 'GitHub issue number to comment on' },
            body: { type: 'string', description: 'Comment body (supports markdown). Required.' },
            repo: { type: 'string', description: 'GitHub repo (owner/repo). Defaults to AGENTBOX_DEFAULT_REPO.' },
          },
          required: ['issue_number', 'body'],
        },
      },
      execute: async (input) => {
        try {
          const repo = resolveRepo(input);
          const issueNumber = validateIssueNumber(input);
          const body = (input.body as string | undefined)?.trim();
          if (!body) return 'Failed to add comment: body is required';
          return await ghIssueComment(issueNumber, repo, body);
        } catch (err) {
          return `Failed to add comment: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    {
      spec: {
        name: 'get_run_status',
        description:
          'Look up the status of an AgentBox run by id, or omit run_id to read the currently active run. ' +
          'Returns {id, issue_number, status, started_at, finished_at, pr_url, error}.',
        input_schema: {
          type: 'object',
          properties: {
            run_id: { type: 'number', description: 'Run id (from the runs table). Omit for the active run.' },
          },
        },
      },
      execute: (input) => {
        if (!pluginDb) return 'AgentBox plugin is not initialized';
        const idCandidate = (input.run_id as number | undefined) ?? getActiveRunId();
        if (idCandidate === null || idCandidate === undefined) return 'No active run.';
        const row = pluginDb
          .prepare(`SELECT id, issue_number, repo, status, started_at, finished_at, pr_url, error FROM ${pluginDb.prefix}runs WHERE id = ?`)
          .get(idCandidate);
        if (!row) return `Run ${String(idCandidate)} not found.`;
        return JSON.stringify(row);
      },
    },
    {
      spec: {
        name: 'trigger_run',
        description:
          'Manually start an AgentBox run for a specific GitHub issue, bypassing the polling scheduler. ' +
          'Returns the run id and final status. Throws if another run is already in flight.',
        input_schema: {
          type: 'object',
          properties: {
            issue_number: { type: 'number', description: 'GitHub issue number to run.' },
            repo: { type: 'string', description: 'GitHub repo (owner/repo). Defaults to AGENTBOX_DEFAULT_REPO.' },
          },
          required: ['issue_number'],
        },
      },
      execute: async (input) => {
        if (!pluginDb || !pluginCtx) return 'AgentBox plugin is not initialized';
        try {
          const repo = resolveRepo(input);
          const issueNumber = validateIssueNumber(input);
          const result = await triggerRun(
            { db: pluginDb, ctx: pluginCtx },
            makeSchedulerConfig(repo),
            issueNumber,
          );
          if (!result) return `Run for #${String(issueNumber)} did not complete.`;
          return JSON.stringify({ runId: result.runId, status: result.status });
        } catch (err) {
          if (err instanceof Error && err.name === 'ExecutorBusyError') {
            return 'Cannot start run: another AgentBox run is already in flight.';
          }
          return `Failed to trigger run: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    {
      spec: {
        name: 'cancel_run',
        description:
          'Cancel the currently active AgentBox run. Sends SIGTERM, transitions issue labels, ' +
          'and posts a cancel comment. No-op when no run is active.',
        input_schema: {
          type: 'object',
          properties: {
            cancelled_by: { type: 'string', description: 'Name to attribute the cancellation to. Defaults to "claude".' },
            repo: { type: 'string', description: 'GitHub repo (owner/repo). Defaults to AGENTBOX_DEFAULT_REPO.' },
          },
        },
      },
      execute: async (input) => {
        if (!pluginDb) return 'AgentBox plugin is not initialized';
        const activeId = getActiveRunId();
        if (activeId === null) return 'No active run to cancel.';
        try {
          const repo = resolveRepo(input);
          const cancelledBy = (input.cancelled_by as string | undefined)?.trim() || 'claude';
          await cancelRun(activeId, cancelledBy, { db: pluginDb, repo });
          return `Cancelled run #${String(activeId)}.`;
        } catch (err) {
          return `Failed to cancel run #${String(activeId)}: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
  ];
}

const agentboxPlugin: Plugin = {
  name: 'agentbox',
  version: '1.0.0',
  description: 'GitHub issue agent runner \u2014 tracks AgentBox runs and links issues to Slack threads',

  helpEntries: [
    { command: '/agentbox status', description: 'Show recent AgentBox runs', group: 'AgentBox' },
  ],

  tools: createTools(),

  // Workflows web UI lives at /p/agentbox/. The nav label is
  // "Workflows" (broader than "AgentBox") so future automation
  // plugins can sit under the same nav umbrella.
  webNavEntry: { label: 'Workflows', icon: 'robot' },
  registerWebRoutes: registerAgentboxWebRoutes,
  getWidgets: getAgentboxWidgets,

  screenshotPages: [
    { name: 'dashboard', path: '/' },
    { name: 'queue', path: '/queue' },
    { name: 'runs', path: '/runs' },
    { name: 'run-detail', path: '/runs/1' },
  ],

  init: async (ctx: PluginContext) => {
    pluginDb = ctx.db;
    pluginCtx = ctx;
    setWebPluginDb(ctx.db);
    setWebDefaultRepo(config.defaultRepo ?? '');

    ctx.db.exec(`
      CREATE TABLE IF NOT EXISTS ${ctx.db.prefix}runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        issue_number INTEGER,
        repo TEXT,
        status TEXT CHECK(status IN ('pending','running','paused','success','failed','cancelled')),
        branch TEXT,
        pr_url TEXT,
        started_at INTEGER,
        finished_at INTEGER,
        output_path TEXT,
        error TEXT,
        created_at INTEGER NOT NULL
      )
    `);

    ctx.db.exec(`
      CREATE TABLE IF NOT EXISTS ${ctx.db.prefix}issue_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        issue_number INTEGER NOT NULL,
        repo TEXT NOT NULL,
        thread_ts TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(issue_number, repo)
      )
    `);

    migrateRunsTable(ctx.db);

    startSSEPolling(ctx);

    logger.info('AgentBox plugin initialized', {
      version: ctx.version,
      tablePrefix: ctx.db.prefix,
      enabled: config.enabled,
    });
  },

  destroy: async () => {
    stopSSEPolling();
    pluginDb = null;
    pluginCtx = null;
    setWebPluginDb(null);
    setWebDefaultRepo('');
    logger.info('AgentBox plugin destroyed');
  },

  registerCommands: (app) => {
    app.command('/agentbox', async ({ command, ack, respond }) => {
      await ack();

      if (!pluginDb) {
        await respond('AgentBox plugin is not initialized.');
        return;
      }
      if (!pluginCtx) {
        await respond('AgentBox plugin context is not available.');
        return;
      }

      const text = (command.text ?? '').trim();
      const [first, ...rest] = text.split(/\s+/);
      const subcommand = (first ?? '').toLowerCase();
      const args = rest.join(' ');
      const ctx = pluginCtx;
      const db = pluginDb;
      const repo = config.defaultRepo ?? '';

      switch (subcommand) {
        case 'status':
        case '': {
          await respond(handleStatus(db));
          break;
        }
        case 'queue': {
          if (!repo) { await respond('AGENTBOX_DEFAULT_REPO is not configured.'); break; }
          await respond(await handleQueue(repo));
          break;
        }
        case 'run': {
          if (!repo) { await respond('AGENTBOX_DEFAULT_REPO is not configured.'); break; }
          await respond(await handleRunCommand(args, { db, ctx }, repo));
          break;
        }
        case 'cancel': {
          // handleCancelCommand handles missing repo internally so it
          // can still report whether a run is active.
          await respond(await handleCancelCommand(command.user_name, db, repo));
          break;
        }
        case 'runs':
        case 'history': {
          await respond(handleRunsHistory(db));
          break;
        }
        default:
          await respond(`Unknown subcommand: \`${subcommand}\`. Try \`/agentbox status\`, \`queue\`, \`run <#>\`, \`cancel\`, or \`runs\`.`);
      }
    });
  },
};

export default agentboxPlugin;

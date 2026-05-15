/**
 * AgentBox plugin database schema and CRUD operations.
 */
import type { PluginDatabase } from '../../src/services/plugin-database.js';

// --- Types ---

export interface AgentboxRun {
  id: number;
  issueNumber: number;
  repo: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'cancelled';
  branch: string | null;
  prUrl: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  outputPath: string | null;
  error: string | null;
  createdAt: number;
}

export interface IssueLink {
  id: number;
  issueNumber: number;
  repo: string;
  threadTs: string;
  channelId: string;
  createdBy: string;
  createdAt: number;
}

// --- Schema ---

export function createSchema(db: PluginDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${db.prefix}runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      issue_number INTEGER,
      repo TEXT,
      status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'paused', 'success', 'failed', 'cancelled')),
      branch TEXT,
      pr_url TEXT,
      started_at INTEGER,
      finished_at INTEGER,
      output_path TEXT,
      error TEXT,
      created_at INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS ${db.prefix}issue_links (
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
}

// --- Runs CRUD ---

export function insertRun(
  db: PluginDatabase,
  run: { issueNumber: number; repo: string; status: AgentboxRun['status'] },
): number {
  if (!Number.isInteger(run.issueNumber) || run.issueNumber <= 0) {
    throw new Error(`Invalid issue number: ${run.issueNumber}`);
  }
  const result = db
    .prepare(
      `INSERT INTO ${db.prefix}runs (issue_number, repo, status, created_at) VALUES (?, ?, ?, ?)`,
    )
    .run(run.issueNumber, run.repo, run.status, Date.now());
  return Number(result.lastInsertRowid);
}

export function getRecentRuns(db: PluginDatabase, limit: number): AgentboxRun[] {
  const rows = db
    .prepare(
      `SELECT * FROM ${db.prefix}runs ORDER BY id DESC LIMIT ?`,
    )
    .all(limit) as Array<Record<string, unknown>>;

  return rows.map(mapRun);
}

function mapRun(row: Record<string, unknown>): AgentboxRun {
  return {
    id: row.id as number,
    issueNumber: row.issue_number as number,
    repo: row.repo as string,
    status: row.status as AgentboxRun['status'],
    branch: (row.branch as string) ?? null,
    prUrl: (row.pr_url as string) ?? null,
    startedAt: (row.started_at as number) ?? null,
    finishedAt: (row.finished_at as number) ?? null,
    outputPath: (row.output_path as string) ?? null,
    error: (row.error as string) ?? null,
    createdAt: row.created_at as number,
  };
}

// --- Issue Links CRUD ---

export function insertIssueLink(
  db: PluginDatabase,
  link: Omit<IssueLink, 'id' | 'createdAt'>,
): void {
  db.prepare(
    `INSERT OR REPLACE INTO ${db.prefix}issue_links
     (issue_number, repo, thread_ts, channel_id, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    link.issueNumber,
    link.repo,
    link.threadTs,
    link.channelId,
    link.createdBy,
    Date.now(),
  );
}

export function getIssueLinkByIssue(
  db: PluginDatabase,
  issueNumber: number,
  repo: string,
): IssueLink | null {
  const row = db
    .prepare(
      `SELECT * FROM ${db.prefix}issue_links WHERE issue_number = ? AND repo = ?`,
    )
    .get(issueNumber, repo) as Record<string, unknown> | undefined;

  if (!row) return null;
  return mapIssueLink(row);
}

export function getIssueLinksForThread(
  db: PluginDatabase,
  threadTs: string,
): IssueLink[] {
  const rows = db
    .prepare(
      `SELECT * FROM ${db.prefix}issue_links WHERE thread_ts = ?`,
    )
    .all(threadTs) as Array<Record<string, unknown>>;

  return rows.map(mapIssueLink);
}

function mapIssueLink(row: Record<string, unknown>): IssueLink {
  return {
    id: row.id as number,
    issueNumber: row.issue_number as number,
    repo: row.repo as string,
    threadTs: row.thread_ts as string,
    channelId: row.channel_id as string,
    createdBy: row.created_by as string,
    createdAt: row.created_at as number,
  };
}

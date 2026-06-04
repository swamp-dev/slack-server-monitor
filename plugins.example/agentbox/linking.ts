/**
 * Issue-Thread Linking — maps GitHub issues to Slack threads
 */

import type { PluginDatabase } from '../../src/services/plugin-database.js';
import type { IssueLink } from './types.js';

export function linkIssueToThread(
  db: PluginDatabase,
  link: Omit<IssueLink, 'id'>,
): void {
  db.prepare(
    `INSERT OR REPLACE INTO ${db.prefix}issue_links
     (issue_number, repo, thread_ts, channel_id, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [`${db.prefix}issue_links`],
  ).run(
    link.issueNumber,
    link.repo,
    link.threadTs,
    link.channelId,
    link.createdBy,
    link.createdAt,
  );
}

export function getLinkForIssue(
  db: PluginDatabase,
  issueNumber: number,
  repo: string,
): IssueLink | null {
  const row = db
    .prepare(
      `SELECT id, issue_number, repo, thread_ts, channel_id, created_by, created_at
       FROM ${db.prefix}issue_links WHERE issue_number = ? AND repo = ?`,
      [`${db.prefix}issue_links`],
    )
    .get(issueNumber, repo) as Record<string, unknown> | undefined;

  if (!row) return null;

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

export function getLinksForThread(
  db: PluginDatabase,
  threadTs: string,
): IssueLink[] {
  const rows = db
    .prepare(
      `SELECT id, issue_number, repo, thread_ts, channel_id, created_by, created_at
       FROM ${db.prefix}issue_links WHERE thread_ts = ?`,
      [`${db.prefix}issue_links`],
    )
    .all(threadTs) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    id: row.id as number,
    issueNumber: row.issue_number as number,
    repo: row.repo as string,
    threadTs: row.thread_ts as string,
    channelId: row.channel_id as string,
    createdBy: row.created_by as string,
    createdAt: row.created_at as number,
  }));
}

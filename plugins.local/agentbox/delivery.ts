/**
 * Result delivery service (#240 / T7).
 *
 * Closes the feedback loop after an agentbox run completes:
 *   - If a branch name is supplied (success runs only), creates a PR
 *     via `gh pr create` and captures the URL on the runs row.
 *   - Comments on the GitHub issue with a status summary.
 *   - Posts to the Slack thread originally linked to the issue (if any).
 *   - Drops a notification into the web UI bell via `ctx.notify`.
 *   - Broadcasts an SSE `agentbox:run_complete` event for live UIs.
 *
 * Each side effect is best-effort and isolated — a failure to comment
 * on the issue does not prevent the Slack post or the notification.
 * The function returns a structured report of what succeeded so the
 * caller can log or surface it.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../../src/utils/logger.js';
import type { PluginContext } from '../../src/plugins/types.js';
import type { PluginDatabase } from '../../src/services/plugin-database.js';
import { getIssueLinkByIssue } from '../../plugins.example/agentbox/schema.js';
import { formatReviewSummary, type ReviewResult } from './review.js';

const execFileAsync = promisify(execFile);

const GH_TIMEOUT_MS = 30_000;

/**
 * Minimal Slack client surface — just `chat.postMessage`. Defined as
 * an interface so tests can inject a stub without depending on Bolt.
 */
export interface SlackPostClient {
  chat: {
    postMessage: (args: {
      channel: string;
      thread_ts?: string;
      text: string;
    }) => Promise<{ ok: boolean; ts?: string }>;
  };
}

export interface DeliveryDependencies {
  /** Set when registerCommands fires; null when web-only / no Slack. */
  slackClient: SlackPostClient | null;
  /** Plugin context (notify + sse). */
  ctx: PluginContext;
  /** Plugin DB (read issue_links, update runs). */
  db: PluginDatabase;
}

export interface DeliveryInput {
  runId: number;
  issueNumber: number;
  repo: string;
  status: 'success' | 'failed' | 'cancelled';
  /** Workspace directory; included in the summary for log lookups. */
  workDir: string;
  /** Wall-clock duration of the run in ms. */
  durationMs?: number;
  /** Failure or cancellation message. */
  error?: string;
  /**
   * Branch name produced by the agent. When provided AND status is
   * `success`, deliverResults attempts `gh pr create`. Falsy → skip
   * PR creation (e.g., agentbox didn't push a branch).
   */
  branchName?: string;
  /** PR title. Defaults to `agentbox: <runId>` if not supplied. */
  prTitle?: string;
  /** PR body. Defaults to a short auto-generated description. */
  prBody?: string;
  /**
   * Optional code-review result from the post-execution review step
   * (#196). When present:
   *   - PR creation is skipped if `hasCritical` or `ranButFailed`.
   *   - The review summary is appended to both the PR body (if a PR
   *     IS created) and the issue comment (always).
   * Omit to preserve pre-#196 behavior (no review gating).
   */
  review?: ReviewResult;
}

export interface DeliveryReport {
  prUrl: string | null;
  /** True when PR creation was skipped because of a blocking review. */
  prBlockedByReview: boolean;
  issueCommented: boolean;
  slackPosted: boolean;
  notified: boolean;
  ssePosted: boolean;
  errors: string[];
}

/**
 * Run all delivery side effects in a deterministic order. Each step
 * is wrapped so a downstream failure doesn't take out earlier steps.
 */
export async function deliverResults(
  deps: DeliveryDependencies,
  input: DeliveryInput,
): Promise<DeliveryReport> {
  const errors: string[] = [];
  const report: DeliveryReport = {
    prUrl: null,
    prBlockedByReview: false,
    issueCommented: false,
    slackPosted: false,
    notified: false,
    ssePosted: false,
    errors,
  };

  // Determine if a pending review blocks PR creation. ranButFailed
  // means a review was attempted but errored — treated the same as a
  // critical finding for safety.
  const reviewBlocks = !!input.review && (input.review.hasCritical || input.review.ranButFailed);
  if (reviewBlocks) {
    report.prBlockedByReview = true;
  }

  // 1. PR creation (success runs only, branch name required, no
  //    blocking review). Two separate try/catch so a DB UPDATE
  //    failure doesn't get misattributed as a pr_create error and
  //    wipe the URL we already created on GitHub.
  if (input.status === 'success' && input.branchName && !reviewBlocks) {
    try {
      report.prUrl = await createPr(input);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`pr_create: ${msg}`);
      logger.warn('AgentBox delivery: gh pr create failed', { runId: input.runId, error: msg });
    }
    if (report.prUrl) {
      try {
        deps.db
          .prepare(`UPDATE ${deps.db.prefix}runs SET pr_url = ?, branch = ? WHERE id = ?`)
          .run(report.prUrl, input.branchName, input.runId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`pr_db_update: ${msg}`);
        logger.warn('AgentBox delivery: pr_url DB update failed (PR was created)', {
          runId: input.runId, prUrl: report.prUrl, error: msg,
        });
      }
    }
  }

  // 2. Issue comment (always)
  try {
    await ghIssueComment(input.issueNumber, input.repo, formatIssueComment(input, report.prUrl));
    report.issueCommented = true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`issue_comment: ${msg}`);
    logger.warn('AgentBox delivery: issue comment failed', { runId: input.runId, error: msg });
  }

  // 3. Slack thread post (only if the issue is linked)
  const link = getIssueLinkByIssue(deps.db, input.issueNumber, input.repo);
  if (link && deps.slackClient) {
    try {
      await deps.slackClient.chat.postMessage({
        channel: link.channelId,
        thread_ts: link.threadTs,
        text: formatSlackMessage(input, report.prUrl),
      });
      report.slackPosted = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`slack_post: ${msg}`);
      logger.warn('AgentBox delivery: Slack post failed', { runId: input.runId, error: msg });
    }
  }

  // 4. Web UI notification
  try {
    deps.ctx.notify(formatNotificationTitle(input), {
      level: input.status === 'success' ? 'info' : 'error',
      body: formatNotificationBody(input, report.prUrl),
      link: report.prUrl ?? undefined,
    });
    report.notified = true;
  } catch (err) {
    errors.push(`notify: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 5. SSE broadcast
  try {
    deps.ctx.sse.broadcast('agentbox:run_complete', {
      runId: input.runId,
      issueNumber: input.issueNumber,
      status: input.status,
      prUrl: report.prUrl,
    });
    report.ssePosted = true;
  } catch (err) {
    errors.push(`sse: ${err instanceof Error ? err.message : String(err)}`);
  }

  return report;
}

async function createPr(input: DeliveryInput): Promise<string | null> {
  const title = input.prTitle ?? `agentbox: run ${String(input.runId)}`;
  const body = input.prBody ?? defaultPrBody(input);
  const { stdout } = await execFileAsync(
    '/usr/bin/gh',
    [
      'pr', 'create',
      '--repo', input.repo,
      '--head', input.branchName!,
      '--title', title,
      '--body', body,
    ],
    { timeout: GH_TIMEOUT_MS },
  );
  const url = stdout.trim();
  return url || null;
}

async function ghIssueComment(issueNumber: number, repo: string, body: string): Promise<void> {
  await execFileAsync(
    '/usr/bin/gh',
    ['issue', 'comment', String(issueNumber), '--repo', repo, '--body', body],
    { timeout: GH_TIMEOUT_MS },
  );
}

// ─── Formatters ──────────────────────────────────────────────────────

export function formatIssueComment(input: DeliveryInput, prUrl: string | null): string {
  const lines: string[] = [];
  const emoji = input.status === 'success' ? '✅' : input.status === 'failed' ? '❌' : '⚠️';
  lines.push(`${emoji} **AgentBox run ${input.status}**`);
  lines.push('');
  if (prUrl) lines.push(`PR: ${prUrl}`);
  if (typeof input.durationMs === 'number') lines.push(`Duration: ${formatDuration(input.durationMs)}`);
  lines.push(`Workspace: \`${input.workDir}\``);
  if (input.error) {
    lines.push('');
    lines.push(`Error: ${input.error}`);
  }
  if (input.review && input.review.count > 0) {
    lines.push('');
    lines.push(formatReviewSummary(input.review));
  }
  if (input.review && input.review.ranButFailed) {
    lines.push('');
    lines.push('_Review run failed — PR creation blocked as a precaution._');
  }
  return lines.join('\n');
}

export function formatSlackMessage(input: DeliveryInput, prUrl: string | null): string {
  const emoji = input.status === 'success' ? ':white_check_mark:' : input.status === 'failed' ? ':x:' : ':warning:';
  const parts = [`${emoji} AgentBox run ${input.status} for #${String(input.issueNumber)}`];
  if (prUrl) parts.push(`PR: ${prUrl}`);
  if (input.error) parts.push(`Error: ${input.error}`);
  return parts.join('\n');
}

function formatNotificationTitle(input: DeliveryInput): string {
  const verb = input.status === 'success' ? 'completed' : input.status;
  return `AgentBox run ${verb} for ${input.repo}#${String(input.issueNumber)}`;
}

function formatNotificationBody(input: DeliveryInput, prUrl: string | null): string {
  if (input.status === 'success') {
    return prUrl ? `Pull request: ${prUrl}` : 'Run finished successfully.';
  }
  return input.error ?? `Run ended with status: ${input.status}.`;
}

function defaultPrBody(input: DeliveryInput): string {
  // Build paragraph blocks; the duration block is conditional. Joining
  // with `\n\n` preserves the blank-line separator that Markdown needs
  // for paragraph breaks.
  const blocks: string[] = [
    `Automated AgentBox run for ${input.repo}#${String(input.issueNumber)}.`,
    `Run ID: ${String(input.runId)}`,
  ];
  if (typeof input.durationMs === 'number') {
    blocks.push(`Duration: ${formatDuration(input.durationMs)}`);
  }
  if (input.review && input.review.count > 0) {
    blocks.push(formatReviewSummary(input.review));
  }
  return blocks.join('\n\n');
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${String(ms)}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${String(s)}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${String(m)}m ${String(s % 60)}s`;
  const h = Math.floor(m / 60);
  return `${String(h)}h ${String(m % 60)}m`;
}

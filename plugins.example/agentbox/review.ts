/**
 * Review-agent integration for the AgentBox pipeline (#196).
 *
 * Picked the "post-execution step in the slack-server-monitor
 * executor" implementation choice from the issue's three options. The
 * review runs after `executeRun` finishes (success path only) and
 * before the delivery step decides whether to create a PR. Critical
 * findings block PR creation; significant + minor findings flow into
 * the PR description as a summary.
 *
 * The review-runner itself is configurable via `reviewCommand` so we
 * can swap implementations (Claude Code CLI, a custom script, an
 * AgentBox MCP tool) without rewriting this layer. The default is
 * "no review configured" — `runReview` returns a no-findings result
 * and the pipeline behaves exactly as it did before #196.
 *
 * Findings are persisted to a new `${prefix}reviews` table the plugin
 * creates on init. Each row references the originating run so the
 * future Workflows dashboard (T11) can surface them.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../../src/utils/logger.js';
import type { PluginDatabase } from '../../src/services/plugin-database.js';

const execFileAsync = promisify(execFile);

export type ReviewSeverity = 'critical' | 'significant' | 'minor';

export interface ReviewFinding {
  severity: ReviewSeverity;
  /** First line of the finding — used in summaries. */
  title: string;
  /** Full body (multi-line) the parser captured for this finding. */
  body: string;
}

export interface ReviewResult {
  /** Total findings across all severities. */
  count: number;
  /** True if any finding is at severity=critical. */
  hasCritical: boolean;
  /** Findings split out by severity for UI/PR-summary rendering. */
  findings: ReviewFinding[];
  /** Raw stdout from the review-runner (for logs / dashboard). */
  rawOutput: string;
  /**
   * True when a review command was configured AND it failed (non-zero
   * exit, timeout, etc.). Lets the caller treat the failure as a
   * blocking event rather than a clean "no findings" pass. False when
   * no command is configured (clean skip) or when the review ran
   * successfully (regardless of whether findings were found).
   */
  ranButFailed: boolean;
}

export interface RunReviewOpts {
  /** plugin DB — review results are persisted here. */
  db: PluginDatabase;
  /** runs row id this review attaches to. */
  runId: number;
  /** Working directory passed to the review-runner. */
  workDir: string;
  /**
   * Shell-form review command. Optional — if omitted, no review runs
   * and an empty result is returned. The command is split on whitespace
   * (no shell interpolation); the first token is the binary, the rest
   * are arguments. `{workDir}` in any token is substituted at runtime.
   *
   * Note: paths containing whitespace are NOT supported — the splitter
   * would break a path like `/opt/my tools/review` into separate tokens.
   * This is a deliberate tradeoff to avoid shell injection. Operators
   * should symlink such binaries to a no-space path or use the
   * configurable env mechanism a future ticket might add.
   */
  reviewCommand?: string;
  /** Timeout for the review run in ms. Default 5 minutes. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export function ensureReviewSchema(db: PluginDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${db.prefix}reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      severity TEXT NOT NULL CHECK (severity IN ('critical', 'significant', 'minor')),
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
}

/**
 * Run the configured review command and persist the parsed findings.
 * Returns an empty no-critical result if no command is configured —
 * callers MUST treat that as "no review ran" rather than "review
 * passed", since silent skips shouldn't unblock PR creation. The
 * caller decides whether to gate on `hasCritical` or also gate when
 * `count === 0 && reviewCommand` was unset.
 */
export async function runReview(opts: RunReviewOpts): Promise<ReviewResult> {
  if (!opts.reviewCommand?.trim()) {
    return { count: 0, hasCritical: false, findings: [], rawOutput: '', ranButFailed: false };
  }
  ensureReviewSchema(opts.db);

  const tokens = opts.reviewCommand.trim().split(/\s+/).map((t) => t.replace(/\{workDir\}/g, opts.workDir));
  const [bin, ...args] = tokens;
  if (!bin) {
    return { count: 0, hasCritical: false, findings: [], rawOutput: '', ranButFailed: false };
  }

  let rawOutput = '';
  try {
    const result = await execFileAsync(bin, args, {
      timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      cwd: opts.workDir,
    });
    rawOutput = result.stdout;
  } catch (err) {
    logger.warn('AgentBox review: review command failed', {
      runId: opts.runId,
      bin,
      error: err instanceof Error ? err.message : String(err),
    });
    // ranButFailed=true so the caller can treat this as a blocking
    // signal — we attempted a review and it didn't complete, which
    // is different from "no review configured" (where ranButFailed
    // stays false).
    return { count: 0, hasCritical: false, findings: [], rawOutput: '', ranButFailed: true };
  }

  const findings = parseReviewOutput(rawOutput);
  if (findings.length > 0) {
    persistFindings(opts.db, opts.runId, findings);
  }

  return {
    count: findings.length,
    hasCritical: findings.some((f) => f.severity === 'critical'),
    findings,
    rawOutput,
    ranButFailed: false,
  };
}

/**
 * Parse a review-runner's stdout into structured findings.
 *
 * The expected format is the same shape the in-house `code-reviewer`
 * agent emits: markdown sections under `## Critical Issues`,
 * `## Significant Problems`, and `## Improvements` (treated as
 * "minor"). Each top-level bullet (`- ...`, `* ...`, or a paragraph)
 * is one finding.
 *
 * Headings are matched case-insensitively. Sections containing only
 * "None." are correctly read as zero findings.
 */
export function parseReviewOutput(raw: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const sections = splitByHeading(raw);
  for (const { heading, body } of sections) {
    const severity = mapHeadingToSeverity(heading);
    if (!severity) continue;
    if (/^\s*none\b/i.test(body.trim())) continue;
    for (const finding of splitFindings(body)) {
      findings.push({
        severity,
        title: firstLine(finding),
        body: finding.trim(),
      });
    }
  }
  return findings;
}

interface ParsedSection { heading: string; body: string }

function splitByHeading(raw: string): ParsedSection[] {
  const lines = raw.split('\n');
  const sections: ParsedSection[] = [];
  let current: ParsedSection | null = null;
  for (const line of lines) {
    const headingMatch = /^##\s+(.+?)\s*$/.exec(line);
    if (headingMatch) {
      if (current) sections.push(current);
      current = { heading: headingMatch[1] ?? '', body: '' };
    } else if (current) {
      current.body += line + '\n';
    }
  }
  if (current) sections.push(current);
  return sections;
}

/**
 * Match the canonical reviewer headings exactly (case-insensitive,
 * trailing whitespace tolerated). Tightened from a bare `includes`
 * to avoid overmatching on retrospective sections like
 * `## Critical fixes already applied` or `## Previously significant
 * issues`, which would have produced false-blocking critical findings.
 */
function mapHeadingToSeverity(heading: string): ReviewSeverity | null {
  const h = heading.trim().toLowerCase();
  if (h === 'critical issues' || h === 'critical') return 'critical';
  if (h === 'significant problems' || h === 'significant issues' || h === 'significant') return 'significant';
  if (h === 'improvements' || h === 'minor issues' || h === 'minor problems' || h === 'minor') return 'minor';
  return null;
}

/**
 * Split a section body into individual findings. Recognizes:
 *   - Lines starting with `- ` or `* ` as bullet-list items (each
 *     bullet plus its indented continuation lines is one finding).
 *   - Otherwise: paragraph mode — blank lines separate findings.
 */
function splitFindings(body: string): string[] {
  const trimmed = body.trim();
  if (trimmed === '') return [];
  // Bullet mode if any line starts with - or *.
  if (/^[-*]\s/m.test(trimmed)) {
    const items: string[] = [];
    let buf = '';
    for (const line of trimmed.split('\n')) {
      if (/^[-*]\s/.test(line)) {
        if (buf.trim()) items.push(buf.trim());
        buf = line.replace(/^[-*]\s+/, '');
      } else {
        buf += '\n' + line;
      }
    }
    if (buf.trim()) items.push(buf.trim());
    return items;
  }
  // Paragraph mode.
  return trimmed.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}

function firstLine(s: string): string {
  return s.split('\n', 1)[0]!.trim();
}

function persistFindings(db: PluginDatabase, runId: number, findings: ReviewFinding[]): void {
  // Schema is ensured by the caller; no need to re-DDL on every persist.
  const stmt = db.prepare(
    `INSERT INTO ${db.prefix}reviews (run_id, severity, title, body, created_at) VALUES (?, ?, ?, ?, ?)`,
  );
  const now = Date.now();
  db.transaction(() => {
    for (const f of findings) stmt.run(runId, f.severity, f.title, f.body, now);
  });
}

/** Build a markdown summary of a review for embedding in PR descriptions. */
export function formatReviewSummary(result: ReviewResult): string {
  if (result.count === 0) return '_No review findings._';
  const groups: Record<ReviewSeverity, ReviewFinding[]> = { critical: [], significant: [], minor: [] };
  for (const f of result.findings) groups[f.severity].push(f);
  const lines: string[] = [];
  lines.push(`**Review summary** — ${String(result.count)} finding${result.count === 1 ? '' : 's'}` +
    (result.hasCritical ? ' (PR creation blocked)' : '') + '.');
  for (const sev of ['critical', 'significant', 'minor'] as const) {
    if (groups[sev].length === 0) continue;
    lines.push('');
    lines.push(`### ${capitalize(sev)} (${String(groups[sev].length)})`);
    for (const f of groups[sev]) {
      lines.push(`- ${f.title}`);
    }
  }
  return lines.join('\n');
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

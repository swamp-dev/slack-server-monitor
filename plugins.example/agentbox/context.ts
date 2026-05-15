/**
 * Context packaging for isolated AgentBox runs (#163).
 *
 * AgentBox runs in a sandboxed container with no access to the
 * broader codebase outside the workspace. `prepareEnvironment` (T4)
 * already copies CLAUDE.md and `.claude/context/` files into the
 * workspace. This service builds on that by packaging additional
 * context the agent needs to be effective:
 *
 *   1. Parses the issue body's `## Files` section and reads each
 *      referenced file from the cloned repo, embedding excerpts.
 *   2. If the issue body references other issues via "Depends on
 *      #N" or "Part of #N", fetches their content via `gh`.
 *   3. Runs `.agentbox/context-hook.sh` from the cloned repo if
 *      present, capturing stdout as additional context.
 *   4. Writes a single `CONTEXT.md` at the workspace root summarizing
 *      everything, truncating gracefully if the total exceeds
 *      `maxBytes` (default 100KB).
 *
 * The result lives alongside `prd.json` and is what the agent reads
 * before starting a run.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, stat, access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { logger } from '../../src/utils/logger.js';
import { parseFiles, parseDependencies } from './prd-generator.js';

const execFileAsync = promisify(execFile);

export interface PackageContextOpts {
  /** Workspace root from prepareEnvironment. Where CONTEXT.md is written. */
  workDir: string;
  /** Cloned repo root inside workDir. */
  repoDir: string;
  /** Owner/repo of the originating issue, used for `gh` dependency lookups. */
  repo: string;
  /** Body of the originating issue (markdown). */
  issueBody: string;
  /** Cap the final CONTEXT.md size. Defaults to 100,000 bytes. */
  maxBytes?: number;
  /** Optional override of the gh CLI path / hook timeout (default 30s). */
  toolTimeoutMs?: number;
}

export interface PackageContextResult {
  /** Absolute path to the written CONTEXT.md. */
  contextPath: string;
  /** Bytes actually written to disk. */
  bytesWritten: number;
  /** True if the body was truncated to fit `maxBytes`. */
  truncated: boolean;
  /** Files referenced in the Files section that were read. */
  filesIncluded: string[];
  /** Files referenced but missing from the repo (logged, not fatal). */
  filesMissing: string[];
  /** Dependency issue numbers whose bodies were embedded. */
  dependenciesFetched: number[];
  /** True if the optional `.agentbox/context-hook.sh` was found and ran. */
  hookExecuted: boolean;
}

const DEFAULT_MAX_BYTES = 100_000;
const DEFAULT_TOOL_TIMEOUT_MS = 30_000;
const TRUNCATION_MARKER = '\n\n[…truncated to fit context size limit]';

export async function packageContext(opts: PackageContextOpts): Promise<PackageContextResult> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = opts.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
  const sections: string[] = [];

  sections.push('# Project Context\n');
  sections.push('Auto-assembled by agentbox context packaging.\n');

  // Section 1: referenced files from the issue's "Files" block.
  // Defense in depth: re-validate every path resolves inside repoDir
  // even though prepareEnvironment / parseFiles already filters
  // traversal. Treat anything pointing outside repoDir as "missing".
  const repoRoot = path.resolve(opts.repoDir) + path.sep;
  const fileEntries = parseFiles(opts.issueBody);
  const filesIncluded: string[] = [];
  const filesMissing: string[] = [];
  if (fileEntries.length > 0) {
    sections.push('## Referenced Files\n');
    for (const entry of fileEntries) {
      const resolved = path.resolve(opts.repoDir, entry.path);
      if (!resolved.startsWith(repoRoot)) {
        filesMissing.push(entry.path);
        sections.push(`### \`${entry.path}\`\n\n_(rejected: path escapes repo root)_\n`);
        continue;
      }
      const content = await safeReadFile(resolved);
      if (content === null) {
        filesMissing.push(entry.path);
        sections.push(`### \`${entry.path}\`\n\n_(not found in repo — referenced but missing)_\n`);
        continue;
      }
      filesIncluded.push(entry.path);
      const lang = inferLang(entry.path);
      sections.push(`### \`${entry.path}\`${entry.role ? ` — ${entry.role}` : ''}\n`);
      sections.push('```' + lang + '\n' + content + '\n```\n');
    }
  }

  // Section 2: dependency issues.
  const deps = parseDependencies(opts.issueBody);
  const dependenciesFetched: number[] = [];
  if (deps.depends_on.length > 0) {
    sections.push('## Dependency Issues\n');
    for (const num of deps.depends_on) {
      const fetched = await fetchIssueBody(opts.repo, num, timeoutMs);
      if (fetched) {
        dependenciesFetched.push(num);
        sections.push(`### #${String(num)} — ${fetched.title}\n\n${fetched.body}\n`);
      } else {
        sections.push(`### #${String(num)} _(could not fetch)_\n`);
      }
    }
  }

  // Section 3: repo-specific context hook.
  const hookOutput = await runContextHook(opts.repoDir, timeoutMs);
  const hookExecuted = hookOutput !== null;
  if (hookOutput) {
    sections.push('## Custom Context Hook\n');
    sections.push('Output of `.agentbox/context-hook.sh`:\n');
    sections.push('```\n' + hookOutput + '\n```\n');
  }

  // Assemble + truncate to fit.
  const fullBody = sections.join('\n');
  const { body: finalBody, truncated } = truncateToFit(fullBody, maxBytes);

  const contextPath = path.join(opts.workDir, 'CONTEXT.md');
  await writeFile(contextPath, finalBody, 'utf-8');

  return {
    contextPath,
    bytesWritten: Buffer.byteLength(finalBody, 'utf-8'),
    truncated,
    filesIncluded,
    filesMissing,
    dependenciesFetched,
    hookExecuted,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────

async function safeReadFile(filePath: string): Promise<string | null> {
  try {
    const stats = await stat(filePath);
    if (!stats.isFile()) return null;
    return await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

interface FetchedIssue { title: string; body: string }

async function fetchIssueBody(repo: string, issueNumber: number, timeoutMs: number): Promise<FetchedIssue | null> {
  try {
    const { stdout } = await execFileAsync(
      '/usr/bin/gh',
      ['issue', 'view', String(issueNumber), '--repo', repo, '--json', 'title,body'],
      { timeout: timeoutMs },
    );
    const trimmed = stdout.trim();
    if (trimmed === '') return null;
    const parsed = JSON.parse(trimmed) as { title?: string; body?: string };
    return { title: parsed.title ?? '', body: parsed.body ?? '' };
  } catch (err) {
    logger.warn('Context packaging: failed to fetch dependency issue', {
      issueNumber, repo, error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function runContextHook(repoDir: string, timeoutMs: number): Promise<string | null> {
  // Opt-in guard: arbitrary code execution from a cloned repo. The
  // operator must explicitly enable hook execution via env var. No
  // hook runs without it, even if the file is present and executable.
  if (process.env.AGENTBOX_ALLOW_CONTEXT_HOOK !== 'true') {
    return null;
  }
  const hookPath = path.join(repoDir, '.agentbox', 'context-hook.sh');
  try {
    await access(hookPath, fsConstants.X_OK);
  } catch {
    return null; // not present or not executable — skip
  }
  try {
    const { stdout } = await execFileAsync(hookPath, [], { timeout: timeoutMs, cwd: repoDir });
    return stdout;
  } catch (err) {
    logger.warn('Context packaging: hook failed', {
      hookPath, error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function inferLang(filePath: string): string {
  const ext = path.extname(filePath).slice(1);
  // Common mappings; fall back to the bare extension.
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust',
    md: 'markdown', json: 'json', yml: 'yaml', yaml: 'yaml',
    sh: 'bash', sql: 'sql', toml: 'toml',
  };
  return map[ext] ?? ext;
}

function truncateToFit(body: string, maxBytes: number): { body: string; truncated: boolean } {
  const size = Buffer.byteLength(body, 'utf-8');
  if (size <= maxBytes) return { body, truncated: false };
  // Slice by characters until we fit; leaves room for the marker.
  const targetBytes = maxBytes - Buffer.byteLength(TRUNCATION_MARKER, 'utf-8');
  let lo = 0;
  let hi = body.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (Buffer.byteLength(body.slice(0, mid), 'utf-8') <= targetBytes) lo = mid;
    else hi = mid - 1;
  }
  return { body: body.slice(0, lo) + TRUNCATION_MARKER, truncated: true };
}

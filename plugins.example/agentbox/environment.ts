/**
 * Environment preparation service (#237 / T4).
 *
 * Bridges "GitHub issue" → "agentbox-ready workspace":
 *   1. Creates an isolated work directory under `workDirRoot`.
 *   2. Shallow-clones the target repo into it (`git clone --depth=1`).
 *   3. Generates a `prd.json` from the structured issue body and writes
 *      it at the workspace root.
 *   4. Best-effort copies CLAUDE.md and any `.claude/context/` files
 *      from the cloned repo into the workspace root so the executor
 *      can give the agent the same context the maintainers see.
 *
 * Cleanup is a separate idempotent step so callers can keep the
 * workspace around for inspection or wipe it after a successful run.
 *
 * No mutable shared state — every call gets its own workDir keyed by
 * (timestamp, pid, random) so parallel preparations can't collide.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, rm, copyFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { generatePRD, type IssueInput, type PRD } from './prd-generator.js';

const execFileAsync = promisify(execFile);

export interface PrepareEnvironmentOpts {
  /** GitHub issue number. Used in the workDir name. */
  issueNumber: number;
  /** Owner/repo target to clone (e.g. "swamp-dev/slack-server-monitor"). */
  repo: string;
  /** Issue title. Becomes the PRD's `name`. */
  issueTitle: string;
  /** Raw issue body markdown. Parsed into the PRD task list. */
  issueBody: string;
  /** Parent dir for all agentbox workspaces (e.g. "./data/agentbox-runs"). */
  workDirRoot: string;
  /** Optional override of the timeout per shell-out (default 120s). */
  timeoutMs?: number;
}

export interface PreparedEnvironment {
  /** Absolute path to the workspace root. */
  workDir: string;
  /** Absolute path to the cloned repo inside the workspace. */
  repoDir: string;
  /** Absolute path to the generated prd.json. */
  prdPath: string;
  /** The generated PRD (also written to disk). */
  prd: PRD;
  /** Files copied into the workspace from the cloned repo (CLAUDE.md etc.). */
  contextFiles: string[];
}

const DEFAULT_TIMEOUT_MS = 120_000;
const REPO_FORMAT = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;

function makeStamp(): string {
  return `${String(Date.now())}-${String(process.pid)}-${String(Math.random()).slice(2, 8)}`;
}

/**
 * Prepare a fresh agentbox workspace from a GitHub issue. Throws on any
 * step that fails — partial workspaces are left on disk so the caller
 * (or a human) can inspect what got written before cleanupEnvironment
 * is called.
 */
export async function prepareEnvironment(opts: PrepareEnvironmentOpts): Promise<PreparedEnvironment> {
  if (!REPO_FORMAT.test(opts.repo)) {
    throw new Error(`Invalid repo format: ${opts.repo}`);
  }
  if (!Number.isInteger(opts.issueNumber) || opts.issueNumber < 1) {
    throw new Error(`Invalid issue number: ${String(opts.issueNumber)}`);
  }

  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const workDir = path.resolve(opts.workDirRoot, `issue-${String(opts.issueNumber)}-${makeStamp()}`);
  const repoDir = path.join(workDir, 'repo');

  await mkdir(workDir, { recursive: true });

  const issueInput: IssueInput = { title: opts.issueTitle, body: opts.issueBody };
  const prd = generatePRD(issueInput);
  const prdPath = path.join(workDir, 'prd.json');
  await writeFile(prdPath, JSON.stringify(prd, null, 2) + '\n', 'utf-8');

  await execFileAsync(
    '/usr/bin/git',
    ['clone', '--depth=1', `https://github.com/${opts.repo}.git`, repoDir],
    { timeout },
  );

  const contextFiles = await copyContextFiles(repoDir, workDir);

  return { workDir, repoDir, prdPath, prd, contextFiles };
}

/**
 * Copy CLAUDE.md and every file under `.claude/context/` from the cloned
 * repo into the workspace root. Missing files are silently skipped — a
 * project with no CLAUDE.md is still valid.
 *
 * Recurses into subdirectories so a `.claude/context/topic/file.md`
 * structure survives the copy. The flat copy in earlier drafts would
 * have silently dropped subdirectory content with no signal to the
 * caller; this matters because the agent runs with whatever context
 * actually arrives in the workspace.
 */
async function copyContextFiles(repoDir: string, workDir: string): Promise<string[]> {
  const copied: string[] = [];

  const claudeMd = path.join(repoDir, 'CLAUDE.md');
  if (await pathExists(claudeMd)) {
    const dst = path.join(workDir, 'CLAUDE.md');
    await copyFile(claudeMd, dst);
    copied.push('CLAUDE.md');
  }

  const contextDir = path.join(repoDir, '.claude', 'context');
  if (await pathExists(contextDir)) {
    const dstDir = path.join(workDir, '.claude', 'context');
    await copyTreeRecursive(contextDir, dstDir, path.join('.claude', 'context'), copied);
  }

  return copied;
}

/**
 * Mirror `srcDir` into `dstDir` recursively, recording each copied file
 * relative to `relPrefix`. Symlinks are followed via `stat()`; if a
 * symlink resolves to a file or directory, it gets copied like the
 * resolved entry. Anything that isn't a regular file or directory
 * (sockets, devices, broken symlinks) is skipped silently — these
 * shouldn't appear in a `.claude/context/` tree, but defense in depth.
 */
async function copyTreeRecursive(srcDir: string, dstDir: string, relPrefix: string, copied: string[]): Promise<void> {
  await mkdir(dstDir, { recursive: true });
  const entries = await readdir(srcDir);
  for (const entry of entries) {
    const src = path.join(srcDir, entry);
    const dst = path.join(dstDir, entry);
    const rel = path.join(relPrefix, entry);
    const stats = await stat(src).catch(() => null);
    if (!stats) continue;
    if (stats.isFile()) {
      await copyFile(src, dst);
      copied.push(rel);
    } else if (stats.isDirectory()) {
      await copyTreeRecursive(src, dst, rel, copied);
    }
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Pattern a workDir produced by prepareEnvironment must match. Cleanup
 * refuses anything else so a caller can't accidentally rm an arbitrary
 * directory by passing the wrong string. Pattern is tied to
 * `issue-<n>-<stamp>` from `prepareEnvironment` above; if you change
 * one, change both.
 */
const WORKDIR_BASENAME_PATTERN = /^issue-\d+-\d+-\d+-\d{1,8}$/;

/**
 * Remove the workspace. Idempotent — `recursive: true, force: true`
 * means a missing directory is not an error. Safe to call after a
 * successful run, after a failed prepare, or twice.
 *
 * Refuses to operate on paths whose basename doesn't match the
 * `issue-<n>-<stamp>` shape produced by prepareEnvironment. This
 * blocks accidental `cleanupEnvironment("/")` or
 * `cleanupEnvironment("/home/user")` calls — the rm would otherwise
 * succeed silently.
 */
export async function cleanupEnvironment(workDir: string): Promise<void> {
  const base = path.basename(workDir);
  if (!WORKDIR_BASENAME_PATTERN.test(base)) {
    throw new Error(
      `cleanupEnvironment refuses to operate on "${workDir}": basename "${base}" ` +
      `does not match the expected workspace pattern (issue-<n>-<stamp>).`,
    );
  }
  await rm(workDir, { recursive: true, force: true });
}

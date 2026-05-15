/**
 * Tests for the environment preparation service (#237 / T4).
 *
 * Filesystem operations run against per-test temp directories so we
 * don't have to mock fs. `git clone` is mocked at the child_process
 * level — the mock simulates the side-effect (creating the target
 * directory and dropping a fake CLAUDE.md / .claude/context/ file).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

interface ExecFileCall {
  bin: string;
  args: string[];
}

let execFileCalls: ExecFileCall[] = [];
// The git-clone behavior the test wants the mocked execFile to perform.
// Default: succeed and create the target directory with a CLAUDE.md.
let cloneBehavior: (args: string[]) => Promise<{ stdout: string; stderr: string } | { error: Error }> = async (args) => {
  const targetIdx = args.findIndex((a) => a.startsWith('/') && !a.startsWith('--'));
  if (targetIdx >= 0) {
    const target = args[targetIdx]!;
    await mkdir(target, { recursive: true });
    await writeFile(path.join(target, 'CLAUDE.md'), '# Project context\n', 'utf-8');
  }
  return { stdout: '', stderr: '' };
};

vi.mock('node:child_process', () => ({
  execFile: vi.fn(
    (
      bin: string,
      args: string[],
      _opts: unknown,
      cb: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      execFileCalls.push({ bin, args });
      void cloneBehavior(args).then((result) => {
        if ('error' in result) cb(result.error, '', '');
        else cb(null, result.stdout, result.stderr);
      });
    },
  ),
}));

import { prepareEnvironment, cleanupEnvironment } from './environment.js';

let workDirRoot: string;

describe('prepareEnvironment (#237)', () => {
  beforeEach(async () => {
    execFileCalls = [];
    workDirRoot = path.join(os.tmpdir(), `agentbox-env-${String(Date.now())}-${String(process.pid)}-${String(Math.random()).slice(2, 8)}`);
    await mkdir(workDirRoot, { recursive: true });
    cloneBehavior = async (args) => {
      const targetIdx = args.findIndex((a) => a.startsWith(workDirRoot));
      if (targetIdx >= 0) {
        const target = args[targetIdx]!;
        await mkdir(target, { recursive: true });
        await writeFile(path.join(target, 'CLAUDE.md'), '# Project context\n', 'utf-8');
      }
      return { stdout: '', stderr: '' };
    };
  });

  afterEach(async () => {
    // The test root isn't a real workspace (no issue-<n>-<stamp> shape),
    // so use rm directly rather than cleanupEnvironment which now
    // refuses non-conforming paths.
    await fs.promises.rm(workDirRoot, { recursive: true, force: true }).catch(() => { /* best-effort */ });
  });

  it('creates a unique work directory under workDirRoot for each call', async () => {
    const a = await prepareEnvironment({
      issueNumber: 1,
      repo: 'org/repo',
      issueTitle: 'first',
      issueBody: '## Summary\n\nA',
      workDirRoot,
    });
    const b = await prepareEnvironment({
      issueNumber: 1,
      repo: 'org/repo',
      issueTitle: 'second',
      issueBody: '## Summary\n\nB',
      workDirRoot,
    });

    expect(a.workDir).not.toBe(b.workDir);
    expect(a.workDir.startsWith(workDirRoot)).toBe(true);
    expect(b.workDir.startsWith(workDirRoot)).toBe(true);
  });

  it('shells out to `git clone --depth=1` with the right URL and target', async () => {
    const result = await prepareEnvironment({
      issueNumber: 42,
      repo: 'swamp-dev/slack-server-monitor',
      issueTitle: 'feat: t',
      issueBody: '## Summary\n\nx',
      workDirRoot,
    });

    expect(execFileCalls).toHaveLength(1);
    expect(execFileCalls[0]?.bin).toBe('/usr/bin/git');
    const args = execFileCalls[0]!.args;
    expect(args[0]).toBe('clone');
    expect(args).toContain('--depth=1');
    expect(args).toContain('https://github.com/swamp-dev/slack-server-monitor.git');
    expect(args[args.length - 1]).toBe(result.repoDir);
  });

  it('writes a valid prd.json that round-trips through JSON.parse', async () => {
    const result = await prepareEnvironment({
      issueNumber: 7,
      repo: 'org/repo',
      issueTitle: 'fix: things',
      issueBody: `## Summary

Fix the things.

## Acceptance Criteria

- [ ] Things work
- [ ] More things work`,
      workDirRoot,
    });

    const onDisk = await readFile(result.prdPath, 'utf-8');
    const parsed = JSON.parse(onDisk) as { tasks: unknown[]; metadata: { total_tasks: number } };
    expect(parsed.tasks).toHaveLength(2);
    expect(parsed.metadata.total_tasks).toBe(2);
    expect(result.prd.tasks).toHaveLength(2);
  });

  it('copies CLAUDE.md from the cloned repo into the workspace root', async () => {
    const result = await prepareEnvironment({
      issueNumber: 1,
      repo: 'org/repo',
      issueTitle: 't',
      issueBody: '## Summary\n\nx',
      workDirRoot,
    });

    expect(result.contextFiles).toContain('CLAUDE.md');
    const copied = await readFile(path.join(result.workDir, 'CLAUDE.md'), 'utf-8');
    expect(copied).toBe('# Project context\n');
  });

  it('copies files from .claude/context/ when present', async () => {
    cloneBehavior = async (args) => {
      const targetIdx = args.findIndex((a) => a.startsWith(workDirRoot));
      const target = args[targetIdx]!;
      await mkdir(path.join(target, '.claude', 'context'), { recursive: true });
      await writeFile(path.join(target, '.claude', 'context', 'topology.md'), '# topology', 'utf-8');
      await writeFile(path.join(target, '.claude', 'context', 'glossary.md'), '# glossary', 'utf-8');
      return { stdout: '', stderr: '' };
    };

    const result = await prepareEnvironment({
      issueNumber: 1,
      repo: 'org/repo',
      issueTitle: 't',
      issueBody: '## Summary\n\nx',
      workDirRoot,
    });

    expect(result.contextFiles).toContain(path.join('.claude', 'context', 'topology.md'));
    expect(result.contextFiles).toContain(path.join('.claude', 'context', 'glossary.md'));
    const dst = path.join(result.workDir, '.claude', 'context', 'topology.md');
    expect(await readFile(dst, 'utf-8')).toBe('# topology');
  });

  it('recurses into .claude/context/ subdirectories when copying', async () => {
    cloneBehavior = async (args) => {
      const targetIdx = args.findIndex((a) => a.startsWith(workDirRoot));
      const target = args[targetIdx]!;
      await mkdir(path.join(target, '.claude', 'context', 'topic'), { recursive: true });
      await writeFile(path.join(target, '.claude', 'context', 'topic', 'deep.md'), '# deep', 'utf-8');
      return { stdout: '', stderr: '' };
    };

    const result = await prepareEnvironment({
      issueNumber: 1,
      repo: 'org/repo',
      issueTitle: 't',
      issueBody: '## Summary\n\nx',
      workDirRoot,
    });

    expect(result.contextFiles).toContain(path.join('.claude', 'context', 'topic', 'deep.md'));
    const dst = path.join(result.workDir, '.claude', 'context', 'topic', 'deep.md');
    expect(await readFile(dst, 'utf-8')).toBe('# deep');
  });

  it('succeeds with no context files when the repo has none', async () => {
    cloneBehavior = async (args) => {
      const targetIdx = args.findIndex((a) => a.startsWith(workDirRoot));
      await mkdir(args[targetIdx]!, { recursive: true });
      return { stdout: '', stderr: '' };
    };

    const result = await prepareEnvironment({
      issueNumber: 1,
      repo: 'org/repo',
      issueTitle: 't',
      issueBody: '## Summary\n\nx',
      workDirRoot,
    });

    expect(result.contextFiles).toEqual([]);
  });

  it('throws on an invalid repo format', async () => {
    await expect(
      prepareEnvironment({
        issueNumber: 1,
        repo: 'not a real repo',
        issueTitle: 't',
        issueBody: '## Summary\n\nx',
        workDirRoot,
      }),
    ).rejects.toThrow(/Invalid repo format/);
    expect(execFileCalls).toHaveLength(0);
  });

  it('throws on an invalid issue number', async () => {
    await expect(
      prepareEnvironment({
        issueNumber: -1,
        repo: 'org/repo',
        issueTitle: 't',
        issueBody: '## Summary\n\nx',
        workDirRoot,
      }),
    ).rejects.toThrow(/Invalid issue number/);
  });

  it('handles missing optional sections gracefully (Summary only)', async () => {
    const result = await prepareEnvironment({
      issueNumber: 1,
      repo: 'org/repo',
      issueTitle: 'fix: minimal',
      issueBody: '## Summary\n\nA tiny bug fix.',
      workDirRoot,
    });

    expect(result.prd.tasks.length).toBeGreaterThanOrEqual(1);
    expect(result.prd.description).toContain('A tiny bug fix.');
  });

  it('surfaces git stderr as the failure message when clone fails', async () => {
    cloneBehavior = async () => ({ error: new Error('fatal: repository not found') });

    await expect(
      prepareEnvironment({
        issueNumber: 1,
        repo: 'org/repo',
        issueTitle: 't',
        issueBody: '## Summary\n\nx',
        workDirRoot,
      }),
    ).rejects.toThrow(/repository not found|fatal/i);
  });
});

describe('cleanupEnvironment (#237)', () => {
  beforeEach(async () => {
    workDirRoot = path.join(os.tmpdir(), `agentbox-env-cleanup-${String(Date.now())}-${String(process.pid)}-${String(Math.random()).slice(2, 8)}`);
    await mkdir(workDirRoot, { recursive: true });
  });
  afterEach(async () => { await fs.promises.rm(workDirRoot, { recursive: true, force: true }).catch(() => { /* best-effort */ }); });

  // Helper to fabricate a workspace whose basename matches the
  // pattern cleanupEnvironment now enforces.
  function fakeWorkDir(): string {
    return path.join(workDirRoot, `issue-1-${String(Date.now())}-${String(process.pid)}-${String(Math.random()).slice(2, 8)}`);
  }

  it('removes the workspace recursively', async () => {
    const wd = fakeWorkDir();
    await mkdir(path.join(wd, 'nested', 'deep'), { recursive: true });
    await writeFile(path.join(wd, 'nested', 'deep', 'a.txt'), 'data', 'utf-8');

    await cleanupEnvironment(wd);

    expect(fs.existsSync(wd)).toBe(false);
  });

  it('is idempotent — calling on a missing (but conforming) directory does not throw', async () => {
    const wd = fakeWorkDir();
    await expect(cleanupEnvironment(wd)).resolves.toBeUndefined();
  });

  it('is safe to call twice in a row', async () => {
    const wd = fakeWorkDir();
    await mkdir(wd, { recursive: true });
    await writeFile(path.join(wd, 'f.txt'), 'x', 'utf-8');
    await cleanupEnvironment(wd);
    await expect(cleanupEnvironment(wd)).resolves.toBeUndefined();
  });

  it('refuses to operate on a path whose basename does not match the workspace pattern', async () => {
    const wd = path.join(workDirRoot, 'arbitrary-string');
    await mkdir(wd, { recursive: true });
    await writeFile(path.join(wd, 'f.txt'), 'x', 'utf-8');

    await expect(cleanupEnvironment(wd)).rejects.toThrow(/refuses to operate/i);
    expect(fs.existsSync(wd)).toBe(true); // still there
  });
});

describe('environment preparation isolation (#237)', () => {
  it('uses unique paths so parallel preparations cannot collide', async () => {
    const root = path.join(os.tmpdir(), `agentbox-parallel-${String(Date.now())}-${String(process.pid)}-${String(Math.random()).slice(2, 8)}`);
    await mkdir(root, { recursive: true });
    cloneBehavior = async (args) => {
      const targetIdx = args.findIndex((a) => a.startsWith(root));
      await mkdir(args[targetIdx]!, { recursive: true });
      return { stdout: '', stderr: '' };
    };

    const calls = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        prepareEnvironment({
          issueNumber: i + 1,
          repo: 'org/repo',
          issueTitle: `t${String(i)}`,
          issueBody: '## Summary\n\nx',
          workDirRoot: root,
        }),
      ),
    );

    const dirs = new Set(calls.map((c) => c.workDir));
    expect(dirs.size).toBe(5);
    for (const c of calls) {
      const stats = await stat(c.workDir);
      expect(stats.isDirectory()).toBe(true);
    }

    // Each c.workDir matches the issue-<n>-<stamp> pattern, so
    // cleanupEnvironment is happy. The shared root isn't a workspace,
    // so use rm directly for that.
    for (const c of calls) await cleanupEnvironment(c.workDir);
    await fs.promises.rm(root, { recursive: true, force: true });
  });
});

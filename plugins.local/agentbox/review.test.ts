/**
 * Tests for the review-agent integration (#196).
 *
 * Same globalThis-bag pattern as the other agentbox tests so the
 * hoisted vi.mock factory can drive the review-runner subprocess
 * without actually shelling out.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { PluginDatabase } from '../../src/services/plugin-database.js';

interface ExecResult { stdout?: string; stderr?: string; err?: Error }

declare global {
  // eslint-disable-next-line no-var
  var __reviewTestBag: {
    execCalls: { bin: string; args: string[] }[];
    execHandler: (bin: string, args: string[]) => ExecResult;
  } | undefined;
}
globalThis.__reviewTestBag = {
  execCalls: [],
  execHandler: () => ({ stdout: '' }),
};

vi.mock('node:child_process', () => {
  const PROMISIFY_CUSTOM = Symbol.for('nodejs.util.promisify.custom');
  const bag = (): NonNullable<typeof globalThis.__reviewTestBag> => globalThis.__reviewTestBag!;
  function execFileImpl(
    bin: string,
    args: string[],
    _opts: unknown,
    cb: (err: Error | null, stdout: string, stderr: string) => void,
  ): void {
    bag().execCalls.push({ bin, args });
    const result = bag().execHandler(bin, args);
    cb(result.err ?? null, result.stdout ?? '', result.stderr ?? '');
  }
  Object.defineProperty(execFileImpl, PROMISIFY_CUSTOM, {
    value: (bin: string, args: string[]) =>
      new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        bag().execCalls.push({ bin, args });
        const result = bag().execHandler(bin, args);
        if (result.err) reject(result.err);
        else resolve({ stdout: result.stdout ?? '', stderr: result.stderr ?? '' });
      }),
  });
  return { execFile: execFileImpl };
});

import {
  runReview,
  parseReviewOutput,
  formatReviewSummary,
  ensureReviewSchema,
  type ReviewResult,
} from './review.js';

const bag = (): NonNullable<typeof globalThis.__reviewTestBag> => globalThis.__reviewTestBag!;
function execCalls(): { bin: string; args: string[] }[] { return bag().execCalls; }
function setExecHandler(fn: (bin: string, args: string[]) => ExecResult): void { bag().execHandler = fn; }

let rawDb: Database.Database;
let pluginDb: PluginDatabase;

beforeEach(() => {
  bag().execCalls = [];
  setExecHandler(() => ({ stdout: '' }));
  rawDb = new Database(':memory:');
  rawDb.pragma('journal_mode = WAL');
  pluginDb = new PluginDatabase(rawDb, 'agentbox');
  ensureReviewSchema(pluginDb);
});

afterEach(() => {
  rawDb.close();
});

describe('parseReviewOutput (#196)', () => {
  it('returns empty array for empty input', () => {
    expect(parseReviewOutput('')).toEqual([]);
  });

  it('returns empty array when all sections say "None"', () => {
    const out = parseReviewOutput(`
## Critical Issues

None.

## Significant Problems

None.

## Improvements

None.
`);
    expect(out).toEqual([]);
  });

  it('parses critical, significant, and minor sections with bullet lists', () => {
    const out = parseReviewOutput(`
## Critical Issues

- Path traversal in foo.ts:42

## Significant Problems

- Missing error handler in bar.ts
- Race condition in baz.ts

## Improvements

- Variable name could be clearer
`);
    expect(out).toHaveLength(4);
    expect(out[0]).toMatchObject({ severity: 'critical', title: 'Path traversal in foo.ts:42' });
    expect(out[1]).toMatchObject({ severity: 'significant', title: 'Missing error handler in bar.ts' });
    expect(out[2]).toMatchObject({ severity: 'significant', title: 'Race condition in baz.ts' });
    expect(out[3]).toMatchObject({ severity: 'minor', title: 'Variable name could be clearer' });
  });

  it('treats "## Improvements" and "## Minor Issues" both as minor severity', () => {
    const out = parseReviewOutput(`
## Minor Issues

- Spelling error in comment
`);
    expect(out).toHaveLength(1);
    expect(out[0]?.severity).toBe('minor');
  });

  it('preserves multi-line bullet bodies', () => {
    const out = parseReviewOutput(`
## Critical Issues

- First finding title
  details on the next line
  and one more line

- Second finding title
`);
    expect(out).toHaveLength(2);
    expect(out[0]?.title).toBe('First finding title');
    expect(out[0]?.body).toContain('details on the next line');
    expect(out[1]?.title).toBe('Second finding title');
  });

  it('falls back to paragraph mode when no bullets are present', () => {
    const out = parseReviewOutput(`
## Significant Problems

First paragraph finding.

Second paragraph finding spans
multiple lines but is one finding.
`);
    expect(out).toHaveLength(2);
    expect(out[0]?.title).toBe('First paragraph finding.');
    expect(out[1]?.title).toBe('Second paragraph finding spans');
  });

  it('matches headings case-insensitively', () => {
    const out = parseReviewOutput('## CRITICAL ISSUES\n\n- thing\n');
    expect(out).toHaveLength(1);
    expect(out[0]?.severity).toBe('critical');
  });
});

describe('formatReviewSummary (#196)', () => {
  it('returns a "no findings" message when count is 0', () => {
    expect(formatReviewSummary({ count: 0, hasCritical: false, findings: [], rawOutput: '' }))
      .toMatch(/no review findings/i);
  });

  it('groups findings by severity in fixed order: critical, significant, minor', () => {
    const result: ReviewResult = {
      count: 3,
      hasCritical: true,
      findings: [
        { severity: 'minor', title: 'minor item', body: 'm' },
        { severity: 'critical', title: 'critical item', body: 'c' },
        { severity: 'significant', title: 'significant item', body: 's' },
      ],
      rawOutput: '',
    };
    const out = formatReviewSummary(result);
    const cIdx = out.indexOf('Critical');
    const sIdx = out.indexOf('Significant');
    const mIdx = out.indexOf('Minor');
    expect(cIdx).toBeGreaterThan(0);
    expect(cIdx).toBeLessThan(sIdx);
    expect(sIdx).toBeLessThan(mIdx);
    expect(out).toMatch(/PR creation blocked/);
  });

  it('omits the blocked notice when no critical findings', () => {
    const result: ReviewResult = {
      count: 1,
      hasCritical: false,
      findings: [{ severity: 'significant', title: 'thing', body: 't' }],
      rawOutput: '',
    };
    const out = formatReviewSummary(result);
    expect(out).not.toMatch(/blocked/i);
  });
});

describe('runReview (#196)', () => {
  it('returns an empty result when no reviewCommand is configured (no-op)', async () => {
    const result = await runReview({
      db: pluginDb, runId: 1, workDir: '/tmp/work',
    });
    expect(result.count).toBe(0);
    expect(result.hasCritical).toBe(false);
    expect(execCalls()).toHaveLength(0);
  });

  it('runs the configured review command and parses its output', async () => {
    setExecHandler(() => ({
      stdout: '## Critical Issues\n\n- something is wrong\n\n## Improvements\n\n- minor nit\n',
    }));

    const result = await runReview({
      db: pluginDb, runId: 1, workDir: '/tmp/work',
      reviewCommand: '/usr/local/bin/review {workDir}',
    });

    expect(result.count).toBe(2);
    expect(result.hasCritical).toBe(true);
    expect(result.findings[0]?.severity).toBe('critical');
    expect(result.findings[1]?.severity).toBe('minor');

    expect(execCalls()).toHaveLength(1);
    expect(execCalls()[0]?.bin).toBe('/usr/local/bin/review');
    expect(execCalls()[0]?.args).toEqual(['/tmp/work']);
  });

  it('persists findings to the reviews table keyed by run_id', async () => {
    setExecHandler(() => ({
      stdout: '## Significant Problems\n\n- item one\n- item two\n',
    }));

    await runReview({
      db: pluginDb, runId: 42, workDir: '/tmp/work',
      reviewCommand: 'review-bin',
    });

    const rows = rawDb
      .prepare(`SELECT severity, title, run_id FROM ${pluginDb.prefix}reviews WHERE run_id = ? ORDER BY id`)
      .all(42) as Array<{ severity: string; title: string; run_id: number }>;
    expect(rows).toHaveLength(2);
    expect(rows[0]?.severity).toBe('significant');
    expect(rows[0]?.title).toBe('item one');
    expect(rows[0]?.run_id).toBe(42);
    expect(rows[1]?.title).toBe('item two');
  });

  it('returns empty result + does NOT persist when the review command fails', async () => {
    setExecHandler(() => ({ err: new Error('exit 1') }));

    const result = await runReview({
      db: pluginDb, runId: 7, workDir: '/tmp/work',
      reviewCommand: 'review-bin',
    });

    expect(result.count).toBe(0);
    expect(result.hasCritical).toBe(false);
    const rows = rawDb.prepare(`SELECT * FROM ${pluginDb.prefix}reviews WHERE run_id = ?`).all(7);
    expect(rows).toEqual([]);
  });

  it('substitutes {workDir} into multiple argument tokens', async () => {
    setExecHandler(() => ({ stdout: '' }));

    await runReview({
      db: pluginDb, runId: 1, workDir: '/some/path',
      reviewCommand: 'reviewer --dir {workDir} --output {workDir}/out.txt',
    });

    expect(execCalls()[0]?.args).toEqual(['--dir', '/some/path', '--output', '/some/path/out.txt']);
  });

  it('reports ranButFailed=false for the no-command-configured skip path', async () => {
    const result = await runReview({ db: pluginDb, runId: 1, workDir: '/tmp/work' });
    expect(result.ranButFailed).toBe(false);
  });

  it('reports ranButFailed=true when the configured command fails', async () => {
    setExecHandler(() => ({ err: new Error('boom') }));
    const result = await runReview({
      db: pluginDb, runId: 1, workDir: '/tmp/work',
      reviewCommand: 'review-bin',
    });
    expect(result.ranButFailed).toBe(true);
    expect(result.count).toBe(0);
  });

  it('reports ranButFailed=false when the command succeeds with no findings', async () => {
    setExecHandler(() => ({ stdout: '## Critical Issues\n\nNone.\n' }));
    const result = await runReview({
      db: pluginDb, runId: 1, workDir: '/tmp/work',
      reviewCommand: 'review-bin',
    });
    expect(result.ranButFailed).toBe(false);
    expect(result.count).toBe(0);
  });
});

describe('parseReviewOutput heading match precision (#196)', () => {
  it('does NOT classify "## Critical fixes already applied" as a critical-findings section', () => {
    const out = parseReviewOutput(`
## Critical fixes already applied

- Some retrospective text about a past fix.
`);
    expect(out).toEqual([]);
  });

  it('does NOT classify "## Previously significant issues" as significant findings', () => {
    const out = parseReviewOutput(`
## Previously significant issues

- Old significant thing that has been resolved.
`);
    expect(out).toEqual([]);
  });
});

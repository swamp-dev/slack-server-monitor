/**
 * Tests for the new /agentbox subcommand handlers (#243 / T13):
 * queue, run, cancel, runs (history). Each is a pure function so we
 * can drive them without booting a Slack app.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { PluginDatabase } from '../../src/services/plugin-database.js';

interface ExecResult { stdout?: string; stderr?: string; err?: Error }

declare global {
  // eslint-disable-next-line no-var
  var __agentboxCommandsTestBag: {
    execCalls: { bin: string; args: string[] }[];
    execHandler: (bin: string, args: string[]) => ExecResult;
  } | undefined;
}
globalThis.__agentboxCommandsTestBag = {
  execCalls: [],
  execHandler: () => ({ stdout: '' }),
};

vi.mock('node:child_process', () => {
  const PROMISIFY_CUSTOM = Symbol.for('nodejs.util.promisify.custom');
  const bag = (): NonNullable<typeof globalThis.__agentboxCommandsTestBag> => globalThis.__agentboxCommandsTestBag!;

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

  return {
    execFile: execFileImpl,
    spawn: vi.fn(() => {
      throw new Error('spawn unexpectedly called in commands.test');
    }),
  };
});

import { handleQueue, handleRunsHistory, handleCancelCommand } from '../agentbox.js';
import { createSchema } from '../../plugins.example/agentbox/schema.js';

const bag = (): NonNullable<typeof globalThis.__agentboxCommandsTestBag> => globalThis.__agentboxCommandsTestBag!;
function setExecHandler(fn: (bin: string, args: string[]) => ExecResult): void { bag().execHandler = fn; }

let rawDb: Database.Database;
let pluginDb: PluginDatabase;

beforeEach(() => {
  bag().execCalls = [];
  setExecHandler(() => ({ stdout: '' }));
  rawDb = new Database(':memory:');
  rawDb.pragma('journal_mode = WAL');
  pluginDb = new PluginDatabase(rawDb, 'agentbox');
  createSchema(pluginDb);
});

afterEach(() => {
  rawDb.close();
});

describe('handleQueue (#243)', () => {
  it('reports an empty queue when no issues are ready', async () => {
    setExecHandler(() => ({ stdout: '[]' }));
    const out = await handleQueue('org/r');
    expect(out).toMatch(/no.*queue/i);
  });

  it('lists ready issues with priority labels surfaced', async () => {
    setExecHandler(() => ({
      stdout: JSON.stringify([
        { number: 1, title: 'first', body: '', createdAt: '2026-01-01', labels: [{ name: 'agentbox-ready' }, { name: 'priority:high' }] },
        { number: 2, title: 'second', body: '', createdAt: '2026-01-02', labels: [{ name: 'agentbox-ready' }] },
      ]),
    }));
    const out = await handleQueue('org/r');
    expect(out).toContain('#1');
    expect(out).toContain('first');
    expect(out).toContain('priority:high');
    expect(out).toContain('#2');
  });

  it('returns the gh stderr message on failure', async () => {
    setExecHandler(() => ({ err: new Error('rate limit') }));
    const out = await handleQueue('org/r');
    expect(out).toMatch(/rate limit/);
  });
});

describe('handleRunsHistory (#243)', () => {
  it('reports "no runs yet" on empty', () => {
    const out = handleRunsHistory(pluginDb);
    expect(out).toMatch(/no.*runs/i);
  });

  it('shows the most recent runs with status and duration', () => {
    const now = Date.now();
    pluginDb
      .prepare(`INSERT INTO ${pluginDb.prefix}runs (issue_number, repo, status, started_at, finished_at, pr_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(7, 'org/r', 'success', now - 90_000, now, 'https://example/pr/9', now - 100_000);
    pluginDb
      .prepare(`INSERT INTO ${pluginDb.prefix}runs (issue_number, repo, status, started_at, finished_at, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(8, 'org/r', 'failed', now - 30_000, now - 10_000, now - 40_000);

    const out = handleRunsHistory(pluginDb);
    expect(out).toContain('#7');
    expect(out).toContain('SUCCESS');
    expect(out).toContain('https://example/pr/9');
    expect(out).toContain('#8');
    expect(out).toContain('FAILED');
  });
});

describe('handleCancelCommand (#243)', () => {
  it('returns "no active run" when nothing is in flight', async () => {
    const out = await handleCancelCommand('alice', pluginDb, 'org/r');
    expect(out).toMatch(/no active run/i);
  });
});

describe('handleRunCommand validation (#243)', () => {
  it('rejects non-numeric input', async () => {
    const { handleRunCommand } = await import('../agentbox.js');
    const ctx = { db: pluginDb, ctx: { db: pluginDb, name: 'agentbox', version: '1.0.0', notify: vi.fn(), sse: { broadcast: vi.fn(), clientCount: () => 0 } } };
    const out = await handleRunCommand('not-a-number', { db: pluginDb, ctx: ctx.ctx }, 'org/r');
    expect(out).toMatch(/Usage/);
  });

  it('rejects empty input', async () => {
    const { handleRunCommand } = await import('../agentbox.js');
    const ctx = { db: pluginDb, name: 'agentbox', version: '1.0.0', notify: vi.fn(), sse: { broadcast: vi.fn(), clientCount: () => 0 } };
    const out = await handleRunCommand('', { db: pluginDb, ctx }, 'org/r');
    expect(out).toMatch(/Usage/);
  });
});

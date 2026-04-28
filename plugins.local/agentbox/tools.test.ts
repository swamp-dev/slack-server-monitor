/**
 * Tests for the agentbox plugin's GitHub-issue Claude tools, including
 * the search_related_issues + add_to_issue intelligence tools (#157).
 *
 * `gh` invocations are mocked at the `node:child_process` level so the
 * tests don't shell out — we assert on the args passed to execFile and
 * on the tool's parsed-output behavior.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { PluginDatabase } from '../../src/services/plugin-database.js';
import type { ToolDefinition } from '../../src/services/tools/types.js';

interface ExecFileCall {
  bin: string;
  args: string[];
}

let execFileCalls: ExecFileCall[] = [];
let execFileBehavior: (args: string[]) => { stdout?: string; stderr?: string; err?: Error } = () => ({ stdout: '' });

vi.mock('node:child_process', () => ({
  execFile: vi.fn(
    (
      bin: string,
      args: string[],
      _opts: unknown,
      cb: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      execFileCalls.push({ bin, args });
      const result = execFileBehavior(args);
      cb(result.err ?? null, result.stdout ?? '', result.stderr ?? '');
    },
  ),
}));

let db: Database.Database;
let pluginDb: PluginDatabase;

function setupTestDb(): void {
  db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  pluginDb = new PluginDatabase(db, 'agentbox');
}

function teardownTestDb(): void { db.close(); }

function createMockContext() {
  return {
    db: pluginDb, name: 'agentbox', version: '1.0.0',
    notify: vi.fn(),
    sse: { broadcast: vi.fn(), clientCount: () => 0 },
  };
}

async function getTool(name: string): Promise<ToolDefinition> {
  const { default: plugin } = await import('../agentbox.js');
  await plugin.init!(createMockContext());
  const tool = plugin.tools!.find((t) => t.spec.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool;
}

describe('agentbox:search_related_issues (#157)', () => {
  beforeEach(() => {
    vi.resetModules();
    setupTestDb();
    execFileCalls = [];
    execFileBehavior = () => ({ stdout: '[]' });
    vi.stubEnv('AGENTBOX_DEFAULT_REPO', 'swamp-dev/slack-server-monitor');
  });
  afterEach(() => { teardownTestDb(); vi.unstubAllEnvs(); });

  it('passes query, state, and limit through to gh issue list', async () => {
    execFileBehavior = () => ({ stdout: '[]' });
    const tool = await getTool('search_related_issues');

    await tool.execute({ query: 'rate limit', state: 'open', limit: 5 });

    expect(execFileCalls).toHaveLength(1);
    expect(execFileCalls[0]?.bin).toBe('/usr/bin/gh');
    const args = execFileCalls[0]!.args;
    expect(args).toContain('issue');
    expect(args).toContain('list');
    expect(args[args.indexOf('--repo') + 1]).toBe('swamp-dev/slack-server-monitor');
    expect(args[args.indexOf('--search') + 1]).toBe('rate limit');
    expect(args[args.indexOf('--state') + 1]).toBe('open');
    expect(args[args.indexOf('--limit') + 1]).toBe('5');
  });

  it('defaults state to "all" and limit to 10 when not provided', async () => {
    const tool = await getTool('search_related_issues');

    await tool.execute({ query: 'foo' });

    const args = execFileCalls[0]!.args;
    expect(args[args.indexOf('--state') + 1]).toBe('all');
    expect(args[args.indexOf('--limit') + 1]).toBe('10');
  });

  it('returns parsed issue summaries as JSON', async () => {
    const fakeIssues = [
      { number: 42, title: 'Rate limit auth requests', state: 'open', labels: [{ name: 'security' }], url: 'http://example/42', updatedAt: '2026-01-01' },
      { number: 50, title: 'Old fix', state: 'closed', labels: [], url: 'http://example/50', updatedAt: '2026-01-02' },
    ];
    execFileBehavior = () => ({ stdout: JSON.stringify(fakeIssues) });
    const tool = await getTool('search_related_issues');

    const result = await tool.execute({ query: 'rate limit' });
    const parsed = JSON.parse(result as string) as { results: typeof fakeIssues };

    expect(parsed.results).toEqual(fakeIssues);
  });

  it('returns a friendly message with empty array when no issues match', async () => {
    execFileBehavior = () => ({ stdout: '[]' });
    const tool = await getTool('search_related_issues');

    const result = await tool.execute({ query: 'nothing matches' });
    const parsed = JSON.parse(result as string) as { results: unknown[]; note?: string };

    expect(parsed.results).toEqual([]);
    expect(parsed.note).toMatch(/no matching issues/i);
  });

  it('rejects calls without a query', async () => {
    const tool = await getTool('search_related_issues');

    const result = await tool.execute({ query: '   ' });

    expect(result).toMatch(/query is required/i);
    expect(execFileCalls).toHaveLength(0);
  });

  it('rejects an invalid state and falls back to "all"', async () => {
    const tool = await getTool('search_related_issues');

    await tool.execute({ query: 'x', state: 'bogus' });

    const args = execFileCalls[0]!.args;
    expect(args[args.indexOf('--state') + 1]).toBe('all');
  });

  it('clamps an out-of-range limit to the default', async () => {
    const tool = await getTool('search_related_issues');

    await tool.execute({ query: 'x', limit: 999 });

    const args = execFileCalls[0]!.args;
    expect(args[args.indexOf('--limit') + 1]).toBe('10');
  });

  it('surfaces gh stderr as the failure message when the CLI errors', async () => {
    execFileBehavior = () => ({ err: new Error('exit'), stderr: 'authentication failed' });
    const tool = await getTool('search_related_issues');

    const result = await tool.execute({ query: 'x' });

    expect(result).toMatch(/authentication failed/i);
  });
});

describe('agentbox:add_to_issue (#157)', () => {
  beforeEach(() => {
    vi.resetModules();
    setupTestDb();
    execFileCalls = [];
    execFileBehavior = () => ({ stdout: 'http://github.example/comment/1' });
    vi.stubEnv('AGENTBOX_DEFAULT_REPO', 'swamp-dev/slack-server-monitor');
  });
  afterEach(() => { teardownTestDb(); vi.unstubAllEnvs(); });

  it('shells out to `gh issue comment` with the right args', async () => {
    const tool = await getTool('add_to_issue');

    await tool.execute({ issue_number: 42, body: 'Investigation: see logs at /var/log/foo' });

    expect(execFileCalls).toHaveLength(1);
    const args = execFileCalls[0]!.args;
    expect(args[0]).toBe('issue');
    expect(args[1]).toBe('comment');
    expect(args[2]).toBe('42');
    expect(args[args.indexOf('--repo') + 1]).toBe('swamp-dev/slack-server-monitor');
    expect(args[args.indexOf('--body') + 1]).toBe('Investigation: see logs at /var/log/foo');
  });

  it('returns gh stdout (or a default success line) on success', async () => {
    execFileBehavior = () => ({ stdout: 'http://github.example/comment/123' });
    const tool = await getTool('add_to_issue');

    const result = await tool.execute({ issue_number: 1, body: 'note' });

    expect(result).toBe('http://github.example/comment/123');
  });

  it('rejects an empty body', async () => {
    const tool = await getTool('add_to_issue');

    const result = await tool.execute({ issue_number: 1, body: '   ' });

    expect(result).toMatch(/body is required/i);
    expect(execFileCalls).toHaveLength(0);
  });

  it('rejects an invalid issue number', async () => {
    const tool = await getTool('add_to_issue');

    const result = await tool.execute({ issue_number: -1, body: 'note' });

    expect(result).toMatch(/invalid issue number/i);
    expect(execFileCalls).toHaveLength(0);
  });

  it('uses a per-call repo override when provided', async () => {
    const tool = await getTool('add_to_issue');

    await tool.execute({ issue_number: 99, body: 'x', repo: 'other/repo' });

    const args = execFileCalls[0]!.args;
    expect(args[args.indexOf('--repo') + 1]).toBe('other/repo');
  });

  it('surfaces gh stderr as the failure message', async () => {
    execFileBehavior = () => ({ err: new Error('exit'), stderr: 'permission denied' });
    const tool = await getTool('add_to_issue');

    const result = await tool.execute({ issue_number: 1, body: 'x' });

    expect(result).toMatch(/permission denied/i);
  });

  it('truncates a body longer than the GitHub comment cap and appends a marker', async () => {
    // GitHub caps comment bodies at 65,536 chars; we cap at 60,000 with
    // headroom for the truncation marker.
    const tool = await getTool('add_to_issue');
    const oversized = 'x'.repeat(70_000);

    await tool.execute({ issue_number: 1, body: oversized });

    expect(execFileCalls).toHaveLength(1);
    const sent = execFileCalls[0]!.args[execFileCalls[0]!.args.indexOf('--body') + 1] as string;
    expect(sent.length).toBeLessThanOrEqual(60_000);
    expect(sent).toMatch(/truncated by agentbox/i);
  });
});

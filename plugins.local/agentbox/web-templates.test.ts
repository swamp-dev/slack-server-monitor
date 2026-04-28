/**
 * Tests for the AgentBox Workflows web UI templates (#241 / T11).
 * Skeleton PR — covers loadDashboardData + renderDashboard. Queue,
 * run history, run detail, and SSE land in follow-up PRs.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { PluginDatabase } from '../../src/services/plugin-database.js';
import {
  loadDashboardData,
  renderDashboard,
  formatDurationMs,
  formatRelative,
  DASHBOARD_CSS,
  type DashboardData,
} from './web-templates.js';
import { createSchema } from '../../plugins.example/agentbox/schema.js';
import { migrateRunsTable } from '../agentbox.js';

let rawDb: Database.Database;
let pluginDb: PluginDatabase;

function insertRun(opts: {
  issueNumber: number;
  repo: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'cancelled';
  startedAt?: number;
  finishedAt?: number;
  prUrl?: string;
  progressPct?: number;
}): number {
  const result = rawDb
    .prepare(
      `INSERT INTO ${pluginDb.prefix}runs
       (issue_number, repo, status, started_at, finished_at, pr_url, progress_pct, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      opts.issueNumber, opts.repo, opts.status,
      opts.startedAt ?? null, opts.finishedAt ?? null,
      opts.prUrl ?? null, opts.progressPct ?? null,
      Date.now(),
    );
  return Number(result.lastInsertRowid);
}

beforeEach(() => {
  rawDb = new Database(':memory:');
  rawDb.pragma('journal_mode = WAL');
  pluginDb = new PluginDatabase(rawDb, 'agentbox');
  createSchema(pluginDb);
  // T10 added the progress columns; the canonical schema in
  // plugins.example/agentbox/schema.ts hasn't caught up yet, so
  // run the in-place migration the plugin uses on init.
  migrateRunsTable(pluginDb);
});

afterEach(() => { rawDb.close(); });

describe('loadDashboardData (#241)', () => {
  it('returns zeroed stats and empty active/recent on an empty runs table', () => {
    const data = loadDashboardData(pluginDb);
    expect(data.stats).toEqual({
      totalRuns: 0, activeRuns: 0,
      successCount: 0, failedCount: 0, cancelledCount: 0,
    });
    expect(data.activeRun).toBeNull();
    expect(data.recentRuns).toEqual([]);
  });

  it('counts rows by status into the stats card values', () => {
    insertRun({ issueNumber: 1, repo: 'org/r', status: 'success' });
    insertRun({ issueNumber: 2, repo: 'org/r', status: 'success' });
    insertRun({ issueNumber: 3, repo: 'org/r', status: 'failed' });
    insertRun({ issueNumber: 4, repo: 'org/r', status: 'cancelled' });

    const data = loadDashboardData(pluginDb);
    expect(data.stats.totalRuns).toBe(4);
    expect(data.stats.successCount).toBe(2);
    expect(data.stats.failedCount).toBe(1);
    expect(data.stats.cancelledCount).toBe(1);
    expect(data.stats.activeRuns).toBe(0);
  });

  it('returns the active run when one exists', () => {
    const id = insertRun({
      issueNumber: 7, repo: 'org/r', status: 'running',
      startedAt: Date.now() - 60_000, progressPct: 35,
    });

    const data = loadDashboardData(pluginDb);
    expect(data.activeRun).not.toBeNull();
    expect(data.activeRun?.id).toBe(id);
    expect(data.activeRun?.progressPct).toBe(35);
    expect(data.stats.activeRuns).toBe(1);
  });

  it('limits recentRuns to 5 most recent terminal-state rows, newest first', () => {
    // 7 successes; recentRuns should be the last 5 by id desc
    for (let i = 1; i <= 7; i++) {
      insertRun({ issueNumber: i, repo: 'org/r', status: 'success' });
    }
    const data = loadDashboardData(pluginDb);
    expect(data.recentRuns).toHaveLength(5);
    // Newest (highest id) first.
    const ids = data.recentRuns.map((r) => r.id);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
  });
});

describe('renderDashboard (#241)', () => {
  function emptyData(): DashboardData {
    return {
      stats: { totalRuns: 0, activeRuns: 0, successCount: 0, failedCount: 0, cancelledCount: 0 },
      activeRun: null,
      recentRuns: [],
    };
  }

  it('renders a "no active run" banner when idle', () => {
    const html = renderDashboard(emptyData());
    expect(html).toContain('banner-idle');
    expect(html).toContain('No active run');
  });

  it('renders the running banner when an active run is present', () => {
    const html = renderDashboard({
      ...emptyData(),
      stats: { ...emptyData().stats, activeRuns: 1, totalRuns: 1 },
      activeRun: {
        id: 1, issueNumber: 7, repo: 'org/r', status: 'running',
        startedAt: Date.now() - 60_000, finishedAt: null, prUrl: null,
        progressPct: 50, tasksTotal: null, tasksCompleted: null, error: null,
      },
    });
    expect(html).toContain('banner-running');
    expect(html).toContain('org/r#7');
    expect(html).toContain('width: 50%');
  });

  it('renders an empty state under "Recent Completions" when the list is empty', () => {
    const html = renderDashboard(emptyData());
    expect(html).toContain('Recent Completions');
    expect(html).toContain('No completed runs yet');
  });

  it('renders status-coloured badges per row', () => {
    const html = renderDashboard({
      ...emptyData(),
      recentRuns: [
        { id: 1, issueNumber: 1, repo: 'org/r', status: 'success', startedAt: 1000, finishedAt: 5000, prUrl: 'https://example/pr/1', progressPct: 100, tasksTotal: null, tasksCompleted: null, error: null },
        { id: 2, issueNumber: 2, repo: 'org/r', status: 'failed', startedAt: 1000, finishedAt: 2000, prUrl: null, progressPct: 0, tasksTotal: null, tasksCompleted: null, error: 'oops' },
      ],
    });
    expect(html).toContain('agentbox-badge-success');
    expect(html).toContain('agentbox-badge-failed');
    expect(html).toContain('https://example/pr/1');
  });

  it('escapes user-controlled values from the runs table', () => {
    const html = renderDashboard({
      ...emptyData(),
      recentRuns: [
        { id: 1, issueNumber: 1, repo: 'org/<script>alert(1)</script>', status: 'success', startedAt: 1000, finishedAt: 2000, prUrl: null, progressPct: 100, tasksTotal: null, tasksCompleted: null, error: null },
      ],
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('sanitizes a hostile prUrl scheme (javascript:) so the PR link is not a live XSS vector', () => {
    const html = renderDashboard({
      ...emptyData(),
      recentRuns: [
        { id: 1, issueNumber: 1, repo: 'org/r', status: 'success', startedAt: 1000, finishedAt: 2000, prUrl: 'javascript:alert(1)', progressPct: 100, tasksTotal: null, tasksCompleted: null, error: null },
      ],
    });
    expect(html).not.toMatch(/href="javascript:/i);
  });

  it('clamps an out-of-range progressPct so a runaway value cannot inject CSS', () => {
    const html = renderDashboard({
      ...emptyData(),
      stats: { totalRuns: 1, activeRuns: 1, successCount: 0, failedCount: 0, cancelledCount: 0 },
      activeRun: {
        id: 1, issueNumber: 1, repo: 'org/r', status: 'running',
        startedAt: Date.now(), finishedAt: null, prUrl: null,
        progressPct: 99999 as number, tasksTotal: null, tasksCompleted: null, error: null,
      },
    });
    // The width should be capped at 100% — never the raw value.
    expect(html).toContain('width: 100%');
    expect(html).not.toContain('99999');
  });
});

describe('formatDurationMs (#241)', () => {
  it('uses ms / s / m+s / h+m tiers', () => {
    expect(formatDurationMs(500)).toBe('500ms');
    expect(formatDurationMs(45_000)).toBe('45s');
    expect(formatDurationMs(5 * 60_000 + 30_000)).toBe('5m 30s');
    expect(formatDurationMs(2 * 3600_000 + 15 * 60_000)).toBe('2h 15m');
  });
});

describe('formatRelative (#241)', () => {
  it('renders seconds / minutes / hours / days ago', () => {
    const now = 1_700_000_000_000;
    expect(formatRelative(now - 30_000, now)).toBe('30s ago');
    expect(formatRelative(now - 5 * 60_000, now)).toBe('5m ago');
    expect(formatRelative(now - 3 * 3600_000, now)).toBe('3h ago');
    expect(formatRelative(now - 2 * 86_400_000, now)).toBe('2d ago');
  });
});

describe('DASHBOARD_CSS (#241)', () => {
  it('uses CSS variables for theming so Dracula and light both work', () => {
    expect(DASHBOARD_CSS).toContain('var(--card-bg');
    expect(DASHBOARD_CSS).toContain('var(--border');
    expect(DASHBOARD_CSS).toContain('var(--accent');
  });
});

describe('renderQueue (#241 split #2)', () => {
  it('renders an empty-state card when no issues are ready', async () => {
    const { renderQueue } = await import('./web-templates.js');
    const html = renderQueue([], 'org/r');
    expect(html).toContain('Ready Queue');
    expect(html).toMatch(/no.*agentbox-ready/i);
    expect(html).toContain('org/r');
  });

  it('lists issues with priority labels surfaced', async () => {
    const { renderQueue } = await import('./web-templates.js');
    const html = renderQueue(
      [
        { number: 7, title: 'Fix the bug', createdAt: '2026-04-01T00:00:00Z',
          labels: [{ name: 'agentbox-ready' }, { name: 'priority:high' }, { name: 'area: web-ui' }] },
      ],
      'org/r',
    );
    expect(html).toContain('#7');
    expect(html).toContain('Fix the bug');
    expect(html).toContain('priority:high');
    expect(html).toContain('area: web-ui');
  });

  it('orders priority:high before unlabeled, then by oldest createdAt', async () => {
    const { renderQueue } = await import('./web-templates.js');
    const html = renderQueue(
      [
        { number: 3, title: 'newest no-priority', createdAt: '2026-03-03T00:00:00Z', labels: [] },
        { number: 2, title: 'old high-priority', createdAt: '2026-01-01T00:00:00Z',
          labels: [{ name: 'priority:high' }] },
        { number: 1, title: 'middle no-priority', createdAt: '2026-02-02T00:00:00Z', labels: [] },
      ],
      'org/r',
    );
    const idx2 = html.indexOf('#2');
    const idx1 = html.indexOf('#1');
    const idx3 = html.indexOf('#3');
    expect(idx2).toBeGreaterThan(0);
    expect(idx2).toBeLessThan(idx1);
    expect(idx1).toBeLessThan(idx3);
  });

  it('escapes hostile titles + labels', async () => {
    const { renderQueue } = await import('./web-templates.js');
    const html = renderQueue(
      [
        { number: 1, title: '<script>alert(1)</script>', createdAt: '2026-01-01T00:00:00Z',
          labels: [{ name: '<img src=x>' }] },
      ],
      'org/<script>',
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toMatch(/<img src=x>/);
    expect(html).toContain('&lt;script&gt;alert(1)');
  });

  it('sanitizes the issue url so a hostile scheme cannot become a live link', async () => {
    const { renderQueue } = await import('./web-templates.js');
    const html = renderQueue(
      [
        { number: 1, title: 't', createdAt: '2026-01-01T00:00:00Z',
          labels: [], url: 'javascript:alert(1)' },
      ],
      'org/r',
    );
    expect(html).not.toMatch(/href="javascript:/i);
  });
});

describe('renderNavPills (#241 split #2)', () => {
  it('marks the active page', async () => {
    const { renderNavPills } = await import('./web-templates.js');
    const html = renderNavPills('queue');
    expect(html).toContain('Queue');
    const queueLinkMatch = /<a href="\/p\/agentbox\/queue"[^>]*class="agentbox-pill active"/.test(html);
    expect(queueLinkMatch).toBe(true);
  });

  it('links to all three pages', async () => {
    const { renderNavPills } = await import('./web-templates.js');
    const html = renderNavPills('dashboard');
    expect(html).toContain('href="/p/agentbox/"');
    expect(html).toContain('href="/p/agentbox/queue"');
    expect(html).toContain('href="/p/agentbox/runs"');
  });
});

describe('sortQueueIssues (#241 split #2)', () => {
  it('returns a new array (does not mutate input)', async () => {
    const { sortQueueIssues } = await import('./web-templates.js');
    const input = [
      { number: 1, title: 'a', createdAt: '2026-02-01', labels: [] },
      { number: 2, title: 'b', createdAt: '2026-01-01', labels: [{ name: 'priority:high' }] },
    ];
    const out = sortQueueIssues(input);
    expect(out).not.toBe(input);
    expect(input[0]?.number).toBe(1);
    expect(out[0]?.number).toBe(2);
  });
});

describe('parsePageParam (#241 split #3)', () => {
  it('returns 1 for missing input', async () => {
    const { parsePageParam } = await import('./web-templates.js');
    expect(parsePageParam(undefined)).toBe(1);
  });
  it('returns 1 for non-string input (e.g. Express array case)', async () => {
    const { parsePageParam } = await import('./web-templates.js');
    expect(parsePageParam(['2', '3'])).toBe(1);
    expect(parsePageParam(42)).toBe(1);
  });
  it('returns 1 for non-numeric string', async () => {
    const { parsePageParam } = await import('./web-templates.js');
    expect(parsePageParam('abc')).toBe(1);
  });
  it('returns 1 for zero or negative', async () => {
    const { parsePageParam } = await import('./web-templates.js');
    expect(parsePageParam('0')).toBe(1);
    expect(parsePageParam('-3')).toBe(1);
  });
  it('parses positive integers', async () => {
    const { parsePageParam } = await import('./web-templates.js');
    expect(parsePageParam('5')).toBe(5);
    expect(parsePageParam('1')).toBe(1);
  });
  // Documents that parseInt's loose parsing is intentional — Express
  // query strings are noisy in the wild and we'd rather be permissive
  // than fail-closed. If you tighten this, update both the comment
  // and these assertions together.
  it('takes the leading-integer prefix from a noisy string ("2abc" → 2)', async () => {
    const { parsePageParam } = await import('./web-templates.js');
    expect(parsePageParam('2abc')).toBe(2);
    expect(parsePageParam('1.5')).toBe(1);
  });
});

describe('loadRunHistory (#241 split #3)', () => {
  function seedRuns(n: number): void {
    for (let i = 1; i <= n; i++) {
      rawDb
        .prepare(`INSERT INTO ${pluginDb.prefix}runs (issue_number, repo, status, created_at) VALUES (?, ?, ?, ?)`)
        .run(i, 'org/r', 'success', Date.now() + i);
    }
  }

  it('returns total=0 + empty rows on an empty table', async () => {
    const { loadRunHistory } = await import('./web-templates.js');
    const data = loadRunHistory(pluginDb);
    expect(data.total).toBe(0);
    expect(data.runs).toEqual([]);
    expect(data.page).toBe(1);
  });

  it('paginates newest-first by id at the configured pageSize', async () => {
    const { loadRunHistory } = await import('./web-templates.js');
    seedRuns(25);
    const page1 = loadRunHistory(pluginDb, 1, 10);
    expect(page1.runs).toHaveLength(10);
    expect(page1.total).toBe(25);
    expect(page1.page).toBe(1);
    expect(page1.runs[0]?.id).toBe(25);
    const page3 = loadRunHistory(pluginDb, 3, 10);
    expect(page3.runs).toHaveLength(5);
    expect(page3.runs[0]?.id).toBe(5);
  });

  it('clamps out-of-range page to the last available page', async () => {
    const { loadRunHistory } = await import('./web-templates.js');
    seedRuns(15);
    const data = loadRunHistory(pluginDb, 999, 10);
    expect(data.page).toBe(2);
    expect(data.runs).toHaveLength(5);
  });

  it('clamps page=0 / negative to 1', async () => {
    const { loadRunHistory } = await import('./web-templates.js');
    seedRuns(5);
    const data = loadRunHistory(pluginDb, -3, 10);
    expect(data.page).toBe(1);
  });

  it('clamps pageSize to a sane range', async () => {
    const { loadRunHistory } = await import('./web-templates.js');
    seedRuns(5);
    expect(loadRunHistory(pluginDb, 1, 999).pageSize).toBe(100);
    expect(loadRunHistory(pluginDb, 1, 0).pageSize).toBe(1);
    expect(loadRunHistory(pluginDb, 1, -10).pageSize).toBe(1);
  });
});

describe('renderRunHistory (#241 split #3)', () => {
  it('renders an empty-state card when no runs exist', async () => {
    const { renderRunHistory, loadRunHistory } = await import('./web-templates.js');
    const html = renderRunHistory(loadRunHistory(pluginDb));
    expect(html).toContain('No runs yet');
  });

  it('renders rows with status badges, duration, and PR link', async () => {
    const { renderRunHistory } = await import('./web-templates.js');
    const html = renderRunHistory({
      total: 1, page: 1, pageSize: 20,
      runs: [{
        id: 1, issueNumber: 7, repo: 'org/r', status: 'success',
        startedAt: 1000, finishedAt: 5000, prUrl: 'https://example/pr/1',
        progressPct: 100, tasksTotal: null, tasksCompleted: null, error: null,
      }],
    });
    expect(html).toContain('agentbox-badge-success');
    expect(html).toContain('https://example/pr/1');
    expect(html).toContain('#1');
    expect(html).toContain('org/r#7');
  });

  it('renders pagination links when there are multiple pages', async () => {
    const { renderRunHistory } = await import('./web-templates.js');
    const html = renderRunHistory({ total: 50, page: 2, pageSize: 20, runs: [] });
    expect(html).toContain('Page 2 of 3');
    expect(html).toContain('href="/p/agentbox/runs?page=1"');
    expect(html).toContain('href="/p/agentbox/runs?page=3"');
  });

  it('honors a custom basePath for pagination links', async () => {
    const { renderRunHistory } = await import('./web-templates.js');
    const html = renderRunHistory(
      { total: 50, page: 2, pageSize: 20, runs: [] },
      '/custom/path',
    );
    expect(html).toContain('href="/custom/path?page=1"');
    expect(html).toContain('href="/custom/path?page=3"');
  });

  it('marks Prev as disabled on page 1 and Next as disabled on the last page', async () => {
    const { renderRunHistory } = await import('./web-templates.js');
    const firstPage = renderRunHistory({ total: 50, page: 1, pageSize: 20, runs: [] });
    expect(firstPage).toMatch(/agentbox-pagelink-disabled[^>]*>← Prev/);
    const lastPage = renderRunHistory({ total: 50, page: 3, pageSize: 20, runs: [] });
    expect(lastPage).toMatch(/agentbox-pagelink-disabled[^>]*>Next →/);
  });

  it('omits pagination entirely when total fits in one page', async () => {
    const { renderRunHistory } = await import('./web-templates.js');
    const html = renderRunHistory({
      total: 5, page: 1, pageSize: 20,
      runs: [{
        id: 1, issueNumber: 1, repo: 'org/r', status: 'success',
        startedAt: 1000, finishedAt: 2000, prUrl: null,
        progressPct: 100, tasksTotal: null, tasksCompleted: null, error: null,
      }],
    });
    expect(html).not.toContain('agentbox-pagination');
  });

  it('sanitizes hostile prUrl scheme', async () => {
    const { renderRunHistory } = await import('./web-templates.js');
    const html = renderRunHistory({
      total: 1, page: 1, pageSize: 20,
      runs: [{
        id: 1, issueNumber: 1, repo: 'org/r', status: 'success',
        startedAt: 1000, finishedAt: 2000, prUrl: 'javascript:alert(1)',
        progressPct: 100, tasksTotal: null, tasksCompleted: null, error: null,
      }],
    });
    expect(html).not.toMatch(/href="javascript:/i);
  });

  it('escapes hostile repo name', async () => {
    const { renderRunHistory } = await import('./web-templates.js');
    const html = renderRunHistory({
      total: 1, page: 1, pageSize: 20,
      runs: [{
        id: 1, issueNumber: 1, repo: '<script>x</script>', status: 'success',
        startedAt: 1000, finishedAt: 2000, prUrl: null,
        progressPct: 100, tasksTotal: null, tasksCompleted: null, error: null,
      }],
    });
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

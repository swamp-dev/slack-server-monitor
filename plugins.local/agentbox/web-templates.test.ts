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

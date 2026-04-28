/**
 * AgentBox Workflows web UI — template functions (#241 / T11).
 *
 * First-cut split: just the dashboard page (status banner + stats
 * cards + active run + recent completions). Queue page, run history,
 * run detail, and SSE wiring land in follow-up PRs.
 */
import type { PluginDatabase } from '../../src/services/plugin-database.js';
import { escapeHtml, sanitizeUrl } from '../../src/web/plugin-helpers.js';

/**
 * Numbers feeding the dashboard's stat cards. Pure DTO so callers
 * (web.ts handler, tests, screenshot fixtures) can build it without
 * touching the DB.
 */
export interface DashboardStats {
  /** Total runs in the runs table. */
  totalRuns: number;
  /** Currently running. Always 0 or 1 in practice given the executor lock. */
  activeRuns: number;
  /** Successes ever. */
  successCount: number;
  /** Failures ever. */
  failedCount: number;
  /** Cancelled ever. */
  cancelledCount: number;
}

export interface RunRow {
  id: number;
  issueNumber: number;
  repo: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'cancelled';
  startedAt: number | null;
  finishedAt: number | null;
  prUrl: string | null;
  progressPct: number | null;
  tasksTotal: number | null;
  tasksCompleted: number | null;
  error: string | null;
}

export interface DashboardData {
  stats: DashboardStats;
  /** The single in-flight run, if any. */
  activeRun: RunRow | null;
  /** Most recent completed runs (success/failed/cancelled). Limit 5. */
  recentRuns: RunRow[];
}

/** Read all dashboard data from the runs table in one prep'd shot. */
export function loadDashboardData(db: PluginDatabase): DashboardData {
  const stats: DashboardStats = {
    totalRuns: countAll(db),
    activeRuns: countByStatus(db, 'running'),
    successCount: countByStatus(db, 'success'),
    failedCount: countByStatus(db, 'failed'),
    cancelledCount: countByStatus(db, 'cancelled'),
  };

  const activeRow = db
    .prepare(
      `SELECT id, issue_number, repo, status, started_at, finished_at, pr_url, progress_pct,
              tasks_total, tasks_completed, error
       FROM ${db.prefix}runs WHERE status = 'running' ORDER BY id DESC LIMIT 1`,
    )
    .get() as Record<string, unknown> | undefined;
  const activeRun = activeRow ? mapRow(activeRow) : null;

  const recentRows = db
    .prepare(
      `SELECT id, issue_number, repo, status, started_at, finished_at, pr_url, progress_pct,
              tasks_total, tasks_completed, error
       FROM ${db.prefix}runs WHERE status IN ('success', 'failed', 'cancelled')
       ORDER BY id DESC LIMIT 5`,
    )
    .all() as Array<Record<string, unknown>>;
  const recentRuns = recentRows.map(mapRow);

  return { stats, activeRun, recentRuns };
}

function countAll(db: PluginDatabase): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${db.prefix}runs`).get() as { n: number };
  return Number(row.n);
}

/**
 * Count rows by exact status value. The `status` argument is taken
 * as a parameter (?) rather than concatenated, so callers can't
 * inject SQL via a future query-string-driven dashboard filter.
 */
function countByStatus(db: PluginDatabase, status: 'pending' | 'running' | 'success' | 'failed' | 'cancelled'): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${db.prefix}runs WHERE status = ?`).get(status) as { n: number };
  return Number(row.n);
}

function mapRow(row: Record<string, unknown>): RunRow {
  return {
    id: row.id as number,
    issueNumber: row.issue_number as number,
    repo: row.repo as string,
    status: row.status as RunRow['status'],
    startedAt: (row.started_at as number) ?? null,
    finishedAt: (row.finished_at as number) ?? null,
    prUrl: (row.pr_url as string) ?? null,
    progressPct: (row.progress_pct as number) ?? null,
    tasksTotal: (row.tasks_total as number) ?? null,
    tasksCompleted: (row.tasks_completed as number) ?? null,
    error: (row.error as string) ?? null,
  };
}

// ─── Renderers ──────────────────────────────────────────────────────

/**
 * Tab/pill navigation between the Workflows pages. Caller passes the
 * id of the page currently being rendered so it can be highlighted.
 */
export function renderNavPills(active: 'dashboard' | 'queue' | 'runs'): string {
  const pages = [
    { href: '/p/agentbox/', label: 'Dashboard', id: 'dashboard' as const },
    { href: '/p/agentbox/queue', label: 'Queue', id: 'queue' as const },
    { href: '/p/agentbox/runs', label: 'Runs', id: 'runs' as const },
  ];
  return `<nav class="agentbox-nav">${pages
    .map((p) => `<a href="${p.href}" class="agentbox-pill${active === p.id ? ' active' : ''}">${escapeHtml(p.label)}</a>`)
    .join('')}</nav>`;
}

export function renderDashboard(data: DashboardData): string {
  return [
    renderNavPills('dashboard'),
    renderStatusBanner(data),
    renderStatsCards(data.stats),
    renderActiveRun(data.activeRun),
    renderRecentRuns(data.recentRuns),
  ].join('\n');
}

/**
 * GitHub issue summary — same shape as `ReadyIssue` from scheduler.ts
 * but redeclared locally so this template module doesn't depend on
 * the scheduler.
 */
export interface QueueIssue {
  number: number;
  title: string;
  labels: { name: string }[];
  createdAt: string;
  url?: string;
}

export function renderQueue(issues: QueueIssue[], repo: string): string {
  const nav = renderNavPills('queue');
  if (issues.length === 0) {
    return `${nav}
<div class="agentbox-card">
  <h2>Ready Queue</h2>
  <p class="agentbox-muted">No <code>agentbox-ready</code> issues waiting in <strong>${escapeHtml(repo)}</strong>.</p>
</div>`;
  }
  const sorted = sortQueueIssues(issues);
  const rows = sorted
    .map((iss) => {
      const priority = iss.labels.find((l) => l.name.startsWith('priority:'))?.name ?? '';
      const otherLabels = iss.labels
        .filter((l) => !l.name.startsWith('priority:') && l.name !== 'agentbox-ready')
        .map((l) => l.name);
      const githubUrl = iss.url ? sanitizeUrl(iss.url) : null;
      const issueLink = githubUrl
        ? `<a href="${escapeHtml(githubUrl)}">#${String(iss.number)}</a>`
        : `#${String(iss.number)}`;
      const labelHtml = [priority, ...otherLabels]
        .filter(Boolean)
        .map((l) => `<span class="agentbox-label">${escapeHtml(l)}</span>`)
        .join(' ');
      const created = new Date(iss.createdAt).getTime();
      const age = Number.isFinite(created) ? formatRelative(created) : 'unknown';
      return `<tr>
        <td>${issueLink}</td>
        <td>${escapeHtml(iss.title)}</td>
        <td>${labelHtml}</td>
        <td>${escapeHtml(age)}</td>
      </tr>`;
    })
    .join('');
  return `${nav}
<div class="agentbox-card">
  <h2>Ready Queue (${String(sorted.length)})</h2>
  <p class="agentbox-muted">Issues labelled <code>agentbox-ready</code> in <strong>${escapeHtml(repo)}</strong>, ordered by priority then age.</p>
  <table class="agentbox-runs-table">
    <thead><tr><th>Issue</th><th>Title</th><th>Labels</th><th>Age</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>`;
}

/**
 * Order: priority:high first, then oldest createdAt. Mirrors the
 * scheduler's pickEligibleIssue() so what users see in the queue
 * matches what the scheduler picks next.
 */
export function sortQueueIssues<T extends QueueIssue>(issues: T[]): T[] {
  return [...issues].sort((a, b) => {
    const aHigh = a.labels.some((l) => l.name === 'priority:high');
    const bHigh = b.labels.some((l) => l.name === 'priority:high');
    if (aHigh && !bHigh) return -1;
    if (!aHigh && bHigh) return 1;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

function renderStatusBanner(data: DashboardData): string {
  const cls = data.activeRun ? 'banner-running' : 'banner-idle';
  const msg = data.activeRun
    ? `Run #${String(data.activeRun.id)} in flight for ${escapeHtml(data.activeRun.repo)}#${String(data.activeRun.issueNumber)}`
    : 'No active run';
  return `<div class="agentbox-banner ${cls}"><strong>AgentBox:</strong> ${msg}</div>`;
}

function renderStatsCards(stats: DashboardStats): string {
  const cards = [
    { label: 'Total runs', value: stats.totalRuns },
    { label: 'Active', value: stats.activeRuns },
    { label: 'Success', value: stats.successCount },
    { label: 'Failed', value: stats.failedCount },
    { label: 'Cancelled', value: stats.cancelledCount },
  ]
    .map((c) => `<div class="agentbox-stat"><div class="agentbox-stat-label">${escapeHtml(c.label)}</div><div class="agentbox-stat-value">${String(c.value)}</div></div>`)
    .join('');
  return `<div class="agentbox-stats">${cards}</div>`;
}

function renderActiveRun(active: RunRow | null): string {
  if (!active) {
    return `<div class="agentbox-card"><h2>Active Run</h2><p class="agentbox-muted">Idle — no run currently executing.</p></div>`;
  }
  // Clamp to [0, 100] so a future schema bug (or a non-integer DB
  // value coerced to NaN) can't inject arbitrary CSS via the
  // inline style attribute.
  const rawProgress = active.progressPct ?? 0;
  const progress = Math.min(100, Math.max(0, Number.isFinite(rawProgress) ? rawProgress : 0));
  const taskLine = active.tasksTotal != null && active.tasksCompleted != null
    ? `<p>Tasks: ${String(active.tasksCompleted)}/${String(active.tasksTotal)}</p>`
    : '';
  const startedAgo = active.startedAt ? formatRelative(active.startedAt) : '—';
  return `<div class="agentbox-card">
    <h2>Active Run</h2>
    <p><strong>${escapeHtml(active.repo)}#${String(active.issueNumber)}</strong> — run #${String(active.id)}</p>
    <p class="agentbox-muted">Started ${escapeHtml(startedAgo)}</p>
    <div class="agentbox-progress"><div class="agentbox-progress-fill" style="width: ${String(progress)}%"></div></div>
    <p class="agentbox-muted">${String(progress)}% complete</p>
    ${taskLine}
  </div>`;
}

function renderRecentRuns(recent: RunRow[]): string {
  if (recent.length === 0) {
    return `<div class="agentbox-card"><h2>Recent Completions</h2><p class="agentbox-muted">No completed runs yet.</p></div>`;
  }
  const rows = recent
    .map((r) => {
      const dur = r.startedAt && r.finishedAt ? formatDurationMs(r.finishedAt - r.startedAt) : '—';
      // sanitizeUrl guards against javascript:/data: schemes if a PR
      // url ever ends up coming from somewhere less trusted than gh.
      const safePrUrl = r.prUrl ? sanitizeUrl(r.prUrl) : null;
      const prCell = safePrUrl ? `<a href="${escapeHtml(safePrUrl)}">PR</a>` : '—';
      return `<tr class="agentbox-row-${escapeHtml(r.status)}">
        <td>#${String(r.id)}</td>
        <td>${escapeHtml(r.repo)}#${String(r.issueNumber)}</td>
        <td><span class="agentbox-badge agentbox-badge-${escapeHtml(r.status)}">${escapeHtml(r.status)}</span></td>
        <td>${escapeHtml(dur)}</td>
        <td>${prCell}</td>
      </tr>`;
    })
    .join('');
  return `<div class="agentbox-card">
    <h2>Recent Completions</h2>
    <table class="agentbox-runs-table">
      <thead><tr><th>Run</th><th>Issue</th><th>Status</th><th>Duration</th><th>PR</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

// ─── Formatting helpers ────────────────────────────────────────────

export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${String(ms)}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${String(s)}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${String(m)}m ${String(s % 60)}s`;
  const h = Math.floor(m / 60);
  return `${String(h)}h ${String(m % 60)}m`;
}

export function formatRelative(timestamp: number, now: number = Date.now()): string {
  const delta = Math.max(0, now - timestamp);
  if (delta < 60_000) return `${String(Math.floor(delta / 1000))}s ago`;
  if (delta < 3_600_000) return `${String(Math.floor(delta / 60_000))}m ago`;
  if (delta < 86_400_000) return `${String(Math.floor(delta / 3_600_000))}h ago`;
  return `${String(Math.floor(delta / 86_400_000))}d ago`;
}

// ─── Page-level CSS ─────────────────────────────────────────────────

export const DASHBOARD_CSS = `
.agentbox-nav {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
  flex-wrap: wrap;
}
.agentbox-pill {
  padding: 6px 14px;
  border-radius: 999px;
  border: 1px solid var(--border, #444);
  text-decoration: none;
  color: var(--text, #fff);
  font-size: 0.875rem;
  background: var(--card-bg, #2a2a2a);
}
.agentbox-pill.active {
  background: var(--accent, #bd93f9);
  color: #fff;
  border-color: transparent;
}
.agentbox-pill:hover { border-color: var(--accent, #bd93f9); }
.agentbox-label {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.75rem;
  background: var(--surface, #1e1e1e);
  border: 1px solid var(--border, #444);
  color: var(--text-muted, #888);
  margin-right: 4px;
}
.agentbox-banner {
  padding: 12px 16px;
  border-radius: 8px;
  margin-bottom: 16px;
  border: 1px solid var(--border, #444);
}
.agentbox-banner.banner-idle { background: var(--card-bg, #2a2a2a); }
.agentbox-banner.banner-running {
  background: linear-gradient(90deg, var(--accent, #bd93f9) 0%, transparent 100%);
  background-size: 200% 100%;
  animation: agentbox-banner-shimmer 3s ease-in-out infinite;
}
@keyframes agentbox-banner-shimmer {
  0%, 100% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
}
.agentbox-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}
.agentbox-stat {
  background: var(--card-bg, #2a2a2a);
  border: 1px solid var(--border, #444);
  border-radius: 8px;
  padding: 12px;
  text-align: center;
}
.agentbox-stat-label { font-size: 0.75rem; color: var(--text-muted, #888); text-transform: uppercase; letter-spacing: 0.5px; }
.agentbox-stat-value { font-size: 1.75rem; font-weight: 600; margin-top: 4px; }
.agentbox-card {
  background: var(--card-bg, #2a2a2a);
  border: 1px solid var(--border, #444);
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
}
.agentbox-card h2 { font-size: 1.125rem; margin: 0 0 12px; }
.agentbox-muted { color: var(--text-muted, #888); font-size: 0.875rem; }
.agentbox-progress { height: 6px; background: var(--surface, #1e1e1e); border-radius: 3px; overflow: hidden; margin: 8px 0; }
.agentbox-progress-fill { height: 100%; background: var(--accent, #bd93f9); transition: width 0.3s ease; }
.agentbox-runs-table { width: 100%; border-collapse: collapse; }
.agentbox-runs-table th, .agentbox-runs-table td { padding: 8px 12px; text-align: left; border-bottom: 1px solid var(--border, #444); }
.agentbox-runs-table th { font-size: 0.75rem; text-transform: uppercase; color: var(--text-muted, #888); }
.agentbox-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 0.75rem;
  text-transform: uppercase;
  font-weight: 600;
}
.agentbox-badge-success { background: rgba(80, 250, 123, 0.2); color: var(--green, #50fa7b); }
.agentbox-badge-failed { background: rgba(255, 85, 85, 0.2); color: var(--red, #ff5555); }
.agentbox-badge-cancelled { background: rgba(255, 184, 108, 0.2); color: var(--orange, #ffb86c); }
.agentbox-badge-running { background: rgba(189, 147, 249, 0.2); color: var(--accent, #bd93f9); }
.agentbox-badge-pending { background: rgba(98, 114, 164, 0.2); color: var(--text-muted, #6272a4); }
`;

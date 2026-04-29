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
  status: 'pending' | 'running' | 'paused' | 'success' | 'failed' | 'cancelled';
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
function countByStatus(db: PluginDatabase, status: 'pending' | 'running' | 'paused' | 'success' | 'failed' | 'cancelled'): number {
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

// ─── Run history page (split #3) ───────────────────────────────────

export interface RunHistoryData {
  /** Rows for the current page (newest first). */
  runs: RunRow[];
  /** Total rows in the runs table — used to compute pagination. */
  total: number;
  /** Current page (1-based). */
  page: number;
  /** Rows per page. */
  pageSize: number;
}

export const RUNS_PAGE_SIZE_DEFAULT = 20;

/**
 * Read a paginated slice of the runs table, newest first. The page
 * argument is 1-based; out-of-range values are clamped to 1..lastPage.
 */
export function loadRunHistory(
  db: PluginDatabase,
  page: number = 1,
  pageSize: number = RUNS_PAGE_SIZE_DEFAULT,
): RunHistoryData {
  const totalRow = db.prepare(`SELECT COUNT(*) AS n FROM ${db.prefix}runs`).get() as { n: number };
  const total = Number(totalRow.n);
  const safePageSize = Math.max(1, Math.min(100, Math.floor(pageSize)));
  const lastPage = Math.max(1, Math.ceil(total / safePageSize));
  const safePage = Math.max(1, Math.min(lastPage, Math.floor(page)));
  const offset = (safePage - 1) * safePageSize;

  const rows = db
    .prepare(
      `SELECT id, issue_number, repo, status, started_at, finished_at, pr_url, progress_pct,
              tasks_total, tasks_completed, error
       FROM ${db.prefix}runs ORDER BY id DESC LIMIT ? OFFSET ?`,
    )
    .all(safePageSize, offset) as Array<Record<string, unknown>>;

  return { runs: rows.map(mapRow), total, page: safePage, pageSize: safePageSize };
}

export function renderRunHistory(data: RunHistoryData, basePath: string = '/p/agentbox/runs'): string {
  const nav = renderNavPills('runs');
  if (data.total === 0) {
    return `${nav}
<div class="agentbox-card">
  <h2>Run History</h2>
  <p class="agentbox-muted">No runs yet. The history table populates as agentbox processes issues.</p>
</div>`;
  }
  const rows = data.runs
    .map((r) => {
      const dur = r.startedAt && r.finishedAt ? formatDurationMs(r.finishedAt - r.startedAt) : '—';
      const safePrUrl = r.prUrl ? sanitizeUrl(r.prUrl) : null;
      const prCell = safePrUrl ? `<a href="${escapeHtml(safePrUrl)}">PR</a>` : '—';
      const startedCell = r.startedAt ? formatRelative(r.startedAt) : '—';
      return `<tr>
        <td>#${String(r.id)}</td>
        <td>${escapeHtml(r.repo)}#${String(r.issueNumber)}</td>
        <td><span class="agentbox-badge agentbox-badge-${escapeHtml(r.status)}">${escapeHtml(r.status)}</span></td>
        <td>${escapeHtml(dur)}</td>
        <td>${escapeHtml(startedCell)}</td>
        <td>${prCell}</td>
      </tr>`;
    })
    .join('');
  const pagination = renderPagination(data, basePath);
  return `${nav}
<div class="agentbox-card">
  <h2>Run History</h2>
  <p class="agentbox-muted">${String(data.total)} total run${data.total === 1 ? '' : 's'}.</p>
  <table class="agentbox-runs-table">
    <thead><tr><th>Run</th><th>Issue</th><th>Status</th><th>Duration</th><th>Started</th><th>PR</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  ${pagination}
</div>`;
}

function renderPagination(data: RunHistoryData, basePath: string): string {
  const lastPage = Math.max(1, Math.ceil(data.total / data.pageSize));
  if (lastPage <= 1) return '';
  const prev = data.page > 1 ? data.page - 1 : null;
  const next = data.page < lastPage ? data.page + 1 : null;
  const prevHtml = prev !== null
    ? `<a class="agentbox-pagelink" href="${basePath}?page=${String(prev)}">← Prev</a>`
    : `<span class="agentbox-pagelink agentbox-pagelink-disabled">← Prev</span>`;
  const nextHtml = next !== null
    ? `<a class="agentbox-pagelink" href="${basePath}?page=${String(next)}">Next →</a>`
    : `<span class="agentbox-pagelink agentbox-pagelink-disabled">Next →</span>`;
  return `<div class="agentbox-pagination">
  ${prevHtml}
  <span class="agentbox-page-indicator">Page ${String(data.page)} of ${String(lastPage)}</span>
  ${nextHtml}
</div>`;
}

/**
 * Parse a `?page=` query param into a positive integer. Returns 1
 * for missing / non-numeric / out-of-range input. Defensive against
 * arrays (Express can hand back string[]).
 */
export function parsePageParam(raw: unknown): number {
  if (typeof raw !== 'string') return 1;
  const n = parseInt(raw, 10);
  return Number.isInteger(n) && n >= 1 ? n : 1;
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
    ${renderCancelControls(active)}
  </div>`;
}

/**
 * Run controls: cancel + pause for in-flight runs, resume for paused
 * runs. Each form posts to /p/agentbox/runs/:id/{cancel,pause,resume}
 * and uses inline `onsubmit="return confirm(...)"` so confirmation
 * dialogs appear even with no plugin client JS.
 *
 * Returns empty for terminal runs (success/failed/cancelled) — no
 * actions are available once a run has finished.
 */
export function renderCancelControls(run: RunRow | { id: number; status: string }): string {
  if (run.status === 'paused') {
    return `<div class="agentbox-controls">
    <form method="post" action="/p/agentbox/runs/${String(run.id)}/resume"
          onsubmit="return confirm('Resume run #${String(run.id)}? agentbox sprint --resume will pick up the saved session.');"
          style="display:inline">
      <button type="submit" class="agentbox-btn agentbox-btn-primary">Resume</button>
    </form>
    <form method="post" action="/p/agentbox/runs/${String(run.id)}/cancel"
          onsubmit="return confirm('Cancel run #${String(run.id)}? This will terminate the saved session — it cannot be resumed afterwards.');"
          style="display:inline">
      <button type="submit" class="agentbox-btn agentbox-btn-danger">Cancel</button>
    </form>
  </div>`;
  }
  if (run.status !== 'running' && run.status !== 'pending') return '';
  return `<div class="agentbox-controls">
    <form method="post" action="/p/agentbox/runs/${String(run.id)}/cancel"
          onsubmit="return confirm('Cancel run #${String(run.id)}? The agentbox process will be terminated.');"
          style="display:inline">
      <button type="submit" class="agentbox-btn agentbox-btn-danger">Cancel</button>
    </form>
    <form method="post" action="/p/agentbox/runs/${String(run.id)}/pause"
          onsubmit="return confirm('Pause run #${String(run.id)}? agentbox checkpoints the session — you can resume it later.');"
          style="display:inline">
      <button type="submit" class="agentbox-btn">Pause</button>
    </form>
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
.agentbox-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--border, #444);
  font-size: 0.875rem;
}
.agentbox-pagelink {
  padding: 6px 12px;
  border-radius: 6px;
  text-decoration: none;
  color: var(--text, #fff);
  border: 1px solid var(--border, #444);
}
.agentbox-pagelink:hover { border-color: var(--accent, #bd93f9); }
.agentbox-pagelink-disabled { opacity: 0.4; cursor: not-allowed; }
.agentbox-page-indicator { color: var(--text-muted, #888); }
.agentbox-detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
  margin: 12px 0;
}
.agentbox-detail-cell {
  background: var(--surface, #1e1e1e);
  border: 1px solid var(--border, #444);
  border-radius: 6px;
  padding: 10px 12px;
}
.agentbox-detail-cell-label {
  font-size: 0.75rem;
  color: var(--text-muted, #888);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.agentbox-detail-cell-value { font-size: 0.95rem; margin-top: 2px; word-wrap: break-word; }
.agentbox-finding {
  border-left: 3px solid var(--border, #444);
  padding: 8px 12px;
  margin: 8px 0;
  background: var(--surface, #1e1e1e);
}
.agentbox-finding-critical { border-left-color: var(--red, #ff5555); }
.agentbox-finding-significant { border-left-color: var(--orange, #ffb86c); }
.agentbox-finding-minor { border-left-color: var(--text-muted, #6272a4); }
.agentbox-finding-title { font-weight: 600; margin-bottom: 4px; }
.agentbox-finding-body { font-size: 0.875rem; white-space: pre-wrap; color: var(--text-muted, #aaa); }
.agentbox-controls {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.75rem;
  flex-wrap: wrap;
}
.agentbox-btn {
  appearance: none;
  border: 1px solid var(--border, #444);
  background: var(--surface, #1e1e1e);
  color: var(--text, #f8f8f2);
  padding: 6px 14px;
  font-size: 0.875rem;
  border-radius: 4px;
  cursor: pointer;
  font-family: inherit;
}
.agentbox-btn:hover { border-color: var(--accent, #bd93f9); }
.agentbox-btn-danger { color: var(--red, #ff5555); border-color: var(--red, #ff5555); }
.agentbox-btn-danger:hover { background: var(--red, #ff5555); color: var(--bg, #1e1e1e); }
.agentbox-btn-disabled { opacity: 0.4; cursor: not-allowed; }
.agentbox-btn-disabled:hover { border-color: var(--border, #444); background: var(--surface, #1e1e1e); }
.agentbox-btn-primary { color: var(--green, #50fa7b); border-color: var(--green, #50fa7b); }
.agentbox-btn-primary:hover { background: var(--green, #50fa7b); color: var(--bg, #1e1e1e); }
.agentbox-badge-paused { background: var(--orange, #ffb86c); color: var(--bg, #1e1e1e); }
.agentbox-row-paused { opacity: 0.85; }
.agentbox-toasts {
  position: fixed;
  right: 1rem;
  bottom: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  z-index: 1000;
  pointer-events: none;
}
.agentbox-toast {
  background: var(--surface, #1e1e1e);
  border: 1px solid var(--border, #444);
  border-left-width: 3px;
  border-radius: 4px;
  padding: 10px 14px;
  font-size: 0.875rem;
  color: var(--text, #f8f8f2);
  box-shadow: 0 4px 12px rgba(0,0,0,0.25);
  opacity: 1;
  transition: opacity 0.4s ease, transform 0.4s ease;
  pointer-events: auto;
}
.agentbox-toast-success { border-left-color: var(--green, #50fa7b); }
.agentbox-toast-failed { border-left-color: var(--red, #ff5555); }
.agentbox-toast-cancelled { border-left-color: var(--orange, #ffb86c); }
.agentbox-toast-leaving { opacity: 0; transform: translateY(8px); }
.agentbox-error-banner {
  background: rgba(255, 85, 85, 0.1);
  border: 1px solid var(--red, #ff5555);
  border-radius: 6px;
  padding: 12px;
  margin: 12px 0;
  white-space: pre-wrap;
  font-family: 'SF Mono', monospace;
  font-size: 0.875rem;
}
`;

// ─── Run detail page (split #4) ────────────────────────────────────

export interface ReviewFindingRow {
  id: number;
  severity: 'critical' | 'significant' | 'minor';
  title: string;
  body: string;
  createdAt: number;
}

export interface RunDetailData {
  run: RunRow;
  /** Findings from the agentbox_reviews table joined on run_id. */
  findings: ReviewFindingRow[];
}

/**
 * Read the run row + any associated review findings. Returns null
 * if no run with that id exists.
 *
 * The agentbox_reviews table is created lazily by runReview in
 * review.ts. If no review has ever run, the table won't exist;
 * we silently treat that as zero findings rather than erroring.
 */
export function loadRunDetail(db: PluginDatabase, runId: number): RunDetailData | null {
  const row = db
    .prepare(
      `SELECT id, issue_number, repo, status, started_at, finished_at, pr_url, progress_pct,
              tasks_total, tasks_completed, error
       FROM ${db.prefix}runs WHERE id = ?`,
    )
    .get(runId) as Record<string, unknown> | undefined;
  if (!row) return null;
  const run = mapRow(row);

  const findings = readFindingsIfTableExists(db, runId);
  return { run, findings };
}

function readFindingsIfTableExists(db: PluginDatabase, runId: number): ReviewFindingRow[] {
  const tableName = `${db.prefix}reviews`;
  const tableExists = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1`)
    .get(tableName);
  if (!tableExists) return [];
  const rows = db
    .prepare(
      `SELECT id, severity, title, body, created_at
       FROM ${tableName} WHERE run_id = ? ORDER BY id ASC`,
    )
    .all(runId) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: r.id as number,
    severity: r.severity as ReviewFindingRow['severity'],
    title: r.title as string,
    body: r.body as string,
    createdAt: r.created_at as number,
  }));
}

export function renderRunDetail(detail: RunDetailData): string {
  const nav = renderNavPills('runs');
  const { run, findings } = detail;
  const dur = run.startedAt && run.finishedAt ? formatDurationMs(run.finishedAt - run.startedAt) : '—';
  const startedAgo = run.startedAt ? formatRelative(run.startedAt) : '—';
  const finishedAgo = run.finishedAt ? formatRelative(run.finishedAt) : '—';
  const safePrUrl = run.prUrl ? sanitizeUrl(run.prUrl) : null;

  // Build a GitHub issue link if the repo string matches owner/repo
  // shape. Defensive — repo is from the DB but better to validate
  // before constructing a URL we'll hand to the user.
  const issueLinkHtml = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(run.repo)
    ? `<a href="${escapeHtml(sanitizeUrl(`https://github.com/${run.repo}/issues/${String(run.issueNumber)}`))}">${escapeHtml(run.repo)}#${String(run.issueNumber)}</a>`
    : `${escapeHtml(run.repo)}#${String(run.issueNumber)}`;

  const summaryGrid = `<div class="agentbox-detail-grid">
    <div class="agentbox-detail-cell"><div class="agentbox-detail-cell-label">Issue</div><div class="agentbox-detail-cell-value">${issueLinkHtml}</div></div>
    <div class="agentbox-detail-cell"><div class="agentbox-detail-cell-label">Status</div><div class="agentbox-detail-cell-value"><span class="agentbox-badge agentbox-badge-${escapeHtml(run.status)}">${escapeHtml(run.status)}</span></div></div>
    <div class="agentbox-detail-cell"><div class="agentbox-detail-cell-label">Duration</div><div class="agentbox-detail-cell-value">${escapeHtml(dur)}</div></div>
    <div class="agentbox-detail-cell"><div class="agentbox-detail-cell-label">Started</div><div class="agentbox-detail-cell-value">${escapeHtml(startedAgo)}</div></div>
    <div class="agentbox-detail-cell"><div class="agentbox-detail-cell-label">Finished</div><div class="agentbox-detail-cell-value">${escapeHtml(finishedAgo)}</div></div>
    <div class="agentbox-detail-cell"><div class="agentbox-detail-cell-label">PR</div><div class="agentbox-detail-cell-value">${safePrUrl ? `<a href="${escapeHtml(safePrUrl)}">${escapeHtml(safePrUrl)}</a>` : '—'}</div></div>
  </div>`;

  // Progress + tasks. Clamp progressPct to [0,100] same as the
  // dashboard's active-run card.
  const rawProgress = run.progressPct ?? 0;
  const progress = Math.min(100, Math.max(0, Number.isFinite(rawProgress) ? rawProgress : 0));
  const tasksLine = run.tasksTotal != null && run.tasksCompleted != null
    ? `<p class="agentbox-muted">Tasks: ${String(run.tasksCompleted)} / ${String(run.tasksTotal)} complete</p>`
    : '<p class="agentbox-muted">Task counts not reported by the run.</p>';
  const progressCard = `<div class="agentbox-card">
    <h2>Progress</h2>
    <div class="agentbox-progress"><div class="agentbox-progress-fill" style="width: ${String(progress)}%"></div></div>
    <p class="agentbox-muted">${String(progress)}% complete</p>
    ${tasksLine}
  </div>`;

  // Journal timeline placeholder. SSE plumbing landed in split #5;
  // streaming journal entries themselves are T12 split 2 work. The
  // card stays so the layout is stable.
  const journalCard = `<div class="agentbox-card">
    <h2>Journal Timeline</h2>
    <p class="agentbox-muted">Live journal entries (confidence / difficulty / momentum) will stream here once journal events are wired to the SSE channel.</p>
  </div>`;

  const errorCard = run.error
    ? `<div class="agentbox-card"><h2>Error</h2><div class="agentbox-error-banner">${escapeHtml(run.error)}</div></div>`
    : '';

  const findingsCard = renderReviewFindingsCard(findings);

  // Single source of truth — renderCancelControls returns '' for
  // statuses that have no actions. Wrap the card only when there's
  // real content to render; this avoids a future status being added
  // to renderCancelControls but missed here.
  const controls = renderCancelControls(run);
  const controlsCard = controls
    ? `<div class="agentbox-card"><h2>Controls</h2>${controls}</div>`
    : '';

  return `${nav}
<div class="agentbox-card">
  <h2>Run #${String(run.id)}</h2>
  ${summaryGrid}
</div>
${controlsCard}
${progressCard}
${errorCard}
${findingsCard}
${journalCard}`;
}

function renderReviewFindingsCard(findings: ReviewFindingRow[]): string {
  if (findings.length === 0) {
    return `<div class="agentbox-card">
      <h2>Review Findings</h2>
      <p class="agentbox-muted">No review findings recorded for this run.</p>
    </div>`;
  }
  // Order: critical → significant → minor. Fallback to 99 for any
  // unexpected severity (e.g. corrupted DB row that got past the
  // CHECK constraint), so sorting stays deterministic.
  const order: Record<string, number> = { critical: 0, significant: 1, minor: 2 };
  const sorted = [...findings].sort((a, b) => (order[a.severity] ?? 99) - (order[b.severity] ?? 99));
  const items = sorted
    .map((f) => `<div class="agentbox-finding agentbox-finding-${escapeHtml(f.severity)}">
      <div class="agentbox-finding-title">${escapeHtml(f.severity.toUpperCase())} — ${escapeHtml(f.title)}</div>
      <div class="agentbox-finding-body">${escapeHtml(f.body)}</div>
    </div>`)
    .join('');
  const counts = sorted.reduce<Record<string, number>>((acc, f) => {
    acc[f.severity] = (acc[f.severity] ?? 0) + 1;
    return acc;
  }, {});
  const summary = (['critical', 'significant', 'minor'] as const)
    .filter((s) => (counts[s] ?? 0) > 0)
    .map((s) => `${String(counts[s])} ${s}`)
    .join(' · ');
  return `<div class="agentbox-card">
    <h2>Review Findings</h2>
    <p class="agentbox-muted">${escapeHtml(summary)}</p>
    ${items}
  </div>`;
}

/**
 * Parse a run id from a path parameter. Returns null for missing,
 * non-numeric, or non-positive input. The route handler uses null
 * as the signal to send a 404.
 */
export function parseRunIdParam(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const n = parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

// ─── Home-page widget (split #5) ───────────────────────────────────

/**
 * Compact HTML summary of AgentBox state for the main dashboard's
 * widget grid. The plugin host renders this verbatim — escape any
 * user-derived values (repo names) explicitly here.
 */
export function buildWidgetSummary(data: DashboardData): string {
  const { stats, activeRun } = data;
  // issueNumber is INTEGER from the runs table — safe to interpolate
  // without escaping. repo is operator-supplied free text, so escape.
  const activeLine = activeRun
    ? `<p style="margin: 4px 0; font-size: 0.875rem;">Running: <strong>${escapeHtml(activeRun.repo)}#${String(activeRun.issueNumber)}</strong></p>`
    : '<p style="margin: 4px 0; font-size: 0.875rem; color: var(--text-muted, #888);">Idle</p>';
  return `${activeLine}
<div style="display: flex; gap: 12px; margin-top: 6px; font-size: 0.75rem; color: var(--text-muted, #888);">
  <span>${String(stats.totalRuns)} total</span>
  <span>${String(stats.successCount)} ✓</span>
  <span>${String(stats.failedCount)} ✗</span>
</div>`;
}

// ─── Client-side SSE wiring (split #5) ─────────────────────────────

/**
 * Embedded on the dashboard page. Opens an EventSource to the plugin's
 * SSE channel (auto-mounted at /p/agentbox/stream by the plugin
 * router) and re-renders active-run progress + stat values without
 * a page reload. Auto-reconnects on connection drop with exponential
 * backoff capped at 30s.
 */
export const DASHBOARD_CLIENT_JS = `
<script>
(function() {
  if (typeof EventSource === 'undefined') return;
  var url = '/p/agentbox/stream';
  var backoff = 1000;
  var es = null;

  function applyUpdate(data) {
    try {
      var stats = data && data.stats;
      if (stats) {
        var labels = {
          'Total runs': stats.totalRuns,
          'Active': stats.activeRuns,
          'Success': stats.successCount,
          'Failed': stats.failedCount,
          'Cancelled': stats.cancelledCount,
        };
        document.querySelectorAll('.agentbox-stat').forEach(function(card) {
          var label = card.querySelector('.agentbox-stat-label');
          var value = card.querySelector('.agentbox-stat-value');
          if (!label || !value) return;
          var n = labels[label.textContent.trim()];
          if (typeof n === 'number') value.textContent = String(n);
        });
      }
      var active = data && data.activeRun;
      if (active && typeof active.progressPct === 'number') {
        var fill = document.querySelector('.agentbox-progress-fill');
        if (fill) {
          var pct = Math.min(100, Math.max(0, active.progressPct));
          fill.style.width = pct + '%';
        }
      }
    } catch (e) { /* best-effort UI update */ }
  }

  function showToast(payload) {
    try {
      var status = payload && payload.status;
      var runId = payload && payload.runId;
      var repo = payload && payload.repo;
      var issueNumber = payload && payload.issueNumber;
      if (!status || typeof runId !== 'number') return;
      var container = document.getElementById('agentbox-toasts');
      if (!container) {
        container = document.createElement('div');
        container.id = 'agentbox-toasts';
        container.className = 'agentbox-toasts';
        document.body.appendChild(container);
      }
      var toast = document.createElement('div');
      toast.className = 'agentbox-toast agentbox-toast-' + status;
      toast.setAttribute('role', 'status');
      // textContent is safe — we never inject HTML from the payload.
      var label = repo && typeof issueNumber === 'number'
        ? repo + '#' + issueNumber + ' (run #' + runId + ')'
        : 'Run #' + runId;
      toast.textContent = label + ': ' + status;
      container.appendChild(toast);
      // Auto-dismiss after 6s; CSS transitions the opacity.
      setTimeout(function() { toast.classList.add('agentbox-toast-leaving'); }, 6000);
      setTimeout(function() {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 6500);
    } catch (e) { /* best-effort */ }
  }

  function connect() {
    es = new EventSource(url);
    es.addEventListener('dashboard-update', function(ev) {
      try { applyUpdate(JSON.parse(ev.data)); }
      catch (e) { /* ignore malformed payload */ }
      backoff = 1000;
    });
    es.addEventListener('run-complete', function(ev) {
      try { showToast(JSON.parse(ev.data)); }
      catch (e) { /* ignore malformed payload */ }
      backoff = 1000;
    });
    es.onerror = function() {
      try { es && es.close(); } catch (e) {}
      es = null;
      setTimeout(connect, backoff);
      backoff = Math.min(30000, backoff * 2);
    };
  }

  connect();
})();
</script>`;

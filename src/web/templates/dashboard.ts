/**
 * Dashboard home page template
 */

import type { SessionSummary, SessionStats, TagInfo } from '../../services/conversation-store.js';
import type { DashboardWidget } from '../../plugins/types.js';
import type { QuickLink } from '../../services/quick-links-store.js';
import type { ServerHealth } from '../../services/server-health.js';
import { escapeHtml, sanitizeUrl } from './utils.js';
import { icon } from './icons.js';
import { wrapInShell } from './shell.js';

// ─── Dashboard Home Page ──────────────────────────────────────────────

/**
 * Format a timestamp as relative time (e.g. "2m ago", "1h ago")
 */
function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${String(mins)}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  const days = Math.floor(hours / 24);
  return `${String(days)}d ago`;
}

/**
 * Get a time-of-day greeting
 */
function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

const dashboardStyles = `
  .dashboard-greeting {
    margin-bottom: var(--space-6);
  }
  .dashboard-greeting h1 {
    font-size: var(--text-3xl);
    font-weight: 700;
    letter-spacing: -0.02em;
    margin: 0 0 var(--space-1) 0;
  }
  .dashboard-greeting .subtitle {
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  /* ── Stats row ────────────────────────────────────────────── */
  .stats-row {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-4);
    margin-bottom: var(--space-8);
  }
  .stat-card {
    background: var(--card-bg);
    border-radius: var(--radius-xl);
    padding: var(--space-5);
    border: 1px solid var(--border);
    box-shadow: var(--shadow-sm);
    position: relative;
    overflow: hidden;
    animation: fadeUp 0.3s ease-out both;
  }
  /* Gradient top-edge accent per card */
  .stat-card::before {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 2px;
    background: var(--gradient-primary);
    border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  }
  .stat-card:nth-child(1)::before { background: linear-gradient(90deg, #7c3aed, #4f46e5); }
  .stat-card:nth-child(2)::before { background: linear-gradient(90deg, #4f46e5, #06b6d4); }
  .stat-card:nth-child(3)::before { background: linear-gradient(90deg, #06b6d4, #10b981); }
  .stat-card .stat-value {
    font-size: var(--text-4xl);
    font-weight: 700;
    color: var(--text);
    line-height: 1.1;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.02em;
  }
  .stat-card .stat-label {
    color: var(--text-muted);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.07em;
    margin-top: var(--space-1);
    font-weight: 600;
  }
  .stat-card .stat-detail {
    color: var(--text-muted);
    font-size: var(--text-xs);
    margin-top: var(--space-2);
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .stat-card .stat-detail .active-dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--green);
    box-shadow: 0 0 6px var(--green);
    animation: pulse 1.5s infinite;
  }

  /* ── Bento grid ───────────────────────────────────────────── */
  .dashboard-grid {
    display: grid;
    grid-template-columns: repeat(12, 1fr);
    gap: var(--space-4);
    margin-bottom: var(--space-8);
  }
  .dashboard-section {
    background: var(--card-bg);
    border-radius: var(--radius-xl);
    padding: var(--space-5);
    border: 1px solid var(--border);
    box-shadow: var(--shadow-sm);
    animation: fadeUp 0.3s ease-out both;
  }
  .span-4  { grid-column: span 4; }
  .span-6  { grid-column: span 6; }
  .span-8  { grid-column: span 8; }
  .span-12 { grid-column: span 12; }
  .dashboard-section h2 {
    font-size: var(--text-sm);
    font-weight: 600;
    margin: 0 0 var(--space-4) 0;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  /* ── Tool chart ───────────────────────────────────────────── */
  .tool-chart {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .tool-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .tool-bar {
    height: 8px;
    background: var(--gradient-primary);
    border-radius: var(--radius-full);
    min-width: 4px;
    transition: width 0.4s ease;
  }
  .tool-name {
    font-size: var(--text-xs);
    color: var(--text-muted);
    white-space: nowrap;
    min-width: 120px;
  }
  .tool-count {
    font-size: var(--text-xs);
    color: var(--text-muted);
    margin-left: auto;
    font-variant-numeric: tabular-nums;
  }

  /* ── Recent items ─────────────────────────────────────────── */
  .recent-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .recent-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 12px;
    border-radius: var(--radius-md);
    text-decoration: none;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    transition: border-color 0.15s ease, background 0.15s ease;
    font-size: var(--text-sm);
  }
  .recent-item:hover {
    border-color: rgba(124,58,237,0.4);
    background: rgba(124,58,237,0.04);
    text-decoration: none;
  }
  .recent-item .recent-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 300px;
  }
  .recent-item .recent-time {
    font-size: var(--text-xs);
    color: var(--text-muted);
    white-space: nowrap;
    margin-left: var(--space-2);
  }
  .section-footer {
    margin-top: var(--space-3);
    text-align: right;
  }
  .section-footer a {
    font-size: var(--text-xs);
    color: var(--accent);
    text-decoration: none;
    font-weight: 500;
  }
  .section-footer a:hover { text-decoration: underline; }

  /* ── Quick actions ────────────────────────────────────────── */
  .quick-actions {
    display: flex;
    gap: var(--space-3);
    margin-bottom: var(--space-6);
    flex-wrap: wrap;
  }
  .quick-actions a {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: 9px 18px;
    border-radius: var(--radius-full);
    font-size: var(--text-sm);
    font-weight: 500;
    text-decoration: none;
    border: 1px solid var(--border);
    color: var(--text);
    background: var(--surface-alpha);
    transition: all 0.15s ease;
  }
  .quick-actions a:hover {
    border-color: rgba(124,58,237,0.4);
    background: rgba(124,58,237,0.08);
    text-decoration: none;
  }
  .quick-actions a.primary {
    background: var(--gradient-primary);
    color: #fff;
    border-color: transparent;
    box-shadow: 0 0 0 0 var(--accent-glow);
  }
  .quick-actions a.primary:hover {
    box-shadow: 0 4px 16px var(--accent-glow);
    transform: translateY(-1px);
  }

  /* ── Tag cloud ────────────────────────────────────────────── */
  .tag-cloud {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .tag-cloud a {
    font-size: var(--text-xs);
    padding: 4px 10px;
    border-radius: var(--radius-full);
    background: var(--surface-alpha);
    color: var(--text-muted);
    text-decoration: none;
    border: 1px solid var(--border);
    transition: all 0.15s ease;
    font-weight: 500;
  }
  .tag-cloud a:hover {
    border-color: rgba(124,58,237,0.4);
    color: var(--accent);
    background: rgba(124,58,237,0.08);
  }

  /* ── Widget section ───────────────────────────────────────── */
  .widget-section {
    margin-bottom: var(--space-8);
  }
  .widget-section > h2 {
    font-size: var(--text-sm);
    font-weight: 600;
    margin: 0 0 var(--space-4) 0;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .widget-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: var(--space-4);
  }
  .widget-card {
    background: var(--card-bg);
    border-radius: var(--radius-lg);
    padding: var(--space-4);
    border: 1px solid var(--border);
    box-shadow: var(--shadow-sm);
    animation: fadeUp 0.3s ease-out both;
    transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s;
  }
  .widget-card:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow);
    border-color: rgba(124,58,237,0.2);
  }
  .widget-card .widget-header {
    font-size: var(--text-sm);
    font-weight: 600;
    margin-bottom: var(--space-3);
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .widget-card .widget-header a {
    color: var(--text);
    text-decoration: none;
  }
  .widget-card .widget-header a:hover { color: var(--accent); }
  .widget-card .widget-body { font-size: var(--text-sm); }
  .widget-small { grid-column: span 1; }
  .widget-medium { grid-column: span 1; }
  .widget-large { grid-column: span 2; }
  @media (max-width: 768px) { .widget-large { grid-column: span 1; } }

  /* ── Health section ───────────────────────────────────────── */
  .health-section {
    margin-bottom: var(--space-6);
  }
  .health-section h2 {
    font-size: var(--text-xs);
    margin: 0 0 var(--space-3) 0;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.07em;
    font-weight: 600;
  }
  .health-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: var(--space-3);
  }
  @media (min-width: 641px) and (max-width: 1024px) {
    .health-grid { grid-template-columns: repeat(2, 1fr); }
  }
  .health-card {
    background: var(--card-bg);
    border-radius: var(--radius-lg);
    padding: 14px 16px;
    border: 1px solid var(--border);
    transition: border-color 0.2s;
  }
  .health-card .health-label {
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    margin-bottom: 4px;
    font-weight: 600;
  }
  .health-card .health-value {
    font-size: 1.5rem;
    font-weight: 700;
    line-height: 1.2;
    font-variant-numeric: tabular-nums;
  }
  .health-card .health-detail {
    font-size: var(--text-xs);
    color: var(--text-muted);
    margin-top: 4px;
  }
  .health-bar {
    height: 6px;
    background: var(--border);
    border-radius: var(--radius-full);
    margin-top: var(--space-2);
    overflow: hidden;
  }
  .health-bar-fill {
    height: 100%;
    border-radius: var(--radius-full);
    transition: width 0.5s ease;
  }
  .health-bar-fill.ok    { background: linear-gradient(90deg, #059669, #10b981); }
  .health-bar-fill.warn  { background: linear-gradient(90deg, #b45309, #f59e0b); }
  .health-bar-fill.danger { background: linear-gradient(90deg, #b91c1c, #ef4444); }
  .health-card.severity-warn { border-color: rgba(245,158,11,0.5); }
  .health-card.severity-danger {
    border-color: rgba(239,68,68,0.6);
    animation: glow-pulse 2s ease-in-out infinite;
    --accent-glow: rgba(239,68,68,0.3);
  }
  .health-status-text {
    font-size: var(--text-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-top: 4px;
  }
  .health-status-text.ok    { color: var(--green); }
  .health-status-text.warn  { color: var(--yellow); }
  .health-status-text.danger { color: var(--red); }

  /* ── Greeting health badge ────────────────────────────────── */
  .greeting-health {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: var(--text-xs);
    padding: 4px 12px;
    border-radius: var(--radius-full);
    margin-left: var(--space-3);
    font-weight: 600;
    letter-spacing: 0.03em;
    vertical-align: middle;
  }
  .greeting-health.all-ok  { background: rgba(16,185,129,0.12); color: var(--green); border: 1px solid rgba(16,185,129,0.3); }
  .greeting-health.has-warn { background: rgba(245,158,11,0.12); color: var(--yellow); border: 1px solid rgba(245,158,11,0.3); }
  .greeting-health.has-danger { background: rgba(239,68,68,0.12); color: var(--red); border: 1px solid rgba(239,68,68,0.3); }

  /* ── Quick links ──────────────────────────────────────────── */
  .quick-links-section { margin-bottom: var(--space-6); }
  .quick-links-section h2 {
    font-size: var(--text-xs);
    margin: 0 0 var(--space-2) 0;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.07em;
    font-weight: 600;
  }
  .quick-links-bar { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  .quick-link-card {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: 7px 14px;
    border-radius: var(--radius-full);
    font-size: var(--text-xs);
    font-weight: 500;
    text-decoration: none;
    color: var(--text);
    background: var(--surface-alpha);
    border: 1px solid var(--border);
    transition: all 0.15s ease;
  }
  .quick-link-card:hover {
    border-color: rgba(124,58,237,0.4);
    background: rgba(124,58,237,0.08);
    text-decoration: none;
  }

  /* ── Empty welcome ────────────────────────────────────────── */
  .empty-welcome {
    text-align: center;
    padding: 80px 20px;
  }
  .empty-welcome svg { color: var(--text-muted); margin-bottom: var(--space-4); opacity: 0.4; }
  .empty-welcome h2 { font-size: var(--text-2xl); margin: 0 0 var(--space-2) 0; font-weight: 700; }
  .empty-welcome p { color: var(--text-muted); margin: 0 0 var(--space-6) 0; }

  /* ── Responsive ───────────────────────────────────────────── */
  @media (max-width: 640px) {
    .stats-row { grid-template-columns: 1fr; }
    .dashboard-grid { grid-template-columns: 1fr; }
    .span-4, .span-6, .span-8, .span-12 { grid-column: span 1; }
    .quick-actions { flex-direction: column; }
    .recent-item .recent-title { max-width: 200px; }
  }
  @media (min-width: 641px) and (max-width: 1024px) {
    .dashboard-grid { grid-template-columns: repeat(2, 1fr); }
    .span-4, .span-6 { grid-column: span 1; }
    .span-8, .span-12 { grid-column: span 2; }
  }
  @media (max-width: 414px) {
    .stat-card { padding: var(--space-3); }
    .stat-card .stat-value { font-size: var(--text-2xl); }
    .health-grid { grid-template-columns: 1fr; }
    .widget-grid { grid-template-columns: 1fr; }
    .recent-item { padding: 10px; }
    .recent-item .recent-title { max-width: 160px; }
  }
`;

/**
 * Render the dashboard home page
 */
export function renderDashboard(
  stats: SessionStats,
  recent: SessionSummary[],
  favorites: SessionSummary[],
  favCount: number,
  allTags: TagInfo[],
  _userId: string,
  widgets?: DashboardWidget[],
  unreadCount?: number,
  quickLinks?: QuickLink[],
  health?: ServerHealth | null,
  isAuthenticated = true,
): string {
  const greeting = getGreeting();

  // Empty state: welcome screen for new users
  if (stats.totalSessions === 0 && isAuthenticated) {
    const bodyHtml = `
    <main class="container">
      <div class="empty-welcome">
        ${icon('robot', 64)}
        <h2>Welcome to Server Monitor</h2>
        <p>Start your first conversation from Slack with <code>/ask</code> or from the web</p>
        <div class="quick-actions" style="justify-content: center;">
          <a href="/c/new" class="primary">${icon('plus', 16)} New Conversation</a>
        </div>
      </div>
    </main>`;

    return wrapInShell({
      title: 'Dashboard',
      styles: dashboardStyles,
      body: bodyHtml,
      unreadCount,
      isAuthenticated,
    });
  }

  // Stats cards
  const avgDuration = stats.avgToolDurationMs != null ? `${String(Math.round(stats.avgToolDurationMs))}ms avg` : '';
  const msgsPerSession = stats.totalSessions > 0 ? (stats.totalMessages / stats.totalSessions).toFixed(1) : '0.0';
  const successRate = stats.totalToolCalls > 0 ? Math.min(100, Math.max(0, Math.round((1 - stats.toolFailureRate) * 100))) : 100;
  const successDetail = stats.totalToolCalls > 0 ? `${String(successRate)}% success` : '';
  const statsHtml = `
    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-value" data-count="${String(stats.totalSessions)}">${String(stats.totalSessions)}</div>
        <div class="stat-label">Sessions</div>
        <div class="stat-detail"><span class="active-dot"></span> ${String(stats.activeSessions)} active</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" data-count="${String(stats.totalMessages)}">${String(stats.totalMessages)}</div>
        <div class="stat-label">Messages</div>
        <div class="stat-detail">${msgsPerSession} per session</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" data-count="${String(stats.totalToolCalls)}">${String(stats.totalToolCalls)}</div>
        <div class="stat-label">Tool Calls</div>
        <div class="stat-detail">${[avgDuration, successDetail].filter(Boolean).join(' · ')}</div>
      </div>
    </div>`;

  // Top tools bar chart
  const maxToolCount = stats.topTools.length > 0 ? Math.max(...stats.topTools.map((t) => t.count)) : 1;
  const toolChartHtml = stats.topTools.length > 0
    ? `<div class="dashboard-section span-8">
        <h2>${icon('bar-chart', 14)} Top Tools</h2>
        <div class="tool-chart">
          ${stats.topTools.map((tool) => {
            const pct = Math.round((tool.count / maxToolCount) * 100);
            return `<div class="tool-row">
              <span class="tool-name">${escapeHtml(tool.name)}</span>
              <div class="tool-bar" style="width: ${String(pct)}%"></div>
              <span class="tool-count">${String(tool.count)}</span>
            </div>`;
          }).join('\n')}
        </div>
      </div>`
    : '';

  // Recent conversations
  const recentHtml = recent.length > 0
    ? `<div class="dashboard-section span-6">
        <h2>${icon('clock', 14)} Recent</h2>
        <div class="recent-list">
          ${recent.map((s) => {
            const link = `/c/${encodeURIComponent(s.threadTs)}/${encodeURIComponent(s.channelId)}`;
            const title = s.firstMessage ? escapeHtml(s.firstMessage) : `${escapeHtml(s.userId)} \u00b7 ${escapeHtml(s.channelId)}`;
            const time = formatRelativeTime(s.updatedAt);
            return `<a href="${escapeHtml(link)}" class="recent-item">
              <span class="recent-title">${title}</span>
              <span class="recent-time">${time}</span>
            </a>`;
          }).join('\n')}
        </div>
        <div class="section-footer"><a href="/c">View all &rarr;</a></div>
      </div>`
    : '';

  // Favorites
  const favoritesHtml = favorites.length > 0
    ? `<div class="dashboard-section span-6">
        <h2>${icon('star', 14)} Favorites${favCount > favorites.length ? ` <span style="font-weight:400;color:var(--text-muted)">(${String(favCount)} total)</span>` : ''}</h2>
        <div class="recent-list">
          ${favorites.map((s) => {
            const link = `/c/${encodeURIComponent(s.threadTs)}/${encodeURIComponent(s.channelId)}`;
            const title = s.firstMessage ? escapeHtml(s.firstMessage) : `${escapeHtml(s.userId)} \u00b7 ${escapeHtml(s.channelId)}`;
            return `<a href="${escapeHtml(link)}" class="recent-item">
              <span class="recent-title">${title}</span>
            </a>`;
          }).join('\n')}
        </div>
        <div class="section-footer"><a href="/c/favorites">View all &rarr;</a></div>
      </div>`
    : '';

  // Tags
  const tagsHtml = allTags.length > 0
    ? `<div class="dashboard-section span-4">
        <h2>${icon('tag', 14)} Tags</h2>
        <div class="tag-cloud">
          ${allTags.map((t) =>
            `<a href="/c/tag/${encodeURIComponent(t.name)}">${escapeHtml(t.name)} <span style="opacity:0.6">${String(t.count)}</span></a>`
          ).join('\n')}
        </div>
      </div>`
    : '';

  // Quick actions
  const quickActionsHtml = `
    <div class="quick-actions">
      <a href="/c/new" class="primary">${icon('plus', 16)} New Conversation</a>
      <a href="/c">${icon('search', 16)} Search</a>
      <a href="/c">${icon('message-circle', 16)} All Conversations</a>
    </div>`;


  // Server health section
  const healthHtml = health
    ? (() => {
        const memPct = health.memory.percentUsed;
        const memClass = memPct > 90 ? 'danger' : memPct > 70 ? 'warn' : 'ok';
        const load1 = health.loadAverage[0];
        const loadClass = load1 > health.cpu.cores * 2 ? 'danger' : load1 > health.cpu.cores ? 'warn' : 'ok';
        const topDisk = health.disks.length > 0
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          ? health.disks.reduce((max, d) => d.percentUsed > max.percentUsed ? d : max, health.disks[0]!)
          : null;
        const diskPct = topDisk?.percentUsed ?? 0;
        const diskClass = diskPct > 90 ? 'danger' : diskPct > 75 ? 'warn' : 'ok';

        // Status text for each severity level
        function statusText(cls: string): string {
          if (cls === 'danger') return '<div class="health-status-text danger">Critical</div>';
          if (cls === 'warn') return '<div class="health-status-text warn">Getting tight</div>';
          return '<div class="health-status-text ok">Healthy</div>';
        }

        // Roll up sibling severities so the uptime card reflects overall host
        // state instead of always reading green.
        const severityRank = (cls: string): number => (cls === 'danger' ? 2 : cls === 'warn' ? 1 : 0);
        const uptimeClass = [loadClass, memClass, diskClass].reduce(
          (worst, cls) => (severityRank(cls) > severityRank(worst) ? cls : worst),
          'ok',
        );
        const uptimeStatus = uptimeClass === 'danger'
          ? '<div class="health-status-text danger">Critical</div>'
          : uptimeClass === 'warn'
            ? '<div class="health-status-text warn">Degraded</div>'
            : '<div class="health-status-text ok">Online</div>';

        const loadPct = Math.min(100, Math.round((load1 / Math.max(1, health.cpu.cores)) * 100));

        return `<div class="health-section" id="health-section">
          <h2>${icon('home', 14)} Server Health</h2>
          <div class="health-grid">
            <div class="health-card${uptimeClass !== 'ok' ? ` severity-${uptimeClass}` : ''}">
              <div class="health-label">Uptime</div>
              <div class="health-value" id="h-uptime">${escapeHtml(health.uptime)}</div>
              <div class="health-detail">${String(health.cpu.cores)} cores</div>
              ${uptimeStatus}
            </div>
            <div class="health-card${loadClass !== 'ok' ? ` severity-${loadClass}` : ''}">
              <div class="health-label">Load Average</div>
              <div class="health-value" id="h-load">${load1.toFixed(2)}</div>
              <div class="health-detail">5m: ${health.loadAverage[1].toFixed(2)} · 15m: ${health.loadAverage[2].toFixed(2)}</div>
              <div class="health-bar"><div class="health-bar-fill ${loadClass}" id="hb-load" style="width:${String(loadPct)}%"></div></div>
              ${statusText(loadClass)}
            </div>
            <div class="health-card${memClass !== 'ok' ? ` severity-${memClass}` : ''}">
              <div class="health-label">Memory</div>
              <div class="health-value" id="h-mem">${String(memPct)}%</div>
              <div class="health-detail">${String(health.memory.used)}MB / ${String(health.memory.total)}MB</div>
              <div class="health-bar"><div class="health-bar-fill ${memClass}" id="hb-mem" style="width:${String(memPct)}%"></div></div>
              ${statusText(memClass)}
            </div>
            <div class="health-card${diskClass !== 'ok' ? ` severity-${diskClass}` : ''}">
              <div class="health-label">Disk</div>
              <div class="health-value" id="h-disk">${String(diskPct)}%</div>
              <div class="health-detail">${topDisk ? `${escapeHtml(topDisk.used)} / ${escapeHtml(topDisk.size)} (${escapeHtml(topDisk.mountPoint)})` : 'N/A'}</div>
              <div class="health-bar"><div class="health-bar-fill ${diskClass}" id="hb-disk" style="width:${String(diskPct)}%"></div></div>
              ${statusText(diskClass)}
            </div>
          </div>
        </div>`;
      })()
    : '';

  // Quick links section
  const effectiveLinks = quickLinks && quickLinks.length > 0 ? quickLinks : [];
  const quickLinksHtml = effectiveLinks.length > 0
    ? `<div class="quick-links-section">
        <h2>${icon('star', 14)} Quick Links</h2>
        <div class="quick-links-bar">
          ${effectiveLinks.map((link) => {
            const safeUrl = sanitizeUrl(link.url);
            if (!safeUrl) return '';
            const isExternal = safeUrl.startsWith('http://') || safeUrl.startsWith('https://');
            const target = isExternal ? ' target="_blank" rel="noopener noreferrer"' : '';
            const iconHtml = link.icon ? `${icon(link.icon, 14)} ` : '';
            return `<a href="${escapeHtml(safeUrl)}" class="quick-link-card"${target}>${iconHtml}${escapeHtml(link.title)}</a>`;
          }).filter(Boolean).join('\n')}
        </div>
      </div>`
    : '';

  // Plugin widgets section
  const effectiveWidgets = widgets && widgets.length > 0 ? widgets : [];
  const widgetsHtml = effectiveWidgets.length > 0
    ? `<div class="widget-section">
        <h2>${icon('grid', 16)} Apps</h2>
        <div class="widget-grid">
          ${effectiveWidgets.map((w) => {
            const VALID_SIZES = new Set(['small', 'medium', 'large']);
            const size: string = (w.size && VALID_SIZES.has(w.size)) ? w.size : 'medium';
            const safeLink = w.link ? sanitizeUrl(w.link) : null;
            const titleContent = safeLink
              ? `<a href="${escapeHtml(safeLink)}">${escapeHtml(w.title)}</a>`
              : escapeHtml(w.title);
            const iconHtml = w.icon ? `<span class="widget-icon">${escapeHtml(w.icon)}</span> ` : '';
            return `<div class="widget-card widget-${size}">
              <div class="widget-header">${iconHtml}${titleContent}</div>
              <div class="widget-body">${w.html}</div>
            </div>`;
          }).join('\n')}
        </div>
      </div>`
    : '';

  // Health summary badge for greeting
  let healthBadgeHtml = '';
  if (health) {
    const memPctVal = health.memory.percentUsed;
    const load1Val = health.loadAverage[0];
    const diskPctVal = health.disks.length > 0
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      ? health.disks.reduce((max, d) => d.percentUsed > max.percentUsed ? d : max, health.disks[0]!).percentUsed
      : 0;
    const hasDanger = memPctVal > 90 || load1Val > (health.cpu.cores * 2) || diskPctVal > 90;
    const hasWarn = memPctVal > 70 || load1Val > health.cpu.cores || diskPctVal > 75;
    if (hasDanger) {
      healthBadgeHtml = `<span class="greeting-health has-danger">${icon('x', 12)} Issues detected</span>`;
    } else if (hasWarn) {
      healthBadgeHtml = `<span class="greeting-health has-warn">${icon('eye', 12)} Needs attention</span>`;
    } else {
      healthBadgeHtml = `<span class="greeting-health all-ok">${icon('check', 12)} All systems healthy</span>`;
    }
  }

  const loginPromptHtml = !isAuthenticated ? `
    <div class="dashboard-section span-12" style="text-align:center;padding:var(--space-6);">
      <p style="color:var(--text-muted);margin-bottom:var(--space-3);">Log in to see conversations, notifications, and full dashboard.</p>
      <a href="/login" class="btn btn-primary">${icon('log-in', 16)} Log in</a>
    </div>` : '';

  // Bento grid — all sections placed directly, each carries its own span class
  const bentoSections = isAuthenticated
    ? [toolChartHtml, tagsHtml, recentHtml, favoritesHtml].filter(Boolean).join('\n')
    : loginPromptHtml;

  const bodyHtml = `
  <main class="container">
    <div class="dashboard-greeting">
      <h1>${greeting}${healthBadgeHtml}</h1>
      ${isAuthenticated
        ? `<div class="subtitle">Last 24 hours: ${String(stats.totalSessions)} sessions &middot; ${String(stats.totalMessages)} messages &middot; ${String(stats.totalToolCalls)} tool calls</div>`
        : `<div class="subtitle">Public dashboard</div>`
      }
    </div>
    ${isAuthenticated ? quickActionsHtml : ''}
    ${healthHtml}
    ${isAuthenticated ? quickLinksHtml : ''}
    ${isAuthenticated ? statsHtml : ''}
    ${widgetsHtml}
    <div class="dashboard-grid">
      ${bentoSections}
    </div>
  </main>`;

  // Animated counter script: counts up from 0 on page load
  const counterScript = `
  <script>
  (function() {
    function animateCounter(el, target, duration) {
      if (!el || target < 0) return;
      if (target === 0) { el.textContent = '0'; return; }
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        el.textContent = String(target);
        return;
      }
      var start = 0;
      var startTime = performance.now();
      function step(now) {
        var progress = Math.min((now - startTime) / duration, 1);
        var eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
        var current = Math.round(eased * target);
        el.textContent = String(current);
        if (progress < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }
    document.querySelectorAll('.stat-value[data-count]').forEach(function(el) {
      var target = parseInt(el.getAttribute('data-count') || '0', 10);
      animateCounter(el, target, 400);
    });
  })();
  </script>`;

  // Auto-refresh health cards every 60s (values + bars + severity)
  const healthRefreshScript = health ? `
  <script>
  (function() {
    function severityClass(pct, warnThreshold, dangerThreshold) {
      if (pct > dangerThreshold) return 'danger';
      if (pct > warnThreshold) return 'warn';
      return 'ok';
    }
    function updateBar(barId, pct, cls) {
      var bar = document.getElementById(barId);
      if (!bar) return;
      bar.style.width = Math.min(100, pct) + '%';
      bar.className = 'health-bar-fill ' + cls;
    }
    function updateCard(barId, cls) {
      var bar = document.getElementById(barId);
      if (!bar) return;
      var card = bar.closest('.health-card');
      if (!card) return;
      card.className = 'health-card' + (cls !== 'ok' ? ' severity-' + cls : '');
      // Update status text label
      var statusEl = card.querySelector('.health-status-text');
      if (statusEl) {
        var labels = { ok: 'Healthy', warn: 'Getting tight', danger: 'Critical' };
        statusEl.textContent = labels[cls] || 'Healthy';
        statusEl.className = 'health-status-text ' + cls;
      }
    }
    setInterval(function() {
      fetch('/api/health/server')
        .then(function(r) { return r.json(); })
        .then(function(h) {
          if (!h || !h.uptime) return;
          var cores = h.cpu && h.cpu.cores ? h.cpu.cores : 1;
          var u = document.getElementById('h-uptime');
          var l = document.getElementById('h-load');
          var m = document.getElementById('h-mem');
          var d = document.getElementById('h-disk');
          if (u) u.textContent = h.uptime;
          if (l) {
            l.textContent = h.loadAverage[0].toFixed(2);
            var loadPct = Math.round((h.loadAverage[0] / cores) * 100);
            var loadCls = severityClass(h.loadAverage[0], cores, cores * 2);
            updateBar('hb-load', loadPct, loadCls);
            updateCard('hb-load', loadCls);
          }
          if (m) {
            m.textContent = h.memory.percentUsed + '%';
            var memCls = severityClass(h.memory.percentUsed, 70, 90);
            updateBar('hb-mem', h.memory.percentUsed, memCls);
            updateCard('hb-mem', memCls);
          }
          if (d && h.disks && h.disks.length > 0) {
            var top = h.disks.reduce(function(mx, dk) { return dk.percentUsed > mx.percentUsed ? dk : mx; }, h.disks[0]);
            d.textContent = top.percentUsed + '%';
            var diskCls = severityClass(top.percentUsed, 75, 90);
            updateBar('hb-disk', top.percentUsed, diskCls);
            updateCard('hb-disk', diskCls);
          }
        })
        .catch(function() {});
    }, 60000);
  })();
  </script>` : '';

  const onboardingStyles = `
    .onboarding-overlay {
      position: fixed;
      inset: 0;
      z-index: 9999;
      background: rgba(0, 0, 0, 0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      animation: onboarding-fade-in 0.3s ease;
    }
    @keyframes onboarding-fade-in { from { opacity: 0; } }
    .onboarding-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 32px;
      max-width: 440px;
      width: 90%;
      text-align: center;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
    }
    .onboarding-card h2 {
      font-size: 1.25rem;
      margin: 12px 0 8px;
    }
    .onboarding-card p {
      color: var(--text-muted);
      font-size: 0.875rem;
      line-height: 1.5;
      margin-bottom: 0;
    }
    .onboarding-icon {
      color: var(--accent);
      margin-bottom: 4px;
    }
    .onboarding-steps {
      display: flex;
      gap: 8px;
      justify-content: center;
      margin: 20px 0 16px;
    }
    .onboarding-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--border);
    }
    .onboarding-dot.active {
      background: var(--accent);
    }
    .onboarding-actions {
      display: flex;
      gap: 12px;
      justify-content: center;
      margin-top: 20px;
    }
    .onboarding-actions button {
      padding: 8px 20px;
      border-radius: 8px;
      font-size: 0.875rem;
      font-family: inherit;
      cursor: pointer;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
      transition: background 0.2s, border-color 0.2s;
    }
    .onboarding-actions button:hover {
      border-color: var(--accent);
    }
    .onboarding-actions .btn-primary {
      background: linear-gradient(135deg, var(--accent), var(--accent-secondary));
      color: #fff;
      border: none;
    }
  `;

  const onboardingHtml = `
  <div class="onboarding-overlay" id="onboarding" style="display:none">
    <div class="onboarding-card">
      <div class="onboarding-icon" id="onboarding-icon">${icon('home', 36)}</div>
      <h2 id="onboarding-title">Welcome to Server Monitor</h2>
      <p id="onboarding-text">This is your dashboard. See server health, recent conversations, and quick stats at a glance.</p>
      <div class="onboarding-steps">
        <span class="onboarding-dot active" id="dot-0"></span>
        <span class="onboarding-dot" id="dot-1"></span>
        <span class="onboarding-dot" id="dot-2"></span>
      </div>
      <div class="onboarding-actions">
        <button id="onboarding-skip" type="button">Skip</button>
        <button id="onboarding-next" class="btn-primary" type="button">Next</button>
      </div>
    </div>
  </div>`;

  const onboardingScript = `
  <script>
  (function() {
    var alreadyOnboarded = false;
    try { alreadyOnboarded = localStorage.getItem('ssm-onboarded') === 'true'; } catch(e) {}
    if (alreadyOnboarded) return;
    var overlay = document.getElementById('onboarding');
    if (!overlay) return;
    overlay.style.display = '';
    var step = 0;
    var steps = [
      { icon: '${icon('home', 36)}', title: 'Welcome to Server Monitor', text: 'This is your dashboard. See server health, recent conversations, and quick stats at a glance.' },
      { icon: '${icon('message-circle', 36)}', title: 'Chat with Claude via Slack', text: 'Use /ask in Slack to start a conversation. Claude can check containers, read logs, and diagnose issues.' },
      { icon: '${icon('search', 36)}', title: 'Keyboard Power User', text: 'Press ? for keyboard shortcuts. Ctrl+K opens the command palette. Navigate conversations with j/k keys.' }
    ];
    var titleEl = document.getElementById('onboarding-title');
    var textEl = document.getElementById('onboarding-text');
    var iconEl = document.getElementById('onboarding-icon');
    var nextBtn = document.getElementById('onboarding-next');
    var skipBtn = document.getElementById('onboarding-skip');

    function show(i) {
      if (!titleEl || !textEl || !iconEl) return;
      titleEl.textContent = steps[i].title;
      textEl.textContent = steps[i].text;
      iconEl.innerHTML = steps[i].icon;
      for (var d = 0; d < 3; d++) {
        var dot = document.getElementById('dot-' + d);
        if (dot) dot.className = 'onboarding-dot' + (d === i ? ' active' : '');
      }
      if (nextBtn) nextBtn.textContent = i === 2 ? 'Get Started' : 'Next';
    }

    function dismiss() {
      try { localStorage.setItem('ssm-onboarded', 'true'); } catch(e) {}
      overlay.style.display = 'none';
    }

    if (nextBtn) nextBtn.addEventListener('click', function() {
      if (step < 2) { step++; show(step); }
      else dismiss();
    });
    if (skipBtn) skipBtn.addEventListener('click', dismiss);
  })();
  </script>`;

  return wrapInShell({
    title: 'Dashboard',
    styles: dashboardStyles + onboardingStyles,
    body: bodyHtml + onboardingHtml,
    scripts: counterScript + healthRefreshScript + onboardingScript,
    unreadCount,
    currentPath: '/',
    isAuthenticated,
  });
}

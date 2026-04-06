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
    margin-bottom: 24px;
  }
  .dashboard-greeting h1 {
    font-size: 1.75rem;
    margin: 0 0 4px 0;
  }
  .dashboard-greeting .subtitle {
    color: var(--text-muted);
    font-size: 0.9rem;
  }
  .stats-row {
    display: flex;
    gap: 16px;
    margin-bottom: 32px;
  }
  .stat-card {
    flex: 1;
    background: var(--surface);
    border-radius: 12px;
    padding: 20px;
    border: 1px solid var(--border);
  }
  .stat-card .stat-value {
    font-size: 2rem;
    font-weight: 700;
    color: var(--fg);
    line-height: 1.1;
    font-variant-numeric: tabular-nums;
  }
  .stat-card .stat-label {
    color: var(--text-muted);
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-top: 4px;
  }
  .stat-card .stat-detail {
    color: var(--text-muted);
    font-size: 0.75rem;
    margin-top: 6px;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .stat-card .stat-detail .active-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--green);
  }
  .dashboard-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
    margin-bottom: 32px;
  }
  .dashboard-section {
    background: var(--surface);
    border-radius: 12px;
    padding: 20px;
    border: 1px solid var(--border);
  }
  .dashboard-section h2 {
    font-size: 1rem;
    margin: 0 0 16px 0;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .tool-chart {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .tool-row {
    display: flex;
    align-items: center;
    gap: 8px;
    position: relative;
  }
  .tool-bar {
    height: 24px;
    background: var(--accent);
    border-radius: 4px;
    min-width: 4px;
    transition: width 0.3s ease;
    opacity: 0.8;
  }
  .tool-name {
    font-size: 0.8rem;
    color: var(--fg);
    white-space: nowrap;
    min-width: 120px;
  }
  .tool-count {
    font-size: 0.75rem;
    color: var(--text-muted);
    margin-left: auto;
  }
  .recent-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .recent-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 12px;
    border-radius: 8px;
    text-decoration: none;
    color: var(--fg);
    background: var(--bg);
    border: 1px solid var(--border);
    transition: border-color 0.15s ease;
  }
  .recent-item:hover {
    border-color: var(--accent);
    text-decoration: none;
  }
  .recent-item .recent-title {
    font-size: 0.85rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 300px;
  }
  .recent-item .recent-time {
    font-size: 0.75rem;
    color: var(--text-muted);
    white-space: nowrap;
  }
  .section-footer {
    margin-top: 12px;
    text-align: right;
  }
  .section-footer a {
    font-size: 0.8rem;
    color: var(--accent);
    text-decoration: none;
  }
  .section-footer a:hover {
    text-decoration: underline;
  }
  .quick-actions {
    display: flex;
    gap: 12px;
    margin-bottom: 32px;
  }
  .quick-actions a {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 10px 18px;
    border-radius: 8px;
    font-size: 0.85rem;
    text-decoration: none;
    border: 1px solid var(--border);
    color: var(--fg);
    background: var(--surface);
    transition: border-color 0.15s ease, background 0.15s ease;
  }
  .quick-actions a:hover {
    border-color: var(--accent);
    text-decoration: none;
  }
  .quick-actions a.primary {
    background: var(--accent);
    color: var(--bg);
    border-color: var(--accent);
  }
  .quick-actions a.primary:hover {
    opacity: 0.9;
  }
  .tag-cloud {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .tag-cloud a {
    font-size: 0.75rem;
    padding: 4px 10px;
    border-radius: 12px;
    background: var(--bg);
    color: var(--text-muted);
    text-decoration: none;
    border: 1px solid var(--border);
    transition: border-color 0.15s ease;
  }
  .tag-cloud a:hover {
    border-color: var(--accent);
    color: var(--fg);
  }
  .widget-section {
    margin-bottom: 32px;
  }
  .widget-section > h2 {
    font-size: 1rem;
    margin: 0 0 16px 0;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .widget-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    gap: 16px;
  }
  .widget-card {
    background: var(--surface);
    border-radius: 12px;
    padding: 16px;
    border: 1px solid var(--border);
  }
  .widget-card .widget-header {
    font-size: 0.9rem;
    font-weight: 600;
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .widget-card .widget-header a {
    color: var(--fg);
    text-decoration: none;
  }
  .widget-card .widget-header a:hover {
    color: var(--accent);
  }
  .widget-card .widget-body {
    font-size: 0.85rem;
    color: var(--fg);
  }
  .widget-small { grid-column: span 1; }
  .widget-medium { grid-column: span 1; }
  .widget-large { grid-column: span 2; }
  @media (max-width: 768px) {
    .widget-large { grid-column: span 1; }
  }
  .health-section {
    margin-bottom: 24px;
  }
  .health-section h2 {
    font-size: 0.9rem;
    margin: 0 0 12px 0;
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-muted);
  }
  .health-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 12px;
  }
  .health-card {
    background: var(--surface);
    border-radius: 10px;
    padding: 14px 16px;
    border: 1px solid var(--border);
  }
  .health-card .health-label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
    margin-bottom: 4px;
  }
  .health-card .health-value {
    font-size: 1.4rem;
    font-weight: 700;
    line-height: 1.2;
  }
  .health-card .health-detail {
    font-size: 0.7rem;
    color: var(--text-muted);
    margin-top: 4px;
  }
  .health-bar {
    height: 6px;
    background: var(--border);
    border-radius: 3px;
    margin-top: 8px;
    overflow: hidden;
  }
  .health-bar-fill {
    height: 100%;
    border-radius: 3px;
    transition: width 0.5s ease;
  }
  .health-bar-fill.ok { background: var(--green); }
  .health-bar-fill.warn { background: var(--yellow); }
  .health-bar-fill.danger { background: var(--red); }
  /* Health card severity borders */
  .health-card.severity-warn {
    border-color: var(--yellow);
  }
  .health-card.severity-danger {
    border-color: var(--red);
    animation: pulse-border 2s ease-in-out infinite;
  }
  @keyframes pulse-border {
    0%, 100% { border-color: var(--red); }
    50% { border-color: var(--border); }
  }
  .health-status-text {
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-top: 4px;
  }
  .health-status-text.ok { color: var(--green); }
  .health-status-text.warn { color: var(--yellow); }
  .health-status-text.danger { color: var(--red); }
  /* Greeting health summary */
  .greeting-health {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 0.8rem;
    padding: 4px 10px;
    border-radius: 12px;
    margin-left: 8px;
  }
  .greeting-health.all-ok {
    background: rgba(80, 250, 123, 0.1);
    color: var(--green);
  }
  .greeting-health.has-warn {
    background: rgba(241, 250, 140, 0.1);
    color: var(--yellow);
  }
  .greeting-health.has-danger {
    background: rgba(255, 85, 85, 0.1);
    color: var(--red);
  }
  .quick-links-section {
    margin-bottom: 24px;
  }
  .quick-links-section h2 {
    font-size: 0.9rem;
    margin: 0 0 10px 0;
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-muted);
  }
  .quick-links-bar {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .quick-link-card {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    border-radius: 8px;
    font-size: 0.8rem;
    text-decoration: none;
    color: var(--fg);
    background: var(--surface);
    border: 1px solid var(--border);
    transition: border-color 0.15s ease;
  }
  .quick-link-card:hover {
    border-color: var(--accent);
    text-decoration: none;
  }
  .empty-welcome {
    text-align: center;
    padding: 80px 20px;
  }
  .empty-welcome svg {
    color: var(--text-muted);
    margin-bottom: 16px;
  }
  .empty-welcome h2 {
    font-size: 1.5rem;
    margin: 0 0 8px 0;
  }
  .empty-welcome p {
    color: var(--text-muted);
    margin: 0 0 24px 0;
  }
  @media (max-width: 768px) {
    .stats-row {
      flex-direction: column;
    }
    .dashboard-grid {
      grid-template-columns: 1fr;
    }
    .quick-actions {
      flex-direction: column;
    }
    .recent-item .recent-title {
      max-width: 200px;
    }
  }
  @media (max-width: 414px) {
    .dashboard-card {
      padding: 14px;
    }
    .stat-card {
      padding: 12px;
    }
    .stat-card .stat-value {
      font-size: 1.25rem;
    }
    .health-grid {
      grid-template-columns: 1fr;
    }
    .health-metric {
      padding: 10px;
    }
    .widget-grid {
      grid-template-columns: 1fr;
    }
    .recent-item {
      padding: 10px;
    }
    .recent-item .recent-title {
      max-width: 160px;
      font-size: 0.8rem;
    }
    .quick-actions a {
      padding: 10px;
      font-size: 0.8rem;
    }
    .links-grid {
      grid-template-columns: 1fr;
    }
    .empty-welcome h2 {
      font-size: 1.2rem;
    }
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
): string {
  const greeting = getGreeting();

  // Empty state: welcome screen for new users
  if (stats.totalSessions === 0) {
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
    });
  }

  // Stats cards
  const avgDuration = stats.avgToolDurationMs != null ? `${String(Math.round(stats.avgToolDurationMs))}ms avg` : '';
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
      </div>
      <div class="stat-card">
        <div class="stat-value" data-count="${String(stats.totalToolCalls)}">${String(stats.totalToolCalls)}</div>
        <div class="stat-label">Tool Calls</div>
        ${avgDuration ? `<div class="stat-detail">${avgDuration}</div>` : ''}
      </div>
    </div>`;

  // Top tools bar chart
  const maxToolCount = stats.topTools.length > 0 ? Math.max(...stats.topTools.map((t) => t.count)) : 1;
  const toolChartHtml = stats.topTools.length > 0
    ? `<div class="dashboard-section">
        <h2>${icon('wrench', 16)} Top Tools</h2>
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
    ? `<div class="dashboard-section">
        <h2>${icon('clock', 16)} Recent Conversations</h2>
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
    ? `<div class="dashboard-section">
        <h2>${icon('star', 16)} Favorites${favCount > favorites.length ? ` <span style="font-weight:400;font-size:0.8rem;color:var(--text-muted)">(${String(favCount)} total)</span>` : ''}</h2>
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
    ? `<div class="dashboard-section">
        <h2>${icon('tag', 16)} Tags</h2>
        <div class="tag-cloud">
          ${allTags.map((t) =>
            `<a href="/c/tag/${encodeURIComponent(t.name)}">${escapeHtml(t.name)} (${String(t.count)})</a>`
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

        const loadPct = Math.min(100, Math.round((load1 / Math.max(1, health.cpu.cores)) * 100));

        return `<div class="health-section" id="health-section">
          <h2>${icon('home', 14)} Server Health</h2>
          <div class="health-grid">
            <div class="health-card">
              <div class="health-label">Uptime</div>
              <div class="health-value" id="h-uptime">${escapeHtml(health.uptime)}</div>
              <div class="health-detail">${String(health.cpu.cores)} cores</div>
              <div class="health-status-text ok">Online</div>
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

  // Build the grid: left column = tools + tags, right column = recent + favorites
  const leftCol = [toolChartHtml, tagsHtml].filter(Boolean).join('\n');
  const rightCol = [recentHtml, favoritesHtml].filter(Boolean).join('\n');

  const bodyHtml = `
  <main class="container">
    <div class="dashboard-greeting">
      <h1>${greeting}${healthBadgeHtml}</h1>
      <div class="subtitle">Last 24 hours: ${String(stats.totalSessions)} sessions, ${String(stats.totalMessages)} messages, ${String(stats.totalToolCalls)} tool calls</div>
    </div>
    ${quickActionsHtml}
    ${healthHtml}
    ${quickLinksHtml}
    ${statsHtml}
    ${widgetsHtml}
    <div class="dashboard-grid">
      ${leftCol || ''}
      ${rightCol || ''}
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
      { icon: '${icon('search', 36)}', title: 'Keyboard Power User', text: 'Press ? for keyboard shortcuts. Cmd+K opens the command palette. Navigate conversations with j/k keys.' }
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
  });
}

/**
 * Dashboard home page template
 */

import type { SessionSummary, SessionStats, TagInfo } from '../../services/conversation-store.js';
import type { DashboardWidget } from '../../plugins/types.js';
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
        <div class="stat-value">${String(stats.totalSessions)}</div>
        <div class="stat-label">Sessions</div>
        <div class="stat-detail"><span class="active-dot"></span> ${String(stats.activeSessions)} active</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${String(stats.totalMessages)}</div>
        <div class="stat-label">Messages</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${String(stats.totalToolCalls)}</div>
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

  // Build the grid: left column = tools + tags, right column = recent + favorites
  const leftCol = [toolChartHtml, tagsHtml].filter(Boolean).join('\n');
  const rightCol = [recentHtml, favoritesHtml].filter(Boolean).join('\n');

  const bodyHtml = `
  <main class="container">
    <div class="dashboard-greeting">
      <h1>${greeting}</h1>
      <div class="subtitle">Last 24 hours: ${String(stats.totalSessions)} sessions, ${String(stats.totalMessages)} messages, ${String(stats.totalToolCalls)} tool calls</div>
    </div>
    ${quickActionsHtml}
    ${statsHtml}
    ${widgetsHtml}
    <div class="dashboard-grid">
      ${leftCol || ''}
      ${rightCol || ''}
    </div>
  </main>`;

  return wrapInShell({
    title: 'Dashboard',
    styles: dashboardStyles,
    body: bodyHtml,
    unreadCount,
  });
}

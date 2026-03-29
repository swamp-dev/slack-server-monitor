/**
 * Dashboard home page template
 */

import type { SessionSummary, SessionStats, TagInfo, QuickLink } from '../../services/conversation-store.js';
import { escapeHtml } from './utils.js';
import { icon } from './icons.js';
import { wrapInShell } from './shell.js';

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
  .quick-links-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .quick-link-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 6px;
    text-decoration: none;
    color: var(--text);
    background: var(--bg);
    border: 1px solid var(--border);
    transition: border-color 0.15s ease;
    font-size: 0.85rem;
  }
  .quick-link-item:hover {
    border-color: var(--accent);
    text-decoration: none;
  }
  .quick-link-item svg:first-child {
    transform: rotate(225deg);
    color: var(--text-muted);
    flex-shrink: 0;
  }
  .quick-link-title {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .quick-link-remove {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 2px;
    display: flex;
    opacity: 0;
    transition: opacity 0.15s, color 0.15s;
  }
  .quick-link-item:hover .quick-link-remove {
    opacity: 1;
  }
  .quick-link-remove:hover {
    color: var(--red);
  }
  .quick-link-add {
    display: flex;
    gap: 6px;
    margin-top: 8px;
  }
  .quick-link-add input {
    flex: 1;
    padding: 6px 10px;
    font-size: 0.8125rem;
    font-family: inherit;
    background: var(--code-bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text);
    outline: none;
  }
  .quick-link-add input:focus {
    border-color: var(--accent);
  }
  .quick-link-add button {
    padding: 6px 12px;
    font-size: 0.8125rem;
    font-family: inherit;
    color: #fff;
    background: var(--accent);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 4px;
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
  quickLinks: QuickLink[] = [],
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

  // Quick links (user bookmarks)
  const quickLinkItems = quickLinks.map((ql) =>
    `<a href="${escapeHtml(ql.url)}" class="quick-link-item" rel="noopener noreferrer" target="_blank">
      ${icon('arrow-left', 14)}
      <span class="quick-link-title">${escapeHtml(ql.title)}</span>
      <button class="quick-link-remove" data-id="${String(ql.id)}" type="button" title="Remove">${icon('x', 12)}</button>
    </a>`
  ).join('\n');

  const quickLinksHtml = `<div class="dashboard-section quick-links-section">
      <h2>${icon('star', 16)} Quick Links</h2>
      <div class="quick-links-list" id="quick-links-list">
        ${quickLinkItems}
      </div>
      <form class="quick-link-add" id="quick-link-add">
        <input type="text" name="title" placeholder="Title" maxlength="100" required>
        <input type="text" name="url" placeholder="URL" maxlength="2000" required>
        <button type="submit">${icon('plus', 14)} Add</button>
      </form>
    </div>`;

  // Quick actions
  const quickActionsHtml = `
    <div class="quick-actions">
      <a href="/c/new" class="primary">${icon('plus', 16)} New Conversation</a>
      <a href="/c">${icon('search', 16)} Search</a>
      <a href="/c">${icon('message-circle', 16)} All Conversations</a>
    </div>`;

  // Build the grid: left column = tools + tags + quick links, right column = recent + favorites
  const leftCol = [toolChartHtml, tagsHtml, quickLinksHtml].filter(Boolean).join('\n');
  const rightCol = [recentHtml, favoritesHtml].filter(Boolean).join('\n');

  const bodyHtml = `
  <main class="container">
    <div class="dashboard-greeting">
      <h1>${greeting}</h1>
      <div class="subtitle">Last 24 hours: ${String(stats.totalSessions)} sessions, ${String(stats.totalMessages)} messages, ${String(stats.totalToolCalls)} tool calls</div>
    </div>
    ${quickActionsHtml}
    ${statsHtml}
    <div class="dashboard-grid">
      ${leftCol || ''}
      ${rightCol || ''}
    </div>
  </main>`;

  const quickLinksScript = `
  <script>
  (function() {
    // Remove quick link
    document.querySelectorAll('.quick-link-remove').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        var id = btn.getAttribute('data-id');
        fetch('/c/quick-links/' + id, { method: 'DELETE', credentials: 'same-origin' })
          .then(function(res) { return res.json(); })
          .then(function() { window.location.reload(); })
          .catch(function() { showToast('Failed to remove link', 'error'); });
      });
    });
    // Add quick link
    var addForm = document.getElementById('quick-link-add');
    if (addForm) {
      addForm.addEventListener('submit', function(e) {
        e.preventDefault();
        var titleInput = addForm.querySelector('input[name="title"]');
        var urlInput = addForm.querySelector('input[name="url"]');
        var title = titleInput.value.trim();
        var url = urlInput.value.trim();
        if (!title || !url) return;
        fetch('/c/quick-links', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: title, url: url }),
          credentials: 'same-origin'
        })
        .then(function(res) { return res.json(); })
        .then(function() { window.location.reload(); })
        .catch(function() { showToast('Failed to add link', 'error'); });
      });
    }
  })();
  </script>`;

  return wrapInShell({
    title: 'Dashboard',
    styles: dashboardStyles,
    body: bodyHtml,
    scripts: quickLinksScript,
  });
}

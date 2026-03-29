/**
 * Notification UI templates
 *
 * Bell icon, dropdown, and full notification page.
 */

import type { Notification } from '../../services/notification-store.js';
import { escapeHtml, sanitizeUrl } from './utils.js';
import { icon } from './icons.js';
import { wrapInShell } from './shell.js';

// ─── Notification Bell ────────────────────────────────────────────────

/**
 * Render the notification bell icon for the nav bar.
 * Shows a badge with unread count when > 0.
 */
export function renderNotificationBell(unreadCount: number): string {
  const displayCount = unreadCount > 99 ? '99+' : String(unreadCount);
  const badge = unreadCount > 0
    ? `<span class="notif-badge">${displayCount}</span>`
    : '';

  return `<button class="notification-bell" id="notification-bell" type="button" aria-label="Notifications">${icon('bell', 18)}${badge}</button>`;
}

// ─── Notification Dropdown ────────────────────────────────────────────

/**
 * Format a timestamp as relative time
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
 * Render a compact dropdown for the nav bell.
 * Shows last N notifications with mark-read and view-all actions.
 */
export function renderNotificationDropdown(notifications: Notification[]): string {
  if (notifications.length === 0) {
    return `<div class="notif-dropdown" id="notif-dropdown">
      <div class="notif-dropdown-empty">No notifications</div>
      <div class="notif-dropdown-footer">
        <a href="/notifications">View all</a>
      </div>
    </div>`;
  }

  const items = notifications.map((n) => {
    const levelClass = `notif-${n.level}`;
    const readClass = n.readAt ? 'notif-read' : '';
    const time = formatRelativeTime(n.createdAt);
    const titleHtml = escapeHtml(n.title);
    const safeLink = n.link ? sanitizeUrl(n.link) : null;
    const linkStart = safeLink ? `<a href="${escapeHtml(safeLink)}" class="notif-link" data-notif-id="${String(n.id)}">` : '<div class="notif-link">';
    const linkEnd = safeLink ? '</a>' : '</div>';

    return `<div class="notif-item ${levelClass} ${readClass}" data-id="${String(n.id)}">
      ${linkStart}
        <span class="notif-title">${titleHtml}</span>
        <span class="notif-time">${time}</span>
      ${linkEnd}
    </div>`;
  }).join('\n');

  return `<div class="notif-dropdown" id="notif-dropdown">
    <div class="notif-dropdown-header">
      <span>Notifications</span>
      <button class="notif-mark-all" id="notif-mark-all" type="button">Mark all read</button>
    </div>
    ${items}
    <div class="notif-dropdown-footer">
      <a href="/notifications">View all</a>
    </div>
  </div>`;
}

// ─── Notification Page ────────────────────────────────────────────────

const notificationPageStyles = `
  .notif-page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 24px;
  }
  .notif-page-header h1 {
    font-size: 1.5rem;
    margin: 0;
  }
  .notif-page-header .btn {
    padding: 8px 16px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--fg);
    cursor: pointer;
    font-size: 0.85rem;
  }
  .notif-page-header .btn:hover {
    border-color: var(--accent);
  }
  .notif-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .notif-entry {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 14px 16px;
    display: flex;
    align-items: flex-start;
    gap: 12px;
    transition: border-color 0.15s ease;
  }
  .notif-entry:hover {
    border-color: var(--accent);
  }
  .notif-entry.notif-read {
    opacity: 0.6;
  }
  .notif-entry .notif-indicator {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-top: 6px;
    flex-shrink: 0;
  }
  .notif-entry.notif-info .notif-indicator { background: var(--accent); }
  .notif-entry.notif-warn .notif-indicator { background: #f1fa8c; }
  .notif-entry.notif-error .notif-indicator { background: #ff5555; }
  .notif-entry.notif-read .notif-indicator { background: var(--border); }
  .notif-entry .notif-content {
    flex: 1;
    min-width: 0;
  }
  .notif-entry .notif-entry-title {
    font-size: 0.9rem;
    font-weight: 600;
    margin-bottom: 2px;
  }
  .notif-entry .notif-entry-title a {
    color: var(--fg);
    text-decoration: none;
  }
  .notif-entry .notif-entry-title a:hover {
    color: var(--accent);
  }
  .notif-entry .notif-entry-body {
    font-size: 0.8rem;
    color: var(--text-muted);
    margin-top: 4px;
  }
  .notif-entry .notif-meta {
    font-size: 0.75rem;
    color: var(--text-muted);
    margin-top: 4px;
    display: flex;
    gap: 8px;
  }
  .notif-actions {
    flex-shrink: 0;
    margin-top: 2px;
  }
  .notif-actions button {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
  }
  .notif-actions button:hover {
    color: var(--fg);
    background: var(--bg);
  }
  .notif-empty {
    text-align: center;
    padding: 60px 20px;
    color: var(--text-muted);
  }
  .notif-empty h2 {
    font-size: 1.25rem;
    margin: 12px 0 4px;
  }
  @media (max-width: 768px) {
    .notif-page-header {
      flex-direction: column;
      gap: 12px;
      align-items: flex-start;
    }
  }
`;

/**
 * Render the full notifications page
 */
export function renderNotificationPage(
  notifications: Notification[],
  unreadCount: number,
): string {
  if (notifications.length === 0) {
    const bodyHtml = `
    <main class="container">
      <div class="notif-page-header">
        <h1>Notifications</h1>
      </div>
      <div class="notif-empty">
        ${icon('bell', 48)}
        <h2>No notifications yet</h2>
        <p>Notifications from plugins and the system will appear here.</p>
      </div>
    </main>`;

    return wrapInShell({
      title: 'Notifications',
      styles: notificationPageStyles,
      body: bodyHtml,
      unreadCount,
    });
  }

  const markAllBtn = unreadCount > 0
    ? `<button class="btn" id="page-mark-all" type="button">Mark all read</button>`
    : '';

  const items = notifications.map((n) => {
    const levelClass = `notif-${n.level}`;
    const readClass = n.readAt ? 'notif-read' : '';
    const time = formatRelativeTime(n.createdAt);
    const safeLink = n.link ? sanitizeUrl(n.link) : null;
    const titleContent = safeLink
      ? `<a href="${escapeHtml(safeLink)}">${escapeHtml(n.title)}</a>`
      : escapeHtml(n.title);
    const bodyHtml = n.body ? `<div class="notif-entry-body">${escapeHtml(n.body)}</div>` : '';
    const markReadBtn = !n.readAt
      ? `<div class="notif-actions"><button type="button" data-mark-read="${String(n.id)}" title="Mark as read">${icon('check', 16)}</button></div>`
      : '';

    return `<div class="notif-entry ${levelClass} ${readClass}" data-id="${String(n.id)}">
      <div class="notif-indicator"></div>
      <div class="notif-content">
        <div class="notif-entry-title">${titleContent}</div>
        ${bodyHtml}
        <div class="notif-meta">
          <span>${escapeHtml(n.source)}</span>
          <span>${time}</span>
        </div>
      </div>
      ${markReadBtn}
    </div>`;
  }).join('\n');

  const bodyHtml = `
  <main class="container">
    <div class="notif-page-header">
      <h1>Notifications</h1>
      ${markAllBtn}
    </div>
    <div class="notif-list">
      ${items}
    </div>
  </main>`;

  const scripts = `
  <script>
  (function() {
    // Mark single notification as read
    document.querySelectorAll('[data-mark-read]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var id = this.getAttribute('data-mark-read');
        fetch('/api/notifications/' + id + '/read', { method: 'POST' })
          .then(function(res) { return res.json(); })
          .then(function(data) {
            if (data.success) {
              var entry = document.querySelector('[data-id="' + id + '"]');
              if (entry) entry.classList.add('notif-read');
              btn.remove();
              updateBadge(data.unreadCount);
            }
          });
      });
    });

    // Mark all read
    var markAllBtn = document.getElementById('page-mark-all');
    if (markAllBtn) {
      markAllBtn.addEventListener('click', function() {
        fetch('/api/notifications/read-all', { method: 'POST' })
          .then(function(res) { return res.json(); })
          .then(function() {
            document.querySelectorAll('.notif-entry').forEach(function(e) { e.classList.add('notif-read'); });
            document.querySelectorAll('.notif-actions').forEach(function(e) { e.remove(); });
            markAllBtn.remove();
            updateBadge(0);
          });
      });
    }

    function updateBadge(count) {
      var badge = document.querySelector('.notif-badge');
      if (count === 0 && badge) badge.remove();
      else if (badge) badge.textContent = count > 99 ? '99+' : String(count);
    }
  })();
  </script>`;

  return wrapInShell({
    title: 'Notifications',
    styles: notificationPageStyles,
    body: bodyHtml,
    scripts,
    unreadCount,
  });
}

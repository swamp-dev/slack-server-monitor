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

type NotifBucket = 'today' | 'yesterday' | 'this-week' | 'older';

/**
 * Bucket a notification's createdAt into a date-section group used for
 * the temporal headers on the notifications page. Same model as the
 * session-list page so the UI feels consistent.
 */
function dateBucket(timestamp: number): NotifBucket {
  // Use Date.setDate for day arithmetic so DST transitions don't cause a
  // 24-hour offset to mis-bucket entries around the spring/fall boundary.
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  if (timestamp >= startOfToday.getTime()) return 'today';

  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  if (timestamp >= startOfYesterday.getTime()) return 'yesterday';

  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() - 7);
  if (timestamp >= startOfWeek.getTime()) return 'this-week';
  return 'older';
}

const BUCKET_LABEL: Record<NotifBucket, string> = {
  'today': 'Today',
  'yesterday': 'Yesterday',
  'this-week': 'This Week',
  'older': 'Older',
};

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

  // Group notifications by source for compact display
  interface NotifGroup {
    latest: Notification;
    count: number;
  }
  const groups: NotifGroup[] = [];
  for (const n of notifications) {
    const last = groups[groups.length - 1];
    if (last?.latest.source === n.source) {
      last.count++;
    } else {
      groups.push({ latest: n, count: 1 });
    }
  }

  const items = groups.map((g) => {
    const n = g.latest;
    const levelClass = `notif-${n.level}`;
    const readClass = n.readAt ? 'notif-read' : '';
    const time = formatRelativeTime(n.createdAt);
    const countBadge = g.count > 1 ? ` <span class="notif-group-count">(${String(g.count)})</span>` : '';
    const titleHtml = escapeHtml(n.title) + countBadge;
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
    <div class="notif-prefs" id="notif-prefs">
      <label class="notif-pref-toggle"><input type="checkbox" id="notif-pref-sound"> ${icon('bell', 12)} Sound</label>
      <label class="notif-pref-toggle"><input type="checkbox" id="notif-pref-push"> ${icon('send', 12)} Push</label>
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
    border: 1px solid var(--accent);
    background: transparent;
    color: var(--accent);
    cursor: pointer;
    font-size: 0.85rem;
    font-weight: 500;
    transition: background 0.2s, color 0.2s;
  }
  .notif-page-header .btn:hover {
    background: var(--accent);
    color: var(--bg);
  }
  .notif-filters {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-bottom: 16px;
  }
  .notif-filter-pill {
    padding: 4px 12px;
    border-radius: 16px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text-muted);
    font-size: 0.8125rem;
    cursor: pointer;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }
  .notif-filter-pill:hover { color: var(--text); border-color: var(--accent); }
  .notif-filter-pill.active { background: var(--accent); color: var(--bg); border-color: var(--accent); }
  .notif-section-header {
    font-size: 0.6875rem;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-muted);
    font-weight: 600;
    margin: 16px 0 8px;
  }
  .notif-section-header:first-child { margin-top: 0; }
  /* When a filter hides all entries in a section, the section header
     should also disappear so we don't end up with floating "Today"
     labels above empty space. */
  .notif-section.hidden { display: none; }
  .notif-entry[data-hidden] { display: none; }
  .notif-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .notif-entry {
    background: var(--surface);
    border: 1px solid var(--border);
    border-left: 3px solid transparent;
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
  .notif-entry:not(.notif-read) {
    border-left-color: var(--accent);
  }
  .notif-entry.notif-read {
    opacity: 0.6;
  }
  .notif-entry .notif-indicator {
    flex-shrink: 0;
    margin-top: 2px;
    display: flex;
    align-items: center;
  }
  .notif-entry.notif-info .notif-indicator { color: var(--accent); }
  .notif-entry.notif-warn .notif-indicator { color: var(--yellow); }
  .notif-entry.notif-error .notif-indicator { color: var(--red); }
  .notif-entry.notif-read .notif-indicator { color: var(--border); }
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
        <p class="empty-hint" id="notif-empty-hint" style="display:none">Tip: Press <kbd>?</kbd> to see all keyboard shortcuts</p>
      </div>
    </main>`;

    const hintScript = `
    <script>
    (function() {
      var hint = document.getElementById('notif-empty-hint');
      if (!hint) return;
      try {
        if (localStorage.getItem('ssm-hints-dismissed') !== 'true') hint.style.display = '';
      } catch(e) {}
    })();
    </script>`;

    return wrapInShell({
      title: 'Notifications',
      styles: notificationPageStyles,
      body: bodyHtml,
      scripts: hintScript,
      unreadCount,
      currentPath: '/notifications',
    });
  }

  const markAllBtn = unreadCount > 0
    ? `<button class="btn" id="page-mark-all" type="button">Mark all read</button>`
    : '';

  function renderEntry(n: Notification): string {
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

    const levelIcon = n.level === 'error' ? icon('x-circle', 16)
      : n.level === 'warn' ? icon('alert-triangle', 16)
      : icon('info-circle', 16);

    return `<div class="notif-entry ${levelClass} ${readClass}" data-id="${String(n.id)}" data-level="${n.level}" data-read="${n.readAt ? 'true' : 'false'}">
      <div class="notif-indicator">${levelIcon}</div>
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
  }

  // Bucket by day so the page reads top-to-bottom in temporal order
  // (matches the conversation-list pattern). Bucket order is fixed; an
  // empty bucket renders nothing.
  const buckets: Record<NotifBucket, Notification[]> = {
    'today': [], 'yesterday': [], 'this-week': [], 'older': [],
  };
  for (const n of notifications) {
    buckets[dateBucket(n.createdAt)].push(n);
  }
  const sectionOrder: NotifBucket[] = ['today', 'yesterday', 'this-week', 'older'];
  const sections = sectionOrder
    .filter((b) => buckets[b].length > 0)
    .map((b) => `
      <section class="notif-section" data-bucket="${b}">
        <h2 class="notif-section-header">${BUCKET_LABEL[b]}</h2>
        ${buckets[b].map(renderEntry).join('\n')}
      </section>
    `)
    .join('\n');

  const filters = `
    <div class="notif-filters" role="tablist" aria-label="Filter notifications by level">
      <button type="button" class="notif-filter-pill active" data-filter="all" role="tab" aria-selected="true">All</button>
      <button type="button" class="notif-filter-pill" data-filter="unread" role="tab" aria-selected="false">Unread</button>
      <button type="button" class="notif-filter-pill" data-filter="error" role="tab" aria-selected="false">Errors</button>
      <button type="button" class="notif-filter-pill" data-filter="warn" role="tab" aria-selected="false">Warnings</button>
    </div>
  `;

  const bodyHtml = `
  <main class="container">
    <div class="notif-page-header">
      <h1>Notifications</h1>
      ${markAllBtn}
    </div>
    ${filters}
    <div class="notif-list">
      ${sections}
    </div>
  </main>`;

  const scripts = `
  <script>
  (function() {
    // Level/unread filter pills. Filter state is local UI only — a future
    // change can pin it via query string if deep-linking matters.
    var pills = document.querySelectorAll('.notif-filter-pill');
    function applyFilter(name) {
      var entries = document.querySelectorAll('.notif-entry');
      entries.forEach(function(e) {
        var matches = (
          name === 'all' ||
          (name === 'unread' && e.getAttribute('data-read') === 'false') ||
          (name === 'error' && e.getAttribute('data-level') === 'error') ||
          (name === 'warn' && e.getAttribute('data-level') === 'warn')
        );
        // data-hidden so the filter doesn't conflict with inline styles
        // set elsewhere (e.g. swipe-to-dismiss touches style.transform).
        if (matches) e.removeAttribute('data-hidden');
        else e.setAttribute('data-hidden', '');
      });
      // Hide section headers whose entries are all filtered out so the
      // page doesn't show floating "Today" labels above empty space.
      document.querySelectorAll('.notif-section').forEach(function(sec) {
        var visible = sec.querySelectorAll('.notif-entry:not([data-hidden])');
        sec.classList.toggle('hidden', visible.length === 0);
      });
    }
    pills.forEach(function(p) {
      p.addEventListener('click', function() {
        pills.forEach(function(o) { o.classList.remove('active'); o.setAttribute('aria-selected', 'false'); });
        p.classList.add('active');
        p.setAttribute('aria-selected', 'true');
        applyFilter(p.getAttribute('data-filter') || 'all');
      });
    });

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

    // Swipe-to-dismiss on touch devices
    var swipeThreshold = 60;
    document.querySelectorAll('.notif-entry').forEach(function(entry) {
      var startX = 0;
      var startY = 0;
      var swiping = false;
      entry.addEventListener('touchstart', function(e) {
        var touch = e.touches[0];
        startX = touch.clientX;
        startY = touch.clientY;
        swiping = false;
      }, { passive: true });
      entry.addEventListener('touchmove', function(e) {
        var touch = e.touches[0];
        var dx = touch.clientX - startX;
        var dy = touch.clientY - startY;
        // Only swipe left, and only if horizontal movement dominates
        if (dx < -10 && Math.abs(dx) > Math.abs(dy) * 1.5) {
          swiping = true;
          entry.classList.add('swiping');
          entry.style.transform = 'translateX(' + Math.min(0, dx) + 'px)';
        }
      }, { passive: true });
      function resetSwipe() {
        swiping = false;
        entry.classList.remove('swiping');
        entry.style.transform = '';
      }
      entry.addEventListener('touchend', function() {
        entry.classList.remove('swiping');
        if (!swiping) { entry.style.transform = ''; return; }
        var currentX = parseFloat(entry.style.transform.replace('translateX(', '').replace('px)', '')) || 0;
        if (Math.abs(currentX) > swipeThreshold) {
          entry.classList.add('dismissed');
          var id = entry.getAttribute('data-id');
          if (id) {
            fetch('/api/notifications/' + id + '/read', { method: 'POST' })
              .then(function(res) { return res.json(); })
              .then(function(data) {
                if (data.success) {
                  updateBadge(data.unreadCount);
                  setTimeout(function() { entry.remove(); }, 300);
                } else {
                  entry.classList.remove('dismissed');
                  resetSwipe();
                }
              })
              .catch(function() {
                entry.classList.remove('dismissed');
                resetSwipe();
              });
          }
        } else {
          entry.style.transform = '';
        }
        swiping = false;
      });
      entry.addEventListener('touchcancel', function() { resetSwipe(); });
    });
  })();
  </script>`;

  return wrapInShell({
    title: 'Notifications',
    styles: notificationPageStyles,
    body: bodyHtml,
    scripts,
    unreadCount,
    currentPath: '/notifications',
  });
}

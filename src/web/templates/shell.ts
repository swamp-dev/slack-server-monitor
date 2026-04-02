/**
 * HTML shell / layout wrapper
 */

import { escapeHtml } from './utils.js';
import { getThemeStyles } from './theme.js';
import { getBaseStyles, getAnimationStyles } from './styles.js';
import { icon } from './icons.js';
import { getKeyboardShortcutScript, getKeyboardHelpOverlay } from './keyboard.js';
import { renderNotificationBell, renderNotificationDropdown } from './notifications.js';
import { getPluginNavEntries } from '../plugin-router.js';

// ─── Shell / Layout ────────────────────────────────────────────────────

export interface ShellOptions {
  title: string;
  styles: string;
  body: string;
  scripts?: string;
  showNav?: boolean;
  highlightJs?: boolean;
  /** Unread notification count for nav bell badge */
  unreadCount?: number;
}

/**
 * Wrap page content in the full HTML shell with nav, theme, fonts
 */
export function wrapInShell(opts: ShellOptions): string {
  const { title, styles: pageStyles, body, scripts = '', showNav = true, highlightJs = false, unreadCount = 0 } = opts;

  const hljsLink = highlightJs
    ? `<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css" integrity="sha384-wH75j6z1lH97ZOpMOInqhgKzFkAInZPPSPlZpYKYTOqsaizPvhQZmAtLcPKXpLyH" crossorigin="anonymous">`
    : '';
  const hljsScript = highlightJs
    ? `<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js" integrity="sha384-F/bZzf7p3Joyp5psL90p/p89AZJsndkSoGwRpXcZhleCWhd8SnRuoYo4d0yirjJp" crossorigin="anonymous"></script>
  <script>hljs.highlightAll();</script>
  <script>
  (function() {
    document.addEventListener('click', function(e) {
      var btn = e.target.closest('.code-copy-btn');
      if (!btn) return;
      var block = btn.closest('.code-block');
      if (!block) return;
      var code = block.querySelector('pre code');
      if (!code) return;
      if (!navigator.clipboard) return;
      navigator.clipboard.writeText(code.textContent || '').then(function() {
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(function() { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
      }).catch(function() {
        btn.textContent = 'Failed';
        setTimeout(function() { btn.textContent = 'Copy'; }, 2000);
      });
    });
  })();
  </script>`
    : '';

  const pluginNavEntries = getPluginNavEntries();
  const pluginNavHtml = pluginNavEntries.length > 0
    ? pluginNavEntries.map((entry) => {
        const iconHtml = entry.icon ? `${icon(entry.icon, 14)} ` : '';
        return `<a href="/p/${escapeHtml(entry.pluginName)}/" class="nav-plugin-link">${iconHtml}${escapeHtml(entry.label)}</a>`;
      }).join('')
    : '';

  const navHtml = showNav ? `
  <nav class="nav-bar">
    <a href="/" class="nav-brand">${icon('robot', 22)} Server Monitor</a>
    <a href="/c" class="nav-link">${icon('message-circle', 14)} Conversations</a>
    ${pluginNavHtml ? `<div class="nav-plugins">${pluginNavHtml}</div>` : ''}
    <button class="nav-hamburger" id="nav-hamburger" type="button" aria-label="Menu">${icon('chevron-down', 20)}</button>
    <div class="nav-actions" id="nav-actions">
      <div class="notif-bell-wrapper">${renderNotificationBell(unreadCount)}${renderNotificationDropdown([])}</div>
      <button class="theme-toggle" id="theme-toggle" type="button" aria-label="Toggle theme"><span class="icon-sun">${icon('sun', 18)}</span><span class="icon-moon">${icon('moon', 18)}</span></button>
      <form method="POST" action="/logout" style="margin:0;">
        <button class="logout-btn" type="submit" aria-label="Log out">${icon('logout', 18)}</button>
      </form>
    </div>
  </nav>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='none' stroke='%23ff79c6' stroke-width='1.5'%3E%3Crect x='4' y='6' width='12' height='10' rx='2'/%3E%3Ccircle cx='7.5' cy='11' r='1.5'/%3E%3Ccircle cx='12.5' cy='11' r='1.5'/%3E%3Cpath d='M10 2v4M6 6V4M14 6V4'/%3E%3C/svg%3E">
  <title>${escapeHtml(title)}</title>
  ${hljsLink}
  <script>
    (function() {
      try {
        var raw = localStorage.getItem('ssm-theme');
        if (raw === 'dracula' || raw === 'light') {
          document.documentElement.setAttribute('data-theme', raw);
        } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
          document.documentElement.setAttribute('data-theme', 'light');
        } else {
          document.documentElement.setAttribute('data-theme', 'dracula');
        }
      } catch(e) {}
    })();
  </script>
  <style>${getThemeStyles()}${getBaseStyles()}${getAnimationStyles()}${pageStyles}</style>
</head>
<body>
  ${navHtml}
  ${body}
  <footer>
    <div class="container">
      ${icon('robot', 14)} Powered by Claude
    </div>
  </footer>
  <div class="toast-container" id="toast-container"></div>
  ${hljsScript}
  <script>
  function showToast(msg, type) {
    var c = document.getElementById('toast-container');
    if (!c) return;
    var d = document.createElement('div');
    d.className = 'toast ' + (type || 'success');
    d.textContent = msg;
    c.appendChild(d);
    setTimeout(function() {
      d.classList.add('removing');
      setTimeout(function() { d.remove(); }, 300);
    }, 3000);
  }
  // Theme toggle
  (function() {
    var btn = document.getElementById('theme-toggle');
    if (!btn) return;
    btn.addEventListener('click', function() {
      var current = document.documentElement.getAttribute('data-theme') || 'dracula';
      var next = current === 'dracula' ? 'light' : 'dracula';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('ssm-theme', next);
    });
  })();
  // Hamburger menu
  (function() {
    var btn = document.getElementById('nav-hamburger');
    var actions = document.getElementById('nav-actions');
    var plugins = document.querySelector('.nav-plugins');
    var navLinks = document.querySelectorAll('.nav-link');
    if (!btn || !actions) return;
    btn.addEventListener('click', function() {
      actions.classList.toggle('open');
      if (plugins) plugins.classList.toggle('open');
      navLinks.forEach(function(link) { link.classList.toggle('open'); });
    });
  })();
  // Notification bell dropdown
  (function() {
    var bell = document.getElementById('notification-bell');
    var dropdown = document.getElementById('notif-dropdown');
    if (!bell || !dropdown) return;
    bell.addEventListener('click', function(e) {
      e.stopPropagation();
      var isOpen = dropdown.classList.contains('open');
      dropdown.classList.toggle('open');
      if (!isOpen) {
        fetch('/api/notifications?unread=true&limit=5')
          .then(function(r) { return r.json(); })
          .then(function(data) {
            if (!data.notifications) return;
            var items = data.notifications.map(function(n) {
              var cls = 'notif-item notif-' + n.level + (n.readAt ? ' notif-read' : '');
              var title = n.title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
              var ago = formatTimeAgo(n.createdAt);
              var inner = '<span class="notif-title">' + title + '</span><span class="notif-time">' + ago + '</span>';
              var safeLink = n.link ? sanitizeLink(n.link) : null;
              if (safeLink) inner = '<a href="' + safeLink.replace(/"/g, '&quot;') + '" class="notif-link">' + inner + '</a>';
              else inner = '<div class="notif-link">' + inner + '</div>';
              return '<div class="' + cls + '" data-id="' + n.id + '">' + inner + '</div>';
            }).join('');
            var header = data.notifications.length > 0
              ? '<div class="notif-dropdown-header"><span>Notifications</span><button class="notif-mark-all" id="notif-mark-all" type="button">Mark all read</button></div>'
              : '';
            var empty = data.notifications.length === 0 ? '<div class="notif-dropdown-empty">No notifications</div>' : '';
            dropdown.innerHTML = header + empty + items + '<div class="notif-dropdown-footer"><a href="/notifications">View all</a></div>';
            var markAll = document.getElementById('notif-mark-all');
            if (markAll) {
              markAll.addEventListener('click', function() {
                fetch('/api/notifications/read-all', { method: 'POST' })
                  .then(function() {
                    var badge = document.querySelector('.notif-badge');
                    if (badge) badge.remove();
                    dropdown.classList.remove('open');
                  });
              });
            }
          });
      }
    });
    document.addEventListener('click', function() {
      dropdown.classList.remove('open');
    });
    dropdown.addEventListener('click', function(e) { e.stopPropagation(); });
    function sanitizeLink(url) {
      var t = url.trim();
      var l = t.toLowerCase();
      if (l.startsWith('http://') || l.startsWith('https://') || t.startsWith('/')) return t;
      return null;
    }
    function formatTimeAgo(ts) {
      var diff = Date.now() - ts;
      var mins = Math.floor(diff / 60000);
      if (mins < 1) return 'just now';
      if (mins < 60) return mins + 'm ago';
      var hours = Math.floor(mins / 60);
      if (hours < 24) return hours + 'h ago';
      return Math.floor(hours / 24) + 'd ago';
    }
  })();
  </script>
  <script>
  (function() {
    try {
      if (typeof EventSource === 'undefined') return;
      var es = new EventSource('/api/notifications/stream');
      var badge = document.querySelector('.notif-badge');
      var bell = document.querySelector('.notif-bell');

      es.addEventListener('notification', function() {
        if (!badge && bell) {
          badge = document.createElement('span');
          badge.className = 'notif-badge';
          badge.textContent = '1';
          bell.appendChild(badge);
        } else if (badge) {
          var count = parseInt(badge.textContent || '0', 10) + 1;
          badge.textContent = String(count);
        }
      });

      es.addEventListener('badge', function(e) {
        try {
          var data = JSON.parse(e.data);
          var unread = data.unreadCount;
          if (unread === 0) {
            if (badge) badge.remove();
            badge = null;
          } else {
            if (!badge && bell) {
              badge = document.createElement('span');
              badge.className = 'notif-badge';
              bell.appendChild(badge);
            }
            if (badge) badge.textContent = String(unread);
          }
        } catch(err) {}
      });

      es.onerror = function() {};
    } catch(e) {}
  })();
  </script>
  <script>
  // Page transition: intercept internal navigation to show loading state
  (function() {
    function isInternalLink(a) {
      if (!a || !a.href) return false;
      if (a.target === '_blank') return false;
      if (a.getAttribute('download') != null) return false;
      try {
        var url = new URL(a.href, window.location.origin);
        return url.origin === window.location.origin;
      } catch(e) { return false; }
    }

    function showLoadingOverlay() {
      var overlay = document.createElement('div');
      overlay.className = 'nav-loading-overlay';
      overlay.innerHTML = '<div class="nav-loading-skeleton">'
        + '<div class="nav-loading-bar"></div>'
        + '<div class="skeleton skeleton-line" style="width:40%"></div>'
        + '<div class="skeleton skeleton-card"></div>'
        + '<div class="skeleton skeleton-card"></div>'
        + '<div class="skeleton skeleton-card"></div>'
        + '</div>';
      document.body.appendChild(overlay);
    }

    document.addEventListener('click', function(e) {
      var a = e.target.closest('a');
      if (!a || !isInternalLink(a)) return;
      if (e.ctrlKey || e.metaKey || e.shiftKey) return;

      // Skip if it's the current page
      if (a.href === window.location.href) return;

      // Use View Transitions API if available
      if (document.startViewTransition) {
        e.preventDefault();
        document.startViewTransition(function() {
          window.location.href = a.href;
        });
        return;
      }

      // Fallback: show loading overlay before navigation
      showLoadingOverlay();
    });
  })();
  </script>
  ${getKeyboardShortcutScript()}
  ${scripts}
  ${getKeyboardHelpOverlay()}
</body>
</html>`;
}

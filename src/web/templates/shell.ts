/**
 * HTML shell / layout wrapper
 */

import { escapeHtml } from './utils.js';
import { getStaticCssHash } from './styles.js';
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
  /** Current URL path for bottom nav active state */
  currentPath?: string;
  /** Whether the current user is authenticated (default: true for backward compat) */
  isAuthenticated?: boolean;
  /** Whether the current user is an admin — gates the /admin nav link. */
  isAdmin?: boolean;
}

/**
 * Wrap page content in the full HTML shell with nav, theme, fonts
 */
export function wrapInShell(opts: ShellOptions): string {
  const { title, styles: pageStyles, body, scripts = '', showNav = true, highlightJs = false, unreadCount = 0, currentPath = '', isAuthenticated = true, isAdmin = false } = opts;

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

  const allPluginNavEntries = getPluginNavEntries();
  const pluginNavEntries = isAuthenticated
    ? allPluginNavEntries
    : allPluginNavEntries.filter((e) => e.public);
  const pluginNavHtml = pluginNavEntries.length > 0
    ? pluginNavEntries.map((entry) => {
        const iconHtml = entry.icon ? `${icon(entry.icon, 14)} ` : '';
        return `<a href="/p/${escapeHtml(entry.pluginName)}/" class="nav-plugin-link">${iconHtml}${escapeHtml(entry.label)}</a>`;
      }).join('')
    : '';

  // Generate plugin palette entries for command palette
  const pluginPaletteEntries = pluginNavEntries.flatMap((entry) => {
    const root = { title: entry.label, url: `/p/${entry.pluginName}/`, icon: entry.icon ?? 'grid', group: 'Plugins' };
    const subPages = (entry.pages ?? [])
      .filter((p) => p.path !== '/')
      .map((page) => ({
        title: `${entry.label} \u203a ${page.name.charAt(0).toUpperCase() + page.name.slice(1)}`,
        url: `/p/${entry.pluginName}${page.path}`,
        icon: entry.icon ?? 'grid',
        group: 'Plugins',
      }));
    return [root, ...subPages];
  });

  const navHtml = showNav ? `
  <nav class="nav-bar">
    <a href="/" class="nav-brand">${icon('robot', 22)} Server Monitor</a>
    ${isAuthenticated ? `<a href="/c" class="nav-link">${icon('message-circle', 14)} Conversations</a>` : ''}
    ${isAdmin ? `<a href="/admin/users" class="nav-link">${icon('user', 14)} Admin</a>` : ''}
    ${pluginNavHtml ? `<div class="nav-plugins">${pluginNavHtml}</div>` : ''}
    <button class="nav-hamburger" id="nav-hamburger" type="button" aria-label="Menu">${icon('chevron-down', 20)}</button>
    <div class="nav-backdrop" id="nav-backdrop" aria-hidden="true"></div>
    <div class="nav-actions" id="nav-actions">
      ${isAuthenticated ? `<div class="notif-bell-wrapper">${renderNotificationBell(unreadCount)}${renderNotificationDropdown([])}</div>` : ''}
      <button class="theme-toggle" id="theme-toggle" type="button" aria-label="Toggle theme"><span class="icon-sun">${icon('sun', 18)}</span><span class="icon-moon">${icon('moon', 18)}</span></button>
      ${isAuthenticated
        ? `<form method="POST" action="/logout" style="margin:0;">
            <button class="logout-btn" type="submit" aria-label="Log out">${icon('logout', 18)}</button>
          </form>`
        : `<a href="/login" class="nav-link">${icon('log-in', 18)} Login</a>`
      }
    </div>
  </nav>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="robots" content="noindex, nofollow">
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='none' stroke='%23ff79c6' stroke-width='1.5'%3E%3Crect x='4' y='6' width='12' height='10' rx='2'/%3E%3Ccircle cx='7.5' cy='11' r='1.5'/%3E%3Ccircle cx='12.5' cy='11' r='1.5'/%3E%3Cpath d='M10 2v4M6 6V4M14 6V4'/%3E%3C/svg%3E">
  <link rel="manifest" href="/manifest.json">
  <meta name="theme-color" content="#282a36">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
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
  <link rel="stylesheet" href="/static/styles.css?v=${getStaticCssHash()}">
  ${pageStyles ? `<style>${pageStyles}</style>` : ''}
</head>
<body>
  ${navHtml}
  ${showNav ? `<div id="hint-banner" class="hint-banner" style="display:none">
    <span>Pro tip: Press <kbd>Ctrl+K</kbd> to quickly search and navigate, or <kbd>?</kbd> for all keyboard shortcuts.</span>
    <button class="hint-banner-dismiss" id="hint-banner-dismiss" type="button" aria-label="Dismiss">${icon('x', 16)}</button>
  </div>` : ''}
  ${body}
  <footer>
    <div class="container">
      ${icon('robot', 14)} Powered by Claude
    </div>
  </footer>
  ${showNav ? `<nav class="bottom-nav" id="bottom-nav" aria-label="App navigation">
    <a href="/" class="bottom-nav-item${currentPath === '/' ? ' active' : ''}" aria-label="Dashboard">${icon('home', 20)}<span>Dashboard</span></a>
    ${isAuthenticated ? `<a href="/c" class="bottom-nav-item${currentPath === '/c' ? ' active' : ''}" aria-label="Conversations">${icon('message-circle', 20)}<span>Chats</span></a>` : ''}
    ${isAuthenticated ? `<a href="/notifications" class="bottom-nav-item${currentPath === '/notifications' ? ' active' : ''}" aria-label="Notifications">${icon('bell', 20)}<span>Alerts</span></a>` : ''}
  </nav>` : ''}
  <div id="cmd-palette" class="cmd-palette" style="display:none" role="dialog" aria-label="Command palette" aria-modal="true">
    <div class="cmd-palette-backdrop"></div>
    <div class="cmd-palette-panel">
      <div class="cmd-palette-input-wrap">
        ${icon('search', 16)}
        <input type="text" id="cmd-palette-input" class="cmd-palette-input" placeholder="Search conversations, navigate, or run commands..." autocomplete="off" spellcheck="false">
        <kbd class="cmd-palette-kbd">Esc</kbd>
      </div>
      <div id="cmd-palette-results" class="cmd-palette-results"></div>
    </div>
  </div>
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
  // Hint banner: show after onboarding, dismiss permanently
  (function() {
    var banner = document.getElementById('hint-banner');
    var dismiss = document.getElementById('hint-banner-dismiss');
    if (!banner || !dismiss) return;
    // Only show the keyboard-shortcut tip on pages where Ctrl+K and ?
    // actually do something useful — list views and the notifications
    // page. Skip on conversation detail (focused task), admin (different
    // work mode), and error pages (tip is noise when the user just hit
    // a problem). Conversation detail also lives under /c/ but has
    // additional path segments, so we use an explicit list rather than
    // a /c prefix match.
    var p = location.pathname.replace(/[/]$/, '') || '/';
    var listViews = ['/', '/c', '/c/search', '/c/favorites', '/c/archived', '/notifications'];
    var pathAllowed = listViews.indexOf(p) !== -1 || p.indexOf('/c/tag/') === 0;
    if (!pathAllowed) return;
    try {
      var onboarded = localStorage.getItem('ssm-onboarded') === 'true';
      var dismissed = localStorage.getItem('ssm-hints-dismissed') === 'true';
      if (onboarded && !dismissed) {
        banner.style.display = '';
      }
    } catch(e) {}
    dismiss.addEventListener('click', function() {
      banner.style.display = 'none';
      try { localStorage.setItem('ssm-hints-dismissed', 'true'); } catch(e) {}
    });
  })();
  // Hamburger menu
  (function() {
    var btn = document.getElementById('nav-hamburger');
    var actions = document.getElementById('nav-actions');
    var backdrop = document.getElementById('nav-backdrop');
    var plugins = document.querySelector('.nav-plugins');
    var navLinks = document.querySelectorAll('.nav-link');
    if (!btn || !actions) return;
    function toggleMenu() {
      var willOpen = !actions.classList.contains('open');
      actions.classList.toggle('open', willOpen);
      if (backdrop) backdrop.classList.toggle('open', willOpen);
      if (plugins) plugins.classList.toggle('open', willOpen);
      navLinks.forEach(function(link) { link.classList.toggle('open', willOpen); });
    }
    btn.addEventListener('click', toggleMenu);
    if (backdrop) backdrop.addEventListener('click', toggleMenu);
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
            var soundChecked = localStorage.getItem('ssm-notif-sound') === 'true' ? ' checked' : '';
            var pushChecked = localStorage.getItem('ssm-notif-push') === 'true' ? ' checked' : '';
            var prefsHtml = '<div class="notif-prefs">'
              + '<label class="notif-pref-toggle"><input type="checkbox" id="notif-pref-sound"' + soundChecked + '> Sound</label>'
              + '<label class="notif-pref-toggle"><input type="checkbox" id="notif-pref-push"' + pushChecked + '> Push</label>'
              + '</div>';
            dropdown.innerHTML = header + empty + items + '<div class="notif-dropdown-footer"><a href="/notifications">View all</a></div>' + prefsHtml;
            var markAll = document.getElementById('notif-mark-all');
            if (markAll) {
              markAll.addEventListener('click', function() {
                fetch('/api/notifications/read-all', { method: 'POST' })
                  .then(function() {
                    var badge = document.querySelector('.notif-badge');
                    if (badge) badge.remove();
                    dropdown.classList.remove('open');
                    updateFavicon(0);
                  });
              });
            }
            // Preference toggle handlers
            var soundCb = document.getElementById('notif-pref-sound');
            var pushCb = document.getElementById('notif-pref-push');
            if (soundCb) soundCb.addEventListener('change', function() {
              localStorage.setItem('ssm-notif-sound', soundCb.checked ? 'true' : 'false');
            });
            if (pushCb) pushCb.addEventListener('change', function() {
              if (pushCb.checked && 'Notification' in window && Notification.permission !== 'granted') {
                Notification.requestPermission().then(function(perm) {
                  if (perm !== 'granted') { pushCb.checked = false; return; }
                  localStorage.setItem('ssm-notif-push', 'true');
                });
              } else {
                localStorage.setItem('ssm-notif-push', pushCb.checked ? 'true' : 'false');
              }
            });
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

      // ─── Favicon badge ────────────────────────────────────────
      var baseFavicon = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="#ff79c6" stroke-width="1.5"><rect x="4" y="6" width="12" height="10" rx="2"/><circle cx="7.5" cy="11" r="1.5"/><circle cx="12.5" cy="11" r="1.5"/><path d="M10 2v4M6 6V4M14 6V4"/></svg>');
      var faviconLink = document.querySelector('link[rel="icon"]');

      function updateFavicon(count) {
        if (!faviconLink) return;
        if (count <= 0) {
          faviconLink.href = baseFavicon;
          return;
        }
        var label = count > 99 ? '99+' : String(count);
        var fontSize = label.length > 2 ? '7' : '8';
        var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="#ff79c6" stroke-width="1.5">'
          + '<rect x="4" y="6" width="12" height="10" rx="2"/><circle cx="7.5" cy="11" r="1.5"/><circle cx="12.5" cy="11" r="1.5"/><path d="M10 2v4M6 6V4M14 6V4"/>'
          + '<circle cx="15" cy="5" r="5" fill="#ff5555" stroke="none"/>'
          + '<text x="15" y="5" text-anchor="middle" dominant-baseline="central" fill="#fff" font-family="sans-serif" font-size="' + fontSize + '" font-weight="bold" stroke="none">' + label + '</text>'
          + '</svg>';
        faviconLink.href = 'data:image/svg+xml,' + encodeURIComponent(svg);
      }

      // ─── Notification sound (muted by default) ────────────────
      var sharedAudioCtx = null;
      function getAudioCtx() {
        if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
          sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        return sharedAudioCtx;
      }
      function playChime() {
        try {
          if (localStorage.getItem('ssm-notif-sound') !== 'true') return;
          var ctx = getAudioCtx();
          var osc = ctx.createOscillator();
          var gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.type = 'sine';
          osc.frequency.value = 880;
          gain.gain.value = 0.08;
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
          osc.start(ctx.currentTime);
          osc.stop(ctx.currentTime + 0.3);
        } catch(e) {}
      }

      // ─── Browser push notifications (opt-in) ──────────────────
      function showPushNotification(data) {
        try {
          if (localStorage.getItem('ssm-notif-push') !== 'true') return;
          if (!('Notification' in window) || Notification.permission !== 'granted') return;
          var title = (data && data.title) ? data.title : 'New notification';
          var body = (data && data.body) ? data.body : '';
          var n = new Notification(title, { body: body, icon: baseFavicon, tag: 'ssm-notif' });
          n.onclick = function() { window.focus(); n.close(); };
        } catch(e) {}
      }

      // ─── SSE event handlers ───────────────────────────────────
      es.addEventListener('notification', function(e) {
        if (!badge && bell) {
          badge = document.createElement('span');
          badge.className = 'notif-badge';
          badge.textContent = '1';
          bell.appendChild(badge);
        } else if (badge) {
          var count = parseInt(badge.textContent || '0', 10) + 1;
          badge.textContent = String(count);
        }
        var unread = badge ? parseInt(badge.textContent || '0', 10) : 0;
        updateFavicon(unread);
        playChime();
        try { showPushNotification(JSON.parse(e.data)); } catch(err) { showPushNotification(null); }
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
          updateFavicon(unread);
        } catch(err) {}
      });

      es.onerror = function() {};

      // Initialize favicon from current badge
      var initialCount = badge ? parseInt(badge.textContent || '0', 10) : 0;
      if (initialCount > 0) updateFavicon(initialCount);
    } catch(e) {}
  })();
  </script>
  <script>
  // Page transition: show loading overlay on internal navigation (fallback for
  // browsers without View Transitions API — Chrome 111+ uses the CSS
  // @view-transition rule in theme.ts instead)
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

    function isSamePageNav(a) {
      try {
        var url = new URL(a.href, window.location.origin);
        return url.pathname + url.search === window.location.pathname + window.location.search;
      } catch(e) { return false; }
    }

    function getSkeletonHtml(href) {
      try {
        var path = new URL(href, window.location.origin).pathname;
      } catch(e) { return defaultSkeleton(); }

      // Dashboard
      if (path === '/') {
        return '<div class="nav-loading-bar"></div>'
          + '<div class="skeleton skeleton-line" style="width:50%"></div>'
          + '<div style="display:flex;gap:16px;margin:16px 0">'
          + '<div class="skeleton skeleton-stat"></div>'
          + '<div class="skeleton skeleton-stat"></div>'
          + '<div class="skeleton skeleton-stat"></div>'
          + '</div>'
          + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;margin:16px 0">'
          + '<div class="skeleton skeleton-health"></div>'
          + '<div class="skeleton skeleton-health"></div>'
          + '<div class="skeleton skeleton-health"></div>'
          + '<div class="skeleton skeleton-health"></div>'
          + '</div>'
          + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:16px">'
          + '<div class="skeleton skeleton-widget"></div>'
          + '<div class="skeleton skeleton-widget"></div>'
          + '</div>';
      }

      // Session list: /c, /c/favorites, /c/archived, /c/search, /c/tag/*
      // (checked before conversation detail to avoid /c/tag/x matching the two-segment regex)
      if (path === '/c' || path.startsWith('/c/favorites') || path.startsWith('/c/archived')
          || path.startsWith('/c/search') || path.startsWith('/c/tag/')) {
        return '<div class="nav-loading-bar"></div>'
          + '<div class="skeleton skeleton-line" style="width:30%"></div>'
          + '<div class="skeleton skeleton-line" style="width:100%;height:40px;margin-bottom:16px"></div>'
          + '<div class="skeleton skeleton-session"></div>'
          + '<div class="skeleton skeleton-session"></div>'
          + '<div class="skeleton skeleton-session"></div>'
          + '<div class="skeleton skeleton-session"></div>'
          + '<div class="skeleton skeleton-session"></div>';
      }

      // Conversation detail: /c/:threadTs/:channelId
      if (new RegExp('^/c/[^/]+/[^/]+$').test(path)) {
        return '<div class="nav-loading-bar"></div>'
          + '<div class="skeleton skeleton-line" style="width:35%"></div>'
          + '<div class="skeleton skeleton-message tall"></div>'
          + '<div class="skeleton skeleton-message short"></div>'
          + '<div class="skeleton skeleton-message tall"></div>'
          + '<div class="skeleton skeleton-message short"></div>';
      }

      return defaultSkeleton();
    }

    function defaultSkeleton() {
      return '<div class="nav-loading-bar"></div>'
        + '<div class="skeleton skeleton-line" style="width:40%"></div>'
        + '<div class="skeleton skeleton-card"></div>'
        + '<div class="skeleton skeleton-card"></div>'
        + '<div class="skeleton skeleton-card"></div>';
    }

    function showLoadingOverlay(href) {
      var overlay = document.createElement('div');
      overlay.className = 'nav-loading-overlay';
      overlay.setAttribute('role', 'status');
      overlay.setAttribute('aria-label', 'Loading page');
      overlay.innerHTML = '<div class="nav-loading-skeleton">'
        + getSkeletonHtml(href || '')
        + '</div>';
      document.body.setAttribute('aria-busy', 'true');
      document.body.appendChild(overlay);
      // Safety timeout: remove overlay if navigation stalls (e.g. network error)
      setTimeout(function() {
        if (overlay.parentNode) {
          overlay.remove();
          document.body.removeAttribute('aria-busy');
        }
      }, 10000);
    }

    document.addEventListener('click', function(e) {
      var a = e.target.closest('a');
      if (!a || !isInternalLink(a)) return;
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;

      // Skip same-page navigations (hash anchors, current URL)
      if (isSamePageNav(a)) return;

      // Browsers with View Transitions API use the CSS @view-transition rule
      // automatically — no JS needed. Only show overlay for fallback browsers.
      if (!document.startViewTransition) {
        showLoadingOverlay(a.href);
      }
    });
  })();
  </script>
  <script>
  // Command palette (Ctrl+K)
  (function() {
    var palette = document.getElementById('cmd-palette');
    var input = document.getElementById('cmd-palette-input');
    var results = document.getElementById('cmd-palette-results');
    if (!palette || !input || !results) return;

    var activeIndex = -1;
    var items = [];
    var debounceTimer = null;
    var searchSeq = 0; // Monotonic counter to discard stale fetch responses

    // Static commands (filtered by auth state)
    var commands = [
      ${isAuthenticated ? "{ title: 'New Conversation', url: '/c/new', icon: 'plus', group: 'Actions' }," : ''}
      { title: 'Dashboard', url: '/', icon: 'home', group: 'Navigate' },
      ${isAuthenticated ? `{ title: 'Conversations', url: '/c', icon: 'message-circle', group: 'Navigate' },
      { title: 'Favorites', url: '/c/favorites', icon: 'star', group: 'Navigate' },
      { title: 'Notifications', url: '/notifications', icon: 'bell', group: 'Navigate' },
      { title: 'Archived', url: '/c/archived', icon: 'archive', group: 'Navigate' },` : ''}
    ].concat(${JSON.stringify(pluginPaletteEntries).replace(/<\//g, '<\\/')});

    function esc(s) {
      return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function open() {
      palette.style.display = '';
      input.value = '';
      input.focus();
      activeIndex = -1;
      renderDefault();
    }

    function close() {
      palette.style.display = 'none';
      input.value = '';
      activeIndex = -1;
    }

    function renderDefault() {
      var seq = ++searchSeq;
      // Show static commands + recent conversations
      var html = '<div class="cmd-palette-group">Actions</div>';
      commands.filter(function(c) { return c.group === 'Actions'; }).forEach(function(c) {
        html += '<a href="' + esc(c.url) + '" class="cmd-palette-item"><span class="cmd-item-title">' + esc(c.title) + '</span></a>';
      });
      html += '<div class="cmd-palette-group">Navigate</div>';
      commands.filter(function(c) { return c.group === 'Navigate'; }).forEach(function(c) {
        html += '<a href="' + esc(c.url) + '" class="cmd-palette-item"><span class="cmd-item-title">' + esc(c.title) + '</span></a>';
      });
      // Show Plugins group if any
      var pluginCmds = commands.filter(function(c) { return c.group === 'Plugins'; });
      if (pluginCmds.length > 0) {
        html += '<div class="cmd-palette-group">Plugins</div>';
        pluginCmds.forEach(function(c) {
          html += '<a href="' + esc(c.url) + '" class="cmd-palette-item"><span class="cmd-item-title">' + esc(c.title) + '</span></a>';
        });
      }
      ${isAuthenticated ? `// Fetch recent conversations
      fetch('/api/search?limit=5', { credentials: 'same-origin' })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (seq !== searchSeq) return; // stale response
          if (data.results && data.results.length > 0) {
            html += '<div class="cmd-palette-group">Recent</div>';
            data.results.forEach(function(r) {
              html += '<a href="' + esc(r.url) + '" class="cmd-palette-item"><span class="cmd-item-title">' + esc(r.title) + '</span></a>';
            });
          }
          results.innerHTML = html;
          items = results.querySelectorAll('.cmd-palette-item');
        })
        .catch(function() {
          if (seq !== searchSeq) return;
          results.innerHTML = html;
          items = results.querySelectorAll('.cmd-palette-item');
        });` : `results.innerHTML = html;
      items = results.querySelectorAll('.cmd-palette-item');`}
    }

    function doSearch(query) {
      var seq = ++searchSeq;
      var q = query.toLowerCase();
      // Filter static commands
      var matched = commands.filter(function(c) {
        return c.title.toLowerCase().indexOf(q) !== -1;
      });

      var commandsHtml = '';
      if (matched.length > 0) {
        commandsHtml += '<div class="cmd-palette-group">Commands</div>';
        matched.forEach(function(c) {
          commandsHtml += '<a href="' + esc(c.url) + '" class="cmd-palette-item"><span class="cmd-item-title">' + esc(c.title) + '</span></a>';
        });
      }

      // Search conversations
      fetch('/api/search?q=' + encodeURIComponent(query) + '&limit=5', { credentials: 'same-origin' })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (seq !== searchSeq) return; // stale response
          var html = commandsHtml;
          if (data.results && data.results.length > 0) {
            html += '<div class="cmd-palette-group">Conversations</div>';
            data.results.forEach(function(r) {
              html += '<a href="' + esc(r.url) + '" class="cmd-palette-item"><span class="cmd-item-title">' + esc(r.title) + '</span></a>';
            });
          }
          if (!html) {
            html = '<div class="cmd-palette-empty">No results for "' + esc(query) + '"</div>';
          }
          results.innerHTML = html;
          items = results.querySelectorAll('.cmd-palette-item');
          activeIndex = -1;
        })
        .catch(function() {
          if (seq !== searchSeq) return;
          var html = commandsHtml || '<div class="cmd-palette-empty">Search failed</div>';
          results.innerHTML = html;
          items = results.querySelectorAll('.cmd-palette-item');
        });
    }

    function setActive(idx) {
      items.forEach(function(el) { el.classList.remove('active'); });
      if (idx >= 0 && idx < items.length) {
        items[idx].classList.add('active');
        items[idx].scrollIntoView({ block: 'nearest' });
      }
      activeIndex = idx;
    }

    // Open on Ctrl+K
    document.addEventListener('keydown', function(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (palette.style.display === 'none') {
          open();
        } else {
          close();
        }
      }
    });

    // Close on backdrop click
    palette.querySelector('.cmd-palette-backdrop').addEventListener('click', close);

    // Focus trap: keep Tab within the palette while open
    palette.addEventListener('keydown', function(e) {
      if (e.key === 'Tab') {
        e.preventDefault();
        input.focus();
      }
    });

    // Close on Escape and handle navigation
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive(Math.min((activeIndex + 1), items.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive(Math.max(activeIndex - 1, 0));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (activeIndex >= 0 && items[activeIndex]) {
          items[activeIndex].click();
        } else if (items.length > 0) {
          items[0].click();
        }
        close();
        return;
      }
    });

    // Debounced search on input
    input.addEventListener('input', function() {
      var q = input.value.trim();
      clearTimeout(debounceTimer);
      if (!q) {
        renderDefault();
        return;
      }
      debounceTimer = setTimeout(function() { doSearch(q); }, 150);
    });
  })();
  </script>
  <script>
  // Auto-hide top nav on scroll down, show on scroll up (mobile)
  (function() {
    var nav = document.querySelector('.nav-bar');
    if (!nav || window.innerWidth > 640) return;
    var lastY = window.scrollY;
    var threshold = 10;
    window.addEventListener('scroll', function() {
      var y = window.scrollY;
      if (y > lastY + threshold && y > 60) {
        nav.classList.add('nav-hidden');
      } else if (y < lastY - threshold) {
        nav.classList.remove('nav-hidden');
      }
      lastY = y;
    }, { passive: true });
  })();
  </script>
  <script>
  // Pull-to-refresh on dashboard and session list (mobile)
  (function() {
    if (window.innerWidth > 640) return;
    var path = window.location.pathname;
    if (path !== '/' && path !== '/c') return;
    var indicator = document.createElement('div');
    indicator.className = 'pull-indicator';
    indicator.textContent = 'Pull to refresh';
    var main = document.querySelector('main');
    if (main && main.parentNode) main.parentNode.insertBefore(indicator, main);

    var startY = 0;
    var pulling = false;
    document.addEventListener('touchstart', function(e) {
      if (window.scrollY > 5) return;
      startY = e.touches[0].clientY;
      pulling = false;
    }, { passive: true });
    document.addEventListener('touchmove', function(e) {
      if (window.scrollY > 5) return;
      var dy = e.touches[0].clientY - startY;
      if (dy > 30 && dy < 150) {
        pulling = true;
        indicator.classList.add('pulling');
        indicator.textContent = dy > 80 ? 'Release to refresh' : 'Pull to refresh';
      }
    }, { passive: true });
    document.addEventListener('touchend', function() {
      if (!pulling) return;
      pulling = false;
      if (indicator.textContent === 'Release to refresh') {
        indicator.classList.remove('pulling');
        indicator.classList.add('refreshing');
        indicator.textContent = 'Refreshing...';
        window.location.reload();
      } else {
        indicator.classList.remove('pulling');
      }
    });
  })();
  </script>
  ${getKeyboardShortcutScript()}
  ${scripts}
  ${getKeyboardHelpOverlay()}
</body>
</html>`;
}

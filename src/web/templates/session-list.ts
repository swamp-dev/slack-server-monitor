/**
 * Session list page template
 */

import type { SessionSummary, PaginationInfo, TagInfo } from '../../services/conversation-store.js';
import { escapeHtml, formatTimestamp } from './utils.js';
import { icon } from './icons.js';
import { wrapInShell } from './shell.js';

// ─── Session List ──────────────────────────────────────────────────────

/**
 * Additional styles for the session list page
 */
const sessionListStyles = `
  .nav-tabs {
    display: flex;
    gap: 0;
    border-bottom: 2px solid var(--border);
    margin-bottom: 24px;
  }
  .nav-tabs a {
    padding: 10px 20px;
    color: var(--text-muted);
    text-decoration: none;
    border-bottom: 2px solid transparent;
    margin-bottom: -2px;
    font-size: 0.9375rem;
    transition: color 0.2s;
  }
  .nav-tabs a.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }
  .nav-tabs a:hover:not(.active) {
    color: var(--text);
  }
  .session-card {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px;
    margin-bottom: 8px;
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 10px;
    text-decoration: none;
    color: var(--text);
    transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s;
    position: relative;
  }
  .session-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px var(--shadow);
    border-color: var(--surface-hover);
    text-decoration: none;
  }
  /* Active indicator: green dot for recent conversations */
  .session-card.is-active {
    border-left: 3px solid var(--green);
  }
  .active-dot {
    width: 8px;
    height: 8px;
    background: var(--green);
    border-radius: 50%;
    display: inline-block;
    margin-right: 6px;
    animation: pulse-dot 2s ease-in-out infinite;
    flex-shrink: 0;
  }
  @keyframes pulse-dot {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
  /* Date section headers */
  .date-section {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 12px 0 6px;
    margin-top: 8px;
    border-bottom: 1px solid var(--border);
    margin-bottom: 8px;
  }
  .date-section:first-child {
    margin-top: 0;
  }
  /* Preview tooltip */
  .session-card .preview-tooltip {
    display: none;
    position: absolute;
    left: 16px;
    right: 16px;
    bottom: calc(100% + 6px);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 0.8125rem;
    color: var(--text-muted);
    line-height: 1.4;
    z-index: 10;
    box-shadow: 0 4px 12px var(--shadow);
    pointer-events: none;
    max-height: 60px;
    overflow: hidden;
  }
  .session-card:hover .preview-tooltip {
    display: block;
  }
  /* Message count visual weight */
  .msg-count-heavy {
    font-weight: 700;
    color: var(--text);
  }
  .session-card-body {
    flex: 1;
    min-width: 0;
  }
  .session-card-title {
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .session-meta {
    color: var(--text-muted);
    font-size: 0.8125rem;
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 4px;
    flex-wrap: wrap;
  }
  .session-meta svg { flex-shrink: 0; }
  .session-stats {
    text-align: right;
    font-size: 0.8125rem;
    color: var(--text-muted);
    display: flex;
    flex-direction: column;
    gap: 2px;
    align-items: flex-end;
  }
  /* Boost metadata contrast in dark theme */
  [data-theme="dracula"] .session-meta,
  [data-theme="dracula"] .session-stats {
    color: var(--text-muted-boost);
  }
  .session-stat {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .pagination {
    display: flex;
    justify-content: center;
    gap: 16px;
    margin-top: 24px;
    padding: 16px 0;
  }
  .pagination a, .pagination span {
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 0.875rem;
    text-decoration: none;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .pagination a {
    background: var(--card-bg);
    color: var(--text);
    border: 1px solid var(--border);
    transition: background 0.2s;
  }
  .pagination a:hover {
    background: var(--surface);
  }
  .pagination span {
    color: var(--text-muted);
  }
  .empty-state {
    text-align: center;
    padding: 60px 20px;
    color: var(--text-muted);
  }
  .empty-state svg { margin-bottom: 16px; color: var(--surface-hover); }
  .empty-title {
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--text);
    margin-bottom: 8px;
  }
  .empty-subtext {
    font-size: 0.875rem;
    color: var(--text-muted);
  }
  .empty-subtext a { color: var(--link); }
  .empty-subtext code {
    padding: 2px 6px;
    background: var(--code-bg);
    border-radius: 4px;
    font-size: 0.8125em;
  }
  .search-form {
    display: flex;
    gap: 8px;
    margin-bottom: 16px;
  }
  .search-input-wrapper {
    flex: 1;
    position: relative;
    display: flex;
    align-items: center;
  }
  .search-input-wrapper svg {
    position: absolute;
    left: 12px;
    color: var(--text-muted);
    pointer-events: none;
  }
  .search-input {
    width: 100%;
    padding: 10px 14px 10px 38px;
    font-size: 0.9375rem;
    font-family: inherit;
    background: var(--code-bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    outline: none;
    transition: border-color 0.2s;
  }
  .search-input:focus {
    border-color: var(--accent);
  }
  .search-btn {
    padding: 10px 20px;
    font-size: 0.9375rem;
    font-family: inherit;
    color: #fff;
    background: linear-gradient(135deg, var(--accent), var(--accent-secondary));
    border: none;
    border-radius: 6px;
    cursor: pointer;
    transition: opacity 0.2s;
  }
  .search-btn:hover {
    opacity: 0.9;
  }
  /* Mobile: icon-only search button */
  @media (max-width: 640px) {
    .search-btn {
      padding: 10px 12px;
    }
    .search-btn-text {
      display: none;
    }
  }
  .favorite-star {
    color: var(--text-muted);
    font-size: 1.4rem;
    padding: 4px 6px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    line-height: 1;
    transition: transform 0.2s;
  }
  .favorite-star.active {
    color: var(--yellow);
  }
  .tag {
    display: inline-block;
    padding: 2px 8px;
    font-size: 0.6875rem;
    background: rgba(139, 233, 253, 0.1);
    color: var(--cyan);
    border-radius: 10px;
    margin-left: 4px;
  }
  .session-layout {
    display: flex;
    gap: 20px;
  }
  .session-list {
    flex: 1;
    min-width: 0;
  }
  .tag-sidebar {
    width: 180px;
    flex-shrink: 0;
  }
  .tag-sidebar h3 {
    font-size: 0.875rem;
    color: var(--text-muted);
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .tag-link {
    display: block;
    padding: 6px 10px;
    font-size: 0.8125rem;
    color: var(--text);
    text-decoration: none;
    border-radius: 4px;
    transition: background 0.2s;
  }
  .tag-link:hover {
    background: var(--surface);
  }
  .tag-link.active {
    background: var(--surface);
    color: var(--cyan);
  }
  .tag-count {
    color: var(--text-muted);
    font-size: 0.75rem;
  }
  @media (max-width: 640px) {
    .session-layout {
      flex-direction: column;
    }
    .tag-sidebar {
      width: 100%;
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .tag-sidebar h3 {
      width: 100%;
    }
  }
  /* Collapsible tag sidebar */
  .tag-sidebar-toggle {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 2px;
    display: inline-flex;
    align-items: center;
    margin-left: auto;
    transition: color 0.2s;
  }
  .tag-sidebar-toggle:hover {
    color: var(--text);
  }
  .tag-sidebar-toggle svg {
    transition: transform 0.2s;
  }
  .tag-sidebar.collapsed {
    width: auto;
  }
  .tag-sidebar.collapsed .tag-link {
    display: none;
  }
  .tag-sidebar.collapsed .tag-sidebar-toggle svg {
    transform: rotate(-90deg);
  }
  @media (max-width: 640px) {
    .tag-sidebar-toggle { display: none; }
  }
`;

// ─── Session List ─────────────────────────────────────────────────────

/**
 * Options for rendering the session list page
 */
interface SessionListOptions {
  archived?: boolean;
  favorites?: boolean;
  searchQuery?: string;
  activeTag?: string;
  allTags?: TagInfo[];
  currentUserId?: string;
  showMine?: boolean;
}

/**
 * Render the session list page
 */
export function renderSessionList(
  sessions: SessionSummary[],
  pagination: PaginationInfo,
  options: SessionListOptions = {}
): string {
  const isArchived = options.archived ?? false;
  const isFavorites = options.favorites ?? false;
  const searchQuery = options.searchQuery ?? '';
  const activeTag = options.activeTag;
  const allTags = options.allTags ?? [];
  const currentUserId = options.currentUserId;
  const isSlackUser = currentUserId?.startsWith('U') ?? false;
  const showMine = options.showMine ?? isSlackUser;

  let title = 'Conversations';
  if (isArchived) title = 'Archived Conversations';
  else if (isFavorites) title = 'Favorite Conversations';
  else if (searchQuery) title = 'Search Results';
  else if (activeTag) title = `Tagged: ${activeTag}`;

  let basePath = '/c';
  if (isArchived) basePath = '/c/archived';
  else if (isFavorites) basePath = '/c/favorites';

  const searchForm = `
    <form class="search-form" action="/c/search" method="GET">
      <div class="search-input-wrapper">
        ${icon('search', 16)}
        <input type="text" name="q" placeholder="Search conversations..." value="${escapeHtml(searchQuery)}" class="search-input">
      </div>
      <button type="submit" class="search-btn">${icon('search', 16)} <span class="search-btn-text">Search</span></button>
    </form>
    <div class="search-hint" id="search-hint" style="display:none">
      ${icon('search', 12)} You can also press <kbd>\u2318K</kbd> for the command palette \u2014 it searches conversations too.
    </div>`;

  let emptyHtml = '';
  if (sessions.length === 0) {
    let emptyIcon = icon('message-circle', 64);
    let emptyTitle = 'No conversations yet';
    let emptySubtext = 'Start one from Slack with <code>/ask</code> or <a href="/c/new">from the web</a>';

    if (isFavorites) {
      emptyIcon = icon('star', 64);
      emptyTitle = 'No favorites yet';
      emptySubtext = 'Star a conversation to find it here quickly';
    } else if (isArchived) {
      emptyIcon = icon('archive', 64);
      emptyTitle = 'No archived conversations';
      emptySubtext = 'Archived conversations appear here';
    } else if (searchQuery) {
      emptyIcon = icon('search', 64);
      emptyTitle = `No results for "${escapeHtml(searchQuery)}"`;
      emptySubtext = 'Try a different search term';
    } else if (activeTag) {
      emptyIcon = icon('tag', 64);
      emptyTitle = `No conversations tagged "${escapeHtml(activeTag)}"`;
      emptySubtext = 'Add tags from the conversation detail page';
    }

    emptyHtml = `<div class="empty-state">${emptyIcon}<div class="empty-title">${emptyTitle}</div><div class="empty-subtext">${emptySubtext}</div><p class="empty-hint">Tip: Press <kbd>\u2318K</kbd> to quickly search and navigate</p></div>`;
  }

  // Group sessions by date section
  function getDateSection(ts: number): string {
    const now = new Date();
    const date = new Date(ts);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 86400000);
    const weekAgo = new Date(today.getTime() - 7 * 86400000);

    if (date >= today) return 'Today';
    if (date >= yesterday) return 'Yesterday';
    if (date >= weekAgo) return 'This Week';
    return 'Older';
  }

  function formatRelativeTime(ts: number): string {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${String(mins)}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${String(hours)}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${String(days)}d ago`;
    return formatTimestamp(ts);
  }

  const ACTIVE_THRESHOLD = 5 * 60 * 1000; // 5 minutes

  const sessionRows = sessions.length === 0
    ? emptyHtml
    : (() => {
        let lastSection = '';
        return sessions.map((s, i) => {
          const link = `/c/${encodeURIComponent(s.threadTs)}/${encodeURIComponent(s.channelId)}`;
          const relTime = formatRelativeTime(s.updatedAt);
          const starClass = s.isFavorited ? 'favorite-star active' : 'favorite-star';
          const tagPills = (s.tags ?? []).map((t) =>
            `<span class="tag">${escapeHtml(t)}</span>`
          ).join('');
          const sessionTitle = s.firstMessage ? escapeHtml(s.firstMessage) : `${escapeHtml(s.userId)} &middot; ${escapeHtml(s.channelId)}`;
          const isActive = Date.now() - s.updatedAt < ACTIVE_THRESHOLD;
          const activeDot = isActive ? '<span class="active-dot"></span>' : '';
          const activeClass = isActive ? ' is-active' : '';
          const msgCountClass = s.messageCount >= 10 ? ' msg-count-heavy' : '';

          // Preview tooltip: show truncated first message
          const preview = s.firstMessage
            ? `<div class="preview-tooltip">${escapeHtml(s.firstMessage.slice(0, 120))}${s.firstMessage.length > 120 ? '...' : ''}</div>`
            : '';

          // Date section header
          const section = getDateSection(s.updatedAt);
          const sectionHeader = section !== lastSection
            ? `<div class="date-section">${escapeHtml(section)}</div>`
            : '';
          lastSection = section;

          return `${sectionHeader}<a href="${escapeHtml(link)}" class="session-card${activeClass}" data-index="${String(i)}" data-updated="${String(s.updatedAt)}" data-conv-id="${String(s.id)}">
            ${preview}
            <div class="session-card-body">
              <div class="session-card-title">${activeDot}<span class="${starClass}" data-id="${String(s.id)}" tabindex="0" role="button" aria-label="Toggle favorite">&#9733;</span> ${sessionTitle}</div>
              <div class="session-meta">${icon('clock', 14)} <span class="relative-time" data-ts="${String(s.updatedAt)}">${relTime}</span>${tagPills ? ` ${tagPills}` : ''}</div>
            </div>
            <div class="session-stats">
              <span class="session-stat${msgCountClass}">${icon('message-circle', 14)} ${String(s.messageCount)} msgs</span>
              <span class="session-stat">${icon('wrench', 14)} ${String(s.toolCallCount)} tools</span>
            </div>
          </a>`;
        }).join('\n');
      })();

  const tagSidebar = allTags.length > 0
    ? `<div class="tag-sidebar">
        <h3>${icon('tag', 14)} Tags <button class="tag-sidebar-toggle" type="button" aria-label="Toggle tags">${icon('chevron-down', 14)}</button></h3>
        ${allTags.map((t) =>
          `<a href="/c/tag/${encodeURIComponent(t.name)}" class="tag-link${activeTag === t.name ? ' active' : ''}">${escapeHtml(t.name)} <span class="tag-count">(${String(t.count)})</span></a>`
        ).join('\n')}
      </div>`
    : '';

  const paginationHtml = pagination.totalPages > 1
    ? `<div class="pagination">
        ${pagination.page > 1
          ? `<a href="${basePath}?page=${String(pagination.page - 1)}&pageSize=${String(pagination.pageSize)}${searchQuery ? `&q=${encodeURIComponent(searchQuery)}` : ''}">${icon('arrow-left', 14)} Previous</a>`
          : '<span>Previous</span>'}
        <span>Page ${String(pagination.page)} of ${String(pagination.totalPages)}</span>
        ${pagination.page < pagination.totalPages
          ? `<a href="${basePath}?page=${String(pagination.page + 1)}&pageSize=${String(pagination.pageSize)}${searchQuery ? `&q=${encodeURIComponent(searchQuery)}` : ''}">Next</a>`
          : '<span>Next</span>'}
      </div>`
    : '';

  const starScript = `
  <script>
  (function() {
    document.querySelectorAll('.favorite-star').forEach(function(star) {
      star.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        var id = star.getAttribute('data-id');
        fetch('/c/' + id + '/favorite', { method: 'POST', credentials: 'same-origin' })
          .then(function(res) { return res.json(); })
          .then(function(data) {
            if (data.isFavorited) {
              star.classList.add('active');
            } else {
              star.classList.remove('active');
            }
            star.classList.add('animate-star-pop');
            setTimeout(function() { star.classList.remove('animate-star-pop'); }, 300);
            showToast(data.isFavorited ? 'Added to favorites' : 'Removed from favorites');
          });
      });
    });
  })();
  </script>`;

  const bodyHtml = `
  <main class="container">
    <h1>${escapeHtml(title)}</h1>
    ${searchForm}
    <nav class="nav-tabs">
      ${currentUserId ? `
        <a href="/c?mine=true" class="${!isArchived && !isFavorites && !activeTag && !searchQuery && showMine ? 'active' : ''}">Mine</a>
        <a href="/c?mine=false" class="${!isArchived && !isFavorites && !activeTag && !searchQuery && !showMine ? 'active' : ''}">All</a>
      ` : `
        <a href="/c" class="${!isArchived && !isFavorites && !activeTag && !searchQuery ? 'active' : ''}">All</a>
      `}
      <a href="/c/favorites" class="${isFavorites ? 'active' : ''}">Favorites</a>
      <a href="/c/archived" class="${isArchived ? 'active' : ''}">${icon('archive', 14)} Archived</a>
    </nav>
    <div class="session-layout">
      ${tagSidebar}
      <div class="session-list">
        ${sessionRows}
      </div>
    </div>
    ${paginationHtml}
  </main>`;

  const timeUpdateScript = `
  <script>
  (function() {
    function formatRelative(ts) {
      var diff = Date.now() - ts;
      var mins = Math.floor(diff / 60000);
      if (mins < 1) return 'just now';
      if (mins < 60) return mins + 'm ago';
      var hours = Math.floor(mins / 60);
      if (hours < 24) return hours + 'h ago';
      var days = Math.floor(hours / 24);
      if (days < 7) return days + 'd ago';
      return null; // stop updating after a week
    }
    function updateTimes() {
      document.querySelectorAll('.relative-time').forEach(function(el) {
        var ts = parseInt(el.getAttribute('data-ts') || '0', 10);
        if (!ts) return;
        var text = formatRelative(ts);
        if (text) el.textContent = text;
      });
    }
    setInterval(updateTimes, 30000);
  })();
  </script>`;

  const swipeScript = `
  <script>
  // Swipe gestures on session cards (mobile: right→favorite, left→archive)
  (function() {
    if (window.innerWidth > 640) return;
    document.querySelectorAll('.session-card').forEach(function(card) {
      var startX = 0;
      var startY = 0;
      var swiping = false;
      var convId = card.getAttribute('data-conv-id');
      if (!convId) return;

      card.style.position = 'relative';
      card.addEventListener('touchstart', function(e) {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        swiping = false;
      }, { passive: true });

      card.addEventListener('touchmove', function(e) {
        var dx = e.touches[0].clientX - startX;
        var dy = e.touches[0].clientY - startY;
        if (Math.abs(dx) > 15 && Math.abs(dx) > Math.abs(dy) * 1.5) {
          swiping = true;
          card.classList.add('swiping');
          card.style.transform = 'translateX(' + dx + 'px)';
        }
      }, { passive: true });

      card.addEventListener('touchend', function(e) {
        card.classList.remove('swiping');
        if (!swiping) { card.style.transform = ''; return; }
        var dx = parseFloat(card.style.transform.replace('translateX(', '').replace('px)', '')) || 0;
        card.style.transform = '';
        swiping = false;

        if (dx > 60) {
          // Swipe right → favorite
          e.preventDefault();
          fetch('/c/' + convId + '/favorite', { method: 'POST', credentials: 'same-origin' })
            .then(function(r) { return r.json(); })
            .then(function(data) {
              if (typeof showToast === 'function') showToast(data.isFavorited ? 'Favorited' : 'Unfavorited');
            });
        } else if (dx < -60) {
          // Swipe left → archive
          e.preventDefault();
          fetch('/c/' + convId + '/archive', { method: 'POST', credentials: 'same-origin' })
            .then(function(r) { return r.json(); })
            .then(function(data) {
              if (data.archived) {
                card.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
                card.style.transform = 'translateX(-100%)';
                card.style.opacity = '0';
                setTimeout(function() { card.remove(); }, 300);
                if (typeof showToast === 'function') showToast('Archived');
              }
            });
        }
      });

      card.addEventListener('touchcancel', function() {
        swiping = false;
        card.classList.remove('swiping');
        card.style.transform = '';
      });
    });
  })();
  </script>`;

  const tagToggleScript = `
  <script>
  // Collapsible tag sidebar with localStorage persistence
  (function() {
    var sidebar = document.querySelector('.tag-sidebar');
    var toggle = document.querySelector('.tag-sidebar-toggle');
    if (!sidebar || !toggle) return;
    try {
      if (localStorage.getItem('ssm-tag-sidebar-collapsed') === 'true') {
        sidebar.classList.add('collapsed');
      }
    } catch(e) {}
    toggle.setAttribute('aria-expanded', String(!sidebar.classList.contains('collapsed')));
    toggle.addEventListener('click', function() {
      sidebar.classList.toggle('collapsed');
      toggle.setAttribute('aria-expanded', String(!sidebar.classList.contains('collapsed')));
      try {
        localStorage.setItem('ssm-tag-sidebar-collapsed', sidebar.classList.contains('collapsed') ? 'true' : 'false');
      } catch(e) {}
    });
  })();
  </script>`;

  const searchHintScript = `
  <script>
  (function() {
    var hint = document.getElementById('search-hint');
    if (!hint) return;
    try {
      var dismissed = localStorage.getItem('ssm-hints-dismissed') === 'true';
      if (!dismissed) hint.style.display = '';
    } catch(e) {}
  })();
  </script>`;

  return wrapInShell({
    title,
    styles: sessionListStyles,
    body: bodyHtml,
    scripts: starScript + timeUpdateScript + swipeScript + tagToggleScript + searchHintScript,
    currentPath: '/c',
  });
}

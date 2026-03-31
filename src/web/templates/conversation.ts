/**
 * Conversation detail page template
 */

import type { ConversationMessage, ToolCallLog } from '../../services/conversation-store.js';
import { escapeHtml, formatMarkdown, formatTimestamp } from './utils.js';
import { icon } from './icons.js';
import { wrapInShell } from './shell.js';

// ─── Conversation Detail ───────────────────────────────────────────────

/**
 * Dracula accent colors for user avatar hashing
 */
const AVATAR_COLORS = ['#8be9fd', '#50fa7b', '#ffb86c', '#ff79c6', '#bd93f9', '#f1fa8c'];

/**
 * Simple hash function to map a string to one of the accent colors
 */
function avatarColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash + userId.charCodeAt(i)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length] ?? '#8be9fd';
}

/**
 * Render a single message
 */
function renderMessage(message: ConversationMessage, userId?: string): string {
  const roleClass = message.role;
  const roleLabel = message.role === 'user' ? 'You' : 'Claude';
  const content = formatMarkdown(message.content);

  let avatarContent: string;
  if (message.role === 'user') {
    const initial = userId ? userId.charAt(0).toUpperCase() : roleLabel.charAt(0);
    const color = userId ? avatarColor(userId) : 'var(--cyan)';
    avatarContent = `<span class="avatar" style="background: ${color}; color: var(--bg);">${escapeHtml(initial)}</span>`;
  } else {
    avatarContent = `<span class="avatar avatar-glow">${icon('robot', 16)}</span>`;
  }

  return `
    <div class="message ${roleClass}">
      <div class="message-header">${avatarContent}${roleLabel}</div>
      <div class="message-content">${content}</div>
    </div>
  `;
}

/**
 * Format a tool call timestamp as time only
 */
function formatToolTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * Render tool calls section with collapsible details
 */
function renderToolCalls(toolCalls: ToolCallLog[]): string {
  if (toolCalls.length === 0) {
    return '';
  }

  const successCount = toolCalls.filter((tc) => tc.success).length;
  const failureCount = toolCalls.length - successCount;
  const totalDurationMs = toolCalls.reduce((sum, tc) => sum + (tc.durationMs ?? 0), 0);
  const totalDuration = totalDurationMs >= 1000
    ? `${(totalDurationMs / 1000).toFixed(1)}s`
    : `${String(totalDurationMs)}ms`;

  const statusSummary = failureCount > 0
    ? `<span class="tool-calls-summary-stat success">${icon('check', 12)} ${String(successCount)}</span><span class="tool-calls-summary-stat failure">${icon('x', 12)} ${String(failureCount)}</span>`
    : `<span class="tool-calls-summary-stat success">${icon('check', 12)} ${String(successCount)}</span>`;

  const toolCallsHtml = toolCalls
    .map((tc) => {
      const inputJson = JSON.stringify(tc.input, null, 2);
      const time = formatToolTime(tc.timestamp);
      const outputHtml = tc.outputPreview
        ? `<div class="tool-call-output"><strong>Output:</strong> ${escapeHtml(tc.outputPreview)}</div>`
        : '';

      const statusIcon = tc.success
        ? `<span class="tool-call-status success">${icon('check', 14)}</span>`
        : `<span class="tool-call-status failure">${icon('x', 14)}</span>`;

      const durationBadge = tc.durationMs != null
        ? `<span class="tool-call-duration">${String(tc.durationMs)}ms</span>`
        : '';

      return `
        <details class="tool-call">
          <summary class="tool-call-header">
            <span class="tool-call-name">${escapeHtml(tc.toolName)}</span>
            <span class="tool-call-meta">${statusIcon}${durationBadge}<span class="tool-call-time">${time}</span></span>
          </summary>
          <div class="tool-call-content">
            <strong>Input:</strong>
            <pre><code class="language-json">${escapeHtml(inputJson)}</code></pre>
            ${outputHtml}
          </div>
        </details>
      `;
    })
    .join('\n');

  return `
    <details class="tool-calls-wrapper" id="tool-calls-wrapper">
      <summary class="tool-calls-summary">
        ${icon('wrench', 16)} <span>Tool Calls (${String(toolCalls.length)})</span>
        <span class="tool-calls-summary-stats">${statusSummary}<span class="tool-calls-summary-duration">${icon('clock', 12)} ${totalDuration}</span></span>
      </summary>
      <div class="tool-calls">
        ${toolCallsHtml}
      </div>
    </details>
  `;
}

/**
 * Render the continue conversation form
 */
function renderContinueForm(): string {
  return `
    <div class="continue-form">
      <h2>${icon('send', 18)} Continue Conversation</h2>
      <form id="continue-form">
        <textarea id="continue-input" placeholder="Ask a follow-up question..." maxlength="4000" required></textarea>
        <div class="char-count" id="char-count">0 / 4000</div>
        <div class="continue-form-actions">
          <button type="submit" id="continue-submit">${icon('send', 16)} Ask Claude</button>
        </div>
        <div class="continue-spinner" id="continue-spinner">Processing... This may take a moment.</div>
        <div class="continue-error" id="continue-error"></div>
      </form>
    </div>
  `;
}

/**
 * Render the continue form JavaScript with SSE streaming support
 */
function renderContinueScript(): string {
  return `
    (function() {
      var form = document.getElementById('continue-form');
      var input = document.getElementById('continue-input');
      var submitBtn = document.getElementById('continue-submit');
      var spinner = document.getElementById('continue-spinner');
      var errorDiv = document.getElementById('continue-error');
      var charCount = document.getElementById('char-count');
      if (!form) return;

      if (input && charCount) {
        input.addEventListener('input', function() {
          var len = input.value.length;
          charCount.textContent = len + ' / 4000';
          charCount.className = 'char-count' + (len > 3800 ? ' danger' : len > 3000 ? ' warning' : '');
        });
      }

      function escapeHtml(s) {
        return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      }

      form.addEventListener('submit', function(e) {
        e.preventDefault();
        var message = input.value.trim();
        if (!message) return;

        submitBtn.disabled = true;
        spinner.style.display = 'block';
        spinner.textContent = 'Connecting to Claude...';
        errorDiv.style.display = 'none';
        input.value = '';

        // Add user message to the conversation
        var mainEl = document.querySelector('.container main') || document.querySelector('main');
        var userMsg = document.createElement('div');
        userMsg.className = 'message user';
        userMsg.innerHTML = '<div class="message-header">You</div><div class="message-content">' + escapeHtml(message) + '</div>';
        if (mainEl) mainEl.insertBefore(userMsg, document.querySelector('.continue-form'));

        // Create streaming area for tool calls and response
        var streamArea = document.createElement('div');
        streamArea.id = 'stream-area';
        if (mainEl) mainEl.insertBefore(streamArea, document.querySelector('.continue-form'));

        fetch(window.location.pathname + '/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: message }),
          credentials: 'same-origin'
        })
        .then(function(res) { return res.json().then(function(data) { return { ok: res.ok, data: data }; }); })
        .then(function(result) {
          if (!result.ok) {
            errorDiv.textContent = result.data.error || 'An error occurred';
            errorDiv.style.display = 'block';
            submitBtn.disabled = false;
            spinner.style.display = 'none';
            return;
          }

          // Open SSE stream (30s fallback matches heartbeat interval)
          var fallbackTimer = setTimeout(function() { window.location.reload(); }, 30000);
          var es;
          try {
            es = new EventSource(window.location.pathname + '/stream');
          } catch(err) {
            setTimeout(function() { window.location.reload(); }, 3000);
            return;
          }

          var gotEvents = false;
          var toolCardIndex = 0;

          es.addEventListener('tool_call_start', function(e) {
            gotEvents = true;
            try {
              var data = JSON.parse(e.data);
              spinner.textContent = 'Running ' + data.toolName + '...';
              var card = document.createElement('div');
              card.className = 'tool-call-streaming';
              card.setAttribute('data-tc-index', String(toolCardIndex++));
              card.innerHTML = '<span class="streaming-spinner"></span> <span class="tool-call-name">' + escapeHtml(data.toolName) + '</span>';
              streamArea.appendChild(card);
            } catch(err) {}
          });

          es.addEventListener('tool_call_end', function(e) {
            try {
              var data = JSON.parse(e.data);
              // Find the last streaming card (most recent in-progress tool)
              var cards = streamArea.querySelectorAll('.tool-call-streaming');
              var card = cards.length > 0 ? cards[cards.length - 1] : null;
              if (card) {
                var statusClass = data.isError ? 'failure' : 'success';
                var statusIcon = data.isError ? '✗' : '✓';
                card.className = 'tool-call-complete';
                card.innerHTML = '<span class="tool-call-status ' + statusClass + '">' + statusIcon + '</span> '
                  + '<span class="tool-call-name">' + escapeHtml(data.toolName) + '</span>'
                  + ' <span class="tool-call-duration">' + data.durationMs + 'ms</span>';
              }
            } catch(err) {}
          });

          es.addEventListener('text', function(e) {
            gotEvents = true;
            spinner.textContent = 'Finalizing response...';
          });

          es.addEventListener('done', function() {
            clearTimeout(fallbackTimer);
            es.close();
            es.onerror = null;
            window.location.reload();
          });

          es.addEventListener('error', function(e) {
            if (e.data) {
              try {
                var data = JSON.parse(e.data);
                errorDiv.textContent = data.message || 'An error occurred';
                errorDiv.style.display = 'block';
              } catch(err) {}
            }
            clearTimeout(fallbackTimer);
            es.close();
            es.onerror = null;
            submitBtn.disabled = false;
            spinner.style.display = 'none';
            if (!gotEvents) {
              setTimeout(function() { window.location.reload(); }, 3000);
            }
          });

          es.onerror = function() {
            if (!gotEvents) {
              clearTimeout(fallbackTimer);
              es.close();
              es.onerror = null;
              setTimeout(function() { window.location.reload(); }, 3000);
            }
          };
        })
        .catch(function(err) {
          errorDiv.textContent = 'Network error: ' + err.message;
          errorDiv.style.display = 'block';
          submitBtn.disabled = false;
          spinner.style.display = 'none';
        });
      });
    })();
  `;
}

/**
 * Additional styles for the conversation detail page
 */
const conversationDetailStyles = `
  .conv-header {
    position: sticky;
    top: 48px;
    z-index: 50;
    background: var(--card-bg);
    border-bottom: 1px solid var(--border);
    padding: 8px 24px;
  }
  .conv-header-compact .conv-header {
    padding: 8px;
  }
  .conv-header-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }
  .conv-back {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--link);
    text-decoration: none;
    font-size: 0.875rem;
  }
  .conv-back:hover { text-decoration: underline; }
  .detail-favorite-star {
    color: var(--text-muted);
    font-size: 1.4rem;
    padding: 4px 6px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    line-height: 1;
    border: none;
    background: none;
    transition: transform 0.2s;
  }
  .detail-favorite-star.active {
    color: var(--yellow);
  }
  .tag-input-form {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    margin-top: 8px;
  }
  .tag-input-form input {
    padding: 4px 8px;
    font-size: 0.8125rem;
    font-family: inherit;
    background: var(--code-bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text);
    outline: none;
    width: 140px;
    transition: border-color 0.2s;
  }
  .tag-input-form input:focus {
    border-color: var(--accent);
  }
  .tag-input-form button {
    padding: 4px 10px;
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
  .detail-tags {
    margin-top: 8px;
  }
  .detail-tags .tag {
    display: inline-block;
    padding: 2px 8px;
    font-size: 0.6875rem;
    background: rgba(139, 233, 253, 0.1);
    color: var(--cyan);
    border-radius: 10px;
    margin-right: 4px;
  }
  .archive-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    font-size: 0.8125rem;
    font-family: inherit;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.2s, border-color 0.2s;
  }
  .archive-btn:hover {
    background: rgba(255, 85, 85, 0.15);
    border-color: var(--red);
  }

  /* Streaming tool call cards */
  .tool-call-streaming {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    margin: 6px 0;
    background: var(--card-bg);
    border: 1px solid var(--yellow);
    border-radius: 8px;
    font-size: 0.875rem;
    animation: pulse-border 1.5s ease-in-out infinite;
  }

  @keyframes pulse-border {
    0%, 100% { border-color: var(--yellow); }
    50% { border-color: var(--border); }
  }

  .tool-call-complete {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    margin: 6px 0;
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    font-size: 0.875rem;
  }

  .streaming-spinner {
    display: inline-block;
    width: 14px;
    height: 14px;
    border: 2px solid var(--border);
    border-top-color: var(--yellow);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  #stream-area {
    margin: 12px 0;
  }
`;

/**
 * Render the full conversation page
 */
export function renderConversation(
  messages: ConversationMessage[],
  toolCalls: ToolCallLog[],
  metadata: {
    threadTs: string;
    channelId: string;
    createdAt: number;
    updatedAt: number;
    canContinue?: boolean;
    conversationId?: number;
    isFavorited?: boolean;
    tags?: string[];
    userId?: string;
  }
): string {
  const messagesHtml = messages.length > 0
    ? messages.map((m) => renderMessage(m, metadata.userId)).join('\n')
    : '<div class="empty">No messages in this conversation.</div>';

  const toolCallsHtml = renderToolCalls(toolCalls);
  const continueFormHtml = metadata.canContinue ? renderContinueForm() : '';
  const continueScriptHtml = metadata.canContinue ? `<script>${renderContinueScript()}</script>` : '';

  const starClass = metadata.isFavorited ? 'detail-favorite-star active' : 'detail-favorite-star';
  const convId = metadata.conversationId != null ? String(metadata.conversationId) : '';
  const tagPills = (metadata.tags ?? []).map((t) =>
    `<span class="tag">${escapeHtml(t)}</span>`
  ).join('');
  const tagInputHtml = convId ? `
    <form class="tag-input-form" id="tag-input-form">
      <input type="text" id="tag-input" placeholder="Add tag..." maxlength="50">
      <button type="submit">${icon('plus', 14)} Add</button>
    </form>` : '';
  const archiveIconBtn = convId ? `<button class="export-btn" id="archive-btn" title="Archive" type="button">${icon('archive', 14)}</button>` : '';

  const headerHtml = `
  <div class="conv-header-compact">
    <div class="conv-header">
      <div class="container">
        <div class="conv-header-top">
          <div style="display: flex; align-items: center; gap: 8px;">
            <a href="/c" class="conv-back">${icon('arrow-left', 16)} Back to conversations</a>
            <h1 style="margin: 0; font-size: 1.1rem;">${convId ? `<span class="${starClass}" data-id="${convId}" id="detail-star">&#9733;</span> ` : ''}Claude Conversation</h1>
          </div>
          <div class="export-actions" style="margin-top: 0;">
            <a class="export-btn" id="export-md" href="/c/${metadata.threadTs}/${metadata.channelId}/export/md" title="Export Markdown">${icon('download', 14)}</a>
            <button class="export-btn" id="copy-clipboard" type="button" title="Copy to Clipboard">${icon('copy', 14)}</button>
            ${archiveIconBtn}
          </div>
        </div>
        <div class="meta" style="color: var(--text-muted); font-size: 0.8125rem; margin-top: 2px;">
          ${icon('clock', 14)} ${formatTimestamp(metadata.createdAt)} &mdash; ${formatTimestamp(metadata.updatedAt)}
        </div>
        <div class="detail-tags" id="detail-tags">${tagPills}</div>
        ${tagInputHtml}
      </div>
    </div>
  </div>`;

  const bodyHtml = `
  ${headerHtml}
  <main class="container">
    ${messagesHtml}
    ${continueFormHtml}
    ${toolCallsHtml}
  </main>`;

  const scripts = `
  <script>
    (function() {
      var copyBtn = document.getElementById('copy-clipboard');
      if (copyBtn) {
        copyBtn.addEventListener('click', function() {
          fetch('/c/${metadata.threadTs}/${metadata.channelId}/export/md?tools=false', { credentials: 'same-origin' })
            .then(function(res) { return res.text(); })
            .then(function(text) {
              return navigator.clipboard.writeText(text);
            })
            .then(function() {
              showToast('Copied to clipboard');
            })
            .catch(function() {
              showToast('Copy failed');
            });
        });
      }
    })();
  </script>
  <script>
  (function() {
    var convId = '${convId}';
    if (!convId) return;

    // Favorite star toggle
    var star = document.getElementById('detail-star');
    if (star) {
      star.addEventListener('click', function(e) {
        e.preventDefault();
        fetch('/c/' + convId + '/favorite', { method: 'POST', credentials: 'same-origin' })
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
    }

    // Tag input
    var tagForm = document.getElementById('tag-input-form');
    var tagInput = document.getElementById('tag-input');
    var tagsDiv = document.getElementById('detail-tags');
    if (tagForm && tagInput && tagsDiv) {
      tagForm.addEventListener('submit', function(e) {
        e.preventDefault();
        var tag = tagInput.value.trim().toLowerCase();
        if (!tag) return;
        fetch('/c/' + convId + '/tag', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tag: tag }),
          credentials: 'same-origin'
        })
        .then(function(res) { return res.json(); })
        .then(function(data) {
          if (data.tags) {
            tagsDiv.textContent = '';
            data.tags.forEach(function(t) {
              var span = document.createElement('span');
              span.className = 'tag';
              span.textContent = t;
              tagsDiv.appendChild(span);
            });
            tagInput.value = '';
            showToast('Tag added');
          }
        });
      });
    }

    // Archive button
    var archiveBtn = document.getElementById('archive-btn');
    if (archiveBtn) {
      archiveBtn.addEventListener('click', function() {
        if (!confirm('Archive this conversation?')) return;
        fetch('/c/' + convId + '/archive', { method: 'POST', credentials: 'same-origin' })
          .then(function(res) { return res.json(); })
          .then(function(data) {
            if (data.archived) {
              showToast('Conversation archived');
              setTimeout(function() { window.location.href = '/c'; }, 500);
            }
          });
      });
    }
  })();
  </script>
  ${continueScriptHtml}${toolCalls.length > 0 ? `
  <script>
  (function() {
    var wrapper = document.getElementById('tool-calls-wrapper');
    if (!wrapper) return;
    var key = 'tool-calls-expanded';
    try {
      if (localStorage.getItem(key) === 'true') {
        wrapper.setAttribute('open', '');
      }
      wrapper.addEventListener('toggle', function() {
        try { localStorage.setItem(key, wrapper.open ? 'true' : 'false'); } catch(e) {}
      });
    } catch(e) {}
  })();
  </script>` : ''}`;

  return wrapInShell({
    title: 'Claude Conversation',
    styles: conversationDetailStyles,
    body: bodyHtml,
    scripts,
    highlightJs: true,
  });
}

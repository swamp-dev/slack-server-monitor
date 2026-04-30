/**
 * Conversation detail page template
 */

import type { ConversationMessage, ToolCallLog, StoredContextStatus } from '../../services/conversation-store.js';
import { escapeHtml, formatMarkdown, formatTimestamp } from './utils.js';
import { icon } from './icons.js';
import { wrapInShell } from './shell.js';

// ─── Context Status ───────────────────────────────────────────────────

/**
 * Render context window usage bar
 */
function renderContextStatus(status: StoredContextStatus | null): string {
  if (!status) return '';

  const pct = Math.round(status.percentUsed * 100);
  const pctStr = String(pct);
  let barColor = 'var(--green)';
  let label = `${pctStr}% context used`;

  if (status.wasTruncated) {
    barColor = 'var(--red)';
    label = `${pctStr}% used — ${String(status.removedCount)} messages truncated`;
  } else if (pct >= 70) {
    barColor = 'var(--orange)';
    label = `${pctStr}% used — approaching limit`;
  }

  const widthPct = String(Math.min(pct, 100));
  return `
    <div class="context-status" title="${escapeHtml(label)}">
      <div class="context-bar">
        <div class="context-bar-fill" style="width: ${widthPct}%; background: ${barColor};"></div>
      </div>
      <span class="context-label">${icon('brain', 12)} ${escapeHtml(label)}</span>
    </div>
  `;
}

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
function renderMessage(message: ConversationMessage, index: number, opts?: {
  userId?: string;
  canFork?: boolean;
  isLast?: boolean;
  branchPointIndex?: number | null;
  branchCount?: number;
}): string {
  const roleClass = message.role;
  const roleLabel = message.role === 'user' ? 'You' : 'Claude';
  const content = formatMarkdown(message.content);

  let avatarContent: string;
  if (message.role === 'user') {
    const initial = opts?.userId ? opts.userId.charAt(0).toUpperCase() : roleLabel.charAt(0);
    const color = opts?.userId ? avatarColor(opts.userId) : 'var(--cyan)';
    avatarContent = `<span class="avatar" style="background: ${color}; color: var(--bg);">${escapeHtml(initial)}</span>`;
  } else {
    avatarContent = `<span class="avatar avatar-glow">${icon('robot', 16)}</span>`;
  }

  // Timestamp tooltip on hover (escaped, explicit locale for consistency with formatTimestamp)
  const tsAttr = message.timestamp
    ? ` title="${escapeHtml(new Date(message.timestamp).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'medium' }))}"`
    : '';

  // Copy button on every message
  const copyBtn = `<button class="copy-msg-btn" data-index="${String(index)}" title="Copy message">${icon('copy', 14)} <span class="copy-label">Copy</span></button>`;

  // Fork button: shown on assistant messages except the last one (forking from last is just continuing)
  const forkBtn = opts?.canFork && message.role === 'assistant' && !opts.isLast
    ? `<button class="fork-btn" data-index="${String(index)}" title="Fork conversation from here">${icon('git-branch', 14)} Fork</button>`
    : '';

  // Branch point indicator
  const isBranchPoint = opts?.branchPointIndex != null && index === opts.branchPointIndex;
  const branchIndicator = isBranchPoint && (opts.branchCount ?? 0) > 0
    ? `<span class="branch-point-indicator">${icon('git-branch', 12)} branch point</span>`
    : '';

  // Expand/collapse for long messages (>500 words)
  const wordCount = message.content.split(/\s+/).length;
  const isLong = wordCount > 500;
  const collapsedClass = isLong ? ' collapsed' : '';
  const showMoreBtn = isLong
    ? `<button class="show-more-btn" data-index="${String(index)}">Show more (${String(wordCount)} words)</button>`
    : '';

  return `
    <div class="message ${roleClass}" data-index="${String(index)}"${tsAttr}>
      <div class="message-header">${avatarContent}${roleLabel}${branchIndicator}${copyBtn}${forkBtn}</div>
      <div class="message-content${collapsedClass}">${content}</div>
      ${showMoreBtn}
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

      var messageQueue = [];
      var isProcessing = false;

      function escapeHtml(s) {
        return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
      }

      function getMainEl() {
        return document.querySelector('.container main') || document.querySelector('main');
      }

      function appendUserMessage(message, queued) {
        var mainEl = getMainEl();
        var userMsg = document.createElement('div');
        userMsg.className = 'message user' + (queued ? ' queued' : '');
        var headerDiv = document.createElement('div');
        headerDiv.className = 'message-header';
        headerDiv.textContent = 'You';
        if (queued) {
          var badge = document.createElement('span');
          badge.className = 'queued-badge';
          badge.textContent = 'queued';
          headerDiv.appendChild(badge);
        }
        var contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        contentDiv.textContent = message;
        userMsg.appendChild(headerDiv);
        userMsg.appendChild(contentDiv);
        var formEl = mainEl ? mainEl.querySelector('.continue-form') : null;
        if (mainEl && formEl) mainEl.insertBefore(userMsg, formEl);
      }

      function appendAssistantMessage(html) {
        var mainEl = getMainEl();
        var msg = document.createElement('div');
        msg.className = 'message assistant';
        var header = document.createElement('div');
        header.className = 'message-header';
        var avatar = document.createElement('span');
        avatar.className = 'avatar avatar-glow';
        avatar.innerHTML = robotSvg;
        header.appendChild(avatar);
        header.appendChild(document.createTextNode('Claude'));
        msg.appendChild(header);
        var content = document.createElement('div');
        content.className = 'message-content';
        content.innerHTML = html;
        msg.appendChild(content);
        var formEl = mainEl ? mainEl.querySelector('.continue-form') : null;
        if (mainEl && formEl) mainEl.insertBefore(msg, formEl);
      }

      function clearQueuedBadges() {
        var queued = document.querySelectorAll('.message.queued');
        for (var i = 0; i < queued.length; i++) {
          queued[i].classList.remove('queued');
          var badge = queued[i].querySelector('.queued-badge');
          if (badge) badge.remove();
        }
      }

      // Robot SVG for assistant avatar (matches server-rendered version)
      var robotSvg = '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">'
        + '<path d="M10 6C6.69 6 4 8.69 4 12V14C4 15.1 4.9 16 6 16H14C15.1 16 16 15.1 16 14V12C16 8.69 13.31 6 10 6Z"/>'
        + '<path d="M7.5 11.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"/>'
        + '<path d="M12.5 11.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"/>'
        + '<path d="M10 3V6"/><path d="M6 3.5L8 6"/><path d="M14 3.5L12 6"/></svg>';

      // Map tool names to friendly status messages
      var toolLabels = {
        get_container_status: 'Checking containers',
        get_container_logs: 'Reading logs',
        get_system_resources: 'Checking system resources',
        get_disk_usage: 'Checking disk usage',
        get_network_info: 'Checking network',
        get_docker_images: 'Listing Docker images',
        search_container_logs: 'Searching logs',
        read_file: 'Reading file',
        run_command: 'Running command',
        create_github_issue: 'Creating issue',
        list_github_issues: 'Searching issues',
        view_github_issue: 'Reading issue'
      };
      function friendlyToolName(name) {
        return toolLabels[name] || ('Running ' + name.replace(/_/g, ' '));
      }

      function sendMessage(message) {
        isProcessing = true;
        spinner.style.display = 'block';
        spinner.textContent = 'Connecting to Claude...';
        errorDiv.style.display = 'none';

        var mainEl = getMainEl();
        var streamArea = document.createElement('div');
        streamArea.className = 'stream-area';
        var formEl = mainEl ? mainEl.querySelector('.continue-form') : null;
        if (mainEl && formEl) mainEl.insertBefore(streamArea, formEl);

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
            isProcessing = false;
            spinner.style.display = 'none';
            return;
          }

          // Fallback: reload if no completion after 5 minutes (matches CLI timeout)
          var fallbackTimer = setTimeout(function() { window.location.reload(); }, 300000);
          var es;
          try {
            es = new EventSource(window.location.pathname + '/stream');
          } catch(err) {
            clearTimeout(fallbackTimer);
            isProcessing = false;
            spinner.style.display = 'none';
            setTimeout(function() { window.location.reload(); }, 3000);
            return;
          }

          var gotEvents = false;
          var toolCardIndex = 0;
          var activeTimers = {};
          var continueFormEl = document.querySelector('.continue-form');

          // Central cleanup: clear all timers, close SSE
          function cleanup() {
            clearTimeout(fallbackTimer);
            for (var k in activeTimers) { clearInterval(activeTimers[k]); }
            activeTimers = {};
            if (es) { es.onerror = null; es.close(); }
          }

          es.addEventListener('tool_call_start', function(e) {
            gotEvents = true;
            try {
              var data = JSON.parse(e.data);
              spinner.textContent = friendlyToolName(data.toolName) + '...';
              var card = document.createElement('div');
              card.className = 'tool-call-streaming';
              var tcIdx = String(toolCardIndex++);
              card.setAttribute('data-tc-index', tcIdx);
              card.innerHTML = '<span class="streaming-spinner"></span> <span class="tool-call-name">' + escapeHtml(friendlyToolName(data.toolName)) + '</span> <span class="tool-call-elapsed"></span>';
              streamArea.appendChild(card);
              // Live elapsed time counter
              var startTime = Date.now();
              activeTimers[tcIdx] = setInterval(function() {
                var elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                var el = card.querySelector('.tool-call-elapsed');
                if (el) el.textContent = elapsed + 's';
              }, 100);
            } catch(err) {}
          });

          es.addEventListener('tool_call_end', function(e) {
            try {
              var data = JSON.parse(e.data);
              // Find the last streaming card
              var cards = streamArea.querySelectorAll('.tool-call-streaming');
              var card = cards.length > 0 ? cards[cards.length - 1] : null;
              if (card) {
                var idx = card.getAttribute('data-tc-index');
                if (idx && activeTimers[idx]) { clearInterval(activeTimers[idx]); delete activeTimers[idx]; }

                var statusClass = data.isError ? 'failure' : 'success';
                var statusIcon = data.isError ? '✗' : '✓';
                card.className = 'tool-call-complete';
                card.innerHTML = '<span class="tool-call-status ' + statusClass + '">' + statusIcon + '</span> '
                  + '<span class="tool-call-name">' + escapeHtml(friendlyToolName(data.toolName)) + '</span>'
                  + ' <span class="tool-call-duration">' + escapeHtml(String(data.durationMs || 0)) + 'ms</span>';
              }
            } catch(err) {}
          });

          es.addEventListener('text', function(e) {
            gotEvents = true;
            spinner.style.display = 'none';
            try {
              var data = JSON.parse(e.data);
              var text = data.text || '';
              if (!text) return;

              // Create or update streaming response preview (plain text, safe)
              var responseDiv = document.getElementById('stream-response');
              if (!responseDiv) {
                responseDiv = document.createElement('div');
                responseDiv.id = 'stream-response';
                responseDiv.className = 'message assistant streaming';
                responseDiv.innerHTML = '<div class="message-header">'
                  + '<span class="avatar avatar-glow">' + robotSvg + '</span>Claude</div>'
                  + '<div class="message-content" id="stream-response-content"></div>'
                  + '<span class="typing-cursor"></span>';
                if (mainEl) mainEl.insertBefore(responseDiv, continueFormEl);
              }

              // Use textContent for safety — server renders final markdown on reload
              var contentEl = document.getElementById('stream-response-content');
              if (contentEl) contentEl.textContent = text;

              // Only auto-scroll if user is near the bottom (within 400px)
              var distFromBottom = document.documentElement.scrollHeight - window.scrollY - window.innerHeight;
              if (distFromBottom < 400) {
                responseDiv.scrollIntoView({ behavior: 'smooth', block: 'end' });
              }
            } catch(err) {}
          });

          es.addEventListener('done', function(e) {
            cleanup();
            // Remove streaming preview if present
            var preview = document.getElementById('stream-response');
            if (preview) preview.remove();
            // Render server-rendered response inline and scroll to it
            try {
              var data = JSON.parse(e.data);
              if (data.responseHtml) {
                // Measure distance before insertion (inserting grows scrollHeight)
                var doneDistFromBottom = document.documentElement.scrollHeight - window.scrollY - window.innerHeight;
                appendAssistantMessage(data.responseHtml);
                if (doneDistFromBottom < 400) {
                  var allMsgs = document.querySelectorAll('.message');
                  var lastMsg = allMsgs[allMsgs.length - 1];
                  if (lastMsg) lastMsg.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
              }
            } catch(err) {}
            // Drain queue or finish
            if (messageQueue.length > 0) {
              var collapsed = messageQueue.join('\\n\\n');
              messageQueue = [];
              clearQueuedBadges();
              sendMessage(collapsed);
            } else {
              isProcessing = false;
              spinner.style.display = 'none';
            }
          });

          es.addEventListener('error', function(e) {
            if (e.data) {
              try {
                var data = JSON.parse(e.data);
                errorDiv.textContent = data.message || 'An error occurred';
                errorDiv.style.display = 'block';
              } catch(err) {}
            }
            cleanup();
            isProcessing = false;
            spinner.style.display = 'none';
            if (!gotEvents) {
              setTimeout(function() { window.location.reload(); }, 3000);
            }
          });

          es.onerror = function() {
            if (!gotEvents) {
              cleanup();
              setTimeout(function() { window.location.reload(); }, 3000);
            }
          };
        })
        .catch(function(err) {
          errorDiv.textContent = 'Network error: ' + err.message;
          errorDiv.style.display = 'block';
          isProcessing = false;
          spinner.style.display = 'none';
        });
      }

      form.addEventListener('submit', function(e) {
        e.preventDefault();
        var message = input.value.trim();
        if (!message) return;
        input.value = '';
        if (charCount) { charCount.textContent = '0 / 4000'; charCount.className = 'char-count'; }

        if (isProcessing) {
          if (messageQueue.length >= 10) {
            errorDiv.textContent = 'Queue full — wait for Claude to finish before sending more.';
            errorDiv.style.display = 'block';
            return;
          }
          messageQueue.push(message);
          appendUserMessage(message, true);
        } else {
          appendUserMessage(message, false);
          sendMessage(message);
        }
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
  .conv-title {
    margin: 0;
    font-size: 1.1rem;
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
  .conv-details-toggle { display: none; }
  /* Mobile: compact header */
  @media (max-width: 640px) {
    .conv-back-text { display: none; }
    .conv-header { padding: 6px 12px; }
    .conv-title {
      font-size: 0.95rem;
      /* Allow the title to wrap to up to 2 lines instead of single-line
         ellipsis. The title is the user's first question, so cutting it
         to ~30 characters hides the most useful at-a-glance context. */
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      /* Standard line-clamp is forward-compat only — no engine ships it
         bare as of 2026, but it costs nothing to declare. The -webkit-
         box combo above handles every real browser. */
      line-clamp: 2;
      overflow: hidden;
      max-width: 100%;
    }
    .conv-details-toggle {
      display: inline-flex;
    }
    .conv-collapsible {
      display: none;
    }
    .conv-collapsible.open {
      display: block;
    }
  }
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

  /* Context window status bar */
  .context-status {
    margin-top: 6px;
  }
  .context-bar {
    height: 4px;
    background: var(--border);
    border-radius: 2px;
    overflow: hidden;
    margin-bottom: 2px;
  }
  .context-bar-fill {
    height: 100%;
    border-radius: 2px;
    transition: width 0.3s;
  }
  .context-label {
    font-size: 0.75rem;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    gap: 4px;
  }

  /* Typing cursor for streaming responses */
  .typing-cursor {
    display: inline-block;
    width: 2px;
    height: 1em;
    background: var(--accent);
    margin-left: 2px;
    animation: blink-cursor 0.8s step-end infinite;
    vertical-align: text-bottom;
  }
  @keyframes blink-cursor {
    50% { opacity: 0; }
  }
  .message.streaming {
    border-color: var(--accent);
    position: relative;
  }
  .message.streaming::after {
    content: '';
    position: absolute;
    bottom: -1px;
    left: 0;
    right: 0;
    height: 2px;
    background: linear-gradient(90deg, var(--accent), var(--accent-secondary), var(--accent));
    background-size: 200% 100%;
    animation: shimmer-border 2s linear infinite;
  }
  @keyframes shimmer-border {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  /* Elapsed time counter on streaming tool cards */
  .tool-call-elapsed {
    margin-left: auto;
    font-size: 0.75rem;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  /* Scroll-to-bottom floating button */
  .scroll-to-bottom {
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 40;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--surface);
    color: var(--text-muted);
    border: 1px solid var(--border);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 2px 8px var(--shadow);
    opacity: 0;
    transform: translateY(8px);
    transition: opacity 0.2s, transform 0.2s;
    pointer-events: none;
  }
  .scroll-to-bottom.visible {
    opacity: 0.8;
    transform: translateY(0);
    pointer-events: auto;
  }
  .scroll-to-bottom:hover {
    opacity: 1;
    color: var(--text);
    border-color: var(--accent);
  }

  /* Copy message button — always visible for discoverability */
  .copy-msg-btn {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 0.75rem;
    padding: 4px 10px;
    border-radius: 4px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    opacity: 0.5;
    transition: opacity 0.2s, color 0.2s, border-color 0.2s;
  }
  .message:hover .copy-msg-btn {
    opacity: 0.8;
  }
  .copy-msg-btn:hover {
    opacity: 1;
    color: var(--cyan);
    border-color: var(--cyan);
  }
  /* Touch devices: always show at full readable opacity (no hover available) */
  @media (hover: none) {
    .copy-msg-btn {
      opacity: 0.7;
    }
  }
  @media (max-width: 640px) {
    .copy-label { display: none; }
  }

  /* Expand/collapse long messages */
  .message-content.collapsed {
    max-height: 300px;
    overflow: hidden;
    position: relative;
  }
  .message-content.collapsed::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 60px;
    background: linear-gradient(transparent, var(--surface));
    pointer-events: none;
  }
  .message.user .message-content.collapsed::after {
    background: linear-gradient(transparent, var(--card-bg));
  }
  .show-more-btn {
    display: block;
    margin: 8px 0 0;
    padding: 4px 12px;
    font-size: 0.8125rem;
    font-family: inherit;
    color: var(--link);
    background: none;
    border: 1px solid var(--border);
    border-radius: 6px;
    cursor: pointer;
    transition: border-color 0.2s;
  }
  .show-more-btn:hover {
    border-color: var(--link);
  }

  /* Branch indicator */
  .branch-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 0.8125rem;
    color: var(--purple);
    cursor: pointer;
    background: none;
    border: none;
    padding: 2px 6px;
    border-radius: 4px;
    transition: background 0.2s;
  }
  .branch-badge:hover {
    background: rgba(189, 147, 249, 0.1);
  }
  .branch-list {
    display: none;
    margin-top: 6px;
    padding: 8px 12px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    font-size: 0.8125rem;
  }
  .branch-list.open {
    display: block;
  }
  .branch-list a {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 0;
    color: var(--link);
    text-decoration: none;
  }
  .branch-list a:hover {
    text-decoration: underline;
  }
  .branch-point-indicator {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 0.6875rem;
    color: var(--purple);
    margin-left: 8px;
    opacity: 0.7;
  }

  /* Fork button */
  .fork-btn {
    margin-left: auto;
    background: none;
    border: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 0.75rem;
    padding: 2px 8px;
    border-radius: 4px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    opacity: 0;
    transition: opacity 0.2s, color 0.2s, border-color 0.2s;
  }
  .message:hover .fork-btn {
    opacity: 1;
  }
  .fork-btn:hover {
    color: var(--purple);
    border-color: var(--purple);
  }
`;

/**
 * Extract a title from the first user message, truncated with ellipsis.
 * Returns raw (unescaped) text — callers must escape for their context.
 */
function conversationTitle(messages: ConversationMessage[], maxLen: number): string {
  const first = messages.find((m) => m.role === 'user');
  if (!first) return 'Claude Conversation';
  const preview = first.content.slice(0, maxLen);
  return preview + (first.content.length > maxLen ? '...' : '');
}

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
    contextStatus?: StoredContextStatus | null;
    parentConversationId?: number | null;
    branchPointIndex?: number | null;
    branches?: { threadTs: string; channelId: string; createdAt: number; branchPointIndex: number | null }[];
  }
): string {
  const branchCount = metadata.branches?.length ?? 0;
  const messagesHtml = messages.length > 0
    ? messages.map((m, i) => renderMessage(m, i, {
        userId: metadata.userId,
        canFork: metadata.canContinue,
        isLast: i === messages.length - 1,
        branchPointIndex: metadata.branchPointIndex,
        branchCount,
      })).join('\n')
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
            <a href="/c" class="conv-back">${icon('arrow-left', 16)} <span class="conv-back-text">Back to conversations</span></a>
            <h1 class="conv-title">${convId ? `<span class="${starClass}" data-id="${convId}" id="detail-star">&#9733;</span> ` : ''}${escapeHtml(conversationTitle(messages, 80))}</h1>
          </div>
          <div class="export-actions" style="margin-top: 0;">
            <a class="export-btn" id="export-md" href="/c/${metadata.threadTs}/${metadata.channelId}/export/md" title="Export Markdown">${icon('download', 14)}</a>
            <button class="export-btn" id="copy-clipboard" type="button" title="Copy to Clipboard">${icon('copy', 14)}</button>
            ${archiveIconBtn}
            <button class="export-btn conv-details-toggle" id="conv-details-toggle" type="button" title="Details">${icon('chevron-down', 14)}</button>
          </div>
        </div>
        <div class="conv-collapsible" id="conv-collapsible">
        <div class="meta" style="color: var(--text-muted); font-size: 0.8125rem; margin-top: 2px;">
          ${icon('clock', 14)} ${formatTimestamp(metadata.createdAt)} &mdash; ${formatTimestamp(metadata.updatedAt)}
          ${metadata.parentConversationId != null ? ` &middot; ${icon('git-branch', 12)} <a href="/c" style="color: var(--purple);">Forked conversation</a>` : ''}
          ${branchCount > 0 ? ` &middot; <button class="branch-badge" id="branch-toggle">${icon('git-branch', 14)} ${String(branchCount)} ${branchCount === 1 ? 'branch' : 'branches'}</button>` : ''}
        </div>
        ${branchCount > 0 ? `<div class="branch-list" id="branch-list">${(metadata.branches ?? []).map((b) => `<a href="/c/${encodeURIComponent(b.threadTs)}/${encodeURIComponent(b.channelId)}">${icon('git-branch', 12)} Branch from message ${String((b.branchPointIndex ?? 0) + 1)} &middot; ${formatTimestamp(b.createdAt)}</a>`).join('')}</div>` : ''}
        ${renderContextStatus(metadata.contextStatus ?? null)}
        <div class="detail-tags" id="detail-tags">${tagPills}</div>
        ${tagInputHtml}
        </div>
      </div>
    </div>
  </div>`;

  const bodyHtml = `
  ${headerHtml}
  <main class="container">
    ${messagesHtml}
    ${continueFormHtml}
    ${toolCallsHtml}
  </main>
  <button class="scroll-to-bottom" id="scroll-to-bottom" title="Scroll to bottom" aria-label="Scroll to bottom">${icon('arrow-down', 18)}</button>`;

  const scripts = `
  <script>
    (function() {
      var copyBtn = document.getElementById('copy-clipboard');
      if (copyBtn) {
        copyBtn.addEventListener('click', function() {
          fetch('/c/${encodeURIComponent(metadata.threadTs)}/${encodeURIComponent(metadata.channelId)}/export/md?tools=false', { credentials: 'same-origin' })
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
    var convId = ${JSON.stringify(convId)};
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
    // Fork button handlers
    document.querySelectorAll('.fork-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var idx = parseInt(btn.getAttribute('data-index') || '-1', 10);
        if (idx < 0 || !convId) return;
        if (!confirm('Fork conversation from this point?')) return;
        fetch('/c/' + convId + '/fork', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messageIndex: idx }),
          credentials: 'same-origin'
        })
          .then(function(res) { return res.json(); })
          .then(function(data) {
            if (data.threadTs && data.channelId) {
              showToast('Conversation forked');
              setTimeout(function() { window.location.href = '/c/' + data.threadTs + '/' + data.channelId; }, 500);
            } else if (data.error) {
              showToast('Fork failed: ' + data.error);
            }
          });
      });
    });

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
  </script>` : ''}
  <script>
  // Scroll-to-bottom button
  (function() {
    var btn = document.getElementById('scroll-to-bottom');
    if (!btn) return;
    function checkScroll() {
      var distFromBottom = document.documentElement.scrollHeight - window.scrollY - window.innerHeight;
      if (distFromBottom > 300) {
        btn.classList.add('visible');
      } else {
        btn.classList.remove('visible');
      }
    }
    window.addEventListener('scroll', checkScroll, { passive: true });
    checkScroll();
    btn.addEventListener('click', function() {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
    });
  })();
  </script>
  <script>
  // Copy individual message buttons (event delegation for dynamic messages)
  (function() {
    document.addEventListener('click', function(e) {
      var btn = e.target.closest('.copy-msg-btn');
      if (!btn) return;
      var msg = btn.closest('.message');
      if (!msg) return;
      var content = msg.querySelector('.message-content');
      if (!content) return;
      var text = content.textContent || '';
      navigator.clipboard.writeText(text).then(function() {
        btn.innerHTML = '${icon('check', 14)} <span class="copy-label">Copied</span>';
        setTimeout(function() { btn.innerHTML = '${icon('copy', 14)} <span class="copy-label">Copy</span>'; }, 1500);
      }).catch(function() {
        if (typeof showToast === 'function') showToast('Copy failed');
      });
    });
  })();
  </script>
  <script>
  // Show more/less for long messages (event delegation for dynamic messages)
  (function() {
    document.querySelectorAll('.show-more-btn').forEach(function(btn) {
      btn.setAttribute('data-label', btn.textContent || '');
    });
    document.addEventListener('click', function(e) {
      var btn = e.target.closest('.show-more-btn');
      if (!btn) return;
      var msg = btn.closest('.message');
      if (!msg) return;
      var content = msg.querySelector('.message-content');
      if (!content) return;
      if (content.classList.contains('collapsed')) {
        content.classList.remove('collapsed');
        btn.textContent = 'Show less';
      } else {
        content.classList.add('collapsed');
        btn.textContent = btn.getAttribute('data-label') || 'Show more';
      }
    });
  })();
  </script>
  <script>
  // Branch list toggle
  (function() {
    var toggle = document.getElementById('branch-toggle');
    var list = document.getElementById('branch-list');
    if (!toggle || !list) return;
    toggle.addEventListener('click', function() {
      list.classList.toggle('open');
    });
  })();
  // Mobile details toggle
  (function() {
    var toggle = document.getElementById('conv-details-toggle');
    var panel = document.getElementById('conv-collapsible');
    if (!toggle || !panel) return;
    toggle.addEventListener('click', function(e) {
      e.preventDefault();
      panel.classList.toggle('open');
      toggle.style.transform = panel.classList.contains('open') ? 'rotate(180deg)' : '';
    });
  })();
  </script>`;

  return wrapInShell({
    title: conversationTitle(messages, 60),
    styles: conversationDetailStyles,
    body: bodyHtml,
    scripts,
    highlightJs: true,
  });
}

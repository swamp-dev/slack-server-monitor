/**
 * HTML templates for web UI
 *
 * Renders conversation pages with simple, readable styling.
 * Uses marked for full markdown rendering with syntax highlighting.
 * Mobile-friendly design with code block support.
 */

import { marked, type Renderer, type Tokens } from 'marked';
import type { ConversationMessage, ToolCallLog } from '../services/conversation-store.js';

/**
 * Escape HTML special characters to prevent XSS
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Escape markdown characters that could create links or structure injection
 */
function escapeMarkdown(text: string): string {
  // eslint-disable-next-line no-useless-escape
  return text.replace(/([`\[\]()\\])/g, '\\$1');
}

/**
 * Custom marked renderer for security and styling
 */
const renderer: Partial<Renderer> = {
  // Restrict links to http/https only, add rel="noopener", escape all values
  link({ href, text }: Tokens.Link) {
    if (!href.startsWith('http://') && !href.startsWith('https://')) {
      return escapeHtml(text);
    }
    return `<a href="${escapeHtml(href)}" rel="noopener">${escapeHtml(text)}</a>`;
  },
  // Block raw HTML to prevent XSS
  html({ text }: Tokens.HTML) {
    return escapeHtml(text);
  },
};

// Configure marked with security-focused defaults
marked.use({
  renderer,
  gfm: true, // GitHub Flavored Markdown (tables, strikethrough)
  breaks: true, // Convert \n to <br>
});

/**
 * Convert markdown to HTML using marked with security renderer
 */
function formatMarkdown(text: string): string {
  return marked.parse(text) as string;
}

/**
 * Format a timestamp as a readable date/time string
 */
function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * CSS styles for the conversation page
 */
const styles = `
  :root {
    --bg-color: #1a1a2e;
    --card-bg: #16213e;
    --user-bg: #0f3460;
    --assistant-bg: #1a1a2e;
    --text-color: #eaeaea;
    --text-muted: #8892b0;
    --accent-color: #e94560;
    --code-bg: #0d1117;
    --border-color: #30475e;
  }

  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    background-color: var(--bg-color);
    color: var(--text-color);
    line-height: 1.6;
    padding: 0;
    margin: 0;
  }

  .container {
    max-width: 900px;
    margin: 0 auto;
    padding: 20px;
  }

  header {
    background: var(--card-bg);
    border-bottom: 1px solid var(--border-color);
    padding: 20px;
    margin-bottom: 20px;
  }

  header h1 {
    font-size: 1.5rem;
    font-weight: 600;
    margin-bottom: 8px;
  }

  header .meta {
    color: var(--text-muted);
    font-size: 0.875rem;
  }

  .message {
    margin-bottom: 20px;
    border-radius: 8px;
    overflow: hidden;
  }

  .message-header {
    padding: 12px 16px;
    font-weight: 600;
    font-size: 0.875rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .message-content {
    padding: 16px;
    font-size: 0.9375rem;
  }

  .message.user {
    background: var(--user-bg);
  }

  .message.user .message-header {
    background: rgba(255, 255, 255, 0.05);
    color: #64ffda;
  }

  .message.assistant {
    background: var(--assistant-bg);
    border: 1px solid var(--border-color);
  }

  .message.assistant .message-header {
    background: rgba(233, 69, 96, 0.1);
    color: var(--accent-color);
  }

  code {
    font-family: 'SF Mono', 'Fira Code', 'Monaco', 'Inconsolata', monospace;
    background: var(--code-bg);
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 0.875em;
  }

  pre {
    background: var(--code-bg);
    border-radius: 8px;
    padding: 16px;
    overflow-x: auto;
    margin: 12px 0;
    border: 1px solid var(--border-color);
  }

  pre code {
    background: none;
    padding: 0;
    font-size: 0.875rem;
    line-height: 1.5;
  }

  .message-content h1,
  .message-content h2,
  .message-content h3,
  .message-content h4 {
    margin: 16px 0 8px;
    font-weight: 600;
  }

  .message-content h1 { font-size: 1.5rem; }
  .message-content h2 { font-size: 1.25rem; }
  .message-content h3 { font-size: 1.1rem; }

  .message-content ul,
  .message-content ol {
    padding-left: 24px;
    margin: 8px 0;
  }

  .message-content li {
    margin: 4px 0;
  }

  .message-content blockquote {
    border-left: 3px solid var(--accent-color);
    padding: 8px 16px;
    margin: 12px 0;
    color: var(--text-muted);
    background: rgba(255, 255, 255, 0.02);
  }

  .message-content table {
    width: 100%;
    border-collapse: collapse;
    margin: 12px 0;
  }

  .message-content th,
  .message-content td {
    border: 1px solid var(--border-color);
    padding: 8px 12px;
    text-align: left;
  }

  .message-content th {
    background: rgba(255, 255, 255, 0.05);
    font-weight: 600;
  }

  .message-content hr {
    border: none;
    border-top: 1px solid var(--border-color);
    margin: 20px 0;
  }

  a {
    color: #64ffda;
    text-decoration: none;
  }

  a:hover {
    text-decoration: underline;
  }

  .tool-calls {
    margin-top: 30px;
    border-top: 1px solid var(--border-color);
    padding-top: 20px;
  }

  .tool-calls h2 {
    font-size: 1.125rem;
    color: var(--text-muted);
    margin-bottom: 16px;
  }

  .tool-call {
    background: var(--card-bg);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    margin-bottom: 12px;
    overflow: hidden;
  }

  .tool-call-header {
    padding: 10px 14px;
    background: rgba(255, 255, 255, 0.03);
    font-size: 0.875rem;
    cursor: pointer;
    display: flex;
    justify-content: space-between;
    align-items: center;
    list-style: none;
  }

  .tool-call-header::-webkit-details-marker {
    display: none;
  }

  .tool-call-header::before {
    content: '\\25B6';
    margin-right: 8px;
    font-size: 0.625rem;
    transition: transform 0.2s;
  }

  details.tool-call[open] > .tool-call-header::before {
    transform: rotate(90deg);
  }

  .tool-call-name {
    font-family: 'SF Mono', monospace;
    color: #ffd93d;
  }

  .tool-call-time {
    color: var(--text-muted);
    font-size: 0.75rem;
  }

  .tool-call-content {
    padding: 12px 14px;
    font-size: 0.8125rem;
    color: var(--text-muted);
    border-top: 1px solid var(--border-color);
  }

  .tool-call-content pre {
    margin: 8px 0 0;
    font-size: 0.75rem;
  }

  .tool-call-output {
    margin-top: 12px;
    padding-top: 8px;
    border-top: 1px dashed var(--border-color);
  }

  .empty {
    text-align: center;
    padding: 40px;
    color: var(--text-muted);
  }

  footer {
    margin-top: 40px;
    padding: 20px;
    text-align: center;
    color: var(--text-muted);
    font-size: 0.75rem;
    border-top: 1px solid var(--border-color);
  }

  .export-actions {
    margin-top: 12px;
    display: flex;
    gap: 8px;
  }

  .export-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    font-size: 0.8125rem;
    font-family: inherit;
    color: var(--text-color);
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    cursor: pointer;
    text-decoration: none;
    transition: background 0.2s;
  }

  .export-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    text-decoration: none;
  }

  @media (max-width: 600px) {
    .container {
      padding: 10px;
    }

    header {
      padding: 16px;
    }

    header h1 {
      font-size: 1.25rem;
    }

    .message-content {
      padding: 12px;
    }

    pre {
      padding: 12px;
      font-size: 0.8125rem;
    }
  }
`;

/**
 * Render a single message
 */
function renderMessage(message: ConversationMessage): string {
  const roleClass = message.role;
  const roleLabel = message.role === 'user' ? 'You' : 'Claude';
  const content = formatMarkdown(message.content);

  return `
    <div class="message ${roleClass}">
      <div class="message-header">${roleLabel}</div>
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

  const toolCallsHtml = toolCalls
    .map((tc) => {
      const inputJson = JSON.stringify(tc.input, null, 2);
      const time = formatToolTime(tc.timestamp);
      const outputHtml = tc.outputPreview
        ? `<div class="tool-call-output"><strong>Output:</strong> ${escapeHtml(tc.outputPreview)}</div>`
        : '';

      return `
        <details class="tool-call">
          <summary class="tool-call-header">
            <span class="tool-call-name">${escapeHtml(tc.toolName)}</span>
            <span class="tool-call-time">${time}</span>
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
    <div class="tool-calls">
      <h2>Tool Calls (${String(toolCalls.length)})</h2>
      ${toolCallsHtml}
    </div>
  `;
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
  }
): string {
  const messagesHtml = messages.length > 0
    ? messages.map(renderMessage).join('\n')
    : '<div class="empty">No messages in this conversation.</div>';

  const toolCallsHtml = renderToolCalls(toolCalls);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <title>Claude Conversation</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css" integrity="sha384-wH75j6z1lH97ZOpMOInqhgKzFkAInZPPSPlZpYKYTOqsaizPvhQZmAtLcPKXpLyH" crossorigin="anonymous">
  <style>${styles}</style>
</head>
<body>
  <header>
    <div class="container">
      <h1>Claude Conversation</h1>
      <div class="meta">
        Started: ${formatTimestamp(metadata.createdAt)} |
        Last updated: ${formatTimestamp(metadata.updatedAt)}
      </div>
      <div class="export-actions">
        <a class="export-btn" id="export-md" href="export/md">Export Markdown</a>
        <button class="export-btn" id="copy-clipboard" type="button">Copy to Clipboard</button>
      </div>
    </div>
  </header>

  <main class="container">
    ${messagesHtml}
    ${toolCallsHtml}
  </main>

  <footer>
    <div class="container">
      Powered by Slack Server Monitor
    </div>
  </footer>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js" integrity="sha384-F/bZzf7p3Joyp5psL90p/p89AZJsndkSoGwRpXcZhleCWhd8SnRuoYo4d0yirjJp" crossorigin="anonymous"></script>
  <script>
    hljs.highlightAll();
    (function() {
      var params = new URLSearchParams(window.location.search);
      var token = params.get('token');
      var exportLink = document.getElementById('export-md');
      if (exportLink && token) {
        exportLink.href = window.location.pathname + '/export/md?token=' + encodeURIComponent(token);
      }
      var copyBtn = document.getElementById('copy-clipboard');
      if (copyBtn) {
        copyBtn.addEventListener('click', function() {
          var msgs = document.querySelectorAll('.message');
          var text = Array.from(msgs).map(function(el) {
            var header = el.querySelector('.message-header');
            var content = el.querySelector('.message-content');
            var role = header ? header.textContent : '';
            var body = content ? content.textContent : '';
            return '### ' + role + '\\n\\n' + body;
          }).join('\\n\\n');
          navigator.clipboard.writeText(text).then(function() {
            copyBtn.textContent = 'Copied!';
            setTimeout(function() { copyBtn.textContent = 'Copy to Clipboard'; }, 2000);
          });
        });
      }
    })();
  </script>
</body>
</html>`;
}

/**
 * Render a conversation as markdown for download/export
 */
export function renderMarkdownExport(
  messages: ConversationMessage[],
  toolCalls: ToolCallLog[],
  metadata: {
    threadTs: string;
    channelId: string;
    createdAt: number;
    updatedAt: number;
  }
): string {
  const lines: string[] = [];

  // Header
  lines.push('# Claude Conversation');
  lines.push('');
  lines.push(`Thread: \`${metadata.threadTs}\` | Channel: \`${metadata.channelId}\``);
  lines.push(`Started: ${formatTimestamp(metadata.createdAt)} | Last updated: ${formatTimestamp(metadata.updatedAt)}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // Messages
  for (const message of messages) {
    const roleLabel = message.role === 'user' ? 'User' : 'Claude';
    lines.push(`### ${roleLabel}`);
    lines.push('');
    lines.push(message.content);
    lines.push('');
  }

  // Tool calls
  if (toolCalls.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push(`## Tool Calls (${String(toolCalls.length)})`);
    lines.push('');

    for (const tc of toolCalls) {
      lines.push(`#### ${escapeMarkdown(tc.toolName)}`);
      lines.push('');
      lines.push('**Input:**');
      lines.push('```json');
      lines.push(JSON.stringify(tc.input, null, 2));
      lines.push('```');
      if (tc.outputPreview) {
        lines.push('');
        lines.push(`**Output:** ${escapeMarkdown(tc.outputPreview)}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Render a 404 error page
 */
export function render404(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Not Found</title>
  <style>${styles}</style>
</head>
<body>
  <main class="container">
    <div class="empty" style="margin-top: 100px;">
      <h1 style="font-size: 3rem; margin-bottom: 20px;">404</h1>
      <p>Conversation not found or has expired.</p>
    </div>
  </main>
</body>
</html>`;
}

/**
 * Render a 401 unauthorized page with redirect to login
 */
export function render401(returnTo?: string): string {
  const loginUrl = returnTo ? `/login?return_to=${encodeURIComponent(returnTo)}` : '/login';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Unauthorized</title>
  <style>${styles}</style>
</head>
<body>
  <main class="container">
    <div class="empty" style="margin-top: 100px;">
      <h1 style="font-size: 3rem; margin-bottom: 20px;">401</h1>
      <p>Authentication required.</p>
      <p style="margin-top: 16px;"><a href="${escapeHtml(loginUrl)}">Log in</a> or use the link provided in Slack.</p>
    </div>
  </main>
</body>
</html>`;
}

/**
 * Render the login page
 */
export function renderLogin(error?: string, returnTo?: string): string {
  const errorHtml = error
    ? `<div class="login-error">${escapeHtml(error)}</div>`
    : '';
  const returnToInput = returnTo
    ? `<input type="hidden" name="return_to" value="${escapeHtml(returnTo)}">`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <title>Login - Server Monitor</title>
  <style>
    ${styles}
    .login-form {
      max-width: 400px;
      margin: 80px auto 0;
      background: var(--card-bg);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 32px;
    }
    .login-form h1 {
      font-size: 1.5rem;
      margin-bottom: 8px;
    }
    .login-form p {
      color: var(--text-muted);
      font-size: 0.875rem;
      margin-bottom: 24px;
    }
    .login-form label {
      display: block;
      font-size: 0.875rem;
      color: var(--text-muted);
      margin-bottom: 6px;
    }
    .login-form input[type="password"] {
      width: 100%;
      padding: 10px 12px;
      font-size: 0.9375rem;
      font-family: 'SF Mono', monospace;
      background: var(--code-bg);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      color: var(--text-color);
      outline: none;
    }
    .login-form input[type="password"]:focus {
      border-color: var(--accent-color);
    }
    .login-form button {
      width: 100%;
      margin-top: 16px;
      padding: 10px;
      font-size: 0.9375rem;
      font-family: inherit;
      color: #fff;
      background: var(--accent-color);
      border: none;
      border-radius: 6px;
      cursor: pointer;
    }
    .login-form button:hover {
      opacity: 0.9;
    }
    .login-error {
      background: rgba(233, 69, 96, 0.15);
      border: 1px solid var(--accent-color);
      border-radius: 6px;
      padding: 10px 14px;
      margin-bottom: 16px;
      font-size: 0.875rem;
      color: var(--accent-color);
    }
  </style>
</head>
<body>
  <main class="container">
    <form class="login-form" method="POST" action="/login">
      <h1>Server Monitor</h1>
      <p>Enter your access token to continue.</p>
      ${errorHtml}
      <label for="token">Access Token</label>
      <input type="password" id="token" name="token" required autocomplete="off" autofocus>
      ${returnToInput}
      <button type="submit">Log in</button>
    </form>
  </main>
</body>
</html>`;
}

/**
 * Render a generic error page
 */
export function renderError(message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Error</title>
  <style>${styles}</style>
</head>
<body>
  <main class="container">
    <div class="empty" style="margin-top: 100px;">
      <h1 style="font-size: 2rem; margin-bottom: 20px;">Error</h1>
      <p>${escapeHtml(message)}</p>
    </div>
  </main>
</body>
</html>`;
}

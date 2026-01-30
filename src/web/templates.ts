/**
 * HTML templates for web UI
 *
 * Renders conversation pages with simple, readable styling.
 * Mobile-friendly design with code block support.
 */

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
 * Convert basic markdown-style formatting to HTML
 * Handles: code blocks, inline code, bold, italic, links
 */
function formatMarkdown(text: string): string {
  // First escape HTML in the text
  let html = escapeHtml(text);

  // Code blocks (```...```)
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match, lang: string, code: string) => {
    const langClass = lang ? ` class="language-${lang}"` : '';
    return `<pre><code${langClass}>${code.trim()}</code></pre>`;
  });

  // Inline code (`...`)
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold (**...**)
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Italic (*...*)
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // Links [text](url) - only allow http/https URLs
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" rel="noopener">$1</a>');

  // Line breaks (preserve them)
  html = html.replace(/\n/g, '<br>\n');

  return html;
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
    font-family: 'SF Mono', monospace;
    font-size: 0.875rem;
    color: #ffd93d;
  }

  .tool-call-content {
    padding: 12px 14px;
    font-size: 0.8125rem;
    color: var(--text-muted);
  }

  .tool-call-content pre {
    margin: 8px 0 0;
    font-size: 0.75rem;
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
 * Render tool calls section
 */
function renderToolCalls(toolCalls: ToolCallLog[]): string {
  if (toolCalls.length === 0) {
    return '';
  }

  const toolCallsHtml = toolCalls
    .map((tc) => {
      const inputJson = JSON.stringify(tc.input, null, 2);
      return `
        <div class="tool-call">
          <div class="tool-call-header">${escapeHtml(tc.toolName)}</div>
          <div class="tool-call-content">
            <strong>Input:</strong>
            <pre><code>${escapeHtml(inputJson)}</code></pre>
            ${tc.outputPreview ? `<strong>Output:</strong> ${escapeHtml(tc.outputPreview)}` : ''}
          </div>
        </div>
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
</body>
</html>`;
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
 * Render a 401 unauthorized page
 */
export function render401(): string {
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
      <p>Authentication required. Please use the link provided in Slack.</p>
    </div>
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

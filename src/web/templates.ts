/**
 * HTML templates for web UI
 *
 * Premium UI with Dracula theme, inline SVG icons, Inter font,
 * animations, and full responsive design.
 * Uses marked for full markdown rendering with syntax highlighting.
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
  // Restrict links to http/https only, add rel="noopener noreferrer", escape all values
  link({ href, text }: Tokens.Link) {
    if (!href.startsWith('http://') && !href.startsWith('https://')) {
      return escapeHtml(text);
    }
    return `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${escapeHtml(text)}</a>`;
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

// ─── Icon System ───────────────────────────────────────────────────────

/**
 * SVG path data for inline icons. Each entry is an array of path `d` attributes
 * drawn inside a 0 0 20 20 viewBox with stroke="currentColor" fill="none".
 */
const ICON_PATHS: Record<string, string[]> = {
  home: ['M3 10.5L10 3.5L17 10.5', 'M5 9.5V16.5C5 17.05 5.45 17.5 6 17.5H8V12.5H12V17.5H14C14.55 17.5 15 17.05 15 16.5V9.5'],
  'arrow-left': ['M15 10H5', 'M10 15L5 10L10 5'],
  search: ['M8.5 14.5a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z', 'M13 13L17 17'],
  star: ['M10 2L12.39 7.26L18 7.97L14 11.82L14.94 17.5L10 14.77L5.06 17.5L6 11.82L2 7.97L7.61 7.26L10 2Z'],
  'star-filled': ['M10 2L12.39 7.26L18 7.97L14 11.82L14.94 17.5L10 14.77L5.06 17.5L6 11.82L2 7.97L7.61 7.26L10 2Z'],
  tag: ['M2.5 2.5H8.5L17.5 11.5L11.5 17.5L2.5 8.5V2.5Z', 'M6 6H6.01'],
  archive: ['M3 5H17', 'M4 5V16C4 16.55 4.45 17 5 17H15C15.55 17 16 16.55 16 16V5', 'M8 9H12'],
  copy: ['M13 3H7C5.9 3 5 3.9 5 5V13', 'M9 7H15C16.1 7 17 7.9 17 9V15C17 16.1 16.1 17 15 17H9C7.9 17 7 16.1 7 15V9C7 7.9 7.9 7 9 7Z'],
  download: ['M10 3V13', 'M6 9L10 13L14 9', 'M3 17H17'],
  send: ['M17 3L10 10', 'M17 3L12 17L10 10L3 8L17 3Z'],
  plus: ['M10 4V16', 'M4 10H16'],
  clock: ['M10 10L10 6', 'M10 10L13.5 13.5', 'M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z'],
  'message-circle': ['M10 18C14.42 18 18 14.42 18 10C18 5.58 14.42 2 10 2C5.58 2 2 5.58 2 10C2 11.73 2.54 13.34 3.46 14.66L2 18L5.34 16.54C6.66 17.46 8.27 18 10 18Z'],
  wrench: ['M14.7 6.3a1 1 0 0 0 0-1.4L13.1 3.2a1 1 0 0 0-1.4 0l-1.3 1.3 2.8 2.8 1.5-1Z', 'M3 17l8.3-8.3 2.8 2.8L5.8 19.8a1 1 0 0 1-1.4 0L3 18.4a1 1 0 0 1 0-1.4Z'],
  'chevron-down': ['M5 7L10 12L15 7'],
  check: ['M4 10L8 14L16 6'],
  x: ['M5 5L15 15', 'M15 5L5 15'],
  eye: ['M2 10C2 10 5.5 4 10 4C14.5 4 18 10 18 10C18 10 14.5 16 10 16C5.5 16 2 10 2 10Z', 'M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z'],
  'eye-off': ['M2 2L18 18', 'M6.7 6.7C4.6 8 3 10 3 10C3 10 6 16 10 16C11.4 16 12.7 15.5 13.8 14.8', 'M10 4C14 4 17 10 17 10C17 10 16.3 11.4 15 12.5', 'M10 7.5a2.5 2.5 0 0 1 2.5 2.5'],
  robot: ['M10 6C6.69 6 4 8.69 4 12V14C4 15.1 4.9 16 6 16H14C15.1 16 16 15.1 16 14V12C16 8.69 13.31 6 10 6Z', 'M7.5 11.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z', 'M12.5 11.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z', 'M10 3V6', 'M6 3.5L8 6', 'M14 3.5L12 6'],
  logout: ['M9 17H5C4.45 17 4 16.55 4 16V4C4 3.45 4.45 3 5 3H9', 'M13 15L17 10L13 5', 'M17 10H7'],
  sun: ['M10 14a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M10 1V3', 'M10 17V19', 'M3.22 3.22L4.64 4.64', 'M15.36 15.36L16.78 16.78', 'M1 10H3', 'M17 10H19', 'M3.22 16.78L4.64 15.36', 'M15.36 4.64L16.78 3.22'],
  moon: ['M17 10.5C17 14.09 14.09 17 10.5 17C6.91 17 4 14.09 4 10.5C4 6.91 6.91 4 10.5 4C10.5 4 9 7 10.5 9.5C12 12 15.5 10.5 15.5 10.5C16.5 10.5 17 10.5 17 10.5Z'],
};

/**
 * Return an inline SVG for the given icon name.
 * Returns empty string for unknown icons.
 */
export function icon(name: string, size = 20): string {
  const paths = ICON_PATHS[name];
  if (!paths) return '';

  const fill = name === 'star-filled' ? 'currentColor' : 'none';
  const pathsStr = paths.map((d) => `<path d="${d}" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${String(size)}" height="${String(size)}" viewBox="0 0 20 20" fill="${fill}" stroke="currentColor" stroke-width="1.5">${pathsStr}</svg>`;
}

// ─── Theme System ──────────────────────────────────────────────────────

/**
 * CSS variables for Dracula (default) and light themes
 */
export function getThemeStyles(): string {
  return `
  :root, [data-theme="dracula"] {
    --bg: #282a36;
    --bg-secondary: #1e1f29;
    --surface: #44475a;
    --surface-hover: #525568;
    --text: #f8f8f2;
    --text-muted: #6272a4;
    --accent: #ff79c6;
    --accent-secondary: #bd93f9;
    --cyan: #8be9fd;
    --green: #50fa7b;
    --orange: #ffb86c;
    --purple: #bd93f9;
    --red: #ff5555;
    --yellow: #f1fa8c;
    --pink: #ff79c6;
    --code-bg: #21222c;
    --border: #44475a;
    --shadow: rgba(0, 0, 0, 0.3);
    --card-bg: #2d2f3d;
    --nav-bg: #21222c;
    --link: #8be9fd;
    color-scheme: dark;
  }

  [data-theme="light"] {
    --bg: #f8f8f2;
    --bg-secondary: #eee;
    --surface: #e8e8e2;
    --surface-hover: #d8d8d2;
    --text: #282a36;
    --text-muted: #6272a4;
    --accent: #d6368f;
    --accent-secondary: #7c4ddb;
    --cyan: #0e7490;
    --green: #16803c;
    --orange: #c2410c;
    --purple: #7c3aed;
    --red: #dc2626;
    --yellow: #a16207;
    --pink: #d6368f;
    --code-bg: #e8e8e2;
    --border: #d4d4d4;
    --shadow: rgba(0, 0, 0, 0.08);
    --card-bg: #fff;
    --nav-bg: #fff;
    --link: #0e7490;
    color-scheme: light;
  }
  `;
}

/**
 * Base CSS styles for all pages (replaces old `styles` constant)
 */
export function getBaseStyles(): string {
  return `
  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    background-color: var(--bg);
    color: var(--text);
    line-height: 1.6;
    padding: 0;
    margin: 0;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  .container {
    max-width: 960px;
    margin: 0 auto;
    padding: 24px;
  }

  /* Nav bar */
  .nav-bar {
    position: sticky;
    top: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 24px;
    background: var(--nav-bg);
    border-bottom: 1px solid var(--border);
    backdrop-filter: blur(8px);
  }
  .nav-brand {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text);
    text-decoration: none;
    font-weight: 600;
    font-size: 0.9375rem;
  }
  .nav-brand:hover { text-decoration: none; opacity: 0.85; }
  .nav-brand svg { color: var(--accent); }
  .nav-actions {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .theme-toggle {
    background: none;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 6px;
    cursor: pointer;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color 0.2s, border-color 0.2s;
  }
  .theme-toggle:hover { color: var(--accent); border-color: var(--accent); }
  /* Show sun in dark mode (click to go light), moon in light mode (click to go dark) */
  [data-theme="dracula"] .icon-moon, :root .icon-moon { display: none; }
  [data-theme="dracula"] .icon-sun, :root .icon-sun { display: inline; }
  [data-theme="light"] .icon-sun { display: none; }
  [data-theme="light"] .icon-moon { display: inline; }
  .logout-btn {
    background: none;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 6px;
    cursor: pointer;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color 0.2s, border-color 0.2s;
  }
  .logout-btn:hover { color: var(--red); border-color: var(--red); }

  /* Mobile hamburger */
  .nav-hamburger {
    display: none;
    background: none;
    border: none;
    color: var(--text);
    cursor: pointer;
    padding: 4px;
  }
  @media (max-width: 640px) {
    .nav-hamburger { display: flex; }
    .nav-actions { display: none; }
    .nav-actions.open { display: flex; flex-direction: column; position: absolute; top: 100%; right: 0; background: var(--nav-bg); border: 1px solid var(--border); border-radius: 0 0 8px 8px; padding: 12px; gap: 8px; }
  }

  /* Messages */
  .message {
    margin-bottom: 20px;
    border-radius: 12px;
    overflow: hidden;
    transition: transform 0.15s ease;
  }

  .message-header {
    padding: 12px 16px;
    font-weight: 600;
    font-size: 0.8125rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.75rem;
    font-weight: 700;
    flex-shrink: 0;
  }

  .message-content {
    padding: 16px;
    font-size: 0.9375rem;
  }

  .message.user {
    background: var(--card-bg);
    border-left: 3px solid var(--cyan);
  }

  .message.user .message-header {
    color: var(--cyan);
  }

  .message.user .avatar {
    background: var(--cyan);
    color: var(--bg);
  }

  .message.assistant {
    background: var(--surface);
    border: 1px solid var(--border);
  }

  .message.assistant .message-header {
    color: var(--accent);
  }

  .message.assistant .avatar {
    background: var(--accent);
    color: var(--bg);
  }

  .avatar-glow {
    box-shadow: 0 0 8px rgba(255, 121, 198, 0.3);
  }

  /* Code */
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
    border: 1px solid var(--border);
  }

  pre code {
    background: none;
    padding: 0;
    font-size: 0.875rem;
    line-height: 1.5;
  }

  /* Content typography */
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
    border-left: 3px solid var(--accent);
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
    border: 1px solid var(--border);
    padding: 8px 12px;
    text-align: left;
  }

  .message-content th {
    background: var(--surface);
    font-weight: 600;
  }

  .message-content hr {
    border: none;
    border-top: 1px solid var(--border);
    margin: 20px 0;
  }

  a {
    color: var(--link);
    text-decoration: none;
  }

  a:hover {
    text-decoration: underline;
  }

  /* Tool calls */
  .tool-calls {
    margin-top: 30px;
    border-top: 1px solid var(--border);
    padding-top: 20px;
  }

  .tool-calls h2 {
    font-size: 1.125rem;
    color: var(--text-muted);
    margin-bottom: 16px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .tool-call {
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    margin-bottom: 12px;
    overflow: hidden;
    transition: border-color 0.2s;
  }

  .tool-call:hover {
    border-color: var(--surface-hover);
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
    gap: 8px;
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
    color: var(--yellow);
  }

  .tool-call-meta {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .tool-call-status {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 0.75rem;
  }

  .tool-call-status.success { color: var(--green); }
  .tool-call-status.failure { color: var(--red); }

  .tool-call-duration {
    font-size: 0.6875rem;
    padding: 2px 6px;
    background: var(--surface);
    border-radius: 10px;
    color: var(--text-muted);
  }

  .tool-call-time {
    color: var(--text-muted);
    font-size: 0.75rem;
  }

  .tool-call-content {
    padding: 12px 14px;
    font-size: 0.8125rem;
    color: var(--text-muted);
    border-top: 1px solid var(--border);
  }

  .tool-call-content pre {
    margin: 8px 0 0;
    font-size: 0.75rem;
  }

  .tool-call-output {
    margin-top: 12px;
    padding-top: 8px;
    border-top: 1px dashed var(--border);
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
    border-top: 1px solid var(--border);
  }

  /* Action buttons */
  .export-actions {
    margin-top: 12px;
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .export-btn {
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
    text-decoration: none;
    transition: background 0.2s, border-color 0.2s;
  }

  .export-btn:hover {
    background: var(--surface-hover);
    text-decoration: none;
  }

  /* Continue form */
  .continue-form {
    margin-top: 30px;
    border-top: 1px solid var(--border);
    padding-top: 20px;
  }

  .continue-form h2 {
    font-size: 1.125rem;
    color: var(--text-muted);
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .continue-form textarea {
    width: 100%;
    min-height: 80px;
    padding: 12px;
    font-size: 0.9375rem;
    font-family: inherit;
    background: var(--code-bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text);
    resize: vertical;
    outline: none;
    transition: border-color 0.2s;
  }

  .continue-form textarea:focus {
    border-color: var(--accent);
  }

  .char-count {
    font-size: 0.75rem;
    color: var(--text-muted);
    text-align: right;
    margin-top: 4px;
    transition: color 0.2s;
  }
  .char-count.warning { color: var(--orange); }
  .char-count.danger { color: var(--red); }

  .continue-form-actions {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 10px;
  }

  .continue-form button[type="submit"] {
    padding: 10px 20px;
    font-size: 0.9375rem;
    font-family: inherit;
    color: #fff;
    background: linear-gradient(135deg, var(--accent), var(--accent-secondary));
    border: none;
    border-radius: 6px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
    transition: opacity 0.2s;
  }

  .continue-form button[type="submit"]:hover {
    opacity: 0.9;
  }

  .continue-form button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .continue-form .continue-error {
    margin-top: 10px;
    padding: 10px 14px;
    background: rgba(255, 85, 85, 0.15);
    border: 1px solid var(--red);
    border-radius: 6px;
    font-size: 0.875rem;
    color: var(--red);
    display: none;
  }

  .continue-form .continue-spinner {
    display: none;
    margin-top: 10px;
    color: var(--text-muted);
    font-size: 0.875rem;
  }

  /* Toast system */
  .toast-container {
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 9999;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .toast {
    padding: 12px 20px;
    border-radius: 8px;
    font-size: 0.875rem;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    box-shadow: 0 4px 12px var(--shadow);
    animation: toast-in 0.3s ease forwards;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .toast.success { border-left: 3px solid var(--green); }
  .toast.error { border-left: 3px solid var(--red); }
  .toast.removing { animation: toast-out 0.3s ease forwards; }

  /* Skeleton loading */
  .skeleton {
    background: linear-gradient(90deg, var(--surface) 25%, var(--surface-hover) 50%, var(--surface) 75%);
    background-size: 200% 100%;
    animation: skeleton-shimmer 1.5s infinite;
    border-radius: var(--radius-md, 10px);
  }
  @keyframes skeleton-shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
  .skeleton-card { height: 80px; margin-bottom: 10px; }
  .skeleton-line { height: 16px; margin-bottom: 8px; width: 60%; }
  .skeleton-line.short { width: 30%; }

  /* Keyboard navigation focus */
  .session-card.kb-focused {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  /* Keyboard help overlay */
  .kb-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.6);
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .kb-overlay-content {
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 28px 36px;
    max-width: 480px;
    width: 90%;
    box-shadow: 0 8px 32px var(--shadow);
  }
  .kb-overlay-content h2 {
    margin-bottom: 16px;
    font-size: 1.25rem;
  }
  .kb-overlay-content table {
    width: 100%;
    border-collapse: collapse;
  }
  .kb-overlay-content th,
  .kb-overlay-content td {
    padding: 6px 10px;
    text-align: left;
    border-bottom: 1px solid var(--border);
    font-size: 0.875rem;
  }
  .kb-overlay-content th {
    color: var(--text-muted);
    font-weight: 600;
  }
  kbd {
    font-family: 'SF Mono', 'Fira Code', monospace;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 2px 6px;
    font-size: 0.8125rem;
    box-shadow: 0 1px 2px var(--shadow);
  }
  .kb-hint {
    margin-top: 16px;
    text-align: center;
    color: var(--text-muted);
    font-size: 0.8125rem;
  }

  @media (max-width: 640px) {
    .container { padding: 12px; }
    .nav-bar { padding: 10px 16px; }
    .message-content { padding: 12px; }
    pre { padding: 12px; font-size: 0.8125rem; }
    .toast-container { bottom: 12px; right: 12px; left: 12px; }
  }
  `;
}

/**
 * CSS animations and transitions
 */
export function getAnimationStyles(): string {
  return `
  @keyframes star-pop {
    0% { transform: scale(1); }
    50% { transform: scale(1.4); }
    100% { transform: scale(1); }
  }

  @keyframes toast-in {
    from { transform: translateX(100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }

  @keyframes toast-out {
    from { transform: translateX(0); opacity: 1; }
    to { transform: translateX(100%); opacity: 0; }
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  .animate-star-pop {
    animation: star-pop 0.3s ease;
  }

  .animate-pulse {
    animation: pulse 1.5s infinite;
  }

  .transition-lift {
    transition: transform 0.2s ease, box-shadow 0.2s ease;
  }
  .transition-lift:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px var(--shadow);
  }
  `;
}

// ─── Keyboard Shortcuts ─────────────────────────────────────────────────

/**
 * Return a <script> block implementing keyboard shortcuts.
 *
 * Global: ? (help), t (theme), / (focus search), Escape (close/blur)
 * Session list: j/k (navigate cards), Enter (open), s (star), n (new), 1/2/3 (tabs)
 * Conversation detail: j/k (scroll), s (star), a (archive), c (copy), e (export), h/Backspace (back)
 */
function getKeyboardShortcutScript(): string {
  return `
  <script>
  (function() {
    var focusIndex = -1;
    function getCards() { return document.querySelectorAll('.session-card'); }
    function isSessionList() { return getCards().length > 0; }
    function isConvDetail() { return !!document.querySelector('.conv-header'); }

    function updateFocus(cards, idx) {
      cards.forEach(function(c) { c.classList.remove('kb-focused'); });
      if (idx >= 0 && idx < cards.length) {
        cards[idx].classList.add('kb-focused');
        cards[idx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }

    function isOverlayOpen() {
      var help = document.getElementById('keyboard-help');
      return help && help.style.display !== 'none';
    }

    document.addEventListener('keydown', function(e) {
      var tag = e.target.tagName;
      var isFormElement = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable;
      if (isFormElement) {
        if (e.key === 'Escape') { e.target.blur(); }
        return;
      }

      // Global: ? toggle help overlay
      if (e.key === '?') {
        e.preventDefault();
        var help = document.getElementById('keyboard-help');
        if (help) {
          var isOpen = help.style.display !== 'none';
          help.style.display = isOpen ? 'none' : 'flex';
          if (!isOpen) {
            // Focus the overlay content for accessibility
            var content = help.querySelector('.kb-overlay-content');
            if (content) content.focus();
          }
        }
        return;
      }

      // Global: Escape — hide help, blur
      if (e.key === 'Escape') {
        var helpEl = document.getElementById('keyboard-help');
        if (helpEl && helpEl.style.display !== 'none') { helpEl.style.display = 'none'; return; }
        if (document.activeElement) document.activeElement.blur();
        return;
      }

      // Don't fire other shortcuts when help overlay is open
      if (isOverlayOpen()) return;

      // Global: t — toggle theme
      if (e.key === 't') {
        var tb = document.getElementById('theme-toggle');
        if (tb) tb.click();
        return;
      }

      // Global: / — focus search input
      if (e.key === '/') {
        var si = document.querySelector('.search-input') || document.getElementById('continue-input');
        if (si) { e.preventDefault(); si.focus(); }
        return;
      }

      // Navigation shortcuts only fire when focus is on body (not on buttons/links)
      var onBody = !document.activeElement || document.activeElement === document.body;

      // Session list shortcuts
      if (isSessionList()) {
        var cards = getCards();
        if (cards.length === 0) return;
        if (e.key === 'j') { focusIndex = Math.min(focusIndex + 1, cards.length - 1); updateFocus(cards, focusIndex); return; }
        if (e.key === 'k') { focusIndex = Math.max(focusIndex - 1, 0); updateFocus(cards, focusIndex); return; }
        if (e.key === 'Enter' && focusIndex >= 0 && focusIndex < cards.length) {
          var href = cards[focusIndex].getAttribute('href');
          if (href && href.charAt(0) === '/') window.location.href = href;
          return;
        }
        if (e.key === 's' && focusIndex >= 0 && focusIndex < cards.length) {
          var star = cards[focusIndex].querySelector('.favorite-star');
          if (star) star.click();
          return;
        }
        if (e.key === 'n') { window.location.href = '/c/new'; return; }
        var tabKeys = ['1','2','3'];
        if (tabKeys.indexOf(e.key) !== -1) {
          var tabs = document.querySelectorAll('.nav-tabs a');
          var ti = parseInt(e.key, 10) - 1;
          if (tabs[ti]) { var tabHref = tabs[ti].getAttribute('href'); if (tabHref && tabHref.charAt(0) === '/') window.location.href = tabHref; }
          return;
        }
      }

      // Conversation detail shortcuts
      if (isConvDetail()) {
        if (e.key === 'j') { window.scrollBy({ top: 200, behavior: 'smooth' }); return; }
        if (e.key === 'k') { window.scrollBy({ top: -200, behavior: 'smooth' }); return; }
        if (e.key === 's') { var ds = document.querySelector('.detail-favorite-star'); if (ds) ds.click(); return; }
        if (e.key === 'a') { var ab = document.getElementById('archive-btn'); if (ab) ab.click(); return; }
        if (e.key === 'c') { var cb = document.getElementById('copy-clipboard'); if (cb) cb.click(); return; }
        if (e.key === 'e') { var eb = document.getElementById('export-md'); if (eb) eb.click(); return; }
        if (onBody && (e.key === 'h' || e.key === 'Backspace')) {
          var bl = document.querySelector('.conv-back');
          if (bl) { var backHref = bl.getAttribute('href'); if (backHref && backHref.charAt(0) === '/') window.location.href = backHref; }
          return;
        }
      }
    });
  })();
  </script>`;
}

/**
 * Return the keyboard help overlay HTML (hidden by default)
 */
function getKeyboardHelpOverlay(): string {
  return `
  <div id="keyboard-help" class="kb-overlay" style="display:none;" role="dialog" aria-labelledby="kb-overlay-title">
    <div class="kb-overlay-content" tabindex="-1">
      <h2 id="kb-overlay-title">Keyboard Shortcuts</h2>
      <table>
        <tr><th>Key</th><th>Action</th></tr>
        <tr><td><kbd>?</kbd></td><td>Toggle this help</td></tr>
        <tr><td><kbd>t</kbd></td><td>Toggle theme</td></tr>
        <tr><td><kbd>/</kbd></td><td>Focus search</td></tr>
        <tr><td><kbd>Esc</kbd></td><td>Close / blur</td></tr>
        <tr><td colspan="2" style="color:var(--accent);padding-top:8px;">Session List</td></tr>
        <tr><td><kbd>j</kbd> / <kbd>k</kbd></td><td>Navigate cards</td></tr>
        <tr><td><kbd>Enter</kbd></td><td>Open conversation</td></tr>
        <tr><td><kbd>s</kbd></td><td>Toggle star</td></tr>
        <tr><td><kbd>n</kbd></td><td>New conversation</td></tr>
        <tr><td><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd></td><td>Switch tab</td></tr>
        <tr><td colspan="2" style="color:var(--accent);padding-top:8px;">Conversation</td></tr>
        <tr><td><kbd>j</kbd> / <kbd>k</kbd></td><td>Scroll down / up</td></tr>
        <tr><td><kbd>s</kbd></td><td>Toggle star</td></tr>
        <tr><td><kbd>a</kbd></td><td>Archive</td></tr>
        <tr><td><kbd>c</kbd></td><td>Copy to clipboard</td></tr>
        <tr><td><kbd>e</kbd></td><td>Export markdown</td></tr>
        <tr><td><kbd>h</kbd></td><td>Back to list</td></tr>
      </table>
      <p class="kb-hint">Press <kbd>?</kbd> to close</p>
    </div>
  </div>`;
}

// ─── Shell / Layout ────────────────────────────────────────────────────

interface ShellOptions {
  title: string;
  styles: string;
  body: string;
  scripts?: string;
  showNav?: boolean;
  highlightJs?: boolean;
}

/**
 * Wrap page content in the full HTML shell with nav, theme, fonts
 */
export function wrapInShell(opts: ShellOptions): string {
  const { title, styles: pageStyles, body, scripts = '', showNav = true, highlightJs = false } = opts;

  const hljsLink = highlightJs
    ? `<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css" integrity="sha384-wH75j6z1lH97ZOpMOInqhgKzFkAInZPPSPlZpYKYTOqsaizPvhQZmAtLcPKXpLyH" crossorigin="anonymous">`
    : '';
  const hljsScript = highlightJs
    ? `<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js" integrity="sha384-F/bZzf7p3Joyp5psL90p/p89AZJsndkSoGwRpXcZhleCWhd8SnRuoYo4d0yirjJp" crossorigin="anonymous"></script>
  <script>hljs.highlightAll();</script>`
    : '';

  const navHtml = showNav ? `
  <nav class="nav-bar">
    <a href="/" class="nav-brand">${icon('robot', 22)} Server Monitor</a>
    <button class="nav-hamburger" id="nav-hamburger" type="button" aria-label="Menu">${icon('chevron-down', 20)}</button>
    <div class="nav-actions" id="nav-actions">
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
    if (!btn || !actions) return;
    btn.addEventListener('click', function() {
      actions.classList.toggle('open');
    });
  })();
  </script>
  ${getKeyboardShortcutScript()}
  ${scripts}
  ${getKeyboardHelpOverlay()}
</body>
</html>`;
}

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
  }
  .session-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px var(--shadow);
    border-color: var(--surface-hover);
    text-decoration: none;
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
`;

import type { SessionSummary, SessionStats, PaginationInfo, TagInfo } from '../services/conversation-store.js';

// ─── Dashboard Home Page ──────────────────────────────────────────────

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

  // Quick actions
  const quickActionsHtml = `
    <div class="quick-actions">
      <a href="/c/new" class="primary">${icon('plus', 16)} New Conversation</a>
      <a href="/c">${icon('search', 16)} Search</a>
      <a href="/c">${icon('message-circle', 16)} All Conversations</a>
    </div>`;

  // Build the grid: left column = tools + tags, right column = recent + favorites
  const leftCol = [toolChartHtml, tagsHtml].filter(Boolean).join('\n');
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

  return wrapInShell({
    title: 'Dashboard',
    styles: dashboardStyles,
    body: bodyHtml,
  });
}

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
      <button type="submit" class="search-btn">${icon('search', 16)} Search</button>
    </form>`;

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

    emptyHtml = `<div class="empty-state">${emptyIcon}<div class="empty-title">${emptyTitle}</div><div class="empty-subtext">${emptySubtext}</div></div>`;
  }

  const sessionRows = sessions.length === 0
    ? emptyHtml
    : sessions.map((s, i) => {
        const link = `/c/${encodeURIComponent(s.threadTs)}/${encodeURIComponent(s.channelId)}`;
        const date = formatTimestamp(s.updatedAt);
        const starClass = s.isFavorited ? 'favorite-star active' : 'favorite-star';
        const tagPills = (s.tags ?? []).map((t) =>
          `<span class="tag">${escapeHtml(t)}</span>`
        ).join('');
        const sessionTitle = s.firstMessage ? escapeHtml(s.firstMessage) : `${escapeHtml(s.userId)} &middot; ${escapeHtml(s.channelId)}`;
        return `<a href="${escapeHtml(link)}" class="session-card" data-index="${String(i)}">
          <div class="session-card-body">
            <div class="session-card-title"><span class="${starClass}" data-id="${String(s.id)}" tabindex="0" role="button" aria-label="Toggle favorite">&#9733;</span> ${sessionTitle}</div>
            <div class="session-meta">${icon('clock', 14)} ${date}${tagPills ? ` ${tagPills}` : ''}</div>
          </div>
          <div class="session-stats">
            <span class="session-stat">${icon('message-circle', 14)} ${String(s.messageCount)} msgs</span>
            <span class="session-stat">${icon('wrench', 14)} ${String(s.toolCallCount)} tools</span>
          </div>
        </a>`;
      }).join('\n');

  const tagSidebar = allTags.length > 0
    ? `<div class="tag-sidebar">
        <h3>${icon('tag', 14)} Tags</h3>
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

  return wrapInShell({
    title,
    styles: sessionListStyles,
    body: bodyHtml,
    scripts: starScript,
  });
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
    <div class="tool-calls">
      <h2>${icon('wrench', 18)} Tool Calls (${String(toolCalls.length)})</h2>
      ${toolCallsHtml}
    </div>
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
 * Render the continue form JavaScript
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

      form.addEventListener('submit', function(e) {
        e.preventDefault();
        var message = input.value.trim();
        if (!message) return;

        submitBtn.disabled = true;
        spinner.style.display = 'block';
        errorDiv.style.display = 'none';

        var skeleton = document.createElement('div');
        skeleton.className = 'message assistant skeleton-message';
        skeleton.innerHTML = '<div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line short"></div>';
        var mainEl = document.querySelector('.container main') || document.querySelector('main');
        if (mainEl) mainEl.appendChild(skeleton);

        fetch(window.location.pathname + '/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: message }),
          credentials: 'same-origin'
        })
        .then(function(res) { return res.json().then(function(data) { return { ok: res.ok, data: data }; }); })
        .then(function(result) {
          if (result.ok) {
            window.location.reload();
          } else {
            errorDiv.textContent = result.data.error || 'An error occurred';
            errorDiv.style.display = 'block';
            submitBtn.disabled = false;
            spinner.style.display = 'none';
          }
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
    ${toolCallsHtml}
    ${continueFormHtml}
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
  ${continueScriptHtml}`;

  return wrapInShell({
    title: 'Claude Conversation',
    styles: conversationDetailStyles,
    body: bodyHtml,
    scripts,
    highlightJs: true,
  });
}

// ─── Markdown Export (unchanged) ───────────────────────────────────────

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

// ─── Error / Auth Pages ────────────────────────────────────────────────

/**
 * Render a 404 error page
 */
export function render404(): string {
  const bodyHtml = `
  <main class="container">
    <div class="empty" style="margin-top: 100px;">
      ${icon('search', 48)}
      <h1 style="font-size: 3rem; margin: 20px 0 12px;">404</h1>
      <p>Conversation not found or has expired.</p>
      <p style="margin-top: 20px;"><a href="/c" class="export-btn">${icon('home', 14)} Back to conversations</a></p>
    </div>
  </main>`;

  return wrapInShell({
    title: 'Not Found',
    styles: '',
    body: bodyHtml,
    showNav: false,
  });
}

/**
 * Render a 401 unauthorized page with redirect to login
 */
export function render401(returnTo?: string): string {
  const loginUrl = returnTo ? `/login?return_to=${encodeURIComponent(returnTo)}` : '/login';
  const bodyHtml = `
  <main class="container">
    <div class="empty" style="margin-top: 100px;">
      ${icon('eye-off', 48)}
      <h1 style="font-size: 3rem; margin: 20px 0 12px;">401</h1>
      <p>Authentication required.</p>
      <p style="margin-top: 20px;"><a href="${escapeHtml(loginUrl)}" class="export-btn">${icon('logout', 14)} Log in</a> or use the link provided in Slack.</p>
    </div>
  </main>`;

  return wrapInShell({
    title: 'Unauthorized',
    styles: '',
    body: bodyHtml,
    showNav: false,
  });
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

  const loginStyles = `
    .login-page {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, var(--bg), var(--bg-secondary));
    }
    .login-form {
      width: 100%;
      max-width: 400px;
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 36px;
      box-shadow: 0 8px 32px var(--shadow);
    }
    .login-brand {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
    }
    .login-brand svg { color: var(--accent); }
    .login-form h1 {
      font-size: 1.5rem;
    }
    .login-subtitle {
      color: var(--text-muted);
      font-size: 0.875rem;
      margin-top: 4px;
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
    .login-input-wrapper {
      position: relative;
    }
    .login-form input[type="password"],
    .login-form input[type="text"] {
      width: 100%;
      padding: 10px 40px 10px 12px;
      font-size: 0.9375rem;
      font-family: 'SF Mono', monospace;
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
      outline: none;
      transition: border-color 0.2s;
    }
    .login-form input:focus {
      border-color: var(--accent);
    }
    .toggle-password {
      position: absolute;
      right: 8px;
      top: 50%;
      transform: translateY(-50%);
      background: none;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      padding: 4px;
      display: flex;
    }
    .toggle-password:hover { color: var(--text); }
    .login-form button[type="submit"] {
      width: 100%;
      margin-top: 16px;
      padding: 10px;
      font-size: 0.9375rem;
      font-family: inherit;
      color: #fff;
      background: linear-gradient(135deg, var(--accent), var(--accent-secondary));
      border: none;
      border-radius: 6px;
      cursor: pointer;
      transition: opacity 0.2s;
    }
    .login-form button[type="submit"]:hover {
      opacity: 0.9;
    }
    .login-error {
      background: rgba(255, 85, 85, 0.15);
      border: 1px solid var(--red);
      border-radius: 6px;
      padding: 10px 14px;
      margin-bottom: 16px;
      font-size: 0.875rem;
      color: var(--red);
    }
  `;

  const bodyHtml = `
  <main class="login-page">
    <form class="login-form" method="POST" action="/login">
      <div class="login-brand">${icon('robot', 28)} <h1>Server Monitor</h1></div>
      <p class="login-subtitle">AI-powered server diagnostics</p>
      <p>Enter your access token to continue.</p>
      ${errorHtml}
      <label for="token">Access Token</label>
      <div class="login-input-wrapper">
        <input type="password" id="token" name="token" required autocomplete="off" autofocus>
        <button type="button" class="toggle-password" id="toggle-password" aria-label="Show password">${icon('eye', 16)}</button>
      </div>
      ${returnToInput}
      <button type="submit">${icon('logout', 16)} Log in</button>
    </form>
  </main>`;

  const scripts = `
  <script>
  (function() {
    var btn = document.getElementById('toggle-password');
    var input = document.getElementById('token');
    if (!btn || !input) return;
    btn.addEventListener('click', function() {
      var isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';
    });
  })();
  </script>`;

  return wrapInShell({
    title: 'Login - Server Monitor',
    styles: loginStyles,
    body: bodyHtml,
    scripts,
    showNav: false,
  });
}

/**
 * Render a generic error page
 */
export function renderError(message: string): string {
  const bodyHtml = `
  <main class="container">
    <div class="empty" style="margin-top: 100px;">
      ${icon('x', 48)}
      <h1 style="font-size: 2rem; margin: 20px 0 12px;">Error</h1>
      <p>${escapeHtml(message)}</p>
      <p style="margin-top: 20px;"><a href="/c" class="export-btn">${icon('home', 14)} Back to conversations</a></p>
    </div>
  </main>`;

  return wrapInShell({
    title: 'Error',
    styles: '',
    body: bodyHtml,
    showNav: false,
  });
}

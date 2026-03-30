/**
 * Base CSS styles and animation styles for all pages
 */

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
  .nav-plugins {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-left: 16px;
  }
  .nav-plugin-link {
    color: var(--text-muted);
    text-decoration: none;
    font-size: 0.8rem;
    padding: 4px 10px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    gap: 4px;
    transition: color 0.15s, background 0.15s;
  }
  .nav-plugin-link:hover {
    color: var(--fg);
    background: var(--surface);
    text-decoration: none;
  }
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

  /* Notification bell */
  .notif-bell-wrapper {
    position: relative;
  }
  .notification-bell {
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
    position: relative;
  }
  .notification-bell:hover { color: var(--accent); border-color: var(--accent); }
  .notif-badge {
    position: absolute;
    top: -4px;
    right: -4px;
    background: #ff5555;
    color: #fff;
    font-size: 0.6rem;
    font-weight: 700;
    min-width: 16px;
    height: 16px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 3px;
    line-height: 1;
  }

  /* Notification dropdown */
  .notif-dropdown {
    display: none;
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    width: 320px;
    max-height: 400px;
    overflow-y: auto;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.3);
    z-index: 100;
  }
  .notif-dropdown.open { display: block; }
  .notif-dropdown-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
    font-size: 0.85rem;
    font-weight: 600;
  }
  .notif-mark-all {
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
    font-size: 0.75rem;
  }
  .notif-mark-all:hover { text-decoration: underline; }
  .notif-item {
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
    transition: background 0.15s;
  }
  .notif-item:last-child { border-bottom: none; }
  .notif-item:hover { background: var(--bg); }
  .notif-item.notif-read { opacity: 0.5; }
  .notif-item .notif-link {
    display: flex;
    justify-content: space-between;
    align-items: center;
    text-decoration: none;
    color: var(--fg);
  }
  .notif-item .notif-title {
    font-size: 0.8rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .notif-item .notif-time {
    font-size: 0.7rem;
    color: var(--text-muted);
    white-space: nowrap;
    margin-left: 8px;
  }
  .notif-item.notif-info { border-left: 3px solid var(--accent); }
  .notif-item.notif-warn { border-left: 3px solid #f1fa8c; }
  .notif-item.notif-error { border-left: 3px solid #ff5555; }
  .notif-dropdown-footer {
    padding: 8px 14px;
    border-top: 1px solid var(--border);
    text-align: center;
  }
  .notif-dropdown-footer a {
    color: var(--accent);
    text-decoration: none;
    font-size: 0.8rem;
  }
  .notif-dropdown-footer a:hover { text-decoration: underline; }
  .notif-dropdown-empty {
    padding: 24px;
    text-align: center;
    color: var(--text-muted);
    font-size: 0.85rem;
  }

  /* Plugin component styles */
  .plugin-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 16px;
    margin-bottom: 12px;
  }
  .plugin-card-title {
    font-size: 0.9rem;
    font-weight: 600;
    margin-bottom: 8px;
  }
  .plugin-card-title a {
    color: var(--fg);
    text-decoration: none;
  }
  .plugin-card-title a:hover { color: var(--accent); }
  .plugin-card-body { font-size: 0.85rem; }
  .plugin-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
  }
  .plugin-table th, .plugin-table td {
    padding: 8px 12px;
    text-align: left;
    border-bottom: 1px solid var(--border);
  }
  .plugin-table th {
    color: var(--text-muted);
    font-weight: 600;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .plugin-table tr:last-child td { border-bottom: none; }
  .plugin-chart {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .plugin-chart-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .plugin-chart-label {
    font-size: 0.8rem;
    min-width: 80px;
    white-space: nowrap;
  }
  .plugin-chart-bar {
    height: 20px;
    background: var(--accent);
    border-radius: 4px;
    min-width: 4px;
    opacity: 0.8;
  }
  .plugin-chart-value {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

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

  /* Inline code */
  code {
    font-family: 'SF Mono', 'Fira Code', 'Monaco', 'Inconsolata', monospace;
    background: var(--code-bg);
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 0.875em;
  }

  /* Code block wrapper */
  .code-block {
    margin: 12px 0;
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
  }

  .code-block-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 12px;
    background: rgba(255, 255, 255, 0.03);
    border-bottom: 1px solid var(--border);
    min-height: 32px;
  }

  .code-lang {
    font-size: 0.6875rem;
    color: var(--text-muted);
    font-family: 'SF Mono', monospace;
    text-transform: lowercase;
  }

  .code-copy-btn {
    font-size: 0.6875rem;
    font-family: inherit;
    color: var(--text-muted);
    background: none;
    border: 1px solid transparent;
    border-radius: 4px;
    padding: 2px 8px;
    cursor: pointer;
    transition: color 0.2s, border-color 0.2s;
  }

  .code-copy-btn:hover {
    color: var(--text);
    border-color: var(--border);
  }

  .code-copy-btn.copied {
    color: var(--green);
  }

  .code-block pre {
    margin: 0;
    border: none;
    border-radius: 0;
    background: transparent;
  }

  /* Standalone pre (without .code-block wrapper, e.g. tool call output) */
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

  /* Diff highlighting */
  .language-diff .hljs-addition {
    color: var(--green);
    background: rgba(80, 250, 123, 0.1);
  }

  .language-diff .hljs-deletion {
    color: var(--red);
    background: rgba(255, 85, 85, 0.1);
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

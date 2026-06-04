/**
 * Base CSS styles and animation styles for all pages
 */

import { createHash } from 'node:crypto';
import { getThemeStyles } from './theme.js';

/** Combined CSS bundle for the static /static/styles.css endpoint. */
let staticCssCache: string | null = null;
let staticCssHash: string | null = null;

export function getStaticCss(): string {
  if (!staticCssCache) {
    staticCssCache = getThemeStyles() + getBaseStyles() + getAnimationStyles();
    staticCssHash = createHash('sha256').update(staticCssCache).digest('hex').slice(0, 8);
  }
  return staticCssCache;
}

/** Short content hash of the CSS bundle for cache-busting URLs. */
export function getStaticCssHash(): string {
  getStaticCss(); // ensure cache is populated
  return staticCssHash ?? '';
}

// Invalidate cache when module is hot-reloaded in dev
export function invalidateCssCache(): void {
  staticCssCache = null;
  staticCssHash = null;
}

/**
 * Base CSS styles for all pages
 */
export function getBaseStyles(): string {
  return `
  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    font-size: var(--text-base);
    background-color: var(--bg);
    color: var(--text);
    line-height: 1.6;
    padding: 0;
    margin: 0;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  .container {
    max-width: 1100px;
    margin: 0 auto;
    padding: var(--space-6);
  }

  /* ── Navigation ─────────────────────────────────────────────── */
  .nav-bar {
    position: sticky;
    top: 0;
    z-index: 100;
    view-transition-name: nav;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px var(--space-6);
    background: var(--nav-bg);
    border-bottom: 1px solid var(--border);
    backdrop-filter: blur(24px) saturate(180%);
    -webkit-backdrop-filter: blur(24px) saturate(180%);
  }
  .nav-brand {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    text-decoration: none;
    font-weight: 700;
    font-size: var(--text-sm);
    background: var(--gradient-primary);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    letter-spacing: -0.01em;
  }
  .nav-brand:hover { text-decoration: none; opacity: 0.9; }
  .nav-brand svg { flex-shrink: 0; }
  .nav-link {
    color: var(--text-muted);
    text-decoration: none;
    font-size: var(--text-sm);
    padding: 6px 12px;
    border-radius: var(--radius-full);
    display: flex;
    align-items: center;
    gap: var(--space-1);
    margin-left: var(--space-1);
    transition: color 0.15s, background 0.15s, box-shadow 0.15s;
    font-weight: 500;
  }
  .nav-link:hover {
    color: var(--text);
    background: var(--hover-alpha);
    text-decoration: none;
  }
  .nav-link.active {
    color: var(--text);
    background: linear-gradient(135deg, rgba(124,58,237,0.15), rgba(79,70,229,0.1));
    box-shadow: 0 0 0 1px rgba(124,58,237,0.3);
  }
  .nav-plugins {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-left: var(--space-5);
  }
  .nav-plugin-link {
    color: var(--text-muted);
    text-decoration: none;
    font-size: var(--text-sm);
    padding: 6px 12px;
    border-radius: var(--radius-full);
    display: flex;
    align-items: center;
    gap: var(--space-1);
    transition: color 0.15s, background 0.15s;
    font-weight: 500;
  }
  .nav-plugin-link:hover {
    color: var(--text);
    background: var(--hover-alpha);
    text-decoration: none;
  }
  .nav-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .theme-toggle {
    background: var(--surface-alpha);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 6px;
    cursor: pointer;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color 0.2s, border-color 0.2s, background 0.2s;
  }
  .theme-toggle:hover { color: var(--accent); border-color: rgba(124,58,237,0.5); background: rgba(124,58,237,0.08); }
  /* Show sun in dark mode (click to go light), moon in light mode (click to go dark) */
  [data-theme="dracula"] .icon-moon, :root .icon-moon { display: none; }
  [data-theme="dracula"] .icon-sun, :root .icon-sun { display: inline; }
  [data-theme="light"] .icon-sun { display: none; }
  [data-theme="light"] .icon-moon { display: inline; }
  .logout-btn {
    background: var(--surface-alpha);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 6px;
    cursor: pointer;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color 0.2s, border-color 0.2s;
  }
  .logout-btn:hover { color: var(--red); border-color: rgba(239,68,68,0.5); }

  /* ── Notification bell ──────────────────────────────────────── */
  .notif-bell-wrapper {
    position: relative;
  }
  .notification-bell {
    background: var(--surface-alpha);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 6px;
    cursor: pointer;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color 0.2s, border-color 0.2s, background 0.2s;
    position: relative;
  }
  .notification-bell:hover { color: var(--accent); border-color: rgba(124,58,237,0.5); background: rgba(124,58,237,0.08); }
  .notif-badge {
    position: absolute;
    top: -4px;
    right: -4px;
    background: var(--red);
    color: #fff;
    font-size: 0.6rem;
    font-weight: 700;
    min-width: 16px;
    height: 16px;
    border-radius: var(--radius-full);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 3px;
    line-height: 1;
  }

  /* ── Notification dropdown ──────────────────────────────────── */
  .notif-dropdown {
    display: none;
    position: absolute;
    top: calc(100% + 8px);
    right: 8px;
    width: 320px;
    max-width: calc(100vw - 16px);
    max-height: 400px;
    overflow-y: auto;
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    z-index: 100;
  }
  .notif-dropdown.open { display: block; animation: fadeUp 0.15s ease-out; }
  .notif-dropdown-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
    font-size: var(--text-sm);
    font-weight: 600;
  }
  .notif-mark-all {
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
    font-size: var(--text-xs);
  }
  .notif-mark-all:hover { text-decoration: underline; }
  .notif-item {
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
    transition: background 0.15s;
  }
  .notif-item:last-child { border-bottom: none; }
  .notif-item:hover { background: var(--surface); }
  .notif-item.notif-read { opacity: 0.5; }
  .notif-item .notif-link {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    column-gap: 8px;
    row-gap: 2px;
    text-decoration: none;
    color: var(--text);
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
  }
  .notif-item .notif-preview {
    grid-column: 1 / -1;
    font-size: 0.72rem;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .notif-item.notif-info { border-left: 3px solid var(--accent); }
  .notif-item.notif-warn { border-left: 3px solid var(--yellow); }
  .notif-item.notif-error { border-left: 3px solid var(--red); }
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
  .notif-group-count {
    font-size: 0.7rem;
    color: var(--text-muted);
    font-weight: normal;
  }
  .notif-prefs {
    display: flex;
    gap: 12px;
    padding: 6px 14px;
    border-top: 1px solid var(--border);
    font-size: var(--text-xs);
  }
  .notif-pref-toggle {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--text-muted);
    cursor: pointer;
    user-select: none;
  }
  .notif-pref-toggle input { margin: 0; cursor: pointer; }
  .notif-dropdown-empty {
    padding: 24px;
    text-align: center;
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  /* Swipe-to-dismiss for notification entries */
  .notif-entry {
    transition: transform 0.2s ease, opacity 0.2s ease;
  }
  .notif-entry.swiping { transition: none; }
  .notif-entry.dismissed {
    transform: translateX(-100%);
    opacity: 0;
    transition: transform 0.3s ease, opacity 0.3s ease;
  }

  /* ── Global button system ────────────────────────────────────── */
  .btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: 8px 16px;
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    font-family: inherit;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
    border: none;
    text-decoration: none;
    white-space: nowrap;
  }
  .btn:hover { text-decoration: none; }
  .btn-primary {
    background: var(--gradient-primary);
    color: #fff;
    box-shadow: 0 0 0 0 var(--accent-glow);
  }
  .btn-primary:hover {
    box-shadow: 0 4px 20px var(--accent-glow);
    transform: translateY(-1px);
  }
  .btn-primary:active { transform: scale(0.98); }
  .btn-ghost {
    background: var(--surface-alpha);
    border: 1px solid var(--border);
    color: var(--text);
  }
  .btn-ghost:hover {
    background: var(--hover-alpha);
    border-color: rgba(124,58,237,0.4);
  }
  .btn-danger { background: linear-gradient(135deg, #ef4444, #dc2626); color: #fff; }
  .btn-danger:hover { box-shadow: 0 4px 16px rgba(239,68,68,0.4); transform: translateY(-1px); }
  .btn-sm { padding: 5px 10px; font-size: var(--text-xs); }

  /* ── Card system ─────────────────────────────────────────────── */
  .card, .plugin-card {
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: var(--space-5);
    box-shadow: var(--shadow-sm);
    transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
  }
  .card.hoverable:hover, .plugin-card.hoverable:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow);
    border-color: rgba(124,58,237,0.3);
  }
  .card-glass {
    background: var(--glass-bg);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid var(--glass-border);
  }
  .card-gradient {
    background: var(--gradient-card);
    border: 1px solid rgba(124,58,237,0.2);
  }

  /* ── Plugin component styles ─────────────────────────────────── */
  .plugin-card-title {
    font-size: var(--text-sm);
    font-weight: 600;
    margin-bottom: var(--space-3);
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .plugin-card-title a {
    color: var(--text);
    text-decoration: none;
  }
  .plugin-card-title a:hover { color: var(--accent); }
  .plugin-card-body { font-size: var(--text-sm); }
  .plugin-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-sm);
  }
  .plugin-table th, .plugin-table td {
    padding: var(--space-2) var(--space-3);
    text-align: left;
    border-bottom: 1px solid var(--border);
  }
  .plugin-table th {
    color: var(--text-muted);
    font-weight: 600;
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .plugin-table tr:last-child td { border-bottom: none; }
  .plugin-table tbody tr:hover { background: var(--glass-bg); }
  .plugin-chart {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .plugin-chart-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .plugin-chart-label {
    font-size: var(--text-xs);
    min-width: 80px;
    white-space: nowrap;
    color: var(--text-muted);
  }
  .plugin-chart-bar {
    height: 8px;
    background: var(--gradient-primary);
    border-radius: var(--radius-full);
    min-width: 4px;
    transition: width 0.4s ease;
  }
  .plugin-chart-value {
    font-size: var(--text-xs);
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  /* ── New plugin components ───────────────────────────────────── */
  .plugin-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 10px;
    border-radius: var(--radius-full);
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: 0.03em;
    border: 1px solid transparent;
  }
  .plugin-badge-success { background: rgba(16,185,129,0.12); color: var(--green); border-color: rgba(16,185,129,0.3); }
  .plugin-badge-error   { background: rgba(239,68,68,0.12);  color: var(--red);   border-color: rgba(239,68,68,0.3); }
  .plugin-badge-warning { background: rgba(245,158,11,0.12); color: var(--yellow); border-color: rgba(245,158,11,0.3); }
  .plugin-badge-info    { background: rgba(6,182,212,0.12);  color: var(--cyan);  border-color: rgba(6,182,212,0.3); }
  .plugin-badge-neutral { background: var(--surface-alpha); color: var(--text-muted); border-color: var(--border); }

  .plugin-alert {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    margin-bottom: var(--space-3);
    border-left: 3px solid;
  }
  .plugin-alert svg { flex-shrink: 0; margin-top: 2px; }
  .plugin-alert-info    { background: rgba(6,182,212,0.08);   border-color: var(--cyan); }
  .plugin-alert-success { background: rgba(16,185,129,0.08);  border-color: var(--green); }
  .plugin-alert-warning { background: rgba(245,158,11,0.08);  border-color: var(--yellow); }
  .plugin-alert-error   { background: rgba(239,68,68,0.08);   border-color: var(--red); }

  .plugin-stat {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-4);
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
  }
  .plugin-stat-value {
    font-size: var(--text-3xl);
    font-weight: 700;
    line-height: 1.1;
    font-variant-numeric: tabular-nums;
  }
  .plugin-stat-label {
    font-size: var(--text-xs);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .plugin-stat-trend {
    font-size: var(--text-xs);
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .plugin-stat-trend.up   { color: var(--green); }
  .plugin-stat-trend.down { color: var(--red); }

  .plugin-progress-track {
    height: 8px;
    background: var(--border);
    border-radius: var(--radius-full);
    overflow: hidden;
    margin: var(--space-2) 0;
  }
  .plugin-progress-fill {
    height: 100%;
    border-radius: var(--radius-full);
    background: var(--gradient-primary);
    transition: width 0.5s ease;
  }
  .plugin-progress-fill.animated {
    background: linear-gradient(90deg, #7c3aed, #4f46e5, #06b6d4, #7c3aed);
    background-size: 200% 100%;
    animation: progress-shimmer 2s linear infinite;
  }

  .plugin-timeline { display: flex; flex-direction: column; gap: 0; }
  .plugin-timeline-item {
    display: flex;
    gap: var(--space-3);
    padding-bottom: var(--space-4);
    position: relative;
  }
  .plugin-timeline-item:not(:last-child)::before {
    content: '';
    position: absolute;
    left: 11px;
    top: 24px;
    bottom: 0;
    width: 2px;
    background: var(--border);
  }
  .plugin-timeline-dot {
    width: 24px;
    height: 24px;
    border-radius: var(--radius-full);
    background: var(--surface);
    border: 2px solid var(--border);
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1;
  }
  .plugin-timeline-dot.ok    { border-color: var(--green); background: rgba(16,185,129,0.1); }
  .plugin-timeline-dot.error { border-color: var(--red);   background: rgba(239,68,68,0.1); }
  .plugin-timeline-dot.warn  { border-color: var(--yellow); background: rgba(245,158,11,0.1); }
  .plugin-timeline-body { flex: 1; min-width: 0; }
  .plugin-timeline-title { font-size: var(--text-sm); font-weight: 500; }
  .plugin-timeline-time  { font-size: var(--text-xs); color: var(--text-muted); }

  .plugin-tabs-nav {
    display: flex;
    gap: 0;
    border-bottom: 2px solid var(--border);
    margin-bottom: var(--space-4);
  }
  .plugin-tab-btn {
    padding: 8px 16px;
    color: var(--text-muted);
    font-size: var(--text-sm);
    font-weight: 500;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    margin-bottom: -2px;
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s;
    font-family: inherit;
  }
  .plugin-tab-btn:hover { color: var(--text); }
  .plugin-tab-btn.active { color: var(--accent); border-bottom-color: var(--accent); }
  .plugin-tab-panel { display: none; }
  .plugin-tab-panel.active { display: block; animation: fadeUp 0.15s ease-out; }

  .plugin-empty {
    text-align: center;
    padding: var(--space-12) var(--space-6);
    color: var(--text-muted);
  }
  .plugin-empty-icon { margin-bottom: var(--space-4); opacity: 0.35; }
  .plugin-empty-title { font-size: var(--text-lg); font-weight: 600; color: var(--text); margin-bottom: var(--space-2); }
  .plugin-empty-text  { font-size: var(--text-sm); margin-bottom: var(--space-4); }

  .plugin-code-block {
    border-radius: var(--radius-md);
    overflow: hidden;
    border: 1px solid var(--border);
    margin: var(--space-3) 0;
    background: var(--code-bg);
  }
  .plugin-code-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 12px;
    background: var(--surface-alpha);
    border-bottom: 1px solid var(--border);
  }
  .plugin-code-lang { font-size: var(--text-xs); color: var(--text-muted); font-family: 'SF Mono', monospace; }
  .plugin-code-block pre { margin: 0; padding: var(--space-4); font-size: var(--text-xs); overflow-x: auto; }

  .plugin-divider {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin: var(--space-5) 0;
  }
  .plugin-divider::before, .plugin-divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--border);
  }
  .plugin-divider-label {
    font-size: var(--text-xs);
    color: var(--text-muted);
    white-space: nowrap;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  /* ── Mobile hamburger ────────────────────────────────────────── */
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
    .nav-link { display: none; margin-left: 0; }
    .nav-link.open { display: flex; position: absolute; top: 100%; left: 0; background: var(--nav-bg); border: 1px solid var(--border); border-radius: 0 0 var(--radius-md) var(--radius-md); padding: 12px; z-index: 50; backdrop-filter: blur(24px); }
    .nav-plugins { display: none; }
    .nav-plugins.open { display: flex; flex-direction: column; position: absolute; top: 100%; left: 0; background: var(--nav-bg); border: 1px solid var(--border); border-radius: 0 0 var(--radius-md) var(--radius-md); padding: 12px; gap: 8px; z-index: 50; backdrop-filter: blur(24px); }
    .nav-actions { display: none; }
    .nav-actions.open { display: flex; flex-direction: column; position: absolute; top: 100%; right: 0; background: var(--nav-bg); border: 1px solid var(--border); border-radius: 0 0 var(--radius-md) var(--radius-md); padding: 12px; gap: 8px; z-index: 50; backdrop-filter: blur(24px); }
    .nav-backdrop { display: none; position: fixed; inset: 0; background: rgba(0, 0, 0, 0.5); z-index: 40; }
    .nav-backdrop.open { display: block; }
  }

  /* ── Messages ────────────────────────────────────────────────── */
  .message {
    margin-bottom: var(--space-5);
    border-radius: var(--radius-lg);
    overflow: hidden;
    transition: transform 0.15s ease;
  }

  .message-header {
    padding: var(--space-3) var(--space-4);
    font-weight: 600;
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
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
    font-size: var(--text-xs);
    font-weight: 700;
    flex-shrink: 0;
  }

  .message-content {
    padding: var(--space-4);
    font-size: var(--text-base);
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
    color: #fff;
  }

  .avatar-glow {
    box-shadow: 0 0 12px var(--accent-glow);
  }

  /* ── Code ────────────────────────────────────────────────────── */
  code {
    font-family: 'SF Mono', 'Fira Code', 'Monaco', 'Inconsolata', monospace;
    background: var(--code-bg);
    padding: 2px 6px;
    border-radius: var(--radius-sm);
    font-size: 0.875em;
  }

  .code-block {
    margin: 12px 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
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
    font-size: var(--text-xs);
    color: var(--text-muted);
    font-family: 'SF Mono', monospace;
    text-transform: lowercase;
  }

  .code-copy-btn {
    font-size: var(--text-xs);
    font-family: inherit;
    color: var(--text-muted);
    background: none;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    padding: 2px 8px;
    cursor: pointer;
    transition: color 0.2s, border-color 0.2s;
  }

  .code-copy-btn:hover {
    color: var(--text);
    border-color: var(--border);
  }

  .code-copy-btn.copied { color: var(--green); }

  .code-block pre {
    margin: 0;
    border: none;
    border-radius: 0;
    background: transparent;
  }

  pre {
    background: var(--code-bg);
    border-radius: var(--radius-md);
    padding: var(--space-4);
    overflow-x: auto;
    margin: 12px 0;
    border: 1px solid var(--border);
  }

  pre code {
    background: none;
    padding: 0;
    font-size: var(--text-sm);
    line-height: 1.5;
  }

  .language-diff .hljs-addition {
    color: var(--green);
    background: rgba(16,185,129, 0.1);
  }

  .language-diff .hljs-deletion {
    color: var(--red);
    background: rgba(239,68,68, 0.1);
  }

  /* ── Content typography ──────────────────────────────────────── */
  .message-content h1,
  .message-content h2,
  .message-content h3,
  .message-content h4 {
    margin: 16px 0 8px;
    font-weight: 600;
  }

  .message-content h1 { font-size: var(--text-2xl); }
  .message-content h2 { font-size: var(--text-xl); }
  .message-content h3 { font-size: var(--text-lg); }

  .message-content ul,
  .message-content ol {
    padding-left: 24px;
    margin: 8px 0;
  }

  .message-content li { margin: 4px 0; }

  .message-content blockquote {
    border-left: 3px solid var(--accent);
    padding: 8px 16px;
    margin: 12px 0;
    color: var(--text-muted);
    background: rgba(124,58,237,0.05);
    border-radius: 0 var(--radius-md) var(--radius-md) 0;
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

  a:hover { text-decoration: underline; }

  /* ── Tool calls ──────────────────────────────────────────────── */
  .tool-calls-wrapper {
    margin-top: 30px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--card-bg);
  }

  .tool-calls-summary {
    padding: 12px 16px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--text-muted);
    list-style: none;
    user-select: none;
    transition: color 0.2s;
  }

  .tool-calls-summary:hover { color: var(--text); }
  .tool-calls-summary::-webkit-details-marker { display: none; }

  .tool-calls-summary::before {
    content: '\\25B6';
    font-size: 0.625rem;
    transition: transform 0.2s;
    flex-shrink: 0;
  }

  .tool-calls-wrapper[open] > .tool-calls-summary::before {
    transform: rotate(90deg);
  }

  .tool-calls-summary-stats {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: var(--text-xs);
    font-weight: 400;
  }

  .tool-calls-summary-stat {
    display: flex;
    align-items: center;
    gap: 3px;
  }

  .tool-calls-summary-stat.success { color: var(--green); }
  .tool-calls-summary-stat.failure { color: var(--red); }

  .tool-calls-summary-duration {
    display: flex;
    align-items: center;
    gap: 3px;
    color: var(--text-muted);
  }

  .tool-calls { padding: 0 16px 16px; }

  .tool-call {
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    margin-bottom: 12px;
    overflow: hidden;
    transition: border-color 0.2s;
  }

  .tool-call:hover { border-color: rgba(124,58,237,0.2); }

  .tool-call.failed { border-left: 4px solid var(--red); }
  .tool-call.failed > .tool-call-header { background: rgba(239, 68, 68, 0.08); }

  .tool-call-header {
    padding: 10px 14px;
    background: rgba(255, 255, 255, 0.02);
    font-size: var(--text-sm);
    cursor: pointer;
    display: flex;
    justify-content: space-between;
    align-items: center;
    list-style: none;
    gap: 8px;
  }

  .tool-call-header::-webkit-details-marker { display: none; }

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
    font-size: var(--text-xs);
  }

  .tool-call-status.success { color: var(--green); }
  .tool-call-status.failure { color: var(--red); }

  .tool-call-duration {
    font-size: var(--text-xs);
    padding: 2px 6px;
    background: var(--surface);
    border-radius: var(--radius-full);
    color: var(--text-muted);
  }

  .tool-call-time {
    color: var(--text-muted);
    font-size: var(--text-xs);
  }

  .tool-call-content {
    padding: 12px 14px;
    font-size: var(--text-sm);
    color: var(--text-muted);
    border-top: 1px solid var(--border);
  }

  .tool-call-content pre { margin: 8px 0 0; font-size: var(--text-xs); }

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
    font-size: var(--text-xs);
    border-top: 1px solid var(--border);
  }

  /* ── Action buttons ──────────────────────────────────────────── */
  .export-actions {
    margin-top: 12px;
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .export-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    font-size: var(--text-sm);
    font-family: inherit;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    cursor: pointer;
    text-decoration: none;
    transition: background 0.15s, border-color 0.15s;
    font-weight: 500;
  }

  .export-btn:hover {
    background: var(--surface-hover);
    border-color: rgba(124,58,237,0.3);
    text-decoration: none;
  }

  /* ── Continue form ───────────────────────────────────────────── */
  .continue-form {
    margin-top: 30px;
    border-top: 1px solid var(--border);
    padding-top: 20px;
  }

  .continue-form h2 {
    font-size: var(--text-lg);
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
    font-size: var(--text-base);
    font-family: inherit;
    background: var(--code-bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    color: var(--text);
    resize: vertical;
    outline: none;
    transition: border-color 0.2s, box-shadow 0.2s;
  }

  .continue-form textarea:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-glow);
  }

  .char-count {
    font-size: var(--text-xs);
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
    font-size: var(--text-base);
    font-family: inherit;
    font-weight: 600;
    color: #fff;
    background: var(--gradient-primary);
    border: none;
    border-radius: var(--radius-md);
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
    transition: all 0.15s;
  }

  .continue-form button[type="submit"]:hover {
    box-shadow: 0 4px 20px var(--accent-glow);
    transform: translateY(-1px);
  }

  .continue-form .continue-error {
    margin-top: 10px;
    padding: 10px 14px;
    background: rgba(239,68,68,0.1);
    border: 1px solid var(--red);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    color: var(--red);
    display: none;
  }

  .continue-form .continue-spinner {
    display: none;
    margin-top: 10px;
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  /* ── Queued message ──────────────────────────────────────────── */
  .message.queued {
    opacity: 0.7;
    border-left: 3px solid var(--yellow);
  }
  .queued-badge {
    display: inline-block;
    font-size: var(--text-xs);
    color: var(--yellow);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-left: 8px;
    padding: 1px 6px;
    border: 1px solid var(--yellow);
    border-radius: var(--radius-sm);
    vertical-align: middle;
  }

  /* ── Toast system ────────────────────────────────────────────── */
  .toast-container {
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 9999;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .toast {
    padding: 12px 20px;
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--text);
    background: var(--card-bg);
    border: 1px solid var(--border);
    box-shadow: var(--shadow-lg);
    animation: slide-in-right 0.3s cubic-bezier(0.34,1.56,0.64,1) forwards;
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .toast.success { border-left: 3px solid var(--green); }
  .toast.error   { border-left: 3px solid var(--red); }
  .toast.removing { animation: toast-out 0.3s ease forwards; }

  /* ── Skeleton loading ────────────────────────────────────────── */
  .skeleton {
    background: linear-gradient(90deg, var(--surface) 25%, var(--surface-hover) 50%, var(--surface) 75%);
    background-size: 200% 100%;
    animation: skeleton-shimmer 1.5s infinite;
    border-radius: var(--radius-md);
  }
  @keyframes skeleton-shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
  .skeleton-card { height: 80px; margin-bottom: 10px; }
  .skeleton-line { height: 16px; margin-bottom: 8px; width: 60%; }
  .skeleton-line.short { width: 30%; }
  .skeleton-stat { height: 90px; flex: 1; margin-bottom: 0; }
  .skeleton-health { height: 100px; }
  .skeleton-widget { height: 120px; }
  .skeleton-session { height: 72px; margin-bottom: 8px; }
  .skeleton-message { height: 80px; border-radius: var(--radius-lg); margin-bottom: 20px; }
  .skeleton-message.short { height: 60px; }
  .skeleton-message.tall { height: 120px; }

  /* ── Page transitions ────────────────────────────────────────── */
  @keyframes page-fade-in {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }
  main { animation: page-fade-in 0.2s ease-out; }

  /* ── Navigation loading overlay ──────────────────────────────── */
  .nav-loading-overlay {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    z-index: 9998;
    background: var(--bg);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    opacity: 0;
    animation: fade-in-overlay 0.15s ease-out forwards;
  }
  @keyframes fade-in-overlay {
    to { opacity: 1; }
  }
  .nav-loading-skeleton {
    width: min(90%, 1100px);
    padding: var(--space-6);
  }
  .nav-loading-bar {
    height: 3px;
    width: 100%;
    background: var(--border);
    border-radius: 2px;
    overflow: hidden;
    margin-bottom: var(--space-6);
  }
  .nav-loading-bar::after {
    content: '';
    display: block;
    height: 100%;
    width: 30%;
    background: var(--gradient-primary);
    border-radius: 2px;
    animation: loading-bar 1s ease-in-out infinite;
  }
  @keyframes loading-bar {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(400%); }
  }

  /* ── Keyboard navigation ─────────────────────────────────────── */
  .session-card.kb-focused {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .kb-overlay {
    position: fixed;
    top: 0; left: 0;
    width: 100%; height: 100%;
    background: rgba(0,0,0,0.6);
    backdrop-filter: blur(4px);
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .kb-overlay-content {
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-xl);
    padding: 28px 36px;
    max-width: 480px;
    width: 90%;
    max-height: 90vh;
    overflow-y: auto;
    box-shadow: var(--shadow-xl);
    animation: spring-in 0.3s cubic-bezier(0.34,1.56,0.64,1);
  }

  dialog::backdrop { background: rgba(0,0,0,0.6); }

  .kb-overlay-content h2 {
    margin-bottom: 16px;
    font-size: var(--text-xl);
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
    font-size: var(--text-sm);
  }
  .kb-overlay-content th {
    color: var(--text-muted);
    font-weight: 600;
  }
  kbd {
    font-family: 'SF Mono', 'Fira Code', monospace;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 2px 6px;
    font-size: var(--text-sm);
    box-shadow: var(--shadow-sm);
  }
  .kb-hint {
    margin-top: 16px;
    text-align: center;
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  /* ── Responsive ──────────────────────────────────────────────── */
  @media (max-width: 640px) {
    .container { padding: var(--space-3); }
    .nav-bar { padding: 10px var(--space-4); }
    .message-content { padding: var(--space-3); }
    pre { padding: var(--space-3); font-size: var(--text-sm); }
    .toast-container { bottom: 12px; right: 12px; left: 12px; }
  }
  @media (max-width: 414px) {
    .container { padding: var(--space-2); }
    .nav-bar { padding: 8px var(--space-3); }
    .nav-brand { font-size: var(--text-xs); gap: 6px; }
    .message-content { padding: 10px; font-size: var(--text-sm); }
    .message-header { padding: 8px 12px; font-size: var(--text-xs); }
    pre { font-size: var(--text-xs); }
    .session-card { padding: 12px; }
    .session-card h3 { font-size: var(--text-sm); }
  }

  /* ── Bottom navigation bar (mobile) ─────────────────────────── */
  .bottom-nav {
    display: none;
    position: fixed;
    bottom: 0; left: 0; right: 0;
    z-index: 100;
    background: var(--nav-bg);
    border-top: 1px solid var(--border);
    backdrop-filter: blur(24px);
    padding: 6px 0;
    padding-bottom: max(6px, env(safe-area-inset-bottom));
  }
  @media (max-width: 640px) {
    .bottom-nav { display: flex; justify-content: space-around; }
    body { padding-bottom: 64px; }
    footer { margin-bottom: 0; }
  }
  .bottom-nav-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 6px 12px;
    min-width: 64px;
    min-height: 44px;
    font-size: var(--text-xs);
    color: var(--text-muted);
    text-decoration: none;
    border-radius: var(--radius-md);
    transition: color 0.15s;
  }
  .bottom-nav-item.active { color: var(--accent); }
  .bottom-nav-item:hover { color: var(--text); }

  /* ── Auto-hide top nav on scroll (mobile) ────────────────────── */
  @media (max-width: 640px) {
    .nav-bar { transition: transform 0.25s ease; }
    .nav-bar.nav-hidden { transform: translateY(-100%); }
  }

  /* ── Touch targets: minimum 44px ────────────────────────────── */
  @media (max-width: 640px) {
    button, [type="submit"], .nav-link, .export-btn, .archive-btn,
    .fork-btn, .copy-msg-btn, .show-more-btn, .tag, .notif-actions button {
      min-height: 44px;
      min-width: 44px;
    }
    .session-card { min-height: 44px; }
    .notif-entry { min-height: 44px; }
  }

  /* ── Fluid typography ────────────────────────────────────────── */
  h1 { font-size: clamp(1.25rem, 4vw, 1.875rem); }
  h2 { font-size: clamp(1rem, 3vw, 1.5rem); }
  .message-content { font-size: clamp(0.8125rem, 2.5vw, var(--text-base)); }
  .session-meta { font-size: clamp(0.6875rem, 2vw, var(--text-sm)); }

  /* ── Swipe gesture on session cards ─────────────────────────── */
  @media (max-width: 640px) {
    .session-card { touch-action: pan-y; }
  }
  .session-card.swiping { transition: none; }
  .session-card .swipe-action {
    position: absolute;
    top: 0; bottom: 0;
    width: 80px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    font-size: var(--text-xs);
    font-weight: 600;
    border-radius: var(--radius-lg);
    opacity: 0;
    transition: opacity 0.15s;
    pointer-events: none;
  }
  .session-card .swipe-action.swipe-fav {
    right: 100%;
    margin-right: 4px;
    background: var(--yellow);
    color: var(--bg);
  }
  .session-card .swipe-action.swipe-archive {
    left: 100%;
    margin-left: 4px;
    background: var(--red);
  }
  .session-card.swiping .swipe-action { opacity: 1; }

  /* ── Pull-to-refresh indicator ───────────────────────────────── */
  .pull-indicator {
    text-align: center;
    padding: 0 12px;
    color: var(--text-muted);
    font-size: var(--text-sm);
    overflow: hidden;
    max-height: 0;
    transition: max-height 0.3s ease, padding 0.3s ease;
  }
  .pull-indicator.pulling,
  .pull-indicator.refreshing {
    max-height: 50px;
    padding: 12px;
  }

  /* ── Hint system ─────────────────────────────────────────────── */
  .hint-banner kbd,
  .empty-hint kbd,
  .search-hint kbd {
    display: inline-block;
    padding: 1px 5px;
    font-size: var(--text-xs);
    font-family: inherit;
    background: var(--code-bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text);
  }
  [data-theme="light"] .hint-banner kbd,
  [data-theme="light"] .empty-hint kbd,
  [data-theme="light"] .search-hint kbd {
    background: var(--bg);
    border-color: #c8c8c8;
  }
  .hint-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    max-width: 1100px;
    margin: 12px auto 0;
    padding: 10px 16px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    color: var(--text-muted);
    animation: slide-in-right 0.3s cubic-bezier(0.34,1.56,0.64,1) forwards;
  }
  .hint-banner-dismiss {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 4px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    border-radius: var(--radius-sm);
    transition: color 0.15s;
  }
  .hint-banner-dismiss:hover { color: var(--text); }
  .empty-hint {
    font-size: var(--text-sm);
    color: var(--text-muted);
    opacity: 0.7;
    margin-top: 8px;
  }
  .search-hint {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--text-xs);
    color: var(--text-muted);
    opacity: 0.7;
    margin-top: 6px;
  }
  .search-hint kbd { font-size: var(--text-xs); }
  `;
}

/**
 * CSS animations and transitions
 */
export function getAnimationStyles(): string {
  return `
  /* ── Core keyframes ────────────────────────────────────────── */
  @keyframes star-pop {
    0% { transform: scale(1); }
    50% { transform: scale(1.4); }
    100% { transform: scale(1); }
  }

  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(12px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  @keyframes slide-in-right {
    from { transform: translateX(100%); opacity: 0; }
    to   { transform: translateX(0);    opacity: 1; }
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

  @keyframes glow-pulse {
    0%, 100% { box-shadow: 0 0 8px var(--accent-glow); }
    50%       { box-shadow: 0 0 24px var(--accent-glow), 0 0 48px var(--accent-glow); }
  }

  @keyframes spring-in {
    0%   { opacity: 0; transform: scale(0.85); }
    60%  { transform: scale(1.04); }
    100% { opacity: 1; transform: scale(1); }
  }

  @keyframes gradientShift {
    0%, 100% { background-position: 0% 50%; }
    50%       { background-position: 100% 50%; }
  }

  @keyframes progress-shimmer {
    0%   { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  @keyframes count-up {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  /* ── Utility animation classes ────────────────────────────── */
  .animate-star-pop  { animation: star-pop 0.3s ease; }
  .animate-pulse     { animation: pulse 1.5s infinite; }
  .animate-fade-up   { animation: fadeUp 0.3s ease-out both; }
  .animate-spring    { animation: spring-in 0.4s cubic-bezier(0.34,1.56,0.64,1) both; }
  .glow-active       { animation: glow-pulse 2s ease-in-out infinite; }

  .transition-lift {
    transition: transform 0.2s ease, box-shadow 0.2s ease;
  }
  .transition-lift:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow);
  }

  /* ── Command palette ──────────────────────────────────────── */
  .cmd-palette {
    position: fixed;
    inset: 0;
    z-index: 10000;
  }
  .cmd-palette-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(8px);
  }
  .cmd-palette-panel {
    position: relative;
    max-width: 560px;
    margin: 15vh auto 0;
    background: var(--card-bg);
    border: 1px solid rgba(124,58,237,0.3);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-xl), 0 0 0 1px rgba(124,58,237,0.1);
    overflow: hidden;
    animation: spring-in 0.2s cubic-bezier(0.34,1.56,0.64,1);
  }
  .cmd-palette-input-wrap {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--border);
  }
  .cmd-palette-input-wrap svg {
    color: var(--text-muted);
    flex-shrink: 0;
  }
  .cmd-palette-input {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    color: var(--text);
    font-size: var(--text-base);
    font-family: inherit;
  }
  .cmd-palette-input::placeholder { color: var(--text-muted); }
  .cmd-palette-kbd {
    font-size: var(--text-xs);
    padding: 2px 6px;
    border-radius: var(--radius-sm);
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text-muted);
    font-family: inherit;
  }
  .cmd-palette-results {
    max-height: 320px;
    overflow-y: auto;
    padding: 6px 0;
  }
  .cmd-palette-group {
    padding: 6px 16px 2px;
    font-size: var(--text-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }
  .cmd-palette-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 16px;
    cursor: pointer;
    text-decoration: none;
    color: var(--text);
    font-size: var(--text-sm);
    transition: background 0.1s;
  }
  .cmd-palette-item:hover,
  .cmd-palette-item.active {
    background: rgba(124,58,237,0.08);
    text-decoration: none;
  }
  .cmd-palette-item svg {
    color: var(--text-muted);
    flex-shrink: 0;
  }
  .cmd-palette-item .cmd-item-title {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cmd-palette-item .cmd-item-hint {
    font-size: var(--text-xs);
    color: var(--text-muted);
    white-space: nowrap;
  }
  .cmd-palette-empty {
    padding: 24px 16px;
    text-align: center;
    color: var(--text-muted);
    font-size: var(--text-sm);
  }
  @media (max-width: 640px) {
    .cmd-palette-panel { margin: 8vh 12px 0; }
  }
  `;
}

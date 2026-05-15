/**
 * Template helpers for plugin authors
 *
 * Provides themed page rendering, card/table/chart components, and
 * re-exports of core utilities so plugins don't need internal imports.
 */

import { wrapInShell } from './templates/shell.js';
import { escapeHtml, sanitizeUrl } from './templates/utils.js';
import { icon } from './templates/icons.js';

// ─── Re-exports for plugin authors ───────────────────────────────────

export { escapeHtml, sanitizeUrl, formatTimestamp } from './templates/utils.js';
export { icon } from './templates/icons.js';

// ─── Plugin Page Renderer ────────────────────────────────────────────

interface PluginPageOptions {
  /** Page title (shown in browser tab) */
  title: string;
  /** Plugin name (used for CSS scoping) */
  pluginName: string;
  /** HTML body content */
  body: string;
  /** Optional page-specific CSS (will be scoped to plugin) */
  styles?: string;
  /** Optional page-specific scripts */
  scripts?: string;
  /** Unread notification count for nav badge */
  unreadCount?: number;
}

/**
 * Render a full plugin page wrapped in the standard shell.
 * Body is wrapped in a plugin-scoped container div.
 * Styles are automatically scoped to prevent leaks.
 */
export function renderPluginPage(opts: PluginPageOptions): string {
  const { title, pluginName, body, styles = '', scripts, unreadCount } = opts;

  const scopedStyles = styles ? pluginStyles(pluginName, styles) : '';
  const scopedBody = `<main class="container"><div class="plugin-${escapeHtml(pluginName)}">${body}</div></main>`;

  return wrapInShell({
    title,
    styles: scopedStyles,
    body: scopedBody,
    scripts,
    unreadCount,
  });
}

// ─── CSS Scoping ─────────────────────────────────────────────────────

/**
 * Scope CSS rules under a plugin-specific class.
 * Prepends `.plugin-{name}` to each top-level rule selector.
 *
 * Limitation: Only handles flat selectors. At-rules (@media, @keyframes)
 * should be written with the plugin class manually:
 *   `@media (...) { .plugin-name .card { ... } }`
 */
export function pluginStyles(pluginName: string, css: string): string {
  const prefix = `.plugin-${pluginName}`;

  // Skip at-rules — they need manual scoping
  return css.replace(/([^{}@]+)\{/g, (_match, selector: string) => {
    // Don't scope if inside an at-rule block (contains % for keyframes)
    const trimmed = selector.trim();
    if (/^\d+%$/.test(trimmed) || trimmed === 'from' || trimmed === 'to') {
      return `${selector}{`;
    }
    const scoped = trimmed
      .split(',')
      .map((s: string) => `${prefix} ${s.trim()}`)
      .join(', ');
    return `${scoped} {`;
  });
}

// ─── Card Component ──────────────────────────────────────────────────

interface CardOptions {
  /** Optional link URL for the card title */
  link?: string;
  /** Optional icon name */
  icon?: string;
}

/**
 * Render a themed card with title and body.
 * Matches the dashboard card style.
 */
export function pluginCard(title: string, body: string, opts?: CardOptions): string {
  const safeTitle = escapeHtml(title);
  const iconHtml = opts?.icon ? `${icon(opts.icon, 14)} ` : '';
  const safeLink = opts?.link ? sanitizeUrl(opts.link) : null;
  const titleContent = safeLink
    ? `<a href="${escapeHtml(safeLink)}">${iconHtml}${safeTitle}</a>`
    : `${iconHtml}${safeTitle}`;

  return `<div class="plugin-card">
    <div class="plugin-card-title">${titleContent}</div>
    <div class="plugin-card-body">${body}</div>
  </div>`;
}

// ─── Table Component ─────────────────────────────────────────────────

/**
 * Render a theme-aware HTML table.
 * Headers and cells are HTML-escaped.
 */
export function pluginTable(headers: string[], rows: string[][]): string {
  const headerHtml = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('');
  const rowsHtml = rows.map((row) =>
    `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`
  ).join('\n');

  return `<table class="plugin-table">
    <thead><tr>${headerHtml}</tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>`;
}

// ─── Chart Component ─────────────────────────────────────────────────

interface ChartDataPoint {
  label: string;
  value: number;
}

/**
 * Render a simple horizontal CSS bar chart.
 */
export function pluginChart(data: ChartDataPoint[]): string {
  if (data.length === 0) {
    return '<div class="plugin-chart"></div>';
  }

  const maxValue = Math.max(...data.map((d) => d.value));
  const bars = data.map((d) => {
    const pct = maxValue > 0 ? Math.round((d.value / maxValue) * 100) : 0;
    return `<div class="plugin-chart-row">
      <span class="plugin-chart-label">${escapeHtml(d.label)}</span>
      <div class="plugin-chart-bar" style="width: ${String(pct)}%"></div>
      <span class="plugin-chart-value">${String(d.value)}</span>
    </div>`;
  }).join('\n');

  return `<div class="plugin-chart">${bars}</div>`;
}

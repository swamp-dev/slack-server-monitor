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
  /** Visual variant */
  variant?: 'default' | 'glass' | 'gradient';
  /** Animation delay in ms for stagger effects */
  animationDelay?: number;
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

  const variantClass = opts?.variant === 'glass' ? ' card-glass' : opts?.variant === 'gradient' ? ' card-gradient' : '';
  const delayStyle = opts?.animationDelay != null ? ` style="animation-delay:${String(opts.animationDelay)}ms"` : '';

  return `<div class="plugin-card${variantClass} animate-fade-up"${delayStyle}>
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
 * Render a simple horizontal CSS bar chart with gradient bars.
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

// ─── Badge Component ─────────────────────────────────────────────────

type BadgeVariant = 'success' | 'error' | 'warning' | 'info' | 'neutral';

/**
 * Render a colored status badge/pill.
 */
export function pluginBadge(text: string, variant: BadgeVariant = 'neutral'): string {
  return `<span class="plugin-badge plugin-badge-${variant}">${escapeHtml(text)}</span>`;
}

// ─── Button Component ─────────────────────────────────────────────────

interface ButtonOptions {
  /** Visual variant */
  variant?: 'primary' | 'ghost' | 'danger';
  /** Icon name to prepend */
  icon?: string;
  /** Size */
  size?: 'sm' | 'md';
  /** Open in new tab */
  target?: '_blank';
}

/**
 * Render a styled button or link.
 * If href is provided, renders an <a> tag; otherwise a <button>.
 */
export function pluginButton(text: string, href?: string, opts?: ButtonOptions): string {
  const variant = opts?.variant ?? 'ghost';
  const sizeCls = opts?.size === 'sm' ? ' btn-sm' : '';
  const cls = `btn btn-${variant}${sizeCls}`;
  const iconHtml = opts?.icon ? `${icon(opts.icon, 14)} ` : '';
  const safeHref = href ? sanitizeUrl(href) : null;
  const targetAttr = opts?.target === '_blank' ? ' target="_blank" rel="noopener noreferrer"' : '';

  if (safeHref) {
    return `<a href="${escapeHtml(safeHref)}" class="${cls}"${targetAttr}>${iconHtml}${escapeHtml(text)}</a>`;
  }
  return `<button class="${cls}" type="button">${iconHtml}${escapeHtml(text)}</button>`;
}

// ─── Alert Component ─────────────────────────────────────────────────

interface AlertOptions {
  /** Severity level */
  level?: 'info' | 'success' | 'warning' | 'error';
  /** Override icon */
  icon?: string;
  /** Show dismiss button */
  dismissible?: boolean;
}

/**
 * Render an alert/notice box with optional dismiss button.
 */
export function pluginAlert(message: string, opts?: AlertOptions): string {
  const level = opts?.level ?? 'info';
  const iconMap: Record<string, string> = {
    info: 'info-circle',
    success: 'check',
    warning: 'alert-triangle',
    error: 'x-circle',
  };
  const iconName = opts?.icon ?? iconMap[level] ?? 'info-circle';
  const dismissBtn = opts?.dismissible
    ? `<button onclick="this.closest('.plugin-alert').remove()" style="background:none;border:none;color:inherit;cursor:pointer;padding:0;margin-left:auto;display:flex;align-items:center" type="button">${icon('x', 14)}</button>`
    : '';
  return `<div class="plugin-alert plugin-alert-${level}" role="alert">
    ${icon(iconName, 16)}
    <span>${escapeHtml(message)}</span>
    ${dismissBtn}
  </div>`;
}

// ─── Stat Component ───────────────────────────────────────────────────

interface StatTrend {
  value: number;
  direction: 'up' | 'down';
}

interface StatOptions {
  /** Trend indicator */
  trend?: StatTrend;
  /** Icon name */
  icon?: string;
  /** Custom color for value */
  color?: string;
}

/**
 * Render a single metric card with label, value, and optional trend.
 */
export function pluginStat(label: string, value: string | number, opts?: StatOptions): string {
  const iconHtml = opts?.icon
    ? `<div style="color:var(--text-muted);margin-bottom:var(--space-2)">${icon(opts.icon, 20)}</div>`
    : '';
  const trendIcon = opts?.trend?.direction === 'up' ? 'trending-up' : 'trending-down';
  const trendHtml = opts?.trend
    ? `<div class="plugin-stat-trend ${opts.trend.direction}">
        ${icon(trendIcon, 12)}
        ${String(Math.abs(opts.trend.value))}%
      </div>`
    : '';
  const colorStyle = opts?.color ? ` style="color:${escapeHtml(opts.color)}"` : '';
  return `<div class="plugin-stat">
    ${iconHtml}
    <div class="plugin-stat-value"${colorStyle}>${escapeHtml(String(value))}</div>
    <div class="plugin-stat-label">${escapeHtml(label)}</div>
    ${trendHtml}
  </div>`;
}

// ─── Progress Component ───────────────────────────────────────────────

interface ProgressOptions {
  /** Maximum value (default 100) */
  max?: number;
  /** Custom bar color (CSS color) */
  color?: string;
  /** Animate with shimmer */
  animated?: boolean;
  /** Label shown above bar */
  label?: string;
}

/**
 * Render a progress bar.
 */
export function pluginProgress(value: number, opts?: ProgressOptions): string {
  const max = opts?.max ?? 100;
  const pct = Math.min(100, Math.max(0, Math.round((value / max) * 100)));
  const animatedClass = opts?.animated ? ' animated' : '';
  const fillStyle = opts?.color
    ? `width:${String(pct)}%;background:${escapeHtml(opts.color)}`
    : `width:${String(pct)}%`;
  const labelHtml = opts?.label
    ? `<div style="display:flex;justify-content:space-between;font-size:var(--text-xs);color:var(--text-muted);margin-bottom:4px"><span>${escapeHtml(opts.label)}</span><span>${String(pct)}%</span></div>`
    : '';
  return `<div>
    ${labelHtml}
    <div class="plugin-progress-track">
      <div class="plugin-progress-fill${animatedClass}" style="${fillStyle}"></div>
    </div>
  </div>`;
}

// ─── Timeline Component ───────────────────────────────────────────────

interface TimelineEntry {
  time: string;
  title: string;
  body?: string;
  icon?: string;
  status?: 'ok' | 'error' | 'warn' | 'default';
}

/**
 * Render a vertical timeline/activity log.
 */
export function pluginTimeline(entries: TimelineEntry[]): string {
  const items = entries.map((e) => {
    const dotStatus = e.status ?? 'default';
    const iconHtml = e.icon ? icon(e.icon, 12) : '';
    return `<div class="plugin-timeline-item">
      <div class="plugin-timeline-dot ${dotStatus}">${iconHtml}</div>
      <div class="plugin-timeline-body">
        <div class="plugin-timeline-title">${escapeHtml(e.title)}</div>
        <div class="plugin-timeline-time">${escapeHtml(e.time)}</div>
        ${e.body ? `<div style="font-size:var(--text-xs);color:var(--text-muted);margin-top:4px">${escapeHtml(e.body)}</div>` : ''}
      </div>
    </div>`;
  }).join('');
  return `<div class="plugin-timeline">${items}</div>`;
}

// ─── Tabs Component ───────────────────────────────────────────────────

interface TabDefinition {
  id: string;
  label: string;
  content: string;
}

/**
 * Render a tabbed content panel with client-side switching.
 * Includes an inline script for tab switching — no external JS needed.
 */
export function pluginTabs(tabs: TabDefinition[], activeTab?: string): string {
  if (tabs.length === 0) return '';
  const active = activeTab ?? tabs[0]?.id ?? '';
  // Generate a short random ID to avoid conflicts when multiple tab groups exist
  const groupId = `ptabs-${Math.random().toString(36).slice(2, 7)}`;

  const navItems = tabs.map((t) =>
    `<button class="plugin-tab-btn${t.id === active ? ' active' : ''}" data-tab="${escapeHtml(t.id)}" data-tabgroup="${groupId}" type="button">${escapeHtml(t.label)}</button>`
  ).join('');

  const panels = tabs.map((t) =>
    `<div class="plugin-tab-panel${t.id === active ? ' active' : ''}" id="${groupId}-${escapeHtml(t.id)}">${t.content}</div>`
  ).join('');

  const script = `<script>(function(){
    document.querySelectorAll('[data-tabgroup="${groupId}"]').forEach(function(btn){
      btn.addEventListener('click',function(){
        document.querySelectorAll('[data-tabgroup="${groupId}"]').forEach(function(b){b.classList.remove('active');});
        btn.classList.add('active');
        document.querySelectorAll('[id^="${groupId}-"]').forEach(function(p){p.classList.remove('active');});
        var panel=document.getElementById('${groupId}-'+btn.getAttribute('data-tab'));
        if(panel)panel.classList.add('active');
      });
    });
  })();` + '</script>';

  return `<div><div class="plugin-tabs-nav">${navItems}</div><div>${panels}</div>${script}</div>`;
}

// ─── Empty State Component ────────────────────────────────────────────

interface EmptyOptions {
  /** Icon name */
  icon?: string;
  /** Heading text */
  title?: string;
  /** Supporting text */
  text?: string;
  /** Optional CTA button */
  action?: { label: string; href: string };
}

/**
 * Render an empty state with icon, text, and optional action.
 */
export function pluginEmpty(opts?: EmptyOptions): string {
  const iconName = opts?.icon ?? 'search';
  const title = opts?.title ?? 'Nothing here yet';
  const safeHref = opts?.action ? (sanitizeUrl(opts.action.href) ?? '#') : null;
  const actionHtml = safeHref
    ? `<a href="${escapeHtml(safeHref)}" class="btn btn-primary">${escapeHtml(opts?.action?.label ?? '')}</a>`
    : '';
  return `<div class="plugin-empty">
    <div class="plugin-empty-icon">${icon(iconName, 48)}</div>
    <div class="plugin-empty-title">${escapeHtml(title)}</div>
    ${opts?.text ? `<div class="plugin-empty-text">${escapeHtml(opts.text)}</div>` : ''}
    ${actionHtml}
  </div>`;
}

// ─── Code Block Component ─────────────────────────────────────────────

/**
 * Render a styled code block with optional language label.
 */
export function pluginCode(code: string, language?: string): string {
  const langHtml = language
    ? `<span class="plugin-code-lang">${escapeHtml(language)}</span>`
    : '';
  return `<div class="plugin-code-block">
    ${language ? `<div class="plugin-code-header">${langHtml}</div>` : ''}
    <pre><code>${escapeHtml(code)}</code></pre>
  </div>`;
}

// ─── Divider Component ────────────────────────────────────────────────

/**
 * Render a horizontal divider, optionally with a label.
 */
export function pluginDivider(label?: string): string {
  if (!label) {
    return `<hr style="border:none;border-top:1px solid var(--border);margin:var(--space-5) 0">`;
  }
  return `<div class="plugin-divider"><span class="plugin-divider-label">${escapeHtml(label)}</span></div>`;
}

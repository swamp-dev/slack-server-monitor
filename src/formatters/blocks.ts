import type { Block, KnownBlock, SectionBlock, ContextBlock, DividerBlock, HeaderBlock } from '@slack/types';

/**
 * Slack Block Kit builder utilities
 * Provides type-safe helpers for building Slack message blocks
 */

/**
 * Create a header block
 */
export function header(text: string): HeaderBlock {
  return {
    type: 'header',
    text: {
      type: 'plain_text',
      text,
      emoji: true,
    },
  };
}

/**
 * Create a section block with markdown text
 */
export function section(text: string): SectionBlock {
  return {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text,
    },
  };
}

/**
 * Create a section block with fields (two-column layout)
 */
export function sectionWithFields(fields: string[]): SectionBlock {
  return {
    type: 'section',
    fields: fields.map((text) => ({
      type: 'mrkdwn',
      text,
    })),
  };
}

/**
 * Create a divider block
 */
export function divider(): DividerBlock {
  return {
    type: 'divider',
  };
}

/**
 * Create a context block (small, muted text)
 */
export function context(text: string): ContextBlock {
  return {
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text,
      },
    ],
  };
}

/**
 * Create a code block section
 */
export function codeBlock(code: string, language?: string): SectionBlock {
  const formatted = language ? `\`\`\`${language}\n${code}\n\`\`\`` : `\`\`\`\n${code}\n\`\`\``;
  return section(formatted);
}

/**
 * Create a warning context block
 */
export function warning(text: string): ContextBlock {
  return context(`:warning: *Warning:* ${text}`);
}

/**
 * Create an error section
 */
export function error(text: string): SectionBlock {
  return section(`:x: *Error:* ${text}`);
}

/**
 * Create a success section
 */
export function success(text: string): SectionBlock {
  return section(`:white_check_mark: ${text}`);
}

/**
 * Create a progress bar using block characters
 * @param value - Current value
 * @param max - Maximum value
 * @param width - Number of characters (default: 10)
 */
export function progressBar(value: number, max: number, width = 10): string {
  const percent = Math.min(100, Math.max(0, (value / max) * 100));
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;

  const filledChar = '\u2588'; // Full block
  const emptyChar = '\u2591'; // Light shade

  return `${filledChar.repeat(filled)}${emptyChar.repeat(empty)} ${percent.toFixed(0)}%`;
}

/**
 * Get status emoji based on status type
 */
export function statusEmoji(status: 'ok' | 'warn' | 'error' | 'unknown'): string {
  switch (status) {
    case 'ok':
      return ':large_green_circle:';
    case 'warn':
      return ':large_yellow_circle:';
    case 'error':
      return ':red_circle:';
    case 'unknown':
      return ':white_circle:';
  }
}

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  const unit = units[i] ?? 'B';

  return `${value.toFixed(1)} ${unit}`;
}

/**
 * Format uptime duration
 */
export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${String(days)}d`);
  if (hours > 0) parts.push(`${String(hours)}h`);
  if (minutes > 0 || parts.length === 0) parts.push(`${String(minutes)}m`);

  return parts.join(' ');
}

/**
 * Build a simple response with blocks
 */
export function buildResponse(blocks: (Block | KnownBlock)[]): {
  blocks: (Block | KnownBlock)[];
  response_type: 'ephemeral' | 'in_channel';
} {
  return {
    blocks,
    response_type: 'ephemeral', // Default to ephemeral (only visible to user)
  };
}

/**
 * Build an in-channel response (visible to everyone)
 */
export function buildChannelResponse(blocks: (Block | KnownBlock)[]): {
  blocks: (Block | KnownBlock)[];
  response_type: 'ephemeral' | 'in_channel';
} {
  return {
    blocks,
    response_type: 'in_channel',
  };
}

// =============================================================================
// Enhanced Output Helpers - "Sweet" formatting for better UX
// =============================================================================

/**
 * Create a compact inline list of items
 * Shows items as `item1`, `item2`, `item3` with overflow indicator
 *
 * @param items - Array of items to display
 * @param maxItems - Maximum items to show before truncating (default: 10)
 * @param codeFormat - Wrap items in backticks (default: true)
 */
export function compactList(items: string[], maxItems = 10, codeFormat = true): string {
  if (items.length === 0) return '_None_';

  const displayed = items.slice(0, maxItems);
  const formatted = codeFormat ? displayed.map((item) => `\`${item}\``) : displayed;
  const result = formatted.join(', ');

  if (items.length > maxItems) {
    return `${result} _...and ${String(items.length - maxItems)} more_`;
  }

  return result;
}

/**
 * Create a summary stats bar with multiple metrics
 * Example: "🟢 5 running  ·  🟡 2 warning  ·  🔴 1 error"
 *
 * @param stats - Array of { count, label, status } objects
 */
export function statsBar(
  stats: Array<{ count: number; label: string; status: 'ok' | 'warn' | 'error' | 'unknown' }>
): string {
  return stats
    .map(({ count, label, status }) => `${statusEmoji(status)} ${String(count)} ${label}`)
    .join('  ·  ');
}

/**
 * Create a help tip context block with command hints
 *
 * @param tips - Array of tip strings to display
 */
export function helpTip(tips: string[]): ContextBlock {
  const formatted = tips.map((tip) => `:bulb: ${tip}`).join('\n');
  return context(formatted);
}

/**
 * Create a link with optional description
 * Example: "<https://example.com|View docs> - Full documentation"
 *
 * @param url - URL to link to
 * @param text - Link text
 * @param description - Optional description after the link
 */
export function link(url: string, text: string, description?: string): string {
  const linkPart = `<${url}|${text}>`;
  return description ? `${linkPart} - ${description}` : linkPart;
}

/**
 * Create an expandable section header with item count
 * Shows a collapsible-like header: "▸ Services (12 items)"
 *
 * @param title - Section title
 * @param count - Item count
 * @param expanded - Whether to show as expanded (default: false)
 */
export function expandableHeader(title: string, count: number, expanded = false): string {
  const arrow = expanded ? '▾' : '▸';
  return `${arrow} *${title}* (${String(count)})`;
}

/**
 * Create a compact service/item row with status
 * Example: "🟢 nginx  ·  🟢 postgres  ·  🔴 redis"
 *
 * @param items - Array of { name, status } objects
 * @param maxItems - Maximum items per row (default: 5)
 */
export function compactStatusRow(
  items: Array<{ name: string; status: 'ok' | 'warn' | 'error' | 'unknown' }>,
  maxItems = 5
): string[] {
  const rows: string[] = [];

  for (let i = 0; i < items.length; i += maxItems) {
    const chunk = items.slice(i, i + maxItems);
    const row = chunk.map(({ name, status }) => `${statusEmoji(status)} ${name}`).join('  ·  ');
    rows.push(row);
  }

  return rows;
}

/**
 * Create a collapsible list section using Slack's native display
 * Shows summary + context block with items
 *
 * @param title - Section title
 * @param items - Items to display
 * @param options - Formatting options
 */
export function collapsibleList(
  title: string,
  items: string[],
  options: {
    maxPreview?: number;
    showCount?: boolean;
    emptyMessage?: string;
    detailCommand?: string;
  } = {}
): KnownBlock[] {
  const { maxPreview = 5, showCount = true, emptyMessage = '_None_', detailCommand } = options;

  const blocks: KnownBlock[] = [];

  if (items.length === 0) {
    blocks.push(section(`*${title}:* ${emptyMessage}`));
    return blocks;
  }

  const countStr = showCount ? ` (${String(items.length)})` : '';
  blocks.push(section(`*${title}${countStr}:*`));

  // Show preview items
  const preview = items.slice(0, maxPreview);
  const previewText = preview.map((item) => `• ${item}`).join('\n');
  blocks.push(context(previewText));

  // Show overflow indicator with detail command hint
  if (items.length > maxPreview) {
    const overflow = items.length - maxPreview;
    const hint = detailCommand
      ? `_...${String(overflow)} more. Use \`${detailCommand}\` for details._`
      : `_...and ${String(overflow)} more_`;
    blocks.push(context(hint));
  }

  return blocks;
}

/**
 * Create a metrics row with visual indicators
 * Example: "CPU: 45% | Memory: 78% | Disk: 23%"
 *
 * @param metrics - Array of { label, value, max?, unit? } objects
 */
export function metricsRow(
  metrics: Array<{ label: string; value: number; max?: number; unit?: string }>
): string {
  return metrics
    .map(({ label, value, max, unit }) => {
      const displayValue = max ? `${String(value)}/${String(max)}` : String(value);
      const unitStr = unit || '';
      return `*${label}:* ${displayValue}${unitStr}`;
    })
    .join('  |  ');
}

/**
 * Create a section with an action hint
 * Shows the main content with a small action suggestion
 *
 * @param mainText - Main section text
 * @param actionHint - Small hint for next action
 */
export function sectionWithHint(mainText: string, actionHint: string): KnownBlock[] {
  return [section(mainText), context(`:point_right: ${actionHint}`)];
}

/**
 * Create a documentation link block
 *
 * @param links - Array of { url, text, description? } objects
 */
export function docLinks(
  links: Array<{ url: string; text: string; description?: string }>
): ContextBlock {
  const formatted = links.map(({ url, text, description }) => link(url, text, description)).join('\n');
  return context(`:books: *Resources:*\n${formatted}`);
}

/**
 * Create a "show more" indicator with command hint
 *
 * @param remaining - Number of remaining items
 * @param command - Command to run for full list
 */
export function showMoreHint(remaining: number, command: string): ContextBlock {
  return context(`:arrow_down: _${String(remaining)} more items. Run \`${command}\` for the full list._`);
}

/**
 * Create a timestamp footer
 *
 * @param date - Date to display (default: now)
 */
export function timestampFooter(date: Date = new Date()): ContextBlock {
  const timeStr = date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });
  return context(`:clock1: Last updated: ${timeStr}`);
}

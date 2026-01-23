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

/**
 * Markdown export template
 */

import type { ConversationMessage, ToolCallLog } from '../../services/conversation-store.js';
import { escapeMarkdown, formatTimestamp } from './utils.js';

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

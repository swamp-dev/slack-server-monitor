import type { App, SlackCommandMiddlewareArgs, AllMiddlewareArgs } from '@slack/bolt';
import { config } from '../config/index.js';
import { getConversationStore } from '../services/conversation-store.js';
import type { SessionSummary } from '../services/conversation-store.js';
import { logger } from '../utils/logger.js';
import {
  header,
  section,
  sectionWithFields,
  divider,
  context,
  error as errorBlock,
  timestampFooter,
  relativeTime,
  threadLink,
} from '../formatters/blocks.js';
import type { KnownBlock } from '@slack/types';

/**
 * Register the /sessions command
 *
 * Usage:
 *   /sessions              - List recent sessions (last 24h, max 20)
 *   /sessions <thread_ts>  - Detailed view of specific session
 *   /sessions mine         - Sessions initiated by current user
 *   /sessions stats        - Aggregate statistics
 */
export function registerSessionsCommand(app: App): void {
  app.command('/sessions', async ({ command, ack, respond }: SlackCommandMiddlewareArgs & AllMiddlewareArgs) => {
    await ack();

    if (!config.claude) {
      await respond({
        blocks: [errorBlock('Claude AI is not enabled. Set `CLAUDE_ENABLED=true` to view sessions.')],
        response_type: 'ephemeral',
      });
      return;
    }

    const claudeConfig = config.claude;
    const arg = command.text.trim().toLowerCase();
    const store = getConversationStore(claudeConfig.dbPath, claudeConfig.conversationTtlHours);

    try {
      if (arg === 'stats') {
        await handleStats(respond, store);
      } else if (arg === 'mine') {
        await handleList(respond, store, command.user_id);
      } else if (arg) {
        // Treat as thread_ts for detail view
        await handleDetail(respond, store, arg, command.channel_id);
      } else {
        // Default: list all recent
        await handleList(respond, store);
      }
    } catch (err) {
      logger.error('Error in /sessions command', { error: err });
      await respond({
        blocks: [errorBlock('An error occurred while fetching sessions.')],
        response_type: 'ephemeral',
      });
    }
  });

  logger.info('Registered /sessions command');
}

/**
 * Handle list view (/sessions or /sessions mine)
 */
async function handleList(
  respond: SlackCommandMiddlewareArgs['respond'],
  store: ReturnType<typeof getConversationStore>,
  userId?: string
): Promise<void> {
  const sessions = store.listRecentSessions(20, userId);

  if (sessions.length === 0) {
    await respond({
      blocks: [
        header('Claude AI Sessions'),
        section(userId ? '_No sessions found for you in the last 24 hours._' : '_No sessions found in the last 24 hours._'),
        context(':bulb: Start a session with `/ask <question>`'),
      ],
      response_type: 'ephemeral',
    });
    return;
  }

  const activeSessions = sessions.filter((s) => s.isActive).length;
  const blocks: KnownBlock[] = [
    header('Claude AI Sessions'),
    context(`:large_green_circle: ${String(activeSessions)} active  ·  :white_circle: ${String(sessions.length)} total (24h)`),
    divider(),
  ];

  // Add session rows
  for (const session of sessions) {
    blocks.push(formatSessionRow(session));
    blocks.push(formatSessionContext(session));
  }

  blocks.push(divider());
  blocks.push(context(':bulb: Use `/sessions <thread_ts>` for details'));

  await respond({
    blocks,
    response_type: 'ephemeral',
  });
}

/**
 * Handle detail view (/sessions <thread_ts>)
 */
async function handleDetail(
  respond: SlackCommandMiddlewareArgs['respond'],
  store: ReturnType<typeof getConversationStore>,
  threadTs: string,
  channelId: string
): Promise<void> {
  const session = store.getSessionDetail(threadTs, channelId);

  if (!session) {
    await respond({
      blocks: [
        errorBlock(`Session not found: \`${threadTs}\``),
        section('The session may have expired or the thread_ts may be incorrect.'),
        context(':bulb: Use `/sessions` to list recent sessions'),
      ],
      response_type: 'ephemeral',
    });
    return;
  }

  const blocks: KnownBlock[] = [
    header('Session Details'),
    sectionWithFields([
      `*Channel:* <#${session.channelId}>`,
      `*User:* <@${session.userId}>`,
      `*Messages:* ${String(session.messageCount)}`,
      `*Tool Calls:* ${String(session.toolCallCount)}`,
      `*Started:* ${relativeTime(session.createdAt)}`,
      `*Last Activity:* ${relativeTime(session.updatedAt)}`,
    ]),
    divider(),
  ];

  // Add tool calls if any
  if (session.recentToolCalls.length > 0) {
    blocks.push(section('*Recent Tool Calls:*'));
    const toolCallLines = session.recentToolCalls.map((tc) => {
      const inputSummary = formatToolInput(tc.input);
      return `\u2022 ${tc.toolName}${inputSummary}`;
    });

    // Show remaining count if there are more
    if (session.toolCallCount > session.recentToolCalls.length) {
      const remaining = session.toolCallCount - session.recentToolCalls.length;
      toolCallLines.push(`_...and ${String(remaining)} more_`);
    }

    blocks.push(context(toolCallLines.join('\n')));
  } else {
    blocks.push(section('_No tool calls recorded._'));
  }

  blocks.push(divider());
  blocks.push(context(`:link: View thread: <${threadLink(session.channelId, session.threadTs)}|Open in Slack>`));
  blocks.push(timestampFooter());

  await respond({
    blocks,
    response_type: 'ephemeral',
  });
}

/**
 * Handle stats view (/sessions stats)
 */
async function handleStats(
  respond: SlackCommandMiddlewareArgs['respond'],
  store: ReturnType<typeof getConversationStore>
): Promise<void> {
  const stats = store.getSessionStats(24);

  const blocks: KnownBlock[] = [
    header('Session Statistics (24h)'),
    sectionWithFields([
      `*Sessions:* ${String(stats.totalSessions)}`,
      `*Active:* ${String(stats.activeSessions)}`,
      `*Messages:* ${String(stats.totalMessages)}`,
      `*Tool Calls:* ${String(stats.totalToolCalls)}`,
    ]),
    divider(),
  ];

  // Add top tools if any
  if (stats.topTools.length > 0) {
    blocks.push(section('*Top Tools:*'));
    const toolLines = stats.topTools.map((tool, index) => `${String(index + 1)}. ${tool.name} (${String(tool.count)})`);
    blocks.push(context(toolLines.join('\n')));
  } else {
    blocks.push(section('_No tools used yet._'));
  }

  blocks.push(timestampFooter());

  await respond({
    blocks,
    response_type: 'ephemeral',
  });
}

/**
 * Format a session row for the list view
 */
function formatSessionRow(session: SessionSummary): KnownBlock {
  const statusIcon = session.isActive ? ':large_green_circle:' : ':white_circle:';
  return section(`${statusIcon} \`${session.threadTs}\` · <#${session.channelId}> · <@${session.userId}>`);
}

/**
 * Format session context (metrics) for the list view
 */
function formatSessionContext(session: SessionSummary): KnownBlock {
  return context(`${String(session.messageCount)} messages · ${String(session.toolCallCount)} tools · ${relativeTime(session.updatedAt)}`);
}

/**
 * Format tool input as a brief summary
 */
function formatToolInput(input: Record<string, unknown>): string {
  // Extract the most relevant parameter for display
  const keys = Object.keys(input);
  if (keys.length === 0) return '';

  // Common parameter names to show
  const displayKeys = ['container_name', 'name', 'file_path', 'path', 'command', 'lines'];
  for (const key of displayKeys) {
    if (key in input) {
      const value = input[key];
      if (typeof value === 'string' && value.length > 0) {
        const truncated = value.length > 30 ? value.slice(0, 27) + '...' : value;
        // Sanitize special markdown characters to prevent formatting breaks
        const sanitized = truncated.replace(/[`*_~]/g, '');
        return ` (${sanitized})`;
      }
    }
  }

  return '';
}

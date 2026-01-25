import type { App, SlackCommandMiddlewareArgs, AllMiddlewareArgs } from '@slack/bolt';
import { config } from '../config/index.js';
import { getClaudeService } from '../services/claude.js';
import { getConversationStore } from '../services/conversation-store.js';
import { getContextStore } from '../services/context-store.js';
import { loadUserConfig } from '../services/user-config.js';
import { getContext, getContextByAlias, type LoadedContext } from '../services/context-loader.js';
import { logger } from '../utils/logger.js';
import { parseSlackError } from '../utils/slack-errors.js';
import { section, context as contextBlock, error as errorBlock } from '../formatters/blocks.js';

/**
 * Rate limiter for Claude requests (separate from global rate limit)
 */
const claudeRateLimits = new Map<string, number[]>();

/**
 * SECURITY: Atomically check and record a Claude request
 * This prevents race conditions where multiple requests could slip through
 * between checking and recording.
 *
 * @param userId - The Slack user ID
 * @returns true if request is allowed and recorded, false if rate limited
 */
export function checkAndRecordClaudeRequest(userId: string): boolean {
  if (!config.claude) return false;

  const now = Date.now();
  const windowMs = config.claude.rateLimitWindowSeconds * 1000;
  const requests = claudeRateLimits.get(userId) ?? [];

  // Remove old requests outside window
  const validRequests = requests.filter(t => now - t < windowMs);

  // Check if at limit
  if (validRequests.length >= config.claude.rateLimitMax) {
    // Update with cleaned list but don't add new request
    claudeRateLimits.set(userId, validRequests);
    return false;
  }

  // Under limit - record the request atomically
  validRequests.push(now);
  claudeRateLimits.set(userId, validRequests);
  return true;
}

/**
 * Get remaining requests for a user in the current window
 * Used for testing and diagnostics
 */
export function getRemainingRequests(userId: string): number {
  if (!config.claude) return 0;

  const now = Date.now();
  const windowMs = config.claude.rateLimitWindowSeconds * 1000;
  const requests = claudeRateLimits.get(userId) ?? [];
  const validRequests = requests.filter(t => now - t < windowMs);

  return Math.max(0, config.claude.rateLimitMax - validRequests.length);
}

/**
 * Clear rate limit data for a user (for testing)
 */
export function clearRateLimitForUser(userId: string): void {
  claudeRateLimits.delete(userId);
}

/**
 * Clear all rate limit data (for testing)
 */
export function clearAllRateLimits(): void {
  claudeRateLimits.clear();
}

/** Cached default context from context directory */
let defaultContext: LoadedContext | null = null;

/**
 * Resolve the active context for a channel
 * Returns the channel-specific context if set, otherwise the default context
 */
async function resolveChannelContext(
  channelId: string,
  claudeConfig: NonNullable<typeof config.claude>
): Promise<LoadedContext | null> {
  const contextStore = getContextStore(claudeConfig.dbPath);
  const channelContextAlias = contextStore.getChannelContext(channelId);

  if (channelContextAlias) {
    // Find the context option with this alias
    const option = claudeConfig.contextOptions.find((o) => o.alias === channelContextAlias);
    if (option) {
      return await getContextByAlias(option.alias, option.path);
    }
    // Alias no longer exists in options, fall through to default
    logger.warn('Channel context alias not found in options', { channelId, alias: channelContextAlias });
  }

  // Return the default context
  return defaultContext;
}

/**
 * Register the /ask command
 *
 * Usage:
 *   /ask <question> - Ask Claude about your server
 */
export async function registerAskCommand(app: App): Promise<void> {
  if (!config.claude) {
    logger.info('Claude not configured - /ask command disabled');
    return;
  }

  const claudeConfig = config.claude;

  // Load default context from context directory if configured
  if (claudeConfig.contextDir) {
    defaultContext = await getContext(claudeConfig.contextDir);
    if (defaultContext?.combined) {
      logger.info('Loaded default context from directory', {
        contextDir: claudeConfig.contextDir,
        hasClaudeMd: !!defaultContext.claudeMd,
        contextFiles: defaultContext.contextFiles.size,
      });
    }
  }

  app.command('/ask', async ({ command, ack, respond, client }: SlackCommandMiddlewareArgs & AllMiddlewareArgs) => {
    await ack();

    const question = command.text.trim();
    const userId = command.user_id;
    const channelId = command.channel_id;

    if (!question) {
      await respond({
        blocks: [errorBlock('Please provide a question. Usage: `/ask <your question>`')],
        response_type: 'ephemeral',
      });
      return;
    }

    // Check and record rate limit atomically
    const store = getConversationStore(claudeConfig.dbPath, claudeConfig.conversationTtlHours);
    if (!checkAndRecordClaudeRequest(userId)) {
      await respond({
        blocks: [errorBlock(`Rate limit exceeded. Please wait before asking another question.`)],
        response_type: 'ephemeral',
      });
      return;
    }

    try {
      // Post initial message (visible to user)
      const initialMessage = await client.chat.postMessage({
        channel: channelId,
        text: `Thinking about: "${question.slice(0, 50)}${question.length > 50 ? '...' : ''}"`,
        blocks: [
          section(`*Question:* ${question}`),
          contextBlock('_Analyzing... This may take a moment._'),
        ],
      });

      if (!initialMessage.ts) {
        throw new Error('Failed to post initial message');
      }

      const threadTs = initialMessage.ts;

      // Get or create conversation
      const conversation = store.getOrCreateConversation(
        threadTs,
        channelId,
        userId,
        question
      );

      // Get conversation history (excluding the current question we just added)
      const history = conversation.messages.slice(0, -1);

      // Resolve channel-specific context (or use default)
      const activeContext = await resolveChannelContext(channelId, claudeConfig);

      // Load user config
      const userConfig = await loadUserConfig(userId, {
        allowedDirs: claudeConfig.allowedDirs,
        maxFileSizeKb: claudeConfig.maxFileSizeKb,
        maxLogLines: claudeConfig.maxLogLines,
        contextDir: claudeConfig.contextDir,
        contextDirContent: activeContext?.combined,
      });

      // Get Claude service and ask
      const claude = getClaudeService({
        cliPath: claudeConfig.cliPath,
        cliModel: claudeConfig.cliModel,
        maxTokens: claudeConfig.maxTokens,
        maxToolCalls: claudeConfig.maxToolCalls,
        maxIterations: claudeConfig.maxIterations,
      });

      const result = await claude.ask(question, history, userConfig);

      // Store the response
      store.addAssistantMessage(conversation.id, result.response);

      // Log tool calls
      for (const toolCall of result.toolCalls) {
        store.logToolCall(
          conversation.id,
          toolCall.name,
          toolCall.input,
          toolCall.outputPreview
        );
      }

      // Track token usage (logged for diagnostics)
      const totalTokens = result.usage.inputTokens + result.usage.outputTokens;

      // Update the message with the response
      await client.chat.update({
        channel: channelId,
        ts: threadTs,
        text: result.response.slice(0, 100),
        blocks: [
          section(`*Q:* ${question}`),
          section(result.response),
          contextBlock(
            `_Tools used: ${String(result.toolCalls.length)} | ` +
            `Tokens: ${totalTokens.toLocaleString()} | ` +
            `Reply in thread to continue_`
          ),
        ],
      });

      logger.info('Claude response sent', {
        userId,
        channelId,
        threadTs,
        toolCalls: result.toolCalls.length,
        tokens: totalTokens,
      });
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : 'An unexpected error occurred';
      const parsed = parseSlackError(err instanceof Error ? err : new Error(rawMessage));
      const displayMessage = parsed.type !== 'unknown' ? parsed.format() : rawMessage;

      logger.error('Ask command failed', {
        error: rawMessage,
        errorType: parsed.type,
        userId,
        question,
      });

      await respond({
        blocks: [errorBlock(`Failed to get response: ${displayMessage}`)],
        response_type: 'ephemeral',
      });
    }
  });

  logger.info('Registered /ask command');
}

/**
 * Register the message event handler for thread replies
 */
export function registerThreadHandler(app: App): void {
  if (!config.claude) {
    return;
  }

  const claudeConfig = config.claude;

  app.event('message', async ({ event, client }) => {
    // Debug logging: Log all message events to diagnose threading issues
    logger.debug('Message event received', {
      hasThreadTs: 'thread_ts' in event,
      threadTs: 'thread_ts' in event ? event.thread_ts : undefined,
      channel: event.channel,
      hasBotId: 'bot_id' in event,
      hasSubtype: 'subtype' in event,
      subtype: 'subtype' in event ? event.subtype : undefined,
    });

    // Only handle thread replies (messages with thread_ts different from ts)
    // Type guard for message event
    if (!('thread_ts' in event) || !event.thread_ts) {
      return;
    }

    // Ignore bot messages
    if ('bot_id' in event && event.bot_id) {
      return;
    }

    // Ignore message subtypes (edits, deletions, etc.)
    if ('subtype' in event && event.subtype) {
      return;
    }

    const threadTs = event.thread_ts;
    const channelId = event.channel;
    const userId = 'user' in event ? event.user : undefined;
    const text = 'text' in event ? event.text : undefined;

    if (!userId || !text) {
      return;
    }

    // Check if this thread has a conversation with us
    const store = getConversationStore(claudeConfig.dbPath, claudeConfig.conversationTtlHours);
    const conversation = store.getConversation(threadTs, channelId);

    if (!conversation) {
      // Not a conversation we're tracking
      logger.debug('Thread reply not in tracked conversation', { threadTs, channelId });
      return;
    }

    // Check authorization
    if (!config.authorization.userIds.includes(userId)) {
      logger.debug('Thread reply from unauthorized user', { userId, threadTs });
      return;
    }

    logger.debug('Processing thread reply', { userId, threadTs, channelId, textLength: text.length });

    // Check and record rate limit atomically
    if (!checkAndRecordClaudeRequest(userId)) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: 'Rate limit exceeded. Please wait before asking another question.',
      });
      return;
    }

    try {
      // Post thinking message
      const thinkingMsg = await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: 'Analyzing...',
      });

      // Use getOrCreateConversation to add message consistently
      // This adds the user message to the conversation
      const updatedConversation = store.getOrCreateConversation(
        threadTs,
        channelId,
        userId,
        text
      );

      // Get conversation history (excluding the current question we just added)
      const history = updatedConversation.messages.slice(0, -1);

      // Resolve channel-specific context (or use default)
      const activeContext = await resolveChannelContext(channelId, claudeConfig);

      // Load user config
      const userConfig = await loadUserConfig(userId, {
        allowedDirs: claudeConfig.allowedDirs,
        maxFileSizeKb: claudeConfig.maxFileSizeKb,
        maxLogLines: claudeConfig.maxLogLines,
        contextDir: claudeConfig.contextDir,
        contextDirContent: activeContext?.combined,
      });

      // Get Claude service and ask
      const claude = getClaudeService({
        cliPath: claudeConfig.cliPath,
        cliModel: claudeConfig.cliModel,
        maxTokens: claudeConfig.maxTokens,
        maxToolCalls: claudeConfig.maxToolCalls,
        maxIterations: claudeConfig.maxIterations,
      });

      const result = await claude.ask(text, history, userConfig);

      // Store the response
      store.addAssistantMessage(updatedConversation.id, result.response);

      // Log tool calls
      for (const toolCall of result.toolCalls) {
        store.logToolCall(
          updatedConversation.id,
          toolCall.name,
          toolCall.input,
          toolCall.outputPreview
        );
      }

      // Track token usage (for diagnostics)
      const totalTokens = result.usage.inputTokens + result.usage.outputTokens;

      // Update the thinking message with response
      if (thinkingMsg.ts) {
        await client.chat.update({
          channel: channelId,
          ts: thinkingMsg.ts,
          text: result.response,
          blocks: [
            section(result.response),
            contextBlock(
              `_Tools used: ${String(result.toolCalls.length)} | Tokens: ${totalTokens.toLocaleString()}_`
            ),
          ],
        });
      }

      logger.info('Thread reply sent', {
        userId,
        channelId,
        threadTs,
        toolCalls: result.toolCalls.length,
        tokens: totalTokens,
      });
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : 'An unexpected error occurred';
      const parsed = parseSlackError(err instanceof Error ? err : new Error(rawMessage));
      const displayMessage = parsed.type !== 'unknown' ? parsed.format() : rawMessage;

      logger.error('Thread handler failed', {
        error: rawMessage,
        errorType: parsed.type,
        userId,
        threadTs,
      });

      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: `Sorry, I encountered an error: ${displayMessage}`,
      });
    }
  });

  logger.info('Registered thread reply handler');
}

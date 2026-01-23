import type { App, SlackCommandMiddlewareArgs, AllMiddlewareArgs } from '@slack/bolt';
import { config } from '../config/index.js';
import { getClaudeService } from '../services/claude.js';
import { getConversationStore } from '../services/conversation-store.js';
import { loadUserConfig } from '../services/user-config.js';
import { getContext, type LoadedContext } from '../services/context-loader.js';
import { logger } from '../utils/logger.js';
import { section, context as contextBlock, error as errorBlock } from '../formatters/blocks.js';

/**
 * Rate limiter for Claude requests (separate from global rate limit)
 */
const claudeRateLimits = new Map<string, number[]>();

/**
 * Check if user is within Claude rate limit
 */
function isWithinClaudeRateLimit(userId: string): boolean {
  if (!config.claude) return false;

  const now = Date.now();
  const windowMs = config.claude.rateLimitWindowSeconds * 1000;
  const requests = claudeRateLimits.get(userId) ?? [];

  // Remove old requests outside window
  const validRequests = requests.filter(t => now - t < windowMs);
  claudeRateLimits.set(userId, validRequests);

  return validRequests.length < config.claude.rateLimitMax;
}

/**
 * Record a Claude request for rate limiting
 */
function recordClaudeRequest(userId: string): void {
  const requests = claudeRateLimits.get(userId) ?? [];
  requests.push(Date.now());
  claudeRateLimits.set(userId, requests);
}

/** Cached context from context directory */
let loadedContext: LoadedContext | null = null;

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

  // Load context from context directory if configured
  if (claudeConfig.contextDir) {
    loadedContext = await getContext(claudeConfig.contextDir);
    if (loadedContext?.combined) {
      logger.info('Loaded context from directory', {
        contextDir: claudeConfig.contextDir,
        hasClaudeMd: !!loadedContext.claudeMd,
        contextFiles: loadedContext.contextFiles.size,
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

    // Check Claude rate limit
    if (!isWithinClaudeRateLimit(userId)) {
      await respond({
        blocks: [errorBlock(`Rate limit exceeded. Please wait before asking another question.`)],
        response_type: 'ephemeral',
      });
      return;
    }

    // Check daily token budget
    const store = getConversationStore(claudeConfig.dbPath, claudeConfig.conversationTtlHours);
    if (store.isDailyBudgetExceeded(claudeConfig.dailyTokenLimit)) {
      await respond({
        blocks: [errorBlock('Daily API budget exceeded. Please try again tomorrow.')],
        response_type: 'ephemeral',
      });
      return;
    }

    // Record the request
    recordClaudeRequest(userId);

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

      // Load user config
      const userConfig = await loadUserConfig(userId, {
        allowedDirs: claudeConfig.allowedDirs,
        maxFileSizeKb: claudeConfig.maxFileSizeKb,
        maxLogLines: claudeConfig.maxLogLines,
        contextDir: claudeConfig.contextDir,
        contextDirContent: loadedContext?.combined,
      });

      // Get Claude service and ask
      const claude = getClaudeService({
        backend: claudeConfig.backend,
        apiKey: claudeConfig.apiKey,
        model: claudeConfig.model,
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

      // Track token usage
      const totalTokens = result.usage.inputTokens + result.usage.outputTokens;
      store.addTokenUsage(totalTokens);

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
      const message = err instanceof Error ? err.message : 'An unexpected error occurred';
      logger.error('Ask command failed', { error: message, userId, question });

      await respond({
        blocks: [errorBlock(`Failed to get response: ${message}`)],
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
      return;
    }

    // Check authorization
    if (!config.authorization.userIds.includes(userId)) {
      return;
    }

    // Check Claude rate limit
    if (!isWithinClaudeRateLimit(userId)) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: 'Rate limit exceeded. Please wait before asking another question.',
      });
      return;
    }

    // Check daily budget
    if (store.isDailyBudgetExceeded(claudeConfig.dailyTokenLimit)) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: 'Daily API budget exceeded. Please try again tomorrow.',
      });
      return;
    }

    recordClaudeRequest(userId);

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

      // Load user config
      const userConfig = await loadUserConfig(userId, {
        allowedDirs: claudeConfig.allowedDirs,
        maxFileSizeKb: claudeConfig.maxFileSizeKb,
        maxLogLines: claudeConfig.maxLogLines,
        contextDir: claudeConfig.contextDir,
        contextDirContent: loadedContext?.combined,
      });

      // Get Claude service and ask
      const claude = getClaudeService({
        backend: claudeConfig.backend,
        apiKey: claudeConfig.apiKey,
        model: claudeConfig.model,
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

      // Track token usage
      const totalTokens = result.usage.inputTokens + result.usage.outputTokens;
      store.addTokenUsage(totalTokens);

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
      const message = err instanceof Error ? err.message : 'An unexpected error occurred';
      logger.error('Thread handler failed', { error: message, userId, threadTs });

      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: `Sorry, I encountered an error: ${message}`,
      });
    }
  });

  logger.info('Registered thread reply handler');
}

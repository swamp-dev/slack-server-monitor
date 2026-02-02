import type { App, SlackCommandMiddlewareArgs, AllMiddlewareArgs } from '@slack/bolt';
import { config } from '../config/index.js';
import { getClaudeService } from '../services/claude.js';
import type { AskOptions } from '../services/claude.js';
import { getConversationStore } from '../services/conversation-store.js';
import { getContextStore } from '../services/context-store.js';
import { loadUserConfig } from '../services/user-config.js';
import { getContext, getContextByAlias, type LoadedContext } from '../services/context-loader.js';
import { getConversationUrl } from '../web/index.js';
import { logger } from '../utils/logger.js';
import { parseSlackError } from '../utils/slack-errors.js';
import { section, context as contextBlock, error as errorBlock } from '../formatters/blocks.js';
import { scrubSensitiveData } from '../formatters/scrub.js';
import { isValidImageUrl, fetchImageAsBase64 } from '../utils/image.js';

/**
 * Slack text limit for section blocks (with buffer for safety)
 * Actual limit is 3000, but we use 2900 for safety margin
 */
const SLACK_TEXT_LIMIT = 2900;

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
 * Parse image URL from the question text
 * Supports: --image <url> or --img <url>
 * Returns { imageUrl, cleanQuestion } or null if no image URL found
 */
function parseImageFromQuestion(question: string): { imageUrl: string; cleanQuestion: string } | null {
  // Match --image <url> or --img <url>
  const imagePattern = /--(?:image|img)\s+(\S+)/i;
  const imageMatch = imagePattern.exec(question);
  if (!imageMatch?.[1]) {
    return null;
  }

  const imageUrl = imageMatch[1];
  // Remove the --image flag from the question
  const cleanQuestion = question.replace(imagePattern, '').trim();

  return { imageUrl, cleanQuestion };
}

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
  // Load default context only if Claude is enabled
  if (config.claude?.contextDir) {
    defaultContext = await getContext(config.claude.contextDir);
    if (defaultContext?.combined) {
      logger.info('Loaded default context from directory', {
        contextDir: config.claude.contextDir,
        hasClaudeMd: !!defaultContext.claudeMd,
        contextFiles: defaultContext.contextFiles.size,
      });
    }
  }

  app.command('/ask', async ({ command, ack, respond, client }: SlackCommandMiddlewareArgs & AllMiddlewareArgs) => {
    const userId = command.user_id;
    const channelId = command.channel_id;
    const rawQuestion = command.text.trim();

    // Acknowledge immediately - this prevents Slack from showing a timeout error
    await ack();

    // Log that we received the command (helps diagnose authorization issues)
    logger.info('Ask command received', { userId, channelId, questionLength: rawQuestion.length });

    // Check if Claude is enabled
    if (!config.claude) {
      await respond({
        blocks: [errorBlock('Claude AI is not enabled. Set `CLAUDE_ENABLED=true` in your environment and ensure the Claude CLI is installed.')],
        response_type: 'ephemeral',
      });
      return;
    }

    const claudeConfig = config.claude;

    if (!rawQuestion) {
      await respond({
        blocks: [errorBlock('Please provide a question. Usage: `/ask <your question>` or `/ask <question> --image <url>`')],
        response_type: 'ephemeral',
      });
      return;
    }

    // Parse image URL from question if present
    const imageParsed = parseImageFromQuestion(rawQuestion);
    const question = imageParsed ? imageParsed.cleanQuestion : rawQuestion;
    const imageUrl = imageParsed?.imageUrl;

    // Validate question still exists after extracting image
    if (!question && !imageUrl) {
      await respond({
        blocks: [errorBlock('Please provide a question. Usage: `/ask <your question>` or `/ask <question> --image <url>`')],
        response_type: 'ephemeral',
      });
      return;
    }

    // Check rate limit first (cheap in-memory check) before expensive DB operations
    if (!checkAndRecordClaudeRequest(userId)) {
      logger.info('Claude rate limit exceeded', { userId });
      await respond({
        blocks: [errorBlock(`Rate limit exceeded. Please wait before asking another question.`)],
        response_type: 'ephemeral',
      });
      return;
    }

    try {
      // Initialize conversation store (can fail on DB issues)
      logger.debug('Initializing conversation store', { dbPath: claudeConfig.dbPath });
      const store = getConversationStore(claudeConfig.dbPath, claudeConfig.conversationTtlHours);
      logger.debug('Conversation store initialized');

      // Post initial message (visible to user)
      logger.debug('Posting initial "thinking" message', { channelId });
      const initialMessage = await client.chat.postMessage({
        channel: channelId,
        text: `Thinking about: "${question.slice(0, 50)}${question.length > 50 ? '...' : ''}"`,
        blocks: [
          section(`*Question:* ${question}`),
          contextBlock('_Analyzing... This may take a moment._'),
        ],
      });

      if (!initialMessage.ts) {
        throw new Error('Failed to post initial message - no timestamp returned');
      }
      logger.debug('Initial message posted', { threadTs: initialMessage.ts });

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

      // Get Claude service
      const claude = getClaudeService({
        provider: claudeConfig.provider,
        apiKey: claudeConfig.apiKey,
        cliPath: claudeConfig.cliPath,
        cliModel: claudeConfig.cliModel,
        sdkModel: claudeConfig.sdkModel,
        maxTokens: claudeConfig.maxTokens,
        maxToolCalls: claudeConfig.maxToolCalls,
        maxIterations: claudeConfig.maxIterations,
      });

      // Prepare ask options with image if provided
      let askOptions: AskOptions | undefined;
      if (imageUrl) {
        // Validate image URL
        if (!isValidImageUrl(imageUrl)) {
          await respond({
            blocks: [errorBlock('Invalid image URL. Must be HTTPS. Example: `/ask What food is this? --image https://files.slack.com/...`')],
            response_type: 'ephemeral',
          });
          return;
        }

        try {
          logger.debug('Fetching image for analysis', { imageUrl });
          const imageData = await fetchImageAsBase64(imageUrl);
          askOptions = { images: [imageData] };
          logger.debug('Image fetched successfully', { mediaType: imageData.mediaType });
        } catch (imgError) {
          logger.error('Failed to fetch image', { error: imgError, imageUrl });
          await respond({
            blocks: [errorBlock(`Failed to fetch image: ${imgError instanceof Error ? imgError.message : 'Unknown error'}`)],
            response_type: 'ephemeral',
          });
          return;
        }
      }

      // Ask Claude with optional image
      const actualQuestion = question || 'Analyze this image and describe what you see.';
      const result = await claude.ask(actualQuestion, history, userConfig, askOptions);

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

      // Check if response exceeds Slack's text limit and web UI is available
      const isLongResponse = result.response.length > SLACK_TEXT_LIMIT;
      const webConfig = config.web;
      const webEnabled = webConfig && webConfig.enabled && webConfig.baseUrl;

      if (isLongResponse && webEnabled) {
        // Post link to web UI instead of full response
        const webUrl = getConversationUrl(threadTs, channelId, webConfig);
        await client.chat.update({
          channel: channelId,
          ts: threadTs,
          text: `Response: ${result.response.slice(0, 100)}...`,
          blocks: [
            section(`*Q:* ${question}`),
            section(
              `_Response is ${result.response.length.toLocaleString()} characters._\n\n` +
              `<${webUrl}|View full response>`
            ),
            contextBlock(
              `_Tools used: ${String(result.toolCalls.length)} | ` +
              `Tokens: ${totalTokens.toLocaleString()} | ` +
              `Reply in thread to continue_`
            ),
          ],
        });

        logger.info('Claude response sent via web link (long response)', {
          userId,
          channelId,
          threadTs,
          toolCalls: result.toolCalls.length,
          tokens: totalTokens,
          responseLength: result.response.length,
        });
      } else {
        // Update the message with the response directly
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
      }
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : 'An unexpected error occurred';
      const parsed = parseSlackError(err instanceof Error ? err : new Error(rawMessage));
      const displayMessage = parsed.type !== 'unknown' ? parsed.format() : rawMessage;

      logger.error('Ask command failed', {
        error: rawMessage,
        errorType: parsed.type,
        userId,
        channelId,
        question: scrubSensitiveData(question.slice(0, 100)),
      });

      // Try multiple methods to ensure user sees the error
      let errorSent = false;

      // First attempt: use respond() for ephemeral message
      try {
        await respond({
          blocks: [errorBlock(`Failed to get response: ${displayMessage}`)],
          response_type: 'ephemeral',
        });
        errorSent = true;
        logger.debug('Error response sent via respond()');
      } catch (respondErr) {
        logger.warn('respond() failed, trying postMessage', {
          respondError: respondErr instanceof Error ? respondErr.message : String(respondErr),
        });
      }

      // Fallback: post a regular message if respond() failed
      if (!errorSent) {
        try {
          await client.chat.postMessage({
            channel: channelId,
            text: `Sorry, I encountered an error: ${displayMessage}`,
          });
          errorSent = true;
          logger.info('Error sent via fallback method', { method: 'postMessage', userId, channelId });
        } catch (postErr) {
          logger.error('Failed to send error via postMessage', {
            postError: postErr instanceof Error ? postErr.message : String(postErr),
          });
        }
      }

      // If all attempts failed, log prominently
      if (!errorSent) {
        logger.error('CRITICAL: Unable to send any response to user', {
          userId,
          channelId,
          originalError: rawMessage,
        });
      }
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

    // Check authorization first (doesn't need DB)
    if (!config.authorization.userIds.includes(userId)) {
      logger.debug('Thread reply from unauthorized user', { userId, threadTs });
      return;
    }

    try {
      // Initialize conversation store (can fail on DB issues)
      const store = getConversationStore(claudeConfig.dbPath, claudeConfig.conversationTtlHours);

      // Check if this thread has a conversation with us
      const conversation = store.getConversation(threadTs, channelId);

      if (!conversation) {
        // Not a conversation we're tracking
        logger.debug('Thread reply not in tracked conversation', { threadTs, channelId });
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
        provider: claudeConfig.provider,
        apiKey: claudeConfig.apiKey,
        cliPath: claudeConfig.cliPath,
        cliModel: claudeConfig.cliModel,
        sdkModel: claudeConfig.sdkModel,
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

      // Check if response exceeds Slack's text limit and web UI is available
      const isLongResponse = result.response.length > SLACK_TEXT_LIMIT;
      const webConfig = config.web;
      const webEnabled = webConfig && webConfig.enabled && webConfig.baseUrl;

      // Update the thinking message with response
      if (thinkingMsg.ts) {
        if (isLongResponse && webEnabled) {
          // Post link to web UI instead of full response
          const webUrl = getConversationUrl(threadTs, channelId, webConfig);
          await client.chat.update({
            channel: channelId,
            ts: thinkingMsg.ts,
            text: `Response: ${result.response.slice(0, 100)}...`,
            blocks: [
              section(
                `_Response is ${result.response.length.toLocaleString()} characters._\n\n` +
                `<${webUrl}|View full response>`
              ),
              contextBlock(
                `_Tools used: ${String(result.toolCalls.length)} | Tokens: ${totalTokens.toLocaleString()}_`
              ),
            ],
          });

          logger.info('Thread reply sent via web link (long response)', {
            userId,
            channelId,
            threadTs,
            toolCalls: result.toolCalls.length,
            tokens: totalTokens,
            responseLength: result.response.length,
          });
        } else {
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

          logger.info('Thread reply sent', {
            userId,
            channelId,
            threadTs,
            toolCalls: result.toolCalls.length,
            tokens: totalTokens,
          });
        }
      }
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

      try {
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          text: `Sorry, I encountered an error: ${displayMessage}`,
        });
      } catch (postErr) {
        // Log but don't rethrow - we've already logged the original error
        logger.error('Failed to send error response in thread', {
          originalError: rawMessage,
          postError: postErr instanceof Error ? postErr.message : String(postErr),
          userId,
          channelId,
          threadTs,
        });
      }
    }
  });

  logger.info('Registered thread reply handler');
}

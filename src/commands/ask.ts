import type { App, SlackCommandMiddlewareArgs, AllMiddlewareArgs } from '@slack/bolt';
import { config } from '../config/index.js';
import type { AskOptions } from '../services/claude.js';
import { getConversationStore } from '../services/conversation-store.js';
import { getUserStore, resolveUserStoreDbPath } from '../services/user-store.js';
import {
  initDefaultContext,
  processConversationTurn,
} from '../services/conversation-processor.js';
import {
  SLACK_TEXT_LIMIT,
  buildContextWarningBlocks,
  extractImageFromSlackFiles,
} from '../services/claude-entry.js';
import {
  checkAndRecordClaudeRequest,
  getRemainingRequests,
  clearRateLimitForUser,
  clearAllRateLimits,
} from '../services/claude-rate-limit.js';
import { getConversationUrl } from '../web/index.js';
import { buildFooter } from './build-footer.js';
import { logger } from '../utils/logger.js';
import { parseSlackError } from '../utils/slack-errors.js';
import { section, context as contextBlock, error as errorBlock, extractSnippet } from '../formatters/blocks.js';
import { scrubSensitiveData, truncateText } from '../formatters/scrub.js';
import { isValidImageUrl, fetchImageAsBase64, cleanupTempImage } from '../utils/image.js';

export {
  checkAndRecordClaudeRequest,
  getRemainingRequests,
  clearRateLimitForUser,
  clearAllRateLimits,
};

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
 * Register the /ask command
 *
 * Usage:
 *   /ask <question> - Ask Claude about your server
 *   /ask continue <thread_ts> - Continue a previous conversation in a new thread
 */
export async function registerAskCommand(app: App): Promise<void> {
  // Load default context only if Claude is enabled
  if (config.claude?.contextDir) {
    await initDefaultContext(config.claude.contextDir);
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

    // Handle /ask continue <thread_ts> subcommand
    const continueMatch = /^continue\s+(\S+)(?:\s+(.+))?$/i.exec(rawQuestion);
    if (continueMatch) {
      await handleContinue(continueMatch[1] ?? '', continueMatch[2], userId, channelId, claudeConfig, respond, client);
      return;
    }

    // Parse image URL from question if present
    const imageParsed = parseImageFromQuestion(rawQuestion);
    const question = imageParsed ? imageParsed.cleanQuestion : rawQuestion;
    const displayQuestion = truncateText(question, SLACK_TEXT_LIMIT - 20);
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

    // Track threadTs outside try so error handler can update the message
    let threadTs: string | undefined;

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
          section(`*Question:* ${displayQuestion}`),
          contextBlock('_Analyzing... This may take a moment._'),
        ],
      });

      if (!initialMessage.ts) {
        throw new Error('Failed to post initial message - no timestamp returned');
      }
      logger.debug('Initial message posted', { threadTs: initialMessage.ts });

      threadTs = initialMessage.ts;

      // Get or create conversation
      const conversation = store.getOrCreateConversation(
        threadTs,
        channelId,
        userId,
        question
      );

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

      // Process the conversation turn
      const actualQuestion = question || 'Analyze this image and describe what you see.';
      const result = await processConversationTurn({
        conversationId: conversation.id,
        threadTs,
        channelId,
        userId,
        userMessage: actualQuestion,
        claudeConfig,
        askOptions,
      });

      // Track token usage (logged for diagnostics)
      const totalTokens = result.usage.inputTokens + result.usage.outputTokens;

      // Check if response exceeds Slack's text limit and web UI is available
      const isLongResponse = result.response.length > SLACK_TEXT_LIMIT;
      const webConfig = config.web;
      const webEnabled = webConfig && webConfig.enabled && webConfig.baseUrl;

      if (isLongResponse && webEnabled) {
        // Post snippet + link to web UI
        const webUrl = getConversationUrl(threadTs, channelId, webConfig, userId);
        const snippet = extractSnippet(scrubSensitiveData(result.response));
        await client.chat.update({
          channel: channelId,
          ts: threadTs,
          text: `Response: ${result.response.slice(0, 100)}...`,
          blocks: [
            section(`*Q:* ${displayQuestion}`),
            section(snippet),
            section(`<${webUrl}|View full response> _(${result.response.length.toLocaleString()} chars)_`),
            contextBlock(buildFooter({
              toolCalls: result.toolCalls.length,
              tokens: totalTokens,
              threadTs,
              channelId,
              userId,
              showReplyHint: true,
              webUrl,
            })),
            ...buildContextWarningBlocks(result.contextStatus),
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
            section(`*Q:* ${displayQuestion}`),
            section(result.response),
            contextBlock(buildFooter({
              toolCalls: result.toolCalls.length,
              tokens: totalTokens,
              threadTs,
              channelId,
              userId,
              showReplyHint: true,
              webConfig,
            })),
            ...buildContextWarningBlocks(result.contextStatus),
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

      // First attempt: update the initial "thinking" message if it was posted
      // This replaces the stuck "Analyzing..." message with the actual error
      if (threadTs) {
        try {
          await client.chat.update({
            channel: channelId,
            ts: threadTs,
            text: `Error: ${displayMessage}`,
            blocks: [
              section(`*Q:* ${displayQuestion}`),
              errorBlock(`Failed to get response: ${displayMessage}`),
            ],
          });
          errorSent = true;
          logger.debug('Error response sent via chat.update on initial message');
        } catch (updateErr) {
          logger.warn('chat.update failed, trying respond()', {
            updateError: updateErr instanceof Error ? updateErr.message : String(updateErr),
          });
        }
      }

      // Second attempt: use respond() for ephemeral message
      if (!errorSent) {
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
      }

      // Last resort: post a regular message
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
 * Handle /ask continue <thread_ts> [follow-up question]
 *
 * Looks up the original conversation, posts a new thread with the history loaded,
 * and optionally processes a follow-up question immediately.
 */
async function handleContinue(
  originalThreadTs: string,
  followUpQuestion: string | undefined,
  userId: string,
  channelId: string,
  claudeConfig: NonNullable<typeof config.claude>,
  respond: SlackCommandMiddlewareArgs['respond'],
  client: AllMiddlewareArgs['client'],
): Promise<void> {
  // Validate thread_ts format (Slack format: digits.digits)
  if (!/^\d+\.\d+$/.test(originalThreadTs)) {
    await respond({
      blocks: [errorBlock('Invalid thread timestamp format. Expected format: `1234567890.123456`')],
      response_type: 'ephemeral',
    });
    return;
  }

  try {
    const store = getConversationStore(claudeConfig.dbPath, claudeConfig.conversationTtlHours);

    // Look up the original conversation by thread_ts (before consuming rate limit)
    const originalConversation = store.getConversationByThreadTs(originalThreadTs);
    if (!originalConversation) {
      await respond({
        blocks: [errorBlock(`No conversation found for thread \`${originalThreadTs}\`. The conversation may have expired.`)],
        response_type: 'ephemeral',
      });
      return;
    }

    // Check rate limit only after confirming the conversation exists
    if (!checkAndRecordClaudeRequest(userId)) {
      logger.info('Claude rate limit exceeded for continue', { userId });
      await respond({
        blocks: [errorBlock('Rate limit exceeded. Please wait before asking another question.')],
        response_type: 'ephemeral',
      });
      return;
    }

    // Determine the question to ask
    const question = followUpQuestion?.trim() || 'Please continue where we left off. What else can you tell me?'; // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing -- empty string should fall through
    const displayQuestion = truncateText(question, SLACK_TEXT_LIMIT - 20);

    // Post initial message in a new thread
    const initialMessage = await client.chat.postMessage({
      channel: channelId,
      text: `Continuing conversation from ${originalThreadTs}...`,
      blocks: [
        section(`*Continuing conversation* from \`${originalThreadTs}\``),
        section(`*Q:* ${displayQuestion}`),
        contextBlock(`_Analyzing with ${String(originalConversation.messages.length)} messages of context..._`),
      ],
    });

    if (!initialMessage.ts) {
      throw new Error('Failed to post initial message - no timestamp returned');
    }

    const newThreadTs = initialMessage.ts;

    // Create a new conversation pre-loaded with the old conversation's messages
    const newConversation = store.createConversation(
      newThreadTs,
      channelId,
      userId,
      [
        ...originalConversation.messages,
        { role: 'user' as const, content: question },
      ]
    );

    // Process the turn
    const result = await processConversationTurn({
      conversationId: newConversation.id,
      threadTs: newThreadTs,
      channelId,
      userId,
      userMessage: question,
      claudeConfig,
    });

    const totalTokens = result.usage.inputTokens + result.usage.outputTokens;
    const isLongResponse = result.response.length > SLACK_TEXT_LIMIT;
    const webConfig = config.web;
    const webEnabled = webConfig && webConfig.enabled && webConfig.baseUrl;

    if (isLongResponse && webEnabled) {
      const webUrl = getConversationUrl(newThreadTs, channelId, webConfig, userId);
      const snippet = extractSnippet(scrubSensitiveData(result.response));
      await client.chat.update({
        channel: channelId,
        ts: newThreadTs,
        text: `Response: ${result.response.slice(0, 100)}...`,
        blocks: [
          section(`*Continued from* \`${originalThreadTs}\``),
          section(`*Q:* ${displayQuestion}`),
          section(snippet),
          section(`<${webUrl}|View full response> _(${result.response.length.toLocaleString()} chars)_`),
          contextBlock(buildFooter({
            toolCalls: result.toolCalls.length,
            tokens: totalTokens,
            threadTs: newThreadTs,
            channelId,
            userId,
            historyMsgs: originalConversation.messages.length,
            showReplyHint: true,
            webUrl,
          })),
          ...buildContextWarningBlocks(result.contextStatus),
        ],
      });
    } else {
      await client.chat.update({
        channel: channelId,
        ts: newThreadTs,
        text: result.response.slice(0, 100),
        blocks: [
          section(`*Continued from* \`${originalThreadTs}\``),
          section(`*Q:* ${displayQuestion}`),
          section(result.response),
          contextBlock(buildFooter({
            toolCalls: result.toolCalls.length,
            tokens: totalTokens,
            threadTs: newThreadTs,
            channelId,
            userId,
            historyMsgs: originalConversation.messages.length,
            showReplyHint: true,
            webConfig,
          })),
          ...buildContextWarningBlocks(result.contextStatus),
        ],
      });
    }

    logger.info('Conversation continued', {
      userId,
      channelId,
      originalThreadTs,
      newThreadTs,
      historyMessages: originalConversation.messages.length,
      toolCalls: result.toolCalls.length,
      tokens: totalTokens,
    });
  } catch (err) {
    const rawMessage = err instanceof Error ? err.message : 'An unexpected error occurred';
    const parsed = parseSlackError(err instanceof Error ? err : new Error(rawMessage));
    const displayMessage = parsed.type !== 'unknown' ? parsed.format() : rawMessage;

    logger.error('Continue command failed', {
      error: rawMessage,
      errorType: parsed.type,
      userId,
      channelId,
      originalThreadTs,
    });

    await respond({
      blocks: [errorBlock(`Failed to continue conversation: ${displayMessage}`)],
      response_type: 'ephemeral',
    });
  }
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

    // Ignore message subtypes (edits, deletions, etc.) except file_share
    if ('subtype' in event && event.subtype && event.subtype !== 'file_share') {
      return;
    }

    const threadTs = event.thread_ts;
    const channelId = event.channel;
    const userId = 'user' in event ? event.user : undefined;
    const text = 'text' in event ? (event.text ?? '') : '';
    const files = 'files' in event ? (event.files as { id: string; name: string | null; mimetype: string; size: number; url_private_download?: string }[]) : undefined;

    // Need either text or files
    if (!userId || (!text && (!files || files.length === 0))) {
      return;
    }

    // Authorization: DB is source of truth (#278). Reject unknown or
    // deactivated users; fail closed on storage errors.
    try {
      const dbUser = getUserStore(resolveUserStoreDbPath(claudeConfig.dbPath)).getBySlackId(userId);
      if (!dbUser?.isActive) {
        logger.debug('Thread reply from unauthorized or deactivated user', { userId, threadTs });
        return;
      }
    } catch (err) {
      logger.error('Rejecting thread reply — UserStore unavailable', {
        userId,
        threadTs,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    let tempImagePath: string | undefined;
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

      // Process image files from Slack uploads
      const imageResult = await extractImageFromSlackFiles(files, config.slack.botToken);
      const askOptions: AskOptions | undefined = imageResult.askOptions;
      tempImagePath = imageResult.tempImagePath;
      if (imageResult.error) {
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          text: `_Could not process image: ${imageResult.error}. Continuing with text only._`,
        }).catch(() => { /* best effort */ });
      }

      const userMessage = text || 'Please analyze this image.';

      // Use getOrCreateConversation to add message consistently
      // This adds the user message to the conversation
      const updatedConversation = store.getOrCreateConversation(
        threadTs,
        channelId,
        userId,
        userMessage
      );

      // Process the conversation turn
      const result = await processConversationTurn({
        conversationId: updatedConversation.id,
        threadTs,
        channelId,
        userId,
        userMessage,
        claudeConfig,
        askOptions,
      });

      // Track token usage (for diagnostics)
      const totalTokens = result.usage.inputTokens + result.usage.outputTokens;

      // Check if response exceeds Slack's text limit and web UI is available
      const isLongResponse = result.response.length > SLACK_TEXT_LIMIT;
      const webConfig = config.web;
      const webEnabled = webConfig && webConfig.enabled && webConfig.baseUrl;

      // Update the thinking message with response
      if (thinkingMsg.ts) {
        if (isLongResponse && webEnabled) {
          // Post snippet + link to web UI
          const webUrl = getConversationUrl(threadTs, channelId, webConfig, userId);
          const snippet = extractSnippet(scrubSensitiveData(result.response));
          await client.chat.update({
            channel: channelId,
            ts: thinkingMsg.ts,
            text: `Response: ${result.response.slice(0, 100)}...`,
            blocks: [
              section(snippet),
              section(`<${webUrl}|View full response> _(${result.response.length.toLocaleString()} chars)_`),
              contextBlock(buildFooter({
                toolCalls: result.toolCalls.length,
                tokens: totalTokens,
                threadTs,
                channelId,
                userId,
                webUrl,
              })),
              ...buildContextWarningBlocks(result.contextStatus),
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
              contextBlock(buildFooter({
                toolCalls: result.toolCalls.length,
                tokens: totalTokens,
                threadTs,
                channelId,
                userId,
                webConfig,
              })),
              ...buildContextWarningBlocks(result.contextStatus),
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
    } finally {
      if (tempImagePath) {
        await cleanupTempImage(tempImagePath);
      }
    }
  });

  logger.info('Registered thread reply handler');
}

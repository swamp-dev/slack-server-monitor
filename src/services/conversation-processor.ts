/**
 * Shared conversation processing logic
 *
 * Extracts the common flow used by the /ask command, thread handler,
 * /ask continue, and web UI continuation:
 *   get conversation → resolve context → load user config → call Claude
 *   → store assistant response + tool calls → return result
 */

import type { config } from '../config/index.js';
import { getClaudeService } from './claude.js';
import type { AskOptions } from './claude.js';
import { getConversationStore } from './conversation-store.js';
import { getContextStore } from './context-store.js';
import { loadUserConfig } from './user-config.js';
import { getContext, getContextByAlias, type LoadedContext } from './context-loader.js';
import { logger } from '../utils/logger.js';

/**
 * Parameters for processing a conversation turn
 */
export interface ConversationTurnParams {
  conversationId: number;
  threadTs: string;
  channelId: string;
  userId: string;
  userMessage: string;
  claudeConfig: NonNullable<typeof config.claude>;
  askOptions?: AskOptions;
}

/**
 * Result from processing a conversation turn
 */
export interface ConversationTurnResult {
  response: string;
  toolCalls: {
    name: string;
    input: Record<string, unknown>;
    outputPreview: string;
    durationMs?: number;
    isError?: boolean;
  }[];
  usage: { inputTokens: number; outputTokens: number };
  /** Context window status after this turn */
  contextStatus?: {
    wasTruncated: boolean;
    removedCount: number;
    percentUsed: number;
    isWarning: boolean;
  };
}

/** Cached default context from context directory */
let defaultContext: LoadedContext | null = null;

/**
 * Initialize the default context (call once at startup)
 */
export async function initDefaultContext(contextDir: string): Promise<void> {
  defaultContext = await getContext(contextDir);
  if (defaultContext?.combined) {
    logger.info('Loaded default context from directory', {
      contextDir,
      hasClaudeMd: !!defaultContext.claudeMd,
      contextFiles: defaultContext.contextFiles.size,
    });
  }
}

/**
 * Get the cached default context (for use in ask.ts startup)
 */
export function getDefaultContext(): LoadedContext | null {
  return defaultContext;
}

/**
 * Resolve the active context for a channel.
 * Returns the channel-specific context if set, otherwise the default context.
 */
export async function resolveChannelContext(
  channelId: string,
  claudeConfig: NonNullable<typeof config.claude>
): Promise<LoadedContext | null> {
  const contextStore = getContextStore(claudeConfig.dbPath);
  const channelContextAlias = contextStore.getChannelContext(channelId);

  if (channelContextAlias) {
    const option = claudeConfig.contextOptions.find((o) => o.alias === channelContextAlias);
    if (option) {
      return await getContextByAlias(option.alias, option.path);
    }
    logger.warn('Channel context alias not found in options', { channelId, alias: channelContextAlias });
  }

  return defaultContext;
}

/**
 * Process a single conversation turn.
 *
 * Handles: load conversation history → resolve context → load user config
 * → call Claude → store assistant response + tool calls → return result
 */
export async function processConversationTurn(
  params: ConversationTurnParams
): Promise<ConversationTurnResult> {
  const { conversationId, channelId, userId, userMessage, claudeConfig, askOptions } = params;

  const store = getConversationStore(claudeConfig.dbPath, claudeConfig.conversationTtlHours);

  // Get the conversation to access history
  const conversation = store.getConversationById(conversationId);
  if (!conversation) {
    throw new Error(`Conversation ${String(conversationId)} not found`);
  }

  // History is everything except the last message (the one we just added)
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
    githubRepo: claudeConfig.githubRepo,
    githubDefaultLabels: claudeConfig.githubDefaultLabels,
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
    cliTimeoutMs: claudeConfig.cliTimeoutMs,
    contextWindowTokens: claudeConfig.contextWindowTokens,
    contextTruncationThreshold: claudeConfig.contextTruncationThreshold,
    contextWarningThreshold: claudeConfig.contextWarningThreshold,
  });

  const result = await claude.ask(userMessage, history, userConfig, askOptions);

  // Store the assistant response
  store.addAssistantMessage(conversationId, result.response);

  // Log tool calls
  for (const toolCall of result.toolCalls) {
    store.logToolCall(
      conversationId,
      toolCall.name,
      toolCall.input,
      toolCall.outputPreview,
      { durationMs: toolCall.durationMs, success: !toolCall.isError }
    );
  }

  return {
    response: result.response,
    toolCalls: result.toolCalls,
    usage: result.usage,
    contextStatus: result.contextStatus,
  };
}

/**
 * Token estimation utilities for context window management
 *
 * Uses a simple chars/4 heuristic which is reasonable for English text.
 * Not perfectly accurate, but good enough for threshold-based decisions.
 */

import type { ConversationMessage } from '../services/providers/types.js';

/**
 * Approximate characters per token for English text
 * This is a widely-used heuristic: ~4 characters per token on average
 */
export const CHARS_PER_TOKEN = 4;

/**
 * Overhead tokens per message for role markers, formatting, etc.
 * Accounts for "User:", "Assistant:", and structural tokens
 */
const MESSAGE_OVERHEAD_TOKENS = 4;

/**
 * Estimate token count for a string using chars/4 heuristic
 */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Token breakdown for a conversation
 */
export interface ConversationTokenEstimate {
  systemPromptTokens: number;
  messageTokens: number;
  totalTokens: number;
}

/**
 * Estimate token count for an entire conversation (system prompt + messages)
 */
export function estimateConversationTokens(
  messages: ConversationMessage[],
  systemPrompt: string
): ConversationTokenEstimate {
  const systemPromptTokens = estimateTokens(systemPrompt);

  let messageTokens = 0;
  for (const msg of messages) {
    messageTokens += estimateTokens(msg.content) + MESSAGE_OVERHEAD_TOKENS;
  }

  return {
    systemPromptTokens,
    messageTokens,
    totalTokens: systemPromptTokens + messageTokens,
  };
}

/**
 * Result from truncating a conversation
 */
export interface TruncationResult {
  /** Whether any messages were removed */
  truncated: boolean;
  /** The (possibly truncated) messages */
  messages: ConversationMessage[];
  /** Number of messages removed */
  removedCount: number;
  /** Estimated tokens after truncation */
  estimatedTokens: number;
}

/**
 * Truncate a conversation to fit within the context window
 *
 * Strategy:
 * 1. Keep system prompt (always included, not part of messages)
 * 2. Keep the first user message (provides original context)
 * 3. Keep the most recent messages
 * 4. Insert a truncation marker where messages were removed
 */
export function truncateConversation(
  messages: ConversationMessage[],
  systemPrompt: string,
  contextWindowTokens: number,
  truncationThreshold: number
): TruncationResult {
  if (messages.length === 0) {
    return { truncated: false, messages: [], removedCount: 0, estimatedTokens: 0 };
  }

  const maxTokens = contextWindowTokens * truncationThreshold;
  const estimate = estimateConversationTokens(messages, systemPrompt);

  if (estimate.totalTokens <= maxTokens) {
    return {
      truncated: false,
      messages,
      removedCount: 0,
      estimatedTokens: estimate.totalTokens,
    };
  }

  // We need to truncate. Keep first message + as many recent messages as fit.
  const systemTokens = estimateTokens(systemPrompt);
  const firstMessage = messages[0];
  if (!firstMessage) {
    return { truncated: false, messages: [], removedCount: 0, estimatedTokens: 0 };
  }
  const firstMessageTokens = estimateTokens(firstMessage.content) + MESSAGE_OVERHEAD_TOKENS;

  // Reserve space for truncation marker
  const truncationMarker: ConversationMessage = {
    role: 'assistant',
    content: '', // placeholder, will be updated
  };
  const markerOverhead = MESSAGE_OVERHEAD_TOKENS + 20; // estimate for marker text

  const budgetForRecent = maxTokens - systemTokens - firstMessageTokens - markerOverhead;

  // Walk backwards through messages (skip first) to find how many recent messages fit
  const recentMessages: ConversationMessage[] = [];
  let recentTokens = 0;

  for (let i = messages.length - 1; i >= 1; i--) {
    const msg = messages[i];
    if (!msg) continue;
    const msgTokens = estimateTokens(msg.content) + MESSAGE_OVERHEAD_TOKENS;
    if (recentTokens + msgTokens > budgetForRecent) {
      break;
    }
    recentMessages.unshift(msg);
    recentTokens += msgTokens;
  }

  const removedCount = messages.length - 1 - recentMessages.length;

  if (removedCount <= 0) {
    // Even after calculation, nothing to remove (edge case: single very long message)
    return {
      truncated: false,
      messages,
      removedCount: 0,
      estimatedTokens: estimate.totalTokens,
    };
  }

  // Build the truncation marker text
  truncationMarker.content = `[conversation truncated - ${String(removedCount)} earlier messages removed]`;

  const truncatedMessages = [firstMessage, truncationMarker, ...recentMessages];
  const finalEstimate = estimateConversationTokens(truncatedMessages, systemPrompt);

  return {
    truncated: true,
    messages: truncatedMessages,
    removedCount,
    estimatedTokens: finalEstimate.totalTokens,
  };
}

/**
 * Context window usage status
 */
export interface ContextStatus {
  /** Level: none (safe), warning (approaching limit), truncation (needs truncation) */
  level: 'none' | 'warning' | 'truncation';
  /** Percentage of context window used (0-1+) */
  percentUsed: number;
  /** Estimated total tokens */
  estimatedTokens: number;
  /** Context window size */
  contextWindowTokens: number;
}

/**
 * Check the context window usage status for a conversation
 */
export function getContextStatus(
  messages: ConversationMessage[],
  systemPrompt: string,
  contextWindowTokens: number,
  warningThreshold: number,
  truncationThreshold: number
): ContextStatus {
  const estimate = estimateConversationTokens(messages, systemPrompt);
  const percentUsed = contextWindowTokens > 0 ? estimate.totalTokens / contextWindowTokens : 0;

  let level: 'none' | 'warning' | 'truncation';
  if (percentUsed >= truncationThreshold) {
    level = 'truncation';
  } else if (percentUsed >= warningThreshold) {
    level = 'warning';
  } else {
    level = 'none';
  }

  return {
    level,
    percentUsed,
    estimatedTokens: estimate.totalTokens,
    contextWindowTokens,
  };
}

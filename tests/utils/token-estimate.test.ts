import { describe, it, expect } from 'vitest';
import {
  estimateTokens,
  estimateConversationTokens,
  truncateConversation,
  getContextStatus,
  CHARS_PER_TOKEN,
} from '../../src/utils/token-estimate.js';
import type { ConversationMessage } from '../../src/services/providers/types.js';

describe('token-estimate', () => {
  describe('estimateTokens', () => {
    it('should return 0 for empty string', () => {
      expect(estimateTokens('')).toBe(0);
    });

    it('should estimate tokens based on character count', () => {
      // 100 chars / 4 chars per token = 25 tokens
      const text = 'a'.repeat(100);
      expect(estimateTokens(text)).toBe(25);
    });

    it('should round up for partial tokens', () => {
      // 5 chars / 4 = 1.25, rounds up to 2
      expect(estimateTokens('hello')).toBe(2);
    });

    it('should handle single character', () => {
      expect(estimateTokens('x')).toBe(1);
    });

    it('should handle unicode characters', () => {
      // Emojis are 2 chars each in JS (surrogate pairs), so 4 emojis = 8 chars
      const text = '🎉🎉🎉🎉';
      expect(estimateTokens(text)).toBe(Math.ceil(text.length / CHARS_PER_TOKEN));
    });
  });

  describe('estimateConversationTokens', () => {
    it('should return systemPromptTokens for empty conversation', () => {
      const result = estimateConversationTokens([], 'You are a helpful bot.');
      expect(result.systemPromptTokens).toBeGreaterThan(0);
      expect(result.messageTokens).toBe(0);
      expect(result.totalTokens).toBe(result.systemPromptTokens);
    });

    it('should estimate tokens for messages', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there! How can I help?' },
      ];
      const result = estimateConversationTokens(messages, 'System prompt');
      expect(result.messageTokens).toBeGreaterThan(0);
      expect(result.totalTokens).toBe(result.systemPromptTokens + result.messageTokens);
    });

    it('should account for role overhead per message', () => {
      const singleMsg: ConversationMessage[] = [{ role: 'user', content: 'Hi' }];
      const result = estimateConversationTokens(singleMsg, '');
      // Should be more than just the content tokens due to role overhead
      expect(result.messageTokens).toBeGreaterThan(estimateTokens('Hi'));
    });

    it('should handle default system prompt when none provided', () => {
      const result = estimateConversationTokens([], '');
      expect(result.systemPromptTokens).toBe(0);
      expect(result.totalTokens).toBe(0);
    });
  });

  describe('CHARS_PER_TOKEN', () => {
    it('should be 4', () => {
      expect(CHARS_PER_TOKEN).toBe(4);
    });
  });

  describe('truncateConversation', () => {
    const systemPrompt = 'You are a helper.';

    it('should return unchanged messages when under limit', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' },
      ];
      const result = truncateConversation(messages, systemPrompt, 200000, 0.8);
      expect(result.truncated).toBe(false);
      expect(result.messages).toEqual(messages);
      expect(result.removedCount).toBe(0);
    });

    it('should truncate oldest messages when over threshold', () => {
      // Create a conversation with enough content to exceed a small limit
      const messages: ConversationMessage[] = [];
      for (let i = 0; i < 20; i++) {
        messages.push({ role: 'user', content: `Question ${String(i)}: ${'x'.repeat(200)}` });
        messages.push({ role: 'assistant', content: `Answer ${String(i)}: ${'y'.repeat(200)}` });
      }

      // Use a small token limit to force truncation
      const result = truncateConversation(messages, systemPrompt, 500, 0.8);
      expect(result.truncated).toBe(true);
      expect(result.messages.length).toBeLessThan(messages.length);
      expect(result.removedCount).toBeGreaterThan(0);
    });

    it('should keep the first user message', () => {
      const messages: ConversationMessage[] = [];
      messages.push({ role: 'user', content: 'FIRST_MESSAGE_MARKER' });
      messages.push({ role: 'assistant', content: 'First response' });
      for (let i = 0; i < 20; i++) {
        messages.push({ role: 'user', content: `Q${String(i)}: ${'x'.repeat(200)}` });
        messages.push({ role: 'assistant', content: `A${String(i)}: ${'y'.repeat(200)}` });
      }

      const result = truncateConversation(messages, systemPrompt, 500, 0.8);
      expect(result.truncated).toBe(true);
      // First message should be preserved
      expect(result.messages[0]?.content).toBe('FIRST_MESSAGE_MARKER');
    });

    it('should keep most recent messages', () => {
      const messages: ConversationMessage[] = [];
      for (let i = 0; i < 20; i++) {
        messages.push({ role: 'user', content: `Q${String(i)}: ${'x'.repeat(200)}` });
        messages.push({ role: 'assistant', content: `A${String(i)}: ${'y'.repeat(200)}` });
      }

      const result = truncateConversation(messages, systemPrompt, 500, 0.8);
      expect(result.truncated).toBe(true);
      // Last message should be the most recent one
      const lastMsg = result.messages[result.messages.length - 1];
      expect(lastMsg?.content).toContain('A19');
    });

    it('should add truncation marker when messages are removed', () => {
      const messages: ConversationMessage[] = [];
      for (let i = 0; i < 20; i++) {
        messages.push({ role: 'user', content: `Q${String(i)}: ${'x'.repeat(200)}` });
        messages.push({ role: 'assistant', content: `A${String(i)}: ${'y'.repeat(200)}` });
      }

      const result = truncateConversation(messages, systemPrompt, 500, 0.8);
      expect(result.truncated).toBe(true);
      // Should have a truncation marker after the first message
      const markerMessage = result.messages.find(m =>
        m.content.includes('[conversation truncated')
      );
      expect(markerMessage).toBeDefined();
      expect(markerMessage?.role).toBe('assistant');
    });

    it('should handle empty conversation', () => {
      const result = truncateConversation([], systemPrompt, 200000, 0.8);
      expect(result.truncated).toBe(false);
      expect(result.messages).toEqual([]);
      expect(result.removedCount).toBe(0);
    });

    it('should handle single message', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Hello' },
      ];
      const result = truncateConversation(messages, systemPrompt, 200000, 0.8);
      expect(result.truncated).toBe(false);
      expect(result.messages).toEqual(messages);
    });

    it('should handle conversation exactly at limit', () => {
      // This should NOT truncate - exactly at the limit is fine
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' },
      ];
      // Set limit very high so we don't truncate
      const result = truncateConversation(messages, systemPrompt, 1000000, 0.8);
      expect(result.truncated).toBe(false);
    });

    it('should return the estimated token count after truncation', () => {
      const messages: ConversationMessage[] = [];
      for (let i = 0; i < 20; i++) {
        messages.push({ role: 'user', content: `Q${String(i)}: ${'x'.repeat(200)}` });
        messages.push({ role: 'assistant', content: `A${String(i)}: ${'y'.repeat(200)}` });
      }

      const result = truncateConversation(messages, systemPrompt, 500, 0.8);
      expect(result.truncated).toBe(true);
      expect(result.estimatedTokens).toBeDefined();
      expect(result.estimatedTokens).toBeLessThanOrEqual(500 * 0.8);
    });
  });

  describe('getContextStatus', () => {
    it('should return none when well under limit', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Hello' },
      ];
      const status = getContextStatus(messages, 'System', 200000, 0.7, 0.8);
      expect(status.level).toBe('none');
      expect(status.percentUsed).toBeLessThan(0.7);
    });

    it('should return warning when approaching limit', () => {
      // We need tokens between 70% and 80% of 1000 = 700-800 tokens
      // Each message: 'x'.repeat(360) = 90 tokens + 4 overhead = 94 per msg
      // 8 messages * 94 = 752 tokens -> 75.2% of 1000
      const messages: ConversationMessage[] = [];
      for (let i = 0; i < 4; i++) {
        messages.push({ role: 'user', content: 'x'.repeat(360) });
        messages.push({ role: 'assistant', content: 'y'.repeat(360) });
      }
      const status = getContextStatus(messages, '', 1000, 0.7, 0.8);
      expect(status.level).toBe('warning');
      expect(status.percentUsed).toBeGreaterThanOrEqual(0.7);
      expect(status.percentUsed).toBeLessThan(0.8);
    });

    it('should return truncation when over truncation threshold', () => {
      // 10 messages * 94 tokens = 940 -> 94% of 1000
      const messages: ConversationMessage[] = [];
      for (let i = 0; i < 5; i++) {
        messages.push({ role: 'user', content: 'x'.repeat(360) });
        messages.push({ role: 'assistant', content: 'y'.repeat(360) });
      }
      const status = getContextStatus(messages, '', 1000, 0.7, 0.8);
      expect(status.level).toBe('truncation');
      expect(status.percentUsed).toBeGreaterThanOrEqual(0.8);
    });

    it('should include estimated token count', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Hello' },
      ];
      const status = getContextStatus(messages, '', 200000, 0.7, 0.8);
      expect(status.estimatedTokens).toBeGreaterThan(0);
      expect(status.contextWindowTokens).toBe(200000);
    });
  });
});

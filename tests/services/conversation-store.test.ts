import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConversationStore } from '../../src/services/conversation-store.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('ConversationStore', () => {
  let store: ConversationStore;
  let testDbPath: string;

  beforeEach(() => {
    // Create a unique temp path for each test
    testDbPath = path.join(os.tmpdir(), `test-claude-${Date.now()}.db`);
    store = new ConversationStore(testDbPath, 24);
  });

  afterEach(() => {
    store.close();
    // Clean up test database
    try {
      fs.unlinkSync(testDbPath);
      fs.unlinkSync(testDbPath + '-wal');
      fs.unlinkSync(testDbPath + '-shm');
    } catch {
      // Files may not exist
    }
  });

  describe('conversation management', () => {
    it('should create a new conversation', () => {
      const conversation = store.createConversation(
        '1234.5678',
        'C123ABC',
        'U456DEF',
        [{ role: 'user', content: 'Hello' }]
      );

      expect(conversation.id).toBeDefined();
      expect(conversation.threadTs).toBe('1234.5678');
      expect(conversation.channelId).toBe('C123ABC');
      expect(conversation.userId).toBe('U456DEF');
      expect(conversation.messages).toHaveLength(1);
      expect(conversation.messages[0]).toEqual({ role: 'user', content: 'Hello' });
    });

    it('should retrieve an existing conversation', () => {
      store.createConversation('1234.5678', 'C123ABC', 'U456DEF', []);

      const retrieved = store.getConversation('1234.5678', 'C123ABC');

      expect(retrieved).not.toBeNull();
      expect(retrieved?.threadTs).toBe('1234.5678');
    });

    it('should return null for non-existent conversation', () => {
      const result = store.getConversation('nonexistent', 'C123ABC');
      expect(result).toBeNull();
    });

    it('should update conversation messages', () => {
      const conversation = store.createConversation(
        '1234.5678',
        'C123ABC',
        'U456DEF',
        [{ role: 'user', content: 'Hello' }]
      );

      const newMessages = [
        { role: 'user' as const, content: 'Hello' },
        { role: 'assistant' as const, content: 'Hi there!' },
      ];
      store.updateConversation(conversation.id, newMessages);

      const updated = store.getConversation('1234.5678', 'C123ABC');
      expect(updated?.messages).toHaveLength(2);
      expect(updated?.messages[1]).toEqual({ role: 'assistant', content: 'Hi there!' });
    });

    it('should get or create conversation with new user message', () => {
      const conversation = store.getOrCreateConversation(
        '1234.5678',
        'C123ABC',
        'U456DEF',
        'What is the status?'
      );

      expect(conversation.messages).toHaveLength(1);
      expect(conversation.messages[0].content).toBe('What is the status?');

      // Getting again with a new message should add to existing
      const updated = store.getOrCreateConversation(
        '1234.5678',
        'C123ABC',
        'U456DEF',
        'And the logs?'
      );

      expect(updated.id).toBe(conversation.id);
      expect(updated.messages).toHaveLength(2);
    });

    it('should add assistant message to conversation', () => {
      const conversation = store.createConversation(
        '1234.5678',
        'C123ABC',
        'U456DEF',
        [{ role: 'user', content: 'Hello' }]
      );

      store.addAssistantMessage(conversation.id, 'Hello! How can I help?');

      const updated = store.getConversation('1234.5678', 'C123ABC');
      expect(updated?.messages).toHaveLength(2);
      expect(updated?.messages[1]).toEqual({
        role: 'assistant',
        content: 'Hello! How can I help?',
      });
    });
  });

  describe('token usage tracking', () => {
    it('should track token usage for today', () => {
      expect(store.getTodayTokenUsage()).toBe(0);

      store.addTokenUsage(100);
      expect(store.getTodayTokenUsage()).toBe(100);

      store.addTokenUsage(50);
      expect(store.getTodayTokenUsage()).toBe(150);
    });

    it('should check daily budget', () => {
      expect(store.isDailyBudgetExceeded(100)).toBe(false);

      store.addTokenUsage(100);
      expect(store.isDailyBudgetExceeded(100)).toBe(true);
      expect(store.isDailyBudgetExceeded(200)).toBe(false);
    });
  });

  describe('tool call logging', () => {
    it('should log tool calls', () => {
      const conversation = store.createConversation('1234.5678', 'C123ABC', 'U456DEF', []);

      store.logToolCall(
        conversation.id,
        'get_container_status',
        { container_name: 'nginx' },
        '{"name": "nginx", "state": "running"}'
      );

      // The log call should not throw
      // (We don't have a getter for tool calls yet, but the insert should work)
    });
  });

  describe('cleanup', () => {
    it('should clean up expired conversations', () => {
      // Create a conversation
      store.createConversation('1234.5678', 'C123ABC', 'U456DEF', []);

      // With a 24-hour TTL, nothing should be cleaned up immediately
      const cleaned = store.cleanupExpired();
      expect(cleaned).toBe(0);

      // Conversation should still exist
      const conversation = store.getConversation('1234.5678', 'C123ABC');
      expect(conversation).not.toBeNull();
    });
  });
});

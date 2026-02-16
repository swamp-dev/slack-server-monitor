import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
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

  describe('session queries', () => {
    it('listRecentSessions returns sessions ordered by updated_at desc', () => {
      // Create multiple conversations
      store.createConversation('1111.0001', 'C123ABC', 'U456DEF', [{ role: 'user', content: 'First' }]);
      store.createConversation('2222.0002', 'C123ABC', 'U789GHI', [{ role: 'user', content: 'Second' }]);
      store.createConversation('3333.0003', 'C123ABC', 'U456DEF', [{ role: 'user', content: 'Third' }]);

      const sessions = store.listRecentSessions();

      expect(sessions).toHaveLength(3);
      // Most recent first
      expect(sessions[0]?.threadTs).toBe('3333.0003');
      expect(sessions[1]?.threadTs).toBe('2222.0002');
      expect(sessions[2]?.threadTs).toBe('1111.0001');
    });

    it('listRecentSessions filters by userId', () => {
      store.createConversation('1111.0001', 'C123ABC', 'U456DEF', []);
      store.createConversation('2222.0002', 'C123ABC', 'U789GHI', []);
      store.createConversation('3333.0003', 'C123ABC', 'U456DEF', []);

      const sessions = store.listRecentSessions(20, 'U456DEF');

      expect(sessions).toHaveLength(2);
      expect(sessions.every((s) => s.userId === 'U456DEF')).toBe(true);
    });

    it('listRecentSessions includes tool call counts', () => {
      const conversation = store.createConversation('1234.5678', 'C123ABC', 'U456DEF', []);
      store.logToolCall(conversation.id, 'get_container_status', { name: 'nginx' }, 'output1');
      store.logToolCall(conversation.id, 'get_container_logs', { name: 'nginx' }, 'output2');
      store.logToolCall(conversation.id, 'get_system_resources', {}, 'output3');

      const sessions = store.listRecentSessions();

      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.toolCallCount).toBe(3);
    });

    it('listRecentSessions includes message counts', () => {
      store.createConversation('1234.5678', 'C123ABC', 'U456DEF', [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' },
        { role: 'user', content: 'Status?' },
      ]);

      const sessions = store.listRecentSessions();

      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.messageCount).toBe(3);
    });

    it('listRecentSessions marks active sessions correctly', () => {
      // Just-created sessions should be active (within 5 minutes)
      store.createConversation('1234.5678', 'C123ABC', 'U456DEF', []);

      const sessions = store.listRecentSessions();

      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.isActive).toBe(true);
    });

    it('listRecentSessions returns empty array when no sessions', () => {
      const sessions = store.listRecentSessions();

      expect(sessions).toHaveLength(0);
    });

    it('getSessionDetail returns null for non-existent session', () => {
      const detail = store.getSessionDetail('nonexistent', 'C123ABC');

      expect(detail).toBeNull();
    });

    it('getSessionDetail includes tool call history', () => {
      const conversation = store.createConversation('1234.5678', 'C123ABC', 'U456DEF', [
        { role: 'user', content: 'Check nginx' },
      ]);
      store.logToolCall(conversation.id, 'get_container_status', { container_name: 'nginx' }, 'running');
      store.logToolCall(conversation.id, 'get_container_logs', { container_name: 'nginx', lines: 50 }, 'log output');

      const detail = store.getSessionDetail('1234.5678', 'C123ABC');

      expect(detail).not.toBeNull();
      expect(detail?.recentToolCalls).toHaveLength(2);
      expect(detail?.recentToolCalls[0]?.toolName).toBe('get_container_logs'); // Most recent first
      expect(detail?.recentToolCalls[1]?.toolName).toBe('get_container_status');
    });

    it('getSessionStats calculates aggregates correctly', () => {
      // Create sessions with messages and tool calls
      const conv1 = store.createConversation('1111.0001', 'C123ABC', 'U456DEF', [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' },
      ]);
      store.logToolCall(conv1.id, 'get_container_status', {}, 'output');

      const conv2 = store.createConversation('2222.0002', 'C123ABC', 'U789GHI', [
        { role: 'user', content: 'Check logs' },
      ]);
      store.logToolCall(conv2.id, 'get_container_logs', {}, 'output');
      store.logToolCall(conv2.id, 'get_container_logs', {}, 'output');

      const stats = store.getSessionStats();

      expect(stats.totalSessions).toBe(2);
      expect(stats.activeSessions).toBe(2); // Both recently created
      expect(stats.totalMessages).toBe(3); // 2 + 1
      expect(stats.totalToolCalls).toBe(3); // 1 + 2
    });

    it('getSessionStats returns top tools used', () => {
      const conv1 = store.createConversation('1111.0001', 'C123ABC', 'U456DEF', []);
      store.logToolCall(conv1.id, 'get_container_logs', {}, 'out');
      store.logToolCall(conv1.id, 'get_container_logs', {}, 'out');
      store.logToolCall(conv1.id, 'get_container_logs', {}, 'out');
      store.logToolCall(conv1.id, 'get_container_status', {}, 'out');
      store.logToolCall(conv1.id, 'get_container_status', {}, 'out');
      store.logToolCall(conv1.id, 'run_command', {}, 'out');

      const stats = store.getSessionStats();

      expect(stats.topTools).toHaveLength(3);
      expect(stats.topTools[0]).toEqual({ name: 'get_container_logs', count: 3, avgDurationMs: null });
      expect(stats.topTools[1]).toEqual({ name: 'get_container_status', count: 2, avgDurationMs: null });
      expect(stats.topTools[2]).toEqual({ name: 'run_command', count: 1, avgDurationMs: null });
    });

    it('getToolCalls retrieves tool calls for a conversation', () => {
      const conversation = store.createConversation('1234.5678', 'C123ABC', 'U456DEF', []);
      store.logToolCall(conversation.id, 'tool1', { arg: 'value1' }, 'output1');
      store.logToolCall(conversation.id, 'tool2', { arg: 'value2' }, 'output2');

      const toolCalls = store.getToolCalls(conversation.id);

      expect(toolCalls).toHaveLength(2);
      expect(toolCalls[0]?.toolName).toBe('tool2'); // Most recent first
      expect(toolCalls[0]?.input).toEqual({ arg: 'value2' });
      expect(toolCalls[1]?.toolName).toBe('tool1');
    });

    it('getToolCalls respects limit parameter', () => {
      const conversation = store.createConversation('1234.5678', 'C123ABC', 'U456DEF', []);
      store.logToolCall(conversation.id, 'tool1', {}, 'out');
      store.logToolCall(conversation.id, 'tool2', {}, 'out');
      store.logToolCall(conversation.id, 'tool3', {}, 'out');

      const toolCalls = store.getToolCalls(conversation.id, 2);

      expect(toolCalls).toHaveLength(2);
      expect(toolCalls[0]?.toolName).toBe('tool3');
      expect(toolCalls[1]?.toolName).toBe('tool2');
    });
  });

  describe('tool call analytics', () => {
    it('should store duration and success fields', () => {
      const conversation = store.createConversation('1234.5678', 'C123ABC', 'U456DEF', []);
      store.logToolCall(conversation.id, 'get_disk_usage', { mount: '/' }, '45% used', {
        durationMs: 150,
        success: true,
      });

      const toolCalls = store.getToolCalls(conversation.id);

      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0]?.durationMs).toBe(150);
      expect(toolCalls[0]?.success).toBe(true);
    });

    it('should store failed tool calls', () => {
      const conversation = store.createConversation('1234.5678', 'C123ABC', 'U456DEF', []);
      store.logToolCall(conversation.id, 'run_command', { command: 'bad' }, 'Error: not allowed', {
        durationMs: 5,
        success: false,
      });

      const toolCalls = store.getToolCalls(conversation.id);

      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0]?.success).toBe(false);
    });

    it('should default to null duration and true success when not provided', () => {
      const conversation = store.createConversation('1234.5678', 'C123ABC', 'U456DEF', []);
      store.logToolCall(conversation.id, 'get_disk_usage', {}, 'output');

      const toolCalls = store.getToolCalls(conversation.id);

      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0]?.durationMs).toBeNull();
      expect(toolCalls[0]?.success).toBe(true);
    });

    it('getSessionStats should include avgToolDurationMs', () => {
      const conv = store.createConversation('1111.0001', 'C123ABC', 'U456DEF', []);
      store.logToolCall(conv.id, 'tool1', {}, 'out', { durationMs: 100, success: true });
      store.logToolCall(conv.id, 'tool2', {}, 'out', { durationMs: 200, success: true });
      store.logToolCall(conv.id, 'tool3', {}, 'out', { durationMs: 300, success: true });

      const stats = store.getSessionStats();

      expect(stats.avgToolDurationMs).toBe(200); // (100 + 200 + 300) / 3
    });

    it('getSessionStats should include toolFailureRate', () => {
      const conv = store.createConversation('1111.0001', 'C123ABC', 'U456DEF', []);
      store.logToolCall(conv.id, 'tool1', {}, 'out', { durationMs: 100, success: true });
      store.logToolCall(conv.id, 'tool2', {}, 'error', { durationMs: 50, success: false });
      store.logToolCall(conv.id, 'tool3', {}, 'out', { durationMs: 200, success: true });
      store.logToolCall(conv.id, 'tool4', {}, 'error', { durationMs: 10, success: false });

      const stats = store.getSessionStats();

      expect(stats.toolFailureRate).toBeCloseTo(0.5, 2); // 2 failures / 4 total
    });

    it('getSessionStats should handle zero tool calls for analytics', () => {
      store.createConversation('1111.0001', 'C123ABC', 'U456DEF', []);

      const stats = store.getSessionStats();

      expect(stats.avgToolDurationMs).toBeNull();
      expect(stats.toolFailureRate).toBe(0);
    });

    it('getSessionStats should include topTools with avgDurationMs', () => {
      const conv = store.createConversation('1111.0001', 'C123ABC', 'U456DEF', []);
      store.logToolCall(conv.id, 'get_container_status', {}, 'out', { durationMs: 100, success: true });
      store.logToolCall(conv.id, 'get_container_status', {}, 'out', { durationMs: 200, success: true });
      store.logToolCall(conv.id, 'run_command', {}, 'out', { durationMs: 500, success: true });

      const stats = store.getSessionStats();

      expect(stats.topTools[0]?.name).toBe('get_container_status');
      expect(stats.topTools[0]?.avgDurationMs).toBe(150); // (100 + 200) / 2
      expect(stats.topTools[1]?.name).toBe('run_command');
      expect(stats.topTools[1]?.avgDurationMs).toBe(500);
    });

    it('should migrate old database without duration_ms and success columns', () => {
      // Create a database with old schema (no duration_ms or success columns)
      const oldDbPath = path.join(os.tmpdir(), `test-migration-${Date.now()}.db`);
      const oldDb = new Database(oldDbPath);
      oldDb.exec(`
        CREATE TABLE conversations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          thread_ts TEXT NOT NULL,
          channel_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          messages TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          UNIQUE(thread_ts, channel_id)
        );
        CREATE TABLE tool_calls (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          conversation_id INTEGER REFERENCES conversations(id),
          tool_name TEXT NOT NULL,
          input TEXT NOT NULL,
          output_preview TEXT,
          timestamp INTEGER NOT NULL
        );
      `);

      // Insert old-format data
      const now = Date.now();
      oldDb.prepare('INSERT INTO conversations (thread_ts, channel_id, user_id, messages, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run('1234.5678', 'C123', 'U456', '[]', now, now);
      oldDb.prepare('INSERT INTO tool_calls (conversation_id, tool_name, input, output_preview, timestamp) VALUES (?, ?, ?, ?, ?)')
        .run(1, 'get_disk_usage', '{"mount":"/"}', '45% used', now);
      oldDb.close();

      // Open with ConversationStore (should migrate)
      const migratedStore = new ConversationStore(oldDbPath, 24);

      // Verify migration: new columns should exist and old data should be readable
      const toolCalls = migratedStore.getToolCalls(1);
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0]?.toolName).toBe('get_disk_usage');
      expect(toolCalls[0]?.durationMs).toBeNull();
      expect(toolCalls[0]?.success).toBe(true); // Default

      // Verify we can write with new fields
      migratedStore.logToolCall(1, 'run_command', {}, 'output', { durationMs: 42, success: false });
      const allToolCalls = migratedStore.getToolCalls(1);
      expect(allToolCalls).toHaveLength(2);
      expect(allToolCalls[0]?.durationMs).toBe(42);
      expect(allToolCalls[0]?.success).toBe(false);

      migratedStore.close();

      // Cleanup
      try { fs.unlinkSync(oldDbPath); } catch { /* ignore */ }
      try { fs.unlinkSync(oldDbPath + '-wal'); } catch { /* ignore */ }
      try { fs.unlinkSync(oldDbPath + '-shm'); } catch { /* ignore */ }
    });
  });
});

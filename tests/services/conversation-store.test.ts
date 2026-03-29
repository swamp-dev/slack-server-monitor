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

    it('should get conversation by thread_ts only', () => {
      store.createConversation('1234.5678', 'C123ABC', 'U456DEF', [
        { role: 'user', content: 'Hello' },
      ]);

      const result = store.getConversationByThreadTs('1234.5678');

      expect(result).not.toBeNull();
      expect(result?.threadTs).toBe('1234.5678');
      expect(result?.channelId).toBe('C123ABC');
      expect(result?.messages).toHaveLength(1);
    });

    it('should return null for non-existent thread_ts', () => {
      const result = store.getConversationByThreadTs('nonexistent');
      expect(result).toBeNull();
    });

    it('should get conversation by ID', () => {
      const created = store.createConversation('1234.5678', 'C123ABC', 'U456DEF', [
        { role: 'user', content: 'Hello' },
      ]);

      const result = store.getConversationById(created.id);

      expect(result).not.toBeNull();
      expect(result?.id).toBe(created.id);
      expect(result?.threadTs).toBe('1234.5678');
    });

    it('should return null for non-existent ID', () => {
      const result = store.getConversationById(99999);
      expect(result).toBeNull();
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

      const sessions = store.listRecentSessions(20, 0, 'U456DEF');

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

    it('listRecentSessions includes firstMessage from first user message', () => {
      store.createConversation('1111.0001', 'C123ABC', 'U456DEF', [
        { role: 'user', content: 'Why is nginx returning 502 errors?' },
        { role: 'assistant', content: 'Let me check.' },
      ]);

      const sessions = store.listRecentSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.firstMessage).toBe('Why is nginx returning 502 errors?');
    });

    it('listRecentSessions truncates firstMessage to 80 chars', () => {
      const longMessage = 'A'.repeat(100);
      store.createConversation('1111.0001', 'C123ABC', 'U456DEF', [
        { role: 'user', content: longMessage },
      ]);

      const sessions = store.listRecentSessions();
      expect(sessions[0]?.firstMessage).toBe('A'.repeat(80) + '...');
    });

    it('listRecentSessions returns undefined firstMessage when no user messages', () => {
      store.createConversation('1111.0001', 'C123ABC', 'U456DEF', [
        { role: 'assistant', content: 'Hello!' },
      ]);

      const sessions = store.listRecentSessions();
      expect(sessions[0]?.firstMessage).toBeUndefined();
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

  describe('pagination', () => {
    it('listRecentSessions supports offset for pagination', () => {
      // Create 5 conversations
      for (let i = 1; i <= 5; i++) {
        store.createConversation(`${String(i)}000.000${String(i)}`, 'C123ABC', 'U456DEF', []);
      }

      const page1 = store.listRecentSessions(2, 0);
      const page2 = store.listRecentSessions(2, 2);
      const page3 = store.listRecentSessions(2, 4);

      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(2);
      expect(page3).toHaveLength(1);

      // Pages should have different conversations
      const allIds = [...page1, ...page2, ...page3].map((s) => s.id);
      expect(new Set(allIds).size).toBe(5);
    });

    it('countSessions returns total count', () => {
      store.createConversation('1111.0001', 'C123ABC', 'U456DEF', []);
      store.createConversation('2222.0002', 'C123ABC', 'U789GHI', []);
      store.createConversation('3333.0003', 'C123ABC', 'U456DEF', []);

      expect(store.countSessions()).toBe(3);
      expect(store.countSessions('U456DEF')).toBe(2);
      expect(store.countSessions('U789GHI')).toBe(1);
    });

    it('countSessions excludes archived conversations', () => {
      const conv = store.createConversation('1111.0001', 'C123ABC', 'U456DEF', []);
      store.createConversation('2222.0002', 'C123ABC', 'U789GHI', []);

      // Archive one
      store.getDatabase().prepare('UPDATE conversations SET archived_at = ? WHERE id = ?')
        .run(Date.now(), conv.id);

      expect(store.countSessions()).toBe(1);
    });
  });

  describe('full-text search', () => {
    it('should find conversations by message content', () => {
      store.createConversation('1111.0001', 'C123ABC', 'U456DEF', [
        { role: 'user', content: 'How do I restart nginx?' },
        { role: 'assistant', content: 'Run docker restart nginx' },
      ]);
      store.createConversation('2222.0002', 'C123ABC', 'U789GHI', [
        { role: 'user', content: 'Check disk usage on /data' },
        { role: 'assistant', content: 'The /data mount is at 45%' },
      ]);
      store.createConversation('3333.0003', 'C123ABC', 'U456DEF', [
        { role: 'user', content: 'Show me nginx logs' },
      ]);

      const results = store.searchConversations('nginx');

      expect(results).toHaveLength(2);
      // Should include both conversations mentioning nginx
      const threadIds = results.map((r) => r.threadTs);
      expect(threadIds).toContain('1111.0001');
      expect(threadIds).toContain('3333.0003');
    });

    it('should return empty array when no matches found', () => {
      store.createConversation('1111.0001', 'C123ABC', 'U456DEF', [
        { role: 'user', content: 'Hello world' },
      ]);

      const results = store.searchConversations('nonexistent');

      expect(results).toHaveLength(0);
    });

    it('should support pagination for search results', () => {
      // Create 5 conversations with "docker" in them
      for (let i = 1; i <= 5; i++) {
        store.createConversation(`${String(i)}000.000${String(i)}`, 'C123ABC', 'U456DEF', [
          { role: 'user', content: `Docker question ${String(i)}` },
        ]);
      }

      const page1 = store.searchConversations('docker', 2, 0);
      const page2 = store.searchConversations('docker', 2, 2);

      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(2);
      // Pages should not overlap
      const ids1 = new Set(page1.map((r) => r.id));
      const ids2 = new Set(page2.map((r) => r.id));
      expect([...ids1].some((id) => ids2.has(id))).toBe(false);
    });

    it('should count total search results', () => {
      store.createConversation('1111.0001', 'C123ABC', 'U456DEF', [
        { role: 'user', content: 'Docker restart' },
      ]);
      store.createConversation('2222.0002', 'C123ABC', 'U789GHI', [
        { role: 'user', content: 'Docker logs' },
      ]);
      store.createConversation('3333.0003', 'C123ABC', 'U456DEF', [
        { role: 'user', content: 'No match here' },
      ]);

      const count = store.countSearchResults('docker');

      expect(count).toBe(2);
    });

    it('should exclude archived conversations from search', () => {
      const conv = store.createConversation('1111.0001', 'C123ABC', 'U456DEF', [
        { role: 'user', content: 'Docker restart' },
      ]);
      store.createConversation('2222.0002', 'C123ABC', 'U789GHI', [
        { role: 'user', content: 'Docker logs' },
      ]);

      // Archive one
      store.getDatabase().prepare('UPDATE conversations SET archived_at = ? WHERE id = ?')
        .run(Date.now(), conv.id);

      const results = store.searchConversations('docker');

      expect(results).toHaveLength(1);
      expect(results[0]?.threadTs).toBe('2222.0002');
    });

    it('should update search index when conversation is updated', () => {
      const conv = store.createConversation('1111.0001', 'C123ABC', 'U456DEF', [
        { role: 'user', content: 'Hello world' },
      ]);

      // Initially no match for "redis"
      expect(store.searchConversations('redis')).toHaveLength(0);

      // Update with new content
      store.updateConversation(conv.id, [
        { role: 'user', content: 'Hello world' },
        { role: 'assistant', content: 'Redis is running on port 6379' },
      ]);

      // Now should match
      expect(store.searchConversations('redis')).toHaveLength(1);
    });

    it('should handle search with special FTS5 characters', () => {
      store.createConversation('1111.0001', 'C123ABC', 'U456DEF', [
        { role: 'user', content: 'Check /var/log/nginx' },
      ]);

      // Should not throw on special characters
      const results = store.searchConversations('/var/log');

      expect(results).toHaveLength(1);
    });
  });

  describe('tagging', () => {
    it('should add a tag to a conversation', () => {
      const conv = store.createConversation('1111.0001', 'C123ABC', 'U456DEF', []);

      store.addTag(conv.id, 'important');

      const tags = store.getTags(conv.id);
      expect(tags).toEqual(['important']);
    });

    it('should add multiple tags to a conversation', () => {
      const conv = store.createConversation('1111.0001', 'C123ABC', 'U456DEF', []);

      store.addTag(conv.id, 'nginx');
      store.addTag(conv.id, 'debugging');
      store.addTag(conv.id, 'production');

      const tags = store.getTags(conv.id);
      expect(tags).toHaveLength(3);
      expect(tags).toContain('nginx');
      expect(tags).toContain('debugging');
      expect(tags).toContain('production');
    });

    it('should not duplicate tags', () => {
      const conv = store.createConversation('1111.0001', 'C123ABC', 'U456DEF', []);

      store.addTag(conv.id, 'important');
      store.addTag(conv.id, 'important');

      const tags = store.getTags(conv.id);
      expect(tags).toEqual(['important']);
    });

    it('should remove a tag from a conversation', () => {
      const conv = store.createConversation('1111.0001', 'C123ABC', 'U456DEF', []);

      store.addTag(conv.id, 'nginx');
      store.addTag(conv.id, 'debugging');
      store.removeTag(conv.id, 'nginx');

      const tags = store.getTags(conv.id);
      expect(tags).toEqual(['debugging']);
    });

    it('should return false when removing non-existent tag', () => {
      const conv = store.createConversation('1111.0001', 'C123ABC', 'U456DEF', []);

      const result = store.removeTag(conv.id, 'nonexistent');

      expect(result).toBe(false);
    });

    it('should return empty array for conversation with no tags', () => {
      const conv = store.createConversation('1111.0001', 'C123ABC', 'U456DEF', []);

      const tags = store.getTags(conv.id);

      expect(tags).toEqual([]);
    });

    it('should list conversations by tag', () => {
      const conv1 = store.createConversation('1111.0001', 'C123ABC', 'U456DEF', [
        { role: 'user', content: 'Hello' },
      ]);
      const conv2 = store.createConversation('2222.0002', 'C123ABC', 'U789GHI', [
        { role: 'user', content: 'World' },
      ]);
      store.createConversation('3333.0003', 'C123ABC', 'U456DEF', [
        { role: 'user', content: 'Other' },
      ]);

      store.addTag(conv1.id, 'nginx');
      store.addTag(conv2.id, 'nginx');

      const sessions = store.listSessionsByTag('nginx');

      expect(sessions).toHaveLength(2);
      const threadIds = sessions.map((s) => s.threadTs);
      expect(threadIds).toContain('1111.0001');
      expect(threadIds).toContain('2222.0002');
    });

    it('should list all unique tags', () => {
      const conv1 = store.createConversation('1111.0001', 'C123ABC', 'U456DEF', []);
      const conv2 = store.createConversation('2222.0002', 'C123ABC', 'U789GHI', []);

      store.addTag(conv1.id, 'nginx');
      store.addTag(conv1.id, 'debugging');
      store.addTag(conv2.id, 'nginx');
      store.addTag(conv2.id, 'production');

      const allTags = store.listAllTags();

      expect(allTags).toHaveLength(3);
      expect(allTags.map((t) => t.name)).toContain('nginx');
      expect(allTags.map((t) => t.name)).toContain('debugging');
      expect(allTags.map((t) => t.name)).toContain('production');
    });

    it('should include usage count in listAllTags', () => {
      const conv1 = store.createConversation('1111.0001', 'C123ABC', 'U456DEF', []);
      const conv2 = store.createConversation('2222.0002', 'C123ABC', 'U789GHI', []);

      store.addTag(conv1.id, 'nginx');
      store.addTag(conv2.id, 'nginx');
      store.addTag(conv1.id, 'rare');

      const allTags = store.listAllTags();

      const nginxTag = allTags.find((t) => t.name === 'nginx');
      const rareTag = allTags.find((t) => t.name === 'rare');
      expect(nginxTag?.count).toBe(2);
      expect(rareTag?.count).toBe(1);
    });

    it('should exclude archived conversations from listSessionsByTag', () => {
      const conv1 = store.createConversation('1111.0001', 'C123ABC', 'U456DEF', []);
      const conv2 = store.createConversation('2222.0002', 'C123ABC', 'U789GHI', []);

      store.addTag(conv1.id, 'nginx');
      store.addTag(conv2.id, 'nginx');

      // Archive one
      store.getDatabase().prepare('UPDATE conversations SET archived_at = ? WHERE id = ?')
        .run(Date.now(), conv1.id);

      const sessions = store.listSessionsByTag('nginx');
      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.threadTs).toBe('2222.0002');
    });

    it('should clean up tags when conversation is deleted', () => {
      const conv = store.createConversation('1111.0001', 'C123ABC', 'U456DEF', []);
      store.addTag(conv.id, 'test-tag');

      // Simulate hard delete (as done in cleanupExpired)
      store.getDatabase().prepare('DELETE FROM conversation_tags WHERE conversation_id = ?').run(conv.id);
      store.getDatabase().prepare('DELETE FROM conversations WHERE id = ?').run(conv.id);

      const allTags = store.listAllTags();
      expect(allTags).toHaveLength(0);
    });
  });

  describe('favorites', () => {
    it('should toggle favorite on a conversation', () => {
      const conv = store.createConversation('1111.0001', 'C123ABC', 'U456DEF', []);

      const result = store.toggleFavorite(conv.id);

      expect(result).toBe(true); // now favorited
    });

    it('should toggle favorite off', () => {
      const conv = store.createConversation('1111.0001', 'C123ABC', 'U456DEF', []);

      store.toggleFavorite(conv.id); // on
      const result = store.toggleFavorite(conv.id); // off

      expect(result).toBe(false); // now unfavorited
    });

    it('should check if a conversation is favorited', () => {
      const conv = store.createConversation('1111.0001', 'C123ABC', 'U456DEF', []);

      expect(store.isFavorited(conv.id)).toBe(false);

      store.toggleFavorite(conv.id);

      expect(store.isFavorited(conv.id)).toBe(true);
    });

    it('should list favorited sessions', () => {
      const conv1 = store.createConversation('1111.0001', 'C123ABC', 'U456DEF', [
        { role: 'user', content: 'Hello' },
      ]);
      store.createConversation('2222.0002', 'C123ABC', 'U789GHI', [
        { role: 'user', content: 'World' },
      ]);
      const conv3 = store.createConversation('3333.0003', 'C123ABC', 'U456DEF', [
        { role: 'user', content: 'Third' },
      ]);

      store.toggleFavorite(conv1.id);
      store.toggleFavorite(conv3.id);

      const favorites = store.listFavoriteSessions();

      expect(favorites).toHaveLength(2);
      const threadIds = favorites.map((f) => f.threadTs);
      expect(threadIds).toContain('1111.0001');
      expect(threadIds).toContain('3333.0003');
    });

    it('should count favorited sessions', () => {
      const conv1 = store.createConversation('1111.0001', 'C123ABC', 'U456DEF', []);
      const conv2 = store.createConversation('2222.0002', 'C123ABC', 'U789GHI', []);
      store.createConversation('3333.0003', 'C123ABC', 'U456DEF', []);

      store.toggleFavorite(conv1.id);
      store.toggleFavorite(conv2.id);

      expect(store.countFavoriteSessions()).toBe(2);
    });

    it('should support pagination for favorites', () => {
      for (let i = 1; i <= 5; i++) {
        const conv = store.createConversation(`${String(i)}000.000${String(i)}`, 'C123ABC', 'U456DEF', []);
        store.toggleFavorite(conv.id);
      }

      const page1 = store.listFavoriteSessions(2, 0);
      const page2 = store.listFavoriteSessions(2, 2);

      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(2);
    });

    it('should exclude archived conversations from favorites list', () => {
      const conv1 = store.createConversation('1111.0001', 'C123ABC', 'U456DEF', []);
      const conv2 = store.createConversation('2222.0002', 'C123ABC', 'U789GHI', []);

      store.toggleFavorite(conv1.id);
      store.toggleFavorite(conv2.id);

      // Archive one
      store.getDatabase().prepare('UPDATE conversations SET archived_at = ? WHERE id = ?')
        .run(Date.now(), conv1.id);

      const favorites = store.listFavoriteSessions();
      expect(favorites).toHaveLength(1);
      expect(favorites[0]?.threadTs).toBe('2222.0002');
    });

    it('should include favorite status in session summaries', () => {
      const conv1 = store.createConversation('1111.0001', 'C123ABC', 'U456DEF', []);
      store.createConversation('2222.0002', 'C123ABC', 'U789GHI', []);

      store.toggleFavorite(conv1.id);

      const sessions = store.listRecentSessions();

      const favSession = sessions.find((s) => s.threadTs === '1111.0001');
      const nonFavSession = sessions.find((s) => s.threadTs === '2222.0002');
      expect(favSession?.isFavorited).toBe(true);
      expect(nonFavSession?.isFavorited).toBe(false);
    });
  });

  describe('archiving', () => {
    it('listRecentSessions excludes archived conversations', () => {
      const conv = store.createConversation('1111.0001', 'C123ABC', 'U456DEF', []);
      store.createConversation('2222.0002', 'C123ABC', 'U789GHI', []);

      // Archive one
      store.getDatabase().prepare('UPDATE conversations SET archived_at = ? WHERE id = ?')
        .run(Date.now(), conv.id);

      const sessions = store.listRecentSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.threadTs).toBe('2222.0002');
    });

    it('listArchivedSessions returns only archived conversations', () => {
      const conv = store.createConversation('1111.0001', 'C123ABC', 'U456DEF', []);
      store.createConversation('2222.0002', 'C123ABC', 'U789GHI', []);

      // Archive one
      store.getDatabase().prepare('UPDATE conversations SET archived_at = ? WHERE id = ?')
        .run(Date.now(), conv.id);

      const archived = store.listArchivedSessions();
      expect(archived).toHaveLength(1);
      expect(archived[0]?.threadTs).toBe('1111.0001');
    });

    it('countArchivedSessions returns correct count', () => {
      const conv = store.createConversation('1111.0001', 'C123ABC', 'U456DEF', []);
      store.createConversation('2222.0002', 'C123ABC', 'U789GHI', []);

      expect(store.countArchivedSessions()).toBe(0);

      store.getDatabase().prepare('UPDATE conversations SET archived_at = ? WHERE id = ?')
        .run(Date.now(), conv.id);

      expect(store.countArchivedSessions()).toBe(1);
    });

    it('unarchiveConversation restores from archive', () => {
      const conv = store.createConversation('1111.0001', 'C123ABC', 'U456DEF', []);

      // Archive it
      store.getDatabase().prepare('UPDATE conversations SET archived_at = ? WHERE id = ?')
        .run(Date.now(), conv.id);
      expect(store.listRecentSessions()).toHaveLength(0);

      // Unarchive it
      const result = store.unarchiveConversation(conv.id);
      expect(result).toBe(true);
      expect(store.listRecentSessions()).toHaveLength(1);
    });

    it('unarchiveConversation returns false for non-archived conversation', () => {
      const conv = store.createConversation('1111.0001', 'C123ABC', 'U456DEF', []);

      const result = store.unarchiveConversation(conv.id);
      expect(result).toBe(false);
    });

    it('archiveExpired archives conversations past TTL', () => {
      // Create a store with 1 hour TTL
      const shortTtlStore = new ConversationStore(testDbPath, 1);

      // Create a conversation and backdate it
      shortTtlStore.createConversation('1111.0001', 'C123ABC', 'U456DEF', []);
      shortTtlStore.getDatabase().prepare('UPDATE conversations SET updated_at = ? WHERE thread_ts = ?')
        .run(Date.now() - 2 * 60 * 60 * 1000, '1111.0001'); // 2 hours ago

      // Create a recent one
      shortTtlStore.createConversation('2222.0002', 'C123ABC', 'U789GHI', []);

      const archived = shortTtlStore.archiveExpired();
      expect(archived).toBe(1);

      expect(shortTtlStore.listRecentSessions()).toHaveLength(1);
      expect(shortTtlStore.listArchivedSessions()).toHaveLength(1);
    });

    it('archiveConversation archives a single conversation', () => {
      const conv = store.createConversation('1111.0001', 'C123ABC', 'U456DEF', []);

      const result = store.archiveConversation(conv.id);
      expect(result).toBe(true);
      expect(store.listRecentSessions()).toHaveLength(0);
      expect(store.listArchivedSessions()).toHaveLength(1);
    });

    it('archiveConversation returns false for already-archived conversation', () => {
      const conv = store.createConversation('1111.0001', 'C123ABC', 'U456DEF', []);

      store.archiveConversation(conv.id);
      const result = store.archiveConversation(conv.id);
      expect(result).toBe(false);
    });

    it('cleanupExpired does two-phase: archive then hard-delete', () => {
      // Create a store with 1 hour TTL
      const shortTtlStore = new ConversationStore(testDbPath, 1);

      // Create a conversation that's already archived and past TTL
      shortTtlStore.createConversation('1111.0001', 'C123ABC', 'U456DEF', []);
      shortTtlStore.getDatabase().prepare('UPDATE conversations SET updated_at = ?, archived_at = ? WHERE thread_ts = ?')
        .run(Date.now() - 3 * 60 * 60 * 1000, Date.now() - 2 * 60 * 60 * 1000, '1111.0001');

      // Create a recent one
      shortTtlStore.createConversation('2222.0002', 'C123ABC', 'U789GHI', []);

      const cleaned = shortTtlStore.cleanupExpired();
      expect(cleaned).toBeGreaterThanOrEqual(1);

      // Archived conversation should be hard-deleted
      const conv = shortTtlStore.getConversation('1111.0001', 'C123ABC');
      expect(conv).toBeNull();

      // Recent one should still exist
      expect(shortTtlStore.getConversation('2222.0002', 'C123ABC')).not.toBeNull();
    });
  });

  describe('quick links', () => {
    it('should add a quick link for a user', () => {
      const link = store.addQuickLink('U123', 'Grafana', 'http://grafana.local:3000');

      expect(link.id).toBeDefined();
      expect(link.title).toBe('Grafana');
      expect(link.url).toBe('http://grafana.local:3000');
      expect(link.userId).toBe('U123');
    });

    it('should list quick links for a user', () => {
      store.addQuickLink('U123', 'Grafana', 'http://grafana.local:3000');
      store.addQuickLink('U123', 'Portainer', 'http://portainer.local:9000');
      store.addQuickLink('U999', 'Other', 'http://other.local');

      const links = store.getQuickLinks('U123');

      expect(links).toHaveLength(2);
      expect(links[0]?.title).toBe('Portainer'); // most recent first
      expect(links[1]?.title).toBe('Grafana');
    });

    it('should not duplicate quick links for same user and URL', () => {
      store.addQuickLink('U123', 'Grafana', 'http://grafana.local:3000');
      store.addQuickLink('U123', 'Grafana v2', 'http://grafana.local:3000');

      const links = store.getQuickLinks('U123');
      expect(links).toHaveLength(1);
    });

    it('should allow same URL for different users', () => {
      store.addQuickLink('U123', 'Grafana', 'http://grafana.local:3000');
      store.addQuickLink('U999', 'Grafana', 'http://grafana.local:3000');

      expect(store.getQuickLinks('U123')).toHaveLength(1);
      expect(store.getQuickLinks('U999')).toHaveLength(1);
    });

    it('should remove a quick link by id and user', () => {
      const link = store.addQuickLink('U123', 'Grafana', 'http://grafana.local:3000');

      const removed = store.removeQuickLink(link.id, 'U123');

      expect(removed).toBe(true);
      expect(store.getQuickLinks('U123')).toHaveLength(0);
    });

    it('should not remove another users quick link', () => {
      const link = store.addQuickLink('U123', 'Grafana', 'http://grafana.local:3000');

      const removed = store.removeQuickLink(link.id, 'U999');

      expect(removed).toBe(false);
      expect(store.getQuickLinks('U123')).toHaveLength(1);
    });

    it('should return false when removing non-existent quick link', () => {
      const removed = store.removeQuickLink(9999, 'U123');
      expect(removed).toBe(false);
    });

    it('should respect limit parameter', () => {
      store.addQuickLink('U123', 'Link 1', 'http://1.local');
      store.addQuickLink('U123', 'Link 2', 'http://2.local');
      store.addQuickLink('U123', 'Link 3', 'http://3.local');

      const links = store.getQuickLinks('U123', 2);
      expect(links).toHaveLength(2);
    });
  });
});

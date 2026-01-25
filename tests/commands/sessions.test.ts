import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock the config module before importing the command
vi.mock('../../src/config/index.js', () => ({
  config: {
    claude: {
      dbPath: '',
      conversationTtlHours: 24,
    },
  },
}));

// Mock the logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { type ConversationStore, getConversationStore, closeConversationStore } from '../../src/services/conversation-store.js';
import { config } from '../../src/config/index.js';

describe('SessionsCommand', () => {
  let testDbPath: string;
  let store: ConversationStore;

  beforeEach(() => {
    // Create a unique temp path for each test
    testDbPath = path.join(os.tmpdir(), `test-sessions-cmd-${Date.now()}.db`);
    // Update the mock config to use test db path
    (config.claude as { dbPath: string }).dbPath = testDbPath;
    store = getConversationStore(testDbPath, 24);
  });

  afterEach(() => {
    closeConversationStore();
    // Clean up test database
    try {
      fs.unlinkSync(testDbPath);
      fs.unlinkSync(testDbPath + '-wal');
      fs.unlinkSync(testDbPath + '-shm');
    } catch {
      // Files may not exist
    }
  });

  describe('/sessions (list)', () => {
    it('should return recent sessions ordered by updated_at desc', () => {
      // Create sessions
      store.createConversation('1111.0001', 'C123ABC', 'U456DEF', [{ role: 'user', content: 'First' }]);
      store.createConversation('2222.0002', 'C123ABC', 'U789GHI', [{ role: 'user', content: 'Second' }]);
      store.createConversation('3333.0003', 'C123ABC', 'U456DEF', [{ role: 'user', content: 'Third' }]);

      const sessions = store.listRecentSessions();

      expect(sessions).toHaveLength(3);
      expect(sessions[0]?.threadTs).toBe('3333.0003');
    });

    it('should show session metrics (messages, tools)', () => {
      const conv = store.createConversation('1234.5678', 'C123ABC', 'U456DEF', [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' },
      ]);
      store.logToolCall(conv.id, 'get_container_status', { name: 'nginx' }, 'running');
      store.logToolCall(conv.id, 'get_container_logs', { name: 'nginx' }, 'logs');

      const sessions = store.listRecentSessions();

      expect(sessions[0]?.messageCount).toBe(2);
      expect(sessions[0]?.toolCallCount).toBe(2);
    });

    it('should indicate active vs idle sessions', () => {
      // Just-created session should be active
      store.createConversation('1234.5678', 'C123ABC', 'U456DEF', []);

      const sessions = store.listRecentSessions();

      expect(sessions[0]?.isActive).toBe(true);
    });

    it('should return empty array when no sessions', () => {
      const sessions = store.listRecentSessions();
      expect(sessions).toHaveLength(0);
    });
  });

  describe('/sessions mine', () => {
    it('should filter to current user sessions only', () => {
      store.createConversation('1111.0001', 'C123ABC', 'U456DEF', []);
      store.createConversation('2222.0002', 'C123ABC', 'U789GHI', []);
      store.createConversation('3333.0003', 'C123ABC', 'U456DEF', []);

      const sessions = store.listRecentSessions(20, 'U456DEF');

      expect(sessions).toHaveLength(2);
      expect(sessions.every((s) => s.userId === 'U456DEF')).toBe(true);
    });
  });

  describe('/sessions <thread_ts>', () => {
    it('should return detailed session view', () => {
      const conv = store.createConversation('1234.5678', 'C123ABC', 'U456DEF', [
        { role: 'user', content: 'Check nginx' },
      ]);
      store.logToolCall(conv.id, 'get_container_status', { container_name: 'nginx' }, 'running');

      const detail = store.getSessionDetail('1234.5678', 'C123ABC');

      expect(detail).not.toBeNull();
      expect(detail?.threadTs).toBe('1234.5678');
      expect(detail?.channelId).toBe('C123ABC');
      expect(detail?.userId).toBe('U456DEF');
      expect(detail?.messageCount).toBe(1);
      expect(detail?.toolCallCount).toBe(1);
    });

    it('should show recent tool calls', () => {
      const conv = store.createConversation('1234.5678', 'C123ABC', 'U456DEF', []);
      store.logToolCall(conv.id, 'tool1', { arg: 'val1' }, 'out1');
      store.logToolCall(conv.id, 'tool2', { arg: 'val2' }, 'out2');
      store.logToolCall(conv.id, 'tool3', { arg: 'val3' }, 'out3');

      const detail = store.getSessionDetail('1234.5678', 'C123ABC');

      expect(detail?.recentToolCalls).toHaveLength(3);
      // Most recent first
      expect(detail?.recentToolCalls[0]?.toolName).toBe('tool3');
    });

    it('should return null for non-existent session', () => {
      const detail = store.getSessionDetail('nonexistent', 'C123ABC');
      expect(detail).toBeNull();
    });
  });

  describe('/sessions stats', () => {
    it('should show aggregate statistics', () => {
      const conv1 = store.createConversation('1111.0001', 'C123ABC', 'U456DEF', [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' },
      ]);
      store.logToolCall(conv1.id, 'get_container_status', {}, 'out');

      const conv2 = store.createConversation('2222.0002', 'C123ABC', 'U789GHI', [
        { role: 'user', content: 'Status?' },
      ]);
      store.logToolCall(conv2.id, 'get_container_logs', {}, 'out');
      store.logToolCall(conv2.id, 'get_system_resources', {}, 'out');

      const stats = store.getSessionStats();

      expect(stats.totalSessions).toBe(2);
      expect(stats.activeSessions).toBe(2);
      expect(stats.totalMessages).toBe(3);
      expect(stats.totalToolCalls).toBe(3);
    });

    it('should list top tools used', () => {
      const conv = store.createConversation('1234.5678', 'C123ABC', 'U456DEF', []);
      store.logToolCall(conv.id, 'get_container_logs', {}, 'out');
      store.logToolCall(conv.id, 'get_container_logs', {}, 'out');
      store.logToolCall(conv.id, 'get_container_logs', {}, 'out');
      store.logToolCall(conv.id, 'get_container_status', {}, 'out');
      store.logToolCall(conv.id, 'run_command', {}, 'out');

      const stats = store.getSessionStats();

      expect(stats.topTools).toHaveLength(3);
      expect(stats.topTools[0]?.name).toBe('get_container_logs');
      expect(stats.topTools[0]?.count).toBe(3);
    });
  });
});

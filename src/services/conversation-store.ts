import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { logger } from '../utils/logger.js';

/**
 * Safely truncate a string without splitting multi-byte UTF-8 characters
 */
function truncateUTF8Safe(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str;
  }

  // Use Array.from to properly handle Unicode code points
  const chars = Array.from(str);
  if (chars.length <= maxLength) {
    return str;
  }

  return chars.slice(0, maxLength).join('');
}

/**
 * Message in a conversation
 */
export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Stored conversation record
 */
export interface Conversation {
  id: number;
  threadTs: string;
  channelId: string;
  userId: string;
  messages: ConversationMessage[];
  createdAt: number;
  updatedAt: number;
}

/**
 * Tool call audit log entry
 */
export interface ToolCallLog {
  id?: number;
  conversationId: number;
  toolName: string;
  input: Record<string, unknown>;
  outputPreview: string;
  timestamp: number;
}

/**
 * Summary of a session for list views
 */
export interface SessionSummary {
  id: number;
  threadTs: string;
  channelId: string;
  userId: string;
  messageCount: number;
  toolCallCount: number;
  createdAt: number;
  updatedAt: number;
  isActive: boolean; // updatedAt within last 5 minutes
}

/**
 * Detailed view of a session
 */
export interface SessionDetail extends SessionSummary {
  recentToolCalls: ToolCallLog[];
}

/**
 * Aggregate statistics across sessions
 */
export interface SessionStats {
  totalSessions: number;
  activeSessions: number;
  totalMessages: number;
  totalToolCalls: number;
  topTools: { name: string; count: number }[];
}

/**
 * SQLite-based conversation store
 */
export class ConversationStore {
  private db: Database.Database;
  private ttlHours: number;

  /** A session is considered "active" if updated within this time */
  private static readonly ACTIVE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

  constructor(dbPath: string, ttlHours = 24) {
    this.ttlHours = ttlHours;

    // Ensure directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initSchema();
  }

  /**
   * Initialize database schema
   */
  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_ts TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        messages TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(thread_ts, channel_id)
      );

      CREATE TABLE IF NOT EXISTS tool_calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER REFERENCES conversations(id),
        tool_name TEXT NOT NULL,
        input TEXT NOT NULL,
        output_preview TEXT,
        timestamp INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_conversations_thread
        ON conversations(thread_ts, channel_id);
      CREATE INDEX IF NOT EXISTS idx_conversations_updated
        ON conversations(updated_at);
      CREATE INDEX IF NOT EXISTS idx_tool_calls_conversation
        ON tool_calls(conversation_id);
    `);

    logger.debug('Conversation store schema initialized');
  }

  /**
   * Get or create a conversation for a thread
   */
  getConversation(threadTs: string, channelId: string): Conversation | null {
    const row = this.db
      .prepare('SELECT * FROM conversations WHERE thread_ts = ? AND channel_id = ?')
      .get(threadTs, channelId) as {
        id: number;
        thread_ts: string;
        channel_id: string;
        user_id: string;
        messages: string;
        created_at: number;
        updated_at: number;
      } | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      threadTs: row.thread_ts,
      channelId: row.channel_id,
      userId: row.user_id,
      messages: JSON.parse(row.messages) as ConversationMessage[],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Create a new conversation
   */
  createConversation(
    threadTs: string,
    channelId: string,
    userId: string,
    messages: ConversationMessage[] = []
  ): Conversation {
    const now = Date.now();
    const messagesJson = JSON.stringify(messages);

    const result = this.db
      .prepare(`
        INSERT INTO conversations (thread_ts, channel_id, user_id, messages, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(threadTs, channelId, userId, messagesJson, now, now);

    return {
      id: result.lastInsertRowid as number,
      threadTs,
      channelId,
      userId,
      messages,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Update conversation messages
   */
  updateConversation(id: number, messages: ConversationMessage[]): void {
    const now = Date.now();
    const messagesJson = JSON.stringify(messages);

    this.db
      .prepare('UPDATE conversations SET messages = ?, updated_at = ? WHERE id = ?')
      .run(messagesJson, now, id);
  }

  /**
   * Get or create conversation, adding initial user message if new
   */
  getOrCreateConversation(
    threadTs: string,
    channelId: string,
    userId: string,
    userMessage?: string
  ): Conversation {
    let conversation = this.getConversation(threadTs, channelId);

    if (!conversation) {
      const initialMessages: ConversationMessage[] = userMessage
        ? [{ role: 'user', content: userMessage }]
        : [];
      conversation = this.createConversation(threadTs, channelId, userId, initialMessages);
    } else if (userMessage) {
      conversation.messages.push({ role: 'user', content: userMessage });
      this.updateConversation(conversation.id, conversation.messages);
    }

    return conversation;
  }

  /**
   * Add assistant response to conversation
   */
  addAssistantMessage(conversationId: number, content: string): void {
    const conversation = this.getConversationById(conversationId);
    if (conversation) {
      conversation.messages.push({ role: 'assistant', content });
      this.updateConversation(conversationId, conversation.messages);
    }
  }

  /**
   * Get conversation by ID
   */
  private getConversationById(id: number): Conversation | null {
    const row = this.db
      .prepare('SELECT * FROM conversations WHERE id = ?')
      .get(id) as {
        id: number;
        thread_ts: string;
        channel_id: string;
        user_id: string;
        messages: string;
        created_at: number;
        updated_at: number;
      } | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      threadTs: row.thread_ts,
      channelId: row.channel_id,
      userId: row.user_id,
      messages: JSON.parse(row.messages) as ConversationMessage[],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Log a tool call for audit
   */
  logToolCall(
    conversationId: number,
    toolName: string,
    input: Record<string, unknown>,
    outputPreview: string
  ): void {
    const now = Date.now();
    // Safely truncate to avoid splitting multi-byte UTF-8 characters
    const truncated = truncateUTF8Safe(outputPreview, 200);
    this.db
      .prepare(`
        INSERT INTO tool_calls (conversation_id, tool_name, input, output_preview, timestamp)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(conversationId, toolName, JSON.stringify(input), truncated, now);
  }

  /**
   * Clean up expired conversations
   */
  cleanupExpired(): number {
    const cutoff = Date.now() - this.ttlHours * 60 * 60 * 1000;

    // Delete tool calls for expired conversations
    this.db
      .prepare(`
        DELETE FROM tool_calls
        WHERE conversation_id IN (
          SELECT id FROM conversations WHERE updated_at < ?
        )
      `)
      .run(cutoff);

    // Delete expired conversations
    const result = this.db
      .prepare('DELETE FROM conversations WHERE updated_at < ?')
      .run(cutoff);

    if (result.changes > 0) {
      logger.info('Cleaned up expired conversations', { count: result.changes });
    }

    return result.changes;
  }

  /**
   * List recent sessions with metrics
   *
   * @param limit - Maximum number of sessions to return (default: 20)
   * @param userId - Filter to sessions started by this user (optional)
   */
  listRecentSessions(limit = 20, userId?: string): SessionSummary[] {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000; // Last 24 hours
    const activeThreshold = Date.now() - ConversationStore.ACTIVE_THRESHOLD_MS;

    // Use LEFT JOIN instead of correlated subquery to avoid N+1 queries
    const rows = this.db
      .prepare(`
        SELECT
          c.id, c.thread_ts, c.channel_id, c.user_id,
          c.messages, c.created_at, c.updated_at,
          COUNT(tc.id) as tool_call_count
        FROM conversations c
        LEFT JOIN tool_calls tc ON tc.conversation_id = c.id
        WHERE ($userId IS NULL OR c.user_id = $userId)
          AND c.updated_at > $cutoff
        GROUP BY c.id
        ORDER BY c.updated_at DESC, c.id DESC
        LIMIT $limit
      `)
      .all({
        userId: userId ?? null,
        cutoff,
        limit,
      }) as {
        id: number;
        thread_ts: string;
        channel_id: string;
        user_id: string;
        messages: string;
        created_at: number;
        updated_at: number;
        tool_call_count: number;
      }[];

    return rows.map((row) => {
      const messages = JSON.parse(row.messages) as ConversationMessage[];
      return {
        id: row.id,
        threadTs: row.thread_ts,
        channelId: row.channel_id,
        userId: row.user_id,
        messageCount: messages.length,
        toolCallCount: row.tool_call_count,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        isActive: row.updated_at > activeThreshold,
      };
    });
  }

  /**
   * Get detailed view of a session
   *
   * @param threadTs - Thread timestamp
   * @param channelId - Channel ID
   */
  getSessionDetail(threadTs: string, channelId: string): SessionDetail | null {
    const conversation = this.getConversation(threadTs, channelId);
    if (!conversation) {
      return null;
    }

    const activeThreshold = Date.now() - ConversationStore.ACTIVE_THRESHOLD_MS;
    const toolCalls = this.getToolCalls(conversation.id, 10);

    // Get tool call count
    const countRow = this.db
      .prepare('SELECT COUNT(*) as count FROM tool_calls WHERE conversation_id = ?')
      .get(conversation.id) as { count: number };

    return {
      id: conversation.id,
      threadTs: conversation.threadTs,
      channelId: conversation.channelId,
      userId: conversation.userId,
      messageCount: conversation.messages.length,
      toolCallCount: countRow.count,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      isActive: conversation.updatedAt > activeThreshold,
      recentToolCalls: toolCalls,
    };
  }

  /**
   * Get aggregate statistics across sessions
   *
   * @param hours - Time window in hours (default: 24)
   */
  getSessionStats(hours = 24): SessionStats {
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    const activeThreshold = Date.now() - ConversationStore.ACTIVE_THRESHOLD_MS;

    // Get session counts and message totals
    const sessionStats = this.db
      .prepare(`
        SELECT
          COUNT(*) as total_sessions,
          SUM(CASE WHEN updated_at > ? THEN 1 ELSE 0 END) as active_sessions
        FROM conversations
        WHERE updated_at > ?
      `)
      .get(activeThreshold, cutoff) as {
        total_sessions: number;
        active_sessions: number;
      };

    // Get total messages using SQLite's json_array_length (avoids fetching full JSON blobs)
    const messageStats = this.db
      .prepare(`
        SELECT COALESCE(SUM(json_array_length(messages)), 0) as total_messages
        FROM conversations
        WHERE updated_at > ?
      `)
      .get(cutoff) as { total_messages: number };

    const totalMessages = messageStats.total_messages;

    // Get tool call count
    const toolCallStats = this.db
      .prepare(`
        SELECT COUNT(*) as count
        FROM tool_calls tc
        INNER JOIN conversations c ON tc.conversation_id = c.id
        WHERE c.updated_at > ?
      `)
      .get(cutoff) as { count: number };

    // Get top tools
    const topToolsRows = this.db
      .prepare(`
        SELECT tool_name as name, COUNT(*) as count
        FROM tool_calls tc
        INNER JOIN conversations c ON tc.conversation_id = c.id
        WHERE c.updated_at > ?
        GROUP BY tool_name
        ORDER BY count DESC
        LIMIT 5
      `)
      .all(cutoff) as { name: string; count: number }[];

    return {
      totalSessions: sessionStats.total_sessions,
      activeSessions: sessionStats.active_sessions,
      totalMessages,
      totalToolCalls: toolCallStats.count,
      topTools: topToolsRows,
    };
  }

  /**
   * Get tool calls for a conversation
   *
   * @param conversationId - Conversation ID
   * @param limit - Maximum number of tool calls (default: all)
   */
  getToolCalls(conversationId: number, limit?: number): ToolCallLog[] {
    const query = limit
      ? 'SELECT * FROM tool_calls WHERE conversation_id = ? ORDER BY timestamp DESC, id DESC LIMIT ?'
      : 'SELECT * FROM tool_calls WHERE conversation_id = ? ORDER BY timestamp DESC, id DESC';

    const params = limit ? [conversationId, limit] : [conversationId];

    const rows = this.db.prepare(query).all(...params) as {
      id: number;
      conversation_id: number;
      tool_name: string;
      input: string;
      output_preview: string;
      timestamp: number;
    }[];

    return rows.map((row) => ({
      id: row.id,
      conversationId: row.conversation_id,
      toolName: row.tool_name,
      input: JSON.parse(row.input) as Record<string, unknown>,
      outputPreview: row.output_preview,
      timestamp: row.timestamp,
    }));
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }
}

// Singleton instance - lazily initialized
let store: ConversationStore | null = null;

/**
 * Get the conversation store singleton
 */
export function getConversationStore(dbPath: string, ttlHours = 24): ConversationStore {
  store ??= new ConversationStore(dbPath, ttlHours);
  return store;
}

/**
 * Close the conversation store
 */
export function closeConversationStore(): void {
  if (store) {
    store.close();
    store = null;
  }
}

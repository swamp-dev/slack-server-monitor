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
 * Token usage for a day
 */
export interface TokenUsage {
  date: string;
  tokensUsed: number;
}

/**
 * SQLite-based conversation store
 */
export class ConversationStore {
  private db: Database.Database;
  private ttlHours: number;

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

      CREATE TABLE IF NOT EXISTS token_usage (
        date TEXT PRIMARY KEY,
        tokens_used INTEGER NOT NULL
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
   * Get today's token usage
   */
  getTodayTokenUsage(): number {
    const today = new Date().toISOString().split('T')[0];
    const row = this.db
      .prepare('SELECT tokens_used FROM token_usage WHERE date = ?')
      .get(today) as { tokens_used: number } | undefined;

    return row?.tokens_used ?? 0;
  }

  /**
   * Add tokens to today's usage
   */
  addTokenUsage(tokens: number): void {
    const today = new Date().toISOString().split('T')[0];

    this.db
      .prepare(`
        INSERT INTO token_usage (date, tokens_used)
        VALUES (?, ?)
        ON CONFLICT(date) DO UPDATE SET tokens_used = tokens_used + ?
      `)
      .run(today, tokens, tokens);
  }

  /**
   * Check if daily token budget is exceeded
   */
  isDailyBudgetExceeded(dailyLimit: number): boolean {
    return this.getTodayTokenUsage() >= dailyLimit;
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

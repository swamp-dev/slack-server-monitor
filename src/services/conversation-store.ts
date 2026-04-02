import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
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
  timestamp?: number;
}

/**
 * Context window status stored per conversation
 */
export interface StoredContextStatus {
  percentUsed: number;
  wasTruncated: boolean;
  removedCount: number;
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
  archivedAt: number | null;
  favoritedAt: number | null;
  contextStatus: StoredContextStatus | null;
  parentConversationId: number | null;
  branchPointIndex: number | null;
}

/**
 * Pagination metadata
 */
export interface PaginationInfo {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
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
  durationMs: number | null;
  success: boolean;
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
  archivedAt: number | null;
  isActive: boolean; // updatedAt within last 5 minutes
  isFavorited: boolean;
  tags?: string[];
  firstMessage?: string;
}

/**
 * Tag with usage count
 */
export interface TagInfo {
  name: string;
  count: number;
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
  avgToolDurationMs: number | null;
  toolFailureRate: number;
  topTools: { name: string; count: number; avgDurationMs: number | null }[];
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
        timestamp INTEGER NOT NULL,
        duration_ms INTEGER,
        success INTEGER NOT NULL DEFAULT 1
      );

      CREATE INDEX IF NOT EXISTS idx_conversations_thread
        ON conversations(thread_ts, channel_id);
      CREATE INDEX IF NOT EXISTS idx_conversations_updated
        ON conversations(updated_at);
      CREATE INDEX IF NOT EXISTS idx_tool_calls_conversation
        ON tool_calls(conversation_id);

      CREATE TABLE IF NOT EXISTS conversation_tags (
        conversation_id INTEGER NOT NULL REFERENCES conversations(id),
        tag TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (conversation_id, tag)
      );

      CREATE INDEX IF NOT EXISTS idx_conversation_tags_tag
        ON conversation_tags(tag);
    `);

    // Migrate: add duration_ms and success columns if missing
    const toolColumns = this.db
      .prepare("PRAGMA table_info(tool_calls)")
      .all() as { name: string }[];
    const toolColumnNames = new Set(toolColumns.map((c) => c.name));
    if (!toolColumnNames.has('duration_ms')) {
      this.db.exec('ALTER TABLE tool_calls ADD COLUMN duration_ms INTEGER');
    }
    if (!toolColumnNames.has('success')) {
      this.db.exec('ALTER TABLE tool_calls ADD COLUMN success INTEGER NOT NULL DEFAULT 1');
    }

    // Migrate: add archived_at column if missing
    const convColumns = this.db
      .prepare("PRAGMA table_info(conversations)")
      .all() as { name: string }[];
    const convColumnNames = new Set(convColumns.map((c) => c.name));
    if (!convColumnNames.has('archived_at')) {
      this.db.exec('ALTER TABLE conversations ADD COLUMN archived_at INTEGER');
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_conversations_archived ON conversations(archived_at)');
    }

    // Migrate: add favorited_at column if missing
    if (!convColumnNames.has('favorited_at')) {
      this.db.exec('ALTER TABLE conversations ADD COLUMN favorited_at INTEGER');
    }

    // Migrate: add context_status column for context window tracking
    if (!convColumnNames.has('context_status')) {
      this.db.exec('ALTER TABLE conversations ADD COLUMN context_status TEXT');
    }

    // Migrate: add parent_conversation_id and branch_point_index for conversation branching
    if (!convColumnNames.has('parent_conversation_id')) {
      this.db.exec('ALTER TABLE conversations ADD COLUMN parent_conversation_id INTEGER REFERENCES conversations(id)');
    }
    if (!convColumnNames.has('branch_point_index')) {
      this.db.exec('ALTER TABLE conversations ADD COLUMN branch_point_index INTEGER');
    }

    // Migrate: create FTS5 virtual table for full-text search
    const ftsExists = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='conversations_fts'")
      .get() as { name: string } | undefined;

    if (!ftsExists) {
      this.db.exec(`
        CREATE VIRTUAL TABLE conversations_fts USING fts5(
          messages_text,
          content='',
          tokenize='unicode61'
        );
      `);
      // Populate FTS index from existing conversations
      const existing = this.db
        .prepare('SELECT id, messages FROM conversations')
        .all() as { id: number; messages: string }[];
      const insertFts = this.db.prepare('INSERT INTO conversations_fts(rowid, messages_text) VALUES (?, ?)');
      for (const row of existing) {
        const text = this.extractTextFromMessages(row.messages);
        insertFts.run(row.id, text);
      }
    }

    logger.debug('Conversation store schema initialized');
  }

  /**
   * Parse a database row into a Conversation object
   */
  private rowToConversation(row: {
    id: number;
    thread_ts: string;
    channel_id: string;
    user_id: string;
    messages: string;
    created_at: number;
    updated_at: number;
    archived_at: number | null;
    favorited_at: number | null;
    context_status?: string | null;
    parent_conversation_id?: number | null;
    branch_point_index?: number | null;
  }): Conversation {
    let contextStatus: StoredContextStatus | null = null;
    if (row.context_status) {
      try {
        contextStatus = JSON.parse(row.context_status) as StoredContextStatus;
      } catch {
        contextStatus = null;
      }
    }
    return {
      id: row.id,
      threadTs: row.thread_ts,
      channelId: row.channel_id,
      userId: row.user_id,
      messages: JSON.parse(row.messages) as ConversationMessage[],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      archivedAt: row.archived_at,
      favoritedAt: row.favorited_at,
      contextStatus,
      parentConversationId: row.parent_conversation_id ?? null,
      branchPointIndex: row.branch_point_index ?? null,
    };
  }

  /**
   * Extract plain text from messages JSON for FTS indexing
   */
  private extractTextFromMessages(messagesJson: string): string {
    try {
      const messages = JSON.parse(messagesJson) as ConversationMessage[];
      return messages.map((m) => m.content).join(' ');
    } catch {
      return '';
    }
  }

  /**
   * Get or create a conversation for a thread
   */
  getConversation(threadTs: string, channelId: string): Conversation | null {
    const row = this.db
      .prepare('SELECT * FROM conversations WHERE thread_ts = ? AND channel_id = ?')
      .get(threadTs, channelId) as Record<string, unknown> | undefined;

    if (!row) {
      return null;
    }

    return this.rowToConversation(row as Parameters<typeof this.rowToConversation>[0]);
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

    const id = result.lastInsertRowid as number;

    // Update FTS index
    const text = this.extractTextFromMessages(messagesJson);
    this.db.prepare('INSERT INTO conversations_fts(rowid, messages_text) VALUES (?, ?)').run(id, text);

    return {
      id,
      threadTs,
      channelId,
      userId,
      messages,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      favoritedAt: null,
      contextStatus: null,
      parentConversationId: null,
      branchPointIndex: null,
    };
  }

  /**
   * Update conversation messages
   */
  updateConversation(id: number, messages: ConversationMessage[]): void {
    const now = Date.now();
    const messagesJson = JSON.stringify(messages);
    const text = this.extractTextFromMessages(messagesJson);

    this.db.transaction(() => {
      this.db
        .prepare('UPDATE conversations SET messages = ?, updated_at = ? WHERE id = ?')
        .run(messagesJson, now, id);
      this.db.prepare("INSERT INTO conversations_fts(conversations_fts, rowid, messages_text) VALUES('delete', ?, '')").run(id);
      this.db.prepare('INSERT INTO conversations_fts(rowid, messages_text) VALUES (?, ?)').run(id, text);
    })();
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
        ? [{ role: 'user', content: userMessage, timestamp: Date.now() }]
        : [];
      conversation = this.createConversation(threadTs, channelId, userId, initialMessages);
    } else if (userMessage) {
      conversation.messages.push({ role: 'user', content: userMessage, timestamp: Date.now() });
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
      conversation.messages.push({ role: 'assistant', content, timestamp: Date.now() });
      this.updateConversation(conversationId, conversation.messages);
    }
  }

  /**
   * Get conversation by thread_ts only (scans all channels)
   */
  getConversationByThreadTs(threadTs: string): Conversation | null {
    const row = this.db
      .prepare('SELECT * FROM conversations WHERE thread_ts = ? ORDER BY updated_at DESC LIMIT 1')
      .get(threadTs) as Record<string, unknown> | undefined;

    if (!row) {
      return null;
    }

    return this.rowToConversation(row as Parameters<typeof this.rowToConversation>[0]);
  }

  /**
   * Get conversation by ID
   */
  getConversationById(id: number): Conversation | null {
    const row = this.db
      .prepare('SELECT * FROM conversations WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;

    if (!row) {
      return null;
    }

    return this.rowToConversation(row as Parameters<typeof this.rowToConversation>[0]);
  }

  /**
   * Update the context window status for a conversation
   */
  updateContextStatus(conversationId: number, status: StoredContextStatus): void {
    this.db
      .prepare('UPDATE conversations SET context_status = ? WHERE id = ?')
      .run(JSON.stringify(status), conversationId);
  }

  /**
   * Branch a conversation: create a new conversation with messages up to branchPointIndex
   */
  branchConversation(
    parentId: number,
    branchPointIndex: number,
    userId: string
  ): Conversation {
    const parent = this.getConversationById(parentId);
    if (!parent) {
      throw new Error(`Parent conversation ${String(parentId)} not found`);
    }
    if (branchPointIndex < 0 || branchPointIndex >= parent.messages.length) {
      throw new Error(`Branch point index ${String(branchPointIndex)} out of range (0-${String(parent.messages.length - 1)})`);
    }

    // Copy messages up to and including the branch point
    const branchedMessages = parent.messages.slice(0, branchPointIndex + 1);
    const now = Date.now();
    const branchTs = `branch-${String(now)}-${randomBytes(6).toString('hex')}`;
    const messagesJson = JSON.stringify(branchedMessages);

    const { id } = this.db.transaction(() => {
      const result = this.db
        .prepare(`
          INSERT INTO conversations (thread_ts, channel_id, user_id, messages, created_at, updated_at, parent_conversation_id, branch_point_index)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(branchTs, parent.channelId, userId, messagesJson, now, now, parentId, branchPointIndex);

      const insertedId = result.lastInsertRowid as number;

      // Update FTS index
      const text = this.extractTextFromMessages(messagesJson);
      this.db.prepare('INSERT INTO conversations_fts(rowid, messages_text) VALUES (?, ?)').run(insertedId, text);

      return { id: insertedId };
    })();

    return {
      id,
      threadTs: branchTs,
      channelId: parent.channelId,
      userId,
      messages: branchedMessages,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      favoritedAt: null,
      contextStatus: null,
      parentConversationId: parentId,
      branchPointIndex: branchPointIndex,
    };
  }

  /**
   * List branches of a conversation
   */
  listBranches(parentId: number): Conversation[] {
    const rows = this.db
      .prepare('SELECT * FROM conversations WHERE parent_conversation_id = ? ORDER BY created_at DESC')
      .all(parentId) as Record<string, unknown>[];

    return rows.map((row) => this.rowToConversation(row as Parameters<typeof this.rowToConversation>[0]));
  }

  /**
   * Log a tool call for audit
   */
  logToolCall(
    conversationId: number,
    toolName: string,
    input: Record<string, unknown>,
    outputPreview: string,
    analytics?: { durationMs?: number; success?: boolean }
  ): void {
    const now = Date.now();
    // Safely truncate to avoid splitting multi-byte UTF-8 characters
    const truncated = truncateUTF8Safe(outputPreview, 200);
    const durationMs = analytics?.durationMs ?? null;
    const success = analytics?.success !== false ? 1 : 0;
    this.db
      .prepare(`
        INSERT INTO tool_calls (conversation_id, tool_name, input, output_preview, timestamp, duration_ms, success)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(conversationId, toolName, JSON.stringify(input), truncated, now, durationMs, success);
  }

  /**
   * Clean up expired conversations (two-phase: archive then hard-delete)
   *
   * Phase 1: Archive active conversations past TTL (soft-delete)
   * Phase 2: Hard-delete conversations archived for longer than TTL
   */
  cleanupExpired(): number {
    const cutoff = Date.now() - this.ttlHours * 60 * 60 * 1000;

    // Phase 1: Archive expired active conversations
    const archived = this.archiveExpired();

    // Phase 2: Hard-delete conversations that have been archived past TTL
    const archiveCutoff = cutoff;
    const deleteArchived = this.db.transaction(() => {
      // Collect IDs for FTS cleanup
      const idsToDelete = this.db
        .prepare('SELECT id FROM conversations WHERE archived_at IS NOT NULL AND archived_at < ?')
        .all(archiveCutoff) as { id: number }[];

      // Clean up FTS index entries
      for (const { id } of idsToDelete) {
        this.db.prepare("INSERT INTO conversations_fts(conversations_fts, rowid, messages_text) VALUES('delete', ?, '')").run(id);
      }

      // Clean up tags
      this.db.prepare(`
        DELETE FROM conversation_tags WHERE conversation_id IN (
          SELECT id FROM conversations WHERE archived_at IS NOT NULL AND archived_at < ?
        )
      `).run(archiveCutoff);

      // Clean up tool calls
      this.db.prepare(`
        DELETE FROM tool_calls WHERE conversation_id IN (
          SELECT id FROM conversations WHERE archived_at IS NOT NULL AND archived_at < ?
        )
      `).run(archiveCutoff);

      return this.db.prepare('DELETE FROM conversations WHERE archived_at IS NOT NULL AND archived_at < ?')
        .run(archiveCutoff);
    });
    const result = deleteArchived();

    if (result.changes > 0) {
      logger.info('Hard-deleted archived conversations', { count: result.changes });
    }

    return archived + result.changes;
  }

  /**
   * Archive expired conversations (soft-delete)
   * Sets archived_at = now for active conversations past TTL
   */
  archiveExpired(): number {
    const cutoff = Date.now() - this.ttlHours * 60 * 60 * 1000;
    const now = Date.now();

    const result = this.db
      .prepare('UPDATE conversations SET archived_at = ? WHERE archived_at IS NULL AND updated_at < ?')
      .run(now, cutoff);

    if (result.changes > 0) {
      logger.info('Archived expired conversations', { count: result.changes });
    }

    return result.changes;
  }

  /**
   * Archive a single conversation (soft-delete)
   */
  archiveConversation(id: number): boolean {
    const now = Date.now();
    const result = this.db
      .prepare('UPDATE conversations SET archived_at = ? WHERE id = ? AND archived_at IS NULL')
      .run(now, id);
    return result.changes > 0;
  }

  /**
   * Unarchive a conversation (restore from archive)
   */
  unarchiveConversation(id: number): boolean {
    const result = this.db
      .prepare('UPDATE conversations SET archived_at = NULL WHERE id = ? AND archived_at IS NOT NULL')
      .run(id);
    return result.changes > 0;
  }

  /**
   * List recent sessions with metrics (excludes archived)
   *
   * @param limit - Maximum number of sessions to return (default: 20)
   * @param offset - Number of sessions to skip (default: 0)
   * @param userId - Filter to sessions started by this user (optional)
   */
  listRecentSessions(limit = 20, offset = 0, userId?: string): SessionSummary[] {
    const activeThreshold = Date.now() - ConversationStore.ACTIVE_THRESHOLD_MS;

    const rows = this.db
      .prepare(`
        SELECT
          c.id, c.thread_ts, c.channel_id, c.user_id,
          c.messages, c.created_at, c.updated_at, c.archived_at, c.favorited_at,
          COUNT(tc.id) as tool_call_count
        FROM conversations c
        LEFT JOIN tool_calls tc ON tc.conversation_id = c.id
        WHERE ($userId IS NULL OR c.user_id = $userId)
          AND c.archived_at IS NULL
        GROUP BY c.id
        ORDER BY c.updated_at DESC, c.id DESC
        LIMIT $limit OFFSET $offset
      `)
      .all({
        userId: userId ?? null,
        limit,
        offset,
      }) as {
        id: number;
        thread_ts: string;
        channel_id: string;
        user_id: string;
        messages: string;
        created_at: number;
        updated_at: number;
        archived_at: number | null;
        favorited_at: number | null;
        tool_call_count: number;
      }[];

    return rows.map((row) => this.toSessionSummary(row, activeThreshold));
  }

  /**
   * Count total sessions (excludes archived)
   */
  countSessions(userId?: string): number {
    const row = this.db
      .prepare(`
        SELECT COUNT(*) as count FROM conversations
        WHERE ($userId IS NULL OR user_id = $userId)
          AND archived_at IS NULL
      `)
      .get({ userId: userId ?? null }) as { count: number };
    return row.count;
  }

  /**
   * List archived sessions with pagination
   */
  listArchivedSessions(limit = 20, offset = 0): SessionSummary[] {
    const activeThreshold = Date.now() - ConversationStore.ACTIVE_THRESHOLD_MS;

    const rows = this.db
      .prepare(`
        SELECT
          c.id, c.thread_ts, c.channel_id, c.user_id,
          c.messages, c.created_at, c.updated_at, c.archived_at, c.favorited_at,
          COUNT(tc.id) as tool_call_count
        FROM conversations c
        LEFT JOIN tool_calls tc ON tc.conversation_id = c.id
        WHERE c.archived_at IS NOT NULL
        GROUP BY c.id
        ORDER BY c.archived_at DESC, c.id DESC
        LIMIT $limit OFFSET $offset
      `)
      .all({ limit, offset }) as {
        id: number;
        thread_ts: string;
        channel_id: string;
        user_id: string;
        messages: string;
        created_at: number;
        updated_at: number;
        archived_at: number | null;
        favorited_at: number | null;
        tool_call_count: number;
      }[];

    return rows.map((row) => this.toSessionSummary(row, activeThreshold));
  }

  /**
   * Count archived sessions
   */
  countArchivedSessions(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM conversations WHERE archived_at IS NOT NULL')
      .get() as { count: number };
    return row.count;
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
      archivedAt: conversation.archivedAt,
      isActive: conversation.updatedAt > activeThreshold,
      isFavorited: conversation.favoritedAt != null,
      recentToolCalls: toolCalls,
    };
  }

  /**
   * Convert a session row to SessionSummary
   */
  private toSessionSummary(
    row: {
      id: number;
      thread_ts: string;
      channel_id: string;
      user_id: string;
      messages: string;
      created_at: number;
      updated_at: number;
      archived_at: number | null;
      favorited_at: number | null;
      tool_call_count: number;
    },
    activeThreshold: number
  ): SessionSummary {
    const messages = JSON.parse(row.messages) as ConversationMessage[];
    const firstUserMsg = messages.find((m) => m.role === 'user');
    const content = firstUserMsg && typeof firstUserMsg.content === 'string' ? firstUserMsg.content : undefined;
    let firstMessage: string | undefined;
    if (content) {
      const codePoints = Array.from(content);
      firstMessage = codePoints.length > 80 ? codePoints.slice(0, 80).join('') + '...' : content;
    }
    return {
      id: row.id,
      threadTs: row.thread_ts,
      channelId: row.channel_id,
      userId: row.user_id,
      messageCount: messages.length,
      toolCallCount: row.tool_call_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      archivedAt: row.archived_at,
      isActive: row.updated_at > activeThreshold,
      isFavorited: row.favorited_at != null,
      firstMessage,
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
        WHERE updated_at > ? AND archived_at IS NULL
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
        WHERE updated_at > ? AND archived_at IS NULL
      `)
      .get(cutoff) as { total_messages: number };

    const totalMessages = messageStats.total_messages;

    // Get tool call count
    const toolCallStats = this.db
      .prepare(`
        SELECT COUNT(*) as count
        FROM tool_calls tc
        INNER JOIN conversations c ON tc.conversation_id = c.id
        WHERE c.updated_at > ? AND c.archived_at IS NULL
      `)
      .get(cutoff) as { count: number };

    // Get tool call analytics (duration and failure rate)
    const analyticsStats = this.db
      .prepare(`
        SELECT
          AVG(CASE WHEN duration_ms IS NOT NULL THEN duration_ms END) as avg_duration_ms,
          SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failure_count
        FROM tool_calls tc
        INNER JOIN conversations c ON tc.conversation_id = c.id
        WHERE c.updated_at > ? AND c.archived_at IS NULL
      `)
      .get(cutoff) as { avg_duration_ms: number | null; failure_count: number } | undefined;

    const totalToolCalls = toolCallStats.count;
    const failureCount = analyticsStats?.failure_count ?? 0;

    // Get top tools with avg duration
    const topToolsRows = this.db
      .prepare(`
        SELECT
          tool_name as name,
          COUNT(*) as count,
          AVG(duration_ms) as avg_duration_ms
        FROM tool_calls tc
        INNER JOIN conversations c ON tc.conversation_id = c.id
        WHERE c.updated_at > ? AND c.archived_at IS NULL
        GROUP BY tool_name
        ORDER BY count DESC
        LIMIT 5
      `)
      .all(cutoff) as { name: string; count: number; avg_duration_ms: number | null }[];

    return {
      totalSessions: sessionStats.total_sessions,
      activeSessions: sessionStats.active_sessions,
      totalMessages,
      totalToolCalls,
      avgToolDurationMs: analyticsStats?.avg_duration_ms != null
        ? Math.round(analyticsStats.avg_duration_ms)
        : null,
      toolFailureRate: totalToolCalls > 0 ? failureCount / totalToolCalls : 0,
      topTools: topToolsRows.map((t) => ({
        name: t.name,
        count: t.count,
        avgDurationMs: t.avg_duration_ms != null ? Math.round(t.avg_duration_ms) : null,
      })),
    };
  }

  /**
   * Count unique users who have created conversations within a time window
   */
  countUniqueUsers(hours = 24): number {
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    const row = this.db
      .prepare(`
        SELECT COUNT(DISTINCT user_id) as count
        FROM conversations
        WHERE updated_at > ? AND archived_at IS NULL
      `)
      .get(cutoff) as { count: number };
    return row.count;
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
      duration_ms: number | null;
      success: number;
    }[];

    return rows.map((row) => ({
      id: row.id,
      conversationId: row.conversation_id,
      toolName: row.tool_name,
      input: JSON.parse(row.input) as Record<string, unknown>,
      outputPreview: row.output_preview,
      timestamp: row.timestamp,
      durationMs: row.duration_ms,
      success: row.success !== 0,
    }));
  }

  // ─── Full-text search ───────────────────────────────────────────────

  /**
   * Search conversations by message content using FTS5
   */
  searchConversations(query: string, limit = 20, offset = 0, filterUserId?: string): SessionSummary[] {
    const activeThreshold = Date.now() - ConversationStore.ACTIVE_THRESHOLD_MS;

    // Quote each token individually so "nginx restart" matches both words anywhere
    const safeQuery = query
      .split(/\s+/)
      .filter((t) => t.length > 0)
      .map((t) => '"' + t.replace(/"/g, '""') + '"')
      .join(' ');

    const userFilter = filterUserId ? 'AND c.user_id = $filterUserId' : '';

    const rows = this.db
      .prepare(`
        SELECT
          c.id, c.thread_ts, c.channel_id, c.user_id,
          c.messages, c.created_at, c.updated_at, c.archived_at, c.favorited_at,
          COUNT(tc.id) as tool_call_count
        FROM conversations c
        INNER JOIN conversations_fts fts ON fts.rowid = c.id
        LEFT JOIN tool_calls tc ON tc.conversation_id = c.id
        WHERE conversations_fts MATCH $query
          AND c.archived_at IS NULL
          ${userFilter}
        GROUP BY c.id
        ORDER BY rank, c.updated_at DESC
        LIMIT $limit OFFSET $offset
      `)
      .all({ query: safeQuery, limit, offset, ...(filterUserId ? { filterUserId } : {}) }) as {
        id: number;
        thread_ts: string;
        channel_id: string;
        user_id: string;
        messages: string;
        created_at: number;
        updated_at: number;
        archived_at: number | null;
        favorited_at: number | null;
        tool_call_count: number;
      }[];

    return rows.map((row) => this.toSessionSummary(row, activeThreshold));
  }

  /**
   * Count total search results
   */
  countSearchResults(query: string): number {
    const safeQuery = query
      .split(/\s+/)
      .filter((t) => t.length > 0)
      .map((t) => '"' + t.replace(/"/g, '""') + '"')
      .join(' ');

    const row = this.db
      .prepare(`
        SELECT COUNT(*) as count
        FROM conversations c
        INNER JOIN conversations_fts fts ON fts.rowid = c.id
        WHERE conversations_fts MATCH $query
          AND c.archived_at IS NULL
      `)
      .get({ query: safeQuery }) as { count: number };

    return row.count;
  }

  // ─── Tagging ──────────────────────────────────────────────────────────

  /**
   * Add a tag to a conversation
   */
  addTag(conversationId: number, tag: string): void {
    this.db
      .prepare('INSERT OR IGNORE INTO conversation_tags (conversation_id, tag, created_at) VALUES (?, ?, ?)')
      .run(conversationId, tag, Date.now());
  }

  /**
   * Remove a tag from a conversation
   * @returns true if the tag was removed, false if it didn't exist
   */
  removeTag(conversationId: number, tag: string): boolean {
    const result = this.db
      .prepare('DELETE FROM conversation_tags WHERE conversation_id = ? AND tag = ?')
      .run(conversationId, tag);
    return result.changes > 0;
  }

  /**
   * Get all tags for a conversation
   */
  getTags(conversationId: number): string[] {
    const rows = this.db
      .prepare('SELECT tag FROM conversation_tags WHERE conversation_id = ? ORDER BY tag')
      .all(conversationId) as { tag: string }[];
    return rows.map((r) => r.tag);
  }

  /**
   * List all unique tags with usage counts
   */
  listAllTags(): TagInfo[] {
    const rows = this.db
      .prepare(`
        SELECT tag as name, COUNT(*) as count
        FROM conversation_tags ct
        INNER JOIN conversations c ON c.id = ct.conversation_id
        WHERE c.archived_at IS NULL
        GROUP BY tag
        ORDER BY count DESC, tag ASC
      `)
      .all() as { name: string; count: number }[];
    return rows;
  }

  /**
   * List sessions that have a specific tag (excludes archived)
   */
  listSessionsByTag(tag: string, limit = 20, offset = 0): SessionSummary[] {
    const activeThreshold = Date.now() - ConversationStore.ACTIVE_THRESHOLD_MS;

    const rows = this.db
      .prepare(`
        SELECT
          c.id, c.thread_ts, c.channel_id, c.user_id,
          c.messages, c.created_at, c.updated_at, c.archived_at, c.favorited_at,
          COUNT(tc.id) as tool_call_count
        FROM conversations c
        INNER JOIN conversation_tags ct ON ct.conversation_id = c.id
        LEFT JOIN tool_calls tc ON tc.conversation_id = c.id
        WHERE ct.tag = $tag
          AND c.archived_at IS NULL
        GROUP BY c.id
        ORDER BY c.updated_at DESC, c.id DESC
        LIMIT $limit OFFSET $offset
      `)
      .all({ tag, limit, offset }) as {
        id: number;
        thread_ts: string;
        channel_id: string;
        user_id: string;
        messages: string;
        created_at: number;
        updated_at: number;
        archived_at: number | null;
        favorited_at: number | null;
        tool_call_count: number;
      }[];

    return rows.map((row) => this.toSessionSummary(row, activeThreshold));
  }

  /**
   * Count sessions with a specific tag (excludes archived)
   */
  countSessionsByTag(tag: string): number {
    const row = this.db
      .prepare(`
        SELECT COUNT(*) as count
        FROM conversation_tags ct
        INNER JOIN conversations c ON c.id = ct.conversation_id
        WHERE ct.tag = ? AND c.archived_at IS NULL
      `)
      .get(tag) as { count: number };
    return row.count;
  }

  // ─── Favorites ────────────────────────────────────────────────────────

  /**
   * Toggle favorite status on a conversation
   * @returns true if now favorited, false if unfavorited
   */
  toggleFavorite(conversationId: number): boolean {
    const row = this.db
      .prepare('SELECT favorited_at FROM conversations WHERE id = ?')
      .get(conversationId) as { favorited_at: number | null } | undefined;

    if (!row) return false;

    if (row.favorited_at != null) {
      this.db.prepare('UPDATE conversations SET favorited_at = NULL WHERE id = ?').run(conversationId);
      return false;
    } else {
      this.db.prepare('UPDATE conversations SET favorited_at = ? WHERE id = ?').run(Date.now(), conversationId);
      return true;
    }
  }

  /**
   * Check if a conversation is favorited
   */
  isFavorited(conversationId: number): boolean {
    const row = this.db
      .prepare('SELECT favorited_at FROM conversations WHERE id = ?')
      .get(conversationId) as { favorited_at: number | null } | undefined;
    return row?.favorited_at != null;
  }

  /**
   * List favorited sessions (excludes archived)
   */
  listFavoriteSessions(limit = 20, offset = 0): SessionSummary[] {
    const activeThreshold = Date.now() - ConversationStore.ACTIVE_THRESHOLD_MS;

    const rows = this.db
      .prepare(`
        SELECT
          c.id, c.thread_ts, c.channel_id, c.user_id,
          c.messages, c.created_at, c.updated_at, c.archived_at, c.favorited_at,
          COUNT(tc.id) as tool_call_count
        FROM conversations c
        LEFT JOIN tool_calls tc ON tc.conversation_id = c.id
        WHERE c.favorited_at IS NOT NULL
          AND c.archived_at IS NULL
        GROUP BY c.id
        ORDER BY c.favorited_at DESC, c.id DESC
        LIMIT $limit OFFSET $offset
      `)
      .all({ limit, offset }) as {
        id: number;
        thread_ts: string;
        channel_id: string;
        user_id: string;
        messages: string;
        created_at: number;
        updated_at: number;
        archived_at: number | null;
        favorited_at: number | null;
        tool_call_count: number;
      }[];

    return rows.map((row) => this.toSessionSummary(row, activeThreshold));
  }

  /**
   * Count favorited sessions (excludes archived)
   */
  countFavoriteSessions(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM conversations WHERE favorited_at IS NOT NULL AND archived_at IS NULL')
      .get() as { count: number };
    return row.count;
  }

  /**
   * Get the underlying database instance (for backup service)
   */
  getDatabase(): Database.Database {
    return this.db;
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

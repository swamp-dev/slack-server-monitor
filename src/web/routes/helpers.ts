import type { Request } from 'express';
import type { getConversationStore } from '../../services/conversation-store.js';
import type { SessionSummary } from '../../services/conversation-store.js';

export function parsePagination(req: Request): { page: number; pageSize: number; offset: number } {
  const page = typeof req.query.page === 'string' ? Math.max(1, parseInt(req.query.page, 10) || 1) : 1;
  const pageSize = typeof req.query.pageSize === 'string' ? Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20)) : 20;
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function attachTags(sessions: SessionSummary[], store: ReturnType<typeof getConversationStore>): void {
  if (sessions.length === 0) return;
  const ids = sessions.map((s) => s.id);
  const placeholders = ids.map(() => '?').join(',');
  const rows = store.getDatabase()
    .prepare(`SELECT conversation_id, tag FROM conversation_tags WHERE conversation_id IN (${placeholders}) ORDER BY tag`)
    .all(...ids) as { conversation_id: number; tag: string }[];
  const tagsByConv = new Map<number, string[]>();
  for (const row of rows) {
    const tags = tagsByConv.get(row.conversation_id) ?? [];
    tags.push(row.tag);
    tagsByConv.set(row.conversation_id, tags);
  }
  for (const session of sessions) {
    session.tags = tagsByConv.get(session.id) ?? [];
  }
}

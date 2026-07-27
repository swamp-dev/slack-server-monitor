/**
 * Comments on cards.
 *
 * `author_id` is the app identity that posted, and is what authorises a delete.
 * `author_member_id` is the roster member that identity resolved to at post
 * time, so the comment can show a face and a colour; it is a snapshot, not a
 * live link, which is why archiving a member never rewrites history.
 */
import type { PluginDatabase } from '../../src/services/plugin-database.js';
import { GoalsError, type Comment } from './types.js';
import { LIMITS } from './validation.js';
import { findMemberByIdentity } from './members.js';

interface CommentRow {
  id: number;
  card_id: number;
  author_id: string;
  author_member_id: number | null;
  body: string;
  created_at: number;
}

function mapComment(row: CommentRow): Comment {
  return {
    id: row.id,
    cardId: row.card_id,
    authorId: row.author_id,
    authorMemberId: row.author_member_id,
    body: row.body,
    createdAt: row.created_at,
  };
}

export function listComments(db: PluginDatabase, cardId: number): Comment[] {
  const rows = db
    .prepare(`SELECT * FROM ${db.prefix}comments WHERE card_id = ? ORDER BY created_at, id`)
    .all(cardId) as CommentRow[];
  return rows.map(mapComment);
}

export function getComment(db: PluginDatabase, id: number): Comment | null {
  const row = db.prepare(`SELECT * FROM ${db.prefix}comments WHERE id = ?`).get(id) as
    | CommentRow
    | undefined;
  return row ? mapComment(row) : null;
}

export function countComments(db: PluginDatabase, cardId: number): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM ${db.prefix}comments WHERE card_id = ?`)
    .get(cardId) as { c: number };
  return row.c;
}

export interface CreateCommentInput {
  cardId: number;
  authorId: string;
  body: string;
}

export function createComment(db: PluginDatabase, input: CreateCommentInput): Comment {
  return db.transaction(() => {
    const card = db.prepare(`SELECT id FROM ${db.prefix}cards WHERE id = ?`).get(input.cardId) as
      | { id: number }
      | undefined;
    if (!card) throw new GoalsError('NOT_FOUND', 'That card no longer exists');

    if (countComments(db, input.cardId) >= LIMITS.maxCommentsPerCard) {
      throw new GoalsError(
        'LIMIT_REACHED',
        `A card can hold at most ${String(LIMITS.maxCommentsPerCard)} comments.`
      );
    }

    const member = findMemberByIdentity(db, input.authorId);

    const result = db
      .prepare(
        `INSERT INTO ${db.prefix}comments (card_id, author_id, author_member_id, body, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(input.cardId, input.authorId, member?.id ?? null, input.body, Date.now());

    const comment = getComment(db, Number(result.lastInsertRowid));
    if (!comment) throw new GoalsError('NOT_FOUND', 'Comment vanished after insert');
    return comment;
  });
}

export function deleteComment(db: PluginDatabase, id: number): void {
  const existing = getComment(db, id);
  if (!existing) throw new GoalsError('NOT_FOUND', 'That comment no longer exists');

  db.prepare(`DELETE FROM ${db.prefix}comments WHERE id = ?`).run(id);
}

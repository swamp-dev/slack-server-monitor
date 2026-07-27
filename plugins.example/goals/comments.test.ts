import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GoalsError } from './types.js';
import { makeTestDb, type TestDb } from './test-support.js';
import { createBoard } from './boards.js';
import { createColumn } from './columns.js';
import { createCard } from './cards.js';
import { createMember, setMemberArchived } from './members.js';
import {
  listComments,
  getComment,
  createComment,
  deleteComment,
  countComments,
} from './comments.js';

describe('goals comments', () => {
  let t: TestDb;
  let cardId: number;

  beforeEach(() => {
    t = makeTestDb();
    const board = createBoard(t.db, { title: 'B', ownerId: 'admin', withDefaultColumns: false });
    const column = createColumn(t.db, { boardId: board.id, name: 'Todo' });
    cardId = createCard(t.db, { columnId: column.id, title: 'Card', createdBy: 'admin' }).id;
  });

  afterEach(() => {
    t.close();
  });

  describe('createComment', () => {
    it('stores the comment against the card', () => {
      const comment = createComment(t.db, { cardId, authorId: 'web:andy', body: 'Looks good' });

      expect(comment.cardId).toBe(cardId);
      expect(comment.authorId).toBe('web:andy');
      expect(comment.body).toBe('Looks good');
      expect(comment.createdAt).toBeGreaterThan(0);
    });

    it('resolves the author to a roster member when the identity is linked', () => {
      const member = createMember(t.db, {
        displayName: 'Andy',
        color: '#7c3aed',
        identity: 'web:andy',
      });

      const comment = createComment(t.db, { cardId, authorId: 'web:andy', body: 'Mine' });

      expect(comment.authorMemberId).toBe(member.id);
    });

    it('leaves the member unresolved for an unlinked identity', () => {
      const comment = createComment(t.db, { cardId, authorId: 'U404', body: 'Hello' });
      expect(comment.authorMemberId).toBeNull();
    });

    it('keeps attribution after the member is archived', () => {
      const member = createMember(t.db, {
        displayName: 'Andy',
        color: '#7c3aed',
        identity: 'web:andy',
      });
      const comment = createComment(t.db, { cardId, authorId: 'web:andy', body: 'Mine' });

      setMemberArchived(t.db, member.id, true);

      expect(getComment(t.db, comment.id)?.authorMemberId).toBe(member.id);
    });

    it('throws NOT_FOUND for an unknown card', () => {
      try {
        createComment(t.db, { cardId: 999, authorId: 'admin', body: 'Hi' });
        expect.unreachable('expected a GoalsError');
      } catch (err) {
        expect((err as GoalsError).code).toBe('NOT_FOUND');
      }
    });

    it('refuses past the per-card cap', () => {
      for (let i = 0; i < 500; i++) {
        createComment(t.db, { cardId, authorId: 'admin', body: `c${String(i)}` });
      }

      try {
        createComment(t.db, { cardId, authorId: 'admin', body: 'one too many' });
        expect.unreachable('expected a GoalsError');
      } catch (err) {
        expect((err as GoalsError).code).toBe('LIMIT_REACHED');
      }
    });
  });

  describe('listComments', () => {
    it('returns them oldest first', () => {
      const first = createComment(t.db, { cardId, authorId: 'admin', body: 'one' });
      const second = createComment(t.db, { cardId, authorId: 'admin', body: 'two' });

      expect(listComments(t.db, cardId).map((c) => c.id)).toEqual([first.id, second.id]);
    });

    it('breaks a same-millisecond tie by id', () => {
      const ids = Array.from(
        { length: 5 },
        (_v, i) => createComment(t.db, { cardId, authorId: 'admin', body: `c${String(i)}` }).id
      );
      t.raw.prepare(`UPDATE ${t.db.prefix}comments SET created_at = 1000`).run();

      expect(listComments(t.db, cardId).map((c) => c.id)).toEqual(ids);
    });

    it('scopes to the card', () => {
      const board = createBoard(t.db, { title: 'B2', ownerId: 'admin', withDefaultColumns: false });
      const column = createColumn(t.db, { boardId: board.id, name: 'Todo' });
      const otherCard = createCard(t.db, { columnId: column.id, title: 'Other', createdBy: 'a' });
      createComment(t.db, { cardId, authorId: 'admin', body: 'mine' });
      createComment(t.db, { cardId: otherCard.id, authorId: 'admin', body: 'theirs' });

      expect(listComments(t.db, cardId).map((c) => c.body)).toEqual(['mine']);
    });

    it('returns an empty list for a card with no comments', () => {
      expect(listComments(t.db, cardId)).toEqual([]);
      expect(countComments(t.db, cardId)).toBe(0);
    });
  });

  describe('deleteComment', () => {
    it('removes it', () => {
      const comment = createComment(t.db, { cardId, authorId: 'admin', body: 'bye' });

      deleteComment(t.db, comment.id);

      expect(getComment(t.db, comment.id)).toBeNull();
      expect(countComments(t.db, cardId)).toBe(0);
    });

    it('throws NOT_FOUND for an unknown comment', () => {
      expect(() => deleteComment(t.db, 999)).toThrow(GoalsError);
    });
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Actor, CardDetail } from './types.js';
import { makeTestDb, type TestDb } from './test-support.js';
import { createBoard } from './boards.js';
import { createColumn } from './columns.js';
import { createCard } from './cards.js';
import { createComment } from './comments.js';
import { createMember } from './members.js';
import { loadCardDetail } from './queries.js';
import { renderCardDetail, renderCardPermalink } from './view-card.js';

const admin: Actor = { userId: 'admin', isAdmin: true };
const author: Actor = { userId: 'web:ada', isAdmin: false };
const stranger: Actor = { userId: 'U999', isAdmin: false };
const TODAY = '2026-07-25';

describe('goals card view', () => {
  let t: TestDb;
  let detail: CardDetail;
  let cardId: number;

  beforeEach(() => {
    t = makeTestDb();
    const board = createBoard(t.db, { title: 'Family', ownerId: 'admin', withDefaultColumns: false });
    const todo = createColumn(t.db, { boardId: board.id, name: 'Todo' });
    createColumn(t.db, { boardId: board.id, name: 'Done', isDone: true });
    const ada = createMember(t.db, { displayName: 'Ada', color: '#ec4899', identity: 'web:ada' });

    const card = createCard(t.db, {
      columnId: todo.id,
      title: 'Learn to sail',
      description: 'Book a course\nthen actually go',
      createdBy: 'admin',
      assigneeId: ada.id,
      dueDate: '2026-08-01',
    });
    cardId = card.id;
    createComment(t.db, { cardId: card.id, authorId: 'web:ada', body: 'Found a school' });

    detail = loadCardDetail(t.db, card.id)!;
  });

  afterEach(() => {
    t.close();
  });

  describe('renderCardDetail', () => {
    it('fills the editable fields from the card', () => {
      const html = renderCardDetail(detail, admin, TODAY);

      expect(html).toContain('value="Learn to sail"');
      expect(html).toContain('Book a course\nthen actually go');
      expect(html).toContain('value="2026-08-01"');
      expect(html).toContain(`name="cardId" value="${String(cardId)}"`);
    });

    it('preselects the assignee and offers Nobody', () => {
      const html = renderCardDetail(detail, admin, TODAY);

      expect(html).toMatch(/<option value="\d+" selected>Ada<\/option>/);
      expect(html).toContain('<option value="">Nobody</option>');
    });

    it('preselects the current column and lists the others', () => {
      const html = renderCardDetail(detail, admin, TODAY);

      expect(html).toMatch(/<option value="\d+" selected>Todo<\/option>/);
      expect(html).toContain('>Done</option>');
    });

    it('lists comments with their author', () => {
      const html = renderCardDetail(detail, admin, TODAY);

      expect(html).toContain('Found a school');
      expect(html).toContain('Ada');
    });

    it('offers comment deletion to the author and to an admin, but not a stranger', () => {
      expect(renderCardDetail(detail, author, TODAY)).toContain('goals-comment-delete');
      expect(renderCardDetail(detail, admin, TODAY)).toContain('goals-comment-delete');
      expect(renderCardDetail(detail, stranger, TODAY)).not.toContain('goals-comment-delete');
    });

    it('says so when there are no comments', () => {
      const bare = createCard(t.db, {
        columnId: detail.column.id,
        title: 'Quiet',
        createdBy: 'admin',
      });
      const bareDetail = loadCardDetail(t.db, bare.id)!;

      expect(renderCardDetail(bareDetail, admin, TODAY)).toContain('No comments yet.');
    });

    it('falls back to the raw identity for an unlinked commenter', () => {
      createComment(t.db, { cardId, authorId: 'U404', body: 'drive-by' });
      const refreshed = loadCardDetail(t.db, cardId)!;

      expect(renderCardDetail(refreshed, admin, TODAY)).toContain('U404');
    });

    it('escapes hostile card and comment text', () => {
      const evil = createCard(t.db, {
        columnId: detail.column.id,
        title: '"><script>alert(1)</script>',
        description: '<img src=x onerror=1>',
        createdBy: 'admin',
      });
      createComment(t.db, { cardId: evil.id, authorId: 'admin', body: '<b>shout</b>' });
      const evilDetail = loadCardDetail(t.db, evil.id)!;

      const html = renderCardDetail(evilDetail, admin, TODAY);

      expect(html).not.toContain('<script>alert(1)</script>');
      expect(html).not.toContain('<img src=x onerror=1>');
      expect(html).not.toContain('<b>shout</b>');
      expect(html).toContain('&lt;b&gt;shout&lt;/b&gt;');
    });

    it('posts to the update and comment endpoints', () => {
      const html = renderCardDetail(detail, admin, TODAY);

      expect(html).toContain('action="/p/goals/cards/update"');
      expect(html).toContain('action="/p/goals/comments/create"');
    });
  });

  describe('renderCardPermalink', () => {
    it('wraps the detail with a link back to its board', () => {
      const html = renderCardPermalink(detail, admin, TODAY);

      expect(html).toContain('class="goals-root"');
      expect(html).toContain(`href="/p/goals/b/${String(detail.board.id)}"`);
      expect(html).toContain('Learn to sail');
    });
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Board, Column } from './types.js';
import { makeTestDb, type TestDb } from './test-support.js';
import { createBoard } from './boards.js';
import { createColumn } from './columns.js';
import { createCard, setCardArchived, moveCard } from './cards.js';
import { createComment } from './comments.js';
import { createMember } from './members.js';
import {
  todayIso,
  boardStats,
  loadIndexView,
  loadBoardView,
  loadCardDetail,
  listOpenCards,
  listCardsForIdentity,
} from './queries.js';

const admin = { userId: 'admin', isAdmin: true };
const other = { userId: 'U999', isAdmin: false };

describe('goals queries', () => {
  let t: TestDb;
  let board: Board;
  let todo: Column;
  let done: Column;

  beforeEach(() => {
    t = makeTestDb();
    board = createBoard(t.db, { title: 'Family', ownerId: 'admin', withDefaultColumns: false });
    todo = createColumn(t.db, { boardId: board.id, name: 'Todo' });
    done = createColumn(t.db, { boardId: board.id, name: 'Done', isDone: true });
  });

  afterEach(() => {
    t.close();
  });

  describe('todayIso', () => {
    it('formats a local calendar date', () => {
      expect(todayIso(new Date(2026, 6, 5))).toBe('2026-07-05');
    });
  });

  describe('boardStats', () => {
    it('counts total, done and overdue', () => {
      createCard(t.db, { columnId: todo.id, title: 'Open', createdBy: 'a' });
      createCard(t.db, { columnId: todo.id, title: 'Late', createdBy: 'a', dueDate: '2020-01-01' });
      createCard(t.db, { columnId: done.id, title: 'Finished', createdBy: 'a' });

      expect(boardStats(t.db, board.id, '2026-07-25')).toEqual({ total: 3, done: 1, overdue: 1 });
    });

    it('does not count a completed card as overdue', () => {
      createCard(t.db, {
        columnId: done.id,
        title: 'Late but finished',
        createdBy: 'a',
        dueDate: '2020-01-01',
      });

      expect(boardStats(t.db, board.id, '2026-07-25').overdue).toBe(0);
    });

    it('does not count a card due today as overdue', () => {
      createCard(t.db, { columnId: todo.id, title: 'Today', createdBy: 'a', dueDate: '2026-07-25' });

      expect(boardStats(t.db, board.id, '2026-07-25').overdue).toBe(0);
    });

    it('excludes archived cards', () => {
      const card = createCard(t.db, { columnId: todo.id, title: 'Hidden', createdBy: 'a' });
      setCardArchived(t.db, card.id, true);

      expect(boardStats(t.db, board.id, '2026-07-25').total).toBe(0);
    });
  });

  describe('loadBoardView', () => {
    it('returns columns in order with their cards in order', () => {
      const a = createCard(t.db, { columnId: todo.id, title: 'A', createdBy: 'x' });
      const b = createCard(t.db, { columnId: todo.id, title: 'B', createdBy: 'x' });
      const c = createCard(t.db, { columnId: done.id, title: 'C', createdBy: 'x' });

      const view = loadBoardView(t.db, board.id);

      expect(view?.columns.map((col) => col.name)).toEqual(['Todo', 'Done']);
      expect(view?.columns[0]?.cards.map((card) => card.id)).toEqual([a.id, b.id]);
      expect(view?.columns[1]?.cards.map((card) => card.id)).toEqual([c.id]);
    });

    it('keeps card order stable after a move', () => {
      const a = createCard(t.db, { columnId: todo.id, title: 'A', createdBy: 'x' });
      const b = createCard(t.db, { columnId: todo.id, title: 'B', createdBy: 'x' });
      const c = createCard(t.db, { columnId: todo.id, title: 'C', createdBy: 'x' });

      moveCard(t.db, { cardId: c.id, toColumnId: todo.id, toIndex: 0 });

      const view = loadBoardView(t.db, board.id);
      expect(view?.columns[0]?.cards.map((card) => card.id)).toEqual([c.id, a.id, b.id]);
    });

    it('joins the assignee onto each card', () => {
      const member = createMember(t.db, { displayName: 'Ada', color: '#ec4899', identity: null });
      createCard(t.db, {
        columnId: todo.id,
        title: 'Assigned',
        createdBy: 'x',
        assigneeId: member.id,
      });
      createCard(t.db, { columnId: todo.id, title: 'Unassigned', createdBy: 'x' });

      const cards = loadBoardView(t.db, board.id)?.columns[0]?.cards ?? [];

      expect(cards[0]?.assignee?.displayName).toBe('Ada');
      expect(cards[0]?.assignee?.color).toBe('#ec4899');
      expect(cards[1]?.assignee).toBeNull();
    });

    it('counts comments per card', () => {
      const card = createCard(t.db, { columnId: todo.id, title: 'Chatty', createdBy: 'x' });
      createComment(t.db, { cardId: card.id, authorId: 'a', body: 'one' });
      createComment(t.db, { cardId: card.id, authorId: 'a', body: 'two' });
      createCard(t.db, { columnId: todo.id, title: 'Quiet', createdBy: 'x' });

      const cards = loadBoardView(t.db, board.id)?.columns[0]?.cards ?? [];

      expect(cards[0]?.commentCount).toBe(2);
      expect(cards[1]?.commentCount).toBe(0);
    });

    it('excludes archived cards', () => {
      const card = createCard(t.db, { columnId: todo.id, title: 'Hidden', createdBy: 'x' });
      setCardArchived(t.db, card.id, true);

      expect(loadBoardView(t.db, board.id)?.columns[0]?.cards).toEqual([]);
    });

    it('offers only active members for assignment', () => {
      createMember(t.db, { displayName: 'Ada', color: '#7c3aed', identity: null });
      const view = loadBoardView(t.db, board.id);

      expect(view?.members.map((m) => m.displayName)).toEqual(['Ada']);
    });

    it('renders a stable order when positions collide', () => {
      const a = createCard(t.db, { columnId: todo.id, title: 'A', createdBy: 'x' });
      const b = createCard(t.db, { columnId: todo.id, title: 'B', createdBy: 'x' });
      t.raw.prepare(`UPDATE ${t.db.prefix}cards SET position = 0`).run();

      const cards = loadBoardView(t.db, board.id)?.columns[0]?.cards ?? [];
      expect(cards.map((card) => card.id)).toEqual([a.id, b.id]);
    });

    it('returns null for an unknown board', () => {
      expect(loadBoardView(t.db, 999)).toBeNull();
    });
  });

  describe('loadIndexView', () => {
    it('summarises every board the actor may see', () => {
      createBoard(t.db, {
        title: 'Andy only',
        ownerId: 'web:andy',
        visibility: 'private',
        withDefaultColumns: false,
      });
      createCard(t.db, { columnId: todo.id, title: 'Open', createdBy: 'x' });

      const asAdmin = loadIndexView(t.db, admin);
      expect(asAdmin.map((s) => s.board.title)).toEqual(['Family', 'Andy only']);
      expect(asAdmin[0]?.stats.total).toBe(1);
      expect(asAdmin[0]?.columnCount).toBe(2);

      expect(loadIndexView(t.db, other).map((s) => s.board.title)).toEqual(['Family']);
    });
  });

  describe('loadCardDetail', () => {
    it('returns the card with its board, column, comments and pickers', () => {
      const member = createMember(t.db, {
        displayName: 'Ada',
        color: '#7c3aed',
        identity: 'web:ada',
      });
      const card = createCard(t.db, {
        columnId: todo.id,
        title: 'Card',
        createdBy: 'x',
        assigneeId: member.id,
      });
      createComment(t.db, { cardId: card.id, authorId: 'web:ada', body: 'mine' });

      const detail = loadCardDetail(t.db, card.id);

      expect(detail?.card.title).toBe('Card');
      expect(detail?.board.id).toBe(board.id);
      expect(detail?.column.name).toBe('Todo');
      expect(detail?.columns.map((c) => c.name)).toEqual(['Todo', 'Done']);
      expect(detail?.comments).toHaveLength(1);
      expect(detail?.comments[0]?.authorMember?.displayName).toBe('Ada');
      expect(detail?.members.map((m) => m.id)).toEqual([member.id]);
    });

    it('leaves authorMember null for an unlinked commenter', () => {
      const card = createCard(t.db, { columnId: todo.id, title: 'Card', createdBy: 'x' });
      createComment(t.db, { cardId: card.id, authorId: 'U404', body: 'hi' });

      expect(loadCardDetail(t.db, card.id)?.comments[0]?.authorMember).toBeNull();
    });

    it('returns null for an unknown card', () => {
      expect(loadCardDetail(t.db, 999)).toBeNull();
    });
  });

  describe('listOpenCards', () => {
    it('excludes cards in done columns and archived cards', () => {
      createCard(t.db, { columnId: todo.id, title: 'Open', createdBy: 'x' });
      createCard(t.db, { columnId: done.id, title: 'Finished', createdBy: 'x' });
      const hidden = createCard(t.db, { columnId: todo.id, title: 'Hidden', createdBy: 'x' });
      setCardArchived(t.db, hidden.id, true);

      expect(listOpenCards(t.db, admin).map((o) => o.card.title)).toEqual(['Open']);
    });

    it('sorts overdue first, then by due date, then undated', () => {
      createCard(t.db, { columnId: todo.id, title: 'No date', createdBy: 'x' });
      createCard(t.db, { columnId: todo.id, title: 'Later', createdBy: 'x', dueDate: '2026-12-01' });
      createCard(t.db, { columnId: todo.id, title: 'Overdue', createdBy: 'x', dueDate: '2020-01-01' });

      expect(listOpenCards(t.db, admin).map((o) => o.card.title)).toEqual([
        'Overdue',
        'Later',
        'No date',
      ]);
    });

    it('reports the column each card sits in', () => {
      createCard(t.db, { columnId: todo.id, title: 'Open', createdBy: 'x' });
      expect(listOpenCards(t.db, admin)[0]?.columnName).toBe('Todo');
    });

    it('hides cards on boards the actor cannot see', () => {
      const priv = createBoard(t.db, {
        title: 'Private',
        ownerId: 'web:andy',
        visibility: 'private',
        withDefaultColumns: false,
      });
      const privColumn = createColumn(t.db, { boardId: priv.id, name: 'Todo' });
      createCard(t.db, { columnId: privColumn.id, title: 'Secret', createdBy: 'web:andy' });
      createCard(t.db, { columnId: todo.id, title: 'Shared', createdBy: 'x' });

      expect(listOpenCards(t.db, other).map((o) => o.card.title)).toEqual(['Shared']);
      expect(listOpenCards(t.db, admin).map((o) => o.card.title).sort()).toEqual([
        'Secret',
        'Shared',
      ]);
    });

    it('honours the limit', () => {
      for (let i = 0; i < 5; i++) {
        createCard(t.db, { columnId: todo.id, title: `C${String(i)}`, createdBy: 'x' });
      }

      expect(listOpenCards(t.db, admin, 2)).toHaveLength(2);
    });

    it('returns an empty list when the actor can see no boards', () => {
      const t2 = makeTestDb();
      expect(listOpenCards(t2.db, other)).toEqual([]);
      t2.close();
    });
  });

  describe('listCardsForIdentity', () => {
    it('returns only cards assigned to that identity', () => {
      const ada = createMember(t.db, { displayName: 'Ada', color: '#7c3aed', identity: 'web:ada' });
      const bea = createMember(t.db, { displayName: 'Bea', color: '#06b6d4', identity: 'U123' });
      createCard(t.db, { columnId: todo.id, title: 'Ada task', createdBy: 'x', assigneeId: ada.id });
      createCard(t.db, { columnId: todo.id, title: 'Bea task', createdBy: 'x', assigneeId: bea.id });
      createCard(t.db, { columnId: todo.id, title: 'Nobody task', createdBy: 'x' });

      expect(listCardsForIdentity(t.db, 'web:ada', admin).map((o) => o.card.title)).toEqual([
        'Ada task',
      ]);
    });
  });
});

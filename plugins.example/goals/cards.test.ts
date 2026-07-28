import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GoalsError, type Board, type Column } from './types.js';
import { makeTestDb, cardOrder, cardPositions, type TestDb } from './test-support.js';
import { createBoard } from './boards.js';
import { createColumn } from './columns.js';
import {
  getCard,
  createCard,
  updateCard,
  setCardArchived,
  deleteCard,
  moveCard,
  renumberColumn,
  listCardsInColumn,
} from './cards.js';
import { createComment, listComments } from './comments.js';
import { createMember } from './members.js';

describe('goals cards', () => {
  let t: TestDb;
  let board: Board;
  let todo: Column;
  let doing: Column;
  let done: Column;

  beforeEach(() => {
    t = makeTestDb();
    board = createBoard(t.db, { title: 'B', ownerId: 'admin', withDefaultColumns: false });
    todo = createColumn(t.db, { boardId: board.id, name: 'Todo' });
    doing = createColumn(t.db, { boardId: board.id, name: 'Doing' });
    done = createColumn(t.db, { boardId: board.id, name: 'Done', isDone: true });
  });

  afterEach(() => {
    t.close();
  });

  function seed(columnId: number, count: number): number[] {
    return Array.from({ length: count }, (_v, i) =>
      createCard(t.db, { columnId, title: `Card ${String(i)}`, createdBy: 'admin' }).id
    );
  }

  describe('createCard', () => {
    it('appends to the column tail', () => {
      const [a, b, c] = seed(todo.id, 3);

      expect(cardOrder(t, todo.id)).toEqual([a, b, c]);
      expect(cardPositions(t, todo.id)).toEqual([0, 1, 2]);
    });

    it('inherits the board from its column', () => {
      const card = createCard(t.db, { columnId: todo.id, title: 'Card', createdBy: 'admin' });
      expect(card.boardId).toBe(board.id);
    });

    it('stamps completion when created directly in a done column', () => {
      const card = createCard(t.db, { columnId: done.id, title: 'Card', createdBy: 'admin' });
      expect(card.completedAt).not.toBeNull();
    });

    it('stores an optional assignee and due date', () => {
      const member = createMember(t.db, { displayName: 'Ada', color: '#7c3aed', identity: null });
      const card = createCard(t.db, {
        columnId: todo.id,
        title: 'Card',
        createdBy: 'admin',
        assigneeId: member.id,
        dueDate: '2026-08-01',
      });

      expect(card.assigneeId).toBe(member.id);
      expect(card.dueDate).toBe('2026-08-01');
    });

    it('throws NOT_FOUND for an unknown column', () => {
      expect(() =>
        createCard(t.db, { columnId: 999, title: 'Card', createdBy: 'admin' })
      ).toThrow(GoalsError);
    });

    it('refuses past the per-column cap', () => {
      seed(todo.id, 500);

      try {
        createCard(t.db, { columnId: todo.id, title: 'One too many', createdBy: 'admin' });
        expect.unreachable('expected a GoalsError');
      } catch (err) {
        expect((err as GoalsError).code).toBe('LIMIT_REACHED');
      }
    });

    it('does not count archived cards toward the cap', () => {
      const ids = seed(todo.id, 500);
      setCardArchived(t.db, ids[0]!, true);

      expect(() =>
        createCard(t.db, { columnId: todo.id, title: 'Fits now', createdBy: 'admin' })
      ).not.toThrow();
    });
  });

  describe('renumberColumn', () => {
    it('compacts gaps left by direct edits', () => {
      const [a, b] = seed(todo.id, 2);
      t.raw.prepare(`UPDATE ${t.db.prefix}cards SET position = 40 WHERE id = ?`).run(b);

      t.db.transaction(() => renumberColumn(t.db, todo.id));

      expect(cardPositions(t, todo.id)).toEqual([0, 1]);
      expect(cardOrder(t, todo.id)).toEqual([a, b]);
    });

    it('resolves duplicate positions to a stable order', () => {
      const [a, b, c] = seed(todo.id, 3);
      t.raw.prepare(`UPDATE ${t.db.prefix}cards SET position = 0 WHERE id IN (?, ?, ?)`).run(a, b, c);

      t.db.transaction(() => renumberColumn(t.db, todo.id));

      // Tied positions fall back to id order, so the sequence is deterministic.
      expect(cardOrder(t, todo.id)).toEqual([a, b, c]);
      expect(cardPositions(t, todo.id)).toEqual([0, 1, 2]);
    });
  });

  describe('moveCard within a column', () => {
    it('moves a card down to the index it was dropped at', () => {
      const [a, b, c, d] = seed(todo.id, 4);

      // Drop A at index 2 of the list with A removed: [B, C, D] -> [B, C, A, D]
      const result = moveCard(t.db, { cardId: a!, toColumnId: todo.id, toIndex: 2 });

      expect(cardOrder(t, todo.id)).toEqual([b, c, a, d]);
      expect(result.toIndex).toBe(2);
      expect(result.fromColumnId).toBe(todo.id);
      expect(result.toColumnId).toBe(todo.id);
    });

    it('moves a card up', () => {
      const [a, b, c, d] = seed(todo.id, 4);

      moveCard(t.db, { cardId: d!, toColumnId: todo.id, toIndex: 1 });

      expect(cardOrder(t, todo.id)).toEqual([a, d, b, c]);
    });

    it('moves a card to the top', () => {
      const [a, b, c] = seed(todo.id, 3);

      moveCard(t.db, { cardId: c!, toColumnId: todo.id, toIndex: 0 });

      expect(cardOrder(t, todo.id)).toEqual([c, a, b]);
    });

    it('clamps an index past the end to the tail', () => {
      const [a, b, c] = seed(todo.id, 3);

      const result = moveCard(t.db, { cardId: a!, toColumnId: todo.id, toIndex: 999 });

      expect(cardOrder(t, todo.id)).toEqual([b, c, a]);
      expect(result.toIndex).toBe(2);
    });

    it('is a no-op when dropped back where it started', () => {
      const [a, b, c] = seed(todo.id, 3);

      moveCard(t.db, { cardId: b!, toColumnId: todo.id, toIndex: 1 });

      expect(cardOrder(t, todo.id)).toEqual([a, b, c]);
      expect(cardPositions(t, todo.id)).toEqual([0, 1, 2]);
    });

    it('leaves positions dense after several moves', () => {
      const ids = seed(todo.id, 5);

      moveCard(t.db, { cardId: ids[0]!, toColumnId: todo.id, toIndex: 4 });
      moveCard(t.db, { cardId: ids[3]!, toColumnId: todo.id, toIndex: 0 });
      moveCard(t.db, { cardId: ids[2]!, toColumnId: todo.id, toIndex: 2 });

      expect(cardPositions(t, todo.id)).toEqual([0, 1, 2, 3, 4]);
      expect(new Set(cardOrder(t, todo.id)).size).toBe(5);
    });
  });

  describe('moveCard across columns', () => {
    it('inserts at the requested index and renumbers the source', () => {
      const [a, b, c] = seed(todo.id, 3);
      const [x, y] = seed(doing.id, 2);

      moveCard(t.db, { cardId: b!, toColumnId: doing.id, toIndex: 1 });

      expect(cardOrder(t, todo.id)).toEqual([a, c]);
      expect(cardPositions(t, todo.id)).toEqual([0, 1]);
      expect(cardOrder(t, doing.id)).toEqual([x, b, y]);
      expect(cardPositions(t, doing.id)).toEqual([0, 1, 2]);
    });

    it('moves into an empty column', () => {
      const [a] = seed(todo.id, 1);

      moveCard(t.db, { cardId: a!, toColumnId: doing.id, toIndex: 0 });

      expect(cardOrder(t, todo.id)).toEqual([]);
      expect(cardOrder(t, doing.id)).toEqual([a]);
      expect(getCard(t.db, a!)?.columnId).toBe(doing.id);
    });

    it('stamps completion on entering a done column', () => {
      const [a] = seed(todo.id, 1);

      moveCard(t.db, { cardId: a!, toColumnId: done.id, toIndex: 0 });

      expect(getCard(t.db, a!)?.completedAt).not.toBeNull();
    });

    it('clears completion on leaving a done column', () => {
      const card = createCard(t.db, { columnId: done.id, title: 'Card', createdBy: 'admin' });
      expect(card.completedAt).not.toBeNull();

      moveCard(t.db, { cardId: card.id, toColumnId: todo.id, toIndex: 0 });

      expect(getCard(t.db, card.id)?.completedAt).toBeNull();
    });

    it('keeps the original completion time when moving between two done columns', () => {
      const otherDone = createColumn(t.db, { boardId: board.id, name: 'Archived', isDone: true });
      const card = createCard(t.db, { columnId: done.id, title: 'Card', createdBy: 'admin' });
      const stamped = getCard(t.db, card.id)?.completedAt;

      moveCard(t.db, { cardId: card.id, toColumnId: otherDone.id, toIndex: 0 });

      expect(getCard(t.db, card.id)?.completedAt).toBe(stamped);
    });

    it('refuses a column on another board', () => {
      const [a] = seed(todo.id, 1);
      const otherBoard = createBoard(t.db, {
        title: 'Other',
        ownerId: 'admin',
        withDefaultColumns: false,
      });
      const foreign = createColumn(t.db, { boardId: otherBoard.id, name: 'Foreign' });

      try {
        moveCard(t.db, { cardId: a!, toColumnId: foreign.id, toIndex: 0 });
        expect.unreachable('expected a GoalsError');
      } catch (err) {
        expect((err as GoalsError).code).toBe('CROSS_BOARD');
      }
      expect(getCard(t.db, a!)?.columnId).toBe(todo.id);
    });

    it('throws NOT_FOUND for an unknown card or column', () => {
      const [a] = seed(todo.id, 1);

      expect(() => moveCard(t.db, { cardId: 999, toColumnId: todo.id, toIndex: 0 })).toThrow(
        GoalsError
      );
      expect(() => moveCard(t.db, { cardId: a!, toColumnId: 999, toIndex: 0 })).toThrow(GoalsError);
    });

    it('refuses to move an archived card', () => {
      const [a] = seed(todo.id, 1);
      setCardArchived(t.db, a!, true);

      expect(() => moveCard(t.db, { cardId: a!, toColumnId: doing.id, toIndex: 0 })).toThrow(
        GoalsError
      );
    });

    it('ignores archived cards when computing the destination order', () => {
      const [x, y] = seed(doing.id, 2);
      setCardArchived(t.db, x!, true);
      const [a] = seed(todo.id, 1);

      moveCard(t.db, { cardId: a!, toColumnId: doing.id, toIndex: 0 });

      expect(cardOrder(t, doing.id)).toEqual([a, y]);
    });
  });

  describe('updateCard', () => {
    it('applies only the fields provided', () => {
      const card = createCard(t.db, {
        columnId: todo.id,
        title: 'Card',
        description: 'keep me',
        createdBy: 'admin',
      });

      const updated = updateCard(t.db, card.id, { title: 'Renamed' });

      expect(updated.title).toBe('Renamed');
      expect(updated.description).toBe('keep me');
    });

    it('can clear the assignee and the due date', () => {
      const member = createMember(t.db, { displayName: 'Ada', color: '#7c3aed', identity: null });
      const card = createCard(t.db, {
        columnId: todo.id,
        title: 'Card',
        createdBy: 'admin',
        assigneeId: member.id,
        dueDate: '2026-08-01',
      });

      const updated = updateCard(t.db, card.id, { assigneeId: null, dueDate: null });

      expect(updated.assigneeId).toBeNull();
      expect(updated.dueDate).toBeNull();
    });

    it('does not move the card', () => {
      const [a, b] = seed(todo.id, 2);
      updateCard(t.db, a!, { title: 'Renamed' });

      expect(cardOrder(t, todo.id)).toEqual([a, b]);
    });
  });

  describe('setCardArchived', () => {
    it('hides the card from the column and closes the gap', () => {
      const [a, b, c] = seed(todo.id, 3);

      setCardArchived(t.db, b!, true);

      expect(cardOrder(t, todo.id)).toEqual([a, c]);
      expect(listCardsInColumn(t.db, todo.id).map((x) => x.id)).toEqual([a, c]);
    });

    it('restores the card', () => {
      const [a] = seed(todo.id, 1);

      setCardArchived(t.db, a!, true);
      setCardArchived(t.db, a!, false);

      expect(cardOrder(t, todo.id)).toEqual([a]);
    });
  });

  describe('deleteCard', () => {
    it('removes the card, its comments, and closes the gap', () => {
      const [a, b, c] = seed(todo.id, 3);
      createComment(t.db, { cardId: b!, authorId: 'admin', body: 'bye' });

      deleteCard(t.db, b!);

      expect(getCard(t.db, b!)).toBeNull();
      expect(listComments(t.db, b!)).toEqual([]);
      expect(cardOrder(t, todo.id)).toEqual([a, c]);
      expect(cardPositions(t, todo.id)).toEqual([0, 1]);
    });

    it('throws NOT_FOUND for an unknown card', () => {
      expect(() => deleteCard(t.db, 999)).toThrow(GoalsError);
    });
  });
});

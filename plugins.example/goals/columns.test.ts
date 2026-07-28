import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GoalsError, type Board } from './types.js';
import { makeTestDb, columnOrder, cardOrder, type TestDb } from './test-support.js';
import { createBoard } from './boards.js';
import {
  listColumns,
  getColumn,
  createColumn,
  updateColumn,
  reorderColumns,
  deleteColumn,
  countCardsInColumn,
} from './columns.js';
import { createCard, getCard, setCardArchived } from './cards.js';
import { createComment, listComments } from './comments.js';

describe('goals columns', () => {
  let t: TestDb;
  let board: Board;

  beforeEach(() => {
    t = makeTestDb();
    board = createBoard(t.db, { title: 'B', ownerId: 'admin', withDefaultColumns: false });
  });

  afterEach(() => {
    t.close();
  });

  describe('createColumn', () => {
    it('appends after the last column', () => {
      const a = createColumn(t.db, { boardId: board.id, name: 'Todo' });
      const b = createColumn(t.db, { boardId: board.id, name: 'Doing' });

      expect(a.position).toBe(0);
      expect(b.position).toBe(1);
      expect(columnOrder(t, board.id)).toEqual([a.id, b.id]);
    });

    it('defaults colour and done flag', () => {
      const column = createColumn(t.db, { boardId: board.id, name: 'Todo' });

      expect(column.color).toBe('#7c3aed');
      expect(column.isDone).toBe(false);
      expect(column.wipLimit).toBeNull();
    });

    it('refuses past the per-board cap', () => {
      for (let i = 0; i < 20; i++) {
        createColumn(t.db, { boardId: board.id, name: `C${String(i)}` });
      }

      try {
        createColumn(t.db, { boardId: board.id, name: 'One too many' });
        expect.unreachable('expected a GoalsError');
      } catch (err) {
        expect((err as GoalsError).code).toBe('LIMIT_REACHED');
      }
    });
  });

  describe('updateColumn', () => {
    it('applies only the fields provided', () => {
      const column = createColumn(t.db, { boardId: board.id, name: 'Todo', color: '#06b6d4' });

      const updated = updateColumn(t.db, column.id, { name: 'Backlog' });

      expect(updated.name).toBe('Backlog');
      expect(updated.color).toBe('#06b6d4');
    });

    it('stamps completion on cards when the column becomes a done column', () => {
      const column = createColumn(t.db, { boardId: board.id, name: 'Todo' });
      const card = createCard(t.db, { columnId: column.id, title: 'Card', createdBy: 'admin' });
      expect(getCard(t.db, card.id)?.completedAt).toBeNull();

      updateColumn(t.db, column.id, { isDone: true });

      expect(getCard(t.db, card.id)?.completedAt).not.toBeNull();
    });

    it('clears completion when the column stops being a done column', () => {
      const column = createColumn(t.db, { boardId: board.id, name: 'Done', isDone: true });
      const card = createCard(t.db, { columnId: column.id, title: 'Card', createdBy: 'admin' });
      expect(getCard(t.db, card.id)?.completedAt).not.toBeNull();

      updateColumn(t.db, column.id, { isDone: false });

      expect(getCard(t.db, card.id)?.completedAt).toBeNull();
    });

    it('throws NOT_FOUND for an unknown column', () => {
      expect(() => updateColumn(t.db, 999, { name: 'X' })).toThrow(GoalsError);
    });
  });

  describe('reorderColumns', () => {
    it('renumbers to a dense sequence in the given order', () => {
      const a = createColumn(t.db, { boardId: board.id, name: 'A' });
      const b = createColumn(t.db, { boardId: board.id, name: 'B' });
      const c = createColumn(t.db, { boardId: board.id, name: 'C' });

      reorderColumns(t.db, board.id, [c.id, a.id, b.id]);

      expect(columnOrder(t, board.id)).toEqual([c.id, a.id, b.id]);
      expect(listColumns(t.db, board.id).map((x) => x.position)).toEqual([0, 1, 2]);
    });

    it('rejects a partial list', () => {
      const a = createColumn(t.db, { boardId: board.id, name: 'A' });
      createColumn(t.db, { boardId: board.id, name: 'B' });

      try {
        reorderColumns(t.db, board.id, [a.id]);
        expect.unreachable('expected a GoalsError');
      } catch (err) {
        expect((err as GoalsError).code).toBe('COUNT_MISMATCH');
      }
    });

    it('rejects an unknown id', () => {
      const a = createColumn(t.db, { boardId: board.id, name: 'A' });

      expect(() => reorderColumns(t.db, board.id, [a.id, 999])).toThrow(GoalsError);
    });

    it('rejects a column belonging to another board', () => {
      const a = createColumn(t.db, { boardId: board.id, name: 'A' });
      const otherBoard = createBoard(t.db, {
        title: 'Other',
        ownerId: 'admin',
        withDefaultColumns: false,
      });
      const foreign = createColumn(t.db, { boardId: otherBoard.id, name: 'Foreign' });

      expect(() => reorderColumns(t.db, board.id, [a.id, foreign.id])).toThrow(GoalsError);
      expect(getColumn(t.db, foreign.id)?.boardId).toBe(otherBoard.id);
    });
  });

  describe('deleteColumn', () => {
    it('refuses to remove a board last column', () => {
      const only = createColumn(t.db, { boardId: board.id, name: 'Only' });

      try {
        deleteColumn(t.db, { columnId: only.id, mode: 'delete', expectedCardCount: 0 });
        expect.unreachable('expected a GoalsError');
      } catch (err) {
        expect((err as GoalsError).code).toBe('LAST_COLUMN');
      }
    });

    it('refuses when the caller card count is stale', () => {
      const a = createColumn(t.db, { boardId: board.id, name: 'A' });
      createColumn(t.db, { boardId: board.id, name: 'B' });
      createCard(t.db, { columnId: a.id, title: 'Added since you loaded', createdBy: 'admin' });

      try {
        deleteColumn(t.db, { columnId: a.id, mode: 'delete', expectedCardCount: 0 });
        expect.unreachable('expected a GoalsError');
      } catch (err) {
        expect((err as GoalsError).code).toBe('COUNT_MISMATCH');
      }
      expect(getColumn(t.db, a.id)).not.toBeNull();
    });

    it('moves cards to the target tail preserving their order', () => {
      const from = createColumn(t.db, { boardId: board.id, name: 'From' });
      const to = createColumn(t.db, { boardId: board.id, name: 'To' });
      const existing = createCard(t.db, { columnId: to.id, title: 'Already here', createdBy: 'a' });
      const first = createCard(t.db, { columnId: from.id, title: 'First', createdBy: 'a' });
      const second = createCard(t.db, { columnId: from.id, title: 'Second', createdBy: 'a' });

      const result = deleteColumn(t.db, {
        columnId: from.id,
        mode: 'move',
        targetColumnId: to.id,
        expectedCardCount: 2,
      });

      expect(result.moved).toBe(2);
      expect(result.deleted).toBe(0);
      expect(cardOrder(t, to.id)).toEqual([existing.id, first.id, second.id]);
      expect(getColumn(t.db, from.id)).toBeNull();
    });

    it('marks moved cards complete when the target is a done column', () => {
      const from = createColumn(t.db, { boardId: board.id, name: 'From' });
      const done = createColumn(t.db, { boardId: board.id, name: 'Done', isDone: true });
      const card = createCard(t.db, { columnId: from.id, title: 'Card', createdBy: 'a' });

      deleteColumn(t.db, {
        columnId: from.id,
        mode: 'move',
        targetColumnId: done.id,
        expectedCardCount: 1,
      });

      expect(getCard(t.db, card.id)?.completedAt).not.toBeNull();
    });

    it('rejects a move target on another board', () => {
      const from = createColumn(t.db, { boardId: board.id, name: 'From' });
      createColumn(t.db, { boardId: board.id, name: 'Keep' });
      const otherBoard = createBoard(t.db, {
        title: 'Other',
        ownerId: 'admin',
        withDefaultColumns: false,
      });
      const foreign = createColumn(t.db, { boardId: otherBoard.id, name: 'Foreign' });

      try {
        deleteColumn(t.db, {
          columnId: from.id,
          mode: 'move',
          targetColumnId: foreign.id,
          expectedCardCount: 0,
        });
        expect.unreachable('expected a GoalsError');
      } catch (err) {
        expect((err as GoalsError).code).toBe('CROSS_BOARD');
      }
    });

    it('rejects moving cards into the column being deleted', () => {
      const from = createColumn(t.db, { boardId: board.id, name: 'From' });
      createColumn(t.db, { boardId: board.id, name: 'Keep' });

      expect(() =>
        deleteColumn(t.db, {
          columnId: from.id,
          mode: 'move',
          targetColumnId: from.id,
          expectedCardCount: 0,
        })
      ).toThrow(GoalsError);
    });

    it('deletes cards and their comments in delete mode', () => {
      const doomed = createColumn(t.db, { boardId: board.id, name: 'Doomed' });
      const keeper = createColumn(t.db, { boardId: board.id, name: 'Keeper' });
      const card = createCard(t.db, { columnId: doomed.id, title: 'Card', createdBy: 'a' });
      createComment(t.db, { cardId: card.id, authorId: 'a', body: 'bye' });
      const survivor = createCard(t.db, { columnId: keeper.id, title: 'Survivor', createdBy: 'a' });
      createComment(t.db, { cardId: survivor.id, authorId: 'a', body: 'stays' });

      const result = deleteColumn(t.db, {
        columnId: doomed.id,
        mode: 'delete',
        expectedCardCount: 1,
      });

      expect(result.deleted).toBe(1);
      expect(getCard(t.db, card.id)).toBeNull();
      expect(getCard(t.db, survivor.id)).not.toBeNull();
      expect(listComments(t.db, survivor.id)).toHaveLength(1);
    });

    it('closes the position gap the removed column left', () => {
      const a = createColumn(t.db, { boardId: board.id, name: 'A' });
      const b = createColumn(t.db, { boardId: board.id, name: 'B' });
      const c = createColumn(t.db, { boardId: board.id, name: 'C' });

      deleteColumn(t.db, { columnId: b.id, mode: 'delete', expectedCardCount: 0 });

      expect(columnOrder(t, board.id)).toEqual([a.id, c.id]);
      expect(listColumns(t.db, board.id).map((x) => x.position)).toEqual([0, 1]);
    });
  });

  describe('countCardsInColumn', () => {
    it('counts the cards a viewer can see', () => {
      const column = createColumn(t.db, { boardId: board.id, name: 'A' });
      createCard(t.db, { columnId: column.id, title: 'One', createdBy: 'a' });

      expect(countCardsInColumn(t.db, column.id)).toBe(1);
    });

    it('excludes archived cards, which the client never counted either', () => {
      const column = createColumn(t.db, { boardId: board.id, name: 'A' });
      const card = createCard(t.db, { columnId: column.id, title: 'Hidden', createdBy: 'a' });
      setCardArchived(t.db, card.id, true);

      expect(countCardsInColumn(t.db, column.id)).toBe(0);
    });

    it('lets a column with archived cards still be deleted', () => {
      const doomed = createColumn(t.db, { boardId: board.id, name: 'Doomed' });
      createColumn(t.db, { boardId: board.id, name: 'Keeper' });
      const card = createCard(t.db, { columnId: doomed.id, title: 'Hidden', createdBy: 'a' });
      setCardArchived(t.db, card.id, true);

      // The client sends the count it rendered, which is 0. Counting the
      // archived card server-side would make this permanently un-deletable.
      expect(() =>
        deleteColumn(t.db, { columnId: doomed.id, mode: 'delete', expectedCardCount: 0 })
      ).not.toThrow();
      expect(getColumn(t.db, doomed.id)).toBeNull();
    });
  });
});

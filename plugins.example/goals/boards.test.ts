import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GoalsError } from './types.js';
import { makeTestDb, type TestDb } from './test-support.js';
import {
  listBoards,
  listBoardsFor,
  getBoard,
  createBoard,
  updateBoard,
  deleteBoard,
  getDefaultBoard,
  reorderBoards,
} from './boards.js';
import { DEFAULT_COLUMNS, seedDefaultBoard } from './schema.js';
import { createColumn } from './columns.js';
import { createCard } from './cards.js';
import { createComment } from './comments.js';

const owner = { userId: 'web:andy', isAdmin: false };
const other = { userId: 'U999', isAdmin: false };
const admin = { userId: 'admin', isAdmin: true };

describe('goals boards', () => {
  let t: TestDb;

  beforeEach(() => {
    t = makeTestDb();
  });

  afterEach(() => {
    t.close();
  });

  describe('createBoard', () => {
    it('stores the board with its owner and default visibility', () => {
      const board = createBoard(t.db, { title: 'Andy goals', ownerId: 'web:andy' });

      expect(board.title).toBe('Andy goals');
      expect(board.ownerId).toBe('web:andy');
      expect(board.visibility).toBe('shared');
      expect(board.isDefault).toBe(false);
    });

    it('seeds the starter columns', () => {
      const board = createBoard(t.db, { title: 'B', ownerId: 'admin' });

      const names = (
        t.raw
          .prepare(`SELECT name FROM ${t.db.prefix}columns WHERE board_id = ? ORDER BY position`)
          .all(board.id) as { name: string }[]
      ).map((c) => c.name);

      expect(names).toEqual(DEFAULT_COLUMNS.map((c) => c.name));
    });

    it('can skip the starter columns', () => {
      const board = createBoard(t.db, {
        title: 'B',
        ownerId: 'admin',
        withDefaultColumns: false,
      });

      const count = t.raw
        .prepare(`SELECT COUNT(*) AS c FROM ${t.db.prefix}columns WHERE board_id = ?`)
        .get(board.id) as { c: number };
      expect(count.c).toBe(0);
    });

    it('appends each board after the last', () => {
      const first = createBoard(t.db, { title: 'One', ownerId: 'admin' });
      const second = createBoard(t.db, { title: 'Two', ownerId: 'admin' });

      expect(second.position).toBeGreaterThan(first.position);
    });

    it('refuses past the per-owner cap', () => {
      for (let i = 0; i < 50; i++) {
        createBoard(t.db, { title: `B${String(i)}`, ownerId: 'admin', withDefaultColumns: false });
      }

      try {
        createBoard(t.db, { title: 'One too many', ownerId: 'admin' });
        expect.unreachable('expected a GoalsError');
      } catch (err) {
        expect((err as GoalsError).code).toBe('LIMIT_REACHED');
      }
    });

    it('counts the cap per owner, not globally', () => {
      for (let i = 0; i < 50; i++) {
        createBoard(t.db, { title: `B${String(i)}`, ownerId: 'admin', withDefaultColumns: false });
      }

      expect(() =>
        createBoard(t.db, { title: 'Mine', ownerId: 'web:andy', withDefaultColumns: false })
      ).not.toThrow();
    });
  });

  describe('listBoardsFor', () => {
    it('hides a private board from everyone but its owner and admins', () => {
      createBoard(t.db, { title: 'Shared', ownerId: 'web:andy', visibility: 'shared' });
      createBoard(t.db, { title: 'Andy only', ownerId: 'web:andy', visibility: 'private' });

      expect(listBoardsFor(t.db, owner).map((b) => b.title)).toEqual(['Shared', 'Andy only']);
      expect(listBoardsFor(t.db, other).map((b) => b.title)).toEqual(['Shared']);
      expect(listBoardsFor(t.db, admin).map((b) => b.title)).toEqual(['Shared', 'Andy only']);
    });
  });

  describe('updateBoard', () => {
    it('applies only the fields provided', () => {
      const board = createBoard(t.db, { title: 'B', ownerId: 'admin', description: 'keep me' });

      const updated = updateBoard(t.db, board.id, { title: 'Renamed' });

      expect(updated.title).toBe('Renamed');
      expect(updated.description).toBe('keep me');
    });

    it('can flip visibility', () => {
      const board = createBoard(t.db, { title: 'B', ownerId: 'admin' });
      expect(updateBoard(t.db, board.id, { visibility: 'private' }).visibility).toBe('private');
    });

    it('throws NOT_FOUND for an unknown board', () => {
      expect(() => updateBoard(t.db, 999, { title: 'X' })).toThrow(GoalsError);
    });
  });

  describe('deleteBoard', () => {
    it('removes the board and cascades to columns, cards and comments', () => {
      const board = createBoard(t.db, { title: 'B', ownerId: 'admin', withDefaultColumns: false });
      const column = createColumn(t.db, { boardId: board.id, name: 'Todo' });
      const card = createCard(t.db, { columnId: column.id, title: 'Card', createdBy: 'admin' });
      createComment(t.db, { cardId: card.id, authorId: 'admin', body: 'Hi' });

      deleteBoard(t.db, board.id);

      const count = (table: string) =>
        (t.raw.prepare(`SELECT COUNT(*) AS c FROM ${t.db.prefix}${table}`).get() as { c: number }).c;

      expect(getBoard(t.db, board.id)).toBeNull();
      expect(count('columns')).toBe(0);
      expect(count('cards')).toBe(0);
      expect(count('comments')).toBe(0);
    });

    it('leaves other boards untouched', () => {
      const doomed = createBoard(t.db, { title: 'Doomed', ownerId: 'admin' });
      const keeper = createBoard(t.db, { title: 'Keeper', ownerId: 'admin' });
      const keeperColumn = createColumn(t.db, { boardId: keeper.id, name: 'Todo' });
      const keeperCard = createCard(t.db, {
        columnId: keeperColumn.id,
        title: 'Survivor',
        createdBy: 'admin',
      });
      createComment(t.db, { cardId: keeperCard.id, authorId: 'admin', body: 'stays' });

      deleteBoard(t.db, doomed.id);

      expect(getBoard(t.db, keeper.id)).not.toBeNull();
      const cards = t.raw
        .prepare(`SELECT COUNT(*) AS c FROM ${t.db.prefix}cards WHERE board_id = ?`)
        .get(keeper.id) as { c: number };
      const comments = t.raw
        .prepare(`SELECT COUNT(*) AS c FROM ${t.db.prefix}comments WHERE card_id = ?`)
        .get(keeperCard.id) as { c: number };
      expect(cards.c).toBe(1);
      expect(comments.c).toBe(1);
    });

    it('throws NOT_FOUND for an unknown board', () => {
      expect(() => deleteBoard(t.db, 999)).toThrow(GoalsError);
    });
  });

  describe('getDefaultBoard', () => {
    it('prefers the seeded default board', () => {
      createBoard(t.db, { title: 'Other', ownerId: 'admin' });
      const seeded = seedDefaultBoard(t.db, 'admin');

      expect(getDefaultBoard(t.db)?.id).toBe(seeded);
    });

    it('falls back to the first board when none is marked default', () => {
      const first = createBoard(t.db, { title: 'First', ownerId: 'admin' });
      createBoard(t.db, { title: 'Second', ownerId: 'admin' });

      expect(getDefaultBoard(t.db)?.id).toBe(first.id);
    });

    it('returns null when there are no boards', () => {
      expect(getDefaultBoard(t.db)).toBeNull();
    });
  });

  describe('reorderBoards', () => {
    it('renumbers to a dense sequence in the given order', () => {
      const a = createBoard(t.db, { title: 'A', ownerId: 'admin' });
      const b = createBoard(t.db, { title: 'B', ownerId: 'admin' });
      const c = createBoard(t.db, { title: 'C', ownerId: 'admin' });

      reorderBoards(t.db, [c.id, a.id, b.id]);

      expect(listBoards(t.db).map((x) => x.id)).toEqual([c.id, a.id, b.id]);
      expect(listBoards(t.db).map((x) => x.position)).toEqual([0, 1, 2]);
    });

    it('rejects a partial list', () => {
      const a = createBoard(t.db, { title: 'A', ownerId: 'admin' });
      createBoard(t.db, { title: 'B', ownerId: 'admin' });

      expect(() => reorderBoards(t.db, [a.id])).toThrow(GoalsError);
    });

    it('rejects an unknown id', () => {
      const a = createBoard(t.db, { title: 'A', ownerId: 'admin' });

      expect(() => reorderBoards(t.db, [a.id, 999])).toThrow(GoalsError);
    });
  });
});

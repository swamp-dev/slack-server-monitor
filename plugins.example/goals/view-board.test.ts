import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Actor, BoardView } from './types.js';
import { makeTestDb, type TestDb } from './test-support.js';
import { createBoard } from './boards.js';
import { createColumn, updateColumn } from './columns.js';
import { createCard } from './cards.js';
import { createComment } from './comments.js';
import { createMember } from './members.js';
import { loadBoardView } from './queries.js';
import {
  renderBoardPage,
  renderColumnsRegion,
  initials,
  dueTone,
  dueLabel,
  safeColor,
} from './view-board.js';

const admin: Actor = { userId: 'admin', isAdmin: true };
const guest: Actor = { userId: 'U999', isAdmin: false };
const TODAY = '2026-07-25';

describe('goals board view', () => {
  let t: TestDb;
  let view: BoardView;
  let todoId: number;
  let doneId: number;

  beforeEach(() => {
    t = makeTestDb();
    const board = createBoard(t.db, {
      title: 'Family goals',
      ownerId: 'admin',
      withDefaultColumns: false,
    });
    const todo = createColumn(t.db, { boardId: board.id, name: 'Todo', color: '#7c3aed' });
    const done = createColumn(t.db, { boardId: board.id, name: 'Done', isDone: true });
    todoId = todo.id;
    doneId = done.id;

    const ada = createMember(t.db, { displayName: 'Ada Lovelace', color: '#ec4899', identity: null });
    createCard(t.db, {
      columnId: todo.id,
      title: 'Learn to sail',
      createdBy: 'admin',
      assigneeId: ada.id,
      dueDate: '2026-08-01',
    });
    createCard(t.db, { columnId: todo.id, title: 'Fix the shed', createdBy: 'admin' });
    createCard(t.db, { columnId: done.id, title: 'Book the ferry', createdBy: 'admin' });

    view = loadBoardView(t.db, board.id, TODAY)!;
  });

  afterEach(() => {
    t.close();
  });

  describe('helpers', () => {
    it('builds initials from one or two names', () => {
      expect(initials('Ada')).toBe('AD');
      expect(initials('Ada Lovelace')).toBe('AL');
      expect(initials('Ada Byron Lovelace')).toBe('AL');
      expect(initials('   ')).toBe('?');
    });

    it('grades due dates by urgency', () => {
      expect(dueTone('2026-07-24', TODAY)).toBe('overdue');
      expect(dueTone('2026-07-25', TODAY)).toBe('today');
      expect(dueTone('2026-07-30', TODAY)).toBe('soon');
      expect(dueTone('2026-09-01', TODAY)).toBe('later');
    });

    it('labels due dates for humans', () => {
      expect(dueLabel('2026-07-24', TODAY)).toBe('Overdue');
      expect(dueLabel('2026-07-25', TODAY)).toBe('Today');
      expect(dueLabel('2026-07-30', TODAY)).toBe('Thu');
      expect(dueLabel('2026-09-01', TODAY)).toBe('1 Sep');
    });

    it('falls back when a stored colour is not a hex value', () => {
      expect(safeColor('#7C3AED')).toBe('#7c3aed');
      expect(safeColor('red; background:url(x)')).toBe('#64748b');
      expect(safeColor(null)).toBe('#64748b');
    });
  });

  describe('renderColumnsRegion', () => {
    it('renders columns in order with their cards in order', () => {
      const html = renderColumnsRegion(view, admin, TODAY);

      const columnIds = [...html.matchAll(/data-column-id="(\d+)"/g)].map((m) => m[1]);
      expect(columnIds[0]).toBe(String(todoId));
      expect(html.indexOf('Learn to sail')).toBeLessThan(html.indexOf('Fix the shed'));
      expect(html.indexOf('Fix the shed')).toBeLessThan(html.indexOf('Book the ferry'));
    });

    it('tags each card with the ids the drag code needs', () => {
      const html = renderColumnsRegion(view, admin, TODAY);
      expect(html).toMatch(/<li class="goals-card[^"]*" role="listitem" tabindex="0" data-card-id="\d+"/);
      expect(html).toContain(`data-column-id="${String(doneId)}"`);
    });

    it('shows the assignee chip with the member colour', () => {
      const html = renderColumnsRegion(view, admin, TODAY);
      expect(html).toContain('background:#ec4899');
      expect(html).toContain('>AL<');
      expect(html).toContain('Assigned to Ada Lovelace');
    });

    it('grades the due-date badge', () => {
      const html = renderColumnsRegion(view, admin, TODAY);
      expect(html).toContain('goals-due is-soon');
    });

    it('marks cards in a done column as complete', () => {
      const html = renderColumnsRegion(view, admin, TODAY);
      expect(html).toContain('goals-card is-done');
    });

    it('shows a comment count only when there are comments', () => {
      const card = view.columns[0]!.cards[0]!;
      createComment(t.db, { cardId: card.id, authorId: 'admin', body: 'hi' });
      const refreshed = loadBoardView(t.db, view.board.id, TODAY)!;

      const html = renderColumnsRegion(refreshed, admin, TODAY);
      expect(html).toContain('1 comment(s)');
      expect([...html.matchAll(/comment\(s\)/g)]).toHaveLength(1);
    });

    it('flags a column over its card limit', () => {
      updateColumn(t.db, todoId, { wipLimit: 1 });
      const refreshed = loadBoardView(t.db, view.board.id, TODAY)!;

      expect(renderColumnsRegion(refreshed, admin, TODAY)).toContain('goals-column-count is-over');
    });

    it('offers column editing only to a board admin', () => {
      expect(renderColumnsRegion(view, admin, TODAY)).toContain('goals-column-edit');
      expect(renderColumnsRegion(view, guest, TODAY)).not.toContain('goals-column-edit');

      expect(renderColumnsRegion(view, admin, TODAY)).toContain('goals-add-column');
      expect(renderColumnsRegion(view, guest, TODAY)).not.toContain('goals-add-column');
    });

    it('still lets a non-admin add cards to a shared board', () => {
      expect(renderColumnsRegion(view, guest, TODAY)).toContain('goals-add-card');
    });

    it('carries list semantics for assistive technology', () => {
      const html = renderColumnsRegion(view, admin, TODAY);
      expect(html).toContain('role="list"');
      expect(html).toContain('role="listitem"');
      expect(html).toContain('aria-label="Todo"');
      expect(html).toContain('aria-haspopup="menu"');
    });

    it('sizes each column rail by its share of the board', () => {
      const html = renderColumnsRegion(view, admin, TODAY);
      expect(html).toContain('--goals-column-share:67%');
      expect(html).toContain('--goals-column-share:33%');
    });

    it('omits the trajectory bar on an empty board', () => {
      const empty = createBoard(t.db, {
        title: 'Empty',
        ownerId: 'admin',
        withDefaultColumns: false,
      });
      createColumn(t.db, { boardId: empty.id, name: 'Todo' });
      const emptyView = loadBoardView(t.db, empty.id, TODAY)!;

      expect(renderColumnsRegion(emptyView, admin, TODAY)).not.toContain('goals-trajectory');
    });
  });

  describe('escaping', () => {
    it('escapes a hostile card title everywhere it appears', () => {
      createCard(t.db, {
        columnId: todoId,
        title: '<script>alert(1)</script>',
        createdBy: 'admin',
      });
      const refreshed = loadBoardView(t.db, view.board.id, TODAY)!;

      const html = renderColumnsRegion(refreshed, admin, TODAY);
      expect(html).not.toContain('<script>alert(1)</script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('escapes a hostile column name', () => {
      createColumn(t.db, { boardId: view.board.id, name: '"><img src=x onerror=1>' });
      const refreshed = loadBoardView(t.db, view.board.id, TODAY)!;

      const html = renderColumnsRegion(refreshed, admin, TODAY);
      expect(html).not.toContain('<img src=x');
      expect(html).toContain('&lt;img');
    });

    it('escapes a hostile member name', () => {
      const evil = createMember(t.db, {
        displayName: '"><b>bad</b>',
        color: '#7c3aed',
        identity: null,
      });
      createCard(t.db, {
        columnId: todoId,
        title: 'Assigned',
        createdBy: 'admin',
        assigneeId: evil.id,
      });
      const refreshed = loadBoardView(t.db, view.board.id, TODAY)!;

      const html = renderColumnsRegion(refreshed, admin, TODAY);
      expect(html).not.toContain('<b>bad</b>');
    });

    it('neutralises a colour written straight into the database', () => {
      t.raw
        .prepare(`UPDATE ${t.db.prefix}columns SET color = ? WHERE id = ?`)
        .run('#fff;position:fixed', todoId);
      const refreshed = loadBoardView(t.db, view.board.id, TODAY)!;

      const html = renderColumnsRegion(refreshed, admin, TODAY);
      expect(html).not.toContain('position:fixed');
      expect(html).toContain('--goals-column-color:#64748b');
    });
  });

  describe('renderBoardPage', () => {
    it('wraps the region and includes the live region and dialogs', () => {
      const html = renderBoardPage(view, admin, TODAY);

      expect(html).toContain('id="goals-region"');
      expect(html).toContain('id="goals-live"');
      expect(html).toContain('aria-live="polite"');
      expect(html).toContain('id="goals-card-dialog"');
      expect(html).toContain('id="goals-new-card-dialog"');
    });

    it('shows admin-only dialogs to the owner and not to a guest', () => {
      expect(renderBoardPage(view, admin, TODAY)).toContain('id="goals-column-dialog"');
      expect(renderBoardPage(view, admin, TODAY)).toContain('id="goals-board-dialog"');

      const guestHtml = renderBoardPage(view, guest, TODAY);
      expect(guestHtml).not.toContain('id="goals-column-dialog"');
      expect(guestHtml).not.toContain('id="goals-board-dialog"');
      expect(guestHtml).not.toContain('goals-board-settings');
    });

    it('escapes the board title', () => {
      const hostile = createBoard(t.db, {
        title: '<img src=x>',
        ownerId: 'admin',
        withDefaultColumns: false,
      });
      createColumn(t.db, { boardId: hostile.id, name: 'Todo' });
      const hostileView = loadBoardView(t.db, hostile.id, TODAY)!;

      const html = renderBoardPage(hostileView, admin, TODAY);
      expect(html).not.toContain('<img src=x>');
      expect(html).toContain('&lt;img src=x&gt;');
    });

    it('summarises progress when the board has no description', () => {
      expect(renderBoardPage(view, admin, TODAY)).toContain('1 of 3 done');
    });
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Actor } from './types.js';
import { makeTestDb, type TestDb } from './test-support.js';
import { createBoard } from './boards.js';
import { createColumn } from './columns.js';
import { createCard } from './cards.js';
import { loadIndexView } from './queries.js';
import { renderBoardsIndex } from './view-index.js';

const admin: Actor = { userId: 'admin', isAdmin: true };
const guest: Actor = { userId: 'U999', isAdmin: false };
const TODAY = '2026-07-25';

describe('goals index view', () => {
  let t: TestDb;

  beforeEach(() => {
    t = makeTestDb();
  });

  afterEach(() => {
    t.close();
  });

  it('renders a tile per board with its progress', () => {
    const board = createBoard(t.db, {
      title: 'Family goals',
      description: 'Everything together',
      ownerId: 'admin',
      withDefaultColumns: false,
    });
    const todo = createColumn(t.db, { boardId: board.id, name: 'Todo' });
    const done = createColumn(t.db, { boardId: board.id, name: 'Done', isDone: true });
    createCard(t.db, { columnId: todo.id, title: 'Open one', createdBy: 'admin' });
    createCard(t.db, { columnId: todo.id, title: 'Open two', createdBy: 'admin' });
    createCard(t.db, { columnId: done.id, title: 'Finished', createdBy: 'admin' });

    const html = renderBoardsIndex(loadIndexView(t.db, admin, TODAY), admin);

    expect(html).toContain('Family goals');
    expect(html).toContain('Everything together');
    expect(html).toContain(`href="/p/goals/b/${String(board.id)}"`);
    expect(html).toContain('>2</span>');
    expect(html).toContain('open of 3');
    expect(html).toContain('width:33%');
    expect(html).toContain('2 columns');
  });

  it('flags overdue work', () => {
    const board = createBoard(t.db, { title: 'B', ownerId: 'admin', withDefaultColumns: false });
    const todo = createColumn(t.db, { boardId: board.id, name: 'Todo' });
    createCard(t.db, { columnId: todo.id, title: 'Late', createdBy: 'a', dueDate: '2020-01-01' });

    const html = renderBoardsIndex(loadIndexView(t.db, admin, TODAY), admin);

    expect(html).toContain('1 overdue');
    expect(html).toContain('goals-due is-overdue');
  });

  it('marks a private board and hides it from other people', () => {
    createBoard(t.db, {
      title: 'Andy only',
      ownerId: 'web:andy',
      visibility: 'private',
      withDefaultColumns: false,
    });

    expect(renderBoardsIndex(loadIndexView(t.db, admin, TODAY), admin)).toContain('Private');
    expect(renderBoardsIndex(loadIndexView(t.db, guest, TODAY), guest)).not.toContain('Andy only');
  });

  it('invites the first board when there are none', () => {
    const html = renderBoardsIndex(loadIndexView(t.db, admin, TODAY), admin);

    expect(html).toContain('Nothing planned yet');
    expect(html).toContain('goals-new-board-empty');
    expect(html).not.toContain('goals-board-grid');
  });

  it('escapes a hostile board title and description', () => {
    createBoard(t.db, {
      title: '<script>alert(1)</script>',
      description: '"><img src=x>',
      ownerId: 'admin',
      withDefaultColumns: false,
    });

    const html = renderBoardsIndex(loadIndexView(t.db, admin, TODAY), admin);

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('always offers the new-board dialog', () => {
    const html = renderBoardsIndex(loadIndexView(t.db, admin, TODAY), admin);
    expect(html).toContain('id="goals-new-board-dialog"');
    expect(html).toContain('action="/p/goals/boards/create"');
  });
});

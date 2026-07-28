import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTestDb, type TestDb } from './test-support.js';
import { createBoard } from './boards.js';
import { createColumn } from './columns.js';
import { createCard, setCardArchived } from './cards.js';
import { setWidgetDb, getGoalsWidgets } from './widgets.js';

const TODAY = '2026-07-25';

describe('goals dashboard widget', () => {
  let t: TestDb;

  beforeEach(() => {
    t = makeTestDb();
    setWidgetDb(t.db);
  });

  afterEach(() => {
    setWidgetDb(null);
    t.close();
  });

  it('renders nothing before the plugin has initialised', () => {
    setWidgetDb(null);
    expect(getGoalsWidgets(TODAY)).toEqual([]);
  });

  it('invites a first board when there are none', () => {
    const [widget] = getGoalsWidgets(TODAY);

    expect(widget?.title).toBe('Goals');
    expect(widget?.html).toContain('No boards yet');
    expect(widget?.link).toBe('/p/goals/');
  });

  it('counts open work across boards', () => {
    const board = createBoard(t.db, { title: 'B', ownerId: 'admin', withDefaultColumns: false });
    const todo = createColumn(t.db, { boardId: board.id, name: 'Todo' });
    const done = createColumn(t.db, { boardId: board.id, name: 'Done', isDone: true });
    createCard(t.db, { columnId: todo.id, title: 'One', createdBy: 'a' });
    createCard(t.db, { columnId: todo.id, title: 'Two', createdBy: 'a' });
    createCard(t.db, { columnId: done.id, title: 'Finished', createdBy: 'a' });

    const [widget] = getGoalsWidgets(TODAY);

    expect(widget?.html).toContain('>2</p>');
    expect(widget?.html).toContain('open across 1 board(s)');
  });

  it('excludes archived cards', () => {
    const board = createBoard(t.db, { title: 'B', ownerId: 'admin', withDefaultColumns: false });
    const todo = createColumn(t.db, { boardId: board.id, name: 'Todo' });
    const card = createCard(t.db, { columnId: todo.id, title: 'Hidden', createdBy: 'a' });
    setCardArchived(t.db, card.id, true);

    expect(getGoalsWidgets(TODAY)[0]?.html).toContain('>0</p>');
  });

  it('surfaces overdue and due-today counts', () => {
    const board = createBoard(t.db, { title: 'B', ownerId: 'admin', withDefaultColumns: false });
    const todo = createColumn(t.db, { boardId: board.id, name: 'Todo' });
    createCard(t.db, { columnId: todo.id, title: 'Late', createdBy: 'a', dueDate: '2026-07-01' });
    createCard(t.db, { columnId: todo.id, title: 'Now', createdBy: 'a', dueDate: TODAY });

    const html = getGoalsWidgets(TODAY)[0]?.html ?? '';

    expect(html).toContain('1 overdue');
    expect(html).toContain('1 due today');
  });

  it('leaves private boards out of a tile everyone can see', () => {
    const shared = createBoard(t.db, { title: 'Shared', ownerId: 'admin', withDefaultColumns: false });
    const sharedTodo = createColumn(t.db, { boardId: shared.id, name: 'Todo' });
    createCard(t.db, { columnId: sharedTodo.id, title: 'Everyone sees this', createdBy: 'a' });

    const priv = createBoard(t.db, {
      title: 'Private',
      ownerId: 'web:andy',
      visibility: 'private',
      withDefaultColumns: false,
    });
    const privTodo = createColumn(t.db, { boardId: priv.id, name: 'Todo' });
    createCard(t.db, { columnId: privTodo.id, title: 'Secret', createdBy: 'web:andy' });
    createCard(t.db, {
      columnId: privTodo.id,
      title: 'Secret and late',
      createdBy: 'web:andy',
      dueDate: '2026-07-01',
    });

    const html = getGoalsWidgets(TODAY)[0]?.html ?? '';

    expect(html).toContain('>1</p>');
    expect(html).toContain('open across 1 board(s)');
    expect(html).toContain('nothing overdue');
  });

  it('says when nothing is overdue', () => {
    const board = createBoard(t.db, { title: 'B', ownerId: 'admin', withDefaultColumns: false });
    createColumn(t.db, { boardId: board.id, name: 'Todo' });

    expect(getGoalsWidgets(TODAY)[0]?.html).toContain('nothing overdue');
  });

  it('stays quiet rather than breaking the dashboard if the tables are missing', () => {
    t.raw.exec(`DROP TABLE ${t.db.prefix}cards`);

    expect(getGoalsWidgets(TODAY)).toEqual([]);
  });

  it('renders quickly enough for a per-render dashboard call', () => {
    const board = createBoard(t.db, { title: 'B', ownerId: 'admin', withDefaultColumns: false });
    const todo = createColumn(t.db, { boardId: board.id, name: 'Todo' });
    for (let i = 0; i < 200; i++) {
      createCard(t.db, { columnId: todo.id, title: `Card ${String(i)}`, createdBy: 'a' });
    }

    const started = performance.now();
    getGoalsWidgets(TODAY);
    expect(performance.now() - started).toBeLessThan(100);
  });
});

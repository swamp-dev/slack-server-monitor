import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Actor } from './types.js';
import { makeTestDb, type TestDb } from './test-support.js';
import { createBoard } from './boards.js';
import { createColumn } from './columns.js';
import { createCard, getCard } from './cards.js';
import { createMember } from './members.js';
import { seedDefaultBoard } from './schema.js';
import { LIMITS } from './validation.js';
import { handleGoalsCommand } from './commands.js';

const slack: Actor = { userId: 'U012ABC', isAdmin: false };
const options = { baseUrl: 'https://home.example', today: '2026-07-25' };

describe('/goals command', () => {
  let t: TestDb;

  beforeEach(() => {
    t = makeTestDb();
  });

  afterEach(() => {
    t.close();
  });

  function seedBoard() {
    const board = createBoard(t.db, {
      title: 'Family goals',
      ownerId: 'admin',
      withDefaultColumns: false,
    });
    const todo = createColumn(t.db, { boardId: board.id, name: 'Todo' });
    const done = createColumn(t.db, { boardId: board.id, name: 'Done', isDone: true });
    return { board, todo, done };
  }

  describe('listing', () => {
    it('groups open goals by board with their column', () => {
      const { todo } = seedBoard();
      createCard(t.db, { columnId: todo.id, title: 'Learn to sail', createdBy: 'admin' });

      const reply = handleGoalsCommand(t.db, '', slack, options);

      expect(reply).toContain('*Family goals*');
      expect(reply).toContain('Learn to sail');
      expect(reply).toContain('_(Todo)_');
      expect(reply).toContain('https://home.example/p/goals/');
    });

    it('treats an explicit list subcommand the same as no arguments', () => {
      const { todo } = seedBoard();
      createCard(t.db, { columnId: todo.id, title: 'Learn to sail', createdBy: 'admin' });

      expect(handleGoalsCommand(t.db, 'list', slack, options)).toBe(
        handleGoalsCommand(t.db, '', slack, options)
      );
    });

    it('skips completed goals', () => {
      const { todo, done } = seedBoard();
      createCard(t.db, { columnId: todo.id, title: 'Still open', createdBy: 'admin' });
      createCard(t.db, { columnId: done.id, title: 'Already finished', createdBy: 'admin' });

      const reply = handleGoalsCommand(t.db, '', slack, options);

      expect(reply).toContain('Still open');
      expect(reply).not.toContain('Already finished');
    });

    it('flags overdue and due-today work', () => {
      const { todo } = seedBoard();
      createCard(t.db, { columnId: todo.id, title: 'Late', createdBy: 'admin', dueDate: '2026-07-01' });
      createCard(t.db, { columnId: todo.id, title: 'Now', createdBy: 'admin', dueDate: '2026-07-25' });

      const reply = handleGoalsCommand(t.db, '', slack, options);

      expect(reply).toContain(':warning: overdue 2026-07-01');
      expect(reply).toContain('due today');
    });

    it('names the assignee when there is one', () => {
      const { todo } = seedBoard();
      const ada = createMember(t.db, { displayName: 'Ada', color: '#7c3aed', identity: null });
      createCard(t.db, { columnId: todo.id, title: 'Theirs', createdBy: 'admin', assigneeId: ada.id });

      expect(handleGoalsCommand(t.db, '', slack, options)).toContain('— Ada');
    });

    it('hides goals on private boards the caller cannot see', () => {
      const priv = createBoard(t.db, {
        title: 'Secret',
        ownerId: 'web:someone',
        visibility: 'private',
        withDefaultColumns: false,
      });
      const column = createColumn(t.db, { boardId: priv.id, name: 'Todo' });
      createCard(t.db, { columnId: column.id, title: 'Hidden', createdBy: 'web:someone' });

      expect(handleGoalsCommand(t.db, '', slack, options)).not.toContain('Hidden');
    });

    it('says so when nothing is open', () => {
      seedBoard();
      expect(handleGoalsCommand(t.db, '', slack, options)).toContain('Nothing open');
    });

    it('escapes Slack mrkdwn control characters in a title', () => {
      const { todo } = seedBoard();
      createCard(t.db, { columnId: todo.id, title: '<!channel> & friends', createdBy: 'admin' });

      const reply = handleGoalsCommand(t.db, '', slack, options);

      expect(reply).not.toContain('<!channel>');
      expect(reply).toContain('&lt;!channel&gt; &amp; friends');
    });
  });

  describe('add', () => {
    it('adds to the default board first open column', () => {
      const boardId = seedDefaultBoard(t.db, 'admin');

      const reply = handleGoalsCommand(t.db, 'add Book the ferry', slack, options);

      expect(reply).toContain('Added *Book the ferry*');
      expect(reply).toContain('Family goals');
      expect(reply).toContain('https://home.example/p/goals/card/');

      const row = t.raw
        .prepare(
          `SELECT c.title, col.name AS column_name FROM ${t.db.prefix}cards c
           JOIN ${t.db.prefix}columns col ON col.id = c.column_id WHERE c.board_id = ?`
        )
        .get(boardId) as { title: string; column_name: string };
      expect(row.title).toBe('Book the ferry');
      expect(row.column_name).toBe('Someday');
    });

    it('assigns to the roster member linked to this Slack account', () => {
      seedDefaultBoard(t.db, 'admin');
      const ada = createMember(t.db, { displayName: 'Ada', color: '#7c3aed', identity: 'U012ABC' });

      const reply = handleGoalsCommand(t.db, 'add Book the ferry', slack, options);

      expect(reply).toContain('assigned to Ada');
      const card = t.raw
        .prepare(`SELECT assignee_id FROM ${t.db.prefix}cards`)
        .get() as { assignee_id: number };
      expect(card.assignee_id).toBe(ada.id);
    });

    it('leaves it unassigned when the account is not linked', () => {
      seedDefaultBoard(t.db, 'admin');

      const reply = handleGoalsCommand(t.db, 'add Book the ferry', slack, options);

      expect(reply).not.toContain('assigned to');
    });

    it('keeps a multi-word title intact', () => {
      seedDefaultBoard(t.db, 'admin');
      handleGoalsCommand(t.db, 'add  Walk   the coast path ', slack, options);

      const card = t.raw.prepare(`SELECT title FROM ${t.db.prefix}cards`).get() as { title: string };
      expect(card.title).toBe('Walk the coast path');
    });

    it('asks for a title when none is given', () => {
      seedDefaultBoard(t.db, 'admin');
      expect(handleGoalsCommand(t.db, 'add', slack, options)).toContain('What is the goal?');
      expect(handleGoalsCommand(t.db, 'add    ', slack, options)).toContain('What is the goal?');
    });

    it('rejects an over-long title without creating anything', () => {
      seedDefaultBoard(t.db, 'admin');

      const reply = handleGoalsCommand(
        t.db,
        `add ${'a'.repeat(LIMITS.cardTitle + 1)}`,
        slack,
        options
      );

      expect(reply).toContain('under 200 characters');
      expect(t.raw.prepare(`SELECT COUNT(*) AS c FROM ${t.db.prefix}cards`).get()).toEqual({ c: 0 });
    });

    it('explains when there are no boards yet', () => {
      expect(handleGoalsCommand(t.db, 'add Something', slack, options)).toContain(
        'no boards yet'
      );
    });

    it('explains when the default board has no columns', () => {
      createBoard(t.db, { title: 'Bare', ownerId: 'admin', withDefaultColumns: false });

      expect(handleGoalsCommand(t.db, 'add Something', slack, options)).toContain('no columns yet');
    });

    it('creates a card that is immediately visible to the list', () => {
      seedDefaultBoard(t.db, 'admin');
      handleGoalsCommand(t.db, 'add Book the ferry', slack, options);

      expect(handleGoalsCommand(t.db, '', slack, options)).toContain('Book the ferry');
    });

    it('records who added it', () => {
      seedDefaultBoard(t.db, 'admin');
      handleGoalsCommand(t.db, 'add Book the ferry', slack, options);

      const card = t.raw.prepare(`SELECT id FROM ${t.db.prefix}cards`).get() as { id: number };
      expect(getCard(t.db, card.id)?.createdBy).toBe('U012ABC');
    });
  });

  describe('help and unknown input', () => {
    it('explains the available options', () => {
      const reply = handleGoalsCommand(t.db, 'help', slack, options);

      expect(reply).toContain('/goals add');
      expect(reply).toContain('/goals help');
    });

    it('falls back to help for an unknown subcommand', () => {
      const reply = handleGoalsCommand(t.db, 'frobnicate', slack, options);

      expect(reply).toContain('Unknown option `frobnicate`');
      expect(reply).toContain('/goals add');
    });

    it('escapes an unknown subcommand before echoing it', () => {
      expect(handleGoalsCommand(t.db, '<script>', slack, options)).not.toContain('<script>');
    });

    it('is case-insensitive about subcommands', () => {
      seedDefaultBoard(t.db, 'admin');
      expect(handleGoalsCommand(t.db, 'ADD Book it', slack, options)).toContain('Added');
      expect(handleGoalsCommand(t.db, 'Help', slack, options)).toContain('/goals add');
    });
  });

  it('omits a broken link when no base URL is configured', () => {
    const { todo } = seedBoard();
    createCard(t.db, { columnId: todo.id, title: 'Open', createdBy: 'admin' });

    const reply = handleGoalsCommand(t.db, '', slack, { today: '2026-07-25' });

    expect(reply).toContain('</p/goals/|Open the board>');
  });
});

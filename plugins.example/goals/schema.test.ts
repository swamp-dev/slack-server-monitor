import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { PluginDatabase } from '../../src/services/plugin-database.js';
import { createSchema, migrateSchema, seedDefaultBoard, DEFAULT_COLUMNS } from './schema.js';

describe('goals schema', () => {
  let raw: Database.Database;
  let db: PluginDatabase;

  beforeEach(() => {
    raw = new Database(':memory:');
    db = new PluginDatabase(raw, 'goals');
  });

  afterEach(() => {
    raw.close();
  });

  function tableNames(): string[] {
    return (
      raw
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
        .all() as { name: string }[]
    ).map((r) => r.name);
  }

  describe('createSchema', () => {
    it('creates all five tables with the plugin prefix', () => {
      createSchema(db);

      expect(tableNames()).toEqual(
        expect.arrayContaining([
          'plugin_goals_boards',
          'plugin_goals_members',
          'plugin_goals_columns',
          'plugin_goals_cards',
          'plugin_goals_comments',
        ])
      );
    });

    it('creates no table outside the plugin prefix', () => {
      createSchema(db);

      const foreign = tableNames().filter(
        (n) => !n.startsWith('plugin_goals_') && !n.startsWith('sqlite_')
      );
      expect(foreign).toEqual([]);
    });

    it('is idempotent', () => {
      createSchema(db);
      expect(() => createSchema(db)).not.toThrow();
      expect(tableNames().filter((n) => n === 'plugin_goals_cards')).toHaveLength(1);
    });

    it('creates indexes for the ordering hot paths', () => {
      createSchema(db);

      const indexes = (
        raw.prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`).all() as {
          name: string;
        }[]
      ).map((r) => r.name);

      expect(indexes).toEqual(
        expect.arrayContaining([
          'idx_goals_columns_board',
          'idx_goals_cards_col',
          'idx_goals_comments_card',
        ])
      );
    });

    it('rejects an invalid board visibility via CHECK', () => {
      createSchema(db);

      expect(() =>
        db
          .prepare(
            `INSERT INTO ${db.prefix}boards
             (title, description, owner_id, visibility, is_default, archived, position, created_at, updated_at)
             VALUES (?, '', 'admin', ?, 0, 0, 0, 1, 1)`
          )
          .run('Board', 'public')
      ).toThrow();
    });

    it('allows many members with a null identity but rejects a duplicate identity', () => {
      createSchema(db);
      const insert = db.prepare(
        `INSERT INTO ${db.prefix}members (display_name, color, identity, archived, created_at)
         VALUES (?, '#06b6d4', ?, 0, 1)`
      );

      insert.run('Ada', null);
      expect(() => insert.run('Bea', null)).not.toThrow();

      insert.run('Cy', 'U123');
      expect(() => insert.run('Dee', 'U123')).toThrow();
    });

    it('every statement is accepted by PluginDatabase SQL validation', () => {
      // createSchema goes through db.exec(), which runs validateSql. If any
      // statement referenced an unprefixed table this would throw.
      expect(() => createSchema(db)).not.toThrow();
    });
  });

  describe('migrateSchema', () => {
    it('is a no-op on a freshly created schema', () => {
      createSchema(db);
      const before = raw.prepare(`PRAGMA table_info(${db.prefix}cards)`).all();

      migrateSchema(db);

      expect(raw.prepare(`PRAGMA table_info(${db.prefix}cards)`).all()).toEqual(before);
    });

    it('adds a column that is missing from an older database', () => {
      createSchema(db);
      raw.exec(`ALTER TABLE ${db.prefix}cards DROP COLUMN completed_at`);

      const names = () =>
        (raw.prepare(`PRAGMA table_info(${db.prefix}cards)`).all() as { name: string }[]).map(
          (c) => c.name
        );
      expect(names()).not.toContain('completed_at');

      migrateSchema(db);

      expect(names()).toContain('completed_at');
    });

    it('is idempotent when run twice', () => {
      createSchema(db);
      migrateSchema(db);
      expect(() => migrateSchema(db)).not.toThrow();
    });
  });

  describe('seedDefaultBoard', () => {
    it('creates one default board with the starter columns in order', () => {
      createSchema(db);

      const boardId = seedDefaultBoard(db, 'admin');

      const board = raw
        .prepare(`SELECT * FROM ${db.prefix}boards WHERE id = ?`)
        .get(boardId) as Record<string, unknown>;
      expect(board.is_default).toBe(1);
      expect(board.owner_id).toBe('admin');
      expect(board.visibility).toBe('shared');

      const columns = raw
        .prepare(`SELECT name, position FROM ${db.prefix}columns WHERE board_id = ? ORDER BY position`)
        .all(boardId) as { name: string; position: number }[];

      expect(columns.map((c) => c.name)).toEqual(DEFAULT_COLUMNS.map((c) => c.name));
      expect(columns.map((c) => c.position)).toEqual(DEFAULT_COLUMNS.map((_c, i) => i));
    });

    it('marks the final starter column as done', () => {
      createSchema(db);
      const boardId = seedDefaultBoard(db, 'admin');

      const last = raw
        .prepare(
          `SELECT is_done FROM ${db.prefix}columns WHERE board_id = ? ORDER BY position DESC LIMIT 1`
        )
        .get(boardId) as { is_done: number };

      expect(last.is_done).toBe(1);
    });

    it('does not create a second default board', () => {
      createSchema(db);
      const first = seedDefaultBoard(db, 'admin');
      const second = seedDefaultBoard(db, 'admin');

      expect(second).toBe(first);
      expect(
        (raw.prepare(`SELECT COUNT(*) AS c FROM ${db.prefix}boards`).get() as { c: number }).c
      ).toBe(1);
    });
  });
});

/**
 * Goals plugin database schema.
 *
 * Every table is prefixed with `db.prefix` (plugin_goals_) — PluginDatabase
 * validates each statement and throws otherwise.
 *
 * Foreign keys are declarative documentation only: `PRAGMA foreign_keys` is
 * off, and turning it on would be a connection-global change to a file shared
 * with core tables and other plugins. `ON DELETE` clauses are therefore omitted
 * rather than written and left silently inert — every delete performs its own
 * ordered cascade inside a transaction. See boards.ts and columns.ts.
 */
import type { PluginDatabase } from '../../src/services/plugin-database.js';

export interface StarterColumn {
  name: string;
  color: string;
  isDone: boolean;
}

/** Columns created with a brand-new board. */
export const DEFAULT_COLUMNS: StarterColumn[] = [
  { name: 'Someday', color: '#64748b', isDone: false },
  { name: 'This month', color: '#7c3aed', isDone: false },
  { name: 'In progress', color: '#06b6d4', isDone: false },
  { name: 'Done', color: '#10b981', isDone: true },
];

export function createSchema(db: PluginDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${db.prefix}boards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      owner_id TEXT NOT NULL,
      visibility TEXT NOT NULL DEFAULT 'shared' CHECK(visibility IN ('shared', 'private')),
      is_default INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_goals_boards_owner ON ${db.prefix}boards(owner_id);
    CREATE INDEX IF NOT EXISTS idx_goals_boards_pos ON ${db.prefix}boards(archived, position, id);

    CREATE TABLE IF NOT EXISTS ${db.prefix}members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      display_name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#06b6d4',
      identity TEXT,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_goals_members_identity ON ${db.prefix}members(identity);

    CREATE TABLE IF NOT EXISTS ${db.prefix}columns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      board_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#7c3aed',
      is_done INTEGER NOT NULL DEFAULT 0,
      wip_limit INTEGER,
      position INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_goals_columns_board ON ${db.prefix}columns(board_id, position, id);

    CREATE TABLE IF NOT EXISTS ${db.prefix}cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      board_id INTEGER NOT NULL,
      column_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      assignee_id INTEGER,
      due_date TEXT,
      position INTEGER NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_goals_cards_col ON ${db.prefix}cards(column_id, position, id);
    CREATE INDEX IF NOT EXISTS idx_goals_cards_board ON ${db.prefix}cards(board_id, archived);
    CREATE INDEX IF NOT EXISTS idx_goals_cards_assignee ON ${db.prefix}cards(assignee_id);
    CREATE INDEX IF NOT EXISTS idx_goals_cards_due ON ${db.prefix}cards(due_date);

    CREATE TABLE IF NOT EXISTS ${db.prefix}comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id INTEGER NOT NULL,
      author_id TEXT NOT NULL,
      author_member_id INTEGER,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_goals_comments_card ON ${db.prefix}comments(card_id, created_at, id);
  `);
}

/** Columns added after the initial release, per table. */
const ADDED_COLUMNS: Record<string, { name: string; definition: string }[]> = {
  boards: [],
  members: [],
  columns: [],
  cards: [
    // Present in createSchema too; listed so databases created before it
    // existed pick it up. New columns get appended here.
    { name: 'completed_at', definition: 'INTEGER' },
  ],
  comments: [],
};

/**
 * Add any columns missing from an older database.
 *
 * Follows the agentbox migrateRunsTable pattern: introspect with PRAGMA,
 * diff against the declared list, ALTER TABLE for the gaps.
 */
export function migrateSchema(db: PluginDatabase): void {
  db.transaction(() => {
    for (const [table, columns] of Object.entries(ADDED_COLUMNS)) {
      if (columns.length === 0) continue;

      const existing = new Set(
        (
          db.prepare(`PRAGMA table_info(${db.prefix}${table})`).all() as { name: string }[]
        ).map((c) => c.name)
      );

      for (const column of columns) {
        if (existing.has(column.name)) continue;
        db.exec(`ALTER TABLE ${db.prefix}${table} ADD COLUMN ${column.name} ${column.definition}`);
      }
    }
  });
}

/**
 * Create the shared starter board on first run, so the page is never a dead end.
 *
 * Skips as soon as *any* board exists, not just a default one — otherwise
 * deleting the starter board and making your own would resurrect it on the
 * next restart. Returns the id of the board that already stands in for it.
 */
export function seedDefaultBoard(db: PluginDatabase, ownerId: string): number {
  return db.transaction(() => {
    const existing = db
      .prepare(`SELECT id FROM ${db.prefix}boards ORDER BY is_default DESC, id LIMIT 1`)
      .get() as { id: number } | undefined;
    if (existing) return existing.id;

    const now = Date.now();
    const result = db
      .prepare(
        `INSERT INTO ${db.prefix}boards
         (title, description, owner_id, visibility, is_default, archived, position, created_at, updated_at)
         VALUES (?, ?, ?, 'shared', 1, 0, 0, ?, ?)`
      )
      .run('Family goals', 'Shared plans for everyone', ownerId, now, now);

    const boardId = Number(result.lastInsertRowid);

    const insertColumn = db.prepare(
      `INSERT INTO ${db.prefix}columns (board_id, name, color, is_done, wip_limit, position, created_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?)`
    );
    DEFAULT_COLUMNS.forEach((column, index) => {
      insertColumn.run(boardId, column.name, column.color, column.isDone ? 1 : 0, index, now);
    });

    return boardId;
  });
}

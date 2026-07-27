/**
 * Shared harness for the goals test suites.
 * Not a test file — the vitest glob only picks up *.test.ts.
 */
import Database from 'better-sqlite3';
import { vi } from 'vitest';
import { PluginDatabase } from '../../src/services/plugin-database.js';
import type { PluginContext } from '../../src/plugins/types.js';
import { createSchema, migrateSchema } from './schema.js';

export interface TestDb {
  raw: Database.Database;
  db: PluginDatabase;
  close: () => void;
}

export function makeTestDb(): TestDb {
  const raw = new Database(':memory:');
  const db = new PluginDatabase(raw, 'goals');
  createSchema(db);
  migrateSchema(db);
  return { raw, db, close: () => raw.close() };
}

export interface MockContext extends PluginContext {
  db: PluginDatabase;
}

export function makeMockContext(db: PluginDatabase, clientCount = 1): MockContext {
  return {
    db,
    name: 'goals',
    version: '1.0.0',
    notify: vi.fn(),
    sse: {
      broadcast: vi.fn(),
      clientCount: () => clientCount,
    },
  } as unknown as MockContext;
}

/** Column ids in a board, in render order. */
export function columnOrder(t: TestDb, boardId: number): number[] {
  return (
    t.raw
      .prepare(`SELECT id FROM ${t.db.prefix}columns WHERE board_id = ? ORDER BY position, id`)
      .all(boardId) as { id: number }[]
  ).map((r) => r.id);
}

/** Card ids in a column, in render order. */
export function cardOrder(t: TestDb, columnId: number): number[] {
  return (
    t.raw
      .prepare(
        `SELECT id FROM ${t.db.prefix}cards WHERE column_id = ? AND archived = 0 ORDER BY position, id`
      )
      .all(columnId) as { id: number }[]
  ).map((r) => r.id);
}

/** Raw position values in a column, to assert density. */
export function cardPositions(t: TestDb, columnId: number): number[] {
  return (
    t.raw
      .prepare(`SELECT position FROM ${t.db.prefix}cards WHERE column_id = ? ORDER BY position, id`)
      .all(columnId) as { position: number }[]
  ).map((r) => r.position);
}

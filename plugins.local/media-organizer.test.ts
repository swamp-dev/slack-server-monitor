/**
 * Tests for the media-organizer plugin scaffold and SQLite schema.
 *
 * Covers: createSchema idempotency, table existence, and column presence.
 * Database operations use an in-memory SQLite instance.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { PluginDatabase } from '../src/services/plugin-database.js';
import { createSchema } from './media-organizer/schema.js';

function makeDb(): PluginDatabase {
  const raw = new Database(':memory:');
  return new PluginDatabase(raw, 'media_organizer');
}

describe('media-organizer plugin schema', () => {
  let db: PluginDatabase;

  beforeEach(() => {
    db = makeDb();
  });

  describe('createSchema', () => {
    it('runs without throwing', () => {
      expect(() => createSchema(db)).not.toThrow();
    });

    it('is idempotent (safe to call twice)', () => {
      expect(() => {
        createSchema(db);
        createSchema(db);
      }).not.toThrow();
    });

    it('creates the runs table', () => {
      createSchema(db);
      const row = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
        .get([`${db.prefix}runs`]) as { name: string } | undefined;
      expect(row?.name).toBe(`${db.prefix}runs`);
    });

    it('creates the events table', () => {
      createSchema(db);
      const row = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
        .get([`${db.prefix}events`]) as { name: string } | undefined;
      expect(row?.name).toBe(`${db.prefix}events`);
    });

    it('creates the inboxes table', () => {
      createSchema(db);
      const row = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
        .get([`${db.prefix}inboxes`]) as { name: string } | undefined;
      expect(row?.name).toBe(`${db.prefix}inboxes`);
    });

    it('creates the cursor table', () => {
      createSchema(db);
      const row = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
        .get([`${db.prefix}cursor`]) as { name: string } | undefined;
      expect(row?.name).toBe(`${db.prefix}cursor`);
    });

    it('runs table has expected columns', () => {
      createSchema(db);
      const cols = db
        .prepare(`PRAGMA table_info(${db.prefix}runs)`)
        .all() as Array<{ name: string }>;
      const names = cols.map((c) => c.name);
      expect(names).toContain('id');
      expect(names).toContain('started_at');
      expect(names).toContain('completed_at');
      expect(names).toContain('dry_run');
      expect(names).toContain('total_files');
      expect(names).toContain('errors');
      expect(names).toContain('duration_secs');
    });

    it('events table has expected columns', () => {
      createSchema(db);
      const cols = db
        .prepare(`PRAGMA table_info(${db.prefix}events)`)
        .all() as Array<{ name: string }>;
      const names = cols.map((c) => c.name);
      expect(names).toContain('id');
      expect(names).toContain('run_id');
      expect(names).toContain('event_type');
      expect(names).toContain('inbox_name');
      expect(names).toContain('ts');
      expect(names).toContain('src_path');
      expect(names).toContain('dst_path');
    });

    it('inboxes table has expected columns', () => {
      createSchema(db);
      const cols = db
        .prepare(`PRAGMA table_info(${db.prefix}inboxes)`)
        .all() as Array<{ name: string }>;
      const names = cols.map((c) => c.name);
      expect(names).toContain('name');
      expect(names).toContain('user');
      expect(names).toContain('last_file_organized_at');
      expect(names).toContain('files_last_24h');
      expect(names).toContain('quarantine_count');
      expect(names).toContain('health');
    });

    it('cursor table has expected columns', () => {
      createSchema(db);
      const cols = db
        .prepare(`PRAGMA table_info(${db.prefix}cursor)`)
        .all() as Array<{ name: string }>;
      const names = cols.map((c) => c.name);
      expect(names).toContain('key');
      expect(names).toContain('value');
    });

    it('creates indexes on events table', () => {
      createSchema(db);
      const indexes = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name=?`)
        .all([`${db.prefix}events`]) as Array<{ name: string }>;
      const indexNames = indexes.map((i) => i.name);
      expect(indexNames).toContain(`${db.prefix}events_ts`);
      expect(indexNames).toContain(`${db.prefix}events_run_id`);
      expect(indexNames).toContain(`${db.prefix}events_inbox_name`);
      expect(indexNames).toContain(`${db.prefix}events_event_type`);
    });
  });

  describe('NOT NULL constraints', () => {
    beforeEach(() => {
      createSchema(db);
    });

    it('rejects NULL runs.id', () => {
      expect(() =>
        db
          .prepare(`INSERT INTO ${db.prefix}runs (id) VALUES (?)`)
          .run([null])
      ).toThrow();
    });

    it('rejects NULL events.run_id', () => {
      expect(() =>
        db
          .prepare(
            `INSERT INTO ${db.prefix}events (run_id, ts) VALUES (?, ?)`
          )
          .run([null, 1000])
      ).toThrow();
    });

    it('rejects NULL inboxes.name', () => {
      expect(() =>
        db
          .prepare(`INSERT INTO ${db.prefix}inboxes (name, user) VALUES (?, ?)`)
          .run([null, 'alice'])
      ).toThrow();
    });

    it('rejects NULL cursor.key', () => {
      expect(() =>
        db
          .prepare(`INSERT INTO ${db.prefix}cursor (key, value) VALUES (?, ?)`)
          .run([null, 'v'])
      ).toThrow();
    });
  });
});

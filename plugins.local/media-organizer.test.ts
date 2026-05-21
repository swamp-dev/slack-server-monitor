/**
 * Tests for the media-organizer plugin: schema, ingestor, and health scoring.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'os';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import Database from 'better-sqlite3';
import { PluginDatabase } from '../src/services/plugin-database.js';
import { createSchema } from './media-organizer/schema.js';
import { processNewEvents } from './media-organizer/ingest.js';
import { recomputeInboxHealth } from './media-organizer/health.js';
import type { PluginSSE } from '../src/plugins/types.js';

function makeDb(): PluginDatabase {
  const raw = new Database(':memory:');
  return new PluginDatabase(raw, 'media_organizer');
}

function makeSseMock(): { sse: PluginSSE; calls: Array<{ event: string; data: unknown }> } {
  const calls: Array<{ event: string; data: unknown }> = [];
  const sse: PluginSSE = {
    broadcast: (event: string, data: unknown) => {
      calls.push({ event, data });
    },
    clientCount: () => 0,
  };
  return { sse, calls };
}

function jsonl(obj: object): string {
  return JSON.stringify(obj) + '\n';
}

// =============================================================================
// Schema tests
// =============================================================================

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

// =============================================================================
// Ingestor tests
// =============================================================================

describe('processNewEvents (ingestor)', () => {
  let db: PluginDatabase;
  let tmpDir: string;
  let eventsPath: string;

  beforeEach(() => {
    db = makeDb();
    createSchema(db);
    tmpDir = mkdtempSync(join(tmpdir(), 'mo-test-'));
    eventsPath = join(tmpDir, 'events.jsonl');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns 0 when events file does not exist', () => {
    const { sse } = makeSseMock();
    expect(processNewEvents(db, eventsPath, sse)).toBe(0);
  });

  it('parses run_start event and inserts into runs table', () => {
    const { sse } = makeSseMock();
    writeFileSync(
      eventsPath,
      jsonl({ type: 'run_start', ts: 1000, data: { run_id: 'abc123', dry_run: false } })
    );
    processNewEvents(db, eventsPath, sse);
    const row = db
      .prepare(`SELECT id, started_at, dry_run FROM ${db.prefix}runs WHERE id = ?`)
      .get(['abc123']) as { id: string; started_at: number; dry_run: number } | undefined;
    expect(row?.id).toBe('abc123');
    expect(row?.started_at).toBe(1000);
    expect(row?.dry_run).toBe(0);
  });

  it('parses run_complete event and updates the runs row', () => {
    const { sse } = makeSseMock();
    writeFileSync(
      eventsPath,
      jsonl({ type: 'run_start', ts: 1000, data: { run_id: 'run1', dry_run: false } }) +
        jsonl({
          type: 'run_complete',
          ts: 1005,
          data: {
            run_id: 'run1',
            duration_secs: 5,
            total_files: 10,
            errors: 0,
            pictures: 8,
            videos: 1,
            audio: 1,
            documents: 0,
            dedup_skipped: 2,
          },
        })
    );
    processNewEvents(db, eventsPath, sse);
    const row = db
      .prepare(`SELECT total_files, duration_secs, completed_at FROM ${db.prefix}runs WHERE id = ?`)
      .get(['run1']) as { total_files: number; duration_secs: number; completed_at: number } | undefined;
    expect(row?.total_files).toBe(10);
    expect(row?.duration_secs).toBe(5);
    expect(row?.completed_at).toBe(1005);
  });

  it('parses file_organized event and inserts into events table', () => {
    const { sse } = makeSseMock();
    writeFileSync(
      eventsPath,
      jsonl({
        type: 'file_organized',
        ts: 2000,
        data: { run_id: 'run1', inbox_name: 'alice_photos', user: 'alice', media_type: 'JPEG' },
      })
    );
    processNewEvents(db, eventsPath, sse);
    const row = db
      .prepare(
        `SELECT event_type, inbox_name, user FROM ${db.prefix}events WHERE event_type = ?`
      )
      .get(['file_organized']) as { event_type: string; inbox_name: string; user: string } | undefined;
    expect(row?.inbox_name).toBe('alice_photos');
    expect(row?.user).toBe('alice');
  });

  it('updates inboxes.last_file_organized_at from file_organized event', () => {
    const { sse } = makeSseMock();
    writeFileSync(
      eventsPath,
      jsonl({
        type: 'file_organized',
        ts: 3000,
        data: { run_id: 'run1', inbox_name: 'photos', user: 'alice' },
      })
    );
    processNewEvents(db, eventsPath, sse);
    const row = db
      .prepare(`SELECT last_file_organized_at FROM ${db.prefix}inboxes WHERE name = ?`)
      .get(['photos']) as { last_file_organized_at: number } | undefined;
    expect(row?.last_file_organized_at).toBe(3000);
  });

  it('resumes from cursor offset — no duplicate rows on second call', () => {
    const { sse } = makeSseMock();
    const line = jsonl({
      type: 'file_organized',
      ts: 1000,
      data: { run_id: 'r1', inbox_name: 'box', user: 'u' },
    });
    writeFileSync(eventsPath, line);
    processNewEvents(db, eventsPath, sse);
    processNewEvents(db, eventsPath, sse); // same file, same cursor → nothing new
    const { cnt } = db
      .prepare(`SELECT COUNT(*) as cnt FROM ${db.prefix}events`)
      .get([]) as { cnt: number };
    expect(cnt).toBe(1);
  });

  it('skips malformed JSON lines and continues parsing subsequent lines', () => {
    const { sse } = makeSseMock();
    writeFileSync(
      eventsPath,
      'this is not json\n' +
        jsonl({
          type: 'file_organized',
          ts: 5000,
          data: { run_id: 'r1', inbox_name: 'x', user: 'u' },
        })
    );
    processNewEvents(db, eventsPath, sse);
    const { cnt } = db
      .prepare(`SELECT COUNT(*) as cnt FROM ${db.prefix}events`)
      .get([]) as { cnt: number };
    expect(cnt).toBe(1);
  });

  it('resets cursor when file shrinks (copytruncate) and re-ingests new content', () => {
    const { sse } = makeSseMock();
    // Write many lines so cursor advances well past what the next file will be
    const manyLines = Array.from({ length: 20 }, (_, i) =>
      jsonl({
        type: 'file_organized',
        ts: i + 1,
        data: { run_id: 'r1', inbox_name: `box${i}`, user: 'u' },
      })
    ).join('');
    writeFileSync(eventsPath, manyLines);
    processNewEvents(db, eventsPath, sse); // cursor = manyLines.length

    // Simulate copytruncate: truncate file to fresh short content
    writeFileSync(
      eventsPath,
      jsonl({ type: 'run_start', ts: 9999, data: { run_id: 'fresh-run', dry_run: false } })
    );
    processNewEvents(db, eventsPath, sse); // cursor > file.size → reset, re-read

    const row = db
      .prepare(`SELECT id FROM ${db.prefix}runs WHERE id = ?`)
      .get(['fresh-run']) as { id: string } | undefined;
    expect(row?.id).toBe('fresh-run');
  });

  it('broadcasts SSE "events" after inserting new rows', () => {
    const { sse, calls } = makeSseMock();
    writeFileSync(
      eventsPath,
      jsonl({
        type: 'file_organized',
        ts: 1000,
        data: { run_id: 'r1', inbox_name: 'box', user: 'u' },
      })
    );
    processNewEvents(db, eventsPath, sse);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]?.event).toBe('events');
  });

  it('does not broadcast SSE when only run_start/run_complete processed', () => {
    const { sse, calls } = makeSseMock();
    writeFileSync(
      eventsPath,
      jsonl({ type: 'run_start', ts: 1, data: { run_id: 'r', dry_run: false } })
    );
    processNewEvents(db, eventsPath, sse);
    // run_start inserts into runs, not events — SSE should not be broadcast
    // (or could be broadcast with count 0 — let's just check no "events" broadcast)
    const eventsCall = calls.find((c) => c.event === 'events');
    expect(eventsCall).toBeUndefined();
  });
});

// =============================================================================
// Health scoring tests
// =============================================================================

describe('recomputeInboxHealth', () => {
  let db: PluginDatabase;
  const now = Math.floor(Date.now() / 1000);

  beforeEach(() => {
    db = makeDb();
    createSchema(db);
  });

  function insertInbox(
    name: string,
    lastOrganized: number | null,
    quarantineCount: number
  ): void {
    db.prepare(
      `INSERT INTO ${db.prefix}inboxes (name, user, last_file_organized_at, quarantine_count) VALUES (?, ?, ?, ?)`
    ).run([name, 'alice', lastOrganized, quarantineCount]);
  }

  it('sets health to healthy for file organized < 48h ago', () => {
    insertInbox('inbox1', now - 3600, 0); // 1 hour ago
    recomputeInboxHealth(db, ['inbox1']);
    const row = db
      .prepare(`SELECT health FROM ${db.prefix}inboxes WHERE name = ?`)
      .get(['inbox1']) as { health: string };
    expect(row.health).toBe('healthy');
  });

  it('sets health to idle for file organized 5 days ago', () => {
    insertInbox('inbox2', now - 5 * 24 * 3600, 0);
    recomputeInboxHealth(db, ['inbox2']);
    const row = db
      .prepare(`SELECT health FROM ${db.prefix}inboxes WHERE name = ?`)
      .get(['inbox2']) as { health: string };
    expect(row.health).toBe('idle');
  });

  it('sets health to stalled for file organized 15 days ago', () => {
    insertInbox('inbox3', now - 15 * 24 * 3600, 0);
    recomputeInboxHealth(db, ['inbox3']);
    const row = db
      .prepare(`SELECT health FROM ${db.prefix}inboxes WHERE name = ?`)
      .get(['inbox3']) as { health: string };
    expect(row.health).toBe('stalled');
  });

  it('quarantine overrides health when quarantine_count > 0', () => {
    insertInbox('inbox4', now - 3600, 1); // recent but has quarantined files
    recomputeInboxHealth(db, ['inbox4']);
    const row = db
      .prepare(`SELECT health FROM ${db.prefix}inboxes WHERE name = ?`)
      .get(['inbox4']) as { health: string };
    expect(row.health).toBe('quarantine');
  });

  it('recomputes all inboxes when no names passed', () => {
    insertInbox('all1', now - 3600, 0); // healthy
    insertInbox('all2', now - 20 * 24 * 3600, 0); // stalled
    recomputeInboxHealth(db); // no filter → all
    const r1 = db
      .prepare(`SELECT health FROM ${db.prefix}inboxes WHERE name = ?`)
      .get(['all1']) as { health: string };
    const r2 = db
      .prepare(`SELECT health FROM ${db.prefix}inboxes WHERE name = ?`)
      .get(['all2']) as { health: string };
    expect(r1.health).toBe('healthy');
    expect(r2.health).toBe('stalled');
  });

  it('leaves health as unknown when last_file_organized_at is null', () => {
    insertInbox('new-inbox', null, 0);
    recomputeInboxHealth(db, ['new-inbox']);
    const row = db
      .prepare(`SELECT health FROM ${db.prefix}inboxes WHERE name = ?`)
      .get(['new-inbox']) as { health: string };
    expect(row.health).toBe('unknown');
  });
});

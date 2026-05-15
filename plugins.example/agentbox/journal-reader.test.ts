/**
 * Tests for journal-reader (#343). Builds a fake agentbox.db
 * matching agentbox/internal/store/schema.sql at the bits we read,
 * exercises the read-only query path.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import path from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import { readJournalEntries, agentboxDbPath } from './journal-reader.js';

let workDir: string;

async function seedAgentboxDb(): Promise<Database.Database> {
  await mkdir(path.join(workDir, '.agentbox'), { recursive: true });
  const db = new Database(agentboxDbPath(workDir));
  db.pragma('journal_mode = WAL');
  // Mirror the bits of agentbox/internal/store/schema.sql we read.
  db.exec(`
    CREATE TABLE sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE journal_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES sessions(id),
      kind TEXT NOT NULL,
      task_id TEXT,
      sprint INTEGER,
      iteration INTEGER NOT NULL,
      summary TEXT NOT NULL,
      reflection TEXT NOT NULL,
      confidence INTEGER,
      difficulty INTEGER,
      momentum INTEGER,
      duration_ms INTEGER DEFAULT 0,
      timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

beforeEach(async () => {
  workDir = path.join(os.tmpdir(), `journal-test-${String(Date.now())}-${String(process.pid)}-${String(Math.random()).slice(2, 8)}`);
  await mkdir(workDir, { recursive: true });
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true }).catch(() => { /* best-effort */ });
});

describe('readJournalEntries (#343)', () => {
  it('returns [] when no agentbox.db exists in the workDir', () => {
    expect(readJournalEntries(workDir)).toEqual([]);
  });

  it('returns [] when the DB exists but has no sessions yet', async () => {
    const db = await seedAgentboxDb();
    db.close();
    expect(readJournalEntries(workDir)).toEqual([]);
  });

  it('reads entries for the latest session, ordered by id ASC', async () => {
    const db = await seedAgentboxDb();
    db.prepare(`INSERT INTO sessions (id) VALUES (1)`).run();
    const insert = db.prepare(`INSERT INTO journal_entries
      (session_id, kind, sprint, iteration, summary, reflection, confidence, difficulty, momentum, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    insert.run(1, 'reflection', 1, 1, 'first', 'first reflection', 3, 2, 4, '2026-04-29 10:00:00');
    insert.run(1, 'reflection', 1, 2, 'second', 'second reflection', 4, 3, 4, '2026-04-29 10:05:00');
    db.close();

    const entries = readJournalEntries(workDir);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.summary).toBe('first');
    expect(entries[1]!.summary).toBe('second');
    expect(entries[0]!.confidence).toBe(3);
    expect(entries[0]!.iteration).toBe(1);
    expect(entries[0]!.timestamp).toBe('2026-04-29 10:00:00');
  });

  it('only returns entries for the most recent session', async () => {
    const db = await seedAgentboxDb();
    db.prepare(`INSERT INTO sessions (id) VALUES (1)`).run();
    db.prepare(`INSERT INTO sessions (id) VALUES (2)`).run();
    const insert = db.prepare(`INSERT INTO journal_entries
      (session_id, kind, iteration, summary, reflection, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)`);
    insert.run(1, 'reflection', 1, 'old session', 'r', '2026-04-29 09:00:00');
    insert.run(2, 'reflection', 1, 'new session', 'r', '2026-04-29 10:00:00');
    db.close();

    const entries = readJournalEntries(workDir);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.summary).toBe('new session');
  });

  it('honours the sinceId cursor — only returns entries with id > sinceId', async () => {
    const db = await seedAgentboxDb();
    db.prepare(`INSERT INTO sessions (id) VALUES (1)`).run();
    const insert = db.prepare(`INSERT INTO journal_entries
      (session_id, kind, iteration, summary, reflection, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)`);
    insert.run(1, 'reflection', 1, 'a', 'r', '2026-04-29 10:00:00');
    insert.run(1, 'reflection', 2, 'b', 'r', '2026-04-29 10:01:00');
    insert.run(1, 'reflection', 3, 'c', 'r', '2026-04-29 10:02:00');
    db.close();

    const initial = readJournalEntries(workDir);
    expect(initial).toHaveLength(3);

    const after = readJournalEntries(workDir, initial[0]!.id);
    expect(after).toHaveLength(2);
    expect(after.map((e) => e.summary)).toEqual(['b', 'c']);
  });

  it('returns [] without throwing when the DB schema is missing journal_entries', async () => {
    const db = await seedAgentboxDb();
    db.exec(`DROP TABLE journal_entries`);
    db.prepare(`INSERT INTO sessions (id) VALUES (1)`).run();
    db.close();

    expect(readJournalEntries(workDir)).toEqual([]);
  });

  it('does not lock the DB against concurrent writers (read-only open)', async () => {
    const db = await seedAgentboxDb();
    db.prepare(`INSERT INTO sessions (id) VALUES (1)`).run();
    db.prepare(`INSERT INTO journal_entries
      (session_id, kind, iteration, summary, reflection, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)`).run(1, 'reflection', 1, 's', 'r', '2026-04-29 10:00:00');

    // Read while the writer DB handle is still open. better-sqlite3
    // opens with readonly:true so this must succeed without conflict.
    const entries = readJournalEntries(workDir);
    expect(entries).toHaveLength(1);

    // Writer can still insert after the read.
    db.prepare(`INSERT INTO journal_entries
      (session_id, kind, iteration, summary, reflection, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)`).run(1, 'reflection', 2, 'after', 'r', '2026-04-29 10:01:00');
    db.close();

    expect(readJournalEntries(workDir)).toHaveLength(2);
  });
});

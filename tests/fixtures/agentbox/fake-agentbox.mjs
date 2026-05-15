#!/usr/bin/env node
/**
 * Fake `agentbox` binary used by plugins.local/agentbox/lifecycle.test.ts.
 *
 * Behaviour is controlled entirely through environment variables so the
 * test process can drive the same fixture through the four lifecycle
 * paths the real binary exposes: success / failure / cancellation /
 * pause-with-checkpoint.
 *
 *   FAKE_EXIT_CODE       — integer; default 0
 *   FAKE_ENTRIES         — int >=0; how many journal_entries rows to
 *                          write before exiting; default 2
 *   FAKE_ENTRY_DELAY_MS  — gap between entries; default 30
 *   FAKE_HANG_MS         — extra sleep before exit; default 0. Useful
 *                          for cancel/pause tests where the test
 *                          process needs the subprocess alive long
 *                          enough to deliver a signal.
 *
 * Args mirror the real binary's two modes — `sprint --project-dir X`
 * and `ralph --prd Y --project-dir X` — but only `--project-dir` is
 * actually consumed (we need to know where to write the SQLite).
 *
 * On SIGTERM, the script writes one final `checkpoint` entry and
 * exits 0 — this matches the real binary's pause behaviour.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import Database from 'better-sqlite3';

const args = process.argv.slice(2);
const projectDirIdx = args.indexOf('--project-dir');
const projectDir = projectDirIdx >= 0 ? args[projectDirIdx + 1] : process.cwd();

const exitCode = Number(process.env.FAKE_EXIT_CODE ?? '0');
const entryCount = Number(process.env.FAKE_ENTRIES ?? '2');
const entryDelay = Number(process.env.FAKE_ENTRY_DELAY_MS ?? '30');
const hangMs = Number(process.env.FAKE_HANG_MS ?? '0');

const dbDir = path.join(projectDir, '.agentbox');
mkdirSync(dbDir, { recursive: true });
const dbPath = path.join(dbDir, 'agentbox.db');

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS journal_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    task_id TEXT,
    sprint INTEGER,
    iteration INTEGER NOT NULL,
    summary TEXT NOT NULL,
    reflection TEXT NOT NULL,
    confidence INTEGER,
    difficulty INTEGER,
    momentum INTEGER,
    duration_ms INTEGER,
    timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

const sessionResult = db.prepare(`INSERT INTO sessions DEFAULT VALUES`).run();
const sessionId = Number(sessionResult.lastInsertRowid);

const insertEntry = db.prepare(`
  INSERT INTO journal_entries
    (session_id, kind, task_id, sprint, iteration, summary, reflection,
     confidence, difficulty, momentum, duration_ms)
  VALUES (?, ?, NULL, 1, ?, ?, ?, ?, ?, ?, ?)
`);

// Synchronous SIGTERM handler so the checkpoint is written before the
// process exits, regardless of whether the signal arrives during the
// entries loop or during the trailing hang.
process.on('SIGTERM', () => {
  try {
    insertEntry.run(
      sessionId, 'checkpoint', entryCount + 1,
      'Checkpoint on SIGTERM', 'Saved session state', null, null, null, 5,
    );
    console.log('[fake-agentbox] checkpoint written, exiting 0');
    db.close();
  } catch {
    /* best-effort: still exit 0 so the executor records 'paused' */
  }
  process.exit(0);
});

console.log(`[fake-agentbox] starting session=${sessionId} project=${projectDir}`);

for (let i = 1; i <= entryCount; i++) {
  insertEntry.run(
    sessionId, 'iteration', i,
    `Entry ${i}`, `Reflection ${i}`,
    4, 2, 5, 100,
  );
  console.log(`[fake-agentbox] wrote entry ${i}`);
  await delay(entryDelay);
}

if (hangMs > 0) await delay(hangMs);

db.close();

// Allow tests to capture stderr on failure paths.
if (exitCode !== 0) {
  process.stderr.write(`[fake-agentbox] simulated failure exit=${exitCode}\n`);
}
process.exit(exitCode);

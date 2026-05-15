/**
 * Journal reader (#343).
 *
 * agentbox writes journal entries (confidence / difficulty / momentum +
 * reflection text) to its own SQLite DB at <workDir>/.agentbox/agentbox.db
 * during a sprint. We read that DB read-only to surface entries on the
 * Workflows web UI run detail page and broadcast them live as
 * `journal-entry` SSE events from the polling loop.
 *
 * Read-only access avoids any contention with the running agentbox
 * subprocess — better-sqlite3 opens with `readonly: true` and the file
 * is in WAL mode (set by agentbox), so reads don't block writers.
 */
import Database from 'better-sqlite3';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { logger } from '../../src/utils/logger.js';

/**
 * One row from agentbox's journal_entries table. Field names are
 * camelCased to match this codebase's convention; the underlying
 * column names are the snake_case variants in agentbox/schema.sql.
 */
export interface JournalEntry {
  id: number;
  sessionId: number;
  kind: string;
  taskId: string | null;
  sprint: number | null;
  iteration: number;
  summary: string;
  reflection: string;
  confidence: number | null;
  difficulty: number | null;
  momentum: number | null;
  durationMs: number;
  /** ISO-8601 string from SQLite DATETIME. */
  timestamp: string;
}

/**
 * Resolve the agentbox.db path for a given run workDir. agentbox
 * always writes to <project>/.agentbox/agentbox.db.
 */
export function agentboxDbPath(workDir: string): string {
  return path.join(workDir, '.agentbox', 'agentbox.db');
}

/**
 * Read journal entries for the latest agentbox session in a workDir,
 * optionally filtered to entries newer than `sinceId`. Returns an
 * empty array when the DB doesn't exist yet (sprint hasn't started),
 * has no sessions, or the schema doesn't include journal_entries.
 *
 * Errors are logged and swallowed — journal streaming is a best-
 * effort UX feature and must never fail a poll cycle.
 */
export function readJournalEntries(workDir: string, sinceId = 0): JournalEntry[] {
  const dbPath = agentboxDbPath(workDir);
  if (!existsSync(dbPath)) return [];

  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });

    // Pick the most recent session — matches `agentbox journal`'s
    // own behaviour. A workDir typically has one in-flight session,
    // so this is unambiguous in practice.
    const sessionRow = db
      .prepare(`SELECT id FROM sessions ORDER BY id DESC LIMIT 1`)
      .get() as { id: number } | undefined;
    if (!sessionRow) return [];

    const rows = db
      .prepare(
        // Native nullables are preserved (better-sqlite3 maps SQL NULL
        // to JS null) so consumers can distinguish a real zero rating
        // — agentbox uses 1-5 today but a future schema with 0-4 or
        // similar would otherwise vanish under a `|| null` coercion.
        `SELECT id, session_id, kind, task_id, sprint, iteration,
                summary, reflection, confidence, difficulty, momentum,
                COALESCE(duration_ms, 0) AS duration_ms, timestamp
         FROM journal_entries
         WHERE session_id = ? AND id > ?
         ORDER BY id ASC`,
      )
      .all(sessionRow.id, sinceId) as Array<Record<string, unknown>>;

    return rows.map(mapRow);
  } catch (err) {
    logger.warn('AgentBox journal read failed', {
      workDir,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  } finally {
    db?.close();
  }
}

function mapRow(row: Record<string, unknown>): JournalEntry {
  return {
    id: row.id as number,
    sessionId: row.session_id as number,
    kind: row.kind as string,
    taskId: (row.task_id as string | null) ?? null,
    sprint: (row.sprint as number | null) ?? null,
    iteration: row.iteration as number,
    summary: row.summary as string,
    reflection: row.reflection as string,
    confidence: (row.confidence as number | null) ?? null,
    difficulty: (row.difficulty as number | null) ?? null,
    momentum: (row.momentum as number | null) ?? null,
    durationMs: (row.duration_ms as number) ?? 0,
    timestamp: String(row.timestamp),
  };
}

/**
 * Persistent custom scene cache backed by SQLite.
 *
 * Custom scenes are batch command sequences saved by name for instant recall.
 * These are NOT Hue bridge scenes — they are stored locally.
 */

import type { SequenceStep } from './sequences.js';

// =============================================================================
// Types
// =============================================================================

export interface CachedScene {
  name: string;
  commands: SequenceStep[];
  description: string;
  createdAt: number;
  lastUsedAt: number | null;
  useCount: number;
}

// =============================================================================
// Database Interface (injected from PluginContext)
// =============================================================================

interface SceneCacheDb {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number };
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Record<string, unknown>[];
  };
  prefix: string;
}

let db: SceneCacheDb | null = null;

export function initSceneCache(database: SceneCacheDb): void {
  db = database;
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${db.prefix}custom_scenes (
      name TEXT PRIMARY KEY,
      commands TEXT NOT NULL,
      description TEXT DEFAULT '',
      created_at INTEGER NOT NULL,
      last_used_at INTEGER,
      use_count INTEGER DEFAULT 0
    )
  `);
}

function getDb(): SceneCacheDb {
  if (!db) throw new Error('Scene cache not initialized. Call initSceneCache first.');
  return db;
}

// =============================================================================
// CRUD Operations
// =============================================================================

export function saveScene(name: string, commands: SequenceStep[], description: string = ''): void {
  const d = getDb();
  d.prepare(
    `INSERT OR REPLACE INTO ${d.prefix}custom_scenes (name, commands, description, created_at, last_used_at, use_count)
     VALUES (?, ?, ?, ?, NULL, 0)`,
  ).run(name, JSON.stringify(commands), description, Date.now());
}

function rowToScene(row: Record<string, unknown>): CachedScene {
  return {
    name: row.name as string,
    commands: JSON.parse(row.commands as string) as SequenceStep[],
    description: row.description as string,
    createdAt: row.created_at as number,
    lastUsedAt: row.last_used_at as number | null,
    useCount: row.use_count as number,
  };
}

/**
 * Read a scene without side effects. Does NOT increment use count.
 */
export function readScene(name: string): CachedScene | null {
  const d = getDb();
  const row = d.prepare(`SELECT * FROM ${d.prefix}custom_scenes WHERE name = ?`).get(name);
  if (!row) return null;
  return rowToScene(row);
}

/**
 * Recall a scene for execution. Increments use count and updates last_used_at.
 */
export function recallScene(name: string): CachedScene | null {
  const d = getDb();
  const row = d.prepare(`SELECT * FROM ${d.prefix}custom_scenes WHERE name = ?`).get(name);
  if (!row) return null;

  d.prepare(
    `UPDATE ${d.prefix}custom_scenes SET use_count = use_count + 1, last_used_at = ? WHERE name = ?`,
  ).run(Date.now(), name);

  const scene = rowToScene(row);
  scene.useCount += 1;
  scene.lastUsedAt = Date.now();
  return scene;
}

export function listScenes(): CachedScene[] {
  const d = getDb();
  const rows = d.prepare(
    `SELECT * FROM ${d.prefix}custom_scenes ORDER BY use_count DESC, created_at DESC`,
  ).all();

  return rows.map(rowToScene);
}

export function deleteScene(name: string): boolean {
  const d = getDb();
  const result = d.prepare(`DELETE FROM ${d.prefix}custom_scenes WHERE name = ?`).run(name);
  return result.changes > 0;
}

export function exportScene(name: string): string | null {
  const d = getDb();
  const row = d.prepare(`SELECT * FROM ${d.prefix}custom_scenes WHERE name = ?`).get(name);
  if (!row) return null;

  return JSON.stringify({
    name: row.name,
    commands: JSON.parse(row.commands as string),
    description: row.description,
  }, null, 2);
}

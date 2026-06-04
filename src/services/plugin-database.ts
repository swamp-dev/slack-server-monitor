import Database from 'better-sqlite3';
import type { Statement } from 'better-sqlite3';
import fs from 'fs';
import { logger } from '../utils/logger.js';

/**
 * Scoped database accessor for plugins.
 *
 * Defense-in-depth: prepare() validates explicitly declared table names against
 * the plugin's prefix so accidental cross-contamination is caught at schema-
 * definition time. exec() is intentionally unguarded — it is for DDL only
 * (CREATE TABLE, CREATE INDEX) and is not reachable from untrusted user input.
 *
 * SECURITY NOTE: Plugins run in the same process with full privileges. This
 * prevents accidental access to another plugin's tables, not deliberate abuse.
 */
export class PluginDatabase {
  private db: Database.Database;
  private pluginName: string;
  private _prefix: string;

  constructor(db: Database.Database, pluginName: string) {
    this.db = db;
    this.pluginName = pluginName;
    this._prefix = `plugin_${pluginName}_`;
  }

  /**
   * Table prefix for this plugin (e.g., "plugin_lift_")
   */
  get prefix(): string {
    return this._prefix;
  }

  /**
   * Execute raw SQL for DDL (CREATE TABLE, CREATE INDEX, DROP TABLE, etc.).
   * Table names are NOT validated — callers are responsible for using the
   * plugin prefix. exec() is intentionally kept as a low-level DDL escape hatch.
   */
  exec(sql: string): void {
    this.db.exec(sql);
  }

  /**
   * Prepare a parameterized statement.
   *
   * `tables` is the explicit list of every table the statement touches.
   * Each name is validated against this plugin's prefix at prepare-time
   * (schema definition time), not at execute time.
   * Pass an empty array for statements that access no plugin tables (e.g. `SELECT 1`, PRAGMA).
   */
  prepare<BindParameters extends unknown[] | object = unknown[], Result = unknown>(
    sql: string,
    tables: string[] = []
  ): Statement<BindParameters, Result> {
    this.validateTables(tables);
    return this.db.prepare<BindParameters, Result>(sql);
  }

  /**
   * Run multiple operations in a transaction
   */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  /**
   * Validate the explicitly declared table names against this plugin's prefix.
   * Called at prepare() time so misuse is caught at schema-definition time, not execute time.
   */
  private validateTables(tables: string[]): void {
    for (const table of tables) {
      if (table.startsWith('sqlite_')) continue; // SQLite system tables always allowed

      if (!table.startsWith(this._prefix)) {
        throw new Error(
          `Plugin "${this.pluginName}" declared table "${table}" which does not have the required prefix "${this._prefix}". ` +
            `Plugins may only access tables prefixed with "${this._prefix}".`,
        );
      }
    }
  }
}

/**
 * Registry of plugin database instances
 * Uses a single shared database file
 */
const pluginDatabases = new Map<string, PluginDatabase>();
let sharedDb: Database.Database | null = null;
let dbPath: string | null = null;

/**
 * Initialize the shared database connection
 * Called automatically on first getPluginDatabase() call
 */
function initSharedDb(path: string): Database.Database {
  // Ensure directory exists
  const dir = path.substring(0, path.lastIndexOf('/'));
  if (dir && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  logger.debug('Plugin database initialized', { path });
  return db;
}

/**
 * Get a scoped database accessor for a plugin
 *
 * @param pluginName - The plugin's unique name
 * @param customDbPath - Optional custom database path (defaults to config's dbPath)
 * @returns Scoped PluginDatabase instance
 */
export function getPluginDatabase(pluginName: string, customDbPath?: string): PluginDatabase {
  // Validate plugin name for table prefix safety
  if (!/^[a-z][a-z0-9_]*$/i.test(pluginName)) {
    throw new Error(
      `Invalid plugin name "${pluginName}" for database access. ` +
        'Plugin names must start with a letter and contain only letters, numbers, and underscores.'
    );
  }

  // Use cached instance if available
  const cached = pluginDatabases.get(pluginName);
  if (cached) {
    return cached;
  }

  // Determine database path
  const targetPath = customDbPath ?? './data/claude.db';

  // Initialize shared database if not already done
  if (!sharedDb) {
    dbPath = targetPath;
    sharedDb = initSharedDb(targetPath);
  } else if (dbPath !== targetPath) {
    throw new Error(
      `Database path conflict: plugin "${pluginName}" requested "${targetPath}" ` +
      `but shared database already initialized at "${dbPath ?? 'unknown'}"`
    );
  }

  // Create scoped accessor
  const pluginDb = new PluginDatabase(sharedDb, pluginName);
  pluginDatabases.set(pluginName, pluginDb);

  logger.debug('Plugin database accessor created', {
    plugin: pluginName,
    prefix: pluginDb.prefix,
  });

  return pluginDb;
}

/**
 * Remove a plugin's database accessor from the cache
 * Called when plugin initialization fails to prevent memory leaks
 */
export function removePluginDatabase(pluginName: string): void {
  pluginDatabases.delete(pluginName);
}

/**
 * Close all plugin database connections
 * Called during application shutdown
 */
export function closePluginDatabases(): void {
  if (sharedDb) {
    sharedDb.close();
    sharedDb = null;
    dbPath = null;
    pluginDatabases.clear();
    logger.debug('Plugin databases closed');
  }
}

/**
 * Get the shared database path (for testing)
 */
export function getPluginDatabasePath(): string | null {
  return dbPath;
}

/**
 * Reset plugin database state (for testing only)
 */
export function _resetPluginDatabases(): void {
  if (sharedDb) {
    sharedDb.close();
  }
  sharedDb = null;
  dbPath = null;
  pluginDatabases.clear();
}

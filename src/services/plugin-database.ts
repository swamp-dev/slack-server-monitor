import Database from 'better-sqlite3';
import type { Statement } from 'better-sqlite3';
import fs from 'fs';
import { logger } from '../utils/logger.js';

/**
 * Core tables that plugins cannot access
 */
const CORE_TABLES = ['conversations', 'tool_calls', 'channel_context'];

/**
 * Scoped database accessor for plugins
 *
 * Provides defense-in-depth by validating SQL statements to ensure plugins
 * only access their namespaced tables (plugin_{name}_*).
 *
 * SECURITY NOTE: This is heuristic validation, not cryptographic protection.
 * Plugins already have full process privileges - this prevents accidental
 * cross-contamination, not malicious access.
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
   * Execute raw SQL for schema creation
   * Only use for CREATE TABLE, CREATE INDEX, etc.
   */
  exec(sql: string): void {
    this.validateSql(sql);
    this.db.exec(sql);
  }

  /**
   * Prepare a parameterized statement
   * Use for all data operations (SELECT, INSERT, UPDATE, DELETE)
   */
  prepare<BindParameters extends unknown[] | object = unknown[], Result = unknown>(
    sql: string
  ): Statement<BindParameters, Result> {
    this.validateSql(sql);
    return this.db.prepare<BindParameters, Result>(sql);
  }

  /**
   * Run multiple operations in a transaction
   */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  /**
   * Validate SQL to ensure it only references allowed tables
   *
   * Allowed:
   * - Tables starting with plugin_{pluginName}_
   * - SQLite system tables (sqlite_*)
   * - PRAGMA statements
   *
   * Blocked:
   * - Core tables (conversations, tool_calls, channel_context)
   * - Other plugins' tables (plugin_othername_*)
   */
  private validateSql(sql: string): void {
    // Normalize whitespace for easier parsing
    const normalized = sql.toLowerCase().replace(/\s+/g, ' ').trim();

    // Allow PRAGMA statements for introspection
    if (normalized.startsWith('pragma ')) {
      return;
    }

    // Extract table names from common SQL patterns
    // This is heuristic - not a full SQL parser
    const tablePatterns = [
      // CREATE TABLE [IF NOT EXISTS] table_name
      /create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/gi,
      // DROP TABLE [IF EXISTS] table_name
      /drop\s+table\s+(?:if\s+exists\s+)?([a-z_][a-z0-9_]*)/gi,
      // INSERT INTO table_name
      /insert\s+(?:or\s+(?:replace|ignore|abort|rollback|fail)\s+)?into\s+([a-z_][a-z0-9_]*)/gi,
      // UPDATE table_name
      /update\s+(?:or\s+(?:replace|ignore|abort|rollback|fail)\s+)?([a-z_][a-z0-9_]*)/gi,
      // DELETE FROM table_name
      /delete\s+from\s+([a-z_][a-z0-9_]*)/gi,
      // SELECT ... FROM table_name
      /from\s+([a-z_][a-z0-9_]*)/gi,
      // JOIN table_name
      /join\s+([a-z_][a-z0-9_]*)/gi,
      // CREATE INDEX ... ON table_name
      /on\s+([a-z_][a-z0-9_]*)\s*\(/gi,
      // ALTER TABLE table_name
      /alter\s+table\s+([a-z_][a-z0-9_]*)/gi,
    ];

    const foundTables = new Set<string>();

    for (const pattern of tablePatterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(sql)) !== null) {
        const tableName = match[1] as string | undefined;
        if (tableName) {
          foundTables.add(tableName.toLowerCase());
        }
      }
    }

    // Validate each found table
    for (const table of foundTables) {
      // Allow SQLite system tables
      if (table.startsWith('sqlite_')) {
        continue;
      }

      // Check for core table access
      if (CORE_TABLES.includes(table)) {
        throw new Error(
          `Plugin "${this.pluginName}" attempted to access core table "${table}". ` +
            `Plugins can only access tables prefixed with "${this._prefix}".`
        );
      }

      // Check for other plugins' tables
      if (table.startsWith('plugin_') && !table.startsWith(this._prefix)) {
        throw new Error(
          `Plugin "${this.pluginName}" attempted to access another plugin's table "${table}". ` +
            `Plugins can only access their own tables prefixed with "${this._prefix}".`
        );
      }

      // Require plugin prefix for non-system tables
      if (!table.startsWith(this._prefix) && !table.startsWith('sqlite_')) {
        throw new Error(
          `Plugin "${this.pluginName}" attempted to access table "${table}". ` +
            `Plugins must prefix all tables with "${this._prefix}".`
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

/**
 * Lift Plugin — Database Schema Migration Utilities
 */

import type { PluginDatabase } from '../../src/services/plugin-database.js';
import { logger } from '../../src/utils/logger.js';

/**
 * Check if a column in a table is using INTEGER type instead of REAL
 * SQLite stores type affinity in the schema, we can check it via pragma
 */
function columnNeedsMigration(db: PluginDatabase, tableName: string, columnName: string): boolean {
  const tableInfo = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
    cid: number;
    name: string;
    type: string;
    notnull: number;
    dflt_value: string | null;
    pk: number;
  }>;

  const column = tableInfo.find(col => col.name === columnName);
  if (!column) return false;

  // Check if column type is INTEGER (needs migration to REAL)
  return column.type.toUpperCase() === 'INTEGER';
}

/**
 * Migrate table columns from INTEGER to REAL
 * SQLite doesn't support ALTER COLUMN, so we need to:
 * 1. Create a new table with REAL columns
 * 2. Copy data from old table
 * 3. Drop old table
 * 4. Rename new table
 *
 * This is safe because all existing integer values are valid as REAL values.
 */
export async function migrateToRealColumns(
  db: PluginDatabase,
  tableName: string,
  columns: string[]
): Promise<void> {
  // Check if any column needs migration
  const needsMigration = columns.some(col => columnNeedsMigration(db, tableName, col));
  if (!needsMigration) {
    return;
  }

  logger.info(`Migrating ${tableName} columns to REAL type`, { columns });

  // Get current table schema
  const tableInfo = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
    cid: number;
    name: string;
    type: string;
    notnull: number;
    dflt_value: string | null;
    pk: number;
  }>;

  // Build new table definition with REAL columns
  const columnDefs = tableInfo.map(col => {
    let type = col.type;
    if (columns.includes(col.name)) {
      type = 'REAL';
    }
    let def = `${col.name} ${type}`;
    if (col.pk) def += ' PRIMARY KEY';
    if (col.name === 'id') def += ' AUTOINCREMENT';
    if (col.notnull && !col.pk) def += ' NOT NULL';
    if (col.dflt_value !== null) def += ` DEFAULT ${col.dflt_value}`;
    return def;
  });

  const columnNames = tableInfo.map(col => col.name).join(', ');
  const tempTableName = `${tableName}_migration_temp`;

  // Execute migration in a transaction
  db.exec('BEGIN TRANSACTION');
  try {
    // Create temp table with new schema
    db.exec(`CREATE TABLE ${tempTableName} (${columnDefs.join(', ')})`);

    // Copy data
    db.exec(`INSERT INTO ${tempTableName} (${columnNames}) SELECT ${columnNames} FROM ${tableName}`);

    // Drop old table
    db.exec(`DROP TABLE ${tableName}`);

    // Rename temp table
    db.exec(`ALTER TABLE ${tempTableName} RENAME TO ${tableName}`);

    db.exec('COMMIT');
    logger.info(`Successfully migrated ${tableName} to REAL columns`);
  } catch (error) {
    db.exec('ROLLBACK');
    logger.error(`Failed to migrate ${tableName}`, { error });
    throw error;
  }
}

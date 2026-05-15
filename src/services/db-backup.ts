import type Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { logger } from '../utils/logger.js';

/**
 * Backup configuration
 */
interface BackupConfig {
  /** Interval between backups in hours */
  intervalHours: number;
  /** Directory to store backup files */
  backupDir: string;
  /** Number of backup files to retain */
  retain: number;
}

/**
 * Start a periodic backup schedule for a SQLite database
 *
 * Uses better-sqlite3's built-in .backup() API for safe, non-blocking backups.
 * Runs a WAL checkpoint before each backup to flush pending writes.
 * Rotates old backups to keep only the most recent N files.
 *
 * @param db - The better-sqlite3 database instance
 * @param config - Backup configuration
 * @returns Cleanup function to stop the schedule
 */
export function startBackupSchedule(
  db: Database.Database,
  config: BackupConfig
): () => void {
  const { intervalHours, backupDir, retain } = config;

  // Ensure backup directory exists
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const intervalMs = intervalHours * 60 * 60 * 1000;

  async function runBackup(): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `claude-backup-${timestamp}.db`);

    try {
      // Run WAL checkpoint before backup to flush all pending writes
      db.pragma('wal_checkpoint(FULL)');

      // Use better-sqlite3's async backup API
      await db.backup(backupPath);

      logger.info('Database backup completed', { path: backupPath });

      // Rotate old backups
      rotateBackups(backupDir, retain);
    } catch (err) {
      logger.error('Database backup failed', {
        error: err instanceof Error ? err.message : String(err),
        path: backupPath,
      });
    }
  }

  // Run first backup after a short delay (don't block startup)
  const initialTimeout = setTimeout(() => void runBackup(), 5000);

  // Schedule recurring backups
  const interval = setInterval(() => void runBackup(), intervalMs);

  logger.info('Database backup schedule started', {
    intervalHours,
    backupDir,
    retain,
  });

  // Return cleanup function
  return () => {
    clearTimeout(initialTimeout);
    clearInterval(interval);
    logger.info('Database backup schedule stopped');
  };
}

/**
 * Rotate backup files, keeping only the most recent N
 */
export function rotateBackups(backupDir: string, retain: number): void {
  try {
    const files = fs.readdirSync(backupDir)
      .filter((f) => f.startsWith('claude-backup-') && f.endsWith('.db'))
      .sort()
      .reverse(); // Most recent first (ISO timestamps sort correctly)

    const toDelete = files.slice(retain);
    for (const file of toDelete) {
      const filePath = path.join(backupDir, file);
      fs.unlinkSync(filePath);
      logger.debug('Rotated old backup', { path: filePath });
    }

    if (toDelete.length > 0) {
      logger.info('Rotated old backups', { deleted: toDelete.length, kept: retain });
    }
  } catch (err) {
    logger.error('Failed to rotate backups', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

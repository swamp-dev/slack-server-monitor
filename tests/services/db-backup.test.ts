import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock the logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { rotateBackups } from '../../src/services/db-backup.js';
import { logger } from '../../src/utils/logger.js';

describe('db-backup', () => {
  let db: Database.Database;
  let dbPath: string;
  let backupDir: string;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create a temp database
    dbPath = path.join(os.tmpdir(), `test-backup-${Date.now()}.db`);
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)');
    db.prepare('INSERT INTO test (value) VALUES (?)').run('hello');

    // Create temp backup dir
    backupDir = path.join(os.tmpdir(), `test-backups-${Date.now()}`);
    fs.mkdirSync(backupDir, { recursive: true });
  });

  afterEach(() => {
    db.close();

    // Cleanup
    try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-wal'); } catch { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-shm'); } catch { /* ignore */ }
    try { fs.rmSync(backupDir, { recursive: true }); } catch { /* ignore */ }
  });

  describe('direct backup via better-sqlite3', () => {
    it('should create a valid backup file', async () => {
      const backupPath = path.join(backupDir, 'test-backup.db');

      // Run WAL checkpoint before backup (as our service does)
      db.pragma('wal_checkpoint(FULL)');

      // Use the same API our service uses
      await db.backup(backupPath);

      // Verify backup exists and is valid
      expect(fs.existsSync(backupPath)).toBe(true);

      const backupDb = new Database(backupPath);
      const row = backupDb.prepare('SELECT value FROM test').get() as { value: string };
      expect(row.value).toBe('hello');
      backupDb.close();
    });
  });

  describe('startBackupSchedule', () => {
    it('should log startup info', async () => {
      // Use dynamic import to avoid issues with fake timers
      const { startBackupSchedule } = await import('../../src/services/db-backup.js');

      const cleanup = startBackupSchedule(db, {
        intervalHours: 6,
        backupDir,
        retain: 3,
      });

      expect(logger.info).toHaveBeenCalledWith('Database backup schedule started', {
        intervalHours: 6,
        backupDir,
        retain: 3,
      });

      cleanup();

      expect(logger.info).toHaveBeenCalledWith('Database backup schedule stopped');
    });
  });

  describe('rotateBackups', () => {
    it('should keep only the specified number of backups', () => {
      // Create 5 backup files with sequential timestamps
      for (let i = 1; i <= 5; i++) {
        const name = `claude-backup-2024-01-0${String(i)}-00-00-00.db`;
        fs.writeFileSync(path.join(backupDir, name), 'data');
      }

      rotateBackups(backupDir, 3);

      const remaining = fs.readdirSync(backupDir).filter((f) => f.endsWith('.db'));
      expect(remaining).toHaveLength(3);
      // Should keep the 3 most recent (highest timestamps)
      expect(remaining.sort()).toEqual([
        'claude-backup-2024-01-03-00-00-00.db',
        'claude-backup-2024-01-04-00-00-00.db',
        'claude-backup-2024-01-05-00-00-00.db',
      ]);
    });

    it('should do nothing when fewer than retain files exist', () => {
      fs.writeFileSync(path.join(backupDir, 'claude-backup-2024-01-01-00-00-00.db'), 'data');
      fs.writeFileSync(path.join(backupDir, 'claude-backup-2024-01-02-00-00-00.db'), 'data');

      rotateBackups(backupDir, 3);

      const remaining = fs.readdirSync(backupDir).filter((f) => f.endsWith('.db'));
      expect(remaining).toHaveLength(2);
    });

    it('should not delete non-backup files', () => {
      fs.writeFileSync(path.join(backupDir, 'claude-backup-2024-01-01-00-00-00.db'), 'data');
      fs.writeFileSync(path.join(backupDir, 'important-data.json'), 'keep me');

      rotateBackups(backupDir, 0); // Delete all backups

      const remaining = fs.readdirSync(backupDir);
      expect(remaining).toEqual(['important-data.json']);
    });

    it('should log rotation info when files are deleted', () => {
      for (let i = 1; i <= 4; i++) {
        fs.writeFileSync(path.join(backupDir, `claude-backup-2024-01-0${String(i)}-00-00-00.db`), 'data');
      }

      rotateBackups(backupDir, 2);

      expect(logger.info).toHaveBeenCalledWith('Rotated old backups', {
        deleted: 2,
        kept: 2,
      });
    });
  });
});

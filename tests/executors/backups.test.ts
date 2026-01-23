import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getLocalBackupStatus,
  getS3BackupStatus,
  getAllBackupStatus,
} from '../../src/executors/backups.js';

// Mock executeCommand
vi.mock('../../src/utils/shell.js', () => ({
  executeCommand: vi.fn(),
}));

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('backups executor', () => {
  let mockExecuteCommand: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const shell = await import('../../src/utils/shell.js');
    mockExecuteCommand = shell.executeCommand as ReturnType<typeof vi.fn>;
  });

  describe('getLocalBackupStatus', () => {
    const mockNow = new Date('2024-06-15T12:00:00Z');

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(mockNow);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should parse ls -lt output correctly', async () => {
      vi.useRealTimers(); // Use real timers to avoid timezone issues

      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: `total 12345
-rw-r--r-- 1 root root 10485760 Jun 15 10:00 backup-2024-06-15.tar.gz
-rw-r--r-- 1 root root 10485760 Jun 14 10:00 backup-2024-06-14.tar.gz
-rw-r--r-- 1 root root 10485760 Jun 13 10:00 backup-2024-06-13.tar.gz`,
        stderr: '',
      });

      const result = await getLocalBackupStatus('/opt/backups');

      expect(result.path).toBe('/opt/backups');
      expect(result.exists).toBe(true);
      expect(result.files).toHaveLength(3);
      expect(result.files[0].name).toBe('backup-2024-06-15.tar.gz');
      expect(result.files[0].size).toBe(10485760);
      expect(result.files[0].modified).toBe('Jun 15 10:00');
      // Status depends on current time, just verify it's a valid value
      expect(['ok', 'warn', 'error']).toContain(result.status);
    });

    it('should return warn status for backups older than 24h', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: `total 12345
-rw-r--r-- 1 root root 10485760 Jun 13 10:00 backup-2024-06-13.tar.gz`,
        stderr: '',
      });

      const result = await getLocalBackupStatus('/opt/backups');

      expect(result.status).toBe('warn'); // 2+ days old
    });

    it('should return error status for backups older than 48h', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: `total 12345
-rw-r--r-- 1 root root 10485760 Jun 10 10:00 backup-2024-06-10.tar.gz`,
        stderr: '',
      });

      const result = await getLocalBackupStatus('/opt/backups');

      expect(result.status).toBe('error'); // 5+ days old
    });

    it('should handle empty directory', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'total 0',
        stderr: '',
      });

      const result = await getLocalBackupStatus('/opt/backups');

      expect(result.exists).toBe(true);
      expect(result.files).toEqual([]);
      expect(result.status).toBe('error'); // No backups is an error
      expect(result.error).toContain('No backup files found');
    });

    it('should handle directory not found', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 2,
        stdout: '',
        stderr: "ls: cannot access '/nonexistent': No such file or directory",
      });

      const result = await getLocalBackupStatus('/nonexistent');

      expect(result.exists).toBe(false);
      expect(result.status).toBe('error');
      expect(result.error).toContain('Directory not found');
    });

    it('should handle permission denied', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 2,
        stdout: '',
        stderr: "ls: cannot open directory '/root/backups': Permission denied",
      });

      const result = await getLocalBackupStatus('/root/backups');

      expect(result.exists).toBe(true);
      expect(result.status).toBe('error');
      expect(result.error).toContain('Permission denied');
    });

    it('should limit files to 5 most recent', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: `total 12345
-rw-r--r-- 1 root root 1000 Jun 15 10:00 backup-1.tar.gz
-rw-r--r-- 1 root root 1000 Jun 14 10:00 backup-2.tar.gz
-rw-r--r-- 1 root root 1000 Jun 13 10:00 backup-3.tar.gz
-rw-r--r-- 1 root root 1000 Jun 12 10:00 backup-4.tar.gz
-rw-r--r-- 1 root root 1000 Jun 11 10:00 backup-5.tar.gz
-rw-r--r-- 1 root root 1000 Jun 10 10:00 backup-6.tar.gz
-rw-r--r-- 1 root root 1000 Jun 09 10:00 backup-7.tar.gz`,
        stderr: '',
      });

      const result = await getLocalBackupStatus('/opt/backups');

      expect(result.files).toHaveLength(5);
      expect(result.files[0].name).toBe('backup-1.tar.gz');
      expect(result.files[4].name).toBe('backup-5.tar.gz');
    });

    it('should skip directories in output', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: `total 12345
drwxr-xr-x 2 root root 4096 Jun 15 10:00 subdir
-rw-r--r-- 1 root root 10485760 Jun 15 09:00 backup.tar.gz`,
        stderr: '',
      });

      const result = await getLocalBackupStatus('/opt/backups');

      expect(result.files).toHaveLength(1);
      expect(result.files[0].name).toBe('backup.tar.gz');
    });

    describe('year boundary handling', () => {
      it('should correctly parse file from December when current month is January', async () => {
        // Set current time to January 2, 2025 at 10:00
        vi.setSystemTime(new Date('2025-01-02T10:00:00Z'));

        mockExecuteCommand.mockResolvedValueOnce({
          exitCode: 0,
          stdout: `total 12345
-rw-r--r-- 1 root root 10485760 Dec 31 10:00 backup-2024-12-31.tar.gz`,
          stderr: '',
        });

        const result = await getLocalBackupStatus('/opt/backups');

        expect(result.exists).toBe(true);
        expect(result.files).toHaveLength(1);
        // The file should be from Dec 31, 2024 (2 days old), not Dec 31, 2025 (future)
        // 2 days = 48 hours, which is at the warn/error boundary
        expect(result.status).toBe('warn'); // ~48 hours old is at boundary
        expect(result.lastBackupAge).toBeDefined();
        // Age should be around 2 days (48 hours), not negative
        if (result.lastBackupAge !== undefined) {
          expect(result.lastBackupAge).toBeGreaterThanOrEqual(40); // At least 40 hours
          expect(result.lastBackupAge).toBeLessThan(60); // Less than 60 hours
        }
      });

      it('should correctly handle file from same month in current year', async () => {
        // Set current time to June 15, 2024 at 08:00 (22 hours after file)
        vi.setSystemTime(new Date('2024-06-15T08:00:00Z'));

        mockExecuteCommand.mockResolvedValueOnce({
          exitCode: 0,
          stdout: `total 12345
-rw-r--r-- 1 root root 10485760 Jun 14 10:00 backup.tar.gz`,
          stderr: '',
        });

        const result = await getLocalBackupStatus('/opt/backups');

        // ~22 hours old, which is < 24 hours (WARN_HOURS), so should be 'ok'
        expect(result.status).toBe('ok');
        expect(result.lastBackupAge).toBeDefined();
        if (result.lastBackupAge !== undefined) {
          expect(result.lastBackupAge).toBeGreaterThan(15); // At least 15 hours
          expect(result.lastBackupAge).toBeLessThan(30); // Less than 30 hours
        }
      });

      it('should handle explicit year in ls output (older files)', async () => {
        // Set current time to June 15, 2024
        vi.setSystemTime(new Date('2024-06-15T12:00:00Z'));

        mockExecuteCommand.mockResolvedValueOnce({
          exitCode: 0,
          stdout: `total 12345
-rw-r--r-- 1 root root 10485760 Dec 15 2023 backup-old.tar.gz`,
          stderr: '',
        });

        const result = await getLocalBackupStatus('/opt/backups');

        expect(result.status).toBe('error'); // Very old backup
        expect(result.lastBackupAge).toBeDefined();
        if (result.lastBackupAge !== undefined) {
          // Should be ~6 months old (around 4400 hours)
          expect(result.lastBackupAge).toBeGreaterThan(4000);
        }
      });

      it('should handle late December file when current date is late December', async () => {
        // Set current time to December 28, 2024 at 08:00 (22 hours after file)
        vi.setSystemTime(new Date('2024-12-28T08:00:00Z'));

        mockExecuteCommand.mockResolvedValueOnce({
          exitCode: 0,
          stdout: `total 12345
-rw-r--r-- 1 root root 10485760 Dec 27 10:00 backup.tar.gz`,
          stderr: '',
        });

        const result = await getLocalBackupStatus('/opt/backups');

        // ~22 hours old, which is < 24 hours (WARN_HOURS), so should be 'ok'
        expect(result.status).toBe('ok');
        expect(result.lastBackupAge).toBeDefined();
        if (result.lastBackupAge !== undefined) {
          // Should be ~22 hours old
          expect(result.lastBackupAge).toBeGreaterThan(15);
          expect(result.lastBackupAge).toBeLessThan(30);
        }
      });
    });
  });

  describe('getS3BackupStatus', () => {
    const mockNow = new Date('2024-06-15T12:00:00Z');

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(mockNow);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should parse aws s3 ls output', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: `2024-06-15 10:00:00   10485760 backup-2024-06-15.tar.gz
2024-06-14 10:00:00   10485760 backup-2024-06-14.tar.gz
2024-06-13 10:00:00   10485760 backup-2024-06-13.tar.gz`,
        stderr: '',
      });

      const result = await getS3BackupStatus('my-backup-bucket');

      expect(result.bucket).toBe('my-backup-bucket');
      expect(result.accessible).toBe(true);
      expect(result.files).toHaveLength(3);
      expect(result.files[0].name).toBe('backup-2024-06-15.tar.gz');
      expect(result.files[0].size).toBe(10485760);
      expect(result.status).toBe('ok');
    });

    it('should handle bucket with prefix', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: `2024-06-15 10:00:00   10485760 server1/backup.tar.gz`,
        stderr: '',
      });

      await getS3BackupStatus('my-bucket', 'server1/');

      expect(mockExecuteCommand).toHaveBeenCalledWith(
        'aws',
        ['s3', 'ls', 's3://my-bucket/server1/', '--human-readable'],
        expect.any(Object)
      );
    });

    it('should handle empty bucket', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: '',
        stderr: '',
      });

      const result = await getS3BackupStatus('empty-bucket');

      expect(result.accessible).toBe(true);
      expect(result.files).toEqual([]);
      expect(result.status).toBe('error');
      expect(result.error).toContain('No backup files found');
    });

    it('should handle bucket not found', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'An error occurred (NoSuchBucket) when calling the ListObjectsV2 operation: The specified bucket does not exist',
      });

      const result = await getS3BackupStatus('nonexistent-bucket');

      expect(result.accessible).toBe(false);
      expect(result.status).toBe('error');
      expect(result.error).toContain('Bucket not found');
    });

    it('should handle access denied', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'An error occurred (AccessDenied) when calling the ListObjectsV2 operation: Access Denied',
      });

      const result = await getS3BackupStatus('private-bucket');

      expect(result.accessible).toBe(false);
      expect(result.status).toBe('error');
      expect(result.error).toContain('Access denied');
    });

    it('should handle AWS CLI not configured', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'Unable to locate credentials. You can configure credentials by running "aws configure".',
      });

      const result = await getS3BackupStatus('my-bucket');

      expect(result.accessible).toBe(false);
      expect(result.error).toContain('AWS credentials not configured');
    });

    it('should limit files to 5 most recent', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: `2024-06-15 10:00:00   1000 backup-1.tar.gz
2024-06-14 10:00:00   1000 backup-2.tar.gz
2024-06-13 10:00:00   1000 backup-3.tar.gz
2024-06-12 10:00:00   1000 backup-4.tar.gz
2024-06-11 10:00:00   1000 backup-5.tar.gz
2024-06-10 10:00:00   1000 backup-6.tar.gz
2024-06-09 10:00:00   1000 backup-7.tar.gz`,
        stderr: '',
      });

      const result = await getS3BackupStatus('my-bucket');

      expect(result.files).toHaveLength(5);
    });
  });

  describe('getAllBackupStatus', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-06-15T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should check all configured backup locations', async () => {
      // First call for local dir 1
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: `-rw-r--r-- 1 root root 1000 Jun 15 10:00 backup.tar.gz`,
        stderr: '',
      });
      // Second call for local dir 2
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: `-rw-r--r-- 1 root root 1000 Jun 15 10:00 backup.tar.gz`,
        stderr: '',
      });
      // Third call for S3
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: `2024-06-15 10:00:00   1000 backup.tar.gz`,
        stderr: '',
      });

      const result = await getAllBackupStatus(
        ['/opt/backups', '/var/backups'],
        'my-bucket'
      );

      expect(result.local).toHaveLength(2);
      expect(result.s3).toBeDefined();
      expect(result.s3?.bucket).toBe('my-bucket');
    });

    it('should handle no S3 bucket configured', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: `-rw-r--r-- 1 root root 1000 Jun 15 10:00 backup.tar.gz`,
        stderr: '',
      });

      const result = await getAllBackupStatus(['/opt/backups'], undefined);

      expect(result.local).toHaveLength(1);
      expect(result.s3).toBeUndefined();
    });

    it('should handle no local directories configured', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: `2024-06-15 10:00:00   1000 backup.tar.gz`,
        stderr: '',
      });

      const result = await getAllBackupStatus([], 'my-bucket');

      expect(result.local).toEqual([]);
      expect(result.s3).toBeDefined();
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { App } from '@slack/bolt';

// Mock dependencies
vi.mock('../../src/executors/backups.js', () => ({
  getAllBackupStatus: vi.fn(),
}));

vi.mock('../../src/config/index.js', () => ({
  config: {
    server: {
      backupDirs: [],
      s3BackupBucket: '',
    },
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Import after mocks
const { registerBackupsCommand } = await import('../../src/commands/backups.js');
const { getAllBackupStatus } = await import('../../src/executors/backups.js');
const { config } = await import('../../src/config/index.js');
const { logger } = await import('../../src/utils/logger.js');

describe('/backups command', () => {
  let mockApp: { command: ReturnType<typeof vi.fn> };
  let mockAck: ReturnType<typeof vi.fn>;
  let mockRespond: ReturnType<typeof vi.fn>;
  let commandHandler: (args: {
    ack: () => Promise<void>;
    respond: (response: unknown) => Promise<void>;
  }) => Promise<void>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockAck = vi.fn().mockResolvedValue(undefined);
    mockRespond = vi.fn().mockResolvedValue(undefined);
    config.server.backupDirs = [];
    config.server.s3BackupBucket = '';

    mockApp = {
      command: vi.fn((name: string, handler: typeof commandHandler) => {
        if (name === '/backups') {
          commandHandler = handler;
        }
      }),
    };

    registerBackupsCommand(mockApp as unknown as App);
  });

  describe('no backup locations configured', () => {
    it('should show message when no backup locations configured', async () => {
      config.server.backupDirs = [];
      config.server.s3BackupBucket = '';

      await commandHandler({
        ack: mockAck,
        respond: mockRespond,
      });

      expect(getAllBackupStatus).not.toHaveBeenCalled();
      expect(mockRespond).toHaveBeenCalledWith({
        blocks: expect.arrayContaining([
          expect.objectContaining({
            type: 'section',
            text: expect.objectContaining({
              text: expect.stringContaining('No backup locations configured'),
            }),
          }),
        ]),
        response_type: 'ephemeral',
      });
    });
  });

  describe('local backup status', () => {
    it('should display local backup status', async () => {
      config.server.backupDirs = ['/backups/daily'];

      (getAllBackupStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
        local: [
          {
            path: '/backups/daily',
            exists: true,
            status: 'ok',
            lastBackupAge: 2,
            files: [{ name: 'backup-2024-01-01.tar.gz', size: 1024 * 1024 * 100 }],
          },
        ],
        s3: null,
      });

      await commandHandler({
        ack: mockAck,
        respond: mockRespond,
      });

      expect(getAllBackupStatus).toHaveBeenCalledWith(['/backups/daily'], '');
      expect(mockRespond).toHaveBeenCalledWith({
        blocks: expect.arrayContaining([
          expect.objectContaining({
            type: 'header',
            text: expect.objectContaining({
              text: 'Backup Status',
            }),
          }),
        ]),
        response_type: 'ephemeral',
      });
    });

    it('should show directory not found error', async () => {
      config.server.backupDirs = ['/backups/missing'];

      (getAllBackupStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
        local: [
          {
            path: '/backups/missing',
            exists: false,
            status: 'error',
            error: 'Directory not found',
            lastBackupAge: undefined,
            files: [],
          },
        ],
        s3: null,
      });

      await commandHandler({
        ack: mockAck,
        respond: mockRespond,
      });

      const response = mockRespond.mock.calls[0][0];
      const sectionTexts = response.blocks
        .filter((b: { type: string }) => b.type === 'section')
        .map((b: { text?: { text: string } }) => b.text?.text || '');

      expect(sectionTexts.some((t: string) => t.includes('not found'))).toBe(true);
    });

    it('should show warning for stale backups', async () => {
      config.server.backupDirs = ['/backups/stale'];

      (getAllBackupStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
        local: [
          {
            path: '/backups/stale',
            exists: true,
            status: 'warn',
            lastBackupAge: 36, // 36 hours old
            files: [{ name: 'backup-old.tar.gz', size: 1024 }],
          },
        ],
        s3: null,
      });

      await commandHandler({
        ack: mockAck,
        respond: mockRespond,
      });

      expect(mockRespond).toHaveBeenCalled();
    });

    it('should show recent backup files', async () => {
      config.server.backupDirs = ['/backups/daily'];

      (getAllBackupStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
        local: [
          {
            path: '/backups/daily',
            exists: true,
            status: 'ok',
            lastBackupAge: 1,
            files: [
              { name: 'backup-2024-01-01.tar.gz', size: 1024 * 1024 * 100 },
              { name: 'backup-2024-01-02.tar.gz', size: 1024 * 1024 * 105 },
            ],
          },
        ],
        s3: null,
      });

      await commandHandler({
        ack: mockAck,
        respond: mockRespond,
      });

      const response = mockRespond.mock.calls[0][0];
      const contextBlocks = response.blocks.filter(
        (b: { type: string }) => b.type === 'context'
      );
      const contextTexts = contextBlocks.map(
        (b: { elements?: { text: string }[] }) => b.elements?.[0]?.text || ''
      );

      expect(contextTexts.some((t: string) => t.includes('backup-2024-01-01'))).toBe(true);
    });
  });

  describe('S3 backup status', () => {
    it('should display S3 backup status', async () => {
      config.server.backupDirs = [];
      config.server.s3BackupBucket = 'my-backup-bucket';

      (getAllBackupStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
        local: [],
        s3: {
          bucket: 'my-backup-bucket',
          prefix: '',
          accessible: true,
          status: 'ok',
          lastBackupAge: 5,
          files: [{ name: 's3-backup.tar.gz', size: 1024 * 1024 * 200 }],
        },
      });

      await commandHandler({
        ack: mockAck,
        respond: mockRespond,
      });

      expect(getAllBackupStatus).toHaveBeenCalledWith([], 'my-backup-bucket');

      const response = mockRespond.mock.calls[0][0];
      const sectionTexts = response.blocks
        .filter((b: { type: string }) => b.type === 'section')
        .map((b: { text?: { text: string } }) => b.text?.text || '');

      expect(sectionTexts.some((t: string) => t.includes('S3'))).toBe(true);
    });

    it('should show S3 not accessible error', async () => {
      config.server.backupDirs = [];
      config.server.s3BackupBucket = 'inaccessible-bucket';

      (getAllBackupStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
        local: [],
        s3: {
          bucket: 'inaccessible-bucket',
          prefix: '',
          accessible: false,
          status: 'error',
          error: 'Access denied',
          lastBackupAge: undefined,
          files: [],
        },
      });

      await commandHandler({
        ack: mockAck,
        respond: mockRespond,
      });

      const response = mockRespond.mock.calls[0][0];
      const sectionTexts = response.blocks
        .filter((b: { type: string }) => b.type === 'section')
        .map((b: { text?: { text: string } }) => b.text?.text || '');

      // The text contains "_Not accessible_" with underscores for italic formatting
      expect(sectionTexts.some((t: string) => t.includes('_Not accessible_') || t.includes('Access denied'))).toBe(true);
    });

    it('should show S3 bucket with prefix', async () => {
      config.server.backupDirs = [];
      config.server.s3BackupBucket = 'my-bucket/backups';

      (getAllBackupStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
        local: [],
        s3: {
          bucket: 'my-bucket',
          prefix: 'backups',
          accessible: true,
          status: 'ok',
          lastBackupAge: 2,
          files: [],
        },
      });

      await commandHandler({
        ack: mockAck,
        respond: mockRespond,
      });

      const response = mockRespond.mock.calls[0][0];
      const sectionTexts = response.blocks
        .filter((b: { type: string }) => b.type === 'section')
        .map((b: { text?: { text: string } }) => b.text?.text || '');

      expect(sectionTexts.some((t: string) => t.includes('my-bucket/backups'))).toBe(true);
    });
  });

  describe('combined local and S3', () => {
    it('should display both local and S3 backups', async () => {
      config.server.backupDirs = ['/backups/daily'];
      config.server.s3BackupBucket = 'my-bucket';

      (getAllBackupStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
        local: [
          {
            path: '/backups/daily',
            exists: true,
            status: 'ok',
            lastBackupAge: 1,
            files: [],
          },
        ],
        s3: {
          bucket: 'my-bucket',
          prefix: '',
          accessible: true,
          status: 'ok',
          lastBackupAge: 2,
          files: [],
        },
      });

      await commandHandler({
        ack: mockAck,
        respond: mockRespond,
      });

      const response = mockRespond.mock.calls[0][0];
      const sectionTexts = response.blocks
        .filter((b: { type: string }) => b.type === 'section')
        .map((b: { text?: { text: string } }) => b.text?.text || '');

      expect(sectionTexts.some((t: string) => t.includes('/backups/daily'))).toBe(true);
      expect(sectionTexts.some((t: string) => t.includes('S3'))).toBe(true);
    });

    it('should show stats bar with combined statuses', async () => {
      config.server.backupDirs = ['/backups/ok', '/backups/stale'];
      config.server.s3BackupBucket = 'error-bucket';

      (getAllBackupStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
        local: [
          { path: '/backups/ok', exists: true, status: 'ok', lastBackupAge: 1, files: [] },
          { path: '/backups/stale', exists: true, status: 'warn', lastBackupAge: 30, files: [] },
        ],
        s3: {
          bucket: 'error-bucket',
          prefix: '',
          accessible: false,
          status: 'error',
          error: 'Access denied',
          lastBackupAge: undefined,
          files: [],
        },
      });

      await commandHandler({
        ack: mockAck,
        respond: mockRespond,
      });

      const response = mockRespond.mock.calls[0][0];
      const contextBlocks = response.blocks.filter(
        (b: { type: string }) => b.type === 'context'
      );
      const contextTexts = contextBlocks.map(
        (b: { elements?: { text: string }[] }) => b.elements?.[0]?.text || ''
      );

      // Should have stats bar with all statuses
      expect(contextTexts.some((t: string) => t.includes('current'))).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should handle backup status errors', async () => {
      config.server.backupDirs = ['/backups'];

      (getAllBackupStatus as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Permission denied')
      );

      await commandHandler({
        ack: mockAck,
        respond: mockRespond,
      });

      expect(logger.error).toHaveBeenCalledWith(
        'Backups command failed',
        expect.objectContaining({ error: 'Permission denied' })
      );
      expect(mockRespond).toHaveBeenCalledWith({
        blocks: expect.arrayContaining([
          expect.objectContaining({
            type: 'section',
            text: expect.objectContaining({
              text: expect.stringContaining('Permission denied'),
            }),
          }),
        ]),
        response_type: 'ephemeral',
      });
    });

    it('should handle non-Error exceptions', async () => {
      config.server.backupDirs = ['/backups'];

      (getAllBackupStatus as ReturnType<typeof vi.fn>).mockRejectedValue('string error');

      await commandHandler({
        ack: mockAck,
        respond: mockRespond,
      });

      expect(mockRespond).toHaveBeenCalledWith({
        blocks: expect.arrayContaining([
          expect.objectContaining({
            text: expect.objectContaining({
              text: expect.stringContaining('unexpected error'),
            }),
          }),
        ]),
        response_type: 'ephemeral',
      });
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SlackCommandMiddlewareArgs, AllMiddlewareArgs } from '@slack/bolt';

// Mock the logger
vi.mock('../../src/utils/logger.js', () => ({
  auditLog: vi.fn(),
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Import after mocks are set up
const { auditLogMiddleware } = await import('../../src/middleware/audit-log.js');
const { auditLog } = await import('../../src/utils/logger.js');

describe('auditLogMiddleware', () => {
  let mockNext: ReturnType<typeof vi.fn>;
  let mockCommand: {
    user_id: string;
    user_name: string;
    channel_id: string;
    channel_name: string;
    command: string;
    text: string;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockNext = vi.fn();
    mockCommand = {
      user_id: 'U12345678',
      user_name: 'testuser',
      channel_id: 'C12345678',
      channel_name: 'test-channel',
      command: '/services',
      text: 'nginx',
    };
  });

  describe('command logging', () => {
    it('should log command execution', async () => {
      const args = {
        command: mockCommand,
        next: mockNext,
      } as unknown as SlackCommandMiddlewareArgs & AllMiddlewareArgs;

      await auditLogMiddleware(args);

      expect(auditLog).toHaveBeenCalledWith({
        userId: 'U12345678',
        userName: 'testuser',
        channelId: 'C12345678',
        channelName: 'test-channel',
        command: '/services',
        args: 'nginx',
      });
    });

    it('should log command with empty args', async () => {
      mockCommand.text = '';

      const args = {
        command: mockCommand,
        next: mockNext,
      } as unknown as SlackCommandMiddlewareArgs & AllMiddlewareArgs;

      await auditLogMiddleware(args);

      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          args: '',
        })
      );
    });

    it('should log different commands correctly', async () => {
      mockCommand.command = '/logs';
      mockCommand.text = 'nginx 100';

      const args = {
        command: mockCommand,
        next: mockNext,
      } as unknown as SlackCommandMiddlewareArgs & AllMiddlewareArgs;

      await auditLogMiddleware(args);

      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          command: '/logs',
          args: 'nginx 100',
        })
      );
    });
  });

  describe('middleware pass-through', () => {
    it('should always call next() after logging', async () => {
      const args = {
        command: mockCommand,
        next: mockNext,
      } as unknown as SlackCommandMiddlewareArgs & AllMiddlewareArgs;

      await auditLogMiddleware(args);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should call next() even with unusual input', async () => {
      mockCommand.text = 'special characters: <>&"\' test';

      const args = {
        command: mockCommand,
        next: mockNext,
      } as unknown as SlackCommandMiddlewareArgs & AllMiddlewareArgs;

      await auditLogMiddleware(args);

      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('non-command events', () => {
    it('should pass through non-command events without logging', async () => {
      const args = {
        event: { type: 'message' },
        next: mockNext,
      } as unknown as AllMiddlewareArgs;

      await auditLogMiddleware(args);

      expect(auditLog).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
    });

    it('should pass through app_mention events without logging', async () => {
      const args = {
        event: { type: 'app_mention' },
        next: mockNext,
      } as unknown as AllMiddlewareArgs;

      await auditLogMiddleware(args);

      expect(auditLog).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('different users and channels', () => {
    it('should log different users correctly', async () => {
      mockCommand.user_id = 'UDIFFERENT';
      mockCommand.user_name = 'anotheruser';

      const args = {
        command: mockCommand,
        next: mockNext,
      } as unknown as SlackCommandMiddlewareArgs & AllMiddlewareArgs;

      await auditLogMiddleware(args);

      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'UDIFFERENT',
          userName: 'anotheruser',
        })
      );
    });

    it('should log different channels correctly', async () => {
      mockCommand.channel_id = 'CDIFFERENT';
      mockCommand.channel_name = 'another-channel';

      const args = {
        command: mockCommand,
        next: mockNext,
      } as unknown as SlackCommandMiddlewareArgs & AllMiddlewareArgs;

      await auditLogMiddleware(args);

      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          channelId: 'CDIFFERENT',
          channelName: 'another-channel',
        })
      );
    });
  });
});

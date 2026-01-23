import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SlackCommandMiddlewareArgs, AllMiddlewareArgs } from '@slack/bolt';

// Mock the config module before importing the middleware
vi.mock('../../src/config/index.js', () => ({
  config: {
    authorization: {
      userIds: ['U12345678', 'UAUTHORIZED'],
      channelIds: [], // Will be overridden in tests that need channel restrictions
    },
  },
}));

// Mock the logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Import after mocks are set up
const { authorizeMiddleware } = await import('../../src/middleware/authorize.js');
const { config } = await import('../../src/config/index.js');
const { logger } = await import('../../src/utils/logger.js');

describe('authorizeMiddleware', () => {
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
      command: '/status',
      text: '',
    };
    // Reset channel IDs to empty (no restrictions)
    config.authorization.channelIds = [];
  });

  describe('user authorization', () => {
    it('should allow authorized users', async () => {
      const args = {
        command: mockCommand,
        next: mockNext,
      } as unknown as SlackCommandMiddlewareArgs & AllMiddlewareArgs;

      await authorizeMiddleware(args);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should allow second authorized user', async () => {
      mockCommand.user_id = 'UAUTHORIZED';

      const args = {
        command: mockCommand,
        next: mockNext,
      } as unknown as SlackCommandMiddlewareArgs & AllMiddlewareArgs;

      await authorizeMiddleware(args);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should silently reject unauthorized users', async () => {
      mockCommand.user_id = 'UUNAUTHORIZED';
      mockCommand.user_name = 'hacker';

      const args = {
        command: mockCommand,
        next: mockNext,
      } as unknown as SlackCommandMiddlewareArgs & AllMiddlewareArgs;

      await authorizeMiddleware(args);

      // Should NOT call next (request is silently dropped)
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should log unauthorized access attempts', async () => {
      mockCommand.user_id = 'UUNAUTHORIZED';
      mockCommand.user_name = 'attacker';
      mockCommand.command = '/sensitive';
      mockCommand.text = 'some args';

      const args = {
        command: mockCommand,
        next: mockNext,
      } as unknown as SlackCommandMiddlewareArgs & AllMiddlewareArgs;

      await authorizeMiddleware(args);

      expect(logger.warn).toHaveBeenCalledWith(
        'Unauthorized user attempted command',
        expect.objectContaining({
          userId: 'UUNAUTHORIZED',
          userName: 'attacker',
          command: '/sensitive',
          args: 'some args',
        })
      );
    });
  });

  describe('channel authorization', () => {
    it('should allow any channel when no channel restrictions configured', async () => {
      config.authorization.channelIds = [];
      mockCommand.channel_id = 'CANYCHANNEL';

      const args = {
        command: mockCommand,
        next: mockNext,
      } as unknown as SlackCommandMiddlewareArgs & AllMiddlewareArgs;

      await authorizeMiddleware(args);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should allow authorized channel when restrictions are configured', async () => {
      config.authorization.channelIds = ['CALLOWED1', 'CALLOWED2'];
      mockCommand.channel_id = 'CALLOWED1';

      const args = {
        command: mockCommand,
        next: mockNext,
      } as unknown as SlackCommandMiddlewareArgs & AllMiddlewareArgs;

      await authorizeMiddleware(args);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should silently reject unauthorized channel', async () => {
      config.authorization.channelIds = ['CALLOWED1', 'CALLOWED2'];
      mockCommand.channel_id = 'CUNAUTHORIZED';
      mockCommand.channel_name = 'random-channel';

      const args = {
        command: mockCommand,
        next: mockNext,
      } as unknown as SlackCommandMiddlewareArgs & AllMiddlewareArgs;

      await authorizeMiddleware(args);

      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should log unauthorized channel access attempts', async () => {
      config.authorization.channelIds = ['CALLOWED1'];
      mockCommand.channel_id = 'CUNAUTHORIZED';
      mockCommand.channel_name = 'public-channel';

      const args = {
        command: mockCommand,
        next: mockNext,
      } as unknown as SlackCommandMiddlewareArgs & AllMiddlewareArgs;

      await authorizeMiddleware(args);

      expect(logger.warn).toHaveBeenCalledWith(
        'Command from unauthorized channel',
        expect.objectContaining({
          channelId: 'CUNAUTHORIZED',
          channelName: 'public-channel',
        })
      );
    });
  });

  describe('non-command events', () => {
    it('should pass through non-command events', async () => {
      // Event without 'command' property (e.g., message event)
      const args = {
        event: { type: 'message' },
        next: mockNext,
      } as unknown as AllMiddlewareArgs;

      await authorizeMiddleware(args);

      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('combined user and channel checks', () => {
    it('should require both user and channel authorization', async () => {
      config.authorization.channelIds = ['CALLOWED'];

      // Authorized user, authorized channel
      mockCommand.user_id = 'U12345678';
      mockCommand.channel_id = 'CALLOWED';

      const args = {
        command: mockCommand,
        next: mockNext,
      } as unknown as SlackCommandMiddlewareArgs & AllMiddlewareArgs;

      await authorizeMiddleware(args);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should reject authorized user in unauthorized channel', async () => {
      config.authorization.channelIds = ['CALLOWED'];

      mockCommand.user_id = 'U12345678'; // Authorized user
      mockCommand.channel_id = 'CUNAUTHORIZED'; // Not in allowed list

      const args = {
        command: mockCommand,
        next: mockNext,
      } as unknown as SlackCommandMiddlewareArgs & AllMiddlewareArgs;

      await authorizeMiddleware(args);

      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject unauthorized user in authorized channel', async () => {
      config.authorization.channelIds = ['CALLOWED'];

      mockCommand.user_id = 'UUNAUTHORIZED'; // Not in allowed list
      mockCommand.channel_id = 'CALLOWED'; // Authorized channel

      const args = {
        command: mockCommand,
        next: mockNext,
      } as unknown as SlackCommandMiddlewareArgs & AllMiddlewareArgs;

      await authorizeMiddleware(args);

      expect(mockNext).not.toHaveBeenCalled();
    });
  });
});

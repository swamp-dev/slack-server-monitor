import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  SlackCommandMiddlewareArgs,
  AllMiddlewareArgs,
  AnyMiddlewareArgs,
  RespondFn,
} from '@slack/bolt';

// Mock the config module before importing the middleware
vi.mock('../../src/config/index.js', () => ({
  config: {
    rateLimit: {
      max: 5,
      windowSeconds: 60,
      commands: {
        '/ask': { max: 3, windowSeconds: 30 },
      },
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
const { rateLimitMiddleware, getRateLimitStatus, clearRateLimit } = await import(
  '../../src/middleware/rate-limit.js'
);
const { logger } = await import('../../src/utils/logger.js');

describe('rateLimitMiddleware', () => {
  let mockNext: ReturnType<typeof vi.fn>;
  let mockRespond: ReturnType<typeof vi.fn>;
  let mockCommand: {
    user_id: string;
    user_name: string;
    channel_id: string;
    command: string;
    text: string;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockNext = vi.fn();
    mockRespond = vi.fn();
    mockCommand = {
      user_id: 'U12345678',
      user_name: 'testuser',
      channel_id: 'C12345678',
      command: '/services',
      text: '',
    };
    // Clear rate limits for our test users
    clearRateLimit('U12345678');
    clearRateLimit('U87654321');
  });

  afterEach(() => {
    clearRateLimit('U12345678');
    clearRateLimit('U87654321');
    vi.useRealTimers();
  });

  describe('burst allowance and token bucket', () => {
    it('should allow requests under the limit (burst)', async () => {
      const args = {
        command: mockCommand,
        respond: mockRespond as RespondFn,
        next: mockNext,
      } as unknown as SlackCommandMiddlewareArgs & AllMiddlewareArgs;

      // First request should be allowed
      await rateLimitMiddleware(args);
      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockRespond).not.toHaveBeenCalled();
    });

    it('should allow full burst up to max tokens', async () => {
      const args = {
        command: mockCommand,
        respond: mockRespond as RespondFn,
        next: mockNext,
      } as unknown as SlackCommandMiddlewareArgs & AllMiddlewareArgs;

      // Make 5 requests (all tokens used)
      for (let i = 0; i < 5; i++) {
        await rateLimitMiddleware(args);
      }

      expect(mockNext).toHaveBeenCalledTimes(5);
      expect(mockRespond).not.toHaveBeenCalled();
    });

    it('should block requests after tokens exhausted', async () => {
      const args = {
        command: mockCommand,
        respond: mockRespond as RespondFn,
        next: mockNext,
      } as unknown as SlackCommandMiddlewareArgs & AllMiddlewareArgs;

      // Exhaust all 5 tokens
      for (let i = 0; i < 5; i++) {
        await rateLimitMiddleware(args);
      }

      // 6th request should be blocked
      await rateLimitMiddleware(args);

      expect(mockNext).toHaveBeenCalledTimes(5);
      expect(mockRespond).toHaveBeenCalledTimes(1);
      expect(mockRespond).toHaveBeenCalledWith({
        text: expect.stringContaining('Rate limit exceeded'),
        response_type: 'ephemeral',
      });
    });

    it('should log rate limit violations', async () => {
      const args = {
        command: mockCommand,
        respond: mockRespond as RespondFn,
        next: mockNext,
      } as unknown as SlackCommandMiddlewareArgs & AllMiddlewareArgs;

      // Exceed limit
      for (let i = 0; i < 6; i++) {
        await rateLimitMiddleware(args);
      }

      expect(logger.warn).toHaveBeenCalledWith(
        'Rate limit exceeded',
        expect.objectContaining({
          userId: 'U12345678',
          userName: 'testuser',
          command: '/services',
        })
      );
    });
  });

  describe('per-command isolation', () => {
    it('should track commands independently', async () => {
      const servicesArgs = {
        command: { ...mockCommand, command: '/services' },
        respond: mockRespond as RespondFn,
        next: mockNext,
      } as unknown as SlackCommandMiddlewareArgs & AllMiddlewareArgs;

      const askArgs = {
        command: { ...mockCommand, command: '/ask' },
        respond: mockRespond as RespondFn,
        next: mockNext,
      } as unknown as SlackCommandMiddlewareArgs & AllMiddlewareArgs;

      // Exhaust /ask limit (3 tokens from per-command config)
      for (let i = 0; i < 3; i++) {
        await rateLimitMiddleware(askArgs);
      }

      // /ask should be blocked
      await rateLimitMiddleware(askArgs);
      expect(mockRespond).toHaveBeenCalledTimes(1);

      // /services should still work (separate bucket, default 5 tokens)
      await rateLimitMiddleware(servicesArgs);
      expect(mockNext).toHaveBeenCalledTimes(4); // 3 ask + 1 services
    });

    it('should use per-command config for /ask', async () => {
      const askArgs = {
        command: { ...mockCommand, command: '/ask' },
        respond: mockRespond as RespondFn,
        next: mockNext,
      } as unknown as SlackCommandMiddlewareArgs & AllMiddlewareArgs;

      // /ask has max: 3 - should allow 3 then block
      for (let i = 0; i < 3; i++) {
        await rateLimitMiddleware(askArgs);
      }
      expect(mockNext).toHaveBeenCalledTimes(3);

      await rateLimitMiddleware(askArgs);
      expect(mockRespond).toHaveBeenCalledTimes(1);
    });

    it('should use default config for unconfigured commands', async () => {
      const logsArgs = {
        command: { ...mockCommand, command: '/logs' },
        respond: mockRespond as RespondFn,
        next: mockNext,
      } as unknown as SlackCommandMiddlewareArgs & AllMiddlewareArgs;

      // /logs is unconfigured - should use default max: 5
      for (let i = 0; i < 5; i++) {
        await rateLimitMiddleware(logsArgs);
      }
      expect(mockNext).toHaveBeenCalledTimes(5);

      await rateLimitMiddleware(logsArgs);
      expect(mockRespond).toHaveBeenCalledTimes(1);
    });
  });

  describe('user isolation', () => {
    it('should track users independently', async () => {
      const user1Args = {
        command: { ...mockCommand, user_id: 'U12345678', user_name: 'user1' },
        respond: mockRespond as RespondFn,
        next: mockNext,
      } as unknown as SlackCommandMiddlewareArgs & AllMiddlewareArgs;

      const user2Args = {
        command: { ...mockCommand, user_id: 'U87654321', user_name: 'user2' },
        respond: mockRespond as RespondFn,
        next: mockNext,
      } as unknown as SlackCommandMiddlewareArgs & AllMiddlewareArgs;

      // User 1 exhausts tokens
      for (let i = 0; i < 5; i++) {
        await rateLimitMiddleware(user1Args);
      }

      // User 2 should still be able to make requests
      await rateLimitMiddleware(user2Args);

      expect(mockNext).toHaveBeenCalledTimes(6);
      expect(mockRespond).not.toHaveBeenCalled();
    });
  });

  describe('token refill', () => {
    it('should refill tokens over time', async () => {
      vi.useFakeTimers();

      const args = {
        command: mockCommand,
        respond: mockRespond as RespondFn,
        next: mockNext,
      } as unknown as SlackCommandMiddlewareArgs & AllMiddlewareArgs;

      // Exhaust all 5 tokens
      for (let i = 0; i < 5; i++) {
        await rateLimitMiddleware(args);
      }

      // Blocked immediately
      await rateLimitMiddleware(args);
      expect(mockRespond).toHaveBeenCalledTimes(1);

      // Advance enough time for 1 token to refill
      // windowSeconds=60, max=5, so 1 token per 12 seconds
      vi.advanceTimersByTime(13000);

      // Should be allowed again
      await rateLimitMiddleware(args);
      expect(mockNext).toHaveBeenCalledTimes(6);
    });

    it('should fully reset after full window', async () => {
      vi.useFakeTimers();

      const args = {
        command: mockCommand,
        respond: mockRespond as RespondFn,
        next: mockNext,
      } as unknown as SlackCommandMiddlewareArgs & AllMiddlewareArgs;

      // Exhaust all tokens
      for (let i = 0; i < 5; i++) {
        await rateLimitMiddleware(args);
      }

      // Advance past full window (60 seconds + buffer)
      vi.advanceTimersByTime(61000);

      // Should have full burst again
      for (let i = 0; i < 5; i++) {
        await rateLimitMiddleware(args);
      }
      expect(mockNext).toHaveBeenCalledTimes(10);
      expect(mockRespond).not.toHaveBeenCalled();
    });
  });

  describe('non-command events', () => {
    it('should pass through non-command events without rate limiting', async () => {
      const args = {
        event: { type: 'message' },
        next: mockNext,
      } as unknown as AnyMiddlewareArgs;

      await rateLimitMiddleware(args);

      expect(mockNext).toHaveBeenCalled();
    });
  });
});

describe('getRateLimitStatus', () => {
  beforeEach(() => {
    clearRateLimit('U12345678');
  });

  afterEach(() => {
    clearRateLimit('U12345678');
  });

  it('should return null for users without entries', () => {
    const status = getRateLimitStatus('UNONEXISTENT');
    expect(status).toBeNull();
  });

  it('should return correct remaining count after requests', async () => {
    const mockNext = vi.fn();
    const mockRespond = vi.fn() as RespondFn;

    const args = {
      command: {
        user_id: 'U12345678',
        user_name: 'testuser',
        channel_id: 'C12345678',
        command: '/services',
        text: '',
      },
      respond: mockRespond,
      next: mockNext,
    } as unknown as SlackCommandMiddlewareArgs & AllMiddlewareArgs;

    // Make 3 requests
    for (let i = 0; i < 3; i++) {
      await rateLimitMiddleware(args);
    }

    const status = getRateLimitStatus('U12345678', '/services');
    expect(status).not.toBeNull();
    expect(status?.remaining).toBe(2); // 5 - 3 = 2
    expect(status?.resetIn).toBeGreaterThan(0);
    expect(status?.resetIn).toBeLessThanOrEqual(60);
  });

  it('should find bucket by user prefix when command not specified', async () => {
    const mockNext = vi.fn();
    const mockRespond = vi.fn() as RespondFn;

    const args = {
      command: {
        user_id: 'U12345678',
        user_name: 'testuser',
        channel_id: 'C12345678',
        command: '/services',
        text: '',
      },
      respond: mockRespond,
      next: mockNext,
    } as unknown as SlackCommandMiddlewareArgs & AllMiddlewareArgs;

    await rateLimitMiddleware(args);

    // Without command should still find bucket via prefix search
    const status = getRateLimitStatus('U12345678');
    expect(status).not.toBeNull();
  });
});

describe('clearRateLimit', () => {
  beforeEach(() => {
    clearRateLimit('U12345678');
    clearRateLimit('U87654321');
  });

  it('should reset rate limit for a specific user across all commands', async () => {
    const mockNext = vi.fn();
    const mockRespond = vi.fn() as RespondFn;

    const args = {
      command: {
        user_id: 'U12345678',
        user_name: 'testuser',
        channel_id: 'C12345678',
        command: '/services',
        text: '',
      },
      respond: mockRespond,
      next: mockNext,
    } as unknown as SlackCommandMiddlewareArgs & AllMiddlewareArgs;

    // Exhaust tokens
    for (let i = 0; i < 5; i++) {
      await rateLimitMiddleware(args);
    }

    // Clear the limit
    clearRateLimit('U12345678');

    // Should be able to make requests again (full burst)
    await rateLimitMiddleware(args);
    expect(mockNext).toHaveBeenCalledTimes(6);
  });

  it('should not affect other users', async () => {
    const mockNext = vi.fn();
    const mockRespond = vi.fn() as RespondFn;

    const user1Args = {
      command: {
        user_id: 'U12345678',
        user_name: 'user1',
        channel_id: 'C12345678',
        command: '/services',
        text: '',
      },
      respond: mockRespond,
      next: mockNext,
    } as unknown as SlackCommandMiddlewareArgs & AllMiddlewareArgs;

    const user2Args = {
      command: {
        user_id: 'U87654321',
        user_name: 'user2',
        channel_id: 'C12345678',
        command: '/services',
        text: '',
      },
      respond: mockRespond,
      next: mockNext,
    } as unknown as SlackCommandMiddlewareArgs & AllMiddlewareArgs;

    // Both users make 3 requests
    for (let i = 0; i < 3; i++) {
      await rateLimitMiddleware(user1Args);
      await rateLimitMiddleware(user2Args);
    }

    // Clear only user1
    clearRateLimit('U12345678');

    expect(getRateLimitStatus('U12345678')).toBeNull();
    expect(getRateLimitStatus('U87654321', '/services')).not.toBeNull();
    expect(getRateLimitStatus('U87654321', '/services')?.remaining).toBe(2);
  });
});

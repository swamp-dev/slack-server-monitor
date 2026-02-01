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
    // Clear rate limits for our test user
    clearRateLimit('U12345678');
    clearRateLimit('U87654321');
  });

  afterEach(() => {
    clearRateLimit('U12345678');
    clearRateLimit('U87654321');
    vi.useRealTimers();
  });

  describe('request counting and limits', () => {
    it('should allow requests under the limit', async () => {
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

    it('should allow multiple requests under the limit', async () => {
      const args = {
        command: mockCommand,
        respond: mockRespond as RespondFn,
        next: mockNext,
      } as unknown as SlackCommandMiddlewareArgs & AllMiddlewareArgs;

      // Make 5 requests (at limit)
      for (let i = 0; i < 5; i++) {
        await rateLimitMiddleware(args);
      }

      expect(mockNext).toHaveBeenCalledTimes(5);
      expect(mockRespond).not.toHaveBeenCalled();
    });

    it('should block requests over the limit', async () => {
      const args = {
        command: mockCommand,
        respond: mockRespond as RespondFn,
        next: mockNext,
      } as unknown as SlackCommandMiddlewareArgs & AllMiddlewareArgs;

      // Make 5 requests (at limit)
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
        })
      );
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

      // User 1 makes 5 requests (at limit)
      for (let i = 0; i < 5; i++) {
        await rateLimitMiddleware(user1Args);
      }

      // User 2 should still be able to make requests
      await rateLimitMiddleware(user2Args);

      expect(mockNext).toHaveBeenCalledTimes(6);
      expect(mockRespond).not.toHaveBeenCalled();
    });
  });

  describe('window reset', () => {
    it('should reset count after window expires', async () => {
      vi.useFakeTimers();

      const args = {
        command: mockCommand,
        respond: mockRespond as RespondFn,
        next: mockNext,
      } as unknown as SlackCommandMiddlewareArgs & AllMiddlewareArgs;

      // Make 5 requests (at limit)
      for (let i = 0; i < 5; i++) {
        await rateLimitMiddleware(args);
      }

      // 6th request should be blocked
      await rateLimitMiddleware(args);
      expect(mockRespond).toHaveBeenCalledTimes(1);

      // Advance time past the window (60 seconds + buffer)
      vi.advanceTimersByTime(61000);

      // Should be able to make requests again
      await rateLimitMiddleware(args);
      expect(mockNext).toHaveBeenCalledTimes(6); // 5 initial + 1 after reset
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

    const status = getRateLimitStatus('U12345678');
    expect(status).not.toBeNull();
    expect(status?.remaining).toBe(2); // 5 - 3 = 2
    expect(status?.resetIn).toBeGreaterThan(0);
    expect(status?.resetIn).toBeLessThanOrEqual(60);
  });

  it('should return 0 remaining when at limit', async () => {
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

    // Make 5 requests (at limit)
    for (let i = 0; i < 5; i++) {
      await rateLimitMiddleware(args);
    }

    const status = getRateLimitStatus('U12345678');
    expect(status).not.toBeNull();
    expect(status?.remaining).toBe(0);
  });

  it('should return null after window expires', async () => {
    vi.useFakeTimers();

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

    // Advance past window
    vi.advanceTimersByTime(61000);

    const status = getRateLimitStatus('U12345678');
    expect(status).toBeNull();

    vi.useRealTimers();
  });
});

describe('clearRateLimit', () => {
  beforeEach(() => {
    clearRateLimit('U12345678');
    clearRateLimit('U87654321');
  });

  it('should reset rate limit for a specific user', async () => {
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

    // Make 5 requests (at limit)
    for (let i = 0; i < 5; i++) {
      await rateLimitMiddleware(args);
    }

    expect(getRateLimitStatus('U12345678')?.remaining).toBe(0);

    // Clear the limit
    clearRateLimit('U12345678');

    // Should be null now
    expect(getRateLimitStatus('U12345678')).toBeNull();

    // Should be able to make requests again
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

    expect(getRateLimitStatus('U12345678')?.remaining).toBe(2);
    expect(getRateLimitStatus('U87654321')?.remaining).toBe(2);

    // Clear only user1
    clearRateLimit('U12345678');

    expect(getRateLimitStatus('U12345678')).toBeNull();
    expect(getRateLimitStatus('U87654321')?.remaining).toBe(2);
  });
});

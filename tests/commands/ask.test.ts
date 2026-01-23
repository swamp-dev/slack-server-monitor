import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  checkAndRecordClaudeRequest,
  getRemainingRequests,
  clearRateLimitForUser,
  clearAllRateLimits,
} from '../../src/commands/ask.js';

// Mock the config module
vi.mock('../../src/config/index.js', () => ({
  config: {
    claude: {
      rateLimitMax: 5,
      rateLimitWindowSeconds: 60,
    },
  },
}));

describe('Claude rate limiting', () => {
  beforeEach(() => {
    clearAllRateLimits();
  });

  afterEach(() => {
    clearAllRateLimits();
  });

  describe('checkAndRecordClaudeRequest', () => {
    it('should allow requests under the limit', () => {
      const userId = 'U12345678';

      // First request should be allowed
      expect(checkAndRecordClaudeRequest(userId)).toBe(true);
      expect(getRemainingRequests(userId)).toBe(4);

      // Second request should be allowed
      expect(checkAndRecordClaudeRequest(userId)).toBe(true);
      expect(getRemainingRequests(userId)).toBe(3);
    });

    it('should deny requests at the limit', () => {
      const userId = 'U12345678';

      // Make 5 requests (at limit)
      for (let i = 0; i < 5; i++) {
        expect(checkAndRecordClaudeRequest(userId)).toBe(true);
      }

      // 6th request should be denied
      expect(checkAndRecordClaudeRequest(userId)).toBe(false);
      expect(getRemainingRequests(userId)).toBe(0);
    });

    it('should track users independently', () => {
      const user1 = 'U11111111';
      const user2 = 'U22222222';

      // User 1 makes 5 requests
      for (let i = 0; i < 5; i++) {
        expect(checkAndRecordClaudeRequest(user1)).toBe(true);
      }

      // User 1 is at limit
      expect(checkAndRecordClaudeRequest(user1)).toBe(false);

      // User 2 should still be able to make requests
      expect(checkAndRecordClaudeRequest(user2)).toBe(true);
      expect(getRemainingRequests(user2)).toBe(4);
    });

    it('should atomically check and record (no race condition)', () => {
      const userId = 'U12345678';

      // Make 4 requests
      for (let i = 0; i < 4; i++) {
        checkAndRecordClaudeRequest(userId);
      }

      // Only 1 slot remaining
      expect(getRemainingRequests(userId)).toBe(1);

      // Single atomic call should succeed and consume the slot
      expect(checkAndRecordClaudeRequest(userId)).toBe(true);

      // Now at limit, should fail
      expect(checkAndRecordClaudeRequest(userId)).toBe(false);
      expect(getRemainingRequests(userId)).toBe(0);
    });
  });

  describe('getRemainingRequests', () => {
    it('should return full limit for new users', () => {
      expect(getRemainingRequests('U_NEW_USER')).toBe(5);
    });

    it('should return correct remaining count', () => {
      const userId = 'U12345678';

      expect(getRemainingRequests(userId)).toBe(5);

      checkAndRecordClaudeRequest(userId);
      expect(getRemainingRequests(userId)).toBe(4);

      checkAndRecordClaudeRequest(userId);
      checkAndRecordClaudeRequest(userId);
      expect(getRemainingRequests(userId)).toBe(2);
    });

    it('should return 0 when at limit', () => {
      const userId = 'U12345678';

      for (let i = 0; i < 5; i++) {
        checkAndRecordClaudeRequest(userId);
      }

      expect(getRemainingRequests(userId)).toBe(0);
    });
  });

  describe('clearRateLimitForUser', () => {
    it('should reset rate limit for a specific user', () => {
      const user1 = 'U11111111';
      const user2 = 'U22222222';

      // Both users make requests
      for (let i = 0; i < 3; i++) {
        checkAndRecordClaudeRequest(user1);
        checkAndRecordClaudeRequest(user2);
      }

      expect(getRemainingRequests(user1)).toBe(2);
      expect(getRemainingRequests(user2)).toBe(2);

      // Clear only user1
      clearRateLimitForUser(user1);

      // User 1 should be reset, user 2 unchanged
      expect(getRemainingRequests(user1)).toBe(5);
      expect(getRemainingRequests(user2)).toBe(2);
    });
  });

  describe('clearAllRateLimits', () => {
    it('should reset rate limits for all users', () => {
      const user1 = 'U11111111';
      const user2 = 'U22222222';

      // Both users make requests
      for (let i = 0; i < 3; i++) {
        checkAndRecordClaudeRequest(user1);
        checkAndRecordClaudeRequest(user2);
      }

      expect(getRemainingRequests(user1)).toBe(2);
      expect(getRemainingRequests(user2)).toBe(2);

      // Clear all
      clearAllRateLimits();

      // Both should be reset
      expect(getRemainingRequests(user1)).toBe(5);
      expect(getRemainingRequests(user2)).toBe(5);
    });
  });

  describe('window expiry', () => {
    it('should reset count after window expires', async () => {
      // This test uses fake timers to simulate window expiry
      vi.useFakeTimers();

      const userId = 'U12345678';

      // Make 5 requests
      for (let i = 0; i < 5; i++) {
        checkAndRecordClaudeRequest(userId);
      }

      expect(getRemainingRequests(userId)).toBe(0);
      expect(checkAndRecordClaudeRequest(userId)).toBe(false);

      // Advance time past the window (60 seconds + buffer)
      vi.advanceTimersByTime(61000);

      // Should be able to make requests again
      expect(getRemainingRequests(userId)).toBe(5);
      expect(checkAndRecordClaudeRequest(userId)).toBe(true);

      vi.useRealTimers();
    });
  });
});

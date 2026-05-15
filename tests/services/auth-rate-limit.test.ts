import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { checkAndRecordAuthHit, _resetAuthRateLimits } from '../../src/services/auth-rate-limit.js';

describe('auth-rate-limit', () => {
  beforeEach(() => {
    _resetAuthRateLimits();
    vi.useFakeTimers();
  });

  afterEach(() => {
    _resetAuthRateLimits();
    vi.useRealTimers();
  });

  it('allows the first 5 hits and rejects the 6th', () => {
    const limit = { max: 5, windowMs: 15 * 60 * 1000 };
    for (let i = 0; i < 5; i++) {
      expect(checkAndRecordAuthHit('login', '1.2.3.4', limit)).toBe(true);
    }
    expect(checkAndRecordAuthHit('login', '1.2.3.4', limit)).toBe(false);
  });

  it('expires hits after the window passes', () => {
    const limit = { max: 5, windowMs: 1000 };
    for (let i = 0; i < 5; i++) {
      checkAndRecordAuthHit('login', '1.2.3.4', limit);
    }
    expect(checkAndRecordAuthHit('login', '1.2.3.4', limit)).toBe(false);
    vi.advanceTimersByTime(1100);
    expect(checkAndRecordAuthHit('login', '1.2.3.4', limit)).toBe(true);
  });

  it('tracks IPs independently', () => {
    const limit = { max: 2, windowMs: 60_000 };
    expect(checkAndRecordAuthHit('login', 'a', limit)).toBe(true);
    expect(checkAndRecordAuthHit('login', 'a', limit)).toBe(true);
    expect(checkAndRecordAuthHit('login', 'a', limit)).toBe(false);
    // Different IP gets its own budget.
    expect(checkAndRecordAuthHit('login', 'b', limit)).toBe(true);
  });

  it('tracks scopes independently', () => {
    const limit = { max: 2, windowMs: 60_000 };
    expect(checkAndRecordAuthHit('login', 'x', limit)).toBe(true);
    expect(checkAndRecordAuthHit('login', 'x', limit)).toBe(true);
    expect(checkAndRecordAuthHit('login', 'x', limit)).toBe(false);
    // Same IP, different scope, has its own budget.
    expect(checkAndRecordAuthHit('register', 'x', limit)).toBe(true);
  });

  it('a rejected hit does not consume budget — the legitimate retry just barely under the limit still goes through', () => {
    const limit = { max: 2, windowMs: 60_000 };
    checkAndRecordAuthHit('login', 'ip', limit);
    checkAndRecordAuthHit('login', 'ip', limit);
    // Three rejected attempts.
    for (let i = 0; i < 3; i++) {
      expect(checkAndRecordAuthHit('login', 'ip', limit)).toBe(false);
    }
    vi.advanceTimersByTime(60_001);
    // Window has rolled — should be allowed again, two more times.
    expect(checkAndRecordAuthHit('login', 'ip', limit)).toBe(true);
    expect(checkAndRecordAuthHit('login', 'ip', limit)).toBe(true);
    expect(checkAndRecordAuthHit('login', 'ip', limit)).toBe(false);
  });
});

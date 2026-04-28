/**
 * Tests for evaluateAuthStartup (#278). Pure function, no fixtures.
 */
import { describe, it, expect } from 'vitest';
import { evaluateAuthStartup } from '../../src/services/auth-startup.js';

describe('evaluateAuthStartup', () => {
  it('returns ok+silent when the users table is populated and env is empty', () => {
    const res = evaluateAuthStartup(3, 0);
    expect(res).toEqual({ ok: true, level: 'silent' });
  });

  it('returns ok+info when both the users table and env var are populated (env can be removed)', () => {
    const res = evaluateAuthStartup(3, 2);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.level).toBe('info');
      expect(res.message).toMatch(/can be removed/i);
      expect(res.message).toMatch(/3 users/);
    }
  });

  it('singularizes "user" when exactly one active user', () => {
    const res = evaluateAuthStartup(1, 1);
    expect(res.ok).toBe(true);
    if (res.ok && res.level === 'info') {
      expect(res.message).toMatch(/1 user\b/);
    }
  });

  it('returns NOT-ok when env var has entries but DB is empty (bootstrap failed for all)', () => {
    // Bootstrap runs before this check. If activeUsers is still 0 with N
    // env entries, every entry was either invalid or the user was later
    // deactivated. Bot would silently reject every command.
    const res = evaluateAuthStartup(0, 2);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.message).toMatch(/2 entries/);
      expect(res.message).toMatch(/silently reject/i);
      expect(res.message).toMatch(/refusing to start/i);
    }
  });

  it('returns NOT-ok when both the table and env var are empty (fail startup)', () => {
    const res = evaluateAuthStartup(0, 0);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.message).toMatch(/no authorized users/i);
      expect(res.message).toMatch(/AUTHORIZED_USER_IDS/);
      expect(res.message).toMatch(/manage-users/);
    }
  });
});

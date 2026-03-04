import { describe, it, expect } from 'vitest';
import { resolveToken, parseCookies } from '../../src/web/auth.js';
import type { WebConfig } from '../../src/config/schema.js';

const baseWebConfig: WebConfig = {
  enabled: true,
  port: 8080,
  baseUrl: 'http://test.local:8080',
  authToken: 'admin-token-minimum-16-chars',
  userTokens: [
    { userId: 'U01ABC123', token: 'user1-token-minimum16' },
    { userId: 'U02DEF456', token: 'user2-token-minimum16' },
  ],
  sessionTtlHours: 72,
};

describe('resolveToken', () => {
  it('should resolve admin token', () => {
    const result = resolveToken('admin-token-minimum-16-chars', baseWebConfig);
    expect(result).toEqual({ userId: 'admin', isAdmin: true });
  });

  it('should resolve per-user token', () => {
    const result = resolveToken('user1-token-minimum16', baseWebConfig);
    expect(result).toEqual({ userId: 'U01ABC123', isAdmin: false });
  });

  it('should resolve second user token', () => {
    const result = resolveToken('user2-token-minimum16', baseWebConfig);
    expect(result).toEqual({ userId: 'U02DEF456', isAdmin: false });
  });

  it('should return null for invalid token', () => {
    const result = resolveToken('invalid-token-value1', baseWebConfig);
    expect(result).toBeNull();
  });

  it('should return null for empty token', () => {
    const result = resolveToken('', baseWebConfig);
    expect(result).toBeNull();
  });

  it('should handle different length tokens safely (no timing leak)', () => {
    const result = resolveToken('short', baseWebConfig);
    expect(result).toBeNull();
  });

  it('should handle config with no user tokens', () => {
    const configNoUsers: WebConfig = {
      ...baseWebConfig,
      userTokens: [],
    };
    const result = resolveToken('admin-token-minimum-16-chars', configNoUsers);
    expect(result).toEqual({ userId: 'admin', isAdmin: true });
  });

  it('should not confuse admin token with user token', () => {
    // Admin token should always resolve as admin, even if identical format
    const result = resolveToken('admin-token-minimum-16-chars', baseWebConfig);
    expect(result?.isAdmin).toBe(true);
  });
});

describe('parseCookies', () => {
  it('should parse a single cookie', () => {
    const result = parseCookies('ssm_session=abc123');
    expect(result).toEqual({ ssm_session: 'abc123' });
  });

  it('should parse multiple cookies', () => {
    const result = parseCookies('ssm_session=abc123; other=xyz; foo=bar');
    expect(result).toEqual({
      ssm_session: 'abc123',
      other: 'xyz',
      foo: 'bar',
    });
  });

  it('should return empty object for empty string', () => {
    const result = parseCookies('');
    expect(result).toEqual({});
  });

  it('should return empty object for undefined', () => {
    const result = parseCookies(undefined);
    expect(result).toEqual({});
  });

  it('should handle whitespace around values', () => {
    const result = parseCookies('  ssm_session = abc123 ; other = xyz  ');
    expect(result).toEqual({
      ssm_session: 'abc123',
      other: 'xyz',
    });
  });

  it('should handle cookies with = in the value', () => {
    const result = parseCookies('token=abc=123=xyz');
    expect(result).toEqual({ token: 'abc=123=xyz' });
  });
});

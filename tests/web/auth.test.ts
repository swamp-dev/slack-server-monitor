import { describe, it, expect } from 'vitest';
import { resolveToken, parseCookies, createLinkToken, verifyLinkToken } from '../../src/web/auth.js';
import type { WebConfig } from '../../src/config/schema.js';

const SIGNING_SECRET = 'test-signing-secret-minimum-16';

const baseWebConfig: WebConfig = {
  enabled: true,
  port: 8080,
  baseUrl: 'http://test.local:8080',
  authToken: SIGNING_SECRET,
  linkTokenTtlMinutes: 15,
  sessionTtlHours: 72,
};

describe('createLinkToken', () => {
  it('should create a token with a dot separator', () => {
    const token = createLinkToken('U01ABC123', SIGNING_SECRET, 15);
    expect(token).toContain('.');
    const parts = token.split('.');
    expect(parts).toHaveLength(2);
  });

  it('should create different tokens for different users', () => {
    const token1 = createLinkToken('U01ABC123', SIGNING_SECRET, 15);
    const token2 = createLinkToken('U02DEF456', SIGNING_SECRET, 15);
    expect(token1).not.toBe(token2);
  });

  it('should encode the userId in the payload', () => {
    const token = createLinkToken('U01ABC123', SIGNING_SECRET, 15);
    const payloadB64 = token.split('.')[0];
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    expect(payload.u).toBe('U01ABC123');
  });

  it('should set expiry in the future', () => {
    const before = Math.floor(Date.now() / 1000);
    const token = createLinkToken('U01ABC123', SIGNING_SECRET, 15);
    const after = Math.floor(Date.now() / 1000);

    const payloadB64 = token.split('.')[0];
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    expect(payload.e).toBeGreaterThanOrEqual(before + 15 * 60);
    expect(payload.e).toBeLessThanOrEqual(after + 15 * 60);
  });
});

describe('verifyLinkToken', () => {
  it('should verify a valid token and return userId', () => {
    const token = createLinkToken('U01ABC123', SIGNING_SECRET, 15);
    const result = verifyLinkToken(token, SIGNING_SECRET);
    expect(result).toEqual({ userId: 'U01ABC123' });
  });

  it('should return null for expired token', () => {
    // Create a token with 0 TTL (already expired)
    const token = createLinkToken('U01ABC123', SIGNING_SECRET, 0);
    const result = verifyLinkToken(token, SIGNING_SECRET);
    expect(result).toBeNull();
  });

  it('should return null for tampered payload', () => {
    const token = createLinkToken('U01ABC123', SIGNING_SECRET, 15);
    const [, signature] = token.split('.');
    // Replace payload with a different one
    const tamperedPayload = Buffer.from(JSON.stringify({ u: 'UHACKED', e: Math.floor(Date.now() / 1000) + 9999 })).toString('base64url');
    const tampered = `${tamperedPayload}.${signature}`;
    const result = verifyLinkToken(tampered, SIGNING_SECRET);
    expect(result).toBeNull();
  });

  it('should return null for tampered signature', () => {
    const token = createLinkToken('U01ABC123', SIGNING_SECRET, 15);
    const [payload] = token.split('.');
    const tampered = `${payload}.${Buffer.from('fake-signature').toString('base64url')}`;
    const result = verifyLinkToken(tampered, SIGNING_SECRET);
    expect(result).toBeNull();
  });

  it('should return null for wrong signing secret', () => {
    const token = createLinkToken('U01ABC123', SIGNING_SECRET, 15);
    const result = verifyLinkToken(token, 'different-secret-minimum16');
    expect(result).toBeNull();
  });

  it('should return null for malformed token (no dot)', () => {
    const result = verifyLinkToken('nodottoken', SIGNING_SECRET);
    expect(result).toBeNull();
  });

  it('should return null for malformed token (too many dots)', () => {
    const result = verifyLinkToken('a.b.c', SIGNING_SECRET);
    expect(result).toBeNull();
  });

  it('should return null for empty token', () => {
    const result = verifyLinkToken('', SIGNING_SECRET);
    expect(result).toBeNull();
  });

  it('should return null for invalid base64url payload', () => {
    const result = verifyLinkToken('!!!invalid.signature', SIGNING_SECRET);
    expect(result).toBeNull();
  });
});

describe('resolveToken', () => {
  it('should resolve admin token', () => {
    const result = resolveToken(SIGNING_SECRET, baseWebConfig);
    expect(result).toEqual({ userId: 'admin', isAdmin: true });
  });

  it('should resolve valid HMAC link token', () => {
    const token = createLinkToken('U01ABC123', SIGNING_SECRET, 15);
    const result = resolveToken(token, baseWebConfig);
    expect(result).toEqual({ userId: 'U01ABC123', isAdmin: false });
  });

  it('should return null for expired HMAC token', () => {
    const token = createLinkToken('U01ABC123', SIGNING_SECRET, 0);
    const result = resolveToken(token, baseWebConfig);
    expect(result).toBeNull();
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

import { describe, it, expect, vi } from 'vitest';
import {
  resolveToken,
  parseCookies,
  createLinkToken,
  verifyLinkToken,
  resolveTokenWithRole,
  resolveUserPassword,
} from '../../src/web/auth.js';
import type { WebConfig } from '../../src/config/schema.js';
import type { User } from '../../src/types/user.js';

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: 1,
    slackId: null,
    username: null,
    displayName: null,
    role: 'user',
    isActive: true,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

import type { CreateUserInput } from '../../src/types/user.js';

interface MockUserStore {
  getBySlackId: (id: string) => User | null;
  verifyPassword: (username: string, password: string) => Promise<User | null>;
  create: (input: CreateUserInput) => Promise<User>;
}

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

describe('resolveTokenWithRole', () => {
  function makeStore(opts: {
    bySlackId?: (id: string) => User | null;
    create?: (input: CreateUserInput) => Promise<User>;
  } = {}): MockUserStore {
    return {
      getBySlackId: opts.bySlackId ?? (() => null),
      verifyPassword: () => Promise.resolve(null),
      create: opts.create ?? (({ slackId }) => Promise.resolve(buildUser({ slackId: slackId ?? null, role: 'user' }))),
    };
  }

  it('returns admin identity for the static admin token without touching the store', async () => {
    const store = makeStore({
      bySlackId: () => { throw new Error('should not be called'); },
    });
    const result = await resolveTokenWithRole(SIGNING_SECRET, baseWebConfig, store);
    expect(result).toEqual({ userId: 'admin', isAdmin: true });
  });

  it('admits an HMAC token holder as admin when the user has role=admin', async () => {
    const token = createLinkToken('U01ABC', SIGNING_SECRET, 15);
    const store = makeStore({
      bySlackId: (id) => (id === 'U01ABC' ? buildUser({ slackId: 'U01ABC', role: 'admin' }) : null),
    });
    const result = await resolveTokenWithRole(token, baseWebConfig, store);
    expect(result).toEqual({ userId: 'U01ABC', isAdmin: true });
  });

  it('admits an HMAC token holder as non-admin when the user has role=user', async () => {
    const token = createLinkToken('U01ABC', SIGNING_SECRET, 15);
    const store = makeStore({
      bySlackId: () => buildUser({ slackId: 'U01ABC', role: 'user' }),
    });
    const result = await resolveTokenWithRole(token, baseWebConfig, store);
    expect(result).toEqual({ userId: 'U01ABC', isAdmin: false });
  });

  it('rejects an HMAC token holder whose user is deactivated', async () => {
    const token = createLinkToken('U01ABC', SIGNING_SECRET, 15);
    const store = makeStore({
      bySlackId: () => buildUser({ slackId: 'U01ABC', role: 'admin', isActive: false }),
    });
    const result = await resolveTokenWithRole(token, baseWebConfig, store);
    expect(result).toBeNull();
  });

  it('auto-creates a user-role row when the HMAC user is unknown', async () => {
    const token = createLinkToken('U99NEW', SIGNING_SECRET, 15);
    const created: CreateUserInput[] = [];
    const store = makeStore({
      bySlackId: () => null,
      create: (input) => {
        created.push(input);
        return Promise.resolve(buildUser({ slackId: input.slackId ?? null, role: 'user' }));
      },
    });
    const result = await resolveTokenWithRole(token, baseWebConfig, store);
    expect(result).toEqual({ userId: 'U99NEW', isAdmin: false });
    expect(created).toEqual([{ slackId: 'U99NEW', role: 'user' }]);
  });

  it('returns null for an invalid token', async () => {
    const store = makeStore();
    const result = await resolveTokenWithRole('garbage', baseWebConfig, store);
    expect(result).toBeNull();
  });

  it('handles the auto-create race: admits the loser by re-reading the winner row', async () => {
    const token = createLinkToken('U01ABC', SIGNING_SECRET, 15);
    let lookupCalls = 0;
    const winnerRow = buildUser({ slackId: 'U01ABC', role: 'admin' });
    const store: MockUserStore = {
      // Returns null on first lookup, returns the winner row on the post-throw retry.
      getBySlackId: () => {
        lookupCalls++;
        return lookupCalls === 1 ? null : winnerRow;
      },
      verifyPassword: () => Promise.resolve(null),
      // Throws as the unique-index would when another writer beat us to it.
      create: () => Promise.reject(new Error('UNIQUE constraint failed: users.slack_id')),
    };
    const result = await resolveTokenWithRole(token, baseWebConfig, store);
    expect(result).toEqual({ userId: 'U01ABC', isAdmin: true });
    expect(lookupCalls).toBe(2);
  });

  it('rethrows when create fails for a reason other than the unique-index race', async () => {
    const token = createLinkToken('U01ABC', SIGNING_SECRET, 15);
    const store: MockUserStore = {
      getBySlackId: () => null,
      verifyPassword: () => Promise.resolve(null),
      create: () => Promise.reject(new Error('disk full')),
    };
    await expect(resolveTokenWithRole(token, baseWebConfig, store)).rejects.toThrow(/disk full/);
  });
});

describe('resolveUserPassword', () => {
  function makeStore(verify: (u: string, p: string) => Promise<User | null>): MockUserStore {
    return {
      getBySlackId: () => null,
      verifyPassword: verify,
      create: ({ slackId }) => Promise.resolve(buildUser({ slackId: slackId ?? null })),
    };
  }

  it('returns a web identity for valid credentials with admin role', async () => {
    const store = makeStore(async (u, p) => {
      if (u === 'alice' && p === 'long-enough-pw') return buildUser({ username: 'alice', role: 'admin' });
      return null;
    });
    const result = await resolveUserPassword('alice', 'long-enough-pw', store);
    expect(result).toEqual({ userId: 'web:alice', isAdmin: true });
  });

  it('returns a web identity for valid credentials with user role', async () => {
    const store = makeStore(async () => buildUser({ username: 'bob', role: 'user' }));
    const result = await resolveUserPassword('bob', 'long-enough-pw', store);
    expect(result).toEqual({ userId: 'web:bob', isAdmin: false });
  });

  it('returns null for invalid credentials', async () => {
    const store = makeStore(async () => null);
    const result = await resolveUserPassword('alice', 'wrong-pw-given', store);
    expect(result).toBeNull();
  });

  it('uses the canonical username from the store (case normalization)', async () => {
    // userStore.verifyPassword is case-insensitive; the returned user.username
    // is the canonical lowercase form. We must not echo back the user's input.
    const store = makeStore(async () => buildUser({ username: 'alice', role: 'user' }));
    const result = await resolveUserPassword('ALICE', 'long-enough-pw', store);
    expect(result?.userId).toBe('web:alice');
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

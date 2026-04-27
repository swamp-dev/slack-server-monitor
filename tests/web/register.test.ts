/**
 * Integration tests for the /register and extended /login routes (#275).
 * Mirrors the pattern in server.routes.test.ts: starts the real Express
 * app on a fixed port with mocked stores so we exercise the full handler
 * chain (rate limit → validation → invite redeem → user create → session).
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import type { WebConfig } from '../../src/config/schema.js';

vi.mock('../../src/config/index.js', () => ({
  config: {
    claude: { enabled: true, dbPath: ':memory:', conversationTtlHours: 24 },
    web: {
      enabled: true, port: 0, baseUrl: 'http://localhost:18924',
      authToken: 'test-auth-token-minimum16',
      linkTokenTtlMinutes: 15, sessionTtlHours: 72, registrationEnabled: true,
    },
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../src/services/socket-mode-status.js', () => ({
  getSocketModeStatus: vi.fn(() => ({ connected: true })),
}));

const mockUserStore = {
  create: vi.fn(),
  getByUsername: vi.fn(),
  getBySlackId: vi.fn(),
  verifyPassword: vi.fn(),
  resolveIdentities: vi.fn(() => undefined),
  getDatabase: vi.fn(() => ({ prepare: vi.fn(() => ({ run: vi.fn(), all: vi.fn(() => []) })) })),
  deleteById: vi.fn(),
  close: vi.fn(),
};
vi.mock('../../src/services/user-store.js', () => ({
  getUserStore: vi.fn(() => mockUserStore),
  closeUserStore: vi.fn(),
  resolveUserStoreDbPath: vi.fn((p?: string) => p ?? ':memory:'),
}));

const mockInviteStore = {
  getInvite: vi.fn(),
  redeemInvite: vi.fn(),
  close: vi.fn(),
};
vi.mock('../../src/services/invite-store.js', () => ({
  getInviteStore: vi.fn(() => mockInviteStore),
  closeInviteStore: vi.fn(),
}));

const mockSessionStore = {
  createSession: vi.fn(() => ({
    sessionId: 'new-session-id', userId: 'web:alice', isAdmin: false,
    createdAt: Date.now(), expiresAt: Date.now() + 72 * 3600 * 1000,
  })),
  getSession: vi.fn(),
  deleteSession: vi.fn(),
  deleteSessionsForUser: vi.fn(),
  cleanupExpired: vi.fn(() => 0),
  close: vi.fn(),
};
vi.mock('../../src/services/session-store.js', () => ({
  getSessionStore: vi.fn(() => mockSessionStore),
  closeSessionStore: vi.fn(),
}));

vi.mock('../../src/services/conversation-store.js', () => ({
  getConversationStore: vi.fn(() => ({
    cleanupExpired: vi.fn(() => 0),
    getDatabase: vi.fn(() => ({ prepare: vi.fn(() => ({ all: vi.fn(() => []) })) })),
    listRecentSessions: vi.fn(() => []),
    countSessions: vi.fn(() => 0),
    getSessionStats: vi.fn(() => ({ totalSessions: 0, activeSessions: 0, totalMessages: 0, totalToolCalls: 0, avgToolDurationMs: null, toolFailureRate: 0, topTools: [] })),
    listFavoriteSessions: vi.fn(() => []),
    countFavoriteSessions: vi.fn(() => 0),
    listAllTags: vi.fn(() => []),
  })),
}));

vi.mock('../../src/services/notification-store.js', () => ({
  getNotificationStore: vi.fn(() => ({
    countUnread: vi.fn(() => 0),
    getRecent: vi.fn(() => []),
    cleanup: vi.fn(),
  })),
  closeNotificationStore: vi.fn(),
}));

vi.mock('../../src/services/quick-links-store.js', () => ({
  getQuickLinksStore: vi.fn(() => ({ getLinks: vi.fn(() => []) })),
  closeQuickLinksStore: vi.fn(),
}));

vi.mock('../../src/services/server-health.js', () => ({ getServerHealth: vi.fn(async () => null) }));
vi.mock('../../src/plugins/loader.js', () => ({ getPluginWidgets: vi.fn(() => []) }));

import { startWebServer, stopWebServer } from '../../src/web/server.js';
import { _resetAuthRateLimits } from '../../src/services/auth-rate-limit.js';

const baseUrl = 'http://localhost:18924';
const baseWebConfig: WebConfig = {
  enabled: true, port: 18924, baseUrl,
  authToken: 'test-auth-token-minimum16',
  linkTokenTtlMinutes: 15, sessionTtlHours: 72, registrationEnabled: true,
};

describe('GET/POST /register and extended /login (#275)', () => {
  beforeAll(async () => {
    await startWebServer({ ...baseWebConfig });
  });

  afterAll(async () => {
    await stopWebServer();
  });

  beforeEach(() => {
    _resetAuthRateLimits();
    vi.clearAllMocks();
    mockUserStore.resolveIdentities.mockReturnValue(undefined);
  });

  describe('GET /register', () => {
    it('returns the registration form when enabled', async () => {
      const res = await fetch(`${baseUrl}/register`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('Invite code');
      expect(html).toContain('Create account');
    });

    it('pre-fills the invite code from the ?invite= query', async () => {
      const res = await fetch(`${baseUrl}/register?invite=abc123def`);
      const html = await res.text();
      expect(html).toContain('value="abc123def"');
    });
  });

  describe('POST /register', () => {
    function buildBody(overrides: Record<string, string> = {}): URLSearchParams {
      const body = new URLSearchParams({
        invite: 'abc123', username: 'alice', password: 'long-enough-pw', confirm_password: 'long-enough-pw', ...overrides,
      });
      return body;
    }

    function postRegister(body: URLSearchParams): Promise<Response> {
      return fetch(`${baseUrl}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        redirect: 'manual',
      });
    }

    it('redeems a valid invite, creates the user, and starts a session', async () => {
      mockInviteStore.getInvite.mockReturnValue({
        code: 'abc123', createdBy: 1, role: 'user', slackUserId: null,
        createdAt: Date.now(), expiresAt: Date.now() + 60_000, usedAt: null, usedBy: null,
      });
      mockUserStore.create.mockResolvedValue({
        id: 1, slackId: null, username: 'alice', displayName: null, role: 'user',
        isActive: true, createdAt: Date.now(), updatedAt: Date.now(),
      });
      mockInviteStore.redeemInvite.mockReturnValue({ code: 'abc123', usedAt: Date.now(), usedBy: 1 });

      const res = await postRegister(buildBody());
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/');
      expect(mockSessionStore.createSession).toHaveBeenCalledWith('web:alice', false);
      expect(res.headers.get('set-cookie')).toMatch(/ssm_session=new-session-id/);
    });

    it('passes the invite role through to the new session', async () => {
      mockInviteStore.getInvite.mockReturnValue({
        code: 'abc123', createdBy: 1, role: 'admin', slackUserId: null,
        createdAt: Date.now(), expiresAt: Date.now() + 60_000, usedAt: null, usedBy: null,
      });
      mockUserStore.create.mockResolvedValue({
        id: 2, slackId: null, username: 'alice', displayName: null, role: 'admin',
        isActive: true, createdAt: Date.now(), updatedAt: Date.now(),
      });
      mockInviteStore.redeemInvite.mockReturnValue({ code: 'abc123', usedAt: Date.now(), usedBy: 2 });

      await postRegister(buildBody());
      expect(mockSessionStore.createSession).toHaveBeenCalledWith('web:alice', true);
    });

    it('carries pre-linked Slack ID into the user record', async () => {
      mockInviteStore.getInvite.mockReturnValue({
        code: 'abc123', createdBy: 1, role: 'user', slackUserId: 'U01ABC',
        createdAt: Date.now(), expiresAt: Date.now() + 60_000, usedAt: null, usedBy: null,
      });
      mockUserStore.create.mockResolvedValue({
        id: 1, slackId: 'U01ABC', username: 'alice', displayName: null, role: 'user',
        isActive: true, createdAt: Date.now(), updatedAt: Date.now(),
      });
      mockInviteStore.redeemInvite.mockReturnValue({ code: 'abc123', usedAt: Date.now(), usedBy: 1 });

      await postRegister(buildBody());
      expect(mockUserStore.create).toHaveBeenCalledWith(
        expect.objectContaining({ username: 'alice', slackId: 'U01ABC', role: 'user' }),
      );
    });

    it('rejects when fields are missing', async () => {
      const res = await postRegister(buildBody({ password: '' }));
      expect(res.status).toBe(400);
      expect(mockInviteStore.getInvite).not.toHaveBeenCalled();
    });

    it('rejects when passwords do not match', async () => {
      const res = await postRegister(buildBody({ confirm_password: 'different-pw' }));
      expect(res.status).toBe(400);
      const html = await res.text();
      expect(html).toContain('do not match');
    });

    it('rejects when password is too short', async () => {
      const res = await postRegister(buildBody({ password: 'short', confirm_password: 'short' }));
      expect(res.status).toBe(400);
    });

    it('rejects when invite code is unknown', async () => {
      mockInviteStore.getInvite.mockReturnValue(null);
      const res = await postRegister(buildBody());
      expect(res.status).toBe(400);
      const html = await res.text();
      expect(html).toContain('invalid, expired, or already used');
    });

    it('rejects when invite is already used', async () => {
      mockInviteStore.getInvite.mockReturnValue({
        code: 'abc123', createdBy: 1, role: 'user', slackUserId: null,
        createdAt: Date.now(), expiresAt: Date.now() + 60_000, usedAt: Date.now() - 1000, usedBy: 99,
      });
      const res = await postRegister(buildBody());
      expect(res.status).toBe(400);
    });

    it('rejects when invite is expired', async () => {
      mockInviteStore.getInvite.mockReturnValue({
        code: 'abc123', createdBy: 1, role: 'user', slackUserId: null,
        createdAt: Date.now() - 100_000, expiresAt: Date.now() - 1000, usedAt: null, usedBy: null,
      });
      const res = await postRegister(buildBody());
      expect(res.status).toBe(400);
    });

    it('rolls back the new user when the redeem race is lost', async () => {
      mockInviteStore.getInvite.mockReturnValue({
        code: 'abc123', createdBy: 1, role: 'user', slackUserId: null,
        createdAt: Date.now(), expiresAt: Date.now() + 60_000, usedAt: null, usedBy: null,
      });
      mockUserStore.create.mockResolvedValue({
        id: 99, slackId: null, username: 'alice', displayName: null, role: 'user',
        isActive: true, createdAt: Date.now(), updatedAt: Date.now(),
      });
      // Race lost: redeemInvite returns null.
      mockInviteStore.redeemInvite.mockReturnValue(null);

      const res = await postRegister(buildBody());
      expect(res.status).toBe(400);
      // Must have attempted to delete the orphaned user row by id.
      expect(mockUserStore.deleteById).toHaveBeenCalledWith(99);
    });

    it('rate-limits after 5 attempts from the same IP', async () => {
      mockInviteStore.getInvite.mockReturnValue(null);
      // 5 attempts → all 400 (invalid code, but counted toward limit)
      for (let i = 0; i < 5; i++) {
        const r = await postRegister(buildBody());
        expect(r.status).toBe(400);
      }
      // 6th → 429
      const sixth = await postRegister(buildBody());
      expect(sixth.status).toBe(429);
    });
  });

  describe('POST /login extended', () => {
    function postLogin(body: URLSearchParams): Promise<Response> {
      return fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        redirect: 'manual',
      });
    }

    it('logs in via username/password when provided', async () => {
      mockUserStore.verifyPassword.mockResolvedValue({
        id: 1, slackId: null, username: 'alice', displayName: null, role: 'admin',
        isActive: true, createdAt: Date.now(), updatedAt: Date.now(),
      });

      const res = await postLogin(new URLSearchParams({ username: 'alice', password: 'long-enough-pw' }));
      expect(res.status).toBe(302);
      expect(mockSessionStore.createSession).toHaveBeenCalledWith('web:alice', true);
    });

    it('returns 401 for invalid username/password', async () => {
      mockUserStore.verifyPassword.mockResolvedValue(null);
      const res = await postLogin(new URLSearchParams({ username: 'alice', password: 'wrong-here' }));
      expect(res.status).toBe(401);
    });

    it('still accepts the legacy token form when no username is provided', async () => {
      // Reach into the static admin token path: token = webConfig.authToken.
      const res = await postLogin(new URLSearchParams({ token: 'test-auth-token-minimum16' }));
      expect(res.status).toBe(302);
      expect(mockSessionStore.createSession).toHaveBeenCalledWith('admin', true);
    });

    it('rate-limits login attempts per IP', async () => {
      mockUserStore.verifyPassword.mockResolvedValue(null);
      const body = new URLSearchParams({ username: 'alice', password: 'wrong-here' });
      for (let i = 0; i < 5; i++) {
        const r = await postLogin(body);
        expect(r.status).toBe(401);
      }
      const sixth = await postLogin(body);
      expect(sixth.status).toBe(429);
    });
  });
});

describe('GET /register when registration is disabled', () => {
  beforeAll(async () => {
    await startWebServer({ ...baseWebConfig, port: 18925, registrationEnabled: false });
  });

  afterAll(async () => {
    await stopWebServer();
  });

  it('returns 404 from GET /register', async () => {
    const res = await fetch(`http://localhost:18925/register`);
    expect(res.status).toBe(404);
  });

  it('returns 404 from POST /register', async () => {
    const res = await fetch(`http://localhost:18925/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ invite: 'x', username: 'a', password: 'long-enough-pw', confirm_password: 'long-enough-pw' }),
    });
    expect(res.status).toBe(404);
  });
});

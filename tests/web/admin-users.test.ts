/**
 * Integration tests for /admin/users routes (#277).
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import type { WebConfig } from '../../src/config/schema.js';

vi.mock('../../src/config/index.js', () => ({
  config: {
    claude: { enabled: true, dbPath: ':memory:', conversationTtlHours: 24 },
    web: {
      enabled: true, port: 0, baseUrl: 'http://localhost:18926',
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
  getById: vi.fn(),
  getByUsername: vi.fn(),
  getBySlackId: vi.fn(),
  verifyPassword: vi.fn(),
  resolveIdentities: vi.fn(() => undefined),
  listAll: vi.fn(() => []),
  countByRole: vi.fn(() => 1),
  updateRole: vi.fn(),
  deactivate: vi.fn(),
  activate: vi.fn(),
  updatePassword: vi.fn(),
  getDatabase: vi.fn(() => ({ prepare: vi.fn(() => ({ all: vi.fn(() => []), run: vi.fn() })) })),
  close: vi.fn(),
};
vi.mock('../../src/services/user-store.js', () => ({
  getUserStore: vi.fn(() => mockUserStore),
  closeUserStore: vi.fn(),
  resolveUserStoreDbPath: vi.fn((p?: string) => p ?? ':memory:'),
}));

const mockInviteStore = {
  createInvite: vi.fn(() => ({
    code: 'abc123def456abc123def456abc123de',
    createdBy: 1, role: 'user', slackUserId: null,
    createdAt: Date.now(), expiresAt: Date.now() + 72 * 3600 * 1000,
    usedAt: null, usedBy: null,
  })),
  getInvite: vi.fn(),
  redeemInvite: vi.fn(),
  listActive: vi.fn(() => []),
  deleteInvite: vi.fn(),
  close: vi.fn(),
};
vi.mock('../../src/services/invite-store.js', () => ({
  getInviteStore: vi.fn(() => mockInviteStore),
  closeInviteStore: vi.fn(),
}));

const mockSessionStore = {
  createSession: vi.fn(),
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

const baseUrl = 'http://localhost:18926';
const webConfig: WebConfig = {
  enabled: true, port: 18926, baseUrl,
  authToken: 'test-auth-token-minimum16',
  linkTokenTtlMinutes: 15, sessionTtlHours: 72, registrationEnabled: true,
};

function authedFetch(path: string, isAdmin: boolean, opts: RequestInit = {}): Promise<Response> {
  mockSessionStore.getSession.mockReturnValue({
    sessionId: 'admin-session', userId: 'U01ABC', isAdmin,
    createdAt: Date.now(), expiresAt: Date.now() + 72 * 3600 * 1000,
  });
  const headers = new Headers(opts.headers);
  headers.set('Cookie', 'ssm_session=admin-session');
  return fetch(`${baseUrl}${path}`, { ...opts, headers, redirect: 'manual' });
}

function postForm(path: string, isAdmin: boolean, body: Record<string, string>): Promise<Response> {
  return authedFetch(path, isAdmin, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
}

describe('/admin routes (#277)', () => {
  beforeAll(async () => {
    await startWebServer(webConfig);
  });

  afterAll(async () => {
    await stopWebServer();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockUserStore.listAll.mockReturnValue([]);
    mockUserStore.countByRole.mockReturnValue(2);
    mockInviteStore.listActive.mockReturnValue([]);
    mockUserStore.resolveIdentities.mockReturnValue(undefined);
  });

  describe('admin guard', () => {
    it('returns 403 to a logged-in non-admin', async () => {
      const res = await authedFetch('/admin/users', false);
      expect(res.status).toBe(403);
      const body = await res.text();
      expect(body).toContain('403');
    });

    it('returns 401 when not logged in', async () => {
      mockSessionStore.getSession.mockReturnValue(null);
      const res = await fetch(`${baseUrl}/admin/users`, { redirect: 'manual' });
      expect(res.status).toBe(401);
    });

    it('admits admin to GET /admin/users', async () => {
      const res = await authedFetch('/admin/users', true);
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain('User administration');
    });
  });

  describe('POST /admin/users (create user)', () => {
    it('creates a user with valid Slack ID', async () => {
      mockUserStore.getBySlackId.mockReturnValue(null);
      mockUserStore.create.mockResolvedValue({ id: 1, slackId: 'U02DEF', username: null, displayName: null, role: 'user', isActive: true, createdAt: 0, updatedAt: 0 });
      const res = await postForm('/admin/users', true, { slack_id: 'U02DEF', role: 'user' });
      expect(res.status).toBe(302);
      expect(mockUserStore.create).toHaveBeenCalledWith(expect.objectContaining({ slackId: 'U02DEF', role: 'user' }));
    });

    it('rejects invalid Slack ID (redirects with error param)', async () => {
      const res = await postForm('/admin/users', true, { slack_id: 'invalid', role: 'user' });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toContain('error=');
      expect(mockUserStore.create).not.toHaveBeenCalled();
    });

    it('rejects when user already exists', async () => {
      mockUserStore.getBySlackId.mockReturnValue({ id: 1, slackId: 'U02DEF', username: null, displayName: null, role: 'user', isActive: true, createdAt: 0, updatedAt: 0 });
      const res = await postForm('/admin/users', true, { slack_id: 'U02DEF', role: 'user' });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toContain('already');
    });
  });

  describe('POST /admin/users/:id/role', () => {
    it('promotes a user', async () => {
      mockUserStore.getById.mockReturnValue({ id: 5, role: 'user', slackId: 'U05', username: null, displayName: null, isActive: true, createdAt: 0, updatedAt: 0 });
      const res = await postForm('/admin/users/5/role', true, { role: 'admin' });
      expect(res.status).toBe(302);
      expect(mockUserStore.updateRole).toHaveBeenCalledWith(5, 'admin');
    });

    it('refuses to demote the last admin', async () => {
      mockUserStore.getById.mockReturnValue({ id: 5, role: 'admin', slackId: 'U05', username: null, displayName: null, isActive: true, createdAt: 0, updatedAt: 0 });
      mockUserStore.countByRole.mockReturnValue(1);
      const res = await postForm('/admin/users/5/role', true, { role: 'user' });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toContain('last%20admin');
      expect(mockUserStore.updateRole).not.toHaveBeenCalled();
    });
  });

  describe('POST /admin/users/:id/toggle-active', () => {
    it('deactivates an active user', async () => {
      mockUserStore.getById.mockReturnValue({ id: 5, role: 'user', slackId: 'U05', username: null, displayName: null, isActive: true, createdAt: 0, updatedAt: 0 });
      const res = await postForm('/admin/users/5/toggle-active', true, {});
      expect(res.status).toBe(302);
      expect(mockUserStore.deactivate).toHaveBeenCalledWith(5);
    });

    it('refuses to deactivate the last admin', async () => {
      mockUserStore.getById.mockReturnValue({ id: 5, role: 'admin', slackId: 'U05', username: null, displayName: null, isActive: true, createdAt: 0, updatedAt: 0 });
      mockUserStore.countByRole.mockReturnValue(1);
      const res = await postForm('/admin/users/5/toggle-active', true, {});
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toContain('last%20admin');
      expect(mockUserStore.deactivate).not.toHaveBeenCalled();
    });

    it('reactivates a deactivated user', async () => {
      mockUserStore.getById.mockReturnValue({ id: 5, role: 'user', slackId: 'U05', username: null, displayName: null, isActive: false, createdAt: 0, updatedAt: 0 });
      const res = await postForm('/admin/users/5/toggle-active', true, {});
      expect(res.status).toBe(302);
      expect(mockUserStore.activate).toHaveBeenCalledWith(5);
    });
  });

  describe('POST /admin/users/:id/reset-password', () => {
    it('resets the password when valid', async () => {
      mockUserStore.getById.mockReturnValue({ id: 5, role: 'user', slackId: null, username: 'alice', displayName: null, isActive: true, createdAt: 0, updatedAt: 0 });
      const res = await postForm('/admin/users/5/reset-password', true, { password: 'long-enough-pw' });
      expect(res.status).toBe(302);
      expect(mockUserStore.updatePassword).toHaveBeenCalledWith(5, 'long-enough-pw');
    });

    it('rejects short passwords', async () => {
      const res = await postForm('/admin/users/5/reset-password', true, { password: 'short' });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toContain('8%20characters');
      expect(mockUserStore.updatePassword).not.toHaveBeenCalled();
    });
  });

  describe('POST /admin/invites', () => {
    it('creates an invite', async () => {
      mockUserStore.getBySlackId.mockReturnValue({ id: 1, slackId: 'U01ABC', username: null, displayName: null, role: 'admin', isActive: true, createdAt: 0, updatedAt: 0 });
      const res = await postForm('/admin/invites', true, { role: 'user', ttl_hours: '24' });
      expect(res.status).toBe(302);
      expect(mockInviteStore.createInvite).toHaveBeenCalledWith(1, expect.objectContaining({ role: 'user', ttlHours: 24 }));
    });

    it('rejects invalid pre-link Slack ID', async () => {
      const res = await postForm('/admin/invites', true, { role: 'user', ttl_hours: '24', slack_user_id: 'bad' });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toContain('error=');
      expect(mockInviteStore.createInvite).not.toHaveBeenCalled();
    });

    it('rejects when requester is not in users table', async () => {
      mockUserStore.getBySlackId.mockReturnValue(null);
      const res = await postForm('/admin/invites', true, { role: 'user', ttl_hours: '24' });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toContain('not%20in%20the%20users%20table');
      expect(mockInviteStore.createInvite).not.toHaveBeenCalled();
    });

    it('admits the static-admin emergency session with createdBy=0', async () => {
      // Static admin token: session userId is literally 'admin' and there
      // is no matching user row. The route should still let them mint
      // invites — pass 0 as the createdBy sentinel.
      mockSessionStore.getSession.mockReturnValue({
        sessionId: 'emergency-session', userId: 'admin', isAdmin: true,
        createdAt: Date.now(), expiresAt: Date.now() + 72 * 3600 * 1000,
      });
      const res = await fetch(`${baseUrl}/admin/invites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: 'ssm_session=emergency-session' },
        body: new URLSearchParams({ role: 'user', ttl_hours: '24' }),
        redirect: 'manual',
      });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toContain('flash=Invite');
      expect(mockInviteStore.createInvite).toHaveBeenCalledWith(0, expect.objectContaining({ role: 'user' }));
    });
  });

  describe('POST /admin/invites/:code/delete', () => {
    it('deletes a valid-format invite code', async () => {
      const code = 'abc123def456abc123def456abc123de';
      const res = await postForm(`/admin/invites/${code}/delete`, true, {});
      expect(res.status).toBe(302);
      expect(mockInviteStore.deleteInvite).toHaveBeenCalledWith(code);
    });

    it('rejects malformed codes', async () => {
      const res = await postForm('/admin/invites/not-hex/delete', true, {});
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toContain('Invalid+code');
      expect(mockInviteStore.deleteInvite).not.toHaveBeenCalled();
    });
  });
});

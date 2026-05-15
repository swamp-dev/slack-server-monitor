import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { WebConfig } from '../../src/config/schema.js';

// Mock config
vi.mock('../../src/config/index.js', () => ({
  config: {
    claude: {
      enabled: true,
      dbPath: ':memory:',
      conversationTtlHours: 24,
    },
    web: {
      enabled: true,
      port: 0,
      baseUrl: 'http://localhost:0',
      authToken: 'smoke-test-auth-token-min16',
      linkTokenTtlMinutes: 15,
      sessionTtlHours: 72,
    },
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../src/services/socket-mode-status.js', () => ({
  getSocketModeStatus: vi.fn(() => ({
    connected: true,
    lastConnectedAt: '2026-01-01T00:00:00.000Z',
    lastDisconnectedAt: null,
  })),
}));

// Minimal store mocks — smoke tests just need the app to start and respond
const mockStore = {
  getConversation: vi.fn(() => null),
  getToolCalls: vi.fn(() => []),
  listRecentSessions: vi.fn(() => []),
  countSessions: vi.fn(() => 0),
  listAllTags: vi.fn(() => []),
  getTags: vi.fn(() => []),
  toggleFavorite: vi.fn(() => true),
  addTag: vi.fn(),
  removeTag: vi.fn(),
  searchConversations: vi.fn(() => []),
  countSearchResults: vi.fn(() => 0),
  listFavoriteSessions: vi.fn(() => []),
  countFavoriteSessions: vi.fn(() => 0),
  listSessionsByTag: vi.fn(() => []),
  countSessionsByTag: vi.fn(() => 0),
  archiveConversation: vi.fn(() => true),
  listArchivedSessions: vi.fn(() => []),
  countArchivedSessions: vi.fn(() => 0),
  getSessionStats: vi.fn(() => ({
    totalSessions: 0, activeSessions: 0, totalMessages: 0,
    totalToolCalls: 0, avgToolDurationMs: null, toolFailureRate: 0, topTools: [],
  })),
  getOrCreateConversation: vi.fn(),
  getDatabase: vi.fn(() => ({
    prepare: vi.fn(() => ({ all: vi.fn(() => []) })),
  })),
};

vi.mock('../../src/services/conversation-store.js', () => ({
  getConversationStore: vi.fn(() => mockStore),
}));

const mockSessionStore = {
  createSession: vi.fn().mockReturnValue({
    sessionId: 'smoke-session-id',
    userId: 'admin',
    isAdmin: true,
    createdAt: Date.now(),
    expiresAt: Date.now() + 72 * 3600 * 1000,
  }),
  getSession: vi.fn(),
  deleteSession: vi.fn(),
  deleteSessionsForUser: vi.fn(),
  cleanupExpired: vi.fn().mockReturnValue(0),
  close: vi.fn(),
};

vi.mock('../../src/services/session-store.js', () => ({
  getSessionStore: vi.fn(() => mockSessionStore),
  closeSessionStore: vi.fn(),
}));

vi.mock('../../src/services/notification-store.js', () => ({
  getNotificationStore: vi.fn(() => ({
    getUnread: vi.fn(() => []),
    getRecent: vi.fn(() => []),
    countUnread: vi.fn(() => 0),
    markAllRead: vi.fn(() => 0),
    markRead: vi.fn(() => true),
    cleanup: vi.fn(),
  })),
  closeNotificationStore: vi.fn(),
}));

vi.mock('../../src/services/quick-links-store.js', () => ({
  getQuickLinksStore: vi.fn(() => ({
    getLinks: vi.fn(() => []),
    addLink: vi.fn(),
    removeLink: vi.fn(() => true),
    reorderLinks: vi.fn(() => true),
  })),
  closeQuickLinksStore: vi.fn(),
}));

vi.mock('../../src/services/server-health.js', () => ({
  getServerHealth: vi.fn(async () => null),
}));

vi.mock('../../src/plugins/loader.js', () => ({
  getPluginWidgets: vi.fn(() => []),
}));

vi.mock('../../src/services/conversation-processor.js', () => ({
  processConversationTurn: vi.fn(async () => { /* noop */ }),
}));

vi.mock('../../src/commands/ask.js', () => ({
  checkAndRecordClaudeRequest: vi.fn(() => true),
}));

import { startWebServer, stopWebServer } from '../../src/web/server.js';

const AUTH_TOKEN = 'smoke-test-auth-token-min16';

const webConfig: WebConfig = {
  enabled: true,
  port: 0,
  baseUrl: 'http://localhost:0',
  authToken: AUTH_TOKEN,
  linkTokenTtlMinutes: 15,
  sessionTtlHours: 72,
};

let baseUrl: string;
let sessionCookie: string;

/**
 * Smoke tests validate that the web server can start, authenticate,
 * and serve its critical routes. They run fast (<5s) and are designed
 * to be executed on every deployment.
 */
describe('smoke tests', () => {
  beforeAll(async () => {
    // Fixed port for smoke tests (avoids needing to read server.address())
    const testConfig = { ...webConfig, port: 18950 };
    await startWebServer(testConfig);
    baseUrl = 'http://localhost:18950';
  });

  afterAll(async () => {
    await stopWebServer();
  });

  describe('server starts and responds', () => {
    it('should respond to health check', async () => {
      const res = await fetch(`${baseUrl}/health`);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBe('ok');
      expect(json.socketMode).toBeDefined();
      expect(json.socketMode.connected).toBe(true);
    });

    it('should serve login page without auth', async () => {
      const res = await fetch(`${baseUrl}/login`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('<form');
    });

    it('should allow unauthenticated access to public dashboard', async () => {
      mockSessionStore.getSession.mockReturnValue(null);
      const res = await fetch(`${baseUrl}/`, { redirect: 'manual' });
      expect(res.status).toBe(200);
    });

    it('should reject unauthenticated access to conversations', async () => {
      mockSessionStore.getSession.mockReturnValue(null);
      const res = await fetch(`${baseUrl}/c`, { redirect: 'manual' });
      expect(res.status).toBe(401);
    });
  });

  describe('authentication flow', () => {
    it('should login with admin token and set session cookie', async () => {
      const res = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `token=${AUTH_TOKEN}`,
        redirect: 'manual',
      });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/');

      const setCookie = res.headers.get('set-cookie') ?? '';
      expect(setCookie).toContain('ssm_session=');

      // Extract session cookie for subsequent requests
      const match = setCookie.match(/ssm_session=([^;]+)/);
      sessionCookie = match ? `ssm_session=${match[1]}` : '';
      expect(sessionCookie).not.toBe('');
    });

    it('should reject invalid token', async () => {
      const res = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'token=wrong-token',
        redirect: 'manual',
      });
      expect(res.status).toBe(401);
    });
  });

  describe('authenticated routes', () => {
    function authFetch(path: string, opts: RequestInit = {}): Promise<Response> {
      mockSessionStore.getSession.mockReturnValue({
        sessionId: 'smoke-session-id',
        userId: 'admin',
        isAdmin: true,
        createdAt: Date.now(),
        expiresAt: Date.now() + 72 * 3600 * 1000,
      });
      const headers = new Headers(opts.headers);
      headers.set('Cookie', 'ssm_session=smoke-session-id');
      return fetch(`${baseUrl}${path}`, { ...opts, headers, redirect: 'manual' });
    }

    it('should serve dashboard', async () => {
      const res = await authFetch('/');
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('Dashboard');
    });

    it('should serve conversation list', async () => {
      const res = await authFetch('/c');
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('Conversations');
    });

    it('should serve notifications page', async () => {
      const res = await authFetch('/notifications');
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('Notification');
    });

    it('should serve notifications API', async () => {
      const res = await authFetch('/api/notifications');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toHaveProperty('notifications');
    });

    it('should serve quick links API', async () => {
      const res = await authFetch('/api/links');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toHaveProperty('links');
    });
  });

  describe('security headers', () => {
    it('should set all security headers', async () => {
      const res = await fetch(`${baseUrl}/health`);
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(res.headers.get('X-Frame-Options')).toBe('DENY');
      expect(res.headers.get('X-XSS-Protection')).toBe('1; mode=block');
      expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
      expect(res.headers.get('Cache-Control')).toContain('no-cache');
    });
  });

  describe('404 handling', () => {
    it('should return 404 for unknown routes', async () => {
      const res = await fetch(`${baseUrl}/this/does/not/exist`);
      expect(res.status).toBe(404);
    });
  });

  describe('logout', () => {
    it('should clear session and redirect to login', async () => {
      const res = await fetch(`${baseUrl}/logout`, {
        method: 'POST',
        headers: { Cookie: 'ssm_session=smoke-session-id' },
        redirect: 'manual',
      });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/login');
      expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
    });
  });
});

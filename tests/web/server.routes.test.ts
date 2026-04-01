import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
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
      baseUrl: 'http://localhost:8080',
      authToken: 'test-auth-token-minimum16',
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

// Track mock conversation store calls
const mockConversations = new Map<string, {
  id: number;
  threadTs: string;
  channelId: string;
  userId: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  createdAt: number;
  updatedAt: number;
  favoritedAt: number | null;
}>();

const mockSessionSummaries = [
  {
    id: 1,
    threadTs: '1000.001',
    channelId: 'C001',
    userId: 'U123',
    messageCount: 2,
    firstMessage: 'Hello',
    createdAt: Date.now() - 60000,
    updatedAt: Date.now(),
    favoritedAt: null,
    archivedAt: null,
    tags: [] as string[],
  },
];

const mockStore = {
  getConversation: vi.fn((threadTs: string, channelId: string) => {
    return mockConversations.get(`${threadTs}:${channelId}`) ?? null;
  }),
  getToolCalls: vi.fn(() => []),
  listRecentSessions: vi.fn(() => mockSessionSummaries),
  countSessions: vi.fn(() => 1),
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
    totalSessions: 1, activeSessions: 0, totalMessages: 2,
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
    sessionId: 'test-session-id',
    userId: 'U123',
    isAdmin: false,
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

const mockNotifStore = {
  getUnread: vi.fn(() => []),
  getRecent: vi.fn(() => []),
  countUnread: vi.fn(() => 0),
  markAllRead: vi.fn(() => 0),
  markRead: vi.fn(() => true),
  cleanup: vi.fn(),
};

vi.mock('../../src/services/notification-store.js', () => ({
  getNotificationStore: vi.fn(() => mockNotifStore),
  closeNotificationStore: vi.fn(),
}));

const mockLinksStore = {
  getLinks: vi.fn(() => []),
  addLink: vi.fn((userId: string, title: string, url: string, icon?: string) => ({
    id: 1, userId, title, url, icon: icon ?? null, sortOrder: 0,
  })),
  removeLink: vi.fn(() => true),
  reorderLinks: vi.fn(() => true),
};

vi.mock('../../src/services/quick-links-store.js', () => ({
  getQuickLinksStore: vi.fn(() => mockLinksStore),
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
import { createLinkToken } from '../../src/web/auth.js';

const webConfig: WebConfig = {
  enabled: true,
  port: 0,
  baseUrl: 'http://localhost:8080',
  authToken: 'test-auth-token-minimum16',
  linkTokenTtlMinutes: 15,
  sessionTtlHours: 72,
};

let baseUrl: string;

/**
 * Helper to make authenticated requests using session cookie
 */
async function authFetch(path: string, opts: RequestInit = {}): Promise<Response> {
  // Set up session mock for authenticated requests
  mockSessionStore.getSession.mockReturnValue({
    sessionId: 'test-session-id',
    userId: 'U123',
    isAdmin: false,
    createdAt: Date.now(),
    expiresAt: Date.now() + 72 * 3600 * 1000,
  });

  const headers = new Headers(opts.headers);
  headers.set('Cookie', 'ssm_session=test-session-id');

  return fetch(`${baseUrl}${path}`, { ...opts, headers, redirect: 'manual' });
}

describe('web server routes', () => {
  beforeAll(async () => {
    const testConfig = { ...webConfig, port: 18923 };
    await startWebServer(testConfig);
    baseUrl = 'http://localhost:18923';
  });

  afterAll(async () => {
    await stopWebServer();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionStore.getSession.mockReturnValue({
      sessionId: 'test-session-id',
      userId: 'U123',
      isAdmin: false,
      createdAt: Date.now(),
      expiresAt: Date.now() + 72 * 3600 * 1000,
    });
  });

  describe('unauthenticated endpoints', () => {
    it('GET /health should return ok without auth', async () => {
      const res = await fetch(`${baseUrl}/health`);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({ status: 'ok' });
    });

    it('GET /login should return login page', async () => {
      const res = await fetch(`${baseUrl}/login`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('html');
    });

    it('GET /login should accept return_to param', async () => {
      const res = await fetch(`${baseUrl}/login?return_to=/c`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('html');
    });

    it('POST /login with invalid token should return 401', async () => {
      const res = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'token=invalid-token',
        redirect: 'manual',
      });
      expect(res.status).toBe(401);
    });

    it('POST /login with valid admin token should redirect', async () => {
      const res = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `token=${webConfig.authToken}`,
        redirect: 'manual',
      });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/');
    });

    it('POST /login with return_to should redirect to return_to', async () => {
      const res = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `token=${webConfig.authToken}&return_to=/c`,
        redirect: 'manual',
      });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/c');
    });

    it('POST /login should block protocol-relative return_to', async () => {
      const res = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `token=${webConfig.authToken}&return_to=//evil.com`,
        redirect: 'manual',
      });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/');
    });
  });

  describe('POST /logout', () => {
    it('should clear session and redirect to login', async () => {
      const res = await fetch(`${baseUrl}/logout`, {
        method: 'POST',
        headers: { Cookie: 'ssm_session=test-session-id' },
        redirect: 'manual',
      });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/login');
      expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
    });
  });

  describe('security headers', () => {
    it('should set security headers on all responses', async () => {
      const res = await fetch(`${baseUrl}/health`);
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(res.headers.get('X-Frame-Options')).toBe('DENY');
      expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
    });
  });

  describe('session auth middleware', () => {
    it('should return 401 for unauthenticated requests to protected routes', async () => {
      mockSessionStore.getSession.mockReturnValue(null);
      const res = await fetch(`${baseUrl}/c`, {
        redirect: 'manual',
      });
      expect(res.status).toBe(401);
    });

    it('should accept requests with valid session cookie', async () => {
      const res = await authFetch('/c');
      expect(res.status).toBe(200);
    });

    it('should create session and redirect when valid token provided', async () => {
      mockSessionStore.getSession.mockReturnValue(null);
      const token = createLinkToken('U123', webConfig.authToken, 15);
      const res = await fetch(`${baseUrl}/c?token=${encodeURIComponent(token)}`, {
        redirect: 'manual',
      });
      expect(res.status).toBe(302);
      expect(res.headers.get('set-cookie')).toContain('ssm_session=');
      // Token should be stripped from redirect URL
      const location = res.headers.get('location') ?? '';
      expect(location).not.toContain('token=');
    });

    it('should clear expired session cookie', async () => {
      mockSessionStore.getSession.mockReturnValue(null);
      const res = await fetch(`${baseUrl}/c`, {
        headers: { Cookie: 'ssm_session=expired-session' },
        redirect: 'manual',
      });
      expect(res.status).toBe(401);
      expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
    });
  });

  describe('conversation routes', () => {
    it('GET /c should return session list', async () => {
      const res = await authFetch('/c');
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('html');
    });

    it('GET /c/search should redirect when query is empty', async () => {
      const res = await authFetch('/c/search', { redirect: 'manual' });
      expect(res.status).toBe(302);
    });

    it('GET /c/search?q=hello should return search results', async () => {
      const res = await authFetch('/c/search?q=hello');
      expect(res.status).toBe(200);
    });

    it('GET /c/favorites should return favorites list', async () => {
      const res = await authFetch('/c/favorites');
      expect(res.status).toBe(200);
    });

    it('GET /c/tag/:tag should return tag-filtered list', async () => {
      const res = await authFetch('/c/tag/important');
      expect(res.status).toBe(200);
    });

    it('GET /c/archived should return archived conversations', async () => {
      const res = await authFetch('/c/archived');
      expect(res.status).toBe(200);
    });

    it('POST /c/:id/favorite should toggle favorite', async () => {
      const res = await authFetch('/c/1/favorite', { method: 'POST' });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toHaveProperty('isFavorited');
    });

    it('POST /c/:id/favorite with invalid id should return 400', async () => {
      const res = await authFetch('/c/abc/favorite', { method: 'POST' });
      expect(res.status).toBe(400);
    });

    it('POST /c/:id/tag should add tag', async () => {
      mockStore.getTags.mockReturnValue(['new-tag']);
      const res = await authFetch('/c/1/tag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag: 'new-tag' }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toHaveProperty('tags');
    });

    it('POST /c/:id/tag with invalid tag should return 400', async () => {
      const res = await authFetch('/c/1/tag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag: '' }),
      });
      expect(res.status).toBe(400);
    });

    it('POST /c/:id/tag with too-long tag should return 400', async () => {
      const res = await authFetch('/c/1/tag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag: 'a'.repeat(51) }),
      });
      expect(res.status).toBe(400);
    });

    it('POST /c/:id/tag with invalid characters should return 400', async () => {
      const res = await authFetch('/c/1/tag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag: 'Invalid Tag!' }),
      });
      expect(res.status).toBe(400);
    });

    it('DELETE /c/:id/tag/:tag should remove tag', async () => {
      mockStore.getTags.mockReturnValue([]);
      const res = await authFetch('/c/1/tag/old-tag', { method: 'DELETE' });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toHaveProperty('tags');
    });

    it('POST /c/:id/archive should archive conversation', async () => {
      const res = await authFetch('/c/1/archive', { method: 'POST' });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toHaveProperty('archived');
    });

    it('GET /c/:threadTs/:channelId should return conversation page', async () => {
      mockConversations.set('1000.001:C001', {
        id: 1,
        threadTs: '1000.001',
        channelId: 'C001',
        userId: 'U123',
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi' },
        ],
        createdAt: Date.now() - 60000,
        updatedAt: Date.now(),
        favoritedAt: null,
      });
      mockStore.getConversation.mockReturnValue(mockConversations.get('1000.001:C001'));

      const res = await authFetch('/c/1000.001/C001');
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('Hello');

      mockConversations.delete('1000.001:C001');
    });

    it('GET /c/:threadTs/:channelId should return 404 for missing conversation', async () => {
      mockStore.getConversation.mockReturnValue(null);
      const res = await authFetch('/c/9999.999/CNONE');
      expect(res.status).toBe(404);
    });
  });

  describe('continue conversation (POST /c/:threadTs/:channelId/ask)', () => {
    it('should return 400 for missing message', async () => {
      const res = await authFetch('/c/1000.001/C001/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it('should return 400 for too-long message', async () => {
      const res = await authFetch('/c/1000.001/C001/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'x'.repeat(4001) }),
      });
      expect(res.status).toBe(400);
    });

    it('should return 404 for new conversation (no prior messages)', async () => {
      mockStore.getOrCreateConversation.mockReturnValue({
        id: 99,
        messages: [{ role: 'user', content: 'first' }],
      });

      const res = await authFetch('/c/1000.001/C001/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'continue' }),
      });
      expect(res.status).toBe(404);
    });

    it('should return success for valid continuation', async () => {
      mockStore.getOrCreateConversation.mockReturnValue({
        id: 1,
        messages: [
          { role: 'user', content: 'original' },
          { role: 'assistant', content: 'reply' },
          { role: 'user', content: 'follow up' },
        ],
      });

      const res = await authFetch('/c/1000.001/C001/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'follow up' }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({ success: true });
    });
  });

  describe('markdown export', () => {
    it('GET /c/:threadTs/:channelId/export/md should return markdown', async () => {
      mockStore.getConversation.mockReturnValue({
        id: 1,
        threadTs: '1000.001',
        channelId: 'C001',
        userId: 'U123',
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi' },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const res = await authFetch('/c/1000.001/C001/export/md');
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/markdown');
      expect(res.headers.get('content-disposition')).toContain('attachment');
    });

    it('should return 404 for non-existent conversation', async () => {
      mockStore.getConversation.mockReturnValue(null);
      const res = await authFetch('/c/9999.999/CNONE/export/md');
      expect(res.status).toBe(404);
    });
  });

  describe('API endpoints', () => {
    it('GET /api/health/server should return 503 when health unavailable', async () => {
      const res = await authFetch('/api/health/server');
      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json).toHaveProperty('error');
    });

    it('GET /api/links should return quick links', async () => {
      const res = await authFetch('/api/links');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toHaveProperty('links');
    });

    it('POST /api/links should create a quick link', async () => {
      const res = await authFetch('/api/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Test', url: 'https://example.com' }),
      });
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.link).toHaveProperty('title', 'Test');
    });

    it('POST /api/links should reject missing title/url', async () => {
      const res = await authFetch('/api/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Test' }),
      });
      expect(res.status).toBe(400);
    });

    it('POST /api/links should reject dangerous URL schemes', async () => {
      const res = await authFetch('/api/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'XSS', url: 'javascript:alert(1)' }),
      });
      expect(res.status).toBe(400);
    });

    it('POST /api/links should allow relative URLs', async () => {
      const res = await authFetch('/api/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Internal', url: '/c' }),
      });
      expect(res.status).toBe(201);
    });

    it('DELETE /api/links/:id should remove a link', async () => {
      const res = await authFetch('/api/links/1', { method: 'DELETE' });
      expect(res.status).toBe(200);
    });

    it('DELETE /api/links/:id should reject invalid id', async () => {
      const res = await authFetch('/api/links/abc', { method: 'DELETE' });
      expect(res.status).toBe(400);
    });

    it('PUT /api/links/reorder should reorder links', async () => {
      const res = await authFetch('/api/links/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedIds: [3, 1, 2] }),
      });
      expect(res.status).toBe(200);
    });

    it('PUT /api/links/reorder should reject invalid input', async () => {
      const res = await authFetch('/api/links/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedIds: 'not-array' }),
      });
      expect(res.status).toBe(400);
    });

    it('GET /api/notifications should return notifications', async () => {
      const res = await authFetch('/api/notifications');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toHaveProperty('notifications');
      expect(json).toHaveProperty('unreadCount');
    });

    it('GET /api/notifications?unread=true should return unread only', async () => {
      const res = await authFetch('/api/notifications?unread=true');
      expect(res.status).toBe(200);
      expect(mockNotifStore.getUnread).toHaveBeenCalled();
    });

    it('POST /api/notifications/read-all should mark all as read', async () => {
      const res = await authFetch('/api/notifications/read-all', { method: 'POST' });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toHaveProperty('unreadCount', 0);
    });

    it('POST /api/notifications/:id/read should mark single as read', async () => {
      const res = await authFetch('/api/notifications/1/read', { method: 'POST' });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toHaveProperty('success');
    });

    it('POST /api/notifications/:id/read should reject invalid id', async () => {
      const res = await authFetch('/api/notifications/abc/read', { method: 'POST' });
      expect(res.status).toBe(400);
    });
  });

  describe('pages', () => {
    it('GET /notifications should return notifications page', async () => {
      const res = await authFetch('/notifications');
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('html');
    });

    it('GET / should return dashboard page', async () => {
      // Ensure mocks return data shapes that renderDashboard expects
      mockStore.getSessionStats.mockReturnValue({
        totalSessions: 1,
        activeSessions: 0,
        totalMessages: 2,
        totalToolCalls: 0,
        avgToolDurationMs: null,
        toolFailureRate: 0,
        topTools: [],
      });
      mockStore.listRecentSessions.mockReturnValue([]);
      mockStore.listFavoriteSessions.mockReturnValue([]);
      mockStore.countFavoriteSessions.mockReturnValue(0);
      mockStore.listAllTags.mockReturnValue([]);
      const res = await authFetch('/');
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('html');
    });
  });

  describe('SSE stream endpoints', () => {
    it('GET /c/:threadTs/:channelId/stream should require auth', async () => {
      mockSessionStore.getSession.mockReturnValue(null);
      const res = await fetch(`${baseUrl}/c/1000.001/C001/stream`, {
        redirect: 'manual',
      });
      expect(res.status).toBe(401);
    });

    it('GET /c/:threadTs/:channelId/stream should return 404 for missing conversation', async () => {
      mockStore.getConversation.mockReturnValue(null);
      const res = await authFetch('/c/9999.999/CNONE/stream');
      expect(res.status).toBe(404);
    });

    it('GET /c/:threadTs/:channelId/stream should return 403 for non-owner', async () => {
      mockStore.getConversation.mockReturnValue({
        id: 1,
        threadTs: '1000.001',
        channelId: 'C001',
        userId: 'U999',
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        favoritedAt: null,
      });
      const res = await authFetch('/c/1000.001/C001/stream');
      expect(res.status).toBe(403);
    });

    it('GET /c/:threadTs/:channelId/stream should return SSE headers for owner', async () => {
      mockStore.getConversation.mockReturnValue({
        id: 1,
        threadTs: '1000.001',
        channelId: 'C001',
        userId: 'U123',
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        favoritedAt: null,
      });

      // SSE connections stay open, so we need to abort after checking headers
      const controller = new AbortController();
      const resPromise = authFetch('/c/1000.001/C001/stream', {
        signal: controller.signal,
      });

      // Give the server time to start the SSE response
      await new Promise((r) => setTimeout(r, 50));
      controller.abort();

      try {
        const res = await resPromise;
        expect(res.headers.get('content-type')).toContain('text/event-stream');
        expect(res.headers.get('cache-control')).toContain('no-cache');
      } catch {
        // AbortError is expected — we just need the headers
      }
    });

    it('GET /api/notifications/stream should return SSE headers', async () => {
      const controller = new AbortController();
      const resPromise = authFetch('/api/notifications/stream', {
        signal: controller.signal,
      });

      await new Promise((r) => setTimeout(r, 50));
      controller.abort();

      try {
        const res = await resPromise;
        expect(res.headers.get('content-type')).toContain('text/event-stream');
      } catch {
        // AbortError is expected
      }
    });
  });

  describe('rate limiting on /ask', () => {
    it('should return 429 when rate limit exceeded', async () => {
      const { checkAndRecordClaudeRequest } = await import('../../src/commands/ask.js');
      vi.mocked(checkAndRecordClaudeRequest).mockReturnValueOnce(false);

      mockStore.getOrCreateConversation.mockReturnValue({
        id: 1,
        messages: [
          { role: 'user', content: 'original' },
          { role: 'assistant', content: 'reply' },
          { role: 'user', content: 'follow up' },
        ],
      });

      const res = await authFetch('/c/1000.001/C001/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'follow up' }),
      });
      expect(res.status).toBe(429);
      const json = await res.json();
      expect(json.error).toContain('Rate limit');
    });
  });

  describe('health API with data', () => {
    it('GET /api/health/server should return health metrics when available', async () => {
      const { getServerHealth } = await import('../../src/services/server-health.js');
      vi.mocked(getServerHealth).mockResolvedValueOnce({
        uptime: '5 days',
        loadAverage: [0.5, 0.3, 0.2],
        memory: { total: '16GB', used: '8GB', free: '8GB', usedPercent: 50 },
        disk: [{ mount: '/', total: '100GB', used: '50GB', free: '50GB', usedPercent: 50 }],
        cpuCount: 4,
        hostname: 'test-server',
        platform: 'linux',
        timestamp: Date.now(),
      });

      const res = await authFetch('/api/health/server');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toHaveProperty('uptime');
      expect(json).toHaveProperty('memory');
      expect(json).toHaveProperty('disk');
    });
  });

  describe('error handling (500 paths)', () => {
    it('GET /c should return 500 when store throws', async () => {
      const { getConversationStore } = await import('../../src/services/conversation-store.js');
      vi.mocked(getConversationStore).mockImplementationOnce(() => {
        throw new Error('DB connection failed');
      });

      const res = await authFetch('/c');
      expect(res.status).toBe(500);
      const html = await res.text();
      expect(html).toContain('html');
    });

    it('GET /c/search should return 500 when store throws', async () => {
      const { getConversationStore } = await import('../../src/services/conversation-store.js');
      vi.mocked(getConversationStore).mockImplementationOnce(() => {
        throw new Error('DB connection failed');
      });

      const res = await authFetch('/c/search?q=test');
      expect(res.status).toBe(500);
    });

    it('GET /c/favorites should return 500 when store throws', async () => {
      const { getConversationStore } = await import('../../src/services/conversation-store.js');
      vi.mocked(getConversationStore).mockImplementationOnce(() => {
        throw new Error('DB connection failed');
      });

      const res = await authFetch('/c/favorites');
      expect(res.status).toBe(500);
    });

    it('GET /c/tag/:tag should return 500 when store throws', async () => {
      const { getConversationStore } = await import('../../src/services/conversation-store.js');
      vi.mocked(getConversationStore).mockImplementationOnce(() => {
        throw new Error('DB connection failed');
      });

      const res = await authFetch('/c/tag/test');
      expect(res.status).toBe(500);
    });

    it('GET /c/:threadTs/:channelId should return 500 when store throws', async () => {
      const { getConversationStore } = await import('../../src/services/conversation-store.js');
      vi.mocked(getConversationStore).mockImplementationOnce(() => {
        throw new Error('DB connection failed');
      });

      const res = await authFetch('/c/1000.001/C001');
      expect(res.status).toBe(500);
    });

    it('POST /c/:id/favorite should return 500 when store throws', async () => {
      mockStore.toggleFavorite.mockImplementationOnce(() => {
        throw new Error('DB error');
      });

      const res = await authFetch('/c/1/favorite', { method: 'POST' });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json).toHaveProperty('error');
    });

    it('POST /c/:id/tag should return 500 when store throws', async () => {
      mockStore.addTag.mockImplementationOnce(() => {
        throw new Error('DB error');
      });

      const res = await authFetch('/c/1/tag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag: 'test' }),
      });
      expect(res.status).toBe(500);
    });

    it('DELETE /c/:id/tag/:tag should return 500 when store throws', async () => {
      mockStore.removeTag.mockImplementationOnce(() => {
        throw new Error('DB error');
      });

      const res = await authFetch('/c/1/tag/test', { method: 'DELETE' });
      expect(res.status).toBe(500);
    });

    it('POST /c/:id/archive should return 500 when store throws', async () => {
      mockStore.archiveConversation.mockImplementationOnce(() => {
        throw new Error('DB error');
      });

      const res = await authFetch('/c/1/archive', { method: 'POST' });
      expect(res.status).toBe(500);
    });

    it('GET /c/archived should return 500 when store throws', async () => {
      const { getConversationStore } = await import('../../src/services/conversation-store.js');
      vi.mocked(getConversationStore).mockImplementationOnce(() => {
        throw new Error('DB connection failed');
      });

      const res = await authFetch('/c/archived');
      expect(res.status).toBe(500);
    });

    it('GET / (dashboard) should return 500 when store throws', async () => {
      const { getConversationStore } = await import('../../src/services/conversation-store.js');
      vi.mocked(getConversationStore).mockImplementationOnce(() => {
        throw new Error('DB connection failed');
      });

      const res = await authFetch('/');
      expect(res.status).toBe(500);
    });

    it('GET /notifications should return 500 when store throws', async () => {
      const { getNotificationStore } = await import('../../src/services/notification-store.js');
      vi.mocked(getNotificationStore).mockImplementationOnce(() => {
        throw new Error('DB connection failed');
      });

      const res = await authFetch('/notifications');
      expect(res.status).toBe(500);
    });

    it('POST /c/:threadTs/:channelId/ask should return 500 on setup error', async () => {
      const { getConversationStore } = await import('../../src/services/conversation-store.js');
      vi.mocked(getConversationStore).mockImplementationOnce(() => {
        throw new Error('DB connection failed');
      });

      const res = await authFetch('/c/1000.001/C001/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'test question' }),
      });
      expect(res.status).toBe(500);
    });
  });

  describe('additional validation', () => {
    it('POST /c/:id/archive should reject invalid id', async () => {
      const res = await authFetch('/c/abc/archive', { method: 'POST' });
      expect(res.status).toBe(400);
    });

    it('DELETE /c/:id/tag/:tag should reject invalid id', async () => {
      const res = await authFetch('/c/abc/tag/test', { method: 'DELETE' });
      expect(res.status).toBe(400);
    });

    it('POST /api/links should reject too-long title', async () => {
      const res = await authFetch('/api/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'x'.repeat(101), url: 'https://example.com' }),
      });
      expect(res.status).toBe(400);
    });

    it('POST /api/links should reject too-long icon', async () => {
      const res = await authFetch('/api/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Test', url: 'https://example.com', icon: 'x'.repeat(51) }),
      });
      expect(res.status).toBe(400);
    });

    it('PUT /api/links/reorder should reject too many items', async () => {
      const ids = Array.from({ length: 101 }, (_, i) => i + 1);
      const res = await authFetch('/api/links/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedIds: ids }),
      });
      expect(res.status).toBe(400);
    });

    it('DELETE /api/links/:id should reject zero id', async () => {
      const res = await authFetch('/api/links/0', { method: 'DELETE' });
      expect(res.status).toBe(400);
    });

    it('POST /api/notifications/:id/read should reject zero id', async () => {
      const res = await authFetch('/api/notifications/0/read', { method: 'POST' });
      expect(res.status).toBe(400);
    });
  });

  describe('404 handling', () => {
    it('should return 404 for unknown routes', async () => {
      const res = await fetch(`${baseUrl}/nonexistent/path`);
      expect(res.status).toBe(404);
    });
  });
});

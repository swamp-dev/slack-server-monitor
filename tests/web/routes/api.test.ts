import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';

vi.mock('../../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../src/config/index.js', () => ({
  config: {
    claude: { dbPath: ':memory:', conversationTtlHours: 24 },
    web: { enabled: true, port: 0, baseUrl: 'http://localhost', authToken: 'test-token-min16', linkTokenTtlMinutes: 15, sessionTtlHours: 72 },
  },
}));

const mockHealth = {
  cpu: { usage: 0.1 },
  memory: { used: 1000, total: 8000 },
  uptime: 3600,
};

vi.mock('../../../src/services/server-health.js', () => ({
  getServerHealth: vi.fn(() => Promise.resolve(mockHealth)),
}));

const mockSessionStore = {
  getSession: vi.fn(),
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  deleteSessionsForUser: vi.fn(),
  cleanupExpired: vi.fn(),
  close: vi.fn(),
};

vi.mock('../../../src/services/session-store.js', () => ({
  getSessionStore: vi.fn(() => mockSessionStore),
  closeSessionStore: vi.fn(),
}));

vi.mock('../../../src/services/user-store.js', () => ({
  getUserStore: vi.fn(() => ({
    resolveIdentities: vi.fn((userId: string) => [userId]),
    getBySlackId: vi.fn(),
    getByUsername: vi.fn(),
  })),
}));

vi.mock('../../../src/web/auth.js', () => ({
  parseCookies: vi.fn(() => ({ ssm_session: 'test-session' })),
  resolveTokenWithRole: vi.fn(),
}));

const mockQuickLinksStore = {
  getLinks: vi.fn(() => []),
  addLink: vi.fn(),
  removeLink: vi.fn(),
  reorderLinks: vi.fn(),
};

vi.mock('../../../src/services/quick-links-store.js', () => ({
  getQuickLinksStore: vi.fn(() => mockQuickLinksStore),
  closeQuickLinksStore: vi.fn(),
}));

const mockNotifStore = {
  getRecent: vi.fn(() => []),
  getUnread: vi.fn(() => []),
  countUnread: vi.fn(() => 0),
  markRead: vi.fn(() => true),
  markAllRead: vi.fn(() => 0),
};

vi.mock('../../../src/services/notification-store.js', () => ({
  getNotificationStore: vi.fn(() => mockNotifStore),
  closeNotificationStore: vi.fn(),
}));

vi.mock('../../../src/services/conversation-store.js', () => ({
  getConversationStore: vi.fn(() => ({
    listRecentSessions: vi.fn(() => []),
    searchConversations: vi.fn(() => []),
  })),
}));

vi.mock('../../../src/services/event-bus.js', () => ({
  getEventBus: vi.fn(() => ({ on: vi.fn() })),
}));

vi.mock('../../../src/web/sse.js', () => ({
  getSharedSSEManager: vi.fn(() => null),
}));

vi.mock('../../../src/web/templates/index.js', () => ({
  renderNotificationPage: vi.fn(() => '<html>notifications</html>'),
  render404: vi.fn(() => '<html>404</html>'),
  renderError: vi.fn(() => '<html>error</html>'),
}));

import { createApiRouter } from '../../../src/web/routes/api.js';
import type { WebConfig } from '../../../src/config/schema.js';

const claudeConfig = { dbPath: ':memory:', conversationTtlHours: 24 };
const webConfig: WebConfig = {
  enabled: true,
  port: 0,
  baseUrl: 'http://localhost',
  authToken: 'test-token-min16',
  linkTokenTtlMinutes: 15,
  sessionTtlHours: 72,
};
const dbPath = ':memory:';

let server: Server;
let baseUrl: string;

function makeApp(): express.Express {
  const app = express();
  app.use(express.json());
  // Pre-authenticate all test requests
  app.use((_req, res, next) => {
    res.locals.userId = 'U123';
    res.locals.isAdmin = false;
    next();
  });
  app.use('/', createApiRouter(claudeConfig as never, webConfig, dbPath));
  return app;
}

beforeAll(async () => {
  mockSessionStore.getSession.mockReturnValue({
    sessionId: 'test-session',
    userId: 'U123',
    isAdmin: false,
    createdAt: Date.now(),
    expiresAt: Date.now() + 72 * 3600 * 1000,
  });

  const app = makeApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

beforeEach(() => {
  vi.clearAllMocks();
  mockSessionStore.getSession.mockReturnValue({
    sessionId: 'test-session',
    userId: 'U123',
    isAdmin: false,
    createdAt: Date.now(),
    expiresAt: Date.now() + 72 * 3600 * 1000,
  });
});

describe('GET /api/health/server', () => {
  it('returns the server health shape', async () => {
    const { getServerHealth } = await import('../../../src/services/server-health.js');
    vi.mocked(getServerHealth).mockResolvedValue(mockHealth as never);

    const res = await fetch(`${baseUrl}/api/health/server`, {
      headers: { Cookie: 'ssm_session=test-session' },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ cpu: expect.any(Object) });
  });
});

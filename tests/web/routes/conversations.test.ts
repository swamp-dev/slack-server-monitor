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

const mockStore = {
  getConversation: vi.fn(),
  getToolCalls: vi.fn(() => []),
  getTags: vi.fn(() => []),
  listBranches: vi.fn(() => []),
  listRecentSessions: vi.fn(() => []),
  countSessions: vi.fn(() => 0),
  listAllTags: vi.fn(() => []),
  getDatabase: vi.fn(() => ({ prepare: vi.fn(() => ({ all: vi.fn(() => []) })) })),
  searchConversations: vi.fn(() => []),
  countSearchResults: vi.fn(() => 0),
  listFavoriteSessions: vi.fn(() => []),
  countFavoriteSessions: vi.fn(() => 0),
  listSessionsByTag: vi.fn(() => []),
  countSessionsByTag: vi.fn(() => 0),
  archiveConversation: vi.fn(() => true),
  listArchivedSessions: vi.fn(() => []),
  countArchivedSessions: vi.fn(() => 0),
  toggleFavorite: vi.fn(() => true),
  addTag: vi.fn(),
  removeTag: vi.fn(),
  getOrCreateConversation: vi.fn(),
  branchConversation: vi.fn(),
  getConversationById: vi.fn(),
};

vi.mock('../../../src/services/conversation-store.js', () => ({
  getConversationStore: vi.fn(() => mockStore),
}));

vi.mock('../../../src/services/user-store.js', () => ({
  getUserStore: vi.fn(() => ({
    resolveIdentities: vi.fn((userId: string) => [userId]),
    getBySlackId: vi.fn(),
    getByUsername: vi.fn(),
  })),
}));

vi.mock('../../../src/web/templates/index.js', () => ({
  renderConversation: vi.fn(() => '<html>conversation</html>'),
  renderMarkdownExport: vi.fn(() => '# Export'),
  renderSessionList: vi.fn(() => '<html>list</html>'),
  render404: vi.fn(() => '<html>404</html>'),
  renderError: vi.fn(() => '<html>error</html>'),
}));

vi.mock('../../../src/web/templates/utils.js', () => ({
  formatMarkdown: vi.fn((s: string) => s),
}));

vi.mock('../../../src/services/conversation-processor.js', () => ({
  processConversationTurn: vi.fn(() => Promise.resolve({ response: 'ok' })),
}));

vi.mock('../../../src/services/claude-rate-limit.js', () => ({
  checkAndRecordClaudeRequest: vi.fn(() => true),
}));

vi.mock('../../../src/web/sse.js', () => ({
  getSharedSSEManager: vi.fn(() => null),
}));

import { createConversationsRouter } from '../../../src/web/routes/conversations.js';

const claudeConfig = { dbPath: ':memory:', conversationTtlHours: 24 };
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
  app.use('/', createConversationsRouter(claudeConfig as never, dbPath));
  return app;
}

beforeAll(async () => {
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
  mockStore.getConversation.mockReturnValue(null);
  mockStore.getTags.mockReturnValue([]);
  mockStore.listBranches.mockReturnValue([]);
  mockStore.getToolCalls.mockReturnValue([]);
});

describe('GET /:threadTs/:channelId', () => {
  it('returns 200 with conversation HTML for a known thread', async () => {
    mockStore.getConversation.mockReturnValue({
      id: 1,
      threadTs: '1000.001',
      channelId: 'C001',
      userId: 'U123',
      messages: [{ role: 'user', content: 'Hello' }],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      favoritedAt: null,
      contextStatus: null,
      parentConversationId: null,
      branchPointIndex: null,
    });

    const res = await fetch(`${baseUrl}/1000.001/C001`);

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('conversation');
  });

  it('returns 404 for an unknown thread', async () => {
    mockStore.getConversation.mockReturnValue(null);

    const res = await fetch(`${baseUrl}/9999.999/CNONE`);

    expect(res.status).toBe(404);
  });
});

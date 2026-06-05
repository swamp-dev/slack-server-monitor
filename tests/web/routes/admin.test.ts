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

const mockUserStore = {
  create: vi.fn(),
  getById: vi.fn(),
  getByUsername: vi.fn(),
  getBySlackId: vi.fn(),
  listAll: vi.fn(() => []),
  countByRole: vi.fn(() => 2),
  updateRole: vi.fn(),
  deactivate: vi.fn(),
  activate: vi.fn(),
  updatePassword: vi.fn(),
  deleteById: vi.fn(),
  resolveIdentities: vi.fn(),
};

vi.mock('../../../src/services/user-store.js', () => ({
  getUserStore: vi.fn(() => mockUserStore),
}));

const mockInviteStore = {
  createInvite: vi.fn(),
  getInvite: vi.fn(),
  redeemInvite: vi.fn(),
  listActive: vi.fn(() => []),
  deleteInvite: vi.fn(),
};

vi.mock('../../../src/services/invite-store.js', () => ({
  getInviteStore: vi.fn(() => mockInviteStore),
}));

vi.mock('../../../src/web/templates/index.js', () => ({
  renderAdminUsers: vi.fn(() => '<html>admin users</html>'),
  renderError: vi.fn(() => '<html>error</html>'),
  render403: vi.fn(() => '<html>403 forbidden</html>'),
}));

import { createAdminRouter } from '../../../src/web/routes/admin.js';
import type { WebConfig } from '../../../src/config/schema.js';

const webConfig: WebConfig = {
  enabled: true,
  port: 0,
  baseUrl: 'http://localhost',
  authToken: 'test-token-min16',
  linkTokenTtlMinutes: 15,
  sessionTtlHours: 72,
};
const dbPath = ':memory:';

function makeApp(isAdmin: boolean): express.Express {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  app.use((_req, res, next) => {
    res.locals.userId = 'U123';
    res.locals.isAdmin = isAdmin;
    next();
  });
  app.use('/', createAdminRouter(dbPath, webConfig));
  return app;
}

let adminServer: Server;
let nonAdminServer: Server;
let adminBaseUrl: string;
let nonAdminBaseUrl: string;

beforeAll(async () => {
  const adminApp = makeApp(true);
  const nonAdminApp = makeApp(false);

  await new Promise<void>((resolve) => {
    adminServer = adminApp.listen(0, '127.0.0.1', resolve);
  });
  await new Promise<void>((resolve) => {
    nonAdminServer = nonAdminApp.listen(0, '127.0.0.1', resolve);
  });

  const adminAddr = adminServer.address() as { port: number };
  const nonAdminAddr = nonAdminServer.address() as { port: number };
  adminBaseUrl = `http://127.0.0.1:${adminAddr.port}`;
  nonAdminBaseUrl = `http://127.0.0.1:${nonAdminAddr.port}`;
});

afterAll(async () => {
  await Promise.all([
    new Promise<void>((resolve, reject) => adminServer.close((err) => (err ? reject(err) : resolve()))),
    new Promise<void>((resolve, reject) => nonAdminServer.close((err) => (err ? reject(err) : resolve()))),
  ]);
});

beforeEach(() => {
  vi.clearAllMocks();
  mockUserStore.listAll.mockReturnValue([]);
  mockInviteStore.listActive.mockReturnValue([]);
});

describe('GET /users', () => {
  it('returns 200 with admin page HTML for an admin session', async () => {
    const res = await fetch(`${adminBaseUrl}/users`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('admin users');
  });

  it('returns 403 for a non-admin session', async () => {
    const res = await fetch(`${nonAdminBaseUrl}/users`);
    expect(res.status).toBe(403);
  });
});

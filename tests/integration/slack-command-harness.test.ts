/**
 * Slack command middleware harness (#352).
 *
 * Constructs a real `@slack/bolt` `App` with a custom `Receiver`, wires
 * the production middleware chain (`authorize` → `rateLimit` →
 * `auditLog`) and a representative command, then drives synthesised
 * slash-command events through `App.processEvent`.
 *
 * Why this exists: the per-command tests under `tests/commands/*.test.ts`
 * mock `app.command()` and call the captured handler directly. They
 * never traverse the middleware stack. A regression that swaps the
 * order of `authorize` and `rateLimit`, or removes a middleware, would
 * pass every existing test. This harness makes those regressions loud.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import type { App as AppType, Receiver, ReceiverEvent } from '@slack/bolt';
import { App } from '@slack/bolt';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { User } from '../../src/types/user.js';

const mockUsers = new Map<string, User>();
let configChannelIds: string[] = [];

vi.mock('../../src/config/index.js', () => ({
  config: {
    authorization: { userIds: [], get channelIds() { return configChannelIds; } },
    claude: { dbPath: ':memory:' },
    rateLimit: {
      max: 3,
      windowSeconds: 60,
      cleanupIntervalMs: 60_000,
      commands: {},
    },
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  auditLog: vi.fn(),
}));

vi.mock('../../src/services/user-store.js', () => ({
  getUserStore: () => ({
    getBySlackId: (id: string): User | null => mockUsers.get(id) ?? null,
  }),
  resolveUserStoreDbPath: () => ':memory:',
}));

// Dynamic imports run after the `vi.mock(...)` calls above. vitest
// hoists the mocks regardless, but writing imports as dynamic makes
// the ordering visually obvious — don't "clean this up" into static
// imports without verifying the mocks still apply.
const { authorizeMiddleware } = await import('../../src/middleware/authorize.js');
const { rateLimitMiddleware, clearRateLimit } = await import('../../src/middleware/rate-limit.js');
const { auditLogMiddleware } = await import('../../src/middleware/audit-log.js');
const { logger } = await import('../../src/utils/logger.js');

interface HarnessApp {
  app: AppType;
  drive: (body: Record<string, unknown>) => Promise<void>;
  handlerCalls: { count: number };
}

class TestReceiver implements Receiver {
  private app!: AppType;
  init(app: AppType): void { this.app = app; }
  start(): Promise<unknown> { return Promise.resolve(); }
  stop(): Promise<unknown> { return Promise.resolve(); }
  drive(event: ReceiverEvent): Promise<void> {
    return this.app.processEvent(event);
  }
}

function makeAuthorizedUser(slackId: string, overrides: Partial<User> = {}): User {
  return {
    id: 1,
    slackId,
    username: null,
    displayName: null,
    role: 'user',
    isActive: true,
    addedAt: Date.now(),
    addedBy: 'test',
    notes: null,
    passwordHash: null,
    passwordSetAt: null,
    ...overrides,
  };
}

// Local HTTP server captures the rate-limit middleware's `respond()`
// call (which Bolt routes through response_url). Without a reachable
// URL, Bolt throws DNS errors and the test fails for the wrong reason.
let respondServer: Server | null = null;
let respondServerPort = 0;
const capturedRespondBodies: unknown[] = [];

beforeAll(async () => {
  respondServer = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      try { capturedRespondBodies.push(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { /* not json */ }
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end('{"ok":true}');
    });
  });
  const srv = respondServer;
  await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', resolve));
  respondServerPort = (srv.address() as AddressInfo).port;
});

afterAll(async () => {
  const srv = respondServer;
  if (srv) await new Promise<void>((resolve, reject) => srv.close((e) => (e ? reject(e) : resolve())));
});

function makeCommandBody(opts: { user_id: string; channel_id?: string; text?: string }): Record<string, unknown> {
  return {
    token: 'verification-token',
    team_id: 'T123',
    team_domain: 'test',
    channel_id: opts.channel_id ?? 'C123',
    channel_name: 'general',
    user_id: opts.user_id,
    user_name: 'tester',
    command: '/services',
    text: opts.text ?? '',
    api_app_id: 'A123',
    is_enterprise_install: 'false',
    response_url: `http://127.0.0.1:${String(respondServerPort)}/respond`,
    trigger_id: 'trigger-123',
  };
}

function buildHarness(): HarnessApp {
  const receiver = new TestReceiver();
  const app = new App({
    receiver,
    signingSecret: 'test-secret',
    // Bolt's default `authorize` calls auth.test against the Slack
    // API; provide a stub that returns a synthetic context so no real
    // network request is attempted.
    authorize: () => Promise.resolve({
      botToken: 'xoxb-test',
      botId: 'B_TEST',
      botUserId: 'U_BOT_TEST',
    }),
    tokenVerificationEnabled: false,
  }) as AppType;

  const handlerCalls = { count: 0 };

  app.use(authorizeMiddleware);
  app.use(rateLimitMiddleware);
  app.use(auditLogMiddleware);

  app.command('/services', async ({ ack }) => {
    await ack();
    handlerCalls.count++;
  });

  return {
    app,
    drive: async (body) => {
      const ack = vi.fn().mockResolvedValue(undefined);
      await receiver.drive({ body, ack });
    },
    handlerCalls,
  };
}

/** Poll the captured-respond array until the predicate matches, with a timeout. */
async function waitForRespondMatching<T>(
  predicate: (body: unknown) => body is T,
  timeoutMs = 1000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = capturedRespondBodies.find(predicate);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('No matching respond payload received within timeout');
}

describe('Slack command middleware harness (#352)', () => {
  let harness: HarnessApp;

  beforeEach(() => {
    mockUsers.clear();
    configChannelIds = [];
    capturedRespondBodies.length = 0;
    vi.mocked(logger.warn).mockClear();
    vi.mocked(logger.error).mockClear();
    // The rate-limit middleware's bucketStore is a module singleton;
    // clear every user the specs touch so test order can't leak state.
    for (const u of ['U_OK', 'U_UNKNOWN', 'U_INACTIVE', 'U_RATE', 'U_A', 'U_B', 'U_BAD']) {
      clearRateLimit(u);
    }
    harness = buildHarness();
  });

  describe('authorize middleware', () => {
    it('runs the handler when the user is in the store and active', async () => {
      mockUsers.set('U_OK', makeAuthorizedUser('U_OK'));
      await harness.drive(makeCommandBody({ user_id: 'U_OK' }));
      expect(harness.handlerCalls.count).toBe(1);
      expect(vi.mocked(logger.warn)).not.toHaveBeenCalled();
    });

    it('drops the request when the user is not in the store', async () => {
      // No mockUsers entry for U_UNKNOWN → silent rejection.
      await harness.drive(makeCommandBody({ user_id: 'U_UNKNOWN' }));
      expect(harness.handlerCalls.count).toBe(0);
      expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
        'Unauthorized user attempted command',
        expect.objectContaining({ userId: 'U_UNKNOWN' }),
      );
    });

    it('drops the request when the user is deactivated', async () => {
      mockUsers.set('U_INACTIVE', makeAuthorizedUser('U_INACTIVE', { isActive: false }));
      await harness.drive(makeCommandBody({ user_id: 'U_INACTIVE' }));
      expect(harness.handlerCalls.count).toBe(0);
      expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
        'Deactivated user attempted command',
        expect.objectContaining({ userId: 'U_INACTIVE' }),
      );
    });

    it('drops the request when the channel is not allowlisted', async () => {
      mockUsers.set('U_OK', makeAuthorizedUser('U_OK'));
      configChannelIds = ['C_ALLOWED'];
      await harness.drive(makeCommandBody({ user_id: 'U_OK', channel_id: 'C_OTHER' }));
      expect(harness.handlerCalls.count).toBe(0);
      expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
        'Command from unauthorized channel',
        expect.objectContaining({ channelId: 'C_OTHER' }),
      );
    });
  });

  describe('rate-limit middleware', () => {
    it('lets bursts through up to the configured max, blocks beyond it', async () => {
      mockUsers.set('U_RATE', makeAuthorizedUser('U_RATE'));
      // Mocked config above sets max=3. The first 3 succeed; the 4th
      // is blocked with a "Rate limit exceeded" warn.
      for (let i = 0; i < 3; i++) {
        await harness.drive(makeCommandBody({ user_id: 'U_RATE' }));
      }
      expect(harness.handlerCalls.count).toBe(3);

      await harness.drive(makeCommandBody({ user_id: 'U_RATE' }));
      expect(harness.handlerCalls.count).toBe(3);
      expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
        'Rate limit exceeded',
        expect.objectContaining({ userId: 'U_RATE', command: '/services' }),
      );
      // The rate-limit middleware sends an ephemeral "Rate limit exceeded"
      // message via respond(); the local capture server collected it.
      // Poll for the payload rather than sleeping a fixed delay — the
      // async POST timing is sensitive to load on slow CI runners.
      const rateLimitMessage = await waitForRespondMatching(
        (b): b is { text: string; response_type: string } =>
          typeof b === 'object' && b !== null && 'text' in b &&
          typeof (b as { text: unknown }).text === 'string' &&
          (b as { text: string }).text.includes('Rate limit exceeded'),
      );
      expect(rateLimitMessage.response_type).toBe('ephemeral');
    });

    it('per-user buckets are independent', async () => {
      mockUsers.set('U_A', makeAuthorizedUser('U_A'));
      mockUsers.set('U_B', makeAuthorizedUser('U_B'));
      for (let i = 0; i < 3; i++) {
        await harness.drive(makeCommandBody({ user_id: 'U_A' }));
      }
      // U_A is now at limit; U_B still has full quota.
      await harness.drive(makeCommandBody({ user_id: 'U_B' }));
      expect(harness.handlerCalls.count).toBe(4);
    });
  });

  describe('middleware ordering', () => {
    it('rate-limit does NOT consume a token when the user is unauthorized', async () => {
      // Replace the global mocks: U_BAD is unauthorized, so authorize
      // rejects first. If rate-limit ran ahead of authorize, the
      // unauth user could exhaust the bucket and blow up downstream
      // rate budgets. The middleware order in app.ts is authorize →
      // rate-limit → audit-log; this test pins that order.
      for (let i = 0; i < 10; i++) {
        await harness.drive(makeCommandBody({ user_id: 'U_BAD' }));
      }
      expect(harness.handlerCalls.count).toBe(0);
      // No "Rate limit exceeded" log — rate-limit never saw these.
      const warnCalls = vi.mocked(logger.warn).mock.calls;
      const rateLimitCalls = warnCalls.filter((c) => c[0] === 'Rate limit exceeded');
      expect(rateLimitCalls).toHaveLength(0);
    });
  });
});

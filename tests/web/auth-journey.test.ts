/**
 * End-to-end auth journey test (real SQLite, no store mocks).
 *
 * Walks the full user-accounts chain that shipped across #270, #272,
 * #273, #275, #277, and #279 — invite → register → logout → password
 * login → conversation scoping — against a real Express app and a real
 * SQLite database. Each link is unit-tested in isolation elsewhere; this
 * test pins the seams between them.
 *
 * What's mocked: only the config module (so we can point at a temp DB)
 * and the logger (to keep test output clean). The user store, invite
 * store, session store, and conversation store all run for real.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import Database from 'better-sqlite3';
import type * as PathType from 'path';
import type * as OsType from 'os';
import type { WebConfig } from '../../src/config/schema.js';

// `vi.hoisted` runs alongside the hoisted vi.mock factories, so the
// temp path computed here is available inside them. We can't use the
// top-level `path`/`os` imports — those bindings aren't initialized
// when `vi.hoisted` runs — so use `require` directly.
const { TEMP_DB, PORT, baseUrl } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const _path = require('path') as typeof PathType;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const _os = require('os') as typeof OsType;
  const _stamp = `${String(Date.now())}-${String(process.pid)}-${String(Math.random()).slice(2, 8)}`;
  const _port = 18927;
  return {
    TEMP_DB: _path.join(_os.tmpdir(), `auth-journey-${_stamp}.db`),
    PORT: _port,
    baseUrl: `http://localhost:${String(_port)}`,
  };
});

vi.mock('../../src/config/index.js', () => ({
  config: {
    claude: {
      enabled: true,
      dbPath: TEMP_DB,
      conversationTtlHours: 24,
      maxToolCalls: 100,
      maxIterations: 50,
      contextWindowTokens: 200000,
      contextTruncationThreshold: 0.8,
      contextWarningThreshold: 0.7,
      cliTimeoutMs: 60_000,
    },
    web: {
      enabled: true,
      port: PORT,
      baseUrl,
      authToken: 'test-auth-token-minimum16',
      linkTokenTtlMinutes: 15,
      sessionTtlHours: 72,
      registrationEnabled: true,
    },
    authorization: { userIds: [], channelIds: [] },
    rateLimit: { max: 10, windowSeconds: 60, commands: {} },
    server: { dockerSocket: '/var/run/docker.sock', monitoredServices: [], sslDomains: [], maxLogLines: 50, backupDirs: [] },
    logging: { level: 'info' },
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../src/services/socket-mode-status.js', () => ({
  getSocketModeStatus: vi.fn(() => ({ connected: true })),
}));

vi.mock('../../src/services/conversation-processor.js', () => ({
  processConversationTurn: vi.fn(async () => { /* noop */ }),
}));

vi.mock('../../src/services/server-health.js', () => ({
  getServerHealth: vi.fn(async () => null),
}));

vi.mock('../../src/plugins/loader.js', () => ({
  getPluginWidgets: vi.fn(() => []),
}));

vi.mock('../../src/services/claude-rate-limit.js', () => ({
  checkAndRecordClaudeRequest: vi.fn(() => true),
}));

import { startWebServer, stopWebServer } from '../../src/web/server.js';
import { getUserStore, closeUserStore } from '../../src/services/user-store.js';
import { getInviteStore, closeInviteStore } from '../../src/services/invite-store.js';
import { getSessionStore, closeSessionStore } from '../../src/services/session-store.js';
import { getConversationStore } from '../../src/services/conversation-store.js';
import { _resetAuthRateLimits } from '../../src/services/auth-rate-limit.js';

const webConfig: WebConfig = {
  enabled: true,
  port: PORT,
  baseUrl,
  authToken: 'test-auth-token-minimum16',
  linkTokenTtlMinutes: 15,
  sessionTtlHours: 72,
  registrationEnabled: true,
};

interface CookieJar {
  cookie: string;
}

/**
 * Capture the Set-Cookie header(s) from a response into a jar.
 *
 * `headers.getSetCookie()` (Node 20+) returns one entry per Set-Cookie
 * header — splitting on `,` would break on `Expires=Thu, 01 Jan ...`
 * dates. We extract just the `name=value` pair before the first `;`
 * (attributes like `Max-Age`, `HttpOnly`, etc. live in the response
 * header, not in the request cookie we send back).
 *
 * For each name we keep at most one value in the jar, replacing on
 * duplicate to mirror browser behavior.
 */
function captureSetCookie(res: Response, jar: CookieJar): void {
  const setCookies = res.headers.getSetCookie();
  if (setCookies.length === 0) return;
  const map = new Map<string, string>();
  // Seed with existing jar contents.
  for (const pair of jar.cookie.split(';').map((p) => p.trim()).filter(Boolean)) {
    const eq = pair.indexOf('=');
    if (eq > 0) map.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  for (const raw of setCookies) {
    const firstAttr = raw.split(';')[0] ?? '';
    const eq = firstAttr.indexOf('=');
    if (eq <= 0) continue;
    map.set(firstAttr.slice(0, eq), firstAttr.slice(eq + 1));
  }
  jar.cookie = Array.from(map.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
}

/** Send a request including the cookie jar and capture any new cookie. */
async function send(
  jar: CookieJar,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (jar.cookie) headers.set('Cookie', jar.cookie);
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
    redirect: 'manual',
  });
  captureSetCookie(res, jar);
  return res;
}

function postForm(jar: CookieJar, path: string, body: Record<string, string>): Promise<Response> {
  return send(jar, path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
}

function cleanupDbFiles(): void {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEMP_DB + suffix); } catch { /* ok */ }
  }
}

describe('auth journey (real SQLite, no store mocks)', () => {
  beforeAll(async () => {
    cleanupDbFiles();
    // Force-init every store so schemas exist before the first test
    // tries to truncate. The web server itself initializes most stores
    // lazily inside route handlers, so we have to nudge them awake here.
    getUserStore(TEMP_DB);
    getInviteStore(TEMP_DB);
    getSessionStore(TEMP_DB, webConfig.sessionTtlHours);
    getConversationStore(TEMP_DB, 24);
    await startWebServer(webConfig);
  });

  afterAll(async () => {
    await stopWebServer();
    closeSessionStore();
    closeInviteStore();
    closeUserStore();
    cleanupDbFiles();
  });

  beforeEach(() => {
    _resetAuthRateLimits();
    // Clean tables between tests so seeded state from one doesn't bleed
    // into the next. SessionStore doesn't expose `getDatabase()`, so use
    // a sidecar Database connection on the same file (better-sqlite3 is
    // safe with multiple connections via WAL).
    const sidecar = new Database(TEMP_DB);
    sidecar.exec(`
      DELETE FROM users;
      DELETE FROM invite_codes;
      DELETE FROM web_sessions;
      DELETE FROM conversation_tags;
      DELETE FROM tool_calls;
      DELETE FROM conversations;
    `);
    sidecar.close();
  });

  it('full journey: admin mints invite → user registers → logs out → logs in via password → sees only own conversations', async () => {
    const userStore = getUserStore(TEMP_DB);
    const inviteStore = getInviteStore(TEMP_DB);
    const sessionStore = getSessionStore(TEMP_DB, webConfig.sessionTtlHours);
    const convStore = getConversationStore(TEMP_DB, 24);

    // 1. Seed an admin and start an authenticated session for them.
    const admin = await userStore.create({ slackId: 'U01ADMIN', role: 'admin', displayName: 'Root' });
    const adminSession = sessionStore.createSession('U01ADMIN', true);
    const adminJar: CookieJar = { cookie: `ssm_session=${adminSession.sessionId}` };

    // 2. Admin mints an invite via the web form.
    const mintRes = await postForm(adminJar, '/admin/invites', {
      role: 'user',
      ttl_hours: '24',
    });
    expect(mintRes.status).toBe(302);
    expect(mintRes.headers.get('location')).toContain('/admin/users');
    const activeInvites = inviteStore.listActive();
    expect(activeInvites).toHaveLength(1);
    expect(activeInvites[0].createdBy).toBe(admin.id);
    expect(activeInvites[0].role).toBe('user');
    const inviteCode = activeInvites[0].code;

    // 3. New unauthenticated session loads the register form with the
    //    invite code prefilled from the query param.
    const userJar: CookieJar = { cookie: '' };
    const regForm = await send(userJar, `/register?invite=${inviteCode}`);
    expect(regForm.status).toBe(200);
    const regHtml = await regForm.text();
    expect(regHtml).toContain(`value="${inviteCode}"`);

    // 4. User submits the register form. Real userStore.create runs; real
    //    inviteStore.redeemInvite runs; real sessionStore.createSession runs.
    const registerRes = await postForm(userJar, '/register', {
      invite: inviteCode,
      username: 'alice',
      password: 'long-enough-pw',
      confirm_password: 'long-enough-pw',
    });
    expect(registerRes.status).toBe(302);
    expect(registerRes.headers.get('location')).toBe('/');
    // Cookie was set on the user's jar.
    expect(userJar.cookie).toMatch(/ssm_session=[a-f0-9]{64}/);
    // Real DB state: user exists with the right shape.
    const aliceRow = userStore.getByUsername('alice');
    expect(aliceRow).not.toBeNull();
    expect(aliceRow?.role).toBe('user');
    expect(aliceRow?.isActive).toBe(true);
    // Invite is consumed.
    const consumed = inviteStore.getInvite(inviteCode);
    expect(consumed?.usedAt).not.toBeNull();
    expect(consumed?.usedBy).toBe(aliceRow?.id);

    // 5. User logs out — cookie is cleared AND the session row is
    // deleted from the store. We assert the server-side deletion
    // directly (HTTP 401 alone could come from a cleared cookie too).
    const oldSessionMatch = /ssm_session=([a-f0-9]{64})/.exec(userJar.cookie);
    expect(oldSessionMatch).not.toBeNull();
    const oldSessionId = oldSessionMatch?.[1] ?? '';
    expect(sessionStore.getSession(oldSessionId)).not.toBeNull();

    const logoutRes = await postForm(userJar, '/logout', {});
    expect(logoutRes.status).toBe(302);
    expect(logoutRes.headers.get('location')).toBe('/login');

    // Direct store-level proof: the session row is gone, not just
    // expired or cookie-cleared.
    expect(sessionStore.getSession(oldSessionId)).toBeNull();

    // Belt + suspenders: replaying the old cookie against /c also fails.
    const stale = await fetch(`${baseUrl}/c`, {
      headers: { Cookie: `ssm_session=${oldSessionId}` },
      redirect: 'manual',
    });
    expect(stale.status).toBe(401);
    userJar.cookie = '';

    // 6. User logs back in with username + password.
    const loginRes = await postForm(userJar, '/login', {
      username: 'alice',
      password: 'long-enough-pw',
    });
    expect(loginRes.status).toBe(302);
    expect(loginRes.headers.get('location')).toBe('/');
    expect(userJar.cookie).toMatch(/ssm_session=[a-f0-9]{64}/);

    // 7. Seed two conversations: one owned by Alice (web identity), one
    //    owned by some other Slack user. The scoping path should hide the
    //    second from Alice but show the first.
    convStore.createConversation('1700000000.001', 'C001', 'web:alice', [
      { role: 'user', content: 'alice asks about nginx logs' },
    ]);
    convStore.createConversation('1700000000.002', 'C001', 'U99OTHER', [
      { role: 'user', content: 'someone else asks about postgres' },
    ]);

    // 8. GET /c with Alice's session — assert only her conversation appears.
    const listRes = await send(userJar, '/c');
    expect(listRes.status).toBe(200);
    const listHtml = await listRes.text();
    expect(listHtml).toContain('alice asks about nginx logs');
    expect(listHtml).not.toContain('someone else asks about postgres');
  });

  it('static admin token still logs in via the form', async () => {
    const adminJar: CookieJar = { cookie: '' };
    const res = await postForm(adminJar, '/login', {
      token: 'test-auth-token-minimum16',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/');
    expect(adminJar.cookie).toMatch(/ssm_session=[a-f0-9]{64}/);
    // Hitting /admin/users with this session should succeed.
    const adminPage = await send(adminJar, '/admin/users');
    expect(adminPage.status).toBe(200);
  });

  it('deactivated user cannot log in', async () => {
    const userStore = getUserStore(TEMP_DB);
    const u = await userStore.create({
      username: 'bob',
      password: 'long-enough-pw',
    });
    userStore.deactivate(u.id);

    const jar: CookieJar = { cookie: '' };
    const res = await postForm(jar, '/login', {
      username: 'bob',
      password: 'long-enough-pw',
    });
    expect(res.status).toBe(401);
    // No session cookie issued.
    expect(jar.cookie).toBe('');
  });

  it('invite cannot be redeemed twice — second register attempt fails', async () => {
    const userStore = getUserStore(TEMP_DB);
    const inviteStore = getInviteStore(TEMP_DB);
    const admin = await userStore.create({ slackId: 'U01ADMIN', role: 'admin' });
    const invite = inviteStore.createInvite(admin.id, { role: 'user', ttlHours: 24 });

    // First user registers successfully.
    const firstJar: CookieJar = { cookie: '' };
    const firstRes = await postForm(firstJar, '/register', {
      invite: invite.code,
      username: 'first-claimer',
      password: 'long-enough-pw',
      confirm_password: 'long-enough-pw',
    });
    expect(firstRes.status).toBe(302);

    // Second user tries the same code.
    const secondJar: CookieJar = { cookie: '' };
    const secondRes = await postForm(secondJar, '/register', {
      invite: invite.code,
      username: 'second-claimer',
      password: 'long-enough-pw',
      confirm_password: 'long-enough-pw',
    });
    expect(secondRes.status).toBe(400);
    const body = await secondRes.text();
    expect(body).toMatch(/invalid, expired, or already used/i);
    // No second user was created.
    expect(userStore.getByUsername('second-claimer')).toBeNull();
  });

  it('concurrent register POSTs for the same invite — exactly one user is created, the other rolls back (×5 reps)', async () => {
    const userStore = getUserStore(TEMP_DB);
    const inviteStore = getInviteStore(TEMP_DB);
    const admin = await userStore.create({ slackId: 'U01ADMIN', role: 'admin' });

    // The race-loss rollback path only fires if both requests clear the
    // peek-invite check before either does the atomic redeem. On a
    // fast loopback that's not guaranteed to happen on every rep —
    // depending on scrypt timing, requests may serialize naturally and
    // the second one fails at the peek with a different error. We run
    // multiple reps and assert the invariants on every rep; we ALSO
    // track how many reps exercised each path so a future regression
    // that breaks rollback won't hide behind always-serializing reps.
    const REPS = 5;
    const pathCounts = { rollback: 0, peekFailed: 0 };

    for (let i = 0; i < REPS; i++) {
      const invite = inviteStore.createInvite(admin.id, { role: 'user', ttlHours: 24 });
      const userA = `racer-a-${String(i)}`;
      const userB = `racer-b-${String(i)}`;
      const jarA: CookieJar = { cookie: '' };
      const jarB: CookieJar = { cookie: '' };

      const [resA, resB] = await Promise.all([
        postForm(jarA, '/register', { invite: invite.code, username: userA, password: 'long-enough-pw', confirm_password: 'long-enough-pw' }),
        postForm(jarB, '/register', { invite: invite.code, username: userB, password: 'long-enough-pw', confirm_password: 'long-enough-pw' }),
      ]);

      // Per-rep invariants: one success, one failure, one user, one consumption.
      const successes = [resA, resB].filter((r) => r.status === 302);
      const failures = [resA, resB].filter((r) => r.status === 400);
      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);

      const racerA = userStore.getByUsername(userA);
      const racerB = userStore.getByUsername(userB);
      const created = [racerA, racerB].filter((u) => u !== null);
      expect(created).toHaveLength(1);

      const after = inviteStore.getInvite(invite.code);
      expect(after?.usedAt).not.toBeNull();
      expect(after?.usedBy).toBe(created[0]?.id);

      // Classify the path the loser took. Body says either:
      //   - "Invite code was just consumed" → rollback path (both
      //     passed peek + create, atomic redeem decided the winner).
      //   - "invalid, expired, or already used" → peek-failed path
      //     (loser arrived after winner's redeem committed).
      const loserBody = await failures[0].text();
      if (/just consumed/i.test(loserBody)) pathCounts.rollback++;
      else if (/invalid, expired, or already used/i.test(loserBody)) pathCounts.peekFailed++;
    }

    // We don't require a specific split — both paths produce correct
    // outcomes, and which one fires is timing-dependent. But the sum
    // must equal REPS, proving every rep was correctly classified and
    // no third unexpected failure mode crept in.
    expect(pathCounts.rollback + pathCounts.peekFailed).toBe(REPS);
  });

  it('non-admin web user cannot reach /admin/users', async () => {
    const userStore = getUserStore(TEMP_DB);
    const sessionStore = getSessionStore(TEMP_DB, webConfig.sessionTtlHours);
    await userStore.create({ username: 'carol', password: 'long-enough-pw', role: 'user' });
    const session = sessionStore.createSession('web:carol', false);
    const jar: CookieJar = { cookie: `ssm_session=${session.sessionId}` };

    const res = await send(jar, '/admin/users');
    expect(res.status).toBe(403);
  });
});

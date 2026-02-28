import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import type { Server } from 'http';
import path from 'path';
import fs from 'fs';
import os from 'os';

// Mock the logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { resolveToken, parseCookies } from '../../src/web/auth.js';
import { SessionStore } from '../../src/services/session-store.js';
import { renderLogin, render401, render404 } from '../../src/web/templates.js';
import type { WebConfig } from '../../src/config/schema.js';

const SESSION_COOKIE = 'ssm_session';

const webConfig: WebConfig = {
  enabled: true,
  port: 0,
  baseUrl: 'http://test.local:8080',
  authToken: 'admin-token-minimum-16-chars',
  userTokens: [
    { userId: 'U01ABC123', token: 'user1-token-minimum16' },
    { userId: 'U02DEF456', token: 'user2-token-minimum16' },
  ],
  sessionTtlHours: 72,
};

/**
 * Build the auth middleware inline (mirrors server.ts logic)
 * so we can test it with a real SessionStore and temp database
 */
function createAuthTestServer(sessionStore: SessionStore) {
  const app = express();
  app.use(express.urlencoded({ extended: false }));

  // Security headers
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'private, no-cache');
    next();
  });

  // Health check (no auth)
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  // Login page
  app.get('/login', (req: Request, res: Response) => {
    const returnTo = typeof req.query.return_to === 'string' ? req.query.return_to : undefined;
    res.type('html').send(renderLogin(undefined, returnTo));
  });

  // Login form submission
  app.post('/login', (req: Request, res: Response) => {
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    const returnTo = typeof req.body?.return_to === 'string' ? req.body.return_to : undefined;

    const identity = resolveToken(token, webConfig);
    if (!identity) {
      res.status(401).type('html').send(renderLogin('Invalid token.', returnTo));
      return;
    }

    const session = sessionStore.createSession(identity.userId, identity.isAdmin);
    const maxAge = webConfig.sessionTtlHours * 60 * 60;
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${session.sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${String(maxAge)}`);
    const redirectTo = returnTo && returnTo.startsWith('/') ? returnTo : '/';
    res.redirect(302, redirectTo);
  });

  // Logout
  app.post('/logout', (req: Request, res: Response) => {
    const cookies = parseCookies(req.headers.cookie);
    const sessionId = cookies[SESSION_COOKIE];
    if (sessionId) {
      sessionStore.deleteSession(sessionId);
    }
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
    res.redirect(302, '/login');
  });

  // Session auth middleware for /c routes
  app.use('/c', (req: Request, res: Response, next: NextFunction) => {
    // 1. Check session cookie
    const cookies = parseCookies(req.headers.cookie);
    const sessionId = cookies[SESSION_COOKIE];
    if (sessionId) {
      const session = sessionStore.getSession(sessionId);
      if (session) {
        res.locals.userId = session.userId;
        res.locals.isAdmin = session.isAdmin;
        next();
        return;
      }
      // Expired/invalid cookie — clear it
      res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
    }

    // 2. Check query param token
    const queryToken = req.query.token;
    if (typeof queryToken === 'string' && queryToken) {
      const identity = resolveToken(queryToken, webConfig);
      if (identity) {
        const session = sessionStore.createSession(identity.userId, identity.isAdmin);
        const maxAge = webConfig.sessionTtlHours * 60 * 60;
        res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${session.sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${String(maxAge)}`);
        // Redirect to strip token from URL
        const url = new URL(req.originalUrl, `http://${req.headers.host ?? 'localhost'}`);
        url.searchParams.delete('token');
        const cleanPath = url.pathname + (url.search || '');
        res.redirect(302, cleanPath);
        return;
      }
    }

    // 3. Unauthorized
    res.status(401).send(render401(req.originalUrl));
  });

  // Protected conversation route
  app.get('/c/:threadTs/:channelId', (req: Request, res: Response) => {
    res.json({
      threadTs: req.params.threadTs,
      channelId: req.params.channelId,
      userId: res.locals.userId as string,
      isAdmin: res.locals.isAdmin as boolean,
    });
  });

  // 404
  app.use((_req: Request, res: Response) => {
    res.status(404).send(render404());
  });

  return app;
}

/**
 * Extract Set-Cookie value from response headers
 */
function getSetCookie(response: globalThis.Response): string | null {
  return response.headers.get('set-cookie');
}

/**
 * Extract session ID from Set-Cookie header
 */
function extractSessionId(setCookie: string | null): string | null {
  if (!setCookie) return null;
  const match = setCookie.match(/ssm_session=([^;]+)/);
  return match ? match[1] : null;
}

describe('web server auth integration', () => {
  let server: Server;
  let baseUrl: string;
  let sessionStore: SessionStore;
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-test-'));
    const dbPath = path.join(tmpDir, 'test.db');
    sessionStore = new SessionStore(dbPath, 72);

    const app = createAuthTestServer(sessionStore);
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          baseUrl = `http://localhost:${String(addr.port)}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    sessionStore.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('unauthenticated access', () => {
    it('should return 401 for protected routes without auth', async () => {
      const response = await fetch(`${baseUrl}/c/1234.5678/C123ABC`, { redirect: 'manual' });
      expect(response.status).toBe(401);
      const text = await response.text();
      expect(text).toContain('401');
    });

    it('should return 401 for invalid token', async () => {
      const response = await fetch(`${baseUrl}/c/1234.5678/C123ABC?token=invalid-token-value1`, { redirect: 'manual' });
      expect(response.status).toBe(401);
    });

    it('should allow health endpoint without auth', async () => {
      const response = await fetch(`${baseUrl}/health`);
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json).toEqual({ status: 'ok' });
    });

    it('should serve login page without auth', async () => {
      const response = await fetch(`${baseUrl}/login`);
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain('Server Monitor');
      expect(text).toContain('Access Token');
    });
  });

  describe('token-to-session upgrade (link from Slack)', () => {
    it('should create session and redirect when using admin token', async () => {
      const response = await fetch(
        `${baseUrl}/c/1234.5678/C123ABC?token=${webConfig.authToken}`,
        { redirect: 'manual' },
      );

      expect(response.status).toBe(302);
      // Should redirect to URL without token
      const location = response.headers.get('location');
      expect(location).toBe('/c/1234.5678/C123ABC');

      // Should set session cookie
      const setCookie = getSetCookie(response);
      expect(setCookie).toContain(SESSION_COOKIE);
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('SameSite=Lax');

      const sessionId = extractSessionId(setCookie);
      expect(sessionId).toBeTruthy();
      expect(sessionId).not.toBe('');
    });

    it('should create session with per-user token', async () => {
      const response = await fetch(
        `${baseUrl}/c/1234.5678/C123ABC?token=user1-token-minimum16`,
        { redirect: 'manual' },
      );

      expect(response.status).toBe(302);

      const setCookie = getSetCookie(response);
      const sessionId = extractSessionId(setCookie);
      expect(sessionId).toBeTruthy();

      // Verify the session maps to the correct user
      expect(sessionId).toBeTruthy();
      const session = sessionStore.getSession(sessionId ?? '');
      expect(session).not.toBeNull();
      expect(session?.userId).toBe('U01ABC123');
      expect(session?.isAdmin).toBe(false);
    });

    it('should set admin flag for admin token sessions', async () => {
      const response = await fetch(
        `${baseUrl}/c/1234.5678/C123ABC?token=${webConfig.authToken}`,
        { redirect: 'manual' },
      );

      const setCookie = getSetCookie(response);
      const sessionId = extractSessionId(setCookie);

      expect(sessionId).toBeTruthy();
      const session = sessionStore.getSession(sessionId ?? '');
      expect(session?.userId).toBe('admin');
      expect(session?.isAdmin).toBe(true);
    });
  });

  describe('session cookie auth', () => {
    it('should authenticate with valid session cookie', async () => {
      // Create a session directly
      const session = sessionStore.createSession('UTESTUSER', false);

      const response = await fetch(`${baseUrl}/c/1234.5678/C123ABC`, {
        headers: { Cookie: `${SESSION_COOKIE}=${session.sessionId}` },
      });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.userId).toBe('UTESTUSER');
      expect(json.isAdmin).toBe(false);
    });

    it('should pass admin flag through for admin sessions', async () => {
      const session = sessionStore.createSession('UADMIN', true);

      const response = await fetch(`${baseUrl}/c/1234.5678/C123ABC`, {
        headers: { Cookie: `${SESSION_COOKIE}=${session.sessionId}` },
      });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.userId).toBe('UADMIN');
      expect(json.isAdmin).toBe(true);
    });

    it('should reject expired session cookie', async () => {
      // Test with a non-existent session ID (simulates expired/invalid session)
      const response = await fetch(`${baseUrl}/c/1234.5678/C123ABC`, {
        headers: { Cookie: `${SESSION_COOKIE}=nonexistent-session-id-value` },
        redirect: 'manual',
      });

      expect(response.status).toBe(401);

      // Should clear the invalid cookie
      const setCookie = getSetCookie(response);
      expect(setCookie).toContain('Max-Age=0');
    });

    it('should reject invalid session ID', async () => {
      const response = await fetch(`${baseUrl}/c/1234.5678/C123ABC`, {
        headers: { Cookie: `${SESSION_COOKIE}=totally-invalid-session` },
        redirect: 'manual',
      });

      expect(response.status).toBe(401);
    });
  });

  describe('login flow', () => {
    it('should render login page with return_to', async () => {
      const response = await fetch(`${baseUrl}/login?return_to=/c/1234.5678/C123ABC`);
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain('return_to');
      expect(text).toContain('/c/1234.5678/C123ABC');
    });

    it('should create session on valid login', async () => {
      const response = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `token=user1-token-minimum16`,
        redirect: 'manual',
      });

      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('/');

      const setCookie = getSetCookie(response);
      expect(setCookie).toContain(SESSION_COOKIE);
      const sessionId = extractSessionId(setCookie);
      expect(sessionId).toBeTruthy();

      expect(sessionId).toBeTruthy();
      const session = sessionStore.getSession(sessionId ?? '');
      expect(session?.userId).toBe('U01ABC123');
    });

    it('should redirect to return_to after login', async () => {
      const response = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `token=user2-token-minimum16&return_to=/c/1234.5678/C123ABC`,
        redirect: 'manual',
      });

      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('/c/1234.5678/C123ABC');
    });

    it('should reject login with invalid token', async () => {
      const response = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `token=invalid-token-value1`,
        redirect: 'manual',
      });

      expect(response.status).toBe(401);
      const text = await response.text();
      expect(text).toContain('Invalid token');
    });

    it('should reject login with empty token', async () => {
      const response = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `token=`,
        redirect: 'manual',
      });

      expect(response.status).toBe(401);
    });

    it('should not redirect to external URLs after login', async () => {
      const response = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `token=${webConfig.authToken}&return_to=https://evil.com`,
        redirect: 'manual',
      });

      expect(response.status).toBe(302);
      // Should redirect to / instead of external URL
      expect(response.headers.get('location')).toBe('/');
    });
  });

  describe('logout flow', () => {
    it('should delete session and clear cookie on logout', async () => {
      // Create a session first
      const session = sessionStore.createSession('UTESTUSER', false);

      const response = await fetch(`${baseUrl}/logout`, {
        method: 'POST',
        headers: { Cookie: `${SESSION_COOKIE}=${session.sessionId}` },
        redirect: 'manual',
      });

      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('/login');

      // Cookie should be cleared
      const setCookie = getSetCookie(response);
      expect(setCookie).toContain('Max-Age=0');

      // Session should be deleted
      const deletedSession = sessionStore.getSession(session.sessionId);
      expect(deletedSession).toBeNull();
    });

    it('should handle logout without session cookie gracefully', async () => {
      const response = await fetch(`${baseUrl}/logout`, {
        method: 'POST',
        redirect: 'manual',
      });

      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('/login');
    });
  });
});

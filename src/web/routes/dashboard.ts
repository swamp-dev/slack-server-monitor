import express, { type Request, type Response, type NextFunction, type Router } from 'express';
import type { Config, WebConfig } from '../../config/schema.js';
import { getSocketModeStatus } from '../../services/socket-mode-status.js';
import { getConversationStore } from '../../services/conversation-store.js';
import { getSessionStore } from '../../services/session-store.js';
import { getUserStore } from '../../services/user-store.js';
import { getInviteStore } from '../../services/invite-store.js';
import { isAuthHitAllowed, recordAuthFailure } from '../../services/auth-rate-limit.js';
import { resolveTokenWithRole, resolveUserPassword, parseCookies, createLinkToken } from '../auth.js';
import { getNotificationStore } from '../../services/notification-store.js';
import { getQuickLinksStore } from '../../services/quick-links-store.js';
import { getServerHealth } from '../../services/server-health.js';
import { getPluginWidgets } from '../../plugins/loader.js';
import { logger } from '../../utils/logger.js';
import {
  renderDashboard,
  renderLogin,
  renderRegister,
  renderError,
  render404,
} from '../templates/index.js';
import { getStaticCss } from '../templates/styles.js';
import {
  SESSION_COOKIE,
  buildCookieOptions,
  optionalAuthMiddleware,
  getUserFilterIds,
} from '../middleware/auth.js';
import { attachTags } from './helpers.js';

type ClaudeConfig = NonNullable<Config['claude']>;

export function createDashboardRouter(
  claudeConfig: ClaudeConfig,
  webConfig: WebConfig,
  dbPath: string,
): Router {
  const router = express.Router();

  // Health check (no auth required). Returns 200 when Socket Mode is connected,
  // 503 when disconnected. Used by Docker HEALTHCHECK.
  router.get('/health', (_req: Request, res: Response) => {
    const socketMode = getSocketModeStatus();
    const status = socketMode.connected ? 'ok' : 'degraded';
    const statusCode = socketMode.connected ? 200 : 503;
    res.status(statusCode).json({ status, socketMode });
  });

  // PWA manifest (no auth, cacheable)
  router.get('/manifest.json', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.json({
      name: 'Server Monitor',
      short_name: 'SSM',
      description: 'AI-powered server diagnostics',
      start_url: '/',
      display: 'standalone',
      background_color: '#282a36',
      theme_color: '#282a36',
      icons: [
        {
          src:
            'data:image/svg+xml,' +
            encodeURIComponent(
              '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="#ff79c6" stroke-width="1.5"><rect x="4" y="6" width="12" height="10" rx="2"/><circle cx="7.5" cy="11" r="1.5"/><circle cx="12.5" cy="11" r="1.5"/><path d="M10 2v4M6 6V4M14 6V4"/></svg>',
            ),
          sizes: 'any',
          type: 'image/svg+xml',
        },
      ],
    });
  });

  // Static CSS bundle (no auth, aggressively cached)
  router.get('/static/styles.css', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/css; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(getStaticCss());
  });

  // Login page
  router.get('/login', (req: Request, res: Response) => {
    const returnTo = typeof req.query.return_to === 'string' ? req.query.return_to : undefined;
    res.type('html').send(renderLogin(undefined, returnTo, webConfig.registrationEnabled));
  });

  // Login form submission. Accepts either:
  //   - `username` + `password`  → resolveUserPassword (web account flow)
  //   - `token`                  → resolveTokenWithRole (HMAC link / static admin)
  // If both are sent, username/password takes precedence.
  router.post('/login', (req: Request, res: Response, next: NextFunction) => {
    (async () => {
      const body = req.body as Record<string, unknown>;
      const username = typeof body.username === 'string' ? body.username.trim() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const token = typeof body.token === 'string' ? body.token : '';
      const returnTo = typeof body.return_to === 'string' ? body.return_to : undefined;
      const ip = req.ip ?? '0.0.0.0';

      if (!isAuthHitAllowed('login', ip)) {
        logger.warn('Login rate-limited', { ip });
        res
          .status(429)
          .type('html')
          .send(
            renderLogin(
              'Too many attempts. Try again in a few minutes.',
              returnTo,
              webConfig.registrationEnabled,
            ),
          );
        return;
      }

      const userStore = getUserStore(dbPath);
      let identity: { userId: string; isAdmin: boolean } | null = null;
      if (username && password) {
        identity = await resolveUserPassword(username, password, userStore);
      } else if (token) {
        identity = await resolveTokenWithRole(token, webConfig, userStore);
      }

      if (!identity) {
        recordAuthFailure('login', ip);
        logger.warn('Failed login attempt', {
          ip,
          hasUsername: Boolean(username),
          hasToken: Boolean(token),
        });
        res
          .status(401)
          .type('html')
          .send(renderLogin('Invalid credentials.', returnTo, webConfig.registrationEnabled));
        return;
      }

      const sessionStore = getSessionStore(dbPath, webConfig.sessionTtlHours);
      sessionStore.deleteSessionsForUser(identity.userId);
      const session = sessionStore.createSession(identity.userId, identity.isAdmin);
      const maxAge = webConfig.sessionTtlHours * 60 * 60;
      res.setHeader(
        'Set-Cookie',
        `${SESSION_COOKIE}=${session.sessionId}; ${buildCookieOptions(webConfig, maxAge)}`,
      );

      logger.info('User logged in via form', {
        userId: identity.userId,
        isAdmin: identity.isAdmin,
      });

      // Only allow same-origin redirect paths: must start with `/` but NOT `//`
      // (protocol-relative → external host) or `/\` (Windows-path coercion).
      const redirectTo =
        returnTo &&
        returnTo.startsWith('/') &&
        !returnTo.startsWith('//') &&
        !returnTo.startsWith('/\\')
          ? returnTo
          : '/';
      res.redirect(302, redirectTo);
    })().catch(next);
  });

  // Registration page — 404 when disabled to avoid leaking route existence.
  router.get('/register', (req: Request, res: Response) => {
    if (!webConfig.registrationEnabled) {
      res.status(404).send(render404());
      return;
    }
    const inviteCode = typeof req.query.invite === 'string' ? req.query.invite : undefined;
    res.type('html').send(renderRegister(undefined, { inviteCode }));
  });

  // Registration form submission.
  router.post('/register', (req: Request, res: Response, next: NextFunction) => {
    if (!webConfig.registrationEnabled) {
      res.status(404).send(render404());
      return;
    }
    (async () => {
      const body = req.body as Record<string, unknown>;
      const inviteCode = typeof body.invite === 'string' ? body.invite.trim() : '';
      const username = typeof body.username === 'string' ? body.username.trim() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const confirm = typeof body.confirm_password === 'string' ? body.confirm_password : '';
      const ip = req.ip ?? '0.0.0.0';

      const reject = (status: number, message: string): void => {
        res.status(status).type('html').send(renderRegister(message, { inviteCode, username }));
      };

      if (!isAuthHitAllowed('register', ip)) {
        logger.warn('Register rate-limited', { ip });
        reject(429, 'Too many attempts. Try again in a few minutes.');
        return;
      }

      if (!inviteCode || !username || !password) {
        recordAuthFailure('register', ip);
        reject(400, 'All fields are required.');
        return;
      }
      if (password !== confirm) {
        recordAuthFailure('register', ip);
        reject(400, 'Passwords do not match.');
        return;
      }
      if (password.length < 8) {
        recordAuthFailure('register', ip);
        reject(400, 'Password must be at least 8 characters.');
        return;
      }

      const userStore = getUserStore(dbPath);
      const inviteStore = getInviteStore(dbPath);

      // Pre-flight: peek invite before expensive work. Atomicity comes from
      // redeemInvite below; we peek here for a friendly error on the common cases.
      const peek = inviteStore.getInvite(inviteCode);
      if (!peek) {
        recordAuthFailure('register', ip);
        logger.warn('Register attempted with unknown invite', { ip });
        reject(400, 'Invite code is invalid, expired, or already used.');
        return;
      }
      if (peek.usedAt !== null || peek.expiresAt <= Date.now()) {
        recordAuthFailure('register', ip);
        logger.warn('Register attempted with used or expired invite', { ip });
        reject(400, 'Invite code is invalid, expired, or already used.');
        return;
      }

      // Atomicity note: create user → redeem invite is not transactional across
      // two stores. If the process crashes between steps, a stranded user row exists.
      // Recovery: admin removes via `npm run manage-users delete-user`. Acceptable
      // for home-server deployment.
      let user;
      try {
        user = await userStore.create({
          username,
          password,
          slackId: peek.slackUserId ?? undefined,
          role: peek.role,
        });
      } catch (err) {
        recordAuthFailure('register', ip);
        logger.warn('Register validation failed', {
          ip,
          message: err instanceof Error ? err.message : String(err),
        });
        reject(400, 'Username or password did not pass validation.');
        return;
      }

      // Atomic redeem — lose the race → roll back the created user so the invite
      // isn't burned and the username isn't squatted.
      const redeemed = inviteStore.redeemInvite(inviteCode, user.id);
      if (!redeemed) {
        userStore.deleteById(user.id);
        recordAuthFailure('register', ip);
        logger.warn('Lost invite redeem race; rolled back created user', {
          ip,
          userId: user.id,
        });
        reject(400, 'Invite code was just consumed. Please request a new one.');
        return;
      }

      if (!user.username) {
        userStore.deleteById(user.id);
        logger.error('User created without a canonical username — rolled back', {
          ip,
          userId: user.id,
        });
        reject(400, 'Could not create account.');
        return;
      }
      const identityUserId = `web:${user.username}`;
      const sessionStore = getSessionStore(dbPath, webConfig.sessionTtlHours);
      sessionStore.deleteSessionsForUser(identityUserId);
      const session = sessionStore.createSession(identityUserId, user.role === 'admin');
      const maxAge = webConfig.sessionTtlHours * 60 * 60;
      res.setHeader(
        'Set-Cookie',
        `${SESSION_COOKIE}=${session.sessionId}; ${buildCookieOptions(webConfig, maxAge)}`,
      );

      logger.info('User registered via invite', { userId: identityUserId, role: user.role });
      res.redirect(302, '/');
    })().catch(next);
  });

  // Logout
  router.post('/logout', (req: Request, res: Response) => {
    const cookies = parseCookies(req.headers.cookie);
    const sessionId = cookies[SESSION_COOKIE];
    if (sessionId) {
      const sessionStore = getSessionStore(dbPath, webConfig.sessionTtlHours);
      sessionStore.deleteSession(sessionId);
    }
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; ${buildCookieOptions(webConfig, 0)}`);
    res.redirect(302, '/login');
  });

  // Dashboard home (optional auth — public with reduced view)
  router.get('/', optionalAuthMiddleware(webConfig, dbPath), async (_req: Request, res: Response) => {
    try {
      const isAuthenticated = !!res.locals.userId;
      const userId = (res.locals.userId as string) || 'anonymous';
      const health = await getServerHealth();

      const store = getConversationStore(claudeConfig.dbPath, claudeConfig.conversationTtlHours);
      const filterIds = isAuthenticated ? getUserFilterIds(res, dbPath) : undefined;
      const stats = isAuthenticated
        ? store.getSessionStats(24, filterIds)
        : {
            totalSessions: 0,
            activeSessions: 0,
            totalMessages: 0,
            totalToolCalls: 0,
            avgToolDurationMs: null,
            toolFailureRate: 0,
            topTools: [] as { name: string; count: number; avgDurationMs: number | null }[],
          };
      const recent = isAuthenticated ? store.listRecentSessions(5, 0, filterIds) : [];
      if (isAuthenticated) attachTags(recent, store);
      const favorites = isAuthenticated ? store.listFavoriteSessions(3, 0, filterIds) : [];
      const favCount = isAuthenticated ? store.countFavoriteSessions(filterIds) : 0;
      const allTags = isAuthenticated ? store.listAllTags(filterIds) : [];
      const widgets = getPluginWidgets(!isAuthenticated);
      const notifStore = getNotificationStore(claudeConfig.dbPath);
      const unreadCount = isAuthenticated ? notifStore.countUnread() : 0;
      const linksStore = getQuickLinksStore(claudeConfig.dbPath);
      const userLinks = isAuthenticated ? linksStore.getLinks(userId) : [];

      const html = renderDashboard(
        stats,
        recent,
        favorites,
        favCount,
        allTags,
        userId,
        widgets,
        unreadCount,
        userLinks,
        health,
        isAuthenticated,
      );
      res.type('html').send(html);
    } catch (err) {
      logger.error('Error serving dashboard', {
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).send(renderError('Failed to load dashboard.'));
    }
  });

  return router;
}

/**
 * Generate a web URL for a conversation (HMAC-signed, time-limited link token).
 */
export function getConversationUrl(
  threadTs: string,
  channelId: string,
  webConfig: WebConfig,
  userId?: string,
): string {
  const baseUrl = webConfig.baseUrl ?? `http://localhost:${String(webConfig.port)}`;
  const token = createLinkToken(
    userId ?? 'system',
    webConfig.authToken,
    webConfig.linkTokenTtlMinutes,
  );
  return `${baseUrl}/c/${threadTs}/${channelId}?token=${encodeURIComponent(token)}`;
}

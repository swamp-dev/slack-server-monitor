/**
 * Web server for hosting long Claude responses
 *
 * Provides a simple HTTP server that renders conversation pages.
 * Used when responses exceed Slack's block text limit.
 *
 * Authentication flow:
 * 1. Slack bot posts a link with ?token=<user-or-admin-token>
 * 2. User clicks link, token is validated, session cookie is set, token stripped from URL
 * 3. Subsequent requests use the session cookie (no token in URL)
 * 4. Sessions expire after sessionTtlHours (default: 72h)
 * 5. Users can also log in manually via /login with their token
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import type { Server } from 'http';
import { config, type WebConfig } from '../config/index.js';
import { getSocketModeStatus } from '../services/socket-mode-status.js';
import { getConversationStore } from '../services/conversation-store.js';
import { getSessionStore, closeSessionStore } from '../services/session-store.js';
import { getUserStore } from '../services/user-store.js';
import { getInviteStore } from '../services/invite-store.js';
import { isAuthHitAllowed, recordAuthFailure } from '../services/auth-rate-limit.js';
import { resolveTokenWithRole, resolveUserPassword, parseCookies, createLinkToken } from './auth.js';
import { SSEConnectionManager, setSharedSSEManager } from './sse.js';
import { resetEventBus } from '../services/event-bus.js';
import { logger } from '../utils/logger.js';
import { renderDashboard, render404, renderLogin, renderError, renderRegister, renderAdminUsers } from './templates/index.js';
import { getStaticCss } from './templates/styles.js';
import { getPluginWidgets } from '../plugins/loader.js';
import { getPluginExpressRouter, isPluginPublic } from './plugin-router.js';
import { getNotificationStore, closeNotificationStore } from '../services/notification-store.js';
import { getQuickLinksStore, closeQuickLinksStore } from '../services/quick-links-store.js';
import { getServerHealth } from '../services/server-health.js';
import {
  SESSION_COOKIE,
  buildCookieOptions,
  sessionAuthMiddleware,
  optionalAuthMiddleware,
  adminGuard,
  getUserFilterIds,
} from './middleware/auth.js';
import { attachTags } from './routes/helpers.js';
import { createConversationsRouter } from './routes/conversations.js';
import { createApiRouter } from './routes/api.js';

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

let server: Server | null = null;
let cleanupTimer: ReturnType<typeof setInterval> | null = null;
let sseManager: SSEConnectionManager | null = null;

/**
 * Start the web server
 *
 * @param webConfig - Web server configuration
 * @returns Promise that resolves when server is listening
 */
export async function startWebServer(webConfig: WebConfig): Promise<void> {
  if (!config.claude) {
    logger.warn('Web server requires Claude to be enabled');
    return;
  }

  const claudeConfig = config.claude;
  const dbPath = claudeConfig.dbPath;
  const app = express();
  sseManager = new SSEConnectionManager();
  setSharedSSEManager(sseManager);

  // Parse request bodies
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  // Request timing — logs slow requests (all response types) and adds X-Response-Time header (send paths only)
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();

    // 'finish' fires for all response types: send, json, redirect, SSE end — comprehensive coverage
    res.on('finish', () => {
      const duration = Date.now() - start;
      if (duration > 500) {
        logger.warn('Slow request', { method: req.method, path: req.path, status: res.statusCode, durationMs: duration });
      }
    });

    // X-Response-Time header on res.send() paths (normal routes, API endpoints) for DevTools visibility
    const originalSend = res.send.bind(res);
    res.send = function (body: Parameters<typeof res.send>[0]) {
      res.setHeader('X-Response-Time', String(Date.now() - start) + 'ms');
      return originalSend(body);
    };

    next();
  });

  // Security headers
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    next();
  });

  // Health check endpoint (no auth required)
  // Returns 200 when Socket Mode is connected, 503 when disconnected.
  // Used by Docker HEALTHCHECK to detect stale WebSocket connections.
  app.get('/health', (_req: Request, res: Response) => {
    const socketMode = getSocketModeStatus();
    const status = socketMode.connected ? 'ok' : 'degraded';
    const statusCode = socketMode.connected ? 200 : 503;
    res.status(statusCode).json({ status, socketMode });
  });

  // PWA manifest (no auth required, cacheable)
  app.get('/manifest.json', (_req: Request, res: Response) => {
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
          src: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="#ff79c6" stroke-width="1.5"><rect x="4" y="6" width="12" height="10" rx="2"/><circle cx="7.5" cy="11" r="1.5"/><circle cx="12.5" cy="11" r="1.5"/><path d="M10 2v4M6 6V4M14 6V4"/></svg>'),
          sizes: 'any',
          type: 'image/svg+xml',
        },
      ],
    });
  });

  // Static CSS bundle (no auth, aggressively cached)
  app.get('/static/styles.css', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/css; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(getStaticCss());
  });

  // Login page (no auth required)
  app.get('/login', (req: Request, res: Response) => {
    const returnTo = typeof req.query.return_to === 'string' ? req.query.return_to : undefined;
    res.type('html').send(renderLogin(undefined, returnTo, webConfig.registrationEnabled));
  });

  // Login form submission. Accepts either:
  //   - `username` + `password`  → resolveUserPassword (web account flow)
  //   - `token`                  → resolveTokenWithRole (HMAC link / static admin)
  // If both are sent, username/password takes precedence (explicit credentials
  // beat a stale token in the form).
  app.post('/login', (req: Request, res: Response, next: NextFunction) => {
    (async () => {
      const body = req.body as Record<string, unknown>;
      const username = typeof body.username === 'string' ? body.username.trim() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const token = typeof body.token === 'string' ? body.token : '';
      const returnTo = typeof body.return_to === 'string' ? body.return_to : undefined;
      const ip = req.ip ?? '0.0.0.0';

      // Peek the rate limit before doing any expensive work (scrypt verify).
      // We only record a failure below — successful logins don't consume budget,
      // so a legitimate user who logs in 5 times rapidly isn't locked out.
      if (!isAuthHitAllowed('login', ip)) {
        logger.warn('Login rate-limited', { ip });
        res.status(429).type('html').send(renderLogin('Too many attempts. Try again in a few minutes.', returnTo, webConfig.registrationEnabled));
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
        logger.warn('Failed login attempt', { ip, hasUsername: Boolean(username), hasToken: Boolean(token) });
        res.status(401).type('html').send(renderLogin('Invalid credentials.', returnTo, webConfig.registrationEnabled));
        return;
      }

      // Invalidate existing sessions for this user, then create a new one
      const sessionStore = getSessionStore(dbPath, webConfig.sessionTtlHours);
      sessionStore.deleteSessionsForUser(identity.userId);
      const session = sessionStore.createSession(identity.userId, identity.isAdmin);
      const maxAge = webConfig.sessionTtlHours * 60 * 60;
      res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${session.sessionId}; ${buildCookieOptions(webConfig, maxAge)}`);

      logger.info('User logged in via form', { userId: identity.userId, isAdmin: identity.isAdmin });

      // Redirect to return_to or home. Allow only same-origin paths:
      // must start with `/` but NOT `//` (which would be a
      // protocol-relative URL → external host) or `/\` (a Windows-path
      // shape some browsers also coerce). Falls back to `/` for
      // anything else, including the empty string.
      const redirectTo =
        returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') && !returnTo.startsWith('/\\')
          ? returnTo
          : '/';
      res.redirect(302, redirectTo);
    })().catch(next);
  });

  // Registration page. Returns 404 when registration is disabled — no leak
  // about whether the route exists.
  app.get('/register', (req: Request, res: Response) => {
    if (!webConfig.registrationEnabled) {
      res.status(404).send(render404());
      return;
    }
    const inviteCode = typeof req.query.invite === 'string' ? req.query.invite : undefined;
    res.type('html').send(renderRegister(undefined, { inviteCode }));
  });

  // Registration form submission.
  app.post('/register', (req: Request, res: Response, next: NextFunction) => {
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

      // Pre-flight: check the invite is currently valid. Atomicity comes
      // from `redeemInvite` later; we peek here to give a friendly error
      // for the common bad-code / expired-code cases. The expiry check
      // mirrors `redeemInvite`'s `expires_at > ?` predicate exactly so a
      // future change to the peek doesn't drift from the atomic redeem.
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

      // Atomicity note: this sequence (create user → redeem invite) is
      // not transactional across the two stores. If the process crashes
      // between the two steps, a stranded user row exists with no
      // redemption record. Recovery: an admin removes the stranded user
      // via `npm run manage-users delete-user`. The invite is still
      // redeemable until it expires. Acceptable for a home-server
      // deployment; if this ever moves to multi-tenant, wrap both stores
      // in a single SQLite database and use a transaction.
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
        // Unified error message — don't reveal which usernames are taken
        // (low-value enumeration vector even with invite gating).
        logger.warn('Register validation failed', {
          ip,
          message: err instanceof Error ? err.message : String(err),
        });
        reject(400, 'Username or password did not pass validation.');
        return;
      }

      // Atomic redeem — losses to a concurrent redeem return null. If we
      // lose, roll back the user we just created so the invite owner
      // isn't burned and the username isn't squatted.
      const redeemed = inviteStore.redeemInvite(inviteCode, user.id);
      if (!redeemed) {
        userStore.deleteById(user.id);
        recordAuthFailure('register', ip);
        logger.warn('Lost invite redeem race; rolled back created user', { ip, userId: user.id });
        reject(400, 'Invite code was just consumed. Please request a new one.');
        return;
      }

      // The store-canonical username (post-Zod validation, lowercase
      // canonicalization etc.) is the identity we mint sessions under.
      // If for any reason it's null we refuse to create a session rather
      // than silently fall back to the user-supplied form value.
      if (!user.username) {
        userStore.deleteById(user.id);
        logger.error('User created without a canonical username — rolled back', { ip, userId: user.id });
        reject(400, 'Could not create account.');
        return;
      }
      const identityUserId = `web:${user.username}`;
      const sessionStore = getSessionStore(dbPath, webConfig.sessionTtlHours);
      sessionStore.deleteSessionsForUser(identityUserId);
      const session = sessionStore.createSession(identityUserId, user.role === 'admin');
      const maxAge = webConfig.sessionTtlHours * 60 * 60;
      res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${session.sessionId}; ${buildCookieOptions(webConfig, maxAge)}`);

      logger.info('User registered via invite', { userId: identityUserId, role: user.role });
      res.redirect(302, '/');
    })().catch(next);
  });

  // Logout
  app.post('/logout', (req: Request, res: Response) => {
    const cookies = parseCookies(req.headers.cookie);
    const sessionId = cookies[SESSION_COOKIE];
    if (sessionId) {
      const sessionStore = getSessionStore(dbPath, webConfig.sessionTtlHours);
      sessionStore.deleteSession(sessionId);
    }

    // Clear cookie
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; ${buildCookieOptions(webConfig, 0)}`);
    res.redirect(302, '/login');
  });

  // Mount conversation routes (auth applied globally at /c)
  app.use('/c', sessionAuthMiddleware(webConfig, dbPath), createConversationsRouter(claudeConfig, dbPath));

  // ─── Admin routes (#277) ─────────────────────────────────────────────
  // All routes under /admin require an active admin session. The chained
  // middleware first does the standard session auth (401 if not logged
  // in) and then enforces role=admin (403 otherwise). This way a logged-in
  // non-admin sees the friendly 403 page rather than getting bounced to
  // /login.
  app.use('/admin', sessionAuthMiddleware(webConfig, dbPath), adminGuard);

  app.get('/admin/users', (req: Request, res: Response) => {
    try {
      const userStore = getUserStore(dbPath);
      const inviteStore = getInviteStore(dbPath);
      const users = userStore.listAll();
      const invites = inviteStore.listActive();
      // Flash/error are deliberately stateless — they round-trip through
      // the redirect URL. A bookmarked URL with an old `?error=...` will
      // re-render the same message; that's acceptable for a home server
      // and avoids a session-backed flash store.
      const flash = typeof req.query.flash === 'string' ? req.query.flash : undefined;
      const errMsg = typeof req.query.error === 'string' ? req.query.error : undefined;
      res.type('html').send(
        renderAdminUsers({
          users,
          invites,
          baseUrl: webConfig.baseUrl,
          flash,
          error: errMsg,
        }),
      );
    } catch (err) {
      logger.error('Error rendering /admin/users', {
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).type('html').send(renderError('Failed to load admin page.'));
    }
  });

  app.post('/admin/users', (req: Request, res: Response, next: NextFunction) => {
    (async () => {
      const body = req.body as Record<string, string>;
      const slackId = (body.slack_id ?? '').trim();
      const displayName = (body.display_name ?? '').trim() || undefined;
      const role = body.role === 'admin' ? 'admin' : 'user';
      if (!/^U[A-Z0-9]+$/.test(slackId)) {
        res.redirect(302, '/admin/users?error=' + encodeURIComponent('Slack ID must look like U01ABC...'));
        return;
      }
      const userStore = getUserStore(dbPath);
      if (userStore.getBySlackId(slackId)) {
        res.redirect(302, '/admin/users?error=' + encodeURIComponent('User already exists.'));
        return;
      }
      await userStore.create({ slackId, role, displayName });
      logger.info('Admin created user via web', {
        actor: res.locals.userId as string,
        slackId,
        role,
      });
      res.redirect(302, '/admin/users?flash=' + encodeURIComponent(`Added ${slackId}.`));
    })().catch(next);
  });

  app.post('/admin/users/:id/role', (req: Request, res: Response) => {
    const id = parseInt(typeof req.params.id === 'string' ? req.params.id : '', 10);
    const body = req.body as Record<string, string>;
    const newRole = body.role === 'admin' ? 'admin' : 'user';
    if (!Number.isInteger(id)) {
      res.redirect(302, '/admin/users?error=Invalid+user+id');
      return;
    }
    const userStore = getUserStore(dbPath);
    const user = userStore.getById(id);
    if (!user) {
      res.redirect(302, '/admin/users?error=User+not+found');
      return;
    }
    // Last-admin protection: count + update aren't atomic (same shape as
    // #274's CLI). The window between count check and updateRole is a
    // few SQLite operations; concurrent demotions of two different
    // admins could each see count=2 and proceed, leaving zero. For a
    // single-admin home-server context the probability is essentially
    // zero. Once #310 (manage-users CLI) merges, swap to the atomic
    // `demoteIfNotLastAdmin` it adds to UserStore.
    if (user.role === 'admin' && newRole !== 'admin' && userStore.countByRole('admin') <= 1) {
      res.redirect(302, '/admin/users?error=' + encodeURIComponent('Refusing to demote the last admin.'));
      return;
    }
    userStore.updateRole(id, newRole);
    logger.info('Admin changed user role', {
      actor: res.locals.userId as string,
      targetId: id,
      newRole,
    });
    res.redirect(302, '/admin/users?flash=Role+updated');
  });

  app.post('/admin/users/:id/toggle-active', (req: Request, res: Response) => {
    const id = parseInt(typeof req.params.id === 'string' ? req.params.id : '', 10);
    if (!Number.isInteger(id)) {
      res.redirect(302, '/admin/users?error=Invalid+user+id');
      return;
    }
    const userStore = getUserStore(dbPath);
    const user = userStore.getById(id);
    if (!user) {
      res.redirect(302, '/admin/users?error=User+not+found');
      return;
    }
    if (user.isActive && user.role === 'admin' && userStore.countByRole('admin') <= 1) {
      res.redirect(302, '/admin/users?error=' + encodeURIComponent('Refusing to deactivate the last admin.'));
      return;
    }
    if (user.isActive) userStore.deactivate(id); else userStore.activate(id);
    logger.info('Admin toggled user active', {
      actor: res.locals.userId as string,
      targetId: id,
      newState: !user.isActive,
    });
    res.redirect(302, '/admin/users?flash=' + encodeURIComponent(user.isActive ? 'User deactivated.' : 'User activated.'));
  });

  app.post('/admin/users/:id/reset-password', (req: Request, res: Response, next: NextFunction) => {
    (async () => {
      const id = parseInt(typeof req.params.id === 'string' ? req.params.id : '', 10);
      const body = req.body as Record<string, unknown>;
      const newPassword = typeof body.password === 'string' ? body.password : '';
      if (!Number.isInteger(id)) {
        res.redirect(302, '/admin/users?error=Invalid+user+id');
        return;
      }
      if (newPassword.length < 8) {
        res.redirect(302, '/admin/users?error=' + encodeURIComponent('Password must be at least 8 characters.'));
        return;
      }
      const userStore = getUserStore(dbPath);
      const user = userStore.getById(id);
      if (!user) {
        res.redirect(302, '/admin/users?error=User+not+found');
        return;
      }
      await userStore.updatePassword(id, newPassword);
      logger.info('Admin reset user password', {
        actor: res.locals.userId as string,
        targetId: id,
      });
      res.redirect(302, '/admin/users?flash=Password+updated.');
    })().catch(next);
  });

  app.post('/admin/invites', (req: Request, res: Response) => {
    const body = req.body as Record<string, string>;
    const role = body.role === 'admin' ? 'admin' : 'user';
    const ttlHoursRaw = parseInt(body.ttl_hours ?? '72', 10);
    const ttlHours = Number.isInteger(ttlHoursRaw) && ttlHoursRaw > 0
      ? Math.min(ttlHoursRaw, 24 * 365)
      : 72;
    const slackUserIdRaw = (body.slack_user_id ?? '').trim();
    const slackUserId = slackUserIdRaw || undefined;
    if (slackUserId && !/^U[A-Z0-9]+$/.test(slackUserId)) {
      res.redirect(302, '/admin/users?error=' + encodeURIComponent('Pre-link Slack ID must look like U01ABC...'));
      return;
    }

    // Resolve the requesting admin's user-row id for invite_codes.created_by.
    //
    // Three session shapes possible:
    //   - 'admin'         → static emergency-token session. No user row
    //                       exists for this identity (and the route should
    //                       still work for emergency access). Use 0 as a
    //                       sentinel — invite_codes.created_by has no
    //                       FK constraint, so 0 is a valid "system" marker.
    //   - 'web:<user>'    → look up by username.
    //   - 'U...'          → look up by Slack ID.
    const userStore = getUserStore(dbPath);
    const sessionUserId = res.locals.userId as string;
    let createdByUserId: number;
    if (sessionUserId === 'admin') {
      createdByUserId = 0; // sentinel: static emergency-token issuer
    } else {
      const requester = sessionUserId.startsWith('web:')
        ? userStore.getByUsername(sessionUserId.slice(4))
        : userStore.getBySlackId(sessionUserId);
      if (!requester) {
        res.redirect(302, '/admin/users?error=' + encodeURIComponent(
          'Your account is not in the users table. Run `npm run manage-users create-user` first.',
        ));
        return;
      }
      createdByUserId = requester.id;
    }

    const inviteStore = getInviteStore(dbPath);
    inviteStore.createInvite(createdByUserId, { role, ttlHours, slackUserId });
    logger.info('Admin created invite via web', { actor: sessionUserId, role, ttlHours });
    res.redirect(302, '/admin/users?flash=Invite+created.');
  });

  app.post('/admin/invites/:code/delete', (req: Request, res: Response) => {
    const code = typeof req.params.code === 'string' ? req.params.code : '';
    if (!/^[0-9a-f]{32}$/.test(code)) {
      res.redirect(302, '/admin/users?error=Invalid+code');
      return;
    }
    const inviteStore = getInviteStore(dbPath);
    inviteStore.deleteInvite(code);
    logger.info('Admin deleted invite', { actor: res.locals.userId as string, code });
    res.redirect(302, '/admin/users?flash=Invite+deleted.');
  });


  // Mount API + notifications routes
  app.use('/', createApiRouter(claudeConfig, webConfig, dbPath));

  ;

  // ─── Plugin Web Routes ────────────────────────────────────────────────
  // Mount plugin routes with per-plugin auth: public plugins use optional auth,
  // private plugins require session auth (401 on failure)
  const pluginAuth = (req: Request, res: Response, next: NextFunction): void => {
    const match = /^\/([^/]+)/.exec(req.path);
    const pluginName = match?.[1];
    if (pluginName && isPluginPublic(pluginName)) {
      optionalAuthMiddleware(webConfig, dbPath)(req, res, next);
    } else {
      sessionAuthMiddleware(webConfig, dbPath)(req, res, next);
    }
  };
  app.use('/p', pluginAuth, getPluginExpressRouter());

  // Dashboard home: GET / (optional auth — public with reduced view)
  app.get('/', optionalAuthMiddleware(webConfig, dbPath), async (_req: Request, res: Response) => {
    try {
      const isAuthenticated = !!res.locals.userId;
      const userId = (res.locals.userId as string) || 'anonymous';
      const health = await getServerHealth();

      // Only load private data for authenticated users — and scope it
      // to the user's identities so non-admins only see their own data.
      const store = getConversationStore(claudeConfig.dbPath, claudeConfig.conversationTtlHours);
      const filterIds = isAuthenticated ? getUserFilterIds(res, dbPath) : undefined;
      const stats = isAuthenticated ? store.getSessionStats(24, filterIds) : { totalSessions: 0, activeSessions: 0, totalMessages: 0, totalToolCalls: 0, avgToolDurationMs: null, toolFailureRate: 0, topTools: [] as { name: string; count: number; avgDurationMs: number | null }[] };
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

      const html = renderDashboard(stats, recent, favorites, favCount, allTags, userId, widgets, unreadCount, userLinks, health, isAuthenticated);
      res.type('html').send(html);
    } catch (err) {
      logger.error('Error serving dashboard', { error: err instanceof Error ? err.message : String(err) });
      res.status(500).send(renderError('Failed to load dashboard.'));
    }
  });

  // 404 for everything else
  app.use((_req: Request, res: Response) => {
    res.status(404).send(render404());
  });

  // Clean up expired sessions and old notifications on startup and periodically
  const sessionStore = getSessionStore(dbPath, webConfig.sessionTtlHours);
  sessionStore.cleanupExpired();
  const notifStore = getNotificationStore(claudeConfig.dbPath);
  notifStore.cleanup(30); // Remove read notifications older than 30 days
  cleanupTimer = setInterval(() => {
    sessionStore.cleanupExpired();
    notifStore.cleanup(30);
  }, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref();

  return new Promise((resolve, reject) => {
    try {
      server = app.listen(webConfig.port, '0.0.0.0', () => {
        const baseUrl = webConfig.baseUrl ?? `http://localhost:${String(webConfig.port)}`;
        logger.info('Web server started', {
          port: webConfig.port,
          baseUrl,
          linkTokenTtlMinutes: webConfig.linkTokenTtlMinutes,
        });
        resolve();
      });

      server.on('error', (err) => {
        logger.error('Web server error', { error: err.message });
        reject(err);
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/**
 * Stop the web server
 */
export async function stopWebServer(): Promise<void> {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }

  if (sseManager) {
    sseManager.shutdown();
    sseManager = null;
  }
  setSharedSSEManager(null);
  resetEventBus();

  closeSessionStore();
  closeNotificationStore();
  closeQuickLinksStore();

  const serverInstance = server;
  if (!serverInstance) {
    return;
  }

  return new Promise((resolve, reject) => {
    serverInstance.close((err) => {
      if (err) {
        logger.error('Error stopping web server', { error: err.message });
        reject(err);
      } else {
        logger.info('Web server stopped');
        server = null;
        resolve();
      }
    });
  });
}

/**
 * Generate a web URL for a conversation
 *
 * Creates an HMAC-signed, time-limited link token for the given user.
 *
 * @param threadTs - Thread timestamp
 * @param channelId - Channel ID
 * @param webConfig - Web configuration
 * @param userId - Slack user ID to encode in the token
 * @returns Full URL with HMAC authentication token
 */
export function getConversationUrl(
  threadTs: string,
  channelId: string,
  webConfig: WebConfig,
  userId?: string,
): string {
  const baseUrl = webConfig.baseUrl ?? `http://localhost:${String(webConfig.port)}`;
  const token = createLinkToken(userId ?? 'system', webConfig.authToken, webConfig.linkTokenTtlMinutes);
  return `${baseUrl}/c/${threadTs}/${channelId}?token=${encodeURIComponent(token)}`;
}

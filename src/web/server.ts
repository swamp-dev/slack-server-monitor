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
import { getConversationStore, type SessionSummary } from '../services/conversation-store.js';
import { getSessionStore, closeSessionStore } from '../services/session-store.js';
import { getUserStore } from '../services/user-store.js';
import { getInviteStore } from '../services/invite-store.js';
import { isAuthHitAllowed, recordAuthFailure } from '../services/auth-rate-limit.js';
import { resolveTokenWithRole, resolveUserPassword, parseCookies, createLinkToken } from './auth.js';
import { SSEConnectionManager, setSharedSSEManager } from './sse.js';
import { getEventBus, resetEventBus } from '../services/event-bus.js';
import { logger } from '../utils/logger.js';
import { renderConversation, renderMarkdownExport, renderSessionList, renderDashboard, render404, render401, render403, renderLogin, renderError, renderNotificationPage, renderRegister, renderAdminUsers } from './templates/index.js';
import { formatMarkdown } from './templates/utils.js';
import { getStaticCss } from './templates/styles.js';
import { getPluginWidgets } from '../plugins/loader.js';
import { getPluginExpressRouter, isPluginPublic } from './plugin-router.js';
import { getNotificationStore, closeNotificationStore } from '../services/notification-store.js';
import { getQuickLinksStore, closeQuickLinksStore } from '../services/quick-links-store.js';
import { getServerHealth } from '../services/server-health.js';
import { processConversationTurn } from '../services/conversation-processor.js';
import { checkAndRecordClaudeRequest } from '../services/claude-rate-limit.js';

const SESSION_COOKIE = 'ssm_session';
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Resolve the conversation-store filter identities for the current request.
 *
 * - Admin (`res.locals.isAdmin === true`) → `undefined`, no filter.
 * - Authenticated non-admin → array from `userStore.resolveIdentities`,
 *   which merges any linked Slack ID and `web:<username>` so a user with
 *   both identities sees conversations from both.
 * - **No identity on the request → `[]` (deny everything).**
 *
 * Failing closed on the unknown case is deliberate: callers should only
 * reach this helper after auth middleware has set `res.locals.userId` /
 * `res.locals.isAdmin`. If a future route forgets to gate on auth first,
 * we want it to see an empty list rather than the admin-equivalent view.
 */
function getUserFilterIds(res: Response, dbPath: string): string[] | undefined {
  if (res.locals.isAdmin) return undefined;
  const userId = res.locals.userId as string | undefined;
  if (!userId) return [];
  return getUserStore(dbPath).resolveIdentities(userId);
}

/**
 * Check whether the current request's identity is allowed to view/mutate
 * a conversation. Admins always pass. Non-admins must own the conversation
 * via any of their linked identities (Slack ID or web:<username>).
 */
function isConversationOwner(
  conversation: { userId: string },
  res: Response,
  dbPath: string,
): boolean {
  const filterIds = getUserFilterIds(res, dbPath);
  if (filterIds === undefined) return true; // admin
  return filterIds.includes(conversation.userId);
}

let server: Server | null = null;
let cleanupTimer: ReturnType<typeof setInterval> | null = null;
let sseManager: SSEConnectionManager | null = null;

/**
 * Build cookie options string for Set-Cookie header
 */
function buildCookieOptions(webConfig: WebConfig, maxAge?: number): string {
  const parts = [
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
  ];
  if (maxAge !== undefined) {
    parts.push(`Max-Age=${String(maxAge)}`);
  }
  if (webConfig.baseUrl?.startsWith('https://')) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

/**
 * Session-based authentication middleware
 *
 * Checks for authentication in this order:
 * 1. Session cookie (ssm_session) - returns immediately if valid
 * 2. Query param token (?token=) - creates session, sets cookie, redirects to strip token
 * 3. Neither - returns 401 with login link
 */
function sessionAuthMiddleware(webConfig: WebConfig, dbPath: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    (async () => {
      const sessionStore = getSessionStore(dbPath, webConfig.sessionTtlHours);
      const userStore = getUserStore(dbPath);

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
        // Invalid/expired session cookie - clear it
        res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; ${buildCookieOptions(webConfig, 0)}`);
      }

      // 2. Check query param token (link from Slack)
      const queryToken = req.query.token;
      if (typeof queryToken === 'string' && queryToken) {
        const identity = await resolveTokenWithRole(queryToken, webConfig, userStore);
        if (identity) {
          // Invalidate existing sessions for this user, then create a new one
          sessionStore.deleteSessionsForUser(identity.userId);
          const session = sessionStore.createSession(identity.userId, identity.isAdmin);
          const maxAge = webConfig.sessionTtlHours * 60 * 60;
          res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${session.sessionId}; ${buildCookieOptions(webConfig, maxAge)}`);

          // Redirect to strip token from URL (prevents token leaking in browser history/referrer)
          const url = new URL(req.originalUrl, 'http://localhost');
          url.searchParams.delete('token');
          const cleanPath = url.pathname + (url.search || '');
          res.redirect(302, cleanPath);
          return;
        }
      }

      // 3. No valid auth - return 401
      logger.warn('Unauthorized web access attempt', {
        ip: req.ip,
        path: req.path,
        hasToken: !!queryToken,
        hasCookie: !!sessionId,
      });
      res.status(401).send(render401(req.originalUrl));
    })().catch(next);
  };
}

/**
 * Optional auth middleware — sets res.locals.userId if authenticated,
 * but does NOT 401 on failure. Allows pages to render public vs private views.
 */
function optionalAuthMiddleware(webConfig: WebConfig, dbPath: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    (async () => {
      const sessionStore = getSessionStore(dbPath, webConfig.sessionTtlHours);
      const userStore = getUserStore(dbPath);

      // Check session cookie
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
        res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; ${buildCookieOptions(webConfig, 0)}`);
      }

      // Check query param token
      const queryToken = req.query.token;
      if (typeof queryToken === 'string' && queryToken) {
        const identity = await resolveTokenWithRole(queryToken, webConfig, userStore);
        if (identity) {
          sessionStore.deleteSessionsForUser(identity.userId);
          const session = sessionStore.createSession(identity.userId, identity.isAdmin);
          const maxAge = webConfig.sessionTtlHours * 60 * 60;
          res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${session.sessionId}; ${buildCookieOptions(webConfig, maxAge)}`);
          const url = new URL(req.originalUrl, 'http://localhost');
          url.searchParams.delete('token');
          const cleanPath = url.pathname + (url.search || '');
          res.redirect(302, cleanPath);
          return;
        }
      }

      // No auth — continue anyway (public access)
      next();
    })().catch(next);
  };
}

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

  // Apply session auth middleware to conversation routes
  app.use('/c', sessionAuthMiddleware(webConfig, dbPath));

  // ─── Admin routes (#277) ─────────────────────────────────────────────
  // All routes under /admin require an active admin session. The chained
  // middleware first does the standard session auth (401 if not logged
  // in) and then enforces role=admin (403 otherwise). This way a logged-in
  // non-admin sees the friendly 403 page rather than getting bounced to
  // /login.
  function adminGuard(req: Request, res: Response, next: NextFunction): void {
    if (res.locals.isAdmin === true) {
      next();
      return;
    }
    logger.warn('Non-admin attempted to access /admin', {
      userId: res.locals.userId as string | undefined,
      path: req.path,
      ip: req.ip,
    });
    res.status(403).type('html').send(render403());
  }
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

  /**
   * Helper to parse pagination params from query string
   */
  function parsePagination(req: Request): { page: number; pageSize: number; offset: number } {
    const page = typeof req.query.page === 'string' ? Math.max(1, parseInt(req.query.page, 10) || 1) : 1;
    const pageSize = typeof req.query.pageSize === 'string' ? Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20)) : 20;
    return { page, pageSize, offset: (page - 1) * pageSize };
  }

  /**
   * Helper to load tags for each session in a list (batch query)
   */
  function attachTags(sessions: SessionSummary[], store: ReturnType<typeof getConversationStore>): void {
    if (sessions.length === 0) return;
    const ids = sessions.map((s) => s.id);
    const placeholders = ids.map(() => '?').join(',');
    const rows = store.getDatabase()
      .prepare(`SELECT conversation_id, tag FROM conversation_tags WHERE conversation_id IN (${placeholders}) ORDER BY tag`)
      .all(...ids) as { conversation_id: number; tag: string }[];
    const tagsByConv = new Map<number, string[]>();
    for (const row of rows) {
      const tags = tagsByConv.get(row.conversation_id) ?? [];
      tags.push(row.tag);
      tagsByConv.set(row.conversation_id, tags);
    }
    for (const session of sessions) {
      session.tags = tagsByConv.get(session.id) ?? [];
    }
  }

  // Session list endpoint: GET /c
  app.get('/c', (req: Request, res: Response) => {
    try {
      const store = getConversationStore(claudeConfig.dbPath, claudeConfig.conversationTtlHours);
      const { page, pageSize, offset } = parsePagination(req);

      const userId = res.locals.userId as string;
      const filterIds = getUserFilterIds(res, dbPath);
      // Admins can opt-in to a "show only mine" filter via ?mine=true.
      // Non-admins are always scoped — `filterIds` from resolveIdentities
      // already merges their Slack + web identities.
      const adminViewingOwn = filterIds === undefined && req.query.mine === 'true';
      const effectiveFilter = filterIds ?? (adminViewingOwn ? userId : undefined);
      const showMine = filterIds !== undefined || adminViewingOwn;

      const sessions = store.listRecentSessions(pageSize, offset, effectiveFilter);
      attachTags(sessions, store);
      const totalItems = store.countSessions(effectiveFilter);
      const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
      // Tag sidebar tracks the same scope as the session list: a non-admin
      // sees their tags via filterIds; an admin in ?mine=true sees their
      // own tags via effectiveFilter; an admin without ?mine sees all.
      const allTags = store.listAllTags(effectiveFilter);

      const html = renderSessionList(sessions, { page, pageSize, totalItems, totalPages }, { allTags, currentUserId: userId, showMine });
      res.type('html').send(html);
    } catch (err) {
      logger.error('Error serving session list', {
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).send(renderError('Failed to load conversations.'));
    }
  });

  // Search endpoint: GET /c/search?q=...
  app.get('/c/search', (req: Request, res: Response) => {
    try {
      const store = getConversationStore(claudeConfig.dbPath, claudeConfig.conversationTtlHours);
      const { page, pageSize, offset } = parsePagination(req);
      const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';

      if (!query) {
        res.redirect(302, '/c');
        return;
      }

      const filterIds = getUserFilterIds(res, dbPath);
      const sessions = store.searchConversations(query, pageSize, offset, filterIds);
      attachTags(sessions, store);
      const totalItems = store.countSearchResults(query, filterIds);
      const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
      const allTags = store.listAllTags(filterIds);

      const html = renderSessionList(sessions, { page, pageSize, totalItems, totalPages }, { searchQuery: query, allTags });
      res.type('html').send(html);
    } catch (err) {
      logger.error('Error serving search results', {
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).send(renderError('Failed to search conversations.'));
    }
  });

  // Favorites endpoint: GET /c/favorites
  app.get('/c/favorites', (req: Request, res: Response) => {
    try {
      const store = getConversationStore(claudeConfig.dbPath, claudeConfig.conversationTtlHours);
      const { page, pageSize, offset } = parsePagination(req);

      const filterIds = getUserFilterIds(res, dbPath);
      const sessions = store.listFavoriteSessions(pageSize, offset, filterIds);
      attachTags(sessions, store);
      const totalItems = store.countFavoriteSessions(filterIds);
      const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
      const allTags = store.listAllTags(filterIds);

      const html = renderSessionList(sessions, { page, pageSize, totalItems, totalPages }, { favorites: true, allTags });
      res.type('html').send(html);
    } catch (err) {
      logger.error('Error serving favorites', {
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).send(renderError('Failed to load favorites.'));
    }
  });

  // Tag filter endpoint: GET /c/tag/:tag
  app.get('/c/tag/:tag', (req: Request, res: Response) => {
    try {
      const store = getConversationStore(claudeConfig.dbPath, claudeConfig.conversationTtlHours);
      const { page, pageSize, offset } = parsePagination(req);
      const tag = typeof req.params.tag === 'string' ? req.params.tag : '';

      if (!tag) {
        res.redirect(302, '/c');
        return;
      }

      const filterIds = getUserFilterIds(res, dbPath);
      const sessions = store.listSessionsByTag(tag, pageSize, offset, filterIds);
      attachTags(sessions, store);
      const allTags = store.listAllTags(filterIds);
      const totalItems = store.countSessionsByTag(tag, filterIds);
      const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

      const html = renderSessionList(sessions, { page, pageSize, totalItems, totalPages }, { activeTag: tag, allTags });
      res.type('html').send(html);
    } catch (err) {
      logger.error('Error serving tag filter', {
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).send(renderError('Failed to load tagged conversations.'));
    }
  });

  // Toggle favorite: POST /c/:id/favorite
  app.post('/c/:id/favorite', (req: Request, res: Response) => {
    try {
      const store = getConversationStore(claudeConfig.dbPath, claudeConfig.conversationTtlHours);
      const id = parseInt(typeof req.params.id === 'string' ? req.params.id : '', 10);
      if (isNaN(id)) {
        res.status(400).json({ error: 'Invalid conversation ID' });
        return;
      }
      const conversation = store.getConversationById(id);
      if (!conversation || !isConversationOwner(conversation, res, dbPath)) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      const isFavorited = store.toggleFavorite(id);
      res.json({ isFavorited });
    } catch (err) {
      logger.error('Error toggling favorite', {
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({ error: 'Failed to toggle favorite' });
    }
  });

  // Add tag: POST /c/:id/tag
  app.post('/c/:id/tag', (req: Request, res: Response) => {
    try {
      const store = getConversationStore(claudeConfig.dbPath, claudeConfig.conversationTtlHours);
      const id = parseInt(typeof req.params.id === 'string' ? req.params.id : '', 10);
      const body = req.body as Record<string, unknown>;
      const tag = typeof body.tag === 'string' ? body.tag.trim().toLowerCase() : '';

      if (isNaN(id) || !tag) {
        res.status(400).json({ error: 'Invalid conversation ID or tag' });
        return;
      }

      // Validate tag: max 50 chars, alphanumeric + hyphens + underscores
      if (tag.length > 50 || !/^[a-z0-9][a-z0-9-_]*$/.test(tag)) {
        res.status(400).json({ error: 'Tag must be 1-50 characters, alphanumeric with hyphens/underscores' });
        return;
      }

      const conversation = store.getConversationById(id);
      if (!conversation || !isConversationOwner(conversation, res, dbPath)) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      store.addTag(id, tag);
      res.json({ tags: store.getTags(id) });
    } catch (err) {
      logger.error('Error adding tag', {
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({ error: 'Failed to add tag' });
    }
  });

  // Remove tag: DELETE /c/:id/tag/:tag
  app.delete('/c/:id/tag/:tag', (req: Request, res: Response) => {
    try {
      const store = getConversationStore(claudeConfig.dbPath, claudeConfig.conversationTtlHours);
      const id = parseInt(typeof req.params.id === 'string' ? req.params.id : '', 10);
      const tag = typeof req.params.tag === 'string' ? req.params.tag : '';

      if (isNaN(id) || !tag) {
        res.status(400).json({ error: 'Invalid conversation ID or tag' });
        return;
      }

      const conversation = store.getConversationById(id);
      if (!conversation || !isConversationOwner(conversation, res, dbPath)) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      store.removeTag(id, tag);
      res.json({ tags: store.getTags(id) });
    } catch (err) {
      logger.error('Error removing tag', {
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({ error: 'Failed to remove tag' });
    }
  });

  // Archive a single conversation: POST /c/:id/archive
  app.post('/c/:id/archive', (req: Request, res: Response) => {
    try {
      const store = getConversationStore(claudeConfig.dbPath, claudeConfig.conversationTtlHours);
      const id = parseInt(typeof req.params.id === 'string' ? req.params.id : '', 10);
      if (isNaN(id)) {
        res.status(400).json({ error: 'Invalid conversation ID' });
        return;
      }
      const conversation = store.getConversationById(id);
      if (!conversation || !isConversationOwner(conversation, res, dbPath)) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      const archived = store.archiveConversation(id);
      res.json({ archived });
    } catch (err) {
      logger.error('Error archiving conversation', {
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({ error: 'Failed to archive conversation' });
    }
  });

  // Fork conversation: POST /c/:id/fork
  app.post('/c/:id/fork', (req: Request, res: Response) => {
    try {
      const store = getConversationStore(claudeConfig.dbPath, claudeConfig.conversationTtlHours);
      const id = parseInt(typeof req.params.id === 'string' ? req.params.id : '', 10);
      const body = req.body as Record<string, unknown>;
      const messageIndex = typeof body.messageIndex === 'number' ? body.messageIndex : -1;

      if (isNaN(id)) {
        res.status(400).json({ error: 'Invalid conversation ID' });
        return;
      }
      if (!Number.isInteger(messageIndex) || messageIndex < 0) {
        res.status(400).json({ error: 'messageIndex is required and must be a non-negative integer' });
        return;
      }

      // Ownership check: only the conversation owner (or admin / linked
      // identity) can fork.
      const parent = store.getConversationById(id);
      if (!parent) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }
      if (!isConversationOwner(parent, res, dbPath)) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      const branch = store.branchConversation(id, messageIndex, res.locals.userId as string);
      res.json({ threadTs: branch.threadTs, channelId: branch.channelId, id: branch.id });
    } catch (err) {
      logger.error('Error forking conversation', {
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({ error: 'Failed to fork conversation' });
    }
  });

  // Archived session list endpoint: GET /c/archived
  app.get('/c/archived', (req: Request, res: Response) => {
    try {
      const store = getConversationStore(claudeConfig.dbPath, claudeConfig.conversationTtlHours);
      const { page, pageSize, offset } = parsePagination(req);

      const filterIds = getUserFilterIds(res, dbPath);
      const sessions = store.listArchivedSessions(pageSize, offset, filterIds);
      const totalItems = store.countArchivedSessions(filterIds);
      const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

      const html = renderSessionList(sessions, { page, pageSize, totalItems, totalPages }, { archived: true });
      res.type('html').send(html);
    } catch (err) {
      logger.error('Error serving archived session list', {
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).send(renderError('Failed to load archived conversations.'));
    }
  });

  // Conversation endpoint: GET /c/:threadTs/:channelId
  app.get('/c/:threadTs/:channelId', (req: Request, res: Response) => {
    const threadTs = req.params.threadTs;
    const channelId = req.params.channelId;

    if (!threadTs || !channelId || typeof threadTs !== 'string' || typeof channelId !== 'string') {
      res.status(400).send(render404());
      return;
    }

    try {
      const store = getConversationStore(claudeConfig.dbPath, claudeConfig.conversationTtlHours);
      const conversation = store.getConversation(threadTs, channelId);

      if (!conversation) {
        logger.debug('Conversation not found for web view', { threadTs, channelId });
        res.status(404).send(render404());
        return;
      }
      if (!isConversationOwner(conversation, res, dbPath)) {
        // Don't leak existence to non-owners — render the same 404 they'd
        // see for a truly missing thread.
        logger.debug('Conversation access denied (non-owner)', {
          threadTs,
          channelId,
          requesterId: res.locals.userId as string,
        });
        res.status(404).send(render404());
        return;
      }

      const toolCalls = store.getToolCalls(conversation.id);
      const tags = store.getTags(conversation.id);
      const branches = store.listBranches(conversation.id).map((b) => ({
        threadTs: b.threadTs,
        channelId: b.channelId,
        createdAt: b.createdAt,
        branchPointIndex: b.branchPointIndex,
      }));
      const html = renderConversation(conversation.messages, toolCalls, {
        threadTs: conversation.threadTs,
        channelId: conversation.channelId,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        canContinue: true,
        conversationId: conversation.id,
        isFavorited: conversation.favoritedAt != null,
        tags,
        userId: conversation.userId,
        contextStatus: conversation.contextStatus,
        parentConversationId: conversation.parentConversationId,
        branchPointIndex: conversation.branchPointIndex,
        branches,
      });

      res.type('html').send(html);

      logger.debug('Served conversation web page', {
        threadTs,
        channelId,
        userId: res.locals.userId as string,
        messageCount: conversation.messages.length,
        toolCallCount: toolCalls.length,
      });
    } catch (err) {
      logger.error('Error serving conversation', {
        error: err instanceof Error ? err.message : String(err),
        threadTs,
        channelId,
      });
      res.status(500).send(renderError('An unexpected error occurred.'));
    }
  });

  // Continue conversation endpoint: POST /c/:threadTs/:channelId/ask
  app.post('/c/:threadTs/:channelId/ask', (req: Request, res: Response) => {
    const threadTs = req.params.threadTs;
    const channelId = req.params.channelId;

    if (!threadTs || !channelId || typeof threadTs !== 'string' || typeof channelId !== 'string') {
      res.status(400).json({ error: 'Invalid parameters' });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const message = typeof body.message === 'string' ? body.message.trim() : '';

    if (!message) {
      res.status(400).json({ error: 'Message is required' });
      return;
    }

    if (message.length > 4000) {
      res.status(400).json({ error: 'Message is too long (max 4000 characters)' });
      return;
    }

    const userId = res.locals.userId as string | undefined;
    if (!userId) {
      logger.error('Web continuation reached without authenticated user', { threadTs, channelId });
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // Check rate limit (shares the same limiter as Slack commands)
    if (!checkAndRecordClaudeRequest(userId)) {
      res.status(429).json({ error: 'Rate limit exceeded. Please wait before asking another question.' });
      return;
    }

    try {
      const store = getConversationStore(claudeConfig.dbPath, claudeConfig.conversationTtlHours);

      // Ownership check: verify the conversation belongs to this user (or
      // any linked identity, e.g. Slack ↔ web). Admin sessions bypass.
      const existing = store.getConversation(threadTs, channelId);
      if (existing && !isConversationOwner(existing, res, dbPath)) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      // Use getOrCreateConversation atomically — avoids TOCTOU race where
      // conversation could expire between a check and a separate update
      const conversation = store.getOrCreateConversation(
        threadTs,
        channelId,
        userId,
        message
      );

      // Verify this is a continuation (has prior messages), not a brand new conversation
      if (conversation.messages.length <= 1) {
        res.status(404).json({ error: 'Conversation not found or has expired' });
        return;
      }

      // Send immediate acknowledgment so client can open SSE stream
      res.json({ success: true });

      // Process the turn async, streaming progress via SSE
      // NOTE: Don't forward 'done' from onProgress — the CLI provider emits it
      // before processConversationTurn stores the response to SQLite. We emit
      // 'done' in .then() after the DB write so clients reload to a saved response.
      const streamChannel = `conversation:${threadTs}:${channelId}`;
      processConversationTurn({
        conversationId: conversation.id,
        threadTs,
        channelId,
        userId,
        userMessage: message,
        claudeConfig,
        askOptions: {
          onProgress: (event) => {
            if (event.type !== 'done') {
              sseManager?.broadcast(streamChannel, event.type, event);
            }
          },
        },
      })
        .then((result) => {
          sseManager?.broadcast(streamChannel, 'done', {
            type: 'done',
            responseHtml: formatMarkdown(result.response),
          });
        })
        .catch((err: unknown) => {
          const errMessage = err instanceof Error ? err.message : 'An unexpected error occurred';
          logger.error('Web continuation failed', {
            error: errMessage,
            threadTs,
            channelId,
            userId,
          });
          sseManager?.broadcast(streamChannel, 'error', { type: 'error', message: errMessage });
        });
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : 'An unexpected error occurred';
      logger.error('Error in web continuation setup', {
        error: errMessage,
        threadTs,
        channelId,
      });
      res.status(500).json({ error: errMessage });
    }
  });

  // ─── SSE: Conversation Stream ────────────────────────────────────────
  app.get('/c/:threadTs/:channelId/stream', (req: Request, res: Response) => {
    const threadTs = req.params.threadTs;
    const channelId = req.params.channelId;
    if (!threadTs || !channelId || typeof threadTs !== 'string' || typeof channelId !== 'string') {
      res.status(400).json({ error: 'Invalid parameters' });
      return;
    }

    // Fail-closed: require authentication for SSE streams
    const userId = res.locals.userId as string | undefined;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // Verify conversation exists and the authenticated user owns it
    // (any linked identity passes; admin sessions bypass).
    const store = getConversationStore(claudeConfig.dbPath, claudeConfig.conversationTtlHours);
    const conversation = store.getConversation(threadTs, channelId);
    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }
    if (!isConversationOwner(conversation, res, dbPath)) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    sseManager?.addClient(`conversation:${threadTs}:${channelId}`, res);
  });

  // Markdown export endpoint: GET /c/:threadTs/:channelId/export/md?tools=true|false
  app.get('/c/:threadTs/:channelId/export/md', (req: Request, res: Response) => {
    const threadTs = req.params.threadTs;
    const channelId = req.params.channelId;

    if (!threadTs || !channelId || typeof threadTs !== 'string' || typeof channelId !== 'string') {
      res.status(400).send(render404());
      return;
    }

    try {
      const store = getConversationStore(claudeConfig.dbPath, claudeConfig.conversationTtlHours);
      const conversation = store.getConversation(threadTs, channelId);

      if (!conversation) {
        res.status(404).send(render404());
        return;
      }
      if (!isConversationOwner(conversation, res, dbPath)) {
        // Don't leak existence to non-owners — same 404 as a missing thread.
        res.status(404).send(render404());
        return;
      }

      const includeTools = req.query.tools !== 'false';
      const toolCalls = includeTools ? store.getToolCalls(conversation.id) : [];

      const md = renderMarkdownExport(conversation.messages, toolCalls, {
        threadTs: conversation.threadTs,
        channelId: conversation.channelId,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
      });

      res.type('text/markdown');
      res.setHeader('Content-Disposition', `attachment; filename="conversation-${threadTs}.md"`);
      res.send(md);

      logger.debug('Served markdown export', { threadTs, channelId, includeTools });
    } catch (err) {
      logger.error('Error exporting conversation', {
        error: err instanceof Error ? err.message : String(err),
        threadTs,
        channelId,
      });
      res.status(500).send(renderError('An unexpected error occurred.'));
    }
  });

  // ─── Search API (for command palette) ──────────────────────────────────

  // GET /api/search?q=...&limit=5 — lightweight conversation search
  app.get('/api/search', sessionAuthMiddleware(webConfig, dbPath), (req: Request, res: Response) => {
    try {
      const store = getConversationStore(claudeConfig.dbPath, claudeConfig.conversationTtlHours);
      const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      const limit = Math.min(typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 5, 10) || 5;
      const userId = res.locals.userId as string | undefined;

      function toResult(s: { id: number; firstMessage?: string; userId: string; channelId: string; threadTs: string; updatedAt: number }) {
        return {
          id: s.id,
          title: s.firstMessage ?? `${s.userId} · ${s.channelId}`,
          url: `/c/${encodeURIComponent(s.threadTs)}/${encodeURIComponent(s.channelId)}`,
          time: s.updatedAt,
        };
      }

      // Command-palette UX intentionally always scopes to the requester's
      // own conversations — including admins. Admins explicitly browsing
      // others' conversations should use the full /c page, not the palette.
      const filterIds = getUserFilterIds(res, dbPath) ?? (userId ? [userId] : []);
      if (!query) {
        const recent = store.listRecentSessions(limit, 0, filterIds);
        res.json({ results: recent.map(toResult) });
        return;
      }

      const sessions = store.searchConversations(query, limit, 0, filterIds);
      res.json({ results: sessions.map(toResult) });
    } catch (err) {
      logger.error('Error in search API', { error: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: 'Search failed' });
    }
  });

  // ─── Server Health API ────────────────────────────────────────────────

  // GET /api/health/server — cached server health metrics
  app.get('/api/health/server', sessionAuthMiddleware(webConfig, dbPath), async (_req: Request, res: Response) => {
    try {
      const health = await getServerHealth();
      if (!health) {
        res.status(503).json({ error: 'Health metrics unavailable' });
        return;
      }
      res.json(health);
    } catch (err) {
      logger.error('Error fetching server health', { error: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: 'Failed to fetch health' });
    }
  });

  // ─── Quick Links API ──────────────────────────────────────────────────

  // GET /api/links — list quick links for authenticated user
  app.get('/api/links', sessionAuthMiddleware(webConfig, dbPath), (_req: Request, res: Response) => {
    try {
      const linksStore = getQuickLinksStore(claudeConfig.dbPath);
      const userId = (res.locals.userId as string) || '';
      const links = linksStore.getLinks(userId);
      res.json({ links });
    } catch (err) {
      logger.error('Error fetching quick links', { error: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: 'Failed to fetch links' });
    }
  });

  // POST /api/links — add a quick link
  app.post('/api/links', sessionAuthMiddleware(webConfig, dbPath), (req: Request, res: Response) => {
    try {
      const linksStore = getQuickLinksStore(claudeConfig.dbPath);
      const userId = (res.locals.userId as string) || '';
      const { title, url, icon: linkIcon } = req.body as { title?: string; url?: string; icon?: string };

      if (!title || !url || typeof title !== 'string' || typeof url !== 'string') {
        res.status(400).json({ error: 'title and url are required' });
        return;
      }

      if (title.length > 100 || url.length > 2000) {
        res.status(400).json({ error: 'title or url too long' });
        return;
      }

      if (typeof linkIcon === 'string' && linkIcon.length > 50) {
        res.status(400).json({ error: 'icon name too long' });
        return;
      }

      // Reject dangerous URL schemes at write time
      const trimmedUrl = url.trim().toLowerCase();
      if (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://') && !url.trim().startsWith('/')) {
        res.status(400).json({ error: 'url must be http://, https://, or a relative path' });
        return;
      }

      const link = linksStore.addLink(userId, title.trim(), url.trim(), typeof linkIcon === 'string' ? linkIcon.trim() : undefined);
      res.status(201).json({ link });
    } catch (err) {
      logger.error('Error adding quick link', { error: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: 'Failed to add link' });
    }
  });

  // DELETE /api/links/:id — remove a quick link
  app.delete('/api/links/:id', sessionAuthMiddleware(webConfig, dbPath), (req: Request, res: Response) => {
    try {
      const linksStore = getQuickLinksStore(claudeConfig.dbPath);
      const userId = (res.locals.userId as string) || '';
      const id = Number(req.params.id);
      if (isNaN(id) || id <= 0) {
        res.status(400).json({ error: 'Invalid link ID' });
        return;
      }
      const success = linksStore.removeLink(userId, id);
      res.json({ success });
    } catch (err) {
      logger.error('Error removing quick link', { error: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: 'Failed to remove link' });
    }
  });

  // PUT /api/links/reorder — reorder quick links
  app.put('/api/links/reorder', sessionAuthMiddleware(webConfig, dbPath), (req: Request, res: Response) => {
    try {
      const linksStore = getQuickLinksStore(claudeConfig.dbPath);
      const userId = (res.locals.userId as string) || '';
      const { orderedIds } = req.body as { orderedIds?: number[] };

      if (!Array.isArray(orderedIds) || !orderedIds.every((id) => typeof id === 'number' && id > 0)) {
        res.status(400).json({ error: 'orderedIds must be an array of positive numbers' });
        return;
      }

      if (orderedIds.length > 100) {
        res.status(400).json({ error: 'Too many items to reorder (max 100)' });
        return;
      }

      const updated = linksStore.reorderLinks(userId, orderedIds);
      res.json({ updated });
    } catch (err) {
      logger.error('Error reordering quick links', { error: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: 'Failed to reorder links' });
    }
  });

  // ─── Notification API ─────────────────────────────────────────────────

  // GET /api/notifications — list notifications (optionally unread only)
  app.get('/api/notifications', sessionAuthMiddleware(webConfig, dbPath), (req: Request, res: Response) => {
    try {
      const notifStore = getNotificationStore(claudeConfig.dbPath);
      const unreadOnly = req.query.unread === 'true';
      const limit = Math.min(Number(req.query.limit) || 50, 100);
      const offset = Math.max(Number(req.query.offset) || 0, 0);

      const notifications = unreadOnly
        ? notifStore.getUnread(limit)
        : notifStore.getRecent(limit, offset);
      const unreadCount = notifStore.countUnread();

      res.json({ notifications, unreadCount });
    } catch (err) {
      logger.error('Error fetching notifications', { error: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: 'Failed to fetch notifications' });
    }
  });

  // POST /api/notifications/read-all — mark all notifications as read
  // IMPORTANT: Must be registered before /:id/read to avoid Express treating "read-all" as an :id
  app.post('/api/notifications/read-all', sessionAuthMiddleware(webConfig, dbPath), (_req: Request, res: Response) => {
    try {
      const notifStore = getNotificationStore(claudeConfig.dbPath);
      const count = notifStore.markAllRead();
      res.json({ count, unreadCount: 0 });
    } catch (err) {
      logger.error('Error marking all notifications read', { error: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: 'Failed to mark all read' });
    }
  });

  // POST /api/notifications/:id/read — mark a single notification as read
  app.post('/api/notifications/:id/read', sessionAuthMiddleware(webConfig, dbPath), (req: Request, res: Response) => {
    try {
      const notifStore = getNotificationStore(claudeConfig.dbPath);
      const id = Number(req.params.id);
      if (isNaN(id) || id <= 0) {
        res.status(400).json({ error: 'Invalid notification ID' });
        return;
      }
      const success = notifStore.markRead(id);
      res.json({ success, unreadCount: notifStore.countUnread() });
    } catch (err) {
      logger.error('Error marking notification read', { error: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: 'Failed to mark notification read' });
    }
  });

  // ─── SSE: Notification Stream ─────────────────────────────────────────
  app.get('/api/notifications/stream', sessionAuthMiddleware(webConfig, dbPath), (_req: Request, res: Response) => {
    sseManager?.addClient('notifications', res);
  });

  // Wire event bus to SSE broadcasts
  const bus = getEventBus();
  bus.on('notification:created', (notification) => {
    sseManager?.broadcast('notifications', 'notification', notification);
  });
  bus.on('notification:read', (data) => {
    sseManager?.broadcast('notifications', 'badge', data);
  });
  bus.on('notification:all-read', (data) => {
    sseManager?.broadcast('notifications', 'badge', data);
  });

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

  // Notifications page: GET /notifications
  app.get('/notifications', sessionAuthMiddleware(webConfig, dbPath), (_req: Request, res: Response) => {
    try {
      const notifStore = getNotificationStore(claudeConfig.dbPath);
      const notifications = notifStore.getRecent(50);
      const unreadCount = notifStore.countUnread();
      const html = renderNotificationPage(notifications, unreadCount);
      res.type('html').send(html);
    } catch (err) {
      logger.error('Error serving notifications page', { error: err instanceof Error ? err.message : String(err) });
      res.status(500).send(renderError('Failed to load notifications.'));
    }
  });

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

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
import { getConversationStore } from '../services/conversation-store.js';
import { getSessionStore, closeSessionStore } from '../services/session-store.js';
import { resolveToken, parseCookies } from './auth.js';
import { logger } from '../utils/logger.js';
import { renderConversation, renderMarkdownExport, render404, render401, renderLogin } from './templates.js';

const SESSION_COOKIE = 'ssm_session';
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

let server: Server | null = null;
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

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
    const sessionStore = getSessionStore(dbPath, webConfig.sessionTtlHours);

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
      const identity = resolveToken(queryToken, webConfig);
      if (identity) {
        // Create session and set cookie
        const session = sessionStore.createSession(identity.userId, identity.isAdmin);
        const maxAge = webConfig.sessionTtlHours * 60 * 60;
        res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${session.sessionId}; ${buildCookieOptions(webConfig, maxAge)}`);

        // Redirect to strip token from URL (prevents token leaking in browser history/referrer)
        const url = new URL(req.originalUrl, `http://${req.headers.host ?? 'localhost'}`);
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

  // Parse URL-encoded form bodies (for POST /login)
  app.use(express.urlencoded({ extended: false }));

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
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  // Login page (no auth required)
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
      logger.warn('Failed login attempt', { ip: req.ip });
      res.status(401).type('html').send(renderLogin('Invalid token.', returnTo));
      return;
    }

    // Create session and set cookie
    const sessionStore = getSessionStore(dbPath, webConfig.sessionTtlHours);
    const session = sessionStore.createSession(identity.userId, identity.isAdmin);
    const maxAge = webConfig.sessionTtlHours * 60 * 60;
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${session.sessionId}; ${buildCookieOptions(webConfig, maxAge)}`);

    logger.info('User logged in via form', { userId: identity.userId, isAdmin: identity.isAdmin });

    // Redirect to return_to or home
    const redirectTo = returnTo && returnTo.startsWith('/') ? returnTo : '/';
    res.redirect(302, redirectTo);
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

      const toolCalls = store.getToolCalls(conversation.id);
      const html = renderConversation(conversation.messages, toolCalls, {
        threadTs: conversation.threadTs,
        channelId: conversation.channelId,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
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
      res.status(500).send(render404());
    }
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
      res.status(500).send(render404());
    }
  });

  // 404 for everything else
  app.use((_req: Request, res: Response) => {
    res.status(404).send(render404());
  });

  // Clean up expired sessions on startup and periodically
  const sessionStore = getSessionStore(dbPath, webConfig.sessionTtlHours);
  sessionStore.cleanupExpired();
  cleanupTimer = setInterval(() => {
    sessionStore.cleanupExpired();
  }, CLEANUP_INTERVAL_MS);

  return new Promise((resolve, reject) => {
    try {
      server = app.listen(webConfig.port, '0.0.0.0', () => {
        const baseUrl = webConfig.baseUrl ?? `http://localhost:${String(webConfig.port)}`;
        logger.info('Web server started', {
          port: webConfig.port,
          baseUrl,
          userTokenCount: webConfig.userTokens.length,
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

  closeSessionStore();

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
 * Uses per-user token if available for the given userId,
 * otherwise falls back to admin token.
 *
 * @param threadTs - Thread timestamp
 * @param channelId - Channel ID
 * @param webConfig - Web configuration
 * @param userId - Optional Slack user ID for per-user token lookup
 * @returns Full URL with authentication token
 */
export function getConversationUrl(
  threadTs: string,
  channelId: string,
  webConfig: WebConfig,
  userId?: string,
): string {
  const baseUrl = webConfig.baseUrl ?? `http://localhost:${String(webConfig.port)}`;

  // Use per-user token if available
  let token = webConfig.authToken;
  if (userId) {
    const userToken = webConfig.userTokens.find((ut) => ut.userId === userId);
    if (userToken) {
      token = userToken.token;
    }
  }

  return `${baseUrl}/c/${threadTs}/${channelId}?token=${encodeURIComponent(token)}`;
}

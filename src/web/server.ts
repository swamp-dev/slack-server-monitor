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
import { getSessionStore, closeSessionStore } from '../services/session-store.js';
import { SSEConnectionManager, setSharedSSEManager } from './sse.js';
import { resetEventBus } from '../services/event-bus.js';
import { logger } from '../utils/logger.js';
import { render404 } from './templates/index.js';
import { getPluginExpressRouter, isPluginPublic } from './plugin-router.js';
import { getNotificationStore, closeNotificationStore } from '../services/notification-store.js';
import { closeQuickLinksStore } from '../services/quick-links-store.js';
import {
  sessionAuthMiddleware,
  optionalAuthMiddleware,
} from './middleware/auth.js';
import { createConversationsRouter } from './routes/conversations.js';
import { createApiRouter } from './routes/api.js';
import { createAdminRouter } from './routes/admin.js';
import { createDashboardRouter } from './routes/dashboard.js';

export { getConversationUrl } from './routes/dashboard.js';

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

  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  // Request timing — logs slow requests and adds X-Response-Time header (send paths only)
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();

    // 'finish' fires for all response types: send, json, redirect, SSE end
    res.on('finish', () => {
      const duration = Date.now() - start;
      if (duration > 500) {
        logger.warn('Slow request', {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: duration,
        });
      }
    });

    // X-Response-Time on res.send() paths for DevTools visibility
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

  // Conversations (/c/*)
  app.use('/c', sessionAuthMiddleware(webConfig, dbPath), createConversationsRouter(claudeConfig, dbPath));

  // Admin (/admin/*) — sessionAuthMiddleware here; adminGuard is inside createAdminRouter
  app.use('/admin', sessionAuthMiddleware(webConfig, dbPath), createAdminRouter(dbPath, webConfig));

  // API + notifications
  app.use('/', createApiRouter(claudeConfig, webConfig, dbPath));

  // Plugin routes — per-plugin auth: public plugins use optional auth, private require session
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

  // Dashboard, static, and auth routes (mounted last so plugin routes take precedence at /p)
  app.use('/', createDashboardRouter(claudeConfig, webConfig, dbPath));

  // 404 catch-all
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

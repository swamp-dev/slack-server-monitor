import type { Request, Response, NextFunction } from 'express';
import type { WebConfig } from '../../config/schema.js';
import { getSessionStore } from '../../services/session-store.js';
import { getUserStore } from '../../services/user-store.js';
import { resolveTokenWithRole, parseCookies } from '../auth.js';
import { logger } from '../../utils/logger.js';
import { render401, render403 } from '../templates/index.js';

export const SESSION_COOKIE = 'ssm_session';

export function buildCookieOptions(webConfig: WebConfig, maxAge?: number): string {
  const parts = ['HttpOnly', 'SameSite=Lax', 'Path=/'];
  if (maxAge !== undefined) {
    parts.push(`Max-Age=${String(maxAge)}`);
  }
  if (webConfig.baseUrl?.startsWith('https://')) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function sessionAuthMiddleware(webConfig: WebConfig, dbPath: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    (async () => {
      const sessionStore = getSessionStore(dbPath, webConfig.sessionTtlHours);
      const userStore = getUserStore(dbPath);

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

export function optionalAuthMiddleware(webConfig: WebConfig, dbPath: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    (async () => {
      const sessionStore = getSessionStore(dbPath, webConfig.sessionTtlHours);
      const userStore = getUserStore(dbPath);

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

      next();
    })().catch(next);
  };
}

export function adminGuard(req: Request, res: Response, next: NextFunction): void {
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

export function getUserFilterIds(res: Response, dbPath: string): string[] | undefined {
  if (res.locals.isAdmin) return undefined;
  const userId = res.locals.userId as string | undefined;
  if (!userId) return [];
  return getUserStore(dbPath).resolveIdentities(userId);
}

export function isConversationOwner(
  conversation: { userId: string },
  res: Response,
  dbPath: string,
): boolean {
  const filterIds = getUserFilterIds(res, dbPath);
  if (filterIds === undefined) return true;
  return filterIds.includes(conversation.userId);
}

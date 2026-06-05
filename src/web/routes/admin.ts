import express, { type Request, type Response, type NextFunction, type Router } from 'express';
import type { WebConfig } from '../../config/schema.js';
import { getUserStore } from '../../services/user-store.js';
import { getInviteStore } from '../../services/invite-store.js';
import { logger } from '../../utils/logger.js';
import { renderAdminUsers, renderError } from '../templates/index.js';
import { adminGuard } from '../middleware/auth.js';

export function createAdminRouter(dbPath: string, webConfig: WebConfig): Router {
  const router = express.Router();

  // adminGuard lives in src/web/middleware/auth.ts and is applied here so
  // this router is self-contained — callers only need to wire sessionAuthMiddleware.
  router.use(adminGuard);

  router.get('/users', (req: Request, res: Response) => {
    try {
      const userStore = getUserStore(dbPath);
      const inviteStore = getInviteStore(dbPath);
      const users = userStore.listAll();
      const invites = inviteStore.listActive();
      // Flash/error round-trip through the redirect URL (stateless — no flash store needed).
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

  router.post('/users', (req: Request, res: Response, next: NextFunction) => {
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

  router.post('/users/:id/role', (req: Request, res: Response) => {
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
    // Last-admin protection: count + update aren't atomic. The window between count
    // check and updateRole is a few SQLite ops; concurrent demotions could each see
    // count=2 and both proceed, leaving zero admins. Acceptable for home-server scale.
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

  router.post('/users/:id/toggle-active', (req: Request, res: Response) => {
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

  router.post('/users/:id/reset-password', (req: Request, res: Response, next: NextFunction) => {
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

  router.post('/invites', (req: Request, res: Response) => {
    const body = req.body as Record<string, string>;
    const role = body.role === 'admin' ? 'admin' : 'user';
    const ttlHoursRaw = parseInt(body.ttl_hours ?? '72', 10);
    const ttlHours =
      Number.isInteger(ttlHoursRaw) && ttlHoursRaw > 0 ? Math.min(ttlHoursRaw, 24 * 365) : 72;
    const slackUserIdRaw = (body.slack_user_id ?? '').trim();
    const slackUserId = slackUserIdRaw || undefined;
    if (slackUserId && !/^U[A-Z0-9]+$/.test(slackUserId)) {
      res.redirect(
        302,
        '/admin/users?error=' +
          encodeURIComponent('Pre-link Slack ID must look like U01ABC...'),
      );
      return;
    }

    // Resolve the requesting admin's user-row id for invite_codes.created_by.
    //
    // Three session shapes:
    //   - 'admin'      → static emergency-token; no user row exists. Use 0 as sentinel.
    //   - 'web:<user>' → look up by username.
    //   - 'U...'       → look up by Slack ID.
    const userStore = getUserStore(dbPath);
    const sessionUserId = res.locals.userId as string;
    let createdByUserId: number;
    if (sessionUserId === 'admin') {
      createdByUserId = 0;
    } else {
      const requester = sessionUserId.startsWith('web:')
        ? userStore.getByUsername(sessionUserId.slice(4))
        : userStore.getBySlackId(sessionUserId);
      if (!requester) {
        res.redirect(
          302,
          '/admin/users?error=' +
            encodeURIComponent(
              'Your account is not in the users table. Run `npm run manage-users create-user` first.',
            ),
        );
        return;
      }
      createdByUserId = requester.id;
    }

    const inviteStore = getInviteStore(dbPath);
    inviteStore.createInvite(createdByUserId, { role, ttlHours, slackUserId });
    logger.info('Admin created invite via web', { actor: sessionUserId, role, ttlHours });
    res.redirect(302, '/admin/users?flash=Invite+created.');
  });

  router.post('/invites/:code/delete', (req: Request, res: Response) => {
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

  return router;
}

import type { Middleware, AnyMiddlewareArgs, SlackCommandMiddlewareArgs } from '@slack/bolt';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { getUserStore, resolveUserStoreDbPath } from '../services/user-store.js';
import type { User } from '../types/user.js';

/**
 * Authorization middleware that checks if a user/channel is allowed to execute commands.
 *
 * Source-of-truth order:
 * 1. The `users` SQLite table (primary). User must exist + `is_active`.
 *    Their `role` is attached to `args.context.userRole` for downstream handlers.
 * 2. The `AUTHORIZED_USER_IDS` env var (deprecated fallback). Logged with a
 *    deprecation warning so operators are nudged to seed the users table
 *    via `npm run manage-users` once that ships.
 *
 * If the users table can't be read (storage error), the request is rejected
 * outright. Falling back to the env-var allowlist on a DB error would let a
 * deactivated user — who is no longer in the table but might still be in
 * env config — slip through.
 *
 * Security behavior:
 * - Silent rejection for unauthorized users (no response, prevents enumeration).
 * - Logs unauthorized attempts for security monitoring.
 * - Channel restrictions still apply on top of the user check.
 */
export const authorizeMiddleware: Middleware<AnyMiddlewareArgs> = async (args) => {
  const { next } = args;

  if (!('command' in args)) {
    await next();
    return;
  }

  const commandArgs = args as unknown as SlackCommandMiddlewareArgs;
  const command = commandArgs.command;
  const userId = command.user_id;
  const channelId = command.channel_id;

  let dbUser: User | null;
  try {
    dbUser = getUserStore(resolveUserStoreDbPath(config.claude?.dbPath)).getBySlackId(userId);
  } catch (err) {
    // Storage failure — fail closed rather than fall back to a weaker
    // auth path that could admit a deactivated user.
    logger.error('Rejecting command — UserStore unavailable in authorize middleware', {
      userId,
      command: command.command,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  let role: 'admin' | 'user' | null = null;
  let admittedVia: 'users-table' | 'env-fallback' | null = null;

  if (dbUser) {
    if (!dbUser.isActive) {
      logger.warn('Deactivated user attempted command', {
        userId,
        userName: command.user_name,
        command: command.command,
      });
      return;
    }
    role = dbUser.role;
    admittedVia = 'users-table';
  } else if (config.authorization.userIds.includes(userId)) {
    role = 'user';
    admittedVia = 'env-fallback';
    logger.warn(
      'User admitted via deprecated AUTHORIZED_USER_IDS fallback — seed the users table',
      {
        userId,
        userName: command.user_name,
      },
    );
  }

  if (admittedVia === null) {
    logger.warn('Unauthorized user attempted command', {
      userId,
      userName: command.user_name,
      channelId,
      channelName: command.channel_name,
      command: command.command,
      args: command.text,
    });
    return;
  }

  // Channel authorization (unchanged from before this PR).
  if (
    config.authorization.channelIds.length > 0 &&
    !config.authorization.channelIds.includes(channelId)
  ) {
    logger.warn('Command from unauthorized channel', {
      userId,
      userName: command.user_name,
      channelId,
      channelName: command.channel_name,
      command: command.command,
    });
    return;
  }

  // Expose the user's role on the Bolt context so command handlers can
  // distinguish admin from user without re-querying the store.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any -- Bolt's context type is loosely typed
  (args as any).context.userRole = role;

  await next();
};

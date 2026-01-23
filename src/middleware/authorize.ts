import type { Middleware, AnyMiddlewareArgs, SlackCommandMiddlewareArgs } from '@slack/bolt';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

/**
 * Authorization middleware that checks if a user/channel is allowed to execute commands.
 *
 * Security behavior:
 * - Silent rejection for unauthorized users (no response, prevents enumeration)
 * - Logs unauthorized attempts for security monitoring
 * - Checks user ID against allowlist
 * - Optionally checks channel ID if channel restrictions are configured
 */
export const authorizeMiddleware: Middleware<AnyMiddlewareArgs> = async (args) => {
  const { next } = args;

  // Only apply to commands
  if (!('command' in args)) {
    await next();
    return;
  }

  const commandArgs = args as unknown as SlackCommandMiddlewareArgs;
  const command = commandArgs.command;
  const userId = command.user_id;
  const channelId = command.channel_id;

  // Check user authorization
  if (!config.authorization.userIds.includes(userId)) {
    logger.warn('Unauthorized user attempted command', {
      userId,
      userName: command.user_name,
      channelId,
      channelName: command.channel_name,
      command: command.command,
      args: command.text,
    });
    // Silent rejection - don't reveal that authorization failed
    // This prevents attackers from knowing the bot exists or probing for valid users
    return;
  }

  // Check channel authorization (if configured)
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
    // Silent rejection for channel restrictions too
    return;
  }

  // User is authorized, proceed to next middleware/handler
  await next();
};

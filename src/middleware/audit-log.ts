import type { Middleware, AnyMiddlewareArgs, SlackCommandMiddlewareArgs } from '@slack/bolt';
import { auditLog } from '../utils/logger.js';

/**
 * Audit logging middleware that records all command executions.
 *
 * Logs:
 * - Timestamp (added by logger)
 * - User ID and username
 * - Channel ID and name
 * - Command executed
 * - Arguments provided
 *
 * This runs AFTER authorization, so only authorized commands are logged here.
 * Unauthorized attempts are logged separately by the authorize middleware.
 */
export const auditLogMiddleware: Middleware<AnyMiddlewareArgs> = async (args) => {
  const { next } = args;

  // Only apply to commands
  if (!('command' in args)) {
    await next();
    return;
  }

  const commandArgs = args as unknown as SlackCommandMiddlewareArgs;
  const command = commandArgs.command;

  // Log the command execution
  auditLog({
    userId: command.user_id,
    userName: command.user_name,
    channelId: command.channel_id,
    channelName: command.channel_name,
    command: command.command,
    args: command.text,
  });

  // Continue to command handler
  await next();
};

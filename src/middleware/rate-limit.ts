import type { Middleware, AnyMiddlewareArgs, SlackCommandMiddlewareArgs } from '@slack/bolt';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

/**
 * Rate limit entry for a user
 */
interface RateLimitEntry {
  count: number;
  resetAt: number;
}

/**
 * In-memory rate limit store
 * Key: Slack user ID, Value: request count and reset time
 *
 * Note: For multi-instance deployments, consider using Redis instead
 */
const rateLimitStore = new Map<string, RateLimitEntry>();

/**
 * Clean up expired entries periodically to prevent memory leaks
 */
function cleanupExpiredEntries(): void {
  const now = Date.now();
  for (const [userId, entry] of rateLimitStore.entries()) {
    if (now > entry.resetAt) {
      rateLimitStore.delete(userId);
    }
  }
}

// Run cleanup every 5 minutes
setInterval(cleanupExpiredEntries, 5 * 60 * 1000);

/**
 * Rate limiting middleware to prevent abuse.
 *
 * Configuration:
 * - max: Maximum requests per window (default: 10)
 * - windowSeconds: Window duration in seconds (default: 60)
 *
 * Behavior:
 * - Tracks requests per user in memory
 * - Returns friendly error when limit exceeded
 * - Logs rate limit violations
 */
export const rateLimitMiddleware: Middleware<AnyMiddlewareArgs> = async (args) => {
  const { next } = args;

  // Only apply to commands
  if (!('command' in args)) {
    await next();
    return;
  }

  const commandArgs = args as unknown as SlackCommandMiddlewareArgs;
  const command = commandArgs.command;
  const respond = commandArgs.respond;

  const userId = command.user_id;
  const now = Date.now();
  const windowMs = config.rateLimit.windowSeconds * 1000;

  // Get or create rate limit entry
  let userLimit = rateLimitStore.get(userId);

  if (!userLimit || now > userLimit.resetAt) {
    // Window expired, create new entry
    userLimit = { count: 0, resetAt: now + windowMs };
  }

  // Increment request count
  userLimit.count++;
  rateLimitStore.set(userId, userLimit);

  // Check if over limit
  if (userLimit.count > config.rateLimit.max) {
    const waitSeconds = Math.ceil((userLimit.resetAt - now) / 1000);

    logger.warn('Rate limit exceeded', {
      userId,
      userName: command.user_name,
      count: userLimit.count,
      limit: config.rateLimit.max,
      waitSeconds,
    });

    await respond({
      text: `Rate limit exceeded. Please wait ${String(waitSeconds)} seconds before trying again.`,
      response_type: 'ephemeral',
    });
    return;
  }

  // Under limit, proceed
  await next();
};

/**
 * Get current rate limit status for a user (for testing/debugging)
 */
export function getRateLimitStatus(
  userId: string
): { remaining: number; resetIn: number } | null {
  const entry = rateLimitStore.get(userId);
  if (!entry) return null;

  const now = Date.now();
  if (now > entry.resetAt) return null;

  return {
    remaining: Math.max(0, config.rateLimit.max - entry.count),
    resetIn: Math.ceil((entry.resetAt - now) / 1000),
  };
}

/**
 * Clear rate limit for a user (for testing)
 */
export function clearRateLimit(userId: string): void {
  rateLimitStore.delete(userId);
}

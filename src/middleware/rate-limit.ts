import type { Middleware, AnyMiddlewareArgs, SlackCommandMiddlewareArgs } from '@slack/bolt';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

/**
 * Token bucket for rate limiting
 *
 * Each bucket has a maximum capacity (burst) and refills at a steady rate.
 * This allows natural bursts up to `max` tokens, then steady-state at `refillRate`.
 */
interface TokenBucket {
  tokens: number;
  lastRefill: number;
  max: number;
  refillRate: number; // tokens per millisecond
}

/**
 * Rate limit configuration for a command
 */
interface RateLimitConfig {
  max: number;
  windowSeconds: number;
}

/**
 * In-memory token bucket store
 * Key: "userId:command" (e.g., "U123:/services")
 */
const bucketStore = new Map<string, TokenBucket>();

/**
 * Get rate limit config for a specific command, falling back to default
 */
function getCommandConfig(command: string): RateLimitConfig {
  const commandConfig = config.rateLimit.commands[command];
  if (commandConfig) {
    return commandConfig;
  }
  return {
    max: config.rateLimit.max,
    windowSeconds: config.rateLimit.windowSeconds,
  };
}

/**
 * Get or create a token bucket for a user+command pair
 */
function getBucket(key: string, cfg: RateLimitConfig): TokenBucket {
  let bucket = bucketStore.get(key);
  if (!bucket) {
    bucket = {
      tokens: cfg.max,
      lastRefill: Date.now(),
      max: cfg.max,
      refillRate: cfg.max / (cfg.windowSeconds * 1000),
    };
    bucketStore.set(key, bucket);
  }
  return bucket;
}

/**
 * Refill tokens based on elapsed time
 */
function refillBucket(bucket: TokenBucket, now: number): void {
  const elapsed = now - bucket.lastRefill;
  if (elapsed > 0) {
    bucket.tokens = Math.min(bucket.max, bucket.tokens + elapsed * bucket.refillRate);
    bucket.lastRefill = now;
  }
}

/**
 * Try to consume a token from the bucket
 * @returns true if token consumed, false if bucket empty
 */
function tryConsume(bucket: TokenBucket): boolean {
  const now = Date.now();
  refillBucket(bucket, now);

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return true;
  }
  return false;
}

/**
 * Clean up stale buckets (fully refilled buckets older than 2x window)
 */
function cleanupStaleBuckets(): void {
  const now = Date.now();
  for (const [key, bucket] of bucketStore.entries()) {
    const windowMs = bucket.max / bucket.refillRate;
    if (now - bucket.lastRefill > windowMs * 2) {
      bucketStore.delete(key);
    }
  }
}

// Run cleanup every 5 minutes
const cleanupInterval = setInterval(cleanupStaleBuckets, 5 * 60 * 1000);

/**
 * Rate limiting middleware using token bucket algorithm.
 *
 * Features:
 * - Per-command rate limits (different limits for /ask vs /services)
 * - Burst allowance (can use up to `max` tokens immediately)
 * - Steady-state refill (tokens refill over `windowSeconds`)
 * - Falls back to default config for unconfigured commands
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
  const commandName = command.command; // e.g., "/services"
  const bucketKey = `${userId}:${commandName}`;

  const cfg = getCommandConfig(commandName);
  const bucket = getBucket(bucketKey, cfg);

  if (!tryConsume(bucket)) {
    // Calculate wait time until 1 token is available
    const tokensNeeded = 1 - bucket.tokens;
    const waitMs = tokensNeeded / bucket.refillRate;
    const waitSeconds = Math.ceil(waitMs / 1000);

    logger.warn('Rate limit exceeded', {
      userId,
      userName: command.user_name,
      command: commandName,
      tokensRemaining: bucket.tokens,
      limit: cfg.max,
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
 * Get current rate limit status for a user+command (for testing/debugging)
 */
export function getRateLimitStatus(
  userId: string,
  command?: string
): { remaining: number; resetIn: number } | null {
  // If no command specified, check legacy key format (userId only)
  const key = command ? `${userId}:${command}` : userId;

  // Try exact key first, then search by prefix for backward compat
  let bucket = bucketStore.get(key);
  if (!bucket && !command) {
    // Find first bucket for this user
    for (const [k, v] of bucketStore.entries()) {
      if (k.startsWith(`${userId}:`)) {
        bucket = v;
        break;
      }
    }
  }

  if (!bucket) return null;

  const now = Date.now();
  refillBucket(bucket, now);

  const remaining = Math.floor(bucket.tokens);
  const tokensNeeded = bucket.max - bucket.tokens;
  const resetMs = tokensNeeded > 0 ? tokensNeeded / bucket.refillRate : 0;
  const resetIn = Math.ceil(resetMs / 1000);

  return { remaining, resetIn };
}

/**
 * Clear rate limit for a user (for testing)
 * Clears all buckets for the user across all commands
 */
export function clearRateLimit(userId: string): void {
  for (const key of bucketStore.keys()) {
    if (key === userId || key.startsWith(`${userId}:`)) {
      bucketStore.delete(key);
    }
  }
}

/**
 * Stop the rate limit cleanup interval (for shutdown)
 */
export function stopRateLimitCleanup(): void {
  clearInterval(cleanupInterval);
}

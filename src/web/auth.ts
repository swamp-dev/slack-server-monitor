/**
 * Web UI authentication utilities
 *
 * Provides token resolution and cookie parsing for per-user auth.
 * Uses crypto.timingSafeEqual for token comparison to prevent timing attacks.
 */

import crypto from 'crypto';
import type { WebConfig } from '../config/schema.js';

/**
 * Resolved identity from a token
 */
export interface TokenIdentity {
  userId: string;
  isAdmin: boolean;
}

/**
 * Resolve a token to a user identity
 *
 * Checks admin token first, then per-user tokens.
 * Uses timing-safe comparison with length check to prevent timing attacks.
 *
 * @returns Identity if token is valid, null otherwise
 */
export function resolveToken(token: string, webConfig: WebConfig): TokenIdentity | null {
  if (!token) return null;

  // Check admin token
  if (timingSafeCompare(token, webConfig.authToken)) {
    return { userId: 'admin', isAdmin: true };
  }

  // Check per-user tokens
  for (const userToken of webConfig.userTokens) {
    if (timingSafeCompare(token, userToken.token)) {
      return { userId: userToken.userId, isAdmin: false };
    }
  }

  return null;
}

/**
 * Timing-safe string comparison
 * Returns false early if lengths differ (this leaks length, not content).
 */
function timingSafeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Parse cookies from a Cookie header string
 * Simple parser — no dependencies needed
 */
export function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};

  const result: Record<string, string> = {};
  const pairs = header.split(';');

  for (const pair of pairs) {
    const eqIndex = pair.indexOf('=');
    if (eqIndex === -1) continue;

    const key = pair.slice(0, eqIndex).trim();
    const value = pair.slice(eqIndex + 1).trim();
    if (key) {
      result[key] = value;
    }
  }

  return result;
}

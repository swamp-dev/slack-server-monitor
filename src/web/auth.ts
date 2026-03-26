/**
 * Web UI authentication utilities
 *
 * Provides HMAC-signed link tokens, token resolution, and cookie parsing.
 * Link tokens are short-lived, signed with the server's auth token (HMAC-SHA256).
 * Static admin token is supported for emergency /login access.
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
 * Create a short-lived HMAC-signed link token
 *
 * Format: base64url(payload).base64url(HMAC-SHA256(payload, secret))
 * Payload: {"u":"<userId>","e":<expiryUnixSeconds>}
 *
 * @param userId - Slack user ID to encode
 * @param signingSecret - HMAC signing secret (WEB_AUTH_TOKEN)
 * @param ttlMinutes - Token lifetime in minutes
 * @returns Signed token string
 */
export function createLinkToken(userId: string, signingSecret: string, ttlMinutes: number): string {
  const expiry = Math.floor(Date.now() / 1000) + ttlMinutes * 60;
  const payload = JSON.stringify({ u: userId, e: expiry });
  const payloadB64 = Buffer.from(payload).toString('base64url');
  const signature = crypto.createHmac('sha256', signingSecret).update(payloadB64).digest();
  const signatureB64 = signature.toString('base64url');
  return `${payloadB64}.${signatureB64}`;
}

/**
 * Verify an HMAC-signed link token
 *
 * @param token - Token string to verify
 * @param signingSecret - HMAC signing secret
 * @returns Decoded identity if valid and not expired, null otherwise
 */
export function verifyLinkToken(token: string, signingSecret: string): { userId: string } | null {
  if (!token) return null;

  // Expect exactly one dot — base64url alphabet (A-Za-z0-9-_) never contains '.'
  const dotIndex = token.indexOf('.');
  if (dotIndex === -1 || token.includes('.', dotIndex + 1)) return null;

  const payloadB64 = token.slice(0, dotIndex);
  const signatureB64 = token.slice(dotIndex + 1);

  // Verify HMAC signature
  let expectedSignature: Buffer;
  let actualSignature: Buffer;
  try {
    expectedSignature = crypto.createHmac('sha256', signingSecret).update(payloadB64).digest();
    actualSignature = Buffer.from(signatureB64, 'base64url');
  } catch {
    return null;
  }

  if (expectedSignature.length !== actualSignature.length) return null;
  if (!crypto.timingSafeEqual(expectedSignature, actualSignature)) return null;

  // Parse payload
  let payload: { u: string; e: number };
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString()) as { u: string; e: number };
  } catch {
    return null;
  }

  if (typeof payload.u !== 'string' || typeof payload.e !== 'number') return null;

  // Check expiry
  const now = Math.floor(Date.now() / 1000);
  if (payload.e <= now) return null;

  return { userId: payload.u };
}

/**
 * Resolve a token to a user identity
 *
 * Tries HMAC link token verification first, then static admin token.
 * Uses timing-safe comparison for all checks to prevent timing attacks.
 *
 * @returns Identity if token is valid, null otherwise
 */
export function resolveToken(token: string, webConfig: WebConfig): TokenIdentity | null {
  if (!token) return null;

  // Try HMAC link token
  const hmacResult = verifyLinkToken(token, webConfig.authToken);
  if (hmacResult) {
    return { userId: hmacResult.userId, isAdmin: false };
  }

  // Try static admin token
  if (timingSafeCompare(token, webConfig.authToken)) {
    return { userId: 'admin', isAdmin: true };
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

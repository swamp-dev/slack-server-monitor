/**
 * Sliding-window IP rate limiter for unauthenticated auth endpoints.
 *
 * Used by `POST /login` and `POST /register` to slow down brute-force
 * attempts and invite-code enumeration. Limits are per-(scope, ip) so
 * login and register attempts don't share a budget.
 *
 * In-memory only — restarts wipe state. That's acceptable for this
 * single-instance deployment; a multi-process variant would need Redis.
 */

const LOGIN_LIMIT_DEFAULT = { max: 5, windowMs: 15 * 60 * 1000 };

interface BucketEntry {
  /** Timestamps of allowed (recorded) hits, ms since epoch. */
  hits: number[];
}

const buckets = new Map<string, BucketEntry>();

function bucketKey(scope: string, ip: string): string {
  return `${scope}|${ip}`;
}

/**
 * Try to record a hit for `(scope, ip)`. Returns `true` if the request
 * should proceed (under the limit) and `false` if it should be rejected
 * (over the limit). The caller is responsible for sending a 429.
 *
 * Pruning: entries older than the window are discarded on each call.
 * The map itself is bounded only by the number of active IPs in the
 * current window — fine for a personal home server, would grow under
 * a real attack but timestamps still expire so memory stays linear.
 */
export function checkAndRecordAuthHit(
  scope: 'login' | 'register',
  ip: string,
  limit: { max: number; windowMs: number } = LOGIN_LIMIT_DEFAULT,
): boolean {
  const now = Date.now();
  const key = bucketKey(scope, ip);
  const entry = buckets.get(key) ?? { hits: [] };
  const recent = entry.hits.filter((t) => now - t < limit.windowMs);

  if (recent.length >= limit.max) {
    // Don't record — keep existing hits as-is; they'll expire in time.
    buckets.set(key, { hits: recent });
    return false;
  }

  recent.push(now);
  buckets.set(key, { hits: recent });
  return true;
}

/**
 * Peek without recording: returns `true` if a hit *would* be allowed,
 * `false` if it would be rejected. Use this to short-circuit expensive
 * work (like scrypt verify) before doing it, then call `recordAuthFailure`
 * once you know the attempt failed and should consume a slot.
 */
export function isAuthHitAllowed(
  scope: 'login' | 'register',
  ip: string,
  limit: { max: number; windowMs: number } = LOGIN_LIMIT_DEFAULT,
): boolean {
  const now = Date.now();
  const key = bucketKey(scope, ip);
  const entry = buckets.get(key) ?? { hits: [] };
  const recent = entry.hits.filter((t) => now - t < limit.windowMs);
  return recent.length < limit.max;
}

/**
 * Record a failure (consumes a slot). No-op on the bucket-full case; the
 * caller already returned 429 from a prior `isAuthHitAllowed` check.
 */
export function recordAuthFailure(
  scope: 'login' | 'register',
  ip: string,
  limit: { max: number; windowMs: number } = LOGIN_LIMIT_DEFAULT,
): void {
  // Reuse the recording side of checkAndRecordAuthHit so the pruning logic
  // stays in one place.
  checkAndRecordAuthHit(scope, ip, limit);
}

/**
 * Test-only: clear all rate-limit state. Not exported for production
 * use; prevents tests from leaking state into each other.
 */
export function _resetAuthRateLimits(): void {
  buckets.clear();
}

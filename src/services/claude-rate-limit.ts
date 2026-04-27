import { config } from '../config/index.js';

const claudeRateLimits = new Map<string, number[]>();

export function checkAndRecordClaudeRequest(userId: string): boolean {
  if (!config.claude) return false;

  const now = Date.now();
  const windowMs = config.claude.rateLimitWindowSeconds * 1000;
  const requests = claudeRateLimits.get(userId) ?? [];

  const validRequests = requests.filter(t => now - t < windowMs);

  if (validRequests.length >= config.claude.rateLimitMax) {
    claudeRateLimits.set(userId, validRequests);
    return false;
  }

  validRequests.push(now);
  claudeRateLimits.set(userId, validRequests);

  // Prune entries for other users whose timestamps have all expired.
  for (const [uid, timestamps] of claudeRateLimits) {
    if (uid === userId) continue;
    if (timestamps.every(t => now - t >= windowMs)) {
      claudeRateLimits.delete(uid);
    }
  }

  return true;
}

export function getRemainingRequests(userId: string): number {
  if (!config.claude) return 0;

  const now = Date.now();
  const windowMs = config.claude.rateLimitWindowSeconds * 1000;
  const requests = claudeRateLimits.get(userId) ?? [];
  const validRequests = requests.filter(t => now - t < windowMs);

  return Math.max(0, config.claude.rateLimitMax - validRequests.length);
}

export function clearRateLimitForUser(userId: string): void {
  claudeRateLimits.delete(userId);
}

export function clearAllRateLimits(): void {
  claudeRateLimits.clear();
}

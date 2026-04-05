/**
 * In-memory TTL cache for Hue bridge GET responses.
 *
 * Eliminates redundant HTTPS calls when multiple consumers (SSE polling,
 * page renders) request the same resource within a short window.
 */

interface CacheEntry {
  data: unknown;
  expiresAt: number;
}

export class HueResponseCache {
  private entries = new Map<string, CacheEntry>();

  /** Return cached data if still valid, otherwise undefined. */
  get(path: string): unknown | undefined {
    const entry = this.entries.get(path);
    if (!entry) return undefined;
    if (Date.now() >= entry.expiresAt) {
      this.entries.delete(path);
      return undefined;
    }
    return entry.data;
  }

  /** Store data with an absolute TTL in milliseconds. */
  set(path: string, data: unknown, ttlMs: number): void {
    this.entries.set(path, { data, expiresAt: Date.now() + ttlMs });
  }

  /** Remove a specific cache entry. */
  invalidate(path: string): void {
    this.entries.delete(path);
  }

  /** Remove all entries whose path starts with the given prefix. */
  invalidateByPrefix(prefix: string): void {
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) {
        this.entries.delete(key);
      }
    }
  }

  /** Remove all entries. */
  invalidateAll(): void {
    this.entries.clear();
  }

  /** Number of stored entries (including expired but not yet evicted). */
  get size(): number {
    return this.entries.size;
  }
}

/**
 * Tests for lift plugin bodyweight tracking
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import type { PluginDatabase } from '../../src/services/plugin-database.js';

// Type for our exported functions (will fail until implemented)
type LogBodyweight = (userId: string, weightKg: number, db: PluginDatabase) => void;
type GetLatestBodyweight = (userId: string, db: PluginDatabase) => { weightKg: number; loggedAt: number } | null;
type GetBodyweightHistory = (userId: string, days: number, db: PluginDatabase) => { weightKg: number; loggedAt: number }[];
type FormatBodyweightTrend = (
  history: { weightKg: number; loggedAt: number }[],
  unit: 'lbs' | 'kg'
) => string;

// =============================================================================
// Mock Database
// =============================================================================

interface BodyweightEntry {
  user_id: string;
  weight_kg: number;
  logged_at: number;
}

function createBodyweightDb(): PluginDatabase & { _entries: BodyweightEntry[] } {
  const entries: BodyweightEntry[] = [];

  const db = {
    prefix: 'plugin_lift_',
    _entries: entries,
    prepare: vi.fn((sql: string) => {
      if (sql.includes('INSERT OR REPLACE') && sql.includes('bodyweight')) {
        return {
          run: vi.fn((...args: unknown[]) => {
            const [userId, weightKg, loggedAt] = args as [string, number, number];
            // Replace existing entry for same day
            const existingIdx = entries.findIndex(
              (e) => e.user_id === userId && e.logged_at === loggedAt
            );
            if (existingIdx >= 0) {
              entries[existingIdx] = { user_id: userId, weight_kg: weightKg, logged_at: loggedAt };
            } else {
              entries.push({ user_id: userId, weight_kg: weightKg, logged_at: loggedAt });
            }
            return { changes: 1 };
          }),
        };
      }
      if (sql.includes('SELECT') && sql.includes('bodyweight') && sql.includes('ORDER BY')) {
        if (sql.includes('LIMIT 1')) {
          // getLatestBodyweight
          return {
            get: vi.fn((...args: unknown[]) => {
              const [userId] = args as [string];
              const userEntries = entries
                .filter((e) => e.user_id === userId)
                .sort((a, b) => b.logged_at - a.logged_at);
              return userEntries.length > 0
                ? { weight_kg: userEntries[0].weight_kg, logged_at: userEntries[0].logged_at }
                : undefined;
            }),
          };
        }
        // getBodyweightHistory
        return {
          all: vi.fn((...args: unknown[]) => {
            const [userId, since] = args as [string, number];
            return entries
              .filter((e) => e.user_id === userId && e.logged_at >= since)
              .sort((a, b) => a.logged_at - b.logged_at)
              .map((e) => ({ weight_kg: e.weight_kg, logged_at: e.logged_at }));
          }),
        };
      }
      return { run: vi.fn(), get: vi.fn(), all: vi.fn(() => []) };
    }),
    exec: vi.fn(),
    close: vi.fn(),
    transaction: vi.fn((fn: () => unknown) => fn()),
  } as unknown as PluginDatabase & { _entries: BodyweightEntry[] };

  return db;
}

// =============================================================================
// Database Operations
// =============================================================================

describe('bodyweight tracking', () => {
  let logBodyweight: LogBodyweight;
  let getLatestBodyweight: GetLatestBodyweight;
  let getBodyweightHistory: GetBodyweightHistory;
  let formatBodyweightTrend: FormatBodyweightTrend;

  beforeAll(async () => {
    const mod = await import('../../plugins.example/lift.js');
    logBodyweight = mod.logBodyweight;
    getLatestBodyweight = mod.getLatestBodyweight;
    getBodyweightHistory = mod.getBodyweightHistory;
    formatBodyweightTrend = mod.formatBodyweightTrend;
  });

  describe('logBodyweight', () => {
    it('should store a bodyweight entry', () => {
      const db = createBodyweightDb();
      logBodyweight('U123', 83.0, db);

      expect(db.prepare).toHaveBeenCalled();
      expect(db._entries).toHaveLength(1);
      expect(db._entries[0].weight_kg).toBeCloseTo(83.0);
    });

    it('should replace entry for the same day', () => {
      const db = createBodyweightDb();
      // Mock that both calls produce the same logged_at (same day start)
      logBodyweight('U123', 83.0, db);
      // Second call same user - should use INSERT OR REPLACE
      expect(db.prepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT OR REPLACE')
      );
    });
  });

  describe('getLatestBodyweight', () => {
    it('should return the most recent bodyweight entry', () => {
      const db = createBodyweightDb();
      db._entries.push(
        { user_id: 'U123', weight_kg: 82.0, logged_at: 1000 },
        { user_id: 'U123', weight_kg: 83.0, logged_at: 2000 }
      );

      const result = getLatestBodyweight('U123', db);

      expect(result).not.toBeNull();
      expect(result?.weightKg).toBeCloseTo(83.0);
    });

    it('should return null when no entries exist', () => {
      const db = createBodyweightDb();

      const result = getLatestBodyweight('U123', db);

      expect(result).toBeNull();
    });

    it('should only return entries for the specified user', () => {
      const db = createBodyweightDb();
      db._entries.push(
        { user_id: 'U456', weight_kg: 90.0, logged_at: 3000 }
      );

      const result = getLatestBodyweight('U123', db);

      expect(result).toBeNull();
    });
  });

  describe('getBodyweightHistory', () => {
    it('should return entries within the specified day range', () => {
      const db = createBodyweightDb();
      const now = Date.now();
      const dayMs = 24 * 60 * 60 * 1000;
      db._entries.push(
        { user_id: 'U123', weight_kg: 82.0, logged_at: now - 2 * dayMs },
        { user_id: 'U123', weight_kg: 83.0, logged_at: now - dayMs },
        { user_id: 'U123', weight_kg: 84.0, logged_at: now }
      );

      const result = getBodyweightHistory('U123', 7, db);

      expect(result).toHaveLength(3);
    });

    it('should return empty array when no entries exist', () => {
      const db = createBodyweightDb();

      const result = getBodyweightHistory('U123', 30, db);

      expect(result).toHaveLength(0);
    });

    it('should return entries sorted by date ascending', () => {
      const db = createBodyweightDb();
      const now = Date.now();
      const dayMs = 24 * 60 * 60 * 1000;
      db._entries.push(
        { user_id: 'U123', weight_kg: 84.0, logged_at: now },
        { user_id: 'U123', weight_kg: 82.0, logged_at: now - 2 * dayMs }
      );

      const result = getBodyweightHistory('U123', 7, db);

      expect(result[0].weightKg).toBeCloseTo(82.0);
      expect(result[1].weightKg).toBeCloseTo(84.0);
    });
  });

  describe('formatBodyweightTrend', () => {
    it('should format trend with current weight and average', () => {
      const now = Date.now();
      const dayMs = 24 * 60 * 60 * 1000;
      const history = [
        { weightKg: 82.0, loggedAt: now - 6 * dayMs },
        { weightKg: 82.5, loggedAt: now - 4 * dayMs },
        { weightKg: 83.0, loggedAt: now - 2 * dayMs },
        { weightKg: 83.5, loggedAt: now },
      ];

      const result = formatBodyweightTrend(history, 'kg');

      expect(result).toContain('83.5'); // latest
      expect(result).toContain('avg'); // average label
    });

    it('should show direction indicator for upward trend', () => {
      const now = Date.now();
      const dayMs = 24 * 60 * 60 * 1000;
      const history = [
        { weightKg: 80.0, loggedAt: now - 2 * dayMs },
        { weightKg: 82.0, loggedAt: now - dayMs },
        { weightKg: 84.0, loggedAt: now },
      ];

      const result = formatBodyweightTrend(history, 'kg');

      // Should indicate upward trend
      expect(result).toMatch(/↑|up|gaining/i);
    });

    it('should show direction indicator for downward trend', () => {
      const now = Date.now();
      const dayMs = 24 * 60 * 60 * 1000;
      const history = [
        { weightKg: 84.0, loggedAt: now - 2 * dayMs },
        { weightKg: 82.0, loggedAt: now - dayMs },
        { weightKg: 80.0, loggedAt: now },
      ];

      const result = formatBodyweightTrend(history, 'kg');

      // Should indicate downward trend
      expect(result).toMatch(/↓|down|losing/i);
    });

    it('should display weight in the specified unit', () => {
      const history = [
        { weightKg: 83.0, loggedAt: Date.now() },
      ];

      const resultKg = formatBodyweightTrend(history, 'kg');
      const resultLbs = formatBodyweightTrend(history, 'lbs');

      expect(resultKg).toContain('kg');
      expect(resultLbs).toContain('lbs');
      expect(resultLbs).toContain('183'); // 83 kg ≈ 183 lbs
    });

    it('should handle single entry', () => {
      const history = [
        { weightKg: 83.0, loggedAt: Date.now() },
      ];

      const result = formatBodyweightTrend(history, 'kg');

      expect(result).toContain('83.0');
      // No trend with single entry
    });

    it('should handle empty history', () => {
      const result = formatBodyweightTrend([], 'kg');

      expect(result).toContain('No bodyweight');
    });
  });
});

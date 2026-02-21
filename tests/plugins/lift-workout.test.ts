/**
 * Tests for the lift plugin workout set tracking
 *
 * Tests cover: argument parsing, unit conversion, DB operations (log, query),
 * PR detection, and formatting.
 *
 * Pure functions are exported from the plugin and tested directly.
 * Database operations use an in-memory SQLite database.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { PluginDatabase } from '../../src/services/plugin-database.js';
import {
  parseLogArgs,
  lbsToKg,
  kgToLbs,
  formatWeight,
  logWorkoutSet,
  getWorkoutForDate,
  checkForPR,
  getPersonalRecords,
  getAllPersonalRecords,
  type WorkoutSet,
  type PersonalRecord,
} from '../../plugins.example/lift.js';

// =============================================================================
// Step 1: Argument Parsing
// =============================================================================

describe('lift plugin workout tracking', () => {
  describe('parseLogArgs', () => {
    describe('valid inputs', () => {
      it('should parse single-word exercise with weight and reps', () => {
        expect(parseLogArgs(['squat', '100', '5'])).toEqual({
          exercise: 'squat',
          weight: 100,
          reps: 5,
          rpe: undefined,
        });
      });

      it('should parse multi-word exercise names', () => {
        expect(parseLogArgs(['bench', 'press', '80', '8'])).toEqual({
          exercise: 'bench press',
          weight: 80,
          reps: 8,
          rpe: undefined,
        });
      });

      it('should parse three-word exercise names', () => {
        expect(parseLogArgs(['close', 'grip', 'bench', '60', '10'])).toEqual({
          exercise: 'close grip bench',
          weight: 60,
          reps: 10,
          rpe: undefined,
        });
      });

      it('should parse RPE with @ prefix', () => {
        expect(parseLogArgs(['squat', '140', '3', '@8'])).toEqual({
          exercise: 'squat',
          weight: 140,
          reps: 3,
          rpe: 8,
        });
      });

      it('should parse decimal RPE', () => {
        expect(parseLogArgs(['deadlift', '180', '5', '@7.5'])).toEqual({
          exercise: 'deadlift',
          weight: 180,
          reps: 5,
          rpe: 7.5,
        });
      });

      it('should parse decimal weight', () => {
        expect(parseLogArgs(['squat', '102.5', '5'])).toEqual({
          exercise: 'squat',
          weight: 102.5,
          reps: 5,
          rpe: undefined,
        });
      });

      it('should lowercase exercise names', () => {
        expect(parseLogArgs(['Bench', 'Press', '100', '5'])).toEqual({
          exercise: 'bench press',
          weight: 100,
          reps: 5,
          rpe: undefined,
        });
      });

      it('should parse RPE of 10', () => {
        expect(parseLogArgs(['squat', '200', '1', '@10'])).toEqual({
          exercise: 'squat',
          weight: 200,
          reps: 1,
          rpe: 10,
        });
      });

      it('should parse RPE of 1', () => {
        expect(parseLogArgs(['squat', '50', '10', '@1'])).toEqual({
          exercise: 'squat',
          weight: 50,
          reps: 10,
          rpe: 1,
        });
      });
    });

    describe('invalid inputs', () => {
      it('should return null for empty args', () => {
        expect(parseLogArgs([])).toBeNull();
      });

      it('should return null for no exercise (starts with number)', () => {
        expect(parseLogArgs(['100', '5'])).toBeNull();
      });

      it('should return null for missing reps', () => {
        expect(parseLogArgs(['squat', '100'])).toBeNull();
      });

      it('should return null for exercise only', () => {
        expect(parseLogArgs(['squat'])).toBeNull();
      });

      it('should return null for zero weight', () => {
        expect(parseLogArgs(['squat', '0', '5'])).toBeNull();
      });

      it('should return null for negative weight', () => {
        expect(parseLogArgs(['squat', '-100', '5'])).toBeNull();
      });

      it('should return null for zero reps', () => {
        expect(parseLogArgs(['squat', '100', '0'])).toBeNull();
      });

      it('should return null for negative reps', () => {
        expect(parseLogArgs(['squat', '100', '-5'])).toBeNull();
      });

      it('should return null for non-integer reps', () => {
        expect(parseLogArgs(['squat', '100', '5.5'])).toBeNull();
      });

      it('should return null for reps over 100', () => {
        expect(parseLogArgs(['squat', '100', '101'])).toBeNull();
      });

      it('should return null for RPE below 1', () => {
        expect(parseLogArgs(['squat', '100', '5', '@0'])).toBeNull();
      });

      it('should return null for RPE above 10', () => {
        expect(parseLogArgs(['squat', '100', '5', '@11'])).toBeNull();
      });

      it('should return null for weight over 999', () => {
        expect(parseLogArgs(['squat', '1000', '5'])).toBeNull();
      });
    });
  });

  // =============================================================================
  // Unit Conversion
  // =============================================================================

  describe('unit conversion', () => {
    describe('lbsToKg', () => {
      it('should convert lbs to kg', () => {
        expect(lbsToKg(100)).toBeCloseTo(45.3592, 2);
      });

      it('should handle 0', () => {
        expect(lbsToKg(0)).toBe(0);
      });

      it('should convert 225 lbs', () => {
        expect(lbsToKg(225)).toBeCloseTo(102.058, 1);
      });
    });

    describe('kgToLbs', () => {
      it('should convert kg to lbs', () => {
        expect(kgToLbs(100)).toBeCloseTo(220.462, 1);
      });

      it('should handle 0', () => {
        expect(kgToLbs(0)).toBe(0);
      });

      it('should be inverse of lbsToKg', () => {
        expect(kgToLbs(lbsToKg(100))).toBeCloseTo(100, 1);
      });
    });

    describe('formatWeight', () => {
      it('should format in kg', () => {
        expect(formatWeight(100, 'kg')).toBe('100.0 kg');
      });

      it('should format in lbs', () => {
        expect(formatWeight(220.5, 'lbs')).toBe('220.5 lbs');
      });

      it('should format with one decimal place', () => {
        expect(formatWeight(102.567, 'kg')).toBe('102.6 kg');
      });

      it('should format 0 kg', () => {
        expect(formatWeight(0, 'kg')).toBe('0.0 kg');
      });
    });
  });

  // =============================================================================
  // Step 2: Core DB Operations
  // =============================================================================

  describe('database operations', () => {
    let db: Database.Database;
    let pluginDb: PluginDatabase;

    beforeEach(() => {
      db = new Database(':memory:');
      db.pragma('journal_mode = WAL');
      pluginDb = new PluginDatabase(db, 'lift');

      // Create workout_sets table (matches planned init schema)
      pluginDb.exec(`
        CREATE TABLE IF NOT EXISTS plugin_lift_workout_sets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          exercise TEXT NOT NULL,
          weight_kg REAL NOT NULL CHECK(weight_kg >= 0 AND weight_kg < 1000),
          reps INTEGER NOT NULL CHECK(reps > 0 AND reps <= 100),
          rpe REAL CHECK(rpe IS NULL OR (rpe >= 1 AND rpe <= 10)),
          logged_at INTEGER NOT NULL CHECK(logged_at > 0),
          created_at INTEGER NOT NULL CHECK(created_at > 0)
        )
      `);
      pluginDb.exec(`
        CREATE INDEX IF NOT EXISTS idx_plugin_lift_workout_sets_user_date
          ON plugin_lift_workout_sets(user_id, logged_at)
      `);
      pluginDb.exec(`
        CREATE INDEX IF NOT EXISTS idx_plugin_lift_workout_sets_user_exercise
          ON plugin_lift_workout_sets(user_id, exercise)
      `);
    });

    afterEach(() => {
      db.close();
    });

    describe('logWorkoutSet', () => {
      it('should insert a workout set', () => {
        logWorkoutSet('U123', 'squat', 100, 5, undefined, pluginDb);

        const row = pluginDb.prepare(
          `SELECT * FROM plugin_lift_workout_sets WHERE user_id = ?`
        ).get('U123') as Record<string, unknown>;

        expect(row).toBeDefined();
        expect(row.exercise).toBe('squat');
        expect(row.weight_kg).toBe(100);
        expect(row.reps).toBe(5);
        expect(row.rpe).toBeNull();
      });

      it('should store exercise name in lowercase', () => {
        logWorkoutSet('U123', 'Bench Press', 80, 8, undefined, pluginDb);

        const row = pluginDb.prepare(
          `SELECT exercise FROM plugin_lift_workout_sets WHERE user_id = ?`
        ).get('U123') as Record<string, unknown>;

        expect(row.exercise).toBe('bench press');
      });

      it('should store RPE when provided', () => {
        logWorkoutSet('U123', 'deadlift', 180, 3, 8.5, pluginDb);

        const row = pluginDb.prepare(
          `SELECT rpe FROM plugin_lift_workout_sets WHERE user_id = ?`
        ).get('U123') as Record<string, unknown>;

        expect(row.rpe).toBe(8.5);
      });

      it('should store logged_at and created_at timestamps', () => {
        const before = Date.now();
        logWorkoutSet('U123', 'squat', 100, 5, undefined, pluginDb);
        const after = Date.now();

        const row = pluginDb.prepare(
          `SELECT logged_at, created_at FROM plugin_lift_workout_sets WHERE user_id = ?`
        ).get('U123') as { logged_at: number; created_at: number };

        expect(row.logged_at).toBeGreaterThanOrEqual(before);
        expect(row.logged_at).toBeLessThanOrEqual(after);
        expect(row.created_at).toBeGreaterThanOrEqual(before);
        expect(row.created_at).toBeLessThanOrEqual(after);
      });
    });

    describe('getWorkoutForDate', () => {
      it('should return sets for today', () => {
        logWorkoutSet('U123', 'squat', 100, 5, undefined, pluginDb);
        logWorkoutSet('U123', 'bench press', 80, 8, 7, pluginDb);

        const sets = getWorkoutForDate('U123', 'today', pluginDb, null);
        expect(sets).toHaveLength(2);
        expect(sets[0].exercise).toBe('squat');
        expect(sets[1].exercise).toBe('bench press');
      });

      it('should return empty array when no sets', () => {
        const sets = getWorkoutForDate('U123', 'today', pluginDb, null);
        expect(sets).toEqual([]);
      });

      it('should isolate by user_id', () => {
        logWorkoutSet('U123', 'squat', 100, 5, undefined, pluginDb);
        logWorkoutSet('U456', 'squat', 120, 3, undefined, pluginDb);

        const sets = getWorkoutForDate('U123', 'today', pluginDb, null);
        expect(sets).toHaveLength(1);
        expect(sets[0].weightKg).toBe(100);
      });

      it('should filter by date using daysAgo', () => {
        // Insert a set "yesterday" by manipulating logged_at
        const yesterday = Date.now() - 24 * 60 * 60 * 1000;
        pluginDb.prepare(
          `INSERT INTO plugin_lift_workout_sets (user_id, exercise, weight_kg, reps, rpe, logged_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run('U123', 'squat', 100, 5, null, yesterday, yesterday);

        // Today's set
        logWorkoutSet('U123', 'bench press', 80, 8, undefined, pluginDb);

        const todaySets = getWorkoutForDate('U123', 'today', pluginDb, null);
        expect(todaySets).toHaveLength(1);
        expect(todaySets[0].exercise).toBe('bench press');
      });

      it('should return WorkoutSet shape', () => {
        logWorkoutSet('U123', 'squat', 100, 5, 8, pluginDb);

        const sets = getWorkoutForDate('U123', 'today', pluginDb, null);
        expect(sets).toHaveLength(1);

        const set = sets[0];
        expect(set).toHaveProperty('id');
        expect(set).toHaveProperty('exercise', 'squat');
        expect(set).toHaveProperty('weightKg', 100);
        expect(set).toHaveProperty('reps', 5);
        expect(set).toHaveProperty('rpe', 8);
        expect(set).toHaveProperty('loggedAt');
      });
    });

    // =========================================================================
    // Step 3: PR Detection
    // =========================================================================

    describe('checkForPR', () => {
      it('should return true for first set of an exercise (always a PR)', () => {
        const result = checkForPR('U123', 'squat', 100, 5, pluginDb);
        expect(result).toBe(true);
      });

      it('should return true when estimated 1RM is higher than previous best', () => {
        // Log an initial set: 100kg x 5 → 1RM = 100 * (1 + 5/30) = 116.67
        logWorkoutSet('U123', 'squat', 100, 5, undefined, pluginDb);

        // New set: 110kg x 5 → 1RM = 110 * (1 + 5/30) = 128.33
        const result = checkForPR('U123', 'squat', 110, 5, pluginDb);
        expect(result).toBe(true);
      });

      it('should return false when estimated 1RM is lower than previous best', () => {
        // Log an initial set: 100kg x 5 → 1RM = 116.67
        logWorkoutSet('U123', 'squat', 100, 5, undefined, pluginDb);

        // New set: 90kg x 5 → 1RM = 105.0
        const result = checkForPR('U123', 'squat', 90, 5, pluginDb);
        expect(result).toBe(false);
      });

      it('should return false when estimated 1RM equals previous best', () => {
        // Log: 100kg x 5 → 1RM = 116.67
        logWorkoutSet('U123', 'squat', 100, 5, undefined, pluginDb);

        // Same 1RM is not a new PR
        const result = checkForPR('U123', 'squat', 100, 5, pluginDb);
        expect(result).toBe(false);
      });

      it('should isolate by exercise', () => {
        // Big squat: 200kg x 1 → 1RM = 200
        logWorkoutSet('U123', 'squat', 200, 1, undefined, pluginDb);

        // Small bench: 80kg x 5 → 1RM = 93.33
        // Should be PR because no previous bench sets
        const result = checkForPR('U123', 'bench press', 80, 5, pluginDb);
        expect(result).toBe(true);
      });

      it('should detect PR via higher reps at same weight', () => {
        // 100kg x 3 → 1RM = 110.0
        logWorkoutSet('U123', 'squat', 100, 3, undefined, pluginDb);

        // 100kg x 5 → 1RM = 116.67 (higher due to more reps)
        const result = checkForPR('U123', 'squat', 100, 5, pluginDb);
        expect(result).toBe(true);
      });
    });

    describe('getPersonalRecords', () => {
      it('should return the best set for an exercise', () => {
        logWorkoutSet('U123', 'squat', 100, 5, undefined, pluginDb);
        logWorkoutSet('U123', 'squat', 120, 3, undefined, pluginDb);
        logWorkoutSet('U123', 'squat', 90, 8, undefined, pluginDb);

        const prs = getPersonalRecords('U123', 'squat', pluginDb);
        expect(prs).toHaveLength(1);
        // 100x5 → 116.67, 120x3 → 132.0, 90x8 → 114.0
        // Best is 120x3
        expect(prs[0].weightKg).toBe(120);
        expect(prs[0].reps).toBe(3);
        expect(prs[0].estimated1rmKg).toBeCloseTo(132.0, 0);
      });

      it('should return empty array for unknown exercise', () => {
        const prs = getPersonalRecords('U123', 'overhead press', pluginDb);
        expect(prs).toEqual([]);
      });
    });

    describe('getAllPersonalRecords', () => {
      it('should return best set per exercise', () => {
        logWorkoutSet('U123', 'squat', 140, 5, undefined, pluginDb);
        logWorkoutSet('U123', 'squat', 100, 3, undefined, pluginDb);
        logWorkoutSet('U123', 'bench press', 100, 5, undefined, pluginDb);
        logWorkoutSet('U123', 'deadlift', 180, 3, undefined, pluginDb);

        const prs = getAllPersonalRecords('U123', pluginDb);
        expect(prs).toHaveLength(3);

        // Should be sorted alphabetically by exercise
        expect(prs[0].exercise).toBe('bench press');
        expect(prs[1].exercise).toBe('deadlift');
        expect(prs[2].exercise).toBe('squat');
      });

      it('should return empty array when no sets', () => {
        const prs = getAllPersonalRecords('U123', pluginDb);
        expect(prs).toEqual([]);
      });

      it('should isolate by user', () => {
        logWorkoutSet('U123', 'squat', 100, 5, undefined, pluginDb);
        logWorkoutSet('U456', 'squat', 200, 5, undefined, pluginDb);

        const prs = getAllPersonalRecords('U123', pluginDb);
        expect(prs).toHaveLength(1);
        expect(prs[0].weightKg).toBe(100);
      });
    });
  });
});

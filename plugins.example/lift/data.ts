/**
 * Lift Plugin — Database Queries
 *
 * All data access functions for workouts, PRs, bodyweight, and macros.
 */

import type { PluginDatabase } from '../../src/services/plugin-database.js';
import type { WorkoutSet, PersonalRecord, MacroTotals, WeightUnit } from './types.js';
import { calculate1rm } from './calculations.js';
import { kgToLbs } from './units.js';
import { getStartOfDayInTimezone, dateToStartOfDayInTimezone } from './timezone.js';

// =============================================================================
// Workout Set DB Operations
// =============================================================================

/**
 * Log a workout set to the database
 * Exercise name is lowercased for consistent querying.
 */
export function logWorkoutSet(
  userId: string,
  exercise: string,
  weightKg: number,
  reps: number,
  rpe: number | undefined,
  db: PluginDatabase
): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO ${db.prefix}workout_sets (user_id, exercise, weight_kg, reps, rpe, logged_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(userId, exercise.toLowerCase(), weightKg, reps, rpe ?? null, now, now);
}

/**
 * DB row shape for workout_sets table
 */
interface WorkoutSetRow {
  id: number;
  user_id: string;
  exercise: string;
  weight_kg: number;
  reps: number;
  rpe: number | null;
  logged_at: number;
  created_at: number;
}

function rowToWorkoutSet(row: WorkoutSetRow): WorkoutSet {
  return {
    id: row.id,
    exercise: row.exercise,
    weightKg: row.weight_kg,
    reps: row.reps,
    rpe: row.rpe,
    loggedAt: row.logged_at,
  };
}

/**
 * Get workout sets for a specific date
 * @param dateSpec 'today' or a Date object
 * @param tz User's IANA timezone or null for UTC
 */
export function getWorkoutForDate(
  userId: string,
  dateSpec: 'today' | Date,
  db: PluginDatabase,
  tz: string | null
): WorkoutSet[] {
  let startTs: number;
  let endTs: number;

  if (dateSpec === 'today') {
    startTs = getStartOfDayInTimezone(tz, 0);
    endTs = startTs + 24 * 60 * 60 * 1000;
  } else {
    startTs = dateToStartOfDayInTimezone(dateSpec, tz);
    endTs = startTs + 24 * 60 * 60 * 1000;
  }

  const rows = db.prepare(
    `SELECT id, user_id, exercise, weight_kg, reps, rpe, logged_at, created_at
     FROM ${db.prefix}workout_sets
     WHERE user_id = ? AND logged_at >= ? AND logged_at < ?
     ORDER BY logged_at ASC`
  ).all(userId, startTs, endTs) as WorkoutSetRow[];

  return rows.map(rowToWorkoutSet);
}

// =============================================================================
// PR Detection
// =============================================================================

/**
 * Check if a new set would be a personal record for the given exercise.
 * Compares estimated 1RM (Epley) against all previous sets.
 * First set for an exercise is always a PR.
 */
export function checkForPR(
  userId: string,
  exercise: string,
  weightKg: number,
  reps: number,
  db: PluginDatabase
): boolean {
  const exerciseLower = exercise.toLowerCase();
  const new1rm = calculate1rm(weightKg, reps);

  // Get the best estimated 1RM for this exercise from existing sets
  const rows = db.prepare(
    `SELECT weight_kg, reps FROM ${db.prefix}workout_sets
     WHERE user_id = ? AND exercise = ?`
  ).all(userId, exerciseLower) as { weight_kg: number; reps: number }[];

  if (rows.length === 0) return true; // First set is always a PR

  const best1rm = Math.max(...rows.map(r => calculate1rm(r.weight_kg, r.reps)));
  return new1rm > best1rm;
}

/**
 * Get the personal record for a specific exercise
 * Returns the set with the highest estimated 1RM
 */
export function getPersonalRecords(
  userId: string,
  exercise: string,
  db: PluginDatabase
): PersonalRecord[] {
  const exerciseLower = exercise.toLowerCase();

  const rows = db.prepare(
    `SELECT exercise, weight_kg, reps, logged_at FROM ${db.prefix}workout_sets
     WHERE user_id = ? AND exercise = ?`
  ).all(userId, exerciseLower) as { exercise: string; weight_kg: number; reps: number; logged_at: number }[];

  if (rows.length === 0) return [];

  // Find the row with highest estimated 1RM
  let bestRow = rows[0];
  let best1rm = calculate1rm(bestRow.weight_kg, bestRow.reps);

  for (let i = 1; i < rows.length; i++) {
    const est = calculate1rm(rows[i].weight_kg, rows[i].reps);
    if (est > best1rm) {
      best1rm = est;
      bestRow = rows[i];
    }
  }

  return [{
    exercise: bestRow.exercise,
    weightKg: bestRow.weight_kg,
    reps: bestRow.reps,
    estimated1rmKg: best1rm,
    loggedAt: bestRow.logged_at,
  }];
}

/**
 * Get personal records for all exercises, one per exercise, sorted alphabetically
 */
export function getAllPersonalRecords(
  userId: string,
  db: PluginDatabase
): PersonalRecord[] {
  const rows = db.prepare(
    `SELECT exercise, weight_kg, reps, logged_at FROM ${db.prefix}workout_sets
     WHERE user_id = ?`
  ).all(userId) as { exercise: string; weight_kg: number; reps: number; logged_at: number }[];

  if (rows.length === 0) return [];

  // Group by exercise, find best 1RM for each
  const byExercise = new Map<string, { row: typeof rows[0]; est1rm: number }>();
  for (const row of rows) {
    const est = calculate1rm(row.weight_kg, row.reps);
    const current = byExercise.get(row.exercise);
    if (!current || est > current.est1rm) {
      byExercise.set(row.exercise, { row, est1rm: est });
    }
  }

  // Sort alphabetically by exercise
  return Array.from(byExercise.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, { row, est1rm }]) => ({
      exercise: row.exercise,
      weightKg: row.weight_kg,
      reps: row.reps,
      estimated1rmKg: est1rm,
      loggedAt: row.logged_at,
    }));
}

// =============================================================================
// Bodyweight Tracking
// =============================================================================

/**
 * Log a bodyweight entry (one per day, replaces if same day)
 */
export function logBodyweight(userId: string, weightKg: number, db: PluginDatabase): void {
  // Store with start-of-day timestamp (UTC) so one entry per day
  const now = new Date();
  const startOfDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  db.prepare(
    `INSERT OR REPLACE INTO ${db.prefix}bodyweight (user_id, weight_kg, logged_at)
     VALUES (?, ?, ?)`
  ).run(userId, weightKg, startOfDay);
}

/**
 * Get the most recent bodyweight entry for a user
 */
export function getLatestBodyweight(
  userId: string,
  db: PluginDatabase
): { weightKg: number; loggedAt: number } | null {
  const row = db.prepare(
    `SELECT weight_kg, logged_at FROM ${db.prefix}bodyweight
     WHERE user_id = ? ORDER BY logged_at DESC LIMIT 1`
  ).get(userId) as { weight_kg: number; logged_at: number } | undefined;
  return row ? { weightKg: row.weight_kg, loggedAt: row.logged_at } : null;
}

/**
 * Get bodyweight history for a user over the last N days
 */
export function getBodyweightHistory(
  userId: string,
  days: number,
  db: PluginDatabase
): Array<{ weightKg: number; loggedAt: number }> {
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  const rows = db.prepare(
    `SELECT weight_kg, logged_at FROM ${db.prefix}bodyweight
     WHERE user_id = ? AND logged_at >= ? ORDER BY logged_at ASC`
  ).all(userId, since) as Array<{ weight_kg: number; logged_at: number }>;
  return rows.map((r) => ({ weightKg: r.weight_kg, loggedAt: r.logged_at }));
}

/**
 * Format bodyweight trend for display
 */
export function formatBodyweightTrend(
  history: Array<{ weightKg: number; loggedAt: number }>,
  unit: WeightUnit
): string {
  if (history.length === 0) {
    return 'No bodyweight entries logged yet.';
  }

  const toDisplay = (kg: number) =>
    unit === 'kg' ? kg.toFixed(1) : kgToLbs(kg).toFixed(1);

  const latest = history[history.length - 1];
  const avg = history.reduce((sum, e) => sum + e.weightKg, 0) / history.length;

  let trend = '';
  if (history.length >= 2) {
    const first = history[0];
    const diff = latest.weightKg - first.weightKg;
    if (diff > 0.2) {
      trend = ` ↑ +${toDisplay(diff)} ${unit}`;
    } else if (diff < -0.2) {
      trend = ` ↓ ${toDisplay(diff)} ${unit}`;
    } else {
      trend = ' → stable';
    }
  }

  return `*Current:* ${toDisplay(latest.weightKg)} ${unit} | *${String(history.length)}d avg:* ${toDisplay(avg)} ${unit}${trend}`;
}

// =============================================================================
// Macros Tracking
// =============================================================================

/**
 * Log macros to the database
 * @throws Error if userId is invalid or database operation fails
 */
export function logMacros(
  userId: string,
  macros: { carbs: number; fat: number; protein: number },
  db: PluginDatabase
): void {
  if (!userId || typeof userId !== 'string') {
    throw new Error('Invalid user ID');
  }

  const now = Date.now();
  db.prepare(
    `INSERT INTO ${db.prefix}macros (user_id, carbs_g, fat_g, protein_g, logged_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(userId, macros.carbs, macros.fat, macros.protein, now, now);
}

/**
 * Get daily totals for a user
 * @param daysAgo 0 = today, -1 = yesterday only, -7 = last 7 days including today
 * @param tz User's IANA timezone (e.g., "America/New_York") or null for server time
 */
export function getDailyTotals(userId: string, daysAgo: number, db: PluginDatabase, tz: string | null): MacroTotals {
  const startOfToday = getStartOfDayInTimezone(tz, 0);

  let startTs: number;
  let endTs: number;

  if (daysAgo === 0) {
    startTs = startOfToday;
    endTs = Date.now();
  } else {
    // Negative daysAgo means going back
    const daysBack = Math.abs(daysAgo);
    startTs = getStartOfDayInTimezone(tz, daysBack);
    // -1 = just yesterday, -7 = last 7 days including today
    endTs = daysAgo === -1 ? startOfToday : Date.now();
  }

  const row = db
    .prepare(
      `SELECT
        COALESCE(SUM(carbs_g), 0) as carbs,
        COALESCE(SUM(protein_g), 0) as protein,
        COALESCE(SUM(fat_g), 0) as fat,
        COUNT(*) as entries
      FROM ${db.prefix}macros
      WHERE user_id = ? AND logged_at >= ? AND logged_at < ?`
    )
    .get(userId, startTs, endTs) as MacroTotals;

  return row;
}

/**
 * Get totals for a specific date
 * @param tz User's IANA timezone or null for server time
 */
export function getTotalsForDate(userId: string, date: Date, db: PluginDatabase, tz: string | null): MacroTotals {
  const startTs = dateToStartOfDayInTimezone(date, tz);
  const endTs = startTs + 24 * 60 * 60 * 1000;

  return db
    .prepare(
      `SELECT
        COALESCE(SUM(carbs_g), 0) as carbs,
        COALESCE(SUM(protein_g), 0) as protein,
        COALESCE(SUM(fat_g), 0) as fat,
        COUNT(*) as entries
      FROM ${db.prefix}macros
      WHERE user_id = ? AND logged_at >= ? AND logged_at < ?`
    )
    .get(userId, startTs, endTs) as MacroTotals;
}

/**
 * Get totals for a date range (inclusive)
 * @param tz User's IANA timezone or null for server time
 */
export function getTotalsForRange(userId: string, start: Date, end: Date, db: PluginDatabase, tz: string | null): MacroTotals {
  const startTs = dateToStartOfDayInTimezone(start, tz);
  const endTs = dateToStartOfDayInTimezone(end, tz) + 24 * 60 * 60 * 1000;

  return db
    .prepare(
      `SELECT
        COALESCE(SUM(carbs_g), 0) as carbs,
        COALESCE(SUM(protein_g), 0) as protein,
        COALESCE(SUM(fat_g), 0) as fat,
        COUNT(*) as entries
      FROM ${db.prefix}macros
      WHERE user_id = ? AND logged_at >= ? AND logged_at < ?`
    )
    .get(userId, startTs, endTs) as MacroTotals;
}

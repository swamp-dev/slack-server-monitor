/**
 * Lift Plugin — Screenshot Fixtures
 *
 * Seeds the in-memory database with realistic mock data so that
 * the screenshot pipeline can capture populated pages.
 *
 * Called by screenshotSetup() before init() — must create tables first.
 */

import type { PluginContext } from '../../src/plugins/index.js';

// =============================================================================
// Constants
// =============================================================================

const USER_ID = 'web-user';
const DAY_MS = 86_400_000;

// Exercises and their progression
const EXERCISES = [
  { name: 'squat', weights: [135, 155, 185, 205, 225] },
  { name: 'bench press', weights: [95, 115, 135, 155, 165] },
  { name: 'deadlift', weights: [185, 225, 275, 315, 335] },
  { name: 'overhead press', weights: [65, 75, 85, 95, 100] },
  { name: 'barbell row', weights: [95, 115, 135, 145, 155] },
];

// LBS_TO_KG conversion
const LBS_TO_KG = 0.45359237;

// =============================================================================
// Seed Functions
// =============================================================================

function createTables(ctx: PluginContext): void {
  const p = ctx.db.prefix;
  ctx.db.exec(`
    CREATE TABLE IF NOT EXISTS ${p}user_prefs (
      user_id TEXT PRIMARY KEY,
      weight_unit TEXT NOT NULL DEFAULT 'lbs' CHECK(weight_unit IN ('lbs', 'kg')),
      updated_at INTEGER NOT NULL
    )
  `);
  ctx.db.exec(`
    CREATE TABLE IF NOT EXISTS ${p}bodyweight (
      user_id TEXT NOT NULL,
      weight_kg REAL NOT NULL CHECK(weight_kg > 0 AND weight_kg < 500),
      logged_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, logged_at)
    )
  `);
  ctx.db.exec(`
    CREATE TABLE IF NOT EXISTS ${p}workout_sets (
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
  ctx.db.exec(`
    CREATE TABLE IF NOT EXISTS ${p}macros (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      carbs_g REAL NOT NULL DEFAULT 0 CHECK(carbs_g >= 0 AND carbs_g <= 5000),
      fat_g REAL NOT NULL DEFAULT 0 CHECK(fat_g >= 0 AND fat_g <= 2000),
      protein_g REAL NOT NULL DEFAULT 0 CHECK(protein_g >= 0 AND protein_g <= 2000),
      logged_at INTEGER NOT NULL CHECK(logged_at > 0),
      created_at INTEGER NOT NULL CHECK(created_at > 0)
    )
  `);
  ctx.db.exec(`
    CREATE TABLE IF NOT EXISTS ${p}pending_estimates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      carbs_g REAL NOT NULL,
      protein_g REAL NOT NULL,
      fat_g REAL NOT NULL,
      food_description TEXT NOT NULL,
      confidence TEXT NOT NULL,
      notes TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `);
}

function seedWorkoutSets(ctx: PluginContext): void {
  const p = ctx.db.prefix;
  const now = Date.now();
  const insert = ctx.db.prepare(`
    INSERT INTO ${p}workout_sets (user_id, exercise, weight_kg, reps, rpe, logged_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  // Seed 14 days of workouts (Push/Pull/Legs split, ~4 days/week)
  const workoutDays = [0, 1, 3, 4, 6, 7, 8, 10, 11, 13]; // days ago that had workouts
  for (const daysAgo of workoutDays) {
    const dayTs = now - daysAgo * DAY_MS;
    // Pick 2-3 exercises per day based on split
    const dayIdx = daysAgo % 3;
    const dayExercises = dayIdx === 0
      ? [EXERCISES[0], EXERCISES[3]]       // Squat + OHP
      : dayIdx === 1
        ? [EXERCISES[1], EXERCISES[4]]     // Bench + Row
        : [EXERCISES[2]];                  // Deadlift

    for (const exercise of dayExercises) {
      // 3-4 working sets with progression
      const topWeight = exercise.weights[Math.min(exercise.weights.length - 1, Math.floor((14 - daysAgo) / 3))];
      const sets = [
        { w: topWeight * 0.7, reps: 5, rpe: null },
        { w: topWeight * 0.85, reps: 5, rpe: 7 },
        { w: topWeight, reps: 5, rpe: 8.5 },
        { w: topWeight, reps: 3, rpe: 9 },
      ];
      for (const s of sets) {
        insert.run(USER_ID, exercise.name, s.w * LBS_TO_KG, s.reps, s.rpe, dayTs, dayTs);
      }
    }
  }
}

function seedBodyweight(ctx: PluginContext): void {
  const p = ctx.db.prefix;
  const now = Date.now();
  const insert = ctx.db.prepare(`
    INSERT INTO ${p}bodyweight (user_id, weight_kg, logged_at)
    VALUES (?, ?, ?)
  `);

  // 30 days of bodyweight showing slight downtrend (185 → 181 lbs)
  const startWeight = 185;
  for (let i = 29; i >= 0; i--) {
    // Skip some days for realism
    if (i % 4 === 2) continue;
    const weight = startWeight - (29 - i) * 0.14 + (Math.sin(i) * 0.5);
    const dayTs = now - i * DAY_MS;
    insert.run(USER_ID, weight * LBS_TO_KG, dayTs);
  }
}

function seedMacros(ctx: PluginContext): void {
  const p = ctx.db.prefix;
  const now = Date.now();
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const startTs = startOfDay.getTime();
  const insert = ctx.db.prepare(`
    INSERT INTO ${p}macros (user_id, carbs_g, protein_g, fat_g, logged_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  // Today's entries (breakfast + lunch so far)
  insert.run(USER_ID, 45, 35, 12, startTs + 7 * 3600000, now);  // breakfast
  insert.run(USER_ID, 60, 50, 18, startTs + 12 * 3600000, now); // lunch

  // Seed past 6 days for weekly chart (fixed values for stable screenshots)
  const dailyMacros = [
    { c1: 195, p1: 170, f1: 65, c2: 85, p2: 55, f2: 28 },
    { c1: 210, p1: 180, f1: 72, c2: 90, p2: 60, f2: 30 },
    { c1: 185, p1: 165, f1: 60, c2: 80, p2: 52, f2: 25 },
    { c1: 200, p1: 175, f1: 68, c2: 88, p2: 58, f2: 32 },
    { c1: 190, p1: 168, f1: 63, c2: 82, p2: 54, f2: 27 },
    { c1: 205, p1: 178, f1: 70, c2: 92, p2: 62, f2: 30 },
  ];
  for (let i = 1; i <= 6; i++) {
    const dayTs = startTs - i * DAY_MS;
    const m = dailyMacros[i - 1];
    insert.run(USER_ID, m.c1, m.p1, m.f1, dayTs + 8 * 3600000, dayTs);
    insert.run(USER_ID, m.c2, m.p2, m.f2, dayTs + 18 * 3600000, dayTs);
  }
}

function seedUserPrefs(ctx: PluginContext): void {
  const p = ctx.db.prefix;
  ctx.db.prepare(`
    INSERT INTO ${p}user_prefs (user_id, weight_unit, updated_at)
    VALUES (?, 'lbs', ?)
  `).run(USER_ID, Date.now());
}

// =============================================================================
// Public API
// =============================================================================

export async function seedLiftScreenshotData(ctx: PluginContext): Promise<void> {
  createTables(ctx);
  seedUserPrefs(ctx);
  seedWorkoutSets(ctx);
  seedBodyweight(ctx);
  seedMacros(ctx);
}

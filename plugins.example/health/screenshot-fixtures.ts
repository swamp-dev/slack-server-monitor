/**
 * Health Plugin — Screenshot Fixtures
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

// =============================================================================
// Seed Functions
// =============================================================================

function createTables(ctx: PluginContext): void {
  ctx.db.exec('PRAGMA foreign_keys = ON');
  ctx.db.exec(`
    CREATE TABLE IF NOT EXISTS plugin_health_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(user_id, name COLLATE NOCASE)
    )
  `);
  ctx.db.exec(`
    CREATE TABLE IF NOT EXISTS plugin_health_medications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      member_id INTEGER NOT NULL REFERENCES plugin_health_members(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      dosage TEXT NOT NULL,
      frequency TEXT NOT NULL CHECK(frequency IN ('daily','2x-daily','3x-daily','weekly','as-needed')),
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      UNIQUE(member_id, name COLLATE NOCASE)
    )
  `);
  ctx.db.exec(`
    CREATE TABLE IF NOT EXISTS plugin_health_doses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      medication_id INTEGER NOT NULL REFERENCES plugin_health_medications(id) ON DELETE CASCADE,
      taken_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
  ctx.db.exec(`
    CREATE TABLE IF NOT EXISTS plugin_health_appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      member_id INTEGER NOT NULL REFERENCES plugin_health_members(id) ON DELETE CASCADE,
      appointment_date INTEGER NOT NULL,
      type TEXT NOT NULL,
      notes TEXT,
      created_at INTEGER NOT NULL
    )
  `);
  ctx.db.exec(`
    CREATE TABLE IF NOT EXISTS plugin_health_vaccinations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      member_id INTEGER NOT NULL REFERENCES plugin_health_members(id) ON DELETE CASCADE,
      vaccine_name TEXT NOT NULL,
      administered_date INTEGER NOT NULL,
      notes TEXT,
      created_at INTEGER NOT NULL
    )
  `);
}

function seedMembers(ctx: PluginContext): void {
  const now = Date.now();
  const insert = ctx.db.prepare(
    `INSERT INTO plugin_health_members (user_id, name, created_at) VALUES (?, ?, ?)`
  );
  insert.run(USER_ID, 'Emma', now - 90 * DAY_MS);
  insert.run(USER_ID, 'Liam', now - 60 * DAY_MS);
  insert.run(USER_ID, 'Olivia', now - 30 * DAY_MS);
}

function seedMedications(ctx: PluginContext): void {
  const now = Date.now();
  const insert = ctx.db.prepare(
    `INSERT INTO plugin_health_medications (user_id, member_id, name, dosage, frequency, active, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?)`
  );

  // Emma (member_id=1): 2 daily meds — will be fully compliant
  insert.run(USER_ID, 1, 'Vitamin D', '2000 IU', 'daily', now - 90 * DAY_MS);
  insert.run(USER_ID, 1, 'Iron', '65mg', 'daily', now - 60 * DAY_MS);

  // Liam (member_id=2): 1 daily + 1 2x-daily — will be partial
  insert.run(USER_ID, 2, 'Amoxicillin', '250mg', '2x-daily', now - 10 * DAY_MS);
  insert.run(USER_ID, 2, 'Probiotic', '10B CFU', 'daily', now - 30 * DAY_MS);

  // Olivia (member_id=3): 1 daily — will have 0 doses today
  insert.run(USER_ID, 3, 'Melatonin', '1mg', 'daily', now - 20 * DAY_MS);
  insert.run(USER_ID, 3, 'Fluoride', '0.5mg', 'daily', now - 30 * DAY_MS);
}

function seedDoses(ctx: PluginContext): void {
  const now = Date.now();
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const todayStart = startOfDay.getTime();

  const insert = ctx.db.prepare(
    `INSERT INTO plugin_health_doses (user_id, medication_id, taken_at, created_at) VALUES (?, ?, ?, ?)`
  );

  // Emma: fully compliant today — both meds taken
  insert.run(USER_ID, 1, todayStart + 8 * 3600000, now);  // Vitamin D
  insert.run(USER_ID, 2, todayStart + 8 * 3600000, now);  // Iron

  // Liam: partial — took morning Amoxicillin (1 of 2) + Probiotic
  insert.run(USER_ID, 3, todayStart + 9 * 3600000, now);  // Amoxicillin (1/2)
  insert.run(USER_ID, 4, todayStart + 9 * 3600000, now);  // Probiotic (1/1)

  // Olivia: 0 doses today (missed)

  // Seed past 6 days for adherence grid
  for (let i = 1; i <= 6; i++) {
    const dayStart = todayStart - i * DAY_MS;

    // Emma: mostly compliant (miss one day)
    if (i !== 4) {
      insert.run(USER_ID, 1, dayStart + 8 * 3600000, dayStart);
      insert.run(USER_ID, 2, dayStart + 8 * 3600000, dayStart);
    }

    // Liam: mixed adherence
    if (i <= 4) { // Amoxicillin started 10 days ago, seed within recent window
      insert.run(USER_ID, 3, dayStart + 9 * 3600000, dayStart);
      if (i % 2 === 0) {
        insert.run(USER_ID, 3, dayStart + 21 * 3600000, dayStart); // 2nd dose on some days
      }
    }
    insert.run(USER_ID, 4, dayStart + 9 * 3600000, dayStart); // Probiotic daily

    // Olivia: sporadic
    if (i % 3 === 0) {
      insert.run(USER_ID, 5, dayStart + 20 * 3600000, dayStart);
    }
    if (i <= 2) {
      insert.run(USER_ID, 6, dayStart + 20 * 3600000, dayStart);
    }
  }
}

function seedAppointments(ctx: PluginContext): void {
  const now = Date.now();
  const insert = ctx.db.prepare(
    `INSERT INTO plugin_health_appointments (user_id, member_id, appointment_date, type, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  // Emma: dentist in 5 days
  insert.run(USER_ID, 1, now + 5 * DAY_MS, 'Dentist', 'Regular cleaning', now);
  // Liam: pediatrician in 12 days
  insert.run(USER_ID, 2, now + 12 * DAY_MS, 'Pediatrician', 'Follow-up for ear infection', now);
  // Olivia: eye doctor in 20 days
  insert.run(USER_ID, 3, now + 20 * DAY_MS, 'Eye Doctor', null, now);
}

function seedVaccinations(ctx: PluginContext): void {
  const now = Date.now();
  const insert = ctx.db.prepare(
    `INSERT INTO plugin_health_vaccinations (user_id, member_id, vaccine_name, administered_date, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  insert.run(USER_ID, 1, 'Flu Shot', now - 120 * DAY_MS, '2025-2026 season', now);
  insert.run(USER_ID, 1, 'Tdap', now - 365 * DAY_MS, null, now);
  insert.run(USER_ID, 2, 'Flu Shot', now - 100 * DAY_MS, null, now);
}

// =============================================================================
// Public API
// =============================================================================

export async function seedHealthScreenshotData(ctx: PluginContext): Promise<void> {
  createTables(ctx);
  seedMembers(ctx);
  seedMedications(ctx);
  seedDoses(ctx);
  seedAppointments(ctx);
  seedVaccinations(ctx);
}

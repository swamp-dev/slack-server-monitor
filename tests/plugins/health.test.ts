/**
 * Tests for the health plugin
 *
 * Tests cover: member management, medication tracking, dose logging,
 * appointments, vaccinations, dashboard, date parsing, and Claude AI tools.
 *
 * Pure functions are exported from the plugin and tested directly.
 * Database operations use an in-memory SQLite database.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { PluginDatabase } from '../../src/services/plugin-database.js';
import {
  validateMemberName,
  parseFrequency,
  parseAppointmentDate,
  parseVaxDate,
  parseTime,
  dosesExpectedToday,
  formatTime,
  formatDateShort,
  formatDateWithDay,
  getStartOfDay,
  parseTimezoneOffsetMs,
  type Frequency,
} from '../../plugins.example/health.js';

// =============================================================================
// Test Database Setup
// =============================================================================

let db: Database.Database;
let pluginDb: PluginDatabase;

function setupTestDb(): void {
  db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  pluginDb = new PluginDatabase(db, 'health');

  // Create schema (matches init() in health.ts)
  pluginDb.exec(`
    CREATE TABLE IF NOT EXISTS plugin_health_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(user_id, name COLLATE NOCASE)
    )
  `);
  pluginDb.exec(`CREATE INDEX IF NOT EXISTS idx_plugin_health_members_user ON plugin_health_members(user_id)`);

  pluginDb.exec(`
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
  pluginDb.exec(`CREATE INDEX IF NOT EXISTS idx_plugin_health_meds_member ON plugin_health_medications(member_id, active)`);

  pluginDb.exec(`
    CREATE TABLE IF NOT EXISTS plugin_health_doses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      medication_id INTEGER NOT NULL REFERENCES plugin_health_medications(id) ON DELETE CASCADE,
      taken_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
  pluginDb.exec(`CREATE INDEX IF NOT EXISTS idx_plugin_health_doses_med ON plugin_health_doses(medication_id, taken_at)`);

  pluginDb.exec(`
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
  pluginDb.exec(`CREATE INDEX IF NOT EXISTS idx_plugin_health_appts_user ON plugin_health_appointments(user_id, appointment_date)`);

  pluginDb.exec(`
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
  pluginDb.exec(`CREATE INDEX IF NOT EXISTS idx_plugin_health_vax_member ON plugin_health_vaccinations(member_id, administered_date)`);
}

function teardownTestDb(): void {
  db.close();
}

// =============================================================================
// Helper Functions
// =============================================================================

const TEST_USER = 'U_TEST_001';

function addMember(name: string, userId = TEST_USER): number {
  const now = Date.now();
  return (pluginDb.prepare(
    `INSERT INTO plugin_health_members (user_id, name, created_at) VALUES (?, ?, ?)`
  ).run(userId, name, now) as { lastInsertRowid: number }).lastInsertRowid;
}

function addMedication(
  memberId: number,
  name: string,
  dosage: string,
  frequency: Frequency,
  userId = TEST_USER
): number {
  const now = Date.now();
  return (pluginDb.prepare(
    `INSERT INTO plugin_health_medications (user_id, member_id, name, dosage, frequency, active, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?)`
  ).run(userId, memberId, name, dosage, frequency, now) as { lastInsertRowid: number }).lastInsertRowid;
}

function addDose(medicationId: number, takenAt: number, userId = TEST_USER): void {
  pluginDb.prepare(
    `INSERT INTO plugin_health_doses (user_id, medication_id, taken_at, created_at) VALUES (?, ?, ?, ?)`
  ).run(userId, medicationId, takenAt, Date.now());
}

function addAppointment(
  memberId: number,
  appointmentDate: number,
  type: string,
  notes: string | null = null,
  userId = TEST_USER
): number {
  return (pluginDb.prepare(
    `INSERT INTO plugin_health_appointments (user_id, member_id, appointment_date, type, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(userId, memberId, appointmentDate, type, notes, Date.now()) as { lastInsertRowid: number }).lastInsertRowid;
}

function addVaccination(
  memberId: number,
  vaccineName: string,
  administeredDate: number,
  notes: string | null = null,
  userId = TEST_USER
): number {
  return (pluginDb.prepare(
    `INSERT INTO plugin_health_vaccinations (user_id, member_id, vaccine_name, administered_date, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(userId, memberId, vaccineName, administeredDate, notes, Date.now()) as { lastInsertRowid: number }).lastInsertRowid;
}

// =============================================================================
// Tests
// =============================================================================

describe('health plugin', () => {
  // --------------------------------------------------------------------------
  // Pure function tests (no DB)
  // --------------------------------------------------------------------------

  describe('validateMemberName', () => {
    it('should accept valid names', () => {
      expect(validateMemberName('Emma')).toBe('Emma');
      expect(validateMemberName('  Emma  ')).toBe('Emma');
      expect(validateMemberName('Mary Jane')).toBe('Mary Jane');
      expect(validateMemberName('O\'Brien')).toBe("O'Brien");
      expect(validateMemberName('A')).toBe('A');
    });

    it('should reject empty or whitespace-only names', () => {
      expect(validateMemberName('')).toBeNull();
      expect(validateMemberName('   ')).toBeNull();
    });

    it('should reject names longer than 50 characters', () => {
      expect(validateMemberName('A'.repeat(51))).toBeNull();
    });

    it('should accept names at exactly 50 characters', () => {
      const name = 'A'.repeat(50);
      expect(validateMemberName(name)).toBe(name);
    });
  });

  describe('parseFrequency', () => {
    it('should parse valid frequencies', () => {
      expect(parseFrequency('daily')).toBe('daily');
      expect(parseFrequency('2x-daily')).toBe('2x-daily');
      expect(parseFrequency('3x-daily')).toBe('3x-daily');
      expect(parseFrequency('weekly')).toBe('weekly');
      expect(parseFrequency('as-needed')).toBe('as-needed');
    });

    it('should be case insensitive', () => {
      expect(parseFrequency('Daily')).toBe('daily');
      expect(parseFrequency('WEEKLY')).toBe('weekly');
      expect(parseFrequency('As-Needed')).toBe('as-needed');
    });

    it('should return null for invalid frequencies', () => {
      expect(parseFrequency('twice')).toBeNull();
      expect(parseFrequency('hourly')).toBeNull();
      expect(parseFrequency('')).toBeNull();
      expect(parseFrequency('monthly')).toBeNull();
    });
  });

  describe('parseAppointmentDate', () => {
    it('should parse M/D format with future bias', () => {
      const now = new Date();
      // Use a date 15 days from now
      const futureDate = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000);
      const dateStr = `${futureDate.getMonth() + 1}/${futureDate.getDate()}`;
      const result = parseAppointmentDate(dateStr);
      expect(result).not.toBeNull();
      if (result) {
        expect(result.getMonth()).toBe(futureDate.getMonth());
        expect(result.getDate()).toBe(futureDate.getDate());
        expect(result.getFullYear()).toBe(futureDate.getFullYear());
      }
    });

    it('should parse M/D/YY format', () => {
      const result = parseAppointmentDate('3/15/26');
      expect(result).not.toBeNull();
      if (result) {
        expect(result.getMonth()).toBe(2); // March
        expect(result.getDate()).toBe(15);
        expect(result.getFullYear()).toBe(2026);
      }
    });

    it('should parse M/D/YYYY format', () => {
      const result = parseAppointmentDate('3/15/2026');
      expect(result).not.toBeNull();
      if (result) {
        expect(result.getMonth()).toBe(2);
        expect(result.getDate()).toBe(15);
        expect(result.getFullYear()).toBe(2026);
      }
    });

    it('should return null for invalid dates', () => {
      expect(parseAppointmentDate('13/1')).toBeNull(); // invalid month
      expect(parseAppointmentDate('0/15')).toBeNull(); // invalid month
      expect(parseAppointmentDate('abc')).toBeNull();
      expect(parseAppointmentDate('')).toBeNull();
    });

    it('should return null for overflowed dates', () => {
      expect(parseAppointmentDate('2/30')).toBeNull(); // Feb has <30 days
    });

    it('should assume next year for dates >30 days in the past (M/D only)', () => {
      const now = new Date();
      // A date 60 days in the past
      const pastDate = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
      const dateStr = `${pastDate.getMonth() + 1}/${pastDate.getDate()}`;
      const result = parseAppointmentDate(dateStr);
      expect(result).not.toBeNull();
      if (result) {
        // Should be next year
        expect(result.getFullYear()).toBe(pastDate.getFullYear() + 1);
      }
    });
  });

  describe('parseVaxDate', () => {
    it('should return today for undefined input', () => {
      const result = parseVaxDate(undefined);
      const now = new Date();
      expect(result).not.toBeNull();
      if (result) {
        expect(result.getDate()).toBe(now.getDate());
        expect(result.getMonth()).toBe(now.getMonth());
      }
    });

    it('should parse M/D format', () => {
      const result = parseVaxDate('1/15');
      expect(result).not.toBeNull();
      if (result) {
        expect(result.getMonth()).toBe(0);
        expect(result.getDate()).toBe(15);
      }
    });

    it('should parse M/D/YY format', () => {
      const result = parseVaxDate('6/10/25');
      expect(result).not.toBeNull();
      if (result) {
        expect(result.getMonth()).toBe(5);
        expect(result.getDate()).toBe(10);
        expect(result.getFullYear()).toBe(2025);
      }
    });

    it('should return null for invalid dates', () => {
      expect(parseVaxDate('abc')).toBeNull();
      expect(parseVaxDate('13/1')).toBeNull();
    });
  });

  describe('parseTime', () => {
    it('should parse 12-hour time with am/pm', () => {
      expect(parseTime('8am')).toEqual({ hours: 8, minutes: 0 });
      expect(parseTime('8:30am')).toEqual({ hours: 8, minutes: 30 });
      expect(parseTime('12pm')).toEqual({ hours: 12, minutes: 0 });
      expect(parseTime('12am')).toEqual({ hours: 0, minutes: 0 });
      expect(parseTime('11:59pm')).toEqual({ hours: 23, minutes: 59 });
      expect(parseTime('1pm')).toEqual({ hours: 13, minutes: 0 });
      expect(parseTime('7:42pm')).toEqual({ hours: 19, minutes: 42 });
    });

    it('should parse 24-hour time', () => {
      expect(parseTime('8:00')).toEqual({ hours: 8, minutes: 0 });
      expect(parseTime('13:30')).toEqual({ hours: 13, minutes: 30 });
      expect(parseTime('0:00')).toEqual({ hours: 0, minutes: 0 });
      expect(parseTime('23:59')).toEqual({ hours: 23, minutes: 59 });
    });

    it('should be case insensitive', () => {
      expect(parseTime('8AM')).toEqual({ hours: 8, minutes: 0 });
      expect(parseTime('8:30PM')).toEqual({ hours: 20, minutes: 30 });
      expect(parseTime('8:30Pm')).toEqual({ hours: 20, minutes: 30 });
    });

    it('should return null for invalid time', () => {
      expect(parseTime('25:00')).toBeNull();
      expect(parseTime('8:60am')).toBeNull();
      expect(parseTime('abc')).toBeNull();
      expect(parseTime('')).toBeNull();
      expect(parseTime('13am')).toBeNull(); // 13 is not valid in 12-hour
    });
  });

  describe('dosesExpectedToday', () => {
    it('should return correct counts', () => {
      expect(dosesExpectedToday('daily')).toBe(1);
      expect(dosesExpectedToday('2x-daily')).toBe(2);
      expect(dosesExpectedToday('3x-daily')).toBe(3);
      expect(dosesExpectedToday('weekly')).toBe(1);
      expect(dosesExpectedToday('as-needed')).toBe(0);
    });
  });

  describe('formatTime', () => {
    it('should format timestamps in 12-hour format with timezone', () => {
      // 8:15 AM UTC
      const ts = Date.UTC(2026, 0, 15, 8, 15);
      // Format in UTC (should show 8:15 AM)
      const result = formatTime(ts, 'UTC');
      expect(result).toBe('8:15 AM');
    });

    it('should format PM times with timezone', () => {
      // 7:42 PM UTC
      const ts = Date.UTC(2026, 0, 15, 19, 42);
      const result = formatTime(ts, 'UTC');
      expect(result).toBe('7:42 PM');
    });

    it('should format noon with timezone', () => {
      const ts = Date.UTC(2026, 0, 15, 12, 0);
      const result = formatTime(ts, 'UTC');
      expect(result).toBe('12:00 PM');
    });

    it('should format midnight with timezone', () => {
      const ts = Date.UTC(2026, 0, 15, 0, 0);
      const result = formatTime(ts, 'UTC');
      expect(result).toBe('12:00 AM');
    });

    it('should adjust for user timezone', () => {
      // 5:00 PM UTC = 12:00 PM EST (UTC-5)
      const ts = Date.UTC(2026, 0, 15, 17, 0);
      expect(formatTime(ts, 'America/New_York')).toBe('12:00 PM');
    });
  });

  describe('formatDateShort', () => {
    it('should format as M/D using UTC when no tz', () => {
      // Use Date.UTC for server-timezone-independent timestamps
      const ts = Date.UTC(2026, 0, 15);
      expect(formatDateShort(ts)).toBe('1/15');
    });

    it('should handle double-digit month/day', () => {
      const ts = Date.UTC(2026, 11, 25);
      expect(formatDateShort(ts)).toBe('12/25');
    });

    it('should format in given timezone', () => {
      // Jan 15 2026 05:00 UTC = Jan 15 2026 00:00 EST
      const ts = Date.UTC(2026, 0, 15, 5, 0);
      expect(formatDateShort(ts, 'America/New_York')).toBe('1/15');
      // Same timestamp in UTC is still Jan 15
      expect(formatDateShort(ts)).toBe('1/15');
    });
  });

  // --------------------------------------------------------------------------
  // Database tests
  // --------------------------------------------------------------------------

  describe('member management (DB)', () => {
    beforeEach(setupTestDb);
    afterEach(teardownTestDb);

    it('should add a member', () => {
      const id = addMember('Emma');
      expect(id).toBeGreaterThan(0);

      const member = pluginDb.prepare(
        `SELECT * FROM plugin_health_members WHERE id = ?`
      ).get(id) as { name: string; user_id: string };
      expect(member.name).toBe('Emma');
      expect(member.user_id).toBe(TEST_USER);
    });

    it('should enforce unique member names per user (case insensitive)', () => {
      addMember('Emma');
      expect(() => addMember('emma')).toThrow();
      expect(() => addMember('EMMA')).toThrow();
    });

    it('should allow same name for different users', () => {
      addMember('Emma', 'U_USER_1');
      expect(() => addMember('Emma', 'U_USER_2')).not.toThrow();
    });

    it('should list members for a user', () => {
      addMember('Emma');
      addMember('Jack');
      addMember('OtherKid', 'U_OTHER');

      const members = pluginDb.prepare(
        `SELECT name FROM plugin_health_members WHERE user_id = ? ORDER BY name`
      ).all(TEST_USER) as { name: string }[];
      expect(members).toHaveLength(2);
      expect(members.map(m => m.name)).toEqual(['Emma', 'Jack']);
    });

    it('should remove a member by name', () => {
      addMember('Emma');

      const result = pluginDb.prepare(
        `DELETE FROM plugin_health_members WHERE user_id = ? AND name = ? COLLATE NOCASE`
      ).run(TEST_USER, 'Emma');
      expect(result.changes).toBe(1);
    });
  });

  describe('medication tracking (DB)', () => {
    beforeEach(setupTestDb);
    afterEach(teardownTestDb);

    it('should add a medication to a member', () => {
      const memberId = addMember('Emma');
      const medId = addMedication(memberId, 'Ibuprofen', '200mg', 'daily');
      expect(medId).toBeGreaterThan(0);
    });

    it('should enforce unique medication names per member (case insensitive)', () => {
      const memberId = addMember('Emma');
      addMedication(memberId, 'Ibuprofen', '200mg', 'daily');
      expect(() => addMedication(memberId, 'ibuprofen', '400mg', '2x-daily')).toThrow();
    });

    it('should validate frequency constraint', () => {
      const memberId = addMember('Emma');
      expect(() => {
        pluginDb.prepare(
          `INSERT INTO plugin_health_medications (user_id, member_id, name, dosage, frequency, active, created_at)
           VALUES (?, ?, ?, ?, ?, 1, ?)`
        ).run(TEST_USER, memberId, 'Bad', '1mg', 'hourly', Date.now());
      }).toThrow();
    });

    it('should deactivate medication (soft delete)', () => {
      const memberId = addMember('Emma');
      const medId = addMedication(memberId, 'Ibuprofen', '200mg', 'daily');

      pluginDb.prepare(
        `UPDATE plugin_health_medications SET active = 0 WHERE id = ?`
      ).run(medId);

      const active = pluginDb.prepare(
        `SELECT * FROM plugin_health_medications WHERE member_id = ? AND active = 1`
      ).all(memberId);
      expect(active).toHaveLength(0);
    });

    it('should list active meds for a member', () => {
      const memberId = addMember('Emma');
      addMedication(memberId, 'Ibuprofen', '200mg', 'daily');
      addMedication(memberId, 'Amoxicillin', '250mg', '2x-daily');
      const inactiveMedId = addMedication(memberId, 'OldMed', '10mg', 'weekly');
      pluginDb.prepare(`UPDATE plugin_health_medications SET active = 0 WHERE id = ?`).run(inactiveMedId);

      const meds = pluginDb.prepare(
        `SELECT name, dosage, frequency FROM plugin_health_medications
         WHERE member_id = ? AND active = 1 ORDER BY name`
      ).all(memberId) as { name: string; dosage: string; frequency: string }[];

      expect(meds).toHaveLength(2);
      expect(meds[0].name).toBe('Amoxicillin');
      expect(meds[1].name).toBe('Ibuprofen');
    });
  });

  describe('dose logging (DB)', () => {
    beforeEach(setupTestDb);
    afterEach(teardownTestDb);

    it('should log a dose with timestamp', () => {
      const memberId = addMember('Emma');
      const medId = addMedication(memberId, 'Ibuprofen', '200mg', 'daily');

      const takenAt = Date.now();
      addDose(medId, takenAt);

      const doses = pluginDb.prepare(
        `SELECT * FROM plugin_health_doses WHERE medication_id = ?`
      ).all(medId) as { taken_at: number }[];
      expect(doses).toHaveLength(1);
      expect(doses[0].taken_at).toBe(takenAt);
    });

    it('should count doses taken today', () => {
      const memberId = addMember('Emma');
      const medId = addMedication(memberId, 'Ibuprofen', '200mg', '2x-daily');

      const now = Date.now();
      // Use UTC-based start of day (server-timezone-independent)
      const startOfToday = getStartOfDay(null);

      // Today's dose
      addDose(medId, now);
      // Yesterday's dose (should not count)
      addDose(medId, startOfToday - 60000);

      const count = pluginDb.prepare(
        `SELECT COUNT(*) as cnt FROM plugin_health_doses
         WHERE medication_id = ? AND taken_at >= ?`
      ).get(medId, startOfToday) as { cnt: number };

      expect(count.cnt).toBe(1);
    });

    it('should support logging multiple doses per day', () => {
      const memberId = addMember('Emma');
      const medId = addMedication(memberId, 'Amoxicillin', '250mg', '3x-daily');

      const now = Date.now();
      addDose(medId, now - 3600000); // 1 hour ago
      addDose(medId, now);           // just now

      const doses = pluginDb.prepare(
        `SELECT * FROM plugin_health_doses WHERE medication_id = ? ORDER BY taken_at`
      ).all(medId);
      expect(doses).toHaveLength(2);
    });
  });

  describe('cascade deletes (DB)', () => {
    beforeEach(setupTestDb);
    afterEach(teardownTestDb);

    it('should cascade delete medications when member is removed', () => {
      const memberId = addMember('Emma');
      addMedication(memberId, 'Ibuprofen', '200mg', 'daily');
      addMedication(memberId, 'Amoxicillin', '250mg', '2x-daily');

      pluginDb.prepare(`DELETE FROM plugin_health_members WHERE id = ?`).run(memberId);

      const meds = pluginDb.prepare(
        `SELECT * FROM plugin_health_medications WHERE member_id = ?`
      ).all(memberId);
      expect(meds).toHaveLength(0);
    });

    it('should cascade delete doses when medication is removed', () => {
      const memberId = addMember('Emma');
      const medId = addMedication(memberId, 'Ibuprofen', '200mg', 'daily');
      addDose(medId, Date.now());

      // Remove via member cascade
      pluginDb.prepare(`DELETE FROM plugin_health_members WHERE id = ?`).run(memberId);

      const doses = pluginDb.prepare(
        `SELECT * FROM plugin_health_doses WHERE medication_id = ?`
      ).all(medId);
      expect(doses).toHaveLength(0);
    });

    it('should cascade delete appointments when member is removed', () => {
      const memberId = addMember('Emma');
      addAppointment(memberId, Date.now() + 86400000, 'Dentist');

      pluginDb.prepare(`DELETE FROM plugin_health_members WHERE id = ?`).run(memberId);

      const appts = pluginDb.prepare(
        `SELECT * FROM plugin_health_appointments WHERE member_id = ?`
      ).all(memberId);
      expect(appts).toHaveLength(0);
    });

    it('should cascade delete vaccinations when member is removed', () => {
      const memberId = addMember('Emma');
      addVaccination(memberId, 'Flu 2026', Date.now());

      pluginDb.prepare(`DELETE FROM plugin_health_members WHERE id = ?`).run(memberId);

      const vaxes = pluginDb.prepare(
        `SELECT * FROM plugin_health_vaccinations WHERE member_id = ?`
      ).all(memberId);
      expect(vaxes).toHaveLength(0);
    });
  });

  describe('appointments (DB)', () => {
    beforeEach(setupTestDb);
    afterEach(teardownTestDb);

    it('should add an appointment', () => {
      const memberId = addMember('Emma');
      const apptDate = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days from now
      const id = addAppointment(memberId, apptDate, 'Dentist', 'cleaning');
      expect(id).toBeGreaterThan(0);
    });

    it('should list upcoming appointments sorted by date', () => {
      const emmaId = addMember('Emma');
      const jackId = addMember('Jack');

      const now = Date.now();
      addAppointment(emmaId, now + 14 * 86400000, 'Dentist');
      addAppointment(jackId, now + 7 * 86400000, 'Pediatrician');
      addAppointment(emmaId, now + 3 * 86400000, 'Eye Doctor');
      // Past appointment (should be excluded)
      addAppointment(emmaId, now - 86400000, 'Old Visit');

      const upcoming = pluginDb.prepare(
        `SELECT a.*, m.name as member_name
         FROM plugin_health_appointments a
         JOIN plugin_health_members m ON a.member_id = m.id
         WHERE a.user_id = ? AND a.appointment_date >= ?
         ORDER BY a.appointment_date`
      ).all(TEST_USER, now) as { type: string; member_name: string }[];

      expect(upcoming).toHaveLength(3);
      expect(upcoming[0].type).toBe('Eye Doctor');
      expect(upcoming[1].type).toBe('Pediatrician');
      expect(upcoming[2].type).toBe('Dentist');
    });

    it('should remove an appointment by id', () => {
      const memberId = addMember('Emma');
      const id = addAppointment(memberId, Date.now() + 86400000, 'Dentist');

      const result = pluginDb.prepare(
        `DELETE FROM plugin_health_appointments WHERE id = ? AND user_id = ?`
      ).run(id, TEST_USER);
      expect(result.changes).toBe(1);
    });
  });

  describe('vaccinations (DB)', () => {
    beforeEach(setupTestDb);
    afterEach(teardownTestDb);

    it('should log a vaccination', () => {
      const memberId = addMember('Emma');
      const id = addVaccination(memberId, 'Flu 2026', Date.now());
      expect(id).toBeGreaterThan(0);
    });

    it('should list vaccination history for a member', () => {
      const memberId = addMember('Emma');
      const now = Date.now();
      addVaccination(memberId, 'Flu 2025', now - 365 * 86400000);
      addVaccination(memberId, 'COVID Booster', now - 180 * 86400000);
      addVaccination(memberId, 'Flu 2026', now);

      const vaxes = pluginDb.prepare(
        `SELECT vaccine_name, administered_date
         FROM plugin_health_vaccinations
         WHERE member_id = ?
         ORDER BY administered_date DESC`
      ).all(memberId) as { vaccine_name: string }[];

      expect(vaxes).toHaveLength(3);
      expect(vaxes[0].vaccine_name).toBe('Flu 2026');
      expect(vaxes[2].vaccine_name).toBe('Flu 2025');
    });
  });

  describe('dashboard query (DB)', () => {
    beforeEach(setupTestDb);
    afterEach(teardownTestDb);

    it('should aggregate med status across family members', () => {
      const emmaId = addMember('Emma');
      const jackId = addMember('Jack');

      const emmaMed = addMedication(emmaId, 'Ibuprofen', '200mg', 'daily');
      addMedication(jackId, 'Vitamin D', '1000IU', 'daily');

      const now = Date.now();
      addDose(emmaMed, now); // Emma took her med

      // Use UTC-based start of day (server-timezone-independent)
      const startOfToday = getStartOfDay(null);

      // Query all active meds with dose count for today
      const results = pluginDb.prepare(
        `SELECT m.name as member_name, med.name as med_name, med.frequency,
                (SELECT COUNT(*) FROM plugin_health_doses d
                 WHERE d.medication_id = med.id AND d.taken_at >= ?) as doses_today
         FROM plugin_health_medications med
         JOIN plugin_health_members m ON med.member_id = m.id
         WHERE med.user_id = ? AND med.active = 1
         ORDER BY m.name, med.name`
      ).all(startOfToday, TEST_USER) as {
        member_name: string;
        med_name: string;
        frequency: string;
        doses_today: number;
      }[];

      expect(results).toHaveLength(2);
      expect(results[0].member_name).toBe('Emma');
      expect(results[0].doses_today).toBe(1);
      expect(results[1].member_name).toBe('Jack');
      expect(results[1].doses_today).toBe(0);
    });

    it('should show upcoming appointments in dashboard (next 7 days)', () => {
      const emmaId = addMember('Emma');
      const now = Date.now();

      addAppointment(emmaId, now + 3 * 86400000, 'Dentist', 'cleaning');
      addAppointment(emmaId, now + 10 * 86400000, 'Eye Doctor'); // beyond 7 days
      addAppointment(emmaId, now - 86400000, 'Past Visit');     // past

      const sevenDaysOut = now + 7 * 86400000;
      const upcoming = pluginDb.prepare(
        `SELECT a.*, m.name as member_name
         FROM plugin_health_appointments a
         JOIN plugin_health_members m ON a.member_id = m.id
         WHERE a.user_id = ? AND a.appointment_date >= ? AND a.appointment_date <= ?
         ORDER BY a.appointment_date`
      ).all(TEST_USER, now, sevenDaysOut) as { type: string }[];

      expect(upcoming).toHaveLength(1);
      expect(upcoming[0].type).toBe('Dentist');
    });
  });

  describe('user data isolation (DB)', () => {
    beforeEach(setupTestDb);
    afterEach(teardownTestDb);

    it('should isolate data between users', () => {
      addMember('Emma', 'U_USER_1');
      addMember('Jack', 'U_USER_2');

      const user1Members = pluginDb.prepare(
        `SELECT name FROM plugin_health_members WHERE user_id = ?`
      ).all('U_USER_1') as { name: string }[];

      const user2Members = pluginDb.prepare(
        `SELECT name FROM plugin_health_members WHERE user_id = ?`
      ).all('U_USER_2') as { name: string }[];

      expect(user1Members).toHaveLength(1);
      expect(user1Members[0].name).toBe('Emma');
      expect(user2Members).toHaveLength(1);
      expect(user2Members[0].name).toBe('Jack');
    });
  });

  // --------------------------------------------------------------------------
  // Pinned timezone tests (server-timezone-independent)
  // --------------------------------------------------------------------------

  describe('timezone-aware functions (pinned time)', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('getStartOfDay should return UTC midnight when no timezone', () => {
      // Pin to Feb 3 2026 15:30:00 UTC
      vi.useFakeTimers({ now: Date.UTC(2026, 1, 3, 15, 30, 0) });

      const sod = getStartOfDay(null);
      // Should be Feb 3 2026 00:00:00 UTC
      expect(sod).toBe(Date.UTC(2026, 1, 3));
    });

    it('getStartOfDay should adjust for EST (UTC-5)', () => {
      // Pin to Feb 3 2026 03:00:00 UTC = Feb 2 2026 22:00 EST
      vi.useFakeTimers({ now: Date.UTC(2026, 1, 3, 3, 0, 0) });

      const sod = getStartOfDay('America/New_York');
      // In EST it's still Feb 2, so start of day = Feb 2 00:00 EST = Feb 2 05:00 UTC
      expect(sod).toBe(Date.UTC(2026, 1, 2, 5, 0, 0));
    });

    it('getStartOfDay should adjust for IST (UTC+5:30)', () => {
      // Pin to Feb 3 2026 20:00:00 UTC = Feb 4 2026 01:30 IST
      vi.useFakeTimers({ now: Date.UTC(2026, 1, 3, 20, 0, 0) });

      const sod = getStartOfDay('Asia/Kolkata');
      // In IST it's already Feb 4, so start of day = Feb 4 00:00 IST = Feb 3 18:30 UTC
      expect(sod).toBe(Date.UTC(2026, 1, 3, 18, 30, 0));
    });

    it('parseTimezoneOffsetMs should parse EST offset', () => {
      // EST is UTC-5 in winter
      const date = new Date(Date.UTC(2026, 1, 3, 12, 0, 0));
      const offset = parseTimezoneOffsetMs(date, 'America/New_York');
      expect(offset).toBe(-5 * 60 * 60 * 1000);
    });

    it('parseTimezoneOffsetMs should parse IST offset', () => {
      const date = new Date(Date.UTC(2026, 1, 3, 12, 0, 0));
      const offset = parseTimezoneOffsetMs(date, 'Asia/Kolkata');
      expect(offset).toBe(5.5 * 60 * 60 * 1000);
    });

    it('parseTimezoneOffsetMs should return 0 for UTC', () => {
      const date = new Date(Date.UTC(2026, 1, 3, 12, 0, 0));
      const offset = parseTimezoneOffsetMs(date, 'UTC');
      expect(offset).toBe(0);
    });

    it('formatTime should display correct time across timezone boundary', () => {
      // 2am UTC = 9pm previous day EST
      const ts = Date.UTC(2026, 1, 3, 2, 0, 0);
      expect(formatTime(ts, 'America/New_York')).toBe('9:00 PM');
    });

    it('formatDateShort should show correct date across timezone boundary', () => {
      // Feb 3 2026 02:00 UTC = Feb 2 2026 21:00 EST
      const ts = Date.UTC(2026, 1, 3, 2, 0, 0);
      // In UTC it's Feb 3
      expect(formatDateShort(ts)).toBe('2/3');
      // In EST it's still Feb 2
      expect(formatDateShort(ts, 'America/New_York')).toBe('2/2');
    });

    it('formatDateWithDay should show correct day across timezone boundary', () => {
      // Feb 3 2026 02:00 UTC = Feb 2 2026 21:00 EST
      // Feb 3 is a Tuesday, Feb 2 is a Monday
      const ts = Date.UTC(2026, 1, 3, 2, 0, 0);
      expect(formatDateWithDay(ts)).toBe('Tue 2/3');
      expect(formatDateWithDay(ts, 'America/New_York')).toBe('Mon 2/2');
    });

    it('formatDateWithDay should show correct date in positive offset timezone', () => {
      // Feb 3 2026 22:00 UTC = Feb 4 2026 03:30 IST
      const ts = Date.UTC(2026, 1, 3, 22, 0, 0);
      expect(formatDateWithDay(ts)).toBe('Tue 2/3');
      expect(formatDateWithDay(ts, 'Asia/Kolkata')).toBe('Wed 2/4');
    });
  });
});

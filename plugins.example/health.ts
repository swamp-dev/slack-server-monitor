/**
 * Health Plugin - Family Health Tracker
 *
 * Track medications, appointments, and vaccinations for family members.
 * All responses visible in channel, on-demand only (no proactive reminders).
 *
 * Commands:
 * - /health                    - Today's dashboard
 * - /health help               - Show all commands
 * - /health add <name>         - Add family member
 * - /health list               - List all members
 * - /health remove <name>      - Remove member (cascades)
 * - /health med <name> <med> <dosage> <freq> - Add medication
 * - /health med <name>         - Show member's active meds
 * - /health med remove <name> <med> - Stop tracking a med
 * - /health took <name> <med> [time] - Log dose (optional time like 8:30am)
 * - /health took <name> [time] - Log all active meds taken
 * - /health meds               - All-family medication status
 * - /health appt <name> <date> <type> [notes] - Add appointment
 * - /health appt               - Upcoming appointments (30 days)
 * - /health appt remove <id>   - Cancel appointment
 * - /health vax <name> <vaccine> [date] - Log vaccination
 * - /health vax <name>         - Show vaccination history
 */

import type { App, RespondFn } from '@slack/bolt';
import type { Plugin, PluginApp, PluginContext } from '../src/plugins/index.js';
import type { ToolDefinition } from '../src/services/tools/types.js';
import type { PluginDatabase } from '../src/services/plugin-database.js';
import { header, section, divider, context, buildChannelResponse } from '../src/formatters/blocks.js';
import { logger } from '../src/utils/logger.js';

// =============================================================================
// Module-level state
// =============================================================================

let pluginDb: PluginDatabase | null = null;

// Cache user timezones (userId -> { tz, expires })
const timezoneCache = new Map<string, { tz: string; expires: number }>();
const TIMEZONE_CACHE_TTL = 60 * 60 * 1000; // 1 hour

// =============================================================================
// Types
// =============================================================================

export type Frequency = 'daily' | '2x-daily' | '3x-daily' | 'weekly' | 'as-needed';

const VALID_FREQUENCIES: Frequency[] = ['daily', '2x-daily', '3x-daily', 'weekly', 'as-needed'];

interface Member {
  id: number;
  user_id: string;
  name: string;
  created_at: number;
}

interface Medication {
  id: number;
  user_id: string;
  member_id: number;
  name: string;
  dosage: string;
  frequency: Frequency;
  active: number;
  created_at: number;
}

interface Appointment {
  id: number;
  user_id: string;
  member_id: number;
  appointment_date: number;
  type: string;
  notes: string | null;
  created_at: number;
  member_name?: string;
}

interface Vaccination {
  id: number;
  user_id: string;
  member_id: number;
  vaccine_name: string;
  administered_date: number;
  notes: string | null;
  created_at: number;
}

interface MedStatus {
  member_name: string;
  med_name: string;
  med_id: number;
  dosage: string;
  frequency: Frequency;
  doses_today: number;
}

interface SlackClient {
  users: {
    info: (params: { user: string }) => Promise<{
      ok: boolean;
      user?: { tz?: string; tz_offset?: number };
    }>;
  };
}

// =============================================================================
// Exported Pure Functions (for testing)
// =============================================================================

/**
 * Validate and normalize a member name
 * Returns trimmed name or null if invalid
 */
export function validateMemberName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > 50) return null;
  return trimmed;
}

/**
 * Parse frequency string (case insensitive)
 */
export function parseFrequency(input: string): Frequency | null {
  const lower = input.toLowerCase() as Frequency;
  return VALID_FREQUENCIES.includes(lower) ? lower : null;
}

/**
 * Parse appointment date (future-biased for M/D, explicit for M/D/YY)
 * Dates >30 days in the past assume next year (M/D only)
 */
export function parseAppointmentDate(str: string): Date | null {
  // M/D/YYYY or M/D/YY
  const fullMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (fullMatch) {
    const month = parseInt(fullMatch[1], 10);
    const day = parseInt(fullMatch[2], 10);
    let year = parseInt(fullMatch[3], 10);
    if (year < 100) year += 2000;

    if (month < 1 || month > 12 || day < 1 || day > 31) return null;

    const date = new Date(year, month - 1, day);
    if (date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return date;
  }

  // M/D (future-biased)
  const shortMatch = str.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!shortMatch) return null;

  const month = parseInt(shortMatch[1], 10);
  const day = parseInt(shortMatch[2], 10);

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const now = new Date();
  let year = now.getFullYear();
  let date = new Date(year, month - 1, day);

  // Validate no overflow
  if (date.getMonth() !== month - 1 || date.getDate() !== day) return null;

  // Future bias: if date is >30 days in the past, assume next year
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  if (now.getTime() - date.getTime() > thirtyDaysMs) {
    date = new Date(year + 1, month - 1, day);
  }

  return date;
}

/**
 * Parse vaccination date - defaults to today if not provided
 * Past-biased for M/D (opposite of appointment dates)
 */
export function parseVaxDate(str: string | undefined): Date | null {
  if (!str) return new Date();

  // M/D/YYYY or M/D/YY
  const fullMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (fullMatch) {
    const month = parseInt(fullMatch[1], 10);
    const day = parseInt(fullMatch[2], 10);
    let year = parseInt(fullMatch[3], 10);
    if (year < 100) year += 2000;

    if (month < 1 || month > 12 || day < 1 || day > 31) return null;

    const date = new Date(year, month - 1, day);
    if (date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return date;
  }

  // M/D (past-biased for vaccinations)
  const shortMatch = str.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!shortMatch) return null;

  const month = parseInt(shortMatch[1], 10);
  const day = parseInt(shortMatch[2], 10);

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const now = new Date();
  let year = now.getFullYear();
  let date = new Date(year, month - 1, day);

  if (date.getMonth() !== month - 1 || date.getDate() !== day) return null;

  // Past bias: if date is >30 days in future, assume previous year
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  if (date.getTime() - now.getTime() > thirtyDaysMs) {
    date = new Date(year - 1, month - 1, day);
  }

  return date;
}

/**
 * Parse a time string like "8am", "8:30pm", "13:30"
 * Returns { hours, minutes } in 24-hour format or null
 */
export function parseTime(str: string): { hours: number; minutes: number } | null {
  if (!str) return null;

  // 12-hour format: 8am, 8:30pm
  const twelveMatch = str.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (twelveMatch) {
    let hours = parseInt(twelveMatch[1], 10);
    const minutes = parseInt(twelveMatch[2] || '0', 10);
    const isPm = twelveMatch[3].toLowerCase() === 'pm';

    if (hours < 1 || hours > 12 || minutes < 0 || minutes > 59) return null;

    if (isPm && hours !== 12) hours += 12;
    if (!isPm && hours === 12) hours = 0;

    return { hours, minutes };
  }

  // 24-hour format: 8:00, 13:30
  const twentyFourMatch = str.match(/^(\d{1,2}):(\d{2})$/);
  if (twentyFourMatch) {
    const hours = parseInt(twentyFourMatch[1], 10);
    const minutes = parseInt(twentyFourMatch[2], 10);

    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

    return { hours, minutes };
  }

  return null;
}

/**
 * Number of doses expected per day for a given frequency
 */
export function dosesExpectedToday(frequency: Frequency): number {
  switch (frequency) {
    case 'daily': return 1;
    case '2x-daily': return 2;
    case '3x-daily': return 3;
    case 'weekly': return 1;
    case 'as-needed': return 0;
  }
}

/**
 * Format a timestamp as "8:15 AM" in the given timezone
 */
export function formatTime(timestamp: number, tz: string | null): string {
  const date = new Date(timestamp);
  if (tz) {
    return date.toLocaleTimeString('en-US', {
      timeZone: tz,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Format a timestamp as M/D, timezone-aware.
 * Falls back to UTC (not server-local) when no timezone is provided.
 */
export function formatDateShort(timestamp: number, tz: string | null = null): string {
  const d = new Date(timestamp);
  if (tz) {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      month: 'numeric',
      day: 'numeric',
    });
    const parts = formatter.formatToParts(d);
    const month = parts.find(p => p.type === 'month')?.value || '';
    const day = parts.find(p => p.type === 'day')?.value || '';
    return `${month}/${day}`;
  }
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

/**
 * Format a timestamp as "Mon M/D", timezone-aware.
 * Falls back to UTC (not server-local) when no timezone is provided.
 */
export function formatDateWithDay(timestamp: number, tz: string | null = null): string {
  const d = new Date(timestamp);
  if (tz) {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
      month: 'numeric',
      day: 'numeric',
    });
    const parts = formatter.formatToParts(d);
    const weekday = parts.find(p => p.type === 'weekday')?.value || '';
    const month = parts.find(p => p.type === 'month')?.value || '';
    const day = parts.find(p => p.type === 'day')?.value || '';
    return `${weekday} ${month}/${day}`;
  }
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${days[d.getUTCDay()]} ${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

// =============================================================================
// Timezone Utilities
// =============================================================================

async function getUserTimezone(userId: string, client: SlackClient): Promise<string | null> {
  const cached = timezoneCache.get(userId);
  if (cached && cached.expires > Date.now()) {
    return cached.tz;
  }

  try {
    const result = await client.users.info({ user: userId });
    const tz = result.user?.tz || null;

    if (tz) {
      timezoneCache.set(userId, { tz, expires: Date.now() + TIMEZONE_CACHE_TTL });
    }

    return tz;
  } catch (error) {
    logger.warn('Failed to get user timezone, using UTC', { userId, error });
    return null;
  }
}

/**
 * Parse the UTC offset in milliseconds for a given date in a timezone.
 * Positive = east of UTC, negative = west of UTC.
 * Returns 0 if offset cannot be parsed (e.g., for UTC/GMT).
 */
export function parseTimezoneOffsetMs(date: Date, tz: string): number {
  const tzFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'shortOffset',
  });
  const tzParts = tzFormatter.formatToParts(date);
  const offsetPart = tzParts.find((p) => p.type === 'timeZoneName')?.value || '';

  const offsetMatch = offsetPart.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (offsetMatch) {
    const sign = offsetMatch[1] === '+' ? 1 : -1;
    const hours = parseInt(offsetMatch[2], 10);
    const minutes = parseInt(offsetMatch[3] || '0', 10);
    return sign * (hours * 60 + minutes) * 60 * 1000;
  }

  return 0;
}

/**
 * Get start of today as a UTC timestamp, adjusted for timezone.
 * When tz is null, falls back to UTC (server-timezone-independent).
 */
export function getStartOfDay(tz: string | null): number {
  const now = new Date();

  if (!tz) {
    // Fallback to UTC date parts (server-timezone-independent)
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  }

  // Get current date parts in user's timezone
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = formatter.format(now).split('-');
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);

  // Create midnight UTC for the user's date, then adjust by timezone offset
  const midnightUTC = Date.UTC(year, month, day);
  const offsetMs = parseTimezoneOffsetMs(new Date(midnightUTC), tz);

  // Midnight in user's tz = midnight UTC - offset
  // If user is GMT-5, midnight their time = 5am UTC (midnightUTC - (-5h) = midnightUTC + 5h)
  return midnightUTC - offsetMs;
}

/**
 * Build a timestamp from today's date + parsed time, respecting timezone.
 * Uses Date.UTC to avoid server timezone dependency.
 */
function buildTimestampFromTime(
  parsedTime: { hours: number; minutes: number },
  tz: string | null
): number {
  const now = new Date();

  if (tz) {
    // Get today's date in user's timezone
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.format(now).split('-');
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);

    // Build midnight UTC for that date, apply time, then adjust by offset
    const targetUTC = Date.UTC(year, month, day, parsedTime.hours, parsedTime.minutes);
    const offsetMs = parseTimezoneOffsetMs(new Date(targetUTC), tz);
    return targetUTC - offsetMs;
  }

  // No timezone: use UTC date parts
  return Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    parsedTime.hours,
    parsedTime.minutes
  );
}

// =============================================================================
// Database Helpers
// =============================================================================

function findMember(db: PluginDatabase, userId: string, name: string): Member | undefined {
  return db.prepare(
    `SELECT * FROM plugin_health_members WHERE user_id = ? AND name = ? COLLATE NOCASE`
  ).get(userId, name) as Member | undefined;
}

function findMedication(db: PluginDatabase, memberId: number, medName: string): Medication | undefined {
  return db.prepare(
    `SELECT * FROM plugin_health_medications
     WHERE member_id = ? AND name = ? COLLATE NOCASE AND active = 1`
  ).get(memberId, medName) as Medication | undefined;
}

function getActiveMeds(db: PluginDatabase, memberId: number): Medication[] {
  return db.prepare(
    `SELECT * FROM plugin_health_medications
     WHERE member_id = ? AND active = 1 ORDER BY name`
  ).all(memberId) as Medication[];
}

function getMedStatusForUser(db: PluginDatabase, userId: string, startOfDay: number): MedStatus[] {
  return db.prepare(
    `SELECT m.name as member_name, med.name as med_name, med.id as med_id,
            med.dosage, med.frequency,
            (SELECT COUNT(*) FROM plugin_health_doses d
             WHERE d.medication_id = med.id AND d.taken_at >= ?) as doses_today
     FROM plugin_health_medications med
     JOIN plugin_health_members m ON med.member_id = m.id
     WHERE med.user_id = ? AND med.active = 1
     ORDER BY m.name, med.name`
  ).all(startOfDay, userId) as MedStatus[];
}

function getDoseTimes(db: PluginDatabase, medId: number, startOfDay: number): number[] {
  const rows = db.prepare(
    `SELECT taken_at FROM plugin_health_doses
     WHERE medication_id = ? AND taken_at >= ?
     ORDER BY taken_at`
  ).all(medId, startOfDay) as { taken_at: number }[];
  return rows.map(r => r.taken_at);
}

function getUpcomingAppointments(
  db: PluginDatabase,
  userId: string,
  fromTs: number,
  days: number
): (Appointment & { member_name: string })[] {
  const toTs = fromTs + days * 24 * 60 * 60 * 1000;
  return db.prepare(
    `SELECT a.*, m.name as member_name
     FROM plugin_health_appointments a
     JOIN plugin_health_members m ON a.member_id = m.id
     WHERE a.user_id = ? AND a.appointment_date >= ? AND a.appointment_date <= ?
     ORDER BY a.appointment_date`
  ).all(userId, fromTs, toTs) as (Appointment & { member_name: string })[];
}

// =============================================================================
// Subcommand Handlers
// =============================================================================

function handleHelp(respond: RespondFn): Promise<void> {
  return respond(
    buildChannelResponse([
      header('Health Tracker'),
      section(
        '*Family Members:*\n' +
        '`/health add <name>` - Add member\n' +
        '`/health list` - List members\n' +
        '`/health remove <name>` - Remove member'
      ),
      divider(),
      section(
        '*Medications:*\n' +
        '`/health med <name> <med> <dosage> <freq>` - Add med\n' +
        '`/health med <name>` - Show active meds\n' +
        '`/health med remove <name> <med>` - Stop tracking\n' +
        '`/health took <name> <med> [time]` - Log dose\n' +
        '`/health took <name> [time]` - Log all meds taken\n' +
        '`/health meds` - All-family status'
      ),
      context('Frequencies: daily, 2x-daily, 3x-daily, weekly, as-needed'),
      context('Time is optional: `/health took Emma Ibuprofen 8:30am`'),
      divider(),
      section(
        '*Appointments:*\n' +
        '`/health appt <name> <date> <type> [notes]` - Add\n' +
        '`/health appt` - Upcoming (30 days)\n' +
        '`/health appt remove <id>` - Cancel'
      ),
      context('Dates: M/D or M/D/YY (e.g., 3/15 or 3/15/26)'),
      divider(),
      section(
        '*Vaccinations:*\n' +
        '`/health vax <name> <vaccine> [date]` - Log\n' +
        '`/health vax <name>` - History'
      ),
    ])
  );
}

async function handleAdd(
  args: string[],
  userId: string,
  db: PluginDatabase,
  respond: RespondFn
): Promise<void> {
  const rawName = args.join(' ');
  const name = validateMemberName(rawName);
  if (!name) {
    await respond(buildChannelResponse([section(':warning: Name must be 1-50 characters.')]));
    return;
  }

  const existing = findMember(db, userId, name);
  if (existing) {
    await respond(buildChannelResponse([section(`:warning: *${existing.name}* is already added.`)]));
    return;
  }

  db.prepare(
    `INSERT INTO plugin_health_members (user_id, name, created_at) VALUES (?, ?, ?)`
  ).run(userId, name, Date.now());

  await respond(buildChannelResponse([section(`:white_check_mark: Added *${name}* to your family.`)]));
}

async function handleList(userId: string, db: PluginDatabase, respond: RespondFn): Promise<void> {
  const members = db.prepare(
    `SELECT name FROM plugin_health_members WHERE user_id = ? ORDER BY name`
  ).all(userId) as { name: string }[];

  if (members.length === 0) {
    await respond(buildChannelResponse([
      section('No family members yet.'),
      context('Add one with `/health add <name>`'),
    ]));
    return;
  }

  const list = members.map(m => `• ${m.name}`).join('\n');
  await respond(buildChannelResponse([
    header('Family Members'),
    section(list),
  ]));
}

async function handleRemove(
  args: string[],
  userId: string,
  db: PluginDatabase,
  respond: RespondFn
): Promise<void> {
  const name = args.join(' ').trim();
  if (!name) {
    await respond(buildChannelResponse([section(':warning: Usage: `/health remove <name>`')]));
    return;
  }

  const member = findMember(db, userId, name);
  if (!member) {
    await respond(buildChannelResponse([section(`:warning: Member *${name}* not found.`)]));
    return;
  }

  db.prepare(`DELETE FROM plugin_health_members WHERE id = ?`).run(member.id);
  await respond(buildChannelResponse([
    section(`:white_check_mark: Removed *${member.name}* and all their health records.`),
  ]));
}

async function handleMed(
  args: string[],
  userId: string,
  db: PluginDatabase,
  respond: RespondFn
): Promise<void> {
  if (args.length === 0) {
    await respond(buildChannelResponse([section(':warning: Usage: `/health med <name> [med dosage freq]`')]));
    return;
  }

  // /health med remove <name> <med>
  if (args[0].toLowerCase() === 'remove') {
    if (args.length < 3) {
      await respond(buildChannelResponse([section(':warning: Usage: `/health med remove <name> <med>`')]));
      return;
    }
    const memberName = args[1];
    const medName = args.slice(2).join(' ');
    const member = findMember(db, userId, memberName);
    if (!member) {
      await respond(buildChannelResponse([section(`:warning: Member *${memberName}* not found.`)]));
      return;
    }
    const med = findMedication(db, member.id, medName);
    if (!med) {
      await respond(buildChannelResponse([section(`:warning: Active medication *${medName}* not found for *${member.name}*.`)]));
      return;
    }
    db.prepare(`UPDATE plugin_health_medications SET active = 0 WHERE id = ?`).run(med.id);
    await respond(buildChannelResponse([
      section(`:white_check_mark: Stopped tracking *${med.name}* for *${member.name}*.`),
    ]));
    return;
  }

  // /health med <name> → show meds for that person
  // /health med <name> <med> <dosage> <freq> → add med
  const memberName = args[0];
  const member = findMember(db, userId, memberName);
  if (!member) {
    await respond(buildChannelResponse([section(`:warning: Member *${memberName}* not found. Add them with \`/health add ${memberName}\`.`)]));
    return;
  }

  if (args.length === 1) {
    // Show meds for this member
    const meds = getActiveMeds(db, member.id);
    if (meds.length === 0) {
      await respond(buildChannelResponse([
        section(`No active medications for *${member.name}*.`),
        context('Add one with `/health med ' + member.name + ' <med> <dosage> <freq>`'),
      ]));
      return;
    }
    const list = meds.map(m => `• *${m.name}* ${m.dosage} (${m.frequency})`).join('\n');
    await respond(buildChannelResponse([
      header(`${member.name}'s Medications`),
      section(list),
    ]));
    return;
  }

  // Add medication: <name> <med> <dosage> <freq>
  if (args.length < 4) {
    await respond(buildChannelResponse([
      section(':warning: Usage: `/health med <name> <medication> <dosage> <frequency>`'),
      context('Example: `/health med Emma Amoxicillin 250mg 2x-daily`'),
    ]));
    return;
  }

  const medName = args[1];
  const dosage = args[2];
  const freq = parseFrequency(args[3]);
  if (!freq) {
    await respond(buildChannelResponse([
      section(`:warning: Invalid frequency: *${args[3]}*`),
      context('Valid: daily, 2x-daily, 3x-daily, weekly, as-needed'),
    ]));
    return;
  }

  const existingMed = findMedication(db, member.id, medName);
  if (existingMed) {
    await respond(buildChannelResponse([
      section(`:warning: *${existingMed.name}* is already tracked for *${member.name}*.`),
    ]));
    return;
  }

  db.prepare(
    `INSERT INTO plugin_health_medications (user_id, member_id, name, dosage, frequency, active, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?)`
  ).run(userId, member.id, medName, dosage, freq, Date.now());

  await respond(buildChannelResponse([
    section(`:white_check_mark: Added *${medName}* ${dosage} (${freq}) for *${member.name}*.`),
  ]));
}

async function handleTook(
  args: string[],
  userId: string,
  db: PluginDatabase,
  respond: RespondFn,
  tz: string | null
): Promise<void> {
  if (args.length === 0) {
    await respond(buildChannelResponse([section(':warning: Usage: `/health took <name> [med] [time]`')]));
    return;
  }

  const memberName = args[0];
  const member = findMember(db, userId, memberName);
  if (!member) {
    await respond(buildChannelResponse([section(`:warning: Member *${memberName}* not found.`)]));
    return;
  }

  // Parse optional time from the last argument
  let takenAt = Date.now();
  let remainingArgs = args.slice(1);
  if (remainingArgs.length > 0) {
    const lastArg = remainingArgs[remainingArgs.length - 1];
    const parsedTime = parseTime(lastArg);
    if (parsedTime) {
      takenAt = buildTimestampFromTime(parsedTime, tz);
      remainingArgs = remainingArgs.slice(0, -1);
    }
  }

  if (remainingArgs.length === 0) {
    // Bulk: log all active meds
    const meds = getActiveMeds(db, member.id);
    if (meds.length === 0) {
      await respond(buildChannelResponse([section(`:warning: No active medications for *${member.name}*.`)]));
      return;
    }

    const now = Date.now();
    db.transaction(() => {
      for (const med of meds) {
        db.prepare(
          `INSERT INTO plugin_health_doses (user_id, medication_id, taken_at, created_at) VALUES (?, ?, ?, ?)`
        ).run(userId, med.id, takenAt, now);
      }
    });

    const medList = meds.map(m => m.name).join(', ');
    const timeStr = formatTime(takenAt, tz);
    await respond(buildChannelResponse([
      section(`:white_check_mark: Logged all meds for *${member.name}* at ${timeStr}`),
      context(medList),
    ]));
    return;
  }

  // Single med
  const medName = remainingArgs.join(' ');
  const med = findMedication(db, member.id, medName);
  if (!med) {
    await respond(buildChannelResponse([
      section(`:warning: Active medication *${medName}* not found for *${member.name}*.`),
    ]));
    return;
  }

  db.prepare(
    `INSERT INTO plugin_health_doses (user_id, medication_id, taken_at, created_at) VALUES (?, ?, ?, ?)`
  ).run(userId, med.id, takenAt, Date.now());

  const timeStr = formatTime(takenAt, tz);
  await respond(buildChannelResponse([
    section(`:white_check_mark: *${member.name}* took *${med.name}* ${med.dosage} at ${timeStr}`),
  ]));
}

async function handleMeds(
  userId: string,
  db: PluginDatabase,
  respond: RespondFn,
  tz: string | null
): Promise<void> {
  const startOfDay = getStartOfDay(tz);
  const statuses = getMedStatusForUser(db, userId, startOfDay);

  if (statuses.length === 0) {
    await respond(buildChannelResponse([
      section('No active medications being tracked.'),
      context('Add a med with `/health med <name> <med> <dosage> <freq>`'),
    ]));
    return;
  }

  // Group by member
  const byMember = new Map<string, MedStatus[]>();
  for (const s of statuses) {
    const existing = byMember.get(s.member_name) || [];
    existing.push(s);
    byMember.set(s.member_name, existing);
  }

  const blocks: ReturnType<typeof header | typeof section | typeof divider | typeof context>[] = [
    header('Medications Today'),
  ];

  for (const [memberName, meds] of byMember) {
    const lines = meds.map(m => {
      const expected = dosesExpectedToday(m.frequency as Frequency);
      const times = getDoseTimes(db, m.med_id, startOfDay);
      const timeStrs = times.map(t => formatTime(t, tz));

      if (m.frequency === 'as-needed') {
        if (times.length > 0) {
          return `:white_check_mark: *${m.med_name}* ${m.dosage} - ${timeStrs.join(', ')}`;
        }
        return `:white_circle: *${m.med_name}* ${m.dosage} (as needed)`;
      }

      const done = m.doses_today >= expected;
      const emoji = done ? ':white_check_mark:' : ':red_circle:';
      const status = `${m.doses_today}/${expected}`;
      const timeInfo = timeStrs.length > 0 ? ` - ${timeStrs.join(', ')}` : '';
      return `${emoji} *${m.med_name}* ${m.dosage} [${status}]${timeInfo}`;
    });

    blocks.push(section(`*${memberName}*\n${lines.join('\n')}`));
  }

  await respond(buildChannelResponse(blocks));
}

async function handleAppt(
  args: string[],
  userId: string,
  db: PluginDatabase,
  respond: RespondFn,
  tz: string | null
): Promise<void> {
  // /health appt → list upcoming
  if (args.length === 0) {
    const now = Date.now();
    const appointments = getUpcomingAppointments(db, userId, now, 30);

    if (appointments.length === 0) {
      await respond(buildChannelResponse([
        section('No upcoming appointments in the next 30 days.'),
        context('Add one with `/health appt <name> <date> <type>`'),
      ]));
      return;
    }

    const lines = appointments.map(a => {
      const dateStr = formatDateWithDay(a.appointment_date, tz);
      const notes = a.notes ? ` - ${a.notes}` : '';
      return `• *${a.member_name}* - ${dateStr} - ${a.type}${notes} _(#${a.id})_`;
    });

    await respond(buildChannelResponse([
      header('Upcoming Appointments'),
      section(lines.join('\n')),
      context('Cancel with `/health appt remove <id>`'),
    ]));
    return;
  }

  // /health appt remove <id>
  if (args[0].toLowerCase() === 'remove') {
    if (args.length < 2) {
      await respond(buildChannelResponse([section(':warning: Usage: `/health appt remove <id>`')]));
      return;
    }
    const id = parseInt(args[1].replace('#', ''), 10);
    if (isNaN(id)) {
      await respond(buildChannelResponse([section(':warning: Invalid appointment ID.')]));
      return;
    }
    const result = db.prepare(
      `DELETE FROM plugin_health_appointments WHERE id = ? AND user_id = ?`
    ).run(id, userId);
    if (result.changes === 0) {
      await respond(buildChannelResponse([section(':warning: Appointment not found.')]));
      return;
    }
    await respond(buildChannelResponse([section(`:white_check_mark: Cancelled appointment #${id}.`)]));
    return;
  }

  // /health appt <name> <date> <type> [notes]
  if (args.length < 3) {
    await respond(buildChannelResponse([
      section(':warning: Usage: `/health appt <name> <date> <type> [notes]`'),
      context('Example: `/health appt Emma 3/15 Dentist cleaning`'),
    ]));
    return;
  }

  const memberName = args[0];
  const member = findMember(db, userId, memberName);
  if (!member) {
    await respond(buildChannelResponse([section(`:warning: Member *${memberName}* not found.`)]));
    return;
  }

  const date = parseAppointmentDate(args[1]);
  if (!date) {
    await respond(buildChannelResponse([
      section(`:warning: Invalid date: *${args[1]}*`),
      context('Use M/D (e.g., 3/15) or M/D/YY (e.g., 3/15/26)'),
    ]));
    return;
  }

  const type = args[2];
  const notes = args.length > 3 ? args.slice(3).join(' ') : null;

  const apptId = (db.prepare(
    `INSERT INTO plugin_health_appointments (user_id, member_id, appointment_date, type, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(userId, member.id, date.getTime(), type, notes, Date.now()) as { lastInsertRowid: number }).lastInsertRowid;

  const dateStr = formatDateWithDay(date.getTime(), tz);
  const notesStr = notes ? ` - ${notes}` : '';
  await respond(buildChannelResponse([
    section(`:white_check_mark: Appointment added for *${member.name}*: ${dateStr} - ${type}${notesStr} _(#${apptId})_`),
  ]));
}

async function handleVax(
  args: string[],
  userId: string,
  db: PluginDatabase,
  respond: RespondFn,
  tz: string | null
): Promise<void> {
  if (args.length === 0) {
    await respond(buildChannelResponse([section(':warning: Usage: `/health vax <name> [vaccine] [date]`')]));
    return;
  }

  const memberName = args[0];
  const member = findMember(db, userId, memberName);
  if (!member) {
    await respond(buildChannelResponse([section(`:warning: Member *${memberName}* not found.`)]));
    return;
  }

  // /health vax <name> → show history
  if (args.length === 1) {
    const vaxes = db.prepare(
      `SELECT vaccine_name, administered_date, notes
       FROM plugin_health_vaccinations
       WHERE member_id = ?
       ORDER BY administered_date DESC`
    ).all(member.id) as Vaccination[];

    if (vaxes.length === 0) {
      await respond(buildChannelResponse([
        section(`No vaccination records for *${member.name}*.`),
        context('Log one with `/health vax ' + member.name + ' <vaccine>`'),
      ]));
      return;
    }

    const lines = vaxes.map(v => {
      const dateStr = formatDateShort(v.administered_date, tz);
      const notes = v.notes ? ` - ${v.notes}` : '';
      return `• ${dateStr} - *${v.vaccine_name}*${notes}`;
    });

    await respond(buildChannelResponse([
      header(`${member.name}'s Vaccinations`),
      section(lines.join('\n')),
    ]));
    return;
  }

  // /health vax <name> <vaccine> [date]
  // Vaccine name may be quoted or multi-word; last arg might be a date
  let vaccineName: string;
  let date: Date;

  // Check if last arg is a date
  const lastArg = args[args.length - 1];
  const parsedDate = args.length > 2 ? parseVaxDate(lastArg) : null;

  if (parsedDate && args.length > 2 && lastArg.includes('/')) {
    vaccineName = args.slice(1, -1).join(' ').replace(/^"(.*)"$/, '$1');
    date = parsedDate;
  } else {
    vaccineName = args.slice(1).join(' ').replace(/^"(.*)"$/, '$1');
    date = new Date();
  }

  if (!vaccineName.trim()) {
    await respond(buildChannelResponse([section(':warning: Vaccine name is required.')]));
    return;
  }

  db.prepare(
    `INSERT INTO plugin_health_vaccinations (user_id, member_id, vaccine_name, administered_date, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(userId, member.id, vaccineName, date.getTime(), null, Date.now());

  const dateStr = formatDateShort(date.getTime(), tz);
  await respond(buildChannelResponse([
    section(`:white_check_mark: Logged *${vaccineName}* for *${member.name}* on ${dateStr}.`),
  ]));
}

async function handleDashboard(
  userId: string,
  db: PluginDatabase,
  respond: RespondFn,
  tz: string | null
): Promise<void> {
  const members = db.prepare(
    `SELECT * FROM plugin_health_members WHERE user_id = ? ORDER BY name`
  ).all(userId) as Member[];

  if (members.length === 0) {
    await respond(buildChannelResponse([
      header('Health Dashboard'),
      section('No family members yet. Get started with `/health add <name>`.'),
    ]));
    return;
  }

  const startOfDay = getStartOfDay(tz);
  const now = Date.now();

  const blocks: ReturnType<typeof header | typeof section | typeof divider | typeof context>[] = [
    header('Health Dashboard'),
  ];

  // Medication status
  const statuses = getMedStatusForUser(db, userId, startOfDay);
  if (statuses.length > 0) {
    const byMember = new Map<string, MedStatus[]>();
    for (const s of statuses) {
      const existing = byMember.get(s.member_name) || [];
      existing.push(s);
      byMember.set(s.member_name, existing);
    }

    blocks.push(section('*Medications Today*'));
    for (const [memberName, meds] of byMember) {
      const lines = meds.map(m => {
        const expected = dosesExpectedToday(m.frequency as Frequency);
        const times = getDoseTimes(db, m.med_id, startOfDay);
        const timeStrs = times.map(t => formatTime(t, tz));

        if (m.frequency === 'as-needed') {
          if (times.length > 0) {
            return `:white_check_mark: ${m.med_name} ${m.dosage} - ${timeStrs.join(', ')}`;
          }
          return `:white_circle: ${m.med_name} ${m.dosage} (as needed)`;
        }

        const done = m.doses_today >= expected;
        const emoji = done ? ':white_check_mark:' : ':red_circle:';
        const timeInfo = timeStrs.length > 0 ? ` - ${timeStrs.join(', ')}` : '';
        return `${emoji} ${m.med_name} ${m.dosage} [${m.doses_today}/${expected}]${timeInfo}`;
      });
      blocks.push(context(`*${memberName}:* ${lines.join(' | ')}`));
    }
  }

  // Upcoming appointments (next 7 days)
  const appointments = getUpcomingAppointments(db, userId, now, 7);
  if (appointments.length > 0) {
    blocks.push(divider());
    blocks.push(section('*Upcoming Appointments*'));
    const lines = appointments.map(a => {
      const dateStr = formatDateWithDay(a.appointment_date, tz);
      return `• *${a.member_name}* - ${dateStr} - ${a.type}`;
    });
    blocks.push(section(lines.join('\n')));
  }

  if (statuses.length === 0 && appointments.length === 0) {
    blocks.push(section('No medications or appointments tracked yet.'));
    blocks.push(context('Try `/health help` to see all commands.'));
  }

  await respond(buildChannelResponse(blocks));
}

// =============================================================================
// Command Registration
// =============================================================================

function registerHealthCommand(app: App | PluginApp): void {
  app.command('/health', async ({ command, ack, respond, client }) => {
    await ack();

    if (!pluginDb) {
      await respond(buildChannelResponse([section(':x: Health plugin database not initialized.')]));
      return;
    }

    const args = command.text.trim().split(/\s+/).filter((a: string) => a.length > 0);
    const subcommand = args[0]?.toLowerCase() ?? '';
    const subArgs = args.slice(1);

    const slackClient = client as unknown as SlackClient;
    const tz = await getUserTimezone(command.user_id, slackClient);

    try {
      switch (subcommand) {
        case 'help':
          await handleHelp(respond);
          break;

        case 'add':
          await handleAdd(subArgs, command.user_id, pluginDb, respond);
          break;

        case 'list':
          await handleList(command.user_id, pluginDb, respond);
          break;

        case 'remove':
          await handleRemove(subArgs, command.user_id, pluginDb, respond);
          break;

        case 'med':
          await handleMed(subArgs, command.user_id, pluginDb, respond);
          break;

        case 'took':
          await handleTook(subArgs, command.user_id, pluginDb, respond, tz);
          break;

        case 'meds':
          await handleMeds(command.user_id, pluginDb, respond, tz);
          break;

        case 'appt':
          await handleAppt(subArgs, command.user_id, pluginDb, respond, tz);
          break;

        case 'vax':
          await handleVax(subArgs, command.user_id, pluginDb, respond, tz);
          break;

        default:
          // Default: show dashboard
          await handleDashboard(command.user_id, pluginDb, respond, tz);
          break;
      }
    } catch (error) {
      logger.error('Health plugin command error', { error, subcommand, userId: command.user_id });
      await respond(
        buildChannelResponse([section(`:x: Error: ${error instanceof Error ? error.message : 'Unknown error'}`)])
      );
    }
  });
}

// =============================================================================
// Claude AI Tools
// =============================================================================

const familyHealthSummaryTool: ToolDefinition = {
  spec: {
    name: 'get_family_health_summary',
    description:
      'Get a health dashboard summary: family members, active medications with today\'s dose status and timestamps, and upcoming appointments. ' +
      'Use when asked about health status, medications, or who took their meds.',
    input_schema: {
      type: 'object',
      properties: {
        user_id: {
          type: 'string',
          description: 'Slack user ID to get health data for',
        },
        member_name: {
          type: 'string',
          description: 'Optional: filter to a specific family member',
        },
      },
      required: ['user_id'],
    },
  },
  execute: async (input) => {
    if (!pluginDb) return 'Error: Health plugin database not initialized';

    const { user_id, member_name } = input as { user_id: string; member_name?: string };
    const startOfDay = getStartOfDay(null);
    const now = Date.now();

    const lines: string[] = [];

    // Members
    const members = pluginDb.prepare(
      `SELECT * FROM plugin_health_members WHERE user_id = ? ORDER BY name`
    ).all(user_id) as Member[];

    if (members.length === 0) {
      return 'No family members tracked. Add members with /health add <name>.';
    }

    const targetMembers = member_name
      ? members.filter(m => m.name.toLowerCase() === member_name.toLowerCase())
      : members;

    if (targetMembers.length === 0) {
      return `Member "${member_name}" not found. Members: ${members.map(m => m.name).join(', ')}`;
    }

    for (const member of targetMembers) {
      lines.push(`## ${member.name}`);

      // Active medications
      const meds = getActiveMeds(pluginDb, member.id);
      if (meds.length > 0) {
        lines.push('Medications:');
        for (const med of meds) {
          const expected = dosesExpectedToday(med.frequency);
          const times = getDoseTimes(pluginDb, med.id, startOfDay);
          const timeStrs = times.map(t => formatTime(t, null));

          const status = med.frequency === 'as-needed'
            ? (times.length > 0 ? `taken at ${timeStrs.join(', ')}` : 'as needed, not taken today')
            : `${times.length}/${expected} doses today${timeStrs.length > 0 ? ` (${timeStrs.join(', ')})` : ''}`;

          lines.push(`  - ${med.name} ${med.dosage} (${med.frequency}): ${status}`);
        }
      } else {
        lines.push('No active medications.');
      }

      // Upcoming appointments
      const appts = getUpcomingAppointments(pluginDb, user_id, now, 30).filter(
        a => a.member_id === member.id
      );
      if (appts.length > 0) {
        lines.push('Upcoming appointments:');
        for (const a of appts) {
          const dateStr = formatDateWithDay(a.appointment_date);
          const notes = a.notes ? ` - ${a.notes}` : '';
          lines.push(`  - ${dateStr}: ${a.type}${notes}`);
        }
      }

      lines.push('');
    }

    return lines.join('\n');
  },
};

const logDoseTool: ToolDefinition = {
  spec: {
    name: 'log_medication_dose',
    description:
      'Record that a medication dose was taken. Use when asked to log or record that someone took their medicine.',
    input_schema: {
      type: 'object',
      properties: {
        user_id: {
          type: 'string',
          description: 'Slack user ID who owns the data',
        },
        member_name: {
          type: 'string',
          description: 'Name of the family member who took the medication',
        },
        medication_name: {
          type: 'string',
          description: 'Name of the medication taken',
        },
      },
      required: ['user_id', 'member_name', 'medication_name'],
    },
  },
  execute: async (input) => {
    if (!pluginDb) return 'Error: Health plugin database not initialized';

    const { user_id, member_name, medication_name } = input as {
      user_id: string;
      member_name: string;
      medication_name: string;
    };

    const member = findMember(pluginDb, user_id, member_name);
    if (!member) return `Error: Member "${member_name}" not found.`;

    const med = findMedication(pluginDb, member.id, medication_name);
    if (!med) return `Error: Active medication "${medication_name}" not found for ${member.name}.`;

    const now = Date.now();
    pluginDb.prepare(
      `INSERT INTO plugin_health_doses (user_id, medication_id, taken_at, created_at) VALUES (?, ?, ?, ?)`
    ).run(user_id, med.id, now, now);

    const timeStr = formatTime(now, null);

    return `Logged: ${member.name} took ${med.name} ${med.dosage} at ${timeStr}`;
  },
};

const queryHealthTool: ToolDefinition = {
  spec: {
    name: 'query_health_records',
    description:
      'Query detailed health records: medication dose history, appointment list, or vaccination records. ' +
      'Use for specific lookups like "when did Emma last take Ibuprofen" or "show Jack\'s vaccinations".',
    input_schema: {
      type: 'object',
      properties: {
        user_id: {
          type: 'string',
          description: 'Slack user ID',
        },
        query_type: {
          type: 'string',
          enum: ['dose_history', 'appointments', 'vaccinations'],
          description: 'Type of records to query',
        },
        member_name: {
          type: 'string',
          description: 'Family member name (required for dose_history and vaccinations)',
        },
        days_back: {
          type: 'number',
          description: 'Number of days to look back for dose_history (default: 7)',
        },
        days_ahead: {
          type: 'number',
          description: 'Number of days to look ahead for appointments (default: 30)',
        },
      },
      required: ['user_id', 'query_type'],
    },
  },
  execute: async (input) => {
    if (!pluginDb) return 'Error: Health plugin database not initialized';

    const { user_id, query_type, member_name, days_back, days_ahead } = input as {
      user_id: string;
      query_type: string;
      member_name?: string;
      days_back?: number;
      days_ahead?: number;
    };

    switch (query_type) {
      case 'dose_history': {
        if (!member_name) return 'Error: member_name is required for dose_history';
        const member = findMember(pluginDb, user_id, member_name);
        if (!member) return `Error: Member "${member_name}" not found.`;

        const daysBack = days_back ?? 7;
        const since = Date.now() - daysBack * 24 * 60 * 60 * 1000;

        const doses = pluginDb.prepare(
          `SELECT d.taken_at, med.name as med_name, med.dosage
           FROM plugin_health_doses d
           JOIN plugin_health_medications med ON d.medication_id = med.id
           WHERE d.user_id = ? AND med.member_id = ? AND d.taken_at >= ?
           ORDER BY d.taken_at DESC`
        ).all(user_id, member.id, since) as { taken_at: number; med_name: string; dosage: string }[];

        if (doses.length === 0) {
          return `No dose records for ${member.name} in the last ${daysBack} days.`;
        }

        const lines = doses.map(d => {
          const dateStr = formatDateShort(d.taken_at);
          const timeStr = formatTime(d.taken_at, null);
          return `${dateStr} ${timeStr}: ${d.med_name} ${d.dosage}`;
        });

        return `Dose history for ${member.name} (last ${daysBack} days):\n${lines.join('\n')}`;
      }

      case 'appointments': {
        const now = Date.now();
        const daysAhead = days_ahead ?? 30;
        let appointments: (Appointment & { member_name: string })[];

        if (member_name) {
          const member = findMember(pluginDb, user_id, member_name);
          if (!member) return `Error: Member "${member_name}" not found.`;

          appointments = getUpcomingAppointments(pluginDb, user_id, now, daysAhead).filter(
            a => a.member_id === member.id
          );
        } else {
          appointments = getUpcomingAppointments(pluginDb, user_id, now, daysAhead);
        }

        if (appointments.length === 0) {
          return `No upcoming appointments in the next ${daysAhead} days.`;
        }

        const lines = appointments.map(a => {
          const dateStr = formatDateWithDay(a.appointment_date);
          const notes = a.notes ? ` - ${a.notes}` : '';
          return `${a.member_name}: ${dateStr} - ${a.type}${notes} (#${a.id})`;
        });

        return `Upcoming appointments:\n${lines.join('\n')}`;
      }

      case 'vaccinations': {
        if (!member_name) return 'Error: member_name is required for vaccinations';
        const member = findMember(pluginDb, user_id, member_name);
        if (!member) return `Error: Member "${member_name}" not found.`;

        const vaxes = pluginDb.prepare(
          `SELECT vaccine_name, administered_date, notes
           FROM plugin_health_vaccinations
           WHERE member_id = ?
           ORDER BY administered_date DESC`
        ).all(member.id) as Vaccination[];

        if (vaxes.length === 0) {
          return `No vaccination records for ${member.name}.`;
        }

        const lines = vaxes.map(v => {
          const dateStr = formatDateShort(v.administered_date);
          const notes = v.notes ? ` (${v.notes})` : '';
          return `${dateStr}: ${v.vaccine_name}${notes}`;
        });

        return `Vaccination history for ${member.name}:\n${lines.join('\n')}`;
      }

      default:
        return `Error: Unknown query_type "${query_type}". Use dose_history, appointments, or vaccinations.`;
    }
  },
};

// =============================================================================
// Plugin Export
// =============================================================================

const healthPlugin: Plugin = {
  name: 'health',
  version: '1.0.0',
  description: 'Family health tracker: medications, appointments, vaccinations',

  helpEntries: [
    { command: '/health', description: "Today's dashboard", group: 'Health' },
    { command: '/health help', description: 'Show all commands', group: 'Health' },
    { command: '/health add <name>', description: 'Add family member', group: 'Health - Members' },
    { command: '/health list', description: 'List all members', group: 'Health - Members' },
    { command: '/health remove <name>', description: 'Remove member and all records', group: 'Health - Members' },
    { command: '/health med <name> <med> <dosage> <freq>', description: 'Add medication', group: 'Health - Medications' },
    { command: '/health med <name>', description: 'Show active meds', group: 'Health - Medications' },
    { command: '/health med remove <name> <med>', description: 'Stop tracking', group: 'Health - Medications' },
    { command: '/health took <name> [med] [time]', description: 'Log dose taken', group: 'Health - Medications' },
    { command: '/health meds', description: 'All-family medication status', group: 'Health - Medications' },
    { command: '/health appt <name> <date> <type> [notes]', description: 'Add appointment', group: 'Health - Appointments' },
    { command: '/health appt', description: 'Upcoming appointments (30 days)', group: 'Health - Appointments' },
    { command: '/health appt remove <id>', description: 'Cancel appointment', group: 'Health - Appointments' },
    { command: '/health vax <name> <vaccine> [date]', description: 'Log vaccination', group: 'Health - Vaccinations' },
    { command: '/health vax <name>', description: 'Show vaccination history', group: 'Health - Vaccinations' },
  ],

  registerCommands: registerHealthCommand,

  tools: [familyHealthSummaryTool, logDoseTool, queryHealthTool],

  init: async (ctx: PluginContext) => {
    pluginDb = ctx.db;

    // Enable foreign keys for cascade deletes
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
    ctx.db.exec(`CREATE INDEX IF NOT EXISTS idx_plugin_health_members_user ON plugin_health_members(user_id)`);

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
    ctx.db.exec(`CREATE INDEX IF NOT EXISTS idx_plugin_health_meds_member ON plugin_health_medications(member_id, active)`);

    ctx.db.exec(`
      CREATE TABLE IF NOT EXISTS plugin_health_doses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        medication_id INTEGER NOT NULL REFERENCES plugin_health_medications(id) ON DELETE CASCADE,
        taken_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
    ctx.db.exec(`CREATE INDEX IF NOT EXISTS idx_plugin_health_doses_med ON plugin_health_doses(medication_id, taken_at)`);

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
    ctx.db.exec(`CREATE INDEX IF NOT EXISTS idx_plugin_health_appts_user ON plugin_health_appointments(user_id, appointment_date)`);

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
    ctx.db.exec(`CREATE INDEX IF NOT EXISTS idx_plugin_health_vax_member ON plugin_health_vaccinations(member_id, administered_date)`);

    logger.info('Health plugin initialized', {
      version: ctx.version,
      tablePrefix: ctx.db.prefix,
    });
  },

  destroy: async (ctx: PluginContext) => {
    pluginDb = null;
    logger.info('Health plugin destroyed', { name: ctx.name });
  },
};

export default healthPlugin;

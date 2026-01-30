/**
 * Lift Plugin - Powerlifting Calculator & Macro Tracker
 *
 * Example plugin demonstrating:
 * - Slash command registration (/lift)
 * - Subcommands (wilks, dots, 1rm, warmup, m/macros)
 * - Claude AI tool integration
 * - Database access via PluginContext (see init() for schema setup)
 * - Using formatters (header, section, divider, context)
 *
 * Commands:
 * - /lift wilks <total_kg> <bodyweight_kg> <m|f> - Calculate Wilks score
 * - /lift dots <total_kg> <bodyweight_kg> <m|f> - Calculate DOTS score
 * - /lift 1rm <weight> <reps> - Estimate 1 rep max
 * - /lift warmup <weight> [weight2] ... - Calculate warmup sets with plate loading
 * - /lift m c20 p40 f15 - Log macros (carbs, protein, fat in grams)
 * - /lift m - Show today's macro totals
 * - /lift m -1 - Show yesterday's totals
 * - /lift m 1/15 - Show specific date
 * - /lift m 1/10-1/15 - Show date range
 *
 * SECURITY NOTE: Plugins run with full process privileges.
 * This example is safe - it only performs math calculations.
 * When writing plugins that access external resources, be careful about:
 * - Input validation (use Zod schemas)
 * - File access (use allowed directories only)
 * - Network requests (validate URLs, don't leak credentials)
 *
 * Tool names are namespaced as "pluginname:toolname" to prevent
 * collision with built-in tools.
 *
 * To use:
 *   mkdir plugins.local
 *   cp plugins.example/lift.ts plugins.local/
 *   npm run dev
 */

import type { App, RespondFn } from '@slack/bolt';
import type { Plugin, PluginApp, PluginContext } from '../src/plugins/index.js';
import type { ToolDefinition } from '../src/services/tools/types.js';
import type { PluginDatabase } from '../src/services/plugin-database.js';
import { header, section, divider, context, buildResponse } from '../src/formatters/blocks.js';
import { logger } from '../src/utils/logger.js';

// =============================================================================
// Module-level state
// =============================================================================

let pluginDb: PluginDatabase | null = null;

// Cache user timezones to avoid repeated API calls (userId -> { tz, expires })
const timezoneCache = new Map<string, { tz: string; expires: number }>();
const TIMEZONE_CACHE_TTL = 60 * 60 * 1000; // 1 hour

// =============================================================================
// Database Types (example of plugin-managed schema)
// =============================================================================

/**
 * Example workout record type
 * This demonstrates the schema created in init() for workout tracking.
 * In a real plugin, you'd use this type with prepared statements:
 *
 * ```typescript
 * const stmt = ctx.db.prepare<[string, string], Workout>(
 *   `SELECT * FROM ${ctx.db.prefix}workouts WHERE user_id = ? AND date = ?`
 * );
 * const workout = stmt.get(userId, date);
 * ```
 */
export interface Workout {
  id: number;
  user_id: string;
  date: string;
  squat_kg: number | null;
  bench_kg: number | null;
  deadlift_kg: number | null;
  bodyweight_kg: number | null;
  notes: string | null;
  created_at: number;
}

/**
 * Macro totals for display
 */
export interface MacroTotals {
  carbs: number;
  protein: number;
  fat: number;
  entries: number;
}

/**
 * Query specification for viewing macro data
 */
export interface QuerySpec {
  type: 'today' | 'relative' | 'date' | 'range';
  daysAgo?: number;
  date?: Date;
  startDate?: Date;
  endDate?: Date;
}

// =============================================================================
// Constants for Warmup Calculator
// =============================================================================

const BAR_WEIGHT = 45; // lbs
const PLATE_SIZES = [45, 35, 25, 10, 5, 2.5] as const; // descending order
const WARMUP_PERCENTAGES = [0.4, 0.6, 0.8, 1.0] as const;
const MAX_TARGET_WEIGHT = 1000; // lbs - safety limit to prevent unbounded output

// =============================================================================
// Powerlifting Formulas
// =============================================================================

/**
 * Calculate Wilks score (2020 revision)
 * @see https://www.powerlifting.sport/fileadmin/ipf/data/ipf-formula/WilksFormula-Revision-2020.pdf
 */
function calculateWilks(totalKg: number, bodyweightKg: number, isMale: boolean): number {
  // Wilks 2020 coefficients
  const maleCoeffs = [-216.0475144, 16.2606339, -0.002388645, -0.00113732, 7.01863e-6, -1.291e-8];
  const femaleCoeffs = [594.31747775582, -27.23842536447, 0.82112226871, -0.00930733913, 4.731582e-5, -9.054e-8];

  const coeffs = isMale ? maleCoeffs : femaleCoeffs;
  const bw = bodyweightKg;

  const denominator =
    coeffs[0] +
    coeffs[1] * bw +
    coeffs[2] * Math.pow(bw, 2) +
    coeffs[3] * Math.pow(bw, 3) +
    coeffs[4] * Math.pow(bw, 4) +
    coeffs[5] * Math.pow(bw, 5);

  return (totalKg * 600) / denominator;
}

/**
 * Calculate DOTS score
 * @see https://www.powerlifting.sport/fileadmin/ipf/data/ipf-formula/DOTS_Formula.pdf
 */
function calculateDots(totalKg: number, bodyweightKg: number, isMale: boolean): number {
  const maleCoeffs = [-307.75076, 24.0900756, -0.1918759221, 0.0007391293, -0.000001093];
  const femaleCoeffs = [-57.96288, 13.6175032, -0.1126655495, 0.0005158568, -0.0000010706];

  const coeffs = isMale ? maleCoeffs : femaleCoeffs;
  const bw = bodyweightKg;

  const denominator =
    coeffs[0] +
    coeffs[1] * bw +
    coeffs[2] * Math.pow(bw, 2) +
    coeffs[3] * Math.pow(bw, 3) +
    coeffs[4] * Math.pow(bw, 4);

  return (totalKg * 500) / denominator;
}

/**
 * Estimate 1RM using Epley formula
 */
function calculate1rm(weight: number, reps: number): number {
  if (reps === 1) return weight;
  return weight * (1 + reps / 30);
}

/**
 * Calculate plate configuration for a given target weight
 * @param targetWeight Target weight in lbs
 * @returns String describing the plate configuration
 */
function calculatePlateConfig(targetWeight: number): string {
  if (targetWeight < BAR_WEIGHT) {
    // Dumbbell case: round total weight to nearest 10 lbs (5 lb increments per hand)
    // e.g., 32 lbs -> round(32/10)*5 = 15 lbs per hand = 30 lbs total
    const perHandWeight = Math.round(targetWeight / 10) * 5;
    return `2x${perHandWeight}lb DBs`;
  }

  // Greedy algorithm: fill with largest plates first
  // Note: May not hit exact weight if target isn't achievable with standard plates
  // (e.g., 46 lbs = bar + 2.5x2 = 50 lbs, can't load exactly 1 lb)
  let remaining = targetWeight - BAR_WEIGHT;
  const plates: string[] = [];

  for (const plateSize of PLATE_SIZES) {
    let pairCount = 0;
    while (remaining >= plateSize * 2) {
      remaining -= plateSize * 2;
      pairCount++;
    }
    if (pairCount > 0) {
      // Show total plate count (e.g., "45x2" means two 45s total, one per side)
      plates.push(`${plateSize}x${pairCount * 2}`);
    }
  }

  return plates.length > 0 ? `Bar + ${plates.join(' + ')}` : 'Bar only';
}

/**
 * Format warmup table for a single target weight
 * @param targetWeight Target weight in lbs
 * @returns Slack Block Kit blocks for the warmup table
 */
function formatWarmupTable(targetWeight: number): ReturnType<typeof header | typeof section>[] {
  const rows = WARMUP_PERCENTAGES.map((pct) => {
    const weight = Math.round(targetWeight * pct);
    const config = calculatePlateConfig(weight);
    const pctStr = `${Math.round(pct * 100)}%`.padEnd(4);
    const weightStr = `${weight} lbs`.padEnd(8);
    return `${pctStr} │ ${weightStr} │ ${config}`;
  });

  return [
    header(`Warmup: ${targetWeight} lbs`),
    section(
      '```\n' +
        '%    │ Weight   │ Configuration\n' +
        '─────┼──────────┼──────────────────────────\n' +
        rows.join('\n') +
        '\n```'
    ),
  ];
}

// =============================================================================
// Timezone Utilities (exported for testing)
// =============================================================================

export interface SlackClient {
  users: {
    info: (params: { user: string }) => Promise<{
      ok: boolean;
      user?: { tz?: string; tz_offset?: number };
    }>;
  };
}

/**
 * Get user's timezone from Slack API (cached for 1 hour)
 * Returns IANA timezone string like "America/New_York" or null if unavailable
 */
export async function getUserTimezone(userId: string, client: SlackClient): Promise<string | null> {
  // Check cache first
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
    logger.warn('Failed to get user timezone, using server time', { userId, error });
    return null;
  }
}

/**
 * Get start of day in a specific timezone
 * @param tz IANA timezone string (e.g., "America/New_York")
 * @param daysAgo Number of days ago (0 = today, 1 = yesterday)
 */
export function getStartOfDayInTimezone(tz: string | null, daysAgo: number = 0): number {
  const now = new Date();

  if (!tz) {
    // Fallback to server timezone
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return start.getTime() - daysAgo * 24 * 60 * 60 * 1000;
  }

  // Get current date parts in user's timezone
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  // Parse the formatted date (YYYY-MM-DD format from en-CA locale)
  const parts = formatter.format(now).split('-');
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1; // JS months are 0-indexed
  const day = parseInt(parts[2], 10);

  // Create a date at midnight in the user's timezone
  // We use a different approach: find what UTC time corresponds to midnight in their tz
  const midnightLocal = new Date(year, month, day - daysAgo);

  // Get the UTC offset for that date in the target timezone
  const tzFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'shortOffset',
  });
  const tzParts = tzFormatter.formatToParts(midnightLocal);
  const offsetPart = tzParts.find((p) => p.type === 'timeZoneName')?.value || '';

  // Parse offset like "GMT-5" or "GMT+5:30"
  const offsetMatch = offsetPart.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (offsetMatch) {
    const sign = offsetMatch[1] === '+' ? 1 : -1;
    const hours = parseInt(offsetMatch[2], 10);
    const minutes = parseInt(offsetMatch[3] || '0', 10);
    const offsetMs = sign * (hours * 60 + minutes) * 60 * 1000;

    // Midnight in user's tz = midnight local - offset
    // Actually we need: when it's midnight in user's tz, what's the UTC time?
    // If user is GMT-5, midnight their time = 5am UTC
    return midnightLocal.getTime() - offsetMs;
  }

  // Fallback if offset parsing fails
  return midnightLocal.getTime();
}

/**
 * Convert a Date to start of day in user's timezone
 */
export function dateToStartOfDayInTimezone(date: Date, tz: string | null): number {
  if (!tz) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  }

  // Get the date parts in user's timezone
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  // Format the target date
  const targetLocal = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12); // noon to avoid DST issues
  const parts = formatter.format(targetLocal).split('-');
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);

  // Now find midnight in that timezone
  const midnightLocal = new Date(year, month, day);

  const tzFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'shortOffset',
  });
  const tzParts = tzFormatter.formatToParts(midnightLocal);
  const offsetPart = tzParts.find((p) => p.type === 'timeZoneName')?.value || '';

  const offsetMatch = offsetPart.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (offsetMatch) {
    const sign = offsetMatch[1] === '+' ? 1 : -1;
    const hours = parseInt(offsetMatch[2], 10);
    const minutes = parseInt(offsetMatch[3] || '0', 10);
    const offsetMs = sign * (hours * 60 + minutes) * 60 * 1000;
    return midnightLocal.getTime() - offsetMs;
  }

  return midnightLocal.getTime();
}

// =============================================================================
// Macros Tracking Functions
// =============================================================================

/**
 * Parse macro arguments like "c20 p40 f15"
 */
export function parseMacroArgs(args: string[]): { carbs: number; fat: number; protein: number } | null {
  const result = { carbs: 0, fat: 0, protein: 0 };
  let found = false;

  for (const arg of args) {
    const match = arg.toLowerCase().match(/^([cpf])(\d+)$/);
    if (!match) continue;

    const [, type, value] = match;
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 0) continue;

    found = true;
    if (type === 'c') result.carbs = num;
    else if (type === 'p') result.protein = num;
    else if (type === 'f') result.fat = num;
  }

  return found ? result : null;
}

/**
 * Parse a date string in M/D format
 * Uses heuristic: if date is >30 days in future, assume previous year
 */
export function parseDate(str: string): Date | null {
  const match = str.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!match) return null;
  const [, monthStr, dayStr] = match;
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  // Validate month (1-12) and day (1-31)
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const now = new Date();
  let year = now.getFullYear();
  let date = new Date(year, month - 1, day);

  // Check that the date didn't overflow (e.g., Feb 31 -> Mar 3)
  if (date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }

  // If date is >30 days in future, assume previous year
  // (e.g., querying "12/25" in January should return last December)
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  if (date.getTime() - now.getTime() > thirtyDaysMs) {
    date = new Date(year - 1, month - 1, day);
  }

  return date;
}

/**
 * Parse query arguments to determine what data to show
 */
export function parseQueryArgs(args: string[]): QuerySpec | null {
  if (args.length === 0) return { type: 'today' };

  const arg = args[0];

  // Relative days: -1, -7 (max 365 days)
  if (/^-\d+$/.test(arg)) {
    const daysAgo = parseInt(arg, 10);
    if (daysAgo < -365) return null; // Reject queries > 1 year
    return { type: 'relative', daysAgo };
  }

  // Date range: 1/10-1/15 (use regex for robust parsing)
  const rangeMatch = arg.match(/^(\d{1,2}\/\d{1,2})-(\d{1,2}\/\d{1,2})$/);
  if (rangeMatch) {
    const startDate = parseDate(rangeMatch[1]);
    const endDate = parseDate(rangeMatch[2]);
    // Validate chronological order (reject backwards ranges like 1/15-1/10)
    if (startDate && endDate && startDate <= endDate) {
      return { type: 'range', startDate, endDate };
    }
  }

  // Single date: 1/15
  if (arg.includes('/')) {
    const date = parseDate(arg);
    if (date) return { type: 'date', date };
  }

  return null; // Not a query, might be macro input
}

/**
 * Log macros to the database
 * @throws Error if userId is invalid or database operation fails
 */
function logMacros(
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
function getDailyTotals(userId: string, daysAgo: number, db: PluginDatabase, tz: string | null): MacroTotals {
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
function getTotalsForDate(userId: string, date: Date, db: PluginDatabase, tz: string | null): MacroTotals {
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
function getTotalsForRange(userId: string, start: Date, end: Date, db: PluginDatabase, tz: string | null): MacroTotals {
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

/**
 * Format date as M/D
 */
export function formatDateLabel(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

/**
 * Format macro summary for Slack display
 */
function formatMacroSummary(
  label: string,
  totals: MacroTotals
): ReturnType<typeof header | typeof section | typeof context>[] {
  const calories = totals.carbs * 4 + totals.protein * 4 + totals.fat * 9;

  return [
    header(`Macros: ${label}`),
    section(
      '```\n' +
        `Carbs:   ${String(totals.carbs).padStart(4)}g\n` +
        `Protein: ${String(totals.protein).padStart(4)}g\n` +
        `Fat:     ${String(totals.fat).padStart(4)}g\n` +
        '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n' +
        `Calories: ~${calories.toLocaleString()}\n` +
        '```'
    ),
    context(`${totals.entries} entries`),
  ];
}

/**
 * Handle /lift m commands
 * @param client Slack client for fetching user timezone
 */
async function handleMacros(
  args: string[],
  userId: string,
  db: PluginDatabase,
  respond: RespondFn,
  client: SlackClient
): Promise<void> {
  // Get user's timezone for accurate day boundaries
  const tz = await getUserTimezone(userId, client);

  // 1. Try to parse as macro input (c20 p40 f15)
  const macros = parseMacroArgs(args);
  if (macros) {
    // Log the entry with error handling
    try {
      logMacros(userId, macros, db);
    } catch (error) {
      logger.error('Failed to save macros', { error, userId });
      await respond(buildResponse([section(':x: Failed to save macros. Please try again.')]));
      return;
    }

    // Show confirmation + today's total
    const totals = getDailyTotals(userId, 0, db, tz);
    await respond(
      buildResponse([
        section(`:white_check_mark: +${macros.carbs}c ${macros.protein}p ${macros.fat}f`),
        divider(),
        ...formatMacroSummary('Today', totals),
      ])
    );
    return;
  }

  // 2. Check for help
  if (args.length === 1 && args[0].toLowerCase() === 'help') {
    await respond(
      buildResponse([
        header('Macro Tracker'),
        section(
          '*Log:* `/lift m c20 p40 f15`\n' +
            '*Today:* `/lift m`\n' +
            '*Yesterday:* `/lift m -1`\n' +
            '*Date:* `/lift m 1/15`\n' +
            '*Range:* `/lift m 1/10-1/15`'
        ),
        context('c=carbs p=protein f=fat (grams)'),
      ])
    );
    return;
  }

  // 3. Try to parse as query (date, range, or relative)
  const query = parseQueryArgs(args);
  if (query) {
    switch (query.type) {
      case 'today': {
        const today = getDailyTotals(userId, 0, db, tz);
        await respond(buildResponse(formatMacroSummary('Today', today)));
        break;
      }
      case 'relative': {
        const rel = getDailyTotals(userId, query.daysAgo!, db, tz);
        const label = query.daysAgo === -1 ? 'Yesterday' : `Last ${-query.daysAgo!} days`;
        await respond(buildResponse(formatMacroSummary(label, rel)));
        break;
      }
      case 'date': {
        const dateTotal = getTotalsForDate(userId, query.date!, db, tz);
        await respond(buildResponse(formatMacroSummary(formatDateLabel(query.date!), dateTotal)));
        break;
      }
      case 'range': {
        const rangeTotal = getTotalsForRange(userId, query.startDate!, query.endDate!, db, tz);
        const rangeLabel = `${formatDateLabel(query.startDate!)} - ${formatDateLabel(query.endDate!)}`;
        await respond(buildResponse(formatMacroSummary(rangeLabel, rangeTotal)));
        break;
      }
    }
    return;
  }

  // 4. Invalid input - show usage hint
  await respond(
    buildResponse([section(':warning: Invalid input. Try `/lift m c20 p40` or `/lift m help`')])
  );
}

// =============================================================================
// Slack Command Handler
// =============================================================================

function registerLiftCommand(app: App | PluginApp): void {
  app.command('/lift', async ({ command, ack, respond, client }) => {
    await ack();

    const args = command.text.trim().split(/\s+/);
    const subcommand = args[0]?.toLowerCase() ?? 'help';

    try {
      switch (subcommand) {
        case 'wilks': {
          // /lift wilks <total> <bodyweight> <m|f>
          const [, totalStr, bwStr, sex] = args;
          if (!totalStr || !bwStr || !sex) {
            await respond(
              buildResponse([
                section(':warning: Usage: `/lift wilks <total_kg> <bodyweight_kg> <m|f>`'),
                context('Example: `/lift wilks 500 83 m`'),
              ])
            );
            return;
          }

          const total = parseFloat(totalStr);
          const bw = parseFloat(bwStr);
          const isMale = sex.toLowerCase() === 'm';

          if (isNaN(total) || isNaN(bw) || total <= 0 || bw <= 0) {
            await respond(buildResponse([section(':x: Invalid numbers. Total and bodyweight must be positive.')]));
            return;
          }

          const wilks = calculateWilks(total, bw, isMale);
          await respond(
            buildResponse([
              header('Wilks Score'),
              section(`*Total:* ${total.toFixed(1)} kg\n*Bodyweight:* ${bw.toFixed(1)} kg\n*Sex:* ${isMale ? 'Male' : 'Female'}`),
              divider(),
              section(`:muscle: *Wilks Score: ${wilks.toFixed(2)}*`),
              context('Using Wilks 2020 formula'),
            ])
          );
          break;
        }

        case 'dots': {
          // /lift dots <total> <bodyweight> <m|f>
          const [, totalStr, bwStr, sex] = args;
          if (!totalStr || !bwStr || !sex) {
            await respond(
              buildResponse([
                section(':warning: Usage: `/lift dots <total_kg> <bodyweight_kg> <m|f>`'),
                context('Example: `/lift dots 500 83 m`'),
              ])
            );
            return;
          }

          const total = parseFloat(totalStr);
          const bw = parseFloat(bwStr);
          const isMale = sex.toLowerCase() === 'm';

          if (isNaN(total) || isNaN(bw) || total <= 0 || bw <= 0) {
            await respond(buildResponse([section(':x: Invalid numbers. Total and bodyweight must be positive.')]));
            return;
          }

          const dots = calculateDots(total, bw, isMale);
          await respond(
            buildResponse([
              header('DOTS Score'),
              section(`*Total:* ${total.toFixed(1)} kg\n*Bodyweight:* ${bw.toFixed(1)} kg\n*Sex:* ${isMale ? 'Male' : 'Female'}`),
              divider(),
              section(`:muscle: *DOTS Score: ${dots.toFixed(2)}*`),
              context('DOTS = Dynamic Object Tracking System'),
            ])
          );
          break;
        }

        case '1rm': {
          // /lift 1rm <weight> <reps>
          const [, weightStr, repsStr] = args;
          if (!weightStr || !repsStr) {
            await respond(
              buildResponse([
                section(':warning: Usage: `/lift 1rm <weight> <reps>`'),
                context('Example: `/lift 1rm 100 5` (100kg for 5 reps)'),
              ])
            );
            return;
          }

          const weight = parseFloat(weightStr);
          const reps = parseInt(repsStr, 10);

          if (isNaN(weight) || isNaN(reps) || weight <= 0 || reps <= 0 || reps > 20) {
            await respond(
              buildResponse([section(':x: Invalid input. Weight must be positive, reps must be 1-20.')])
            );
            return;
          }

          const estimated1rm = calculate1rm(weight, reps);
          await respond(
            buildResponse([
              header('Estimated 1RM'),
              section(`*Weight:* ${weight.toFixed(1)} kg\n*Reps:* ${reps}`),
              divider(),
              section(`:muscle: *Estimated 1RM: ${estimated1rm.toFixed(1)} kg*`),
              context('Using Epley formula: weight × (1 + reps/30)'),
            ])
          );
          break;
        }

        case 'm':
        case 'macros': {
          if (!pluginDb) {
            await respond(buildResponse([section(':x: Database not initialized')]));
            return;
          }
          await handleMacros(args.slice(1), command.user_id, pluginDb, respond, client as unknown as SlackClient);
          break;
        }

        case 'warmup': {
          // /lift warmup <weight1> [weight2] ...
          const weights = args
            .slice(1)
            .map((w: string) => parseFloat(w))
            .filter((w: number) => !isNaN(w) && w > 0);

          if (weights.length === 0) {
            await respond(
              buildResponse([
                section(':warning: Usage: `/lift warmup <weight> [weight2] ...`'),
                context('Example: `/lift warmup 200` or `/lift warmup 135 225 315`'),
              ])
            );
            return;
          }

          // Validate max weight to prevent unbounded output
          const invalidWeights = weights.filter((w: number) => w > MAX_TARGET_WEIGHT);
          if (invalidWeights.length > 0) {
            await respond(
              buildResponse([
                section(`:x: Weight(s) exceed maximum of ${MAX_TARGET_WEIGHT} lbs: ${invalidWeights.join(', ')}`),
              ])
            );
            return;
          }

          const blocks: ReturnType<typeof header | typeof section | typeof divider | typeof context>[] = [];
          for (const targetWeight of weights) {
            if (blocks.length > 0) blocks.push(divider());
            blocks.push(...formatWarmupTable(targetWeight));
          }
          blocks.push(context('Percentages: 40%, 60%, 80%, 100% | Bar = 45 lbs | Plate count is total (both sides)'));

          await respond(buildResponse(blocks));
          break;
        }

        case 'help':
        default:
          await respond(
            buildResponse([
              header('Lift Plugin'),
              section('*Calculators:*'),
              section(
                '`/lift wilks <total> <bw> <m|f>` - Wilks score\n' +
                  '`/lift dots <total> <bw> <m|f>` - DOTS score\n' +
                  '`/lift 1rm <weight> <reps>` - Estimate 1RM\n' +
                  '`/lift warmup <weight>` - Warmup sets'
              ),
              divider(),
              section('*Macro Tracking:*'),
              section(
                '`/lift m c20 p40 f15` - Log macros\n' +
                  '`/lift m` - Today\'s totals\n' +
                  '`/lift m -1` - Yesterday\n' +
                  '`/lift m 1/15` - Specific date\n' +
                  '`/lift m 1/10-1/15` - Date range'
              ),
            ])
          );
      }
    } catch (error) {
      await respond(
        buildResponse([section(`:x: Error: ${error instanceof Error ? error.message : 'Unknown error'}`)])
      );
    }
  });
}

// =============================================================================
// Claude AI Tool
// =============================================================================

const powerliftingTool: ToolDefinition = {
  spec: {
    name: 'calculate_powerlifting_score',
    description:
      'Calculate powerlifting scores (Wilks, DOTS) or estimate 1RM. ' +
      'Use this when asked about powerlifting strength scores or rep max estimates.',
    input_schema: {
      type: 'object',
      properties: {
        calculation: {
          type: 'string',
          enum: ['wilks', 'dots', '1rm'],
          description: 'Type of calculation: wilks, dots, or 1rm',
        },
        total_kg: {
          type: 'number',
          description: 'Total lifted in kg (for wilks/dots)',
        },
        bodyweight_kg: {
          type: 'number',
          description: 'Bodyweight in kg (for wilks/dots)',
        },
        is_male: {
          type: 'boolean',
          description: 'True for male, false for female (for wilks/dots)',
        },
        weight_kg: {
          type: 'number',
          description: 'Weight lifted in kg (for 1rm)',
        },
        reps: {
          type: 'number',
          description: 'Number of reps performed (for 1rm)',
        },
      },
      required: ['calculation'],
    },
  },
  execute: async (input) => {
    const { calculation, total_kg, bodyweight_kg, is_male, weight_kg, reps } = input as {
      calculation: string;
      total_kg?: number;
      bodyweight_kg?: number;
      is_male?: boolean;
      weight_kg?: number;
      reps?: number;
    };

    switch (calculation) {
      case 'wilks': {
        if (total_kg === undefined || bodyweight_kg === undefined || is_male === undefined) {
          return 'Error: wilks requires total_kg, bodyweight_kg, and is_male';
        }
        const score = calculateWilks(total_kg, bodyweight_kg, is_male);
        return `Wilks Score: ${score.toFixed(2)} (${is_male ? 'male' : 'female'}, ${total_kg}kg total @ ${bodyweight_kg}kg bodyweight)`;
      }

      case 'dots': {
        if (total_kg === undefined || bodyweight_kg === undefined || is_male === undefined) {
          return 'Error: dots requires total_kg, bodyweight_kg, and is_male';
        }
        const score = calculateDots(total_kg, bodyweight_kg, is_male);
        return `DOTS Score: ${score.toFixed(2)} (${is_male ? 'male' : 'female'}, ${total_kg}kg total @ ${bodyweight_kg}kg bodyweight)`;
      }

      case '1rm': {
        if (weight_kg === undefined || reps === undefined) {
          return 'Error: 1rm requires weight_kg and reps';
        }
        const estimated = calculate1rm(weight_kg, reps);
        return `Estimated 1RM: ${estimated.toFixed(1)}kg (based on ${weight_kg}kg × ${reps} reps using Epley formula)`;
      }

      default:
        return `Error: Unknown calculation type "${calculation}". Use wilks, dots, or 1rm.`;
    }
  },
};

const warmupTool: ToolDefinition = {
  spec: {
    name: 'calculate_warmup_sets',
    description:
      'Calculate warmup set percentages and plate loading configuration for one or more target weights. ' +
      'Use this when asked about warming up for a lift or what plates to load.',
    input_schema: {
      type: 'object',
      properties: {
        target_weights: {
          type: 'array',
          items: { type: 'number' },
          description: 'Target weight(s) in lbs to calculate warmup sets for',
        },
      },
      required: ['target_weights'],
    },
  },
  execute: async (input) => {
    const { target_weights } = input as { target_weights: number[] };

    if (!target_weights || target_weights.length === 0) {
      return 'Error: target_weights array is required';
    }

    const results: string[] = [];
    for (const targetWeight of target_weights) {
      if (targetWeight <= 0) {
        results.push(`Skipping invalid weight: ${targetWeight}`);
        continue;
      }
      if (targetWeight > MAX_TARGET_WEIGHT) {
        results.push(`Skipping weight exceeding maximum (${MAX_TARGET_WEIGHT} lbs): ${targetWeight}`);
        continue;
      }

      const lines: string[] = [`Warmup for ${targetWeight} lbs:`];
      for (const pct of WARMUP_PERCENTAGES) {
        const weight = Math.round(targetWeight * pct);
        const config = calculatePlateConfig(weight);
        lines.push(`  ${Math.round(pct * 100)}%: ${weight} lbs - ${config}`);
      }
      results.push(lines.join('\n'));
    }

    return results.join('\n\n');
  },
};

// =============================================================================
// Plugin Export
// =============================================================================

const liftPlugin: Plugin = {
  name: 'lift',
  version: '1.1.0',
  description: 'Powerlifting calculator (Wilks, DOTS, 1RM, warmup) and macro tracker',

  registerCommands: registerLiftCommand,

  tools: [powerliftingTool, warmupTool],

  init: async (ctx: PluginContext) => {
    // Store db reference for command handlers
    pluginDb = ctx.db;

    // Tables are automatically prefixed with "plugin_lift_" via ctx.db.prefix
    // Note: init() must complete within 10 seconds or plugin loading fails

    // Workouts table (example schema)
    ctx.db.exec(`
      CREATE TABLE IF NOT EXISTS ${ctx.db.prefix}workouts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        date TEXT NOT NULL,
        squat_kg REAL,
        bench_kg REAL,
        deadlift_kg REAL,
        bodyweight_kg REAL,
        notes TEXT,
        created_at INTEGER NOT NULL
      )
    `);

    ctx.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_${ctx.db.prefix}workouts_user
        ON ${ctx.db.prefix}workouts(user_id, date)
    `);

    // Macros table for nutrition tracking
    // Upper bounds prevent fat-finger errors (e.g., c20000 instead of c200)
    ctx.db.exec(`
      CREATE TABLE IF NOT EXISTS ${ctx.db.prefix}macros (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        carbs_g INTEGER NOT NULL DEFAULT 0 CHECK(carbs_g >= 0 AND carbs_g <= 5000),
        fat_g INTEGER NOT NULL DEFAULT 0 CHECK(fat_g >= 0 AND fat_g <= 2000),
        protein_g INTEGER NOT NULL DEFAULT 0 CHECK(protein_g >= 0 AND protein_g <= 2000),
        logged_at INTEGER NOT NULL CHECK(logged_at > 0),
        created_at INTEGER NOT NULL CHECK(created_at > 0)
      )
    `);

    ctx.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_${ctx.db.prefix}macros_user_date
        ON ${ctx.db.prefix}macros(user_id, logged_at)
    `);

    logger.info('Lift plugin initialized', {
      version: ctx.version,
      tablePrefix: ctx.db.prefix,
    });
  },

  destroy: async (ctx: PluginContext) => {
    // Clear module-level db reference
    pluginDb = null;
    // Note: destroy() must complete within 5 seconds
    logger.info('Lift plugin destroyed', { name: ctx.name });
  },
};

export default liftPlugin;

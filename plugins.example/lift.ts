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
 * - /lift wilks <total> <bodyweight> <m|f> - Calculate Wilks score
 * - /lift dots <total> <bodyweight> <m|f> - Calculate DOTS score
 * - /lift 1rm <weight> <reps> - Estimate 1 rep max
 * - /lift warmup <weight> [weight2] ... - Calculate warmup sets with plate loading
 * - /lift units [lbs|kg] - View or set weight unit preference (default: lbs)
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
import type { WebClient } from '@slack/web-api';
import type { Plugin, PluginApp, PluginContext, PluginClaude } from '../src/plugins/index.js';
import type { ToolDefinition } from '../src/services/tools/types.js';
import type { PluginDatabase } from '../src/services/plugin-database.js';
import { header, section, divider, context, buildResponse } from '../src/formatters/blocks.js';
import { logger } from '../src/utils/logger.js';
import { isValidImageUrl, fetchImageAsBase64, downloadImageToFile, cleanupTempImage } from '../src/utils/image.js';
import crypto from 'crypto';

// =============================================================================
// Database Migration Utilities
// =============================================================================

/**
 * Check if a column in a table is using INTEGER type instead of REAL
 * SQLite stores type affinity in the schema, we can check it via pragma
 */
function columnNeedsMigration(db: PluginDatabase, tableName: string, columnName: string): boolean {
  const tableInfo = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
    cid: number;
    name: string;
    type: string;
    notnull: number;
    dflt_value: string | null;
    pk: number;
  }>;

  const column = tableInfo.find(col => col.name === columnName);
  if (!column) return false;

  // Check if column type is INTEGER (needs migration to REAL)
  return column.type.toUpperCase() === 'INTEGER';
}

/**
 * Migrate table columns from INTEGER to REAL
 * SQLite doesn't support ALTER COLUMN, so we need to:
 * 1. Create a new table with REAL columns
 * 2. Copy data from old table
 * 3. Drop old table
 * 4. Rename new table
 *
 * This is safe because all existing integer values are valid as REAL values.
 */
async function migrateToRealColumns(
  db: PluginDatabase,
  tableName: string,
  columns: string[]
): Promise<void> {
  // Check if any column needs migration
  const needsMigration = columns.some(col => columnNeedsMigration(db, tableName, col));
  if (!needsMigration) {
    return;
  }

  logger.info(`Migrating ${tableName} columns to REAL type`, { columns });

  // Get current table schema
  const tableInfo = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
    cid: number;
    name: string;
    type: string;
    notnull: number;
    dflt_value: string | null;
    pk: number;
  }>;

  // Build new table definition with REAL columns
  const columnDefs = tableInfo.map(col => {
    let type = col.type;
    if (columns.includes(col.name)) {
      type = 'REAL';
    }
    let def = `${col.name} ${type}`;
    if (col.pk) def += ' PRIMARY KEY';
    if (col.name === 'id') def += ' AUTOINCREMENT';
    if (col.notnull && !col.pk) def += ' NOT NULL';
    if (col.dflt_value !== null) def += ` DEFAULT ${col.dflt_value}`;
    return def;
  });

  const columnNames = tableInfo.map(col => col.name).join(', ');
  const tempTableName = `${tableName}_migration_temp`;

  // Execute migration in a transaction
  db.exec('BEGIN TRANSACTION');
  try {
    // Create temp table with new schema
    db.exec(`CREATE TABLE ${tempTableName} (${columnDefs.join(', ')})`);

    // Copy data
    db.exec(`INSERT INTO ${tempTableName} (${columnNames}) SELECT ${columnNames} FROM ${tableName}`);

    // Drop old table
    db.exec(`DROP TABLE ${tableName}`);

    // Rename temp table
    db.exec(`ALTER TABLE ${tempTableName} RENAME TO ${tableName}`);

    db.exec('COMMIT');
    logger.info(`Successfully migrated ${tableName} to REAL columns`);
  } catch (error) {
    db.exec('ROLLBACK');
    logger.error(`Failed to migrate ${tableName}`, { error });
    throw error;
  }
}

// =============================================================================
// Module-level state
// =============================================================================

let pluginDb: PluginDatabase | null = null;
let pluginClaude: PluginClaude | undefined;

// Cache user timezones to avoid repeated API calls (userId -> { tz, expires })
const timezoneCache = new Map<string, { tz: string; expires: number }>();
const TIMEZONE_CACHE_TTL = 60 * 60 * 1000; // 1 hour

// Pending estimate expiration (15 minutes)
const PENDING_ESTIMATE_TTL = 15 * 60 * 1000;

/**
 * Food analysis system prompt for Claude
 * Used when analyzing food images via /lift a
 */
const FOOD_ANALYSIS_PROMPT = `
You are a nutrition expert analyzing food images to estimate macronutrients.

When analyzing food images:
1. Identify all food items visible in the image
2. Estimate portion sizes using reference objects (plates, utensils, hands) if visible
3. Estimate macronutrients: carbohydrates, protein, and fat in grams
4. Consider cooking methods and hidden ingredients (oils, sauces, etc.)
5. Be conservative - it's better to slightly underestimate than overestimate

Use the estimate_food_macros tool to provide a structured estimate.

Confidence levels:
- high: Clear image, standard portions, identifiable foods
- medium: Some obscured items, non-standard portions, or mixed dishes
- low: Poor image quality, unusual foods, or significant uncertainty
`;

// =============================================================================
// Database Types (example of plugin-managed schema)
// =============================================================================

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

/**
 * Pending macro estimate from image analysis
 */
export interface PendingEstimate {
  id: number;
  user_id: string;
  channel_id: string;
  carbs_g: number;
  protein_g: number;
  fat_g: number;
  food_description: string;
  confidence: 'high' | 'medium' | 'low';
  notes: string | null;
  created_at: number;
  expires_at: number;
}

/**
 * Result from Claude vision macro estimation
 */
export interface MacroEstimateResult {
  food_description: string;
  estimated_carbs_g: number;
  estimated_protein_g: number;
  estimated_fat_g: number;
  confidence: 'high' | 'medium' | 'low';
  reference_object_used?: string;
  notes?: string;
}

// =============================================================================
// Unit Conversion
// =============================================================================

export type WeightUnit = 'lbs' | 'kg';

export const LBS_TO_KG = 0.453592;
export const KG_TO_LBS = 2.20462;

export function lbsToKg(lbs: number): number {
  return lbs * LBS_TO_KG;
}

export function kgToLbs(kg: number): number {
  return kg * KG_TO_LBS;
}

/**
 * Format a weight value with its unit label
 */
export function formatWeight(value: number, unit: WeightUnit): string {
  return `${value.toFixed(1)} ${unit}`;
}

/**
 * Get user's preferred weight unit (defaults to lbs)
 */
export function getUserUnit(userId: string, db: PluginDatabase): WeightUnit {
  const row = db.prepare(
    `SELECT weight_unit FROM ${db.prefix}user_prefs WHERE user_id = ?`
  ).get(userId) as { weight_unit: string } | undefined;
  return (row?.weight_unit as WeightUnit) ?? 'lbs';
}

/**
 * Set user's preferred weight unit
 */
export function setUserUnit(userId: string, unit: WeightUnit, db: PluginDatabase): void {
  db.prepare(
    `INSERT OR REPLACE INTO ${db.prefix}user_prefs (user_id, weight_unit, updated_at)
     VALUES (?, ?, ?)`
  ).run(userId, unit, Date.now());
}

// =============================================================================
// Workout Set Types
// =============================================================================

export interface WorkoutSet {
  id: number;
  exercise: string;
  weightKg: number;
  reps: number;
  rpe: number | null;
  loggedAt: number;
}

export interface PersonalRecord {
  exercise: string;
  weightKg: number;
  reps: number;
  estimated1rmKg: number;
  loggedAt: number;
}

// =============================================================================
// Workout Argument Parsing
// =============================================================================

/**
 * Parse workout log arguments: <exercise> <weight> <reps> [@rpe]
 * Exercise name is everything before the first numeric token.
 * Returns null if parsing fails validation.
 */
export function parseLogArgs(
  args: string[]
): { exercise: string; weight: number; reps: number; rpe: number | undefined } | null {
  if (args.length < 2) return null;

  // Find the first numeric token (start of weight)
  const firstNumIdx = args.findIndex(a => /^\d/.test(a) || /^-\d/.test(a));
  if (firstNumIdx < 1) return null; // No exercise name or starts with number

  const exercise = args.slice(0, firstNumIdx).join(' ').toLowerCase();
  const rest = args.slice(firstNumIdx);

  if (rest.length < 2) return null; // Need at least weight and reps

  const weight = parseFloat(rest[0]);
  if (isNaN(weight) || weight <= 0 || weight >= 1000) return null;

  const reps = parseFloat(rest[1]);
  if (isNaN(reps) || reps <= 0 || reps > 100 || !Number.isInteger(reps)) return null;

  let rpe: number | undefined;
  if (rest.length >= 3 && rest[2].startsWith('@')) {
    const rpeVal = parseFloat(rest[2].slice(1));
    if (isNaN(rpeVal) || rpeVal < 1 || rpeVal > 10) return null;
    rpe = rpeVal;
  }

  return { exercise, weight, reps, rpe };
}

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
// Workout Formatting
// =============================================================================

/**
 * Title-case an exercise name: "close grip bench" → "Close Grip Bench"
 */
function titleCase(str: string): string {
  return str.replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Format a workout summary for Slack display.
 * Groups sets by exercise, shows set details and volume totals.
 * @param sets Array of WorkoutSet from getWorkoutForDate
 * @param unit Display unit ('kg' or 'lbs')
 */
export function formatWorkoutSummary(sets: WorkoutSet[], unit: WeightUnit): string {
  if (sets.length === 0) return 'No sets logged today.';

  // Group by exercise, preserving order of first appearance
  const groups = new Map<string, WorkoutSet[]>();
  for (const set of sets) {
    const existing = groups.get(set.exercise);
    if (existing) {
      existing.push(set);
    } else {
      groups.set(set.exercise, [set]);
    }
  }

  const lines: string[] = [];
  for (const [exercise, exerciseSets] of groups) {
    lines.push(`*${titleCase(exercise)}*`);
    let volume = 0;
    for (const s of exerciseSets) {
      const displayWeight = unit === 'kg' ? s.weightKg : kgToLbs(s.weightKg);
      const rpeStr = s.rpe != null ? ` @${s.rpe}` : '';
      lines.push(`  ${displayWeight.toFixed(1)} ${unit} × ${s.reps}${rpeStr}`);
      volume += s.weightKg * s.reps;
    }
    const displayVolume = unit === 'kg' ? volume : kgToLbs(volume);
    lines.push(`  _Vol: ${Math.round(displayVolume)} ${unit}_`);
  }

  return lines.join('\n');
}

/**
 * Format personal records for Slack display.
 * Shows each exercise's best set with estimated 1RM.
 * @param prs Array of PersonalRecord (should already be sorted alphabetically)
 * @param unit Display unit ('kg' or 'lbs')
 */
export function formatPersonalRecords(prs: PersonalRecord[], unit: WeightUnit): string {
  if (prs.length === 0) return 'No personal records yet.';

  const lines: string[] = [];
  for (const pr of prs) {
    const displayWeight = unit === 'kg' ? pr.weightKg : kgToLbs(pr.weightKg);
    const display1rm = unit === 'kg' ? pr.estimated1rmKg : kgToLbs(pr.estimated1rmKg);
    const date = new Date(pr.loggedAt);
    const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;
    lines.push(
      `*${titleCase(pr.exercise)}*: ${displayWeight.toFixed(1)} ${unit} × ${pr.reps} ` +
      `(est 1RM: ${display1rm.toFixed(1)} ${unit}) — ${dateStr}`
    );
  }

  return lines.join('\n');
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
// Slack API Utilities (exported for testing)
// =============================================================================

/**
 * Slack client interface for API calls
 */
export interface SlackClient {
  users: {
    info: (params: { user: string }) => Promise<{
      ok: boolean;
      user?: { tz?: string; tz_offset?: number };
    }>;
  };
  conversations: {
    history: (params: { channel: string; limit?: number }) => Promise<{
      ok: boolean;
      messages?: Array<{
        type: string;
        ts: string;
        user?: string;
        files?: Array<{
          id: string;
          name: string;
          mimetype: string;
          url_private_download?: string;
        }>;
      }>;
    }>;
  };
}

/**
 * Result from finding an image in channel
 */
export interface FoundImage {
  url: string;
  filename: string;
  mimetype: string;
}

/**
 * Find the most recent image file shared in a channel
 *
 * @param client - Slack client instance
 * @param channelId - Channel ID to search
 * @param botToken - Bot token for downloading private files
 * @returns Image info or null if no recent image found
 */
export async function findRecentImageInChannel(
  client: SlackClient,
  channelId: string
): Promise<FoundImage | null> {
  try {
    const result = await client.conversations.history({
      channel: channelId,
      limit: 20, // Check last 20 messages
    });

    if (!result.ok || !result.messages) {
      logger.warn('Failed to fetch channel history', { channelId });
      return null;
    }

    // Find first message with an image file
    for (const message of result.messages) {
      if (!message.files) continue;

      for (const file of message.files) {
        // Check if it's an image
        if (file.mimetype?.startsWith('image/') && file.url_private_download) {
          logger.debug('Found recent image in channel', {
            channelId,
            filename: file.name,
            mimetype: file.mimetype,
          });
          return {
            url: file.url_private_download,
            filename: file.name,
            mimetype: file.mimetype,
          };
        }
      }
    }

    logger.debug('No recent image found in channel', { channelId });
    return null;
  } catch (error) {
    logger.error('Error searching channel for images', { error, channelId });
    return null;
  }
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
 * Get start of day in a specific timezone
 * @param tz IANA timezone string (e.g., "America/New_York")
 * @param daysAgo Number of days ago (0 = today, 1 = yesterday)
 */
export function getStartOfDayInTimezone(tz: string | null, daysAgo: number = 0): number {
  const now = new Date();

  if (!tz) {
    // Fallback to UTC date parts (server-timezone-independent)
    const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    return start - daysAgo * 24 * 60 * 60 * 1000;
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

  // Create midnight UTC for the user's date, then adjust by timezone offset
  const midnightUTC = Date.UTC(year, month, day - daysAgo);

  // Get the UTC offset for that date in the target timezone
  const offsetMs = parseTimezoneOffsetMs(new Date(midnightUTC), tz);

  // Midnight in user's tz = midnight UTC - offset
  // If user is GMT-5, midnight their time = 5am UTC (midnightUTC - (-5h) = midnightUTC + 5h)
  return midnightUTC - offsetMs;
}

/**
 * Convert a Date to start of day in user's timezone
 */
export function dateToStartOfDayInTimezone(date: Date, tz: string | null): number {
  if (!tz) {
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  }

  // Get the date parts in user's timezone
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  // Format the original date in the user's timezone to get the correct date parts
  const parts = formatter.format(date).split('-');
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);

  // Create midnight UTC for that date, then adjust by timezone offset
  const midnightUTC = Date.UTC(year, month, day);
  const offsetMs = parseTimezoneOffsetMs(new Date(midnightUTC), tz);

  return midnightUTC - offsetMs;
}

// =============================================================================
// Macros Tracking Functions
// =============================================================================

/**
 * Parse macro arguments like "c20 p40 f15" or "c20.5 p40 f2.5"
 * Supports both integer and decimal values
 */
export function parseMacroArgs(args: string[]): { carbs: number; fat: number; protein: number } | null {
  const result = { carbs: 0, fat: 0, protein: 0 };
  let found = false;

  for (const arg of args) {
    // Support both integers (c20) and decimals (c20.5, f2.5)
    const match = arg.toLowerCase().match(/^([cpf])(\d+(?:\.\d+)?)$/);
    if (!match) continue;

    const [, type, value] = match;
    const num = parseFloat(value);
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
 * @param channelId Channel ID for pending estimate storage
 * @param claude PluginClaude instance for image analysis
 */
async function handleMacros(
  args: string[],
  userId: string,
  channelId: string,
  db: PluginDatabase,
  respond: RespondFn,
  client: SlackClient,
  claude: PluginClaude | undefined
): Promise<void> {
  // Get user's timezone for accurate day boundaries
  const tz = await getUserTimezone(userId, client);

  // Check for subcommands first
  const subcommand = args[0]?.toLowerCase();

  // Handle analyze <url>
  if (subcommand === 'analyze') {
    if (!claude || !claude.enabled) {
      await respond(
        buildResponse([
          section(':x: Image analysis requires Claude to be enabled.'),
          context('Set CLAUDE_ENABLED=true and configure ANTHROPIC_API_KEY'),
        ])
      );
      return;
    }

    const imageUrl = args[1];
    if (!imageUrl) {
      await respond(
        buildResponse([
          section(':warning: Usage: `/lift m analyze <image_url>`'),
          context('Upload an image to Slack and copy its URL'),
        ])
      );
      return;
    }

    await handleAnalyze(imageUrl, userId, channelId, db, claude, respond);
    return;
  }

  // Handle confirm
  if (subcommand === 'confirm') {
    await handleConfirm(userId, channelId, db, respond, tz);
    return;
  }

  // Handle adjust <macros>
  if (subcommand === 'adjust') {
    await handleAdjust(args.slice(1), userId, channelId, db, respond, tz);
    return;
  }

  // Handle cancel
  if (subcommand === 'cancel') {
    await handleCancel(userId, channelId, db, respond);
    return;
  }

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
        divider(),
        section(
          '*Image Analysis:*\n' +
            '`/lift m analyze <url>` - Estimate macros from image\n' +
            '`/lift m confirm` - Log pending estimate\n' +
            '`/lift m adjust c50 p30` - Adjust and log\n' +
            '`/lift m cancel` - Discard estimate'
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
          const unit = pluginDb ? getUserUnit(command.user_id, pluginDb) : 'lbs';
          const [, totalStr, bwStr, sex] = args;
          if (!totalStr || !bwStr || !sex) {
            await respond(
              buildResponse([
                section(`:warning: Usage: \`/lift wilks <total> <bodyweight> <m|f>\``),
                context(`Example: \`/lift wilks ${unit === 'lbs' ? '1100 183' : '500 83'} m\` (${unit})`),
              ])
            );
            return;
          }

          const totalInput = parseFloat(totalStr);
          const bwInput = parseFloat(bwStr);
          const isMale = sex.toLowerCase() === 'm';

          if (isNaN(totalInput) || isNaN(bwInput) || totalInput <= 0 || bwInput <= 0) {
            await respond(buildResponse([section(':x: Invalid numbers. Total and bodyweight must be positive.')]));
            return;
          }

          const totalKg = unit === 'kg' ? totalInput : lbsToKg(totalInput);
          const bwKg = unit === 'kg' ? bwInput : lbsToKg(bwInput);

          const wilks = calculateWilks(totalKg, bwKg, isMale);
          await respond(
            buildResponse([
              header('Wilks Score'),
              section(`*Total:* ${formatWeight(totalInput, unit)}\n*Bodyweight:* ${formatWeight(bwInput, unit)}\n*Sex:* ${isMale ? 'Male' : 'Female'}`),
              divider(),
              section(`:muscle: *Wilks Score: ${wilks.toFixed(2)}*`),
              context('Using Wilks 2020 formula'),
            ])
          );
          break;
        }

        case 'dots': {
          // /lift dots <total> <bodyweight> <m|f>
          const unit = pluginDb ? getUserUnit(command.user_id, pluginDb) : 'lbs';
          const [, totalStr, bwStr, sex] = args;
          if (!totalStr || !bwStr || !sex) {
            await respond(
              buildResponse([
                section(`:warning: Usage: \`/lift dots <total> <bodyweight> <m|f>\``),
                context(`Example: \`/lift dots ${unit === 'lbs' ? '1100 183' : '500 83'} m\` (${unit})`),
              ])
            );
            return;
          }

          const totalInput = parseFloat(totalStr);
          const bwInput = parseFloat(bwStr);
          const isMale = sex.toLowerCase() === 'm';

          if (isNaN(totalInput) || isNaN(bwInput) || totalInput <= 0 || bwInput <= 0) {
            await respond(buildResponse([section(':x: Invalid numbers. Total and bodyweight must be positive.')]));
            return;
          }

          const totalKg = unit === 'kg' ? totalInput : lbsToKg(totalInput);
          const bwKg = unit === 'kg' ? bwInput : lbsToKg(bwInput);

          const dots = calculateDots(totalKg, bwKg, isMale);
          await respond(
            buildResponse([
              header('DOTS Score'),
              section(`*Total:* ${formatWeight(totalInput, unit)}\n*Bodyweight:* ${formatWeight(bwInput, unit)}\n*Sex:* ${isMale ? 'Male' : 'Female'}`),
              divider(),
              section(`:muscle: *DOTS Score: ${dots.toFixed(2)}*`),
              context('DOTS = Dynamic Object Tracking System'),
            ])
          );
          break;
        }

        case '1rm': {
          // /lift 1rm <weight> <reps>
          const unit = pluginDb ? getUserUnit(command.user_id, pluginDb) : 'lbs';
          const [, weightStr, repsStr] = args;
          if (!weightStr || !repsStr) {
            await respond(
              buildResponse([
                section(':warning: Usage: `/lift 1rm <weight> <reps>`'),
                context(`Example: \`/lift 1rm ${unit === 'lbs' ? '225 5' : '100 5'}\` (${unit})`),
              ])
            );
            return;
          }

          const weightInput = parseFloat(weightStr);
          const reps = parseInt(repsStr, 10);

          if (isNaN(weightInput) || isNaN(reps) || weightInput <= 0 || reps <= 0 || reps > 20) {
            await respond(
              buildResponse([section(':x: Invalid input. Weight must be positive, reps must be 1-20.')])
            );
            return;
          }

          const weightKg = unit === 'kg' ? weightInput : lbsToKg(weightInput);
          const estimated1rmKg = calculate1rm(weightKg, reps);
          const estimated1rmDisplay = unit === 'kg' ? estimated1rmKg : kgToLbs(estimated1rmKg);

          await respond(
            buildResponse([
              header('Estimated 1RM'),
              section(`*Weight:* ${formatWeight(weightInput, unit)}\n*Reps:* ${reps}`),
              divider(),
              section(`:muscle: *Estimated 1RM: ${formatWeight(estimated1rmDisplay, unit)}*`),
              context('Using Epley formula: weight × (1 + reps/30)'),
            ])
          );
          break;
        }

        case 'units': {
          if (!pluginDb) {
            await respond(buildResponse([section(':x: Database not initialized')]));
            return;
          }

          const unitArg = args[1]?.toLowerCase();
          if (!unitArg) {
            // Show current preference
            const currentUnit = getUserUnit(command.user_id, pluginDb);
            await respond(
              buildResponse([
                section(`:straight_ruler: Current unit: *${currentUnit}*`),
                context('Change with `/lift units lbs` or `/lift units kg`'),
              ])
            );
          } else if (unitArg === 'lbs' || unitArg === 'kg') {
            setUserUnit(command.user_id, unitArg, pluginDb);
            await respond(
              buildResponse([
                section(`:white_check_mark: Weight unit set to *${unitArg}*`),
                context('All calculator commands will now use ' + unitArg),
              ])
            );
          } else {
            await respond(
              buildResponse([
                section(':warning: Invalid unit. Use `lbs` or `kg`.'),
                context('Example: `/lift units lbs` or `/lift units kg`'),
              ])
            );
          }
          break;
        }

        case 'm':
        case 'macros': {
          if (!pluginDb) {
            await respond(buildResponse([section(':x: Database not initialized')]));
            return;
          }
          await handleMacros(
            args.slice(1),
            command.user_id,
            command.channel_id,
            pluginDb,
            respond,
            client as unknown as SlackClient,
            pluginClaude
          );
          break;
        }

        case 'log':
        case 'l': {
          // /lift log <exercise> <weight> <reps> [@rpe]
          if (!pluginDb) {
            await respond(buildResponse([section(':x: Database not initialized')]));
            return;
          }

          const parsed = parseLogArgs(args.slice(1));
          if (!parsed) {
            await respond(
              buildResponse([
                section(':warning: Usage: `/lift log <exercise> <weight> <reps> [@rpe]`'),
                context('Example: `/lift log squat 100 5 @8`'),
              ])
            );
            return;
          }

          const logUnit = getUserUnit(command.user_id, pluginDb);
          const logWeightKg = logUnit === 'kg' ? parsed.weight : lbsToKg(parsed.weight);
          const tz = await getUserTimezone(command.user_id, client as unknown as SlackClient);

          // Check for PR before logging (so the new set isn't counted against itself)
          const isPR = checkForPR(command.user_id, parsed.exercise, logWeightKg, parsed.reps, pluginDb);

          logWorkoutSet(command.user_id, parsed.exercise, logWeightKg, parsed.reps, parsed.rpe, pluginDb);

          // Build confirmation
          const rpeStr = parsed.rpe != null ? ` @${parsed.rpe}` : '';
          const confirmBlocks: ReturnType<typeof header | typeof section | typeof divider | typeof context>[] = [
            section(`:white_check_mark: ${formatWeight(parsed.weight, logUnit)} × ${parsed.reps}${rpeStr} — ${titleCase(parsed.exercise)}`),
          ];

          if (isPR) {
            const est1rm = calculate1rm(logWeightKg, parsed.reps);
            const display1rm = logUnit === 'kg' ? est1rm : kgToLbs(est1rm);
            confirmBlocks.push(
              section(`:trophy: *New PR!* Est 1RM: ${formatWeight(display1rm, logUnit)}`)
            );
          }

          // Show today's workout summary
          const todaySets = getWorkoutForDate(command.user_id, 'today', pluginDb, tz);
          if (todaySets.length > 0) {
            confirmBlocks.push(divider());
            confirmBlocks.push(header('Today'));
            confirmBlocks.push(section(formatWorkoutSummary(todaySets, logUnit)));
          }

          await respond(buildResponse(confirmBlocks));
          break;
        }

        case 'workout':
        case 'w': {
          // /lift workout [date] - Show workout for a date
          if (!pluginDb) {
            await respond(buildResponse([section(':x: Database not initialized')]));
            return;
          }

          const tz = await getUserTimezone(command.user_id, client as unknown as SlackClient);
          const wUnit = getUserUnit(command.user_id, pluginDb);
          const queryArgs = args.slice(1);
          const query = parseQueryArgs(queryArgs);

          if (!query) {
            await respond(
              buildResponse([
                section(':warning: Usage: `/lift workout [date]`'),
                context('Examples: `/lift w`, `/lift w -1`, `/lift w 2/14`'),
              ])
            );
            return;
          }

          let wSets: WorkoutSet[];
          let wLabel: string;

          switch (query.type) {
            case 'today':
              wSets = getWorkoutForDate(command.user_id, 'today', pluginDb, tz);
              wLabel = 'Today';
              break;
            case 'relative':
              if (query.daysAgo === -1) {
                const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
                wSets = getWorkoutForDate(command.user_id, yesterday, pluginDb, tz);
                wLabel = 'Yesterday';
              } else {
                const daysBack = Math.abs(query.daysAgo!);
                const targetDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
                wSets = getWorkoutForDate(command.user_id, targetDate, pluginDb, tz);
                wLabel = `${daysBack} days ago`;
              }
              break;
            case 'date':
              wSets = getWorkoutForDate(command.user_id, query.date!, pluginDb, tz);
              wLabel = formatDateLabel(query.date!);
              break;
            default:
              wSets = getWorkoutForDate(command.user_id, 'today', pluginDb, tz);
              wLabel = 'Today';
          }

          await respond(
            buildResponse([
              header(`Workout: ${wLabel}`),
              section(formatWorkoutSummary(wSets, wUnit)),
            ])
          );
          break;
        }

        case 'pr': {
          // /lift pr [exercise] - Show personal records
          if (!pluginDb) {
            await respond(buildResponse([section(':x: Database not initialized')]));
            return;
          }

          const prUnit = getUserUnit(command.user_id, pluginDb);
          const exerciseArg = args.slice(1).join(' ').toLowerCase();

          let prs: PersonalRecord[];
          if (exerciseArg) {
            prs = getPersonalRecords(command.user_id, exerciseArg, pluginDb);
          } else {
            prs = getAllPersonalRecords(command.user_id, pluginDb);
          }

          const prTitle = exerciseArg ? `PR: ${titleCase(exerciseArg)}` : 'Personal Records';
          await respond(
            buildResponse([
              header(prTitle),
              section(formatPersonalRecords(prs, prUnit)),
            ])
          );
          break;
        }

        case 'a':
        case 'analyze': {
          // /lift a [context] - Quick food photo analysis from recent channel image
          if (!pluginDb) {
            await respond(buildResponse([section(':x: Database not initialized')]));
            return;
          }

          if (!pluginClaude || !pluginClaude.enabled) {
            await respond(
              buildResponse([
                section(':x: Image analysis requires Claude to be enabled.'),
                context('Set CLAUDE_ENABLED=true'),
              ])
            );
            return;
          }

          // Get context hint (e.g., "breakfast", "lunch", "dinner")
          const contextHint = args.slice(1).join(' ');

          // Find recent image in channel
          const imageInfo = await findRecentImageInChannel(
            client as unknown as SlackClient,
            command.channel_id
          );

          if (!imageInfo) {
            await respond(
              buildResponse([
                section(':warning: No recent image found in this channel.'),
                context('Share or paste a food photo first, then use `/lift a`'),
              ])
            );
            return;
          }

          // Download image to temp file with cryptographically random suffix
          const randomSuffix = crypto.randomBytes(8).toString('hex');
          const tempPath = `/tmp/lift-food-${Date.now()}-${randomSuffix}.jpg`;
          try {
            // Get bot token from environment for downloading Slack private files
            const botToken = process.env.SLACK_BOT_TOKEN;
            if (!botToken) {
              logger.warn('SLACK_BOT_TOKEN not set, image download may fail for private Slack files');
            }
            await downloadImageToFile(imageInfo.url, tempPath, botToken);

            // Show processing message
            await respond(buildResponse([section(':hourglass_flowing_sand: Analyzing food image...')]));

            // Call Claude CLI with local file reference
            const prompt = contextHint
              ? `Analyze this food image (${contextHint}) and estimate the macronutrients.`
              : 'Analyze this food image and estimate the macronutrients.';

            const result = await pluginClaude.ask(prompt, command.user_id, {
              localImagePath: tempPath,
              systemPromptAddition: FOOD_ANALYSIS_PROMPT,
            });

            // Parse result for structured macro estimate
            const toolCall = result.toolCalls.find((tc) => tc.name === 'lift:estimate_food_macros');
            if (toolCall) {
              const estimate = toolCall.input as unknown as MacroEstimateResult;

              // Store pending estimate for confirmation
              storePendingEstimate(command.user_id, command.channel_id, estimate, pluginDb);

              // Show estimate with confirmation prompt
              await respond(
                buildResponse([
                  header('Macro Estimate'),
                  ...formatEstimate(estimate),
                  divider(),
                  section(
                    '*Commands:*\n' +
                    '`/lift m confirm` - Log these macros\n' +
                    '`/lift m adjust c50 p30 f15` - Adjust and log\n' +
                    '`/lift m cancel` - Discard estimate'
                  ),
                  context('Estimate expires in 15 minutes'),
                ])
              );
            } else {
              // No structured estimate - show raw response
              await respond(
                buildResponse([
                  header('Food Analysis'),
                  section(result.response),
                  context('Tip: Use `/lift m c<carbs> p<protein> f<fat>` to log macros'),
                ])
              );
            }
          } catch (error) {
            logger.error('Failed to analyze food image', { error, imageUrl: imageInfo.url });
            const message = error instanceof Error ? error.message : 'Unknown error';
            await respond(
              buildResponse([
                section(`:x: Failed to analyze image: ${message}`),
              ])
            );
          } finally {
            // Cleanup temp file
            await cleanupTempImage(tempPath);
          }
          break;
        }

        case 'warmup': {
          // /lift warmup <weight1> [weight2] ...
          const unit = pluginDb ? getUserUnit(command.user_id, pluginDb) : 'lbs';
          const inputWeights = args
            .slice(1)
            .map((w: string) => parseFloat(w))
            .filter((w: number) => !isNaN(w) && w > 0);

          if (inputWeights.length === 0) {
            await respond(
              buildResponse([
                section(':warning: Usage: `/lift warmup <weight> [weight2] ...`'),
                context(`Example: \`/lift warmup ${unit === 'lbs' ? '225' : '100'}\` (${unit})`),
              ])
            );
            return;
          }

          // Convert to lbs for plate loading calculation
          const weightsLbs = unit === 'kg'
            ? inputWeights.map((w: number) => Math.round(kgToLbs(w)))
            : inputWeights;

          // Validate max weight (in lbs) to prevent unbounded output
          const invalidWeights = weightsLbs.filter((w: number) => w > MAX_TARGET_WEIGHT);
          if (invalidWeights.length > 0) {
            const maxDisplay = unit === 'kg'
              ? `${Math.round(lbsToKg(MAX_TARGET_WEIGHT))} kg`
              : `${MAX_TARGET_WEIGHT} lbs`;
            await respond(
              buildResponse([
                section(`:x: Weight(s) exceed maximum of ${maxDisplay}`),
              ])
            );
            return;
          }

          const blocks: ReturnType<typeof header | typeof section | typeof divider | typeof context>[] = [];
          for (const targetWeight of weightsLbs) {
            if (blocks.length > 0) blocks.push(divider());
            blocks.push(...formatWarmupTable(targetWeight));
          }
          const noteText = unit === 'kg'
            ? 'Percentages: 40%, 60%, 80%, 100% | Bar = 45 lbs | Plate loading in lbs (standard plates)'
            : 'Percentages: 40%, 60%, 80%, 100% | Bar = 45 lbs | Plate count is total (both sides)';
          blocks.push(context(noteText));

          await respond(buildResponse(blocks));
          break;
        }

        case 'h':
        case 'help':
        default: {
          const helpUnit = pluginDb ? getUserUnit(command.user_id, pluginDb) : 'lbs';
          await respond(
            buildResponse([
              header('Lift Plugin'),
              section('*Workout Tracking:*'),
              section(
                '`/lift log <exercise> <weight> <reps> [@rpe]` - Log a set\n' +
                  '`/lift workout` - Today\'s workout\n' +
                  '`/lift workout -1` - Yesterday\'s workout\n' +
                  '`/lift pr` - All personal records\n' +
                  '`/lift pr squat` - PR for specific exercise'
              ),
              divider(),
              section('*Calculators:*'),
              section(
                '`/lift wilks <total> <bw> <m|f>` - Wilks score\n' +
                  '`/lift dots <total> <bw> <m|f>` - DOTS score\n' +
                  '`/lift 1rm <weight> <reps>` - Estimate 1RM\n' +
                  '`/lift warmup <weight>` - Warmup sets'
              ),
              context(`Weights in ${helpUnit} | Change with \`/lift units lbs\` or \`/lift units kg\``),
              divider(),
              section('*Quick Food Analysis:*'),
              section(
                '`/lift a` - Analyze latest photo in channel\n' +
                  '`/lift a breakfast` - With meal context hint'
              ),
              divider(),
              section('*Macro Tracking:*'),
              section(
                '`/lift m c20 p40 f15` - Log macros\n' +
                  '`/lift m` - Today\'s totals\n' +
                  '`/lift m -1` - Yesterday\n' +
                  '`/lift m 1/15` - Specific date\n' +
                  '`/lift m 1/10-1/15` - Date range\n' +
                  '`/lift m confirm` - Confirm pending estimate\n' +
                  '`/lift m adjust c50 p30 f15` - Adjust and log'
              ),
              divider(),
              section('*Settings:*'),
              section(
                '`/lift units` - View current unit\n' +
                  '`/lift units lbs` - Set to pounds\n' +
                  '`/lift units kg` - Set to kilograms'
              ),
            ])
          );
        }
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
      'Accepts weights in lbs or kg (specify via unit parameter, defaults to lbs). ' +
      'Use this when asked about powerlifting strength scores or rep max estimates.',
    input_schema: {
      type: 'object',
      properties: {
        calculation: {
          type: 'string',
          enum: ['wilks', 'dots', '1rm'],
          description: 'Type of calculation: wilks, dots, or 1rm',
        },
        total: {
          type: 'number',
          description: 'Total lifted (for wilks/dots). Unit determined by unit parameter.',
        },
        bodyweight: {
          type: 'number',
          description: 'Bodyweight (for wilks/dots). Unit determined by unit parameter.',
        },
        is_male: {
          type: 'boolean',
          description: 'True for male, false for female (for wilks/dots)',
        },
        weight: {
          type: 'number',
          description: 'Weight lifted (for 1rm). Unit determined by unit parameter.',
        },
        reps: {
          type: 'number',
          description: 'Number of reps performed (for 1rm)',
        },
        unit: {
          type: 'string',
          enum: ['lbs', 'kg'],
          description: 'Weight unit for input values. Defaults to lbs.',
        },
      },
      required: ['calculation'],
    },
  },
  execute: async (input) => {
    const { calculation, total, bodyweight, is_male, weight, reps, unit: inputUnit,
            // Backward compat: accept old _kg params
            total_kg, bodyweight_kg, weight_kg } = input as {
      calculation: string;
      total?: number;
      bodyweight?: number;
      is_male?: boolean;
      weight?: number;
      reps?: number;
      unit?: string;
      total_kg?: number;
      bodyweight_kg?: number;
      weight_kg?: number;
    };

    const unit: WeightUnit = inputUnit === 'kg' ? 'kg' : 'lbs';
    const toKg = (v: number) => unit === 'kg' ? v : lbsToKg(v);

    switch (calculation) {
      case 'wilks': {
        const t = total ?? total_kg;
        const bw = bodyweight ?? bodyweight_kg;
        if (t === undefined || bw === undefined || is_male === undefined) {
          return 'Error: wilks requires total, bodyweight, and is_male';
        }
        const tKg = total_kg !== undefined ? total_kg : toKg(t);
        const bwKg = bodyweight_kg !== undefined ? bodyweight_kg : toKg(bw);
        const score = calculateWilks(tKg, bwKg, is_male);
        return `Wilks Score: ${score.toFixed(2)} (${is_male ? 'male' : 'female'}, ${t} ${unit} total @ ${bw} ${unit} bodyweight)`;
      }

      case 'dots': {
        const t = total ?? total_kg;
        const bw = bodyweight ?? bodyweight_kg;
        if (t === undefined || bw === undefined || is_male === undefined) {
          return 'Error: dots requires total, bodyweight, and is_male';
        }
        const tKg = total_kg !== undefined ? total_kg : toKg(t);
        const bwKg = bodyweight_kg !== undefined ? bodyweight_kg : toKg(bw);
        const score = calculateDots(tKg, bwKg, is_male);
        return `DOTS Score: ${score.toFixed(2)} (${is_male ? 'male' : 'female'}, ${t} ${unit} total @ ${bw} ${unit} bodyweight)`;
      }

      case '1rm': {
        const w = weight ?? weight_kg;
        if (w === undefined || reps === undefined) {
          return 'Error: 1rm requires weight and reps';
        }
        const wKg = weight_kg !== undefined ? weight_kg : toKg(w);
        const estimated = calculate1rm(wKg, reps);
        const estimatedDisplay = unit === 'kg' ? estimated : kgToLbs(estimated);
        return `Estimated 1RM: ${estimatedDisplay.toFixed(1)} ${unit} (based on ${w} ${unit} × ${reps} reps using Epley formula)`;
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
      'Accepts weights in lbs or kg (specify via unit parameter, defaults to lbs). ' +
      'Plate loading is always shown in lbs (standard US gym plates). ' +
      'Use this when asked about warming up for a lift or what plates to load.',
    input_schema: {
      type: 'object',
      properties: {
        target_weights: {
          type: 'array',
          items: { type: 'number' },
          description: 'Target weight(s) to calculate warmup sets for',
        },
        unit: {
          type: 'string',
          enum: ['lbs', 'kg'],
          description: 'Weight unit for target_weights. Defaults to lbs. Plate loading always shown in lbs.',
        },
      },
      required: ['target_weights'],
    },
  },
  execute: async (input) => {
    const { target_weights, unit: inputUnit } = input as { target_weights: number[]; unit?: string };

    if (!target_weights || target_weights.length === 0) {
      return 'Error: target_weights array is required';
    }

    const unit: WeightUnit = inputUnit === 'kg' ? 'kg' : 'lbs';

    const results: string[] = [];
    for (const inputWeight of target_weights) {
      if (inputWeight <= 0) {
        results.push(`Skipping invalid weight: ${inputWeight}`);
        continue;
      }

      const weightLbs = unit === 'kg' ? Math.round(kgToLbs(inputWeight)) : inputWeight;

      if (weightLbs > MAX_TARGET_WEIGHT) {
        results.push(`Skipping weight exceeding maximum (${MAX_TARGET_WEIGHT} lbs): ${inputWeight} ${unit}`);
        continue;
      }

      const label = unit === 'kg' ? `${inputWeight} kg (~${weightLbs} lbs)` : `${weightLbs} lbs`;
      const lines: string[] = [`Warmup for ${label}:`];
      for (const pct of WARMUP_PERCENTAGES) {
        const weight = Math.round(weightLbs * pct);
        const config = calculatePlateConfig(weight);
        lines.push(`  ${Math.round(pct * 100)}%: ${weight} lbs - ${config}`);
      }
      results.push(lines.join('\n'));
    }

    return results.join('\n\n');
  },
};

/**
 * Vision tool for estimating macros from food images
 * Claude uses this to structure its analysis of food photos
 */
const estimateFoodMacrosTool: ToolDefinition = {
  spec: {
    name: 'estimate_food_macros',
    description:
      'Analyze a food image and estimate macronutrients. Use this tool after viewing a food image ' +
      'to provide a structured estimate. Look for reference objects (plates, utensils, hands) for scale.',
    input_schema: {
      type: 'object',
      properties: {
        food_description: {
          type: 'string',
          description: 'Brief description of the food identified in the image',
        },
        estimated_carbs_g: {
          type: 'number',
          description: 'Estimated carbohydrates in grams',
        },
        estimated_protein_g: {
          type: 'number',
          description: 'Estimated protein in grams',
        },
        estimated_fat_g: {
          type: 'number',
          description: 'Estimated fat in grams',
        },
        confidence: {
          type: 'string',
          enum: ['high', 'medium', 'low'],
          description: 'Confidence level: high (clear image, standard portions), medium (some uncertainty), low (obscured, unusual portions)',
        },
        reference_object_used: {
          type: 'string',
          description: 'Reference object used for scale estimation (e.g., "dinner plate", "fork", "hand")',
        },
        notes: {
          type: 'string',
          description: 'Additional notes about the estimate or assumptions made',
        },
      },
      required: ['food_description', 'estimated_carbs_g', 'estimated_protein_g', 'estimated_fat_g', 'confidence'],
    },
  },
  execute: async (input) => {
    // This tool is used by Claude to structure its response
    // The actual macro estimate is returned as a structured object
    const estimate = input as MacroEstimateResult;
    const calories = estimate.estimated_carbs_g * 4 + estimate.estimated_protein_g * 4 + estimate.estimated_fat_g * 9;

    return JSON.stringify({
      ...estimate,
      estimated_calories: calories,
    });
  },
};

const workoutTool: ToolDefinition = {
  spec: {
    name: 'get_workout_history',
    description:
      'Query workout set history for a user. Can filter by exercise and date range. ' +
      'Returns sets with exercise name, weight, reps, RPE, and personal records.',
    input_schema: {
      type: 'object',
      properties: {
        user_id: {
          type: 'string',
          description: 'Slack user ID to query workout history for',
        },
        exercise: {
          type: 'string',
          description: 'Filter by exercise name (optional, case-insensitive)',
        },
        days_back: {
          type: 'number',
          description: 'Number of days back to query (default: 7, max: 90)',
        },
        include_prs: {
          type: 'boolean',
          description: 'Include personal records summary (default: false)',
        },
      },
      required: ['user_id'],
    },
  },
  execute: async (input) => {
    if (!pluginDb) return 'Error: Database not initialized';

    const { user_id, exercise, days_back = 7, include_prs = false } = input as {
      user_id: string;
      exercise?: string;
      days_back?: number;
      include_prs?: boolean;
    };

    const daysBack = Math.min(Math.max(1, days_back), 90);
    const startTs = Date.now() - daysBack * 24 * 60 * 60 * 1000;

    let query = `SELECT exercise, weight_kg, reps, rpe, logged_at
      FROM ${pluginDb.prefix}workout_sets
      WHERE user_id = ? AND logged_at >= ?`;
    const params: (string | number)[] = [user_id, startTs];

    if (exercise) {
      query += ' AND exercise = ?';
      params.push(exercise.toLowerCase());
    }

    query += ' ORDER BY logged_at DESC';

    const rows = pluginDb.prepare(query).all(...params) as {
      exercise: string;
      weight_kg: number;
      reps: number;
      rpe: number | null;
      logged_at: number;
    }[];

    const lines: string[] = [];
    lines.push(`Workout history (last ${daysBack} days): ${rows.length} sets`);

    if (rows.length > 0) {
      // Group by date
      const byDate = new Map<string, typeof rows>();
      for (const row of rows) {
        const d = new Date(row.logged_at);
        const key = `${d.getMonth() + 1}/${d.getDate()}`;
        const existing = byDate.get(key);
        if (existing) existing.push(row);
        else byDate.set(key, [row]);
      }

      for (const [date, dateSets] of byDate) {
        lines.push(`\n${date}:`);
        for (const s of dateSets) {
          const rpe = s.rpe != null ? ` @${s.rpe}` : '';
          const est1rm = calculate1rm(s.weight_kg, s.reps);
          lines.push(`  ${s.exercise}: ${s.weight_kg}kg × ${s.reps}${rpe} (est 1RM: ${est1rm.toFixed(1)}kg)`);
        }
      }
    }

    if (include_prs) {
      const prs = exercise
        ? getPersonalRecords(user_id, exercise, pluginDb)
        : getAllPersonalRecords(user_id, pluginDb);

      if (prs.length > 0) {
        lines.push('\nPersonal Records:');
        for (const pr of prs) {
          lines.push(`  ${pr.exercise}: ${pr.weightKg}kg × ${pr.reps} (est 1RM: ${pr.estimated1rmKg.toFixed(1)}kg)`);
        }
      }
    }

    return lines.join('\n');
  },
};

// =============================================================================
// Image Analysis Functions
// =============================================================================

/**
 * Analyze a food image using Claude vision
 */
async function analyzeFood(
  imageUrl: string,
  userId: string,
  claude: PluginClaude
): Promise<MacroEstimateResult | null> {
  // Fetch and convert image to base64
  const image = await fetchImageAsBase64(imageUrl);

  // Ask Claude to analyze the image
  const result = await claude.ask(
    'Analyze this food image and estimate the macronutrients. ' +
    'Look for reference objects like plates, utensils, or hands to estimate portion size. ' +
    'Use the estimate_food_macros tool to provide your structured estimate.',
    userId,
    {
      images: [image],
      systemPromptAddition:
        'You are a nutrition expert. Analyze food images to estimate macronutrients. ' +
        'Be conservative in estimates - it\'s better to slightly underestimate than overestimate. ' +
        'Always use the estimate_food_macros tool to provide structured output.',
    }
  );

  // Extract the tool call result
  const toolCall = result.toolCalls.find((tc) => tc.name === 'lift:estimate_food_macros');
  if (!toolCall) {
    logger.warn('Claude did not use estimate_food_macros tool', { response: result.response });
    return null;
  }

  return toolCall.input as MacroEstimateResult;
}

/**
 * Store a pending estimate for user confirmation
 */
function storePendingEstimate(
  userId: string,
  channelId: string,
  estimate: MacroEstimateResult,
  db: PluginDatabase
): number {
  const now = Date.now();
  const result = db.prepare(
    `INSERT INTO ${db.prefix}pending_estimates
     (user_id, channel_id, carbs_g, protein_g, fat_g, food_description, confidence, notes, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    userId,
    channelId,
    estimate.estimated_carbs_g,
    estimate.estimated_protein_g,
    estimate.estimated_fat_g,
    estimate.food_description,
    estimate.confidence,
    estimate.notes ?? null,
    now,
    now + PENDING_ESTIMATE_TTL
  );

  return Number(result.lastInsertRowid);
}

/**
 * Get the most recent pending estimate for a user
 */
function getPendingEstimate(userId: string, channelId: string, db: PluginDatabase): PendingEstimate | null {
  // Clean up expired estimates first
  db.prepare(`DELETE FROM ${db.prefix}pending_estimates WHERE expires_at < ?`).run(Date.now());

  return db.prepare(
    `SELECT * FROM ${db.prefix}pending_estimates
     WHERE user_id = ? AND channel_id = ?
     ORDER BY created_at DESC LIMIT 1`
  ).get(userId, channelId) as PendingEstimate | null;
}

/**
 * Delete a pending estimate
 */
function deletePendingEstimate(id: number, db: PluginDatabase): void {
  db.prepare(`DELETE FROM ${db.prefix}pending_estimates WHERE id = ?`).run(id);
}

/**
 * Format a macro estimate for display
 */
function formatEstimate(estimate: MacroEstimateResult | PendingEstimate): ReturnType<typeof section | typeof context>[] {
  const carbs = 'estimated_carbs_g' in estimate ? estimate.estimated_carbs_g : estimate.carbs_g;
  const protein = 'estimated_protein_g' in estimate ? estimate.estimated_protein_g : estimate.protein_g;
  const fat = 'estimated_fat_g' in estimate ? estimate.estimated_fat_g : estimate.fat_g;
  const description = estimate.food_description;
  const confidence = estimate.confidence;
  const notes = estimate.notes;

  const calories = carbs * 4 + protein * 4 + fat * 9;
  const confidenceEmoji = confidence === 'high' ? ':white_check_mark:' :
                          confidence === 'medium' ? ':warning:' : ':grey_question:';

  const blocks: ReturnType<typeof section | typeof context>[] = [
    section(
      `*${description}*\n` +
      '```\n' +
      `Carbs:   ${String(Math.round(carbs)).padStart(4)}g\n` +
      `Protein: ${String(Math.round(protein)).padStart(4)}g\n` +
      `Fat:     ${String(Math.round(fat)).padStart(4)}g\n` +
      '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n' +
      `Calories: ~${calories.toLocaleString()}\n` +
      '```'
    ),
    context(`${confidenceEmoji} Confidence: ${confidence}${notes ? ` | ${notes}` : ''}`),
  ];

  return blocks;
}

/**
 * Handle /lift m analyze <url> command
 */
async function handleAnalyze(
  imageUrl: string,
  userId: string,
  channelId: string,
  db: PluginDatabase,
  claude: PluginClaude,
  respond: RespondFn
): Promise<void> {
  // Validate URL
  if (!isValidImageUrl(imageUrl)) {
    await respond(
      buildResponse([
        section(':x: Invalid image URL. Must be HTTPS.'),
        context('Tip: Upload an image to Slack and copy the URL'),
      ])
    );
    return;
  }

  // Check if Claude supports images
  if (!claude.supportsImages) {
    await respond(
      buildResponse([
        section(':x: Image analysis requires SDK provider with vision support.'),
        context('Set ANTHROPIC_API_KEY and CLAUDE_PROVIDER=sdk to enable'),
      ])
    );
    return;
  }

  // Show processing message
  await respond(buildResponse([section(':hourglass_flowing_sand: Analyzing image...')]));

  try {
    const estimate = await analyzeFood(imageUrl, userId, claude);

    if (!estimate) {
      await respond(
        buildResponse([
          section(':x: Could not estimate macros from this image.'),
          context('Try a clearer image with visible portion sizes'),
        ])
      );
      return;
    }

    // Store pending estimate for confirmation
    storePendingEstimate(userId, channelId, estimate, db);

    // Show estimate with confirmation prompt
    await respond(
      buildResponse([
        header('Macro Estimate'),
        ...formatEstimate(estimate),
        divider(),
        section(
          '*Commands:*\n' +
          '`/lift m confirm` - Log these macros\n' +
          '`/lift m adjust c50 p30 f15` - Adjust and log\n' +
          '`/lift m cancel` - Discard estimate'
        ),
        context('Estimate expires in 15 minutes'),
      ])
    );
  } catch (error) {
    logger.error('Failed to analyze food image', { error, imageUrl, userId });
    const message = error instanceof Error ? error.message : 'Unknown error';
    await respond(
      buildResponse([
        section(`:x: Failed to analyze image: ${message}`),
      ])
    );
  }
}

/**
 * Handle /lift m confirm command
 */
async function handleConfirm(
  userId: string,
  channelId: string,
  db: PluginDatabase,
  respond: RespondFn,
  tz: string | null
): Promise<void> {
  const pending = getPendingEstimate(userId, channelId, db);

  if (!pending) {
    await respond(
      buildResponse([
        section(':x: No pending estimate to confirm.'),
        context('Use `/lift m analyze <url>` to analyze a food image'),
      ])
    );
    return;
  }

  // Log the macros
  const macros = {
    carbs: Math.round(pending.carbs_g),
    protein: Math.round(pending.protein_g),
    fat: Math.round(pending.fat_g),
  };

  try {
    logMacros(userId, macros, db);
    deletePendingEstimate(pending.id, db);

    // Show confirmation + today's total
    const totals = getDailyTotals(userId, 0, db, tz);
    await respond(
      buildResponse([
        section(`:white_check_mark: Logged: ${macros.carbs}c ${macros.protein}p ${macros.fat}f`),
        context(`From: ${pending.food_description}`),
        divider(),
        ...formatMacroSummary('Today', totals),
      ])
    );
  } catch (error) {
    logger.error('Failed to confirm macros', { error, userId });
    await respond(buildResponse([section(':x: Failed to log macros. Please try again.')]));
  }
}

/**
 * Handle /lift m adjust <macros> command
 */
async function handleAdjust(
  args: string[],
  userId: string,
  channelId: string,
  db: PluginDatabase,
  respond: RespondFn,
  tz: string | null
): Promise<void> {
  const pending = getPendingEstimate(userId, channelId, db);

  if (!pending) {
    await respond(
      buildResponse([
        section(':x: No pending estimate to adjust.'),
        context('Use `/lift m analyze <url>` to analyze a food image'),
      ])
    );
    return;
  }

  // Parse adjusted macros
  const adjustedMacros = parseMacroArgs(args);
  if (!adjustedMacros) {
    await respond(
      buildResponse([
        section(':x: Invalid macro format for adjustment.'),
        context('Example: `/lift m adjust c50 p30 f15`'),
      ])
    );
    return;
  }

  try {
    logMacros(userId, adjustedMacros, db);
    deletePendingEstimate(pending.id, db);

    // Show confirmation + today's total
    const totals = getDailyTotals(userId, 0, db, tz);
    await respond(
      buildResponse([
        section(`:white_check_mark: Logged (adjusted): ${adjustedMacros.carbs}c ${adjustedMacros.protein}p ${adjustedMacros.fat}f`),
        context(`Original estimate: ${Math.round(pending.carbs_g)}c ${Math.round(pending.protein_g)}p ${Math.round(pending.fat_g)}f`),
        divider(),
        ...formatMacroSummary('Today', totals),
      ])
    );
  } catch (error) {
    logger.error('Failed to log adjusted macros', { error, userId });
    await respond(buildResponse([section(':x: Failed to log macros. Please try again.')]));
  }
}

/**
 * Handle /lift m cancel command
 */
async function handleCancel(
  userId: string,
  channelId: string,
  db: PluginDatabase,
  respond: RespondFn
): Promise<void> {
  const pending = getPendingEstimate(userId, channelId, db);

  if (!pending) {
    await respond(
      buildResponse([
        section(':information_source: No pending estimate to cancel.'),
      ])
    );
    return;
  }

  deletePendingEstimate(pending.id, db);
  await respond(
    buildResponse([
      section(':wastebasket: Estimate discarded.'),
    ])
  );
}

// =============================================================================
// Plugin Export
// =============================================================================

const liftPlugin: Plugin = {
  name: 'lift',
  version: '3.0.0',
  description: 'Powerlifting calculator, workout tracker, macro tracker, and food vision analysis',

  helpEntries: [
    { command: '/lift log <exercise> <weight> <reps> [@rpe]', description: 'Log a workout set', group: 'Lift - Workouts' },
    { command: '/lift workout', description: "Today's workout summary", group: 'Lift - Workouts' },
    { command: '/lift workout -1', description: "Yesterday's workout", group: 'Lift - Workouts' },
    { command: '/lift workout <date>', description: 'Workout for specific date (M/D)', group: 'Lift - Workouts' },
    { command: '/lift pr', description: 'All personal records', group: 'Lift - Workouts' },
    { command: '/lift pr <exercise>', description: 'PR for specific exercise', group: 'Lift - Workouts' },
    { command: '/lift wilks <total> <bw> <m|f>', description: 'Calculate Wilks score (lbs or kg)', group: 'Lift - Calculators' },
    { command: '/lift dots <total> <bw> <m|f>', description: 'Calculate DOTS score (lbs or kg)', group: 'Lift - Calculators' },
    { command: '/lift 1rm <weight> <reps>', description: 'Estimate 1 rep max (lbs or kg)', group: 'Lift - Calculators' },
    { command: '/lift warmup <weight> [weight2]', description: 'Warmup sets with plate loading', group: 'Lift - Calculators' },
    { command: '/lift units [lbs|kg]', description: 'View or set weight unit preference', group: 'Lift - Settings' },
    { command: '/lift a [context]', description: 'Analyze latest food photo in channel', group: 'Lift - Food Analysis' },
    { command: '/lift m c20 p40 f15', description: 'Log macros (carbs/protein/fat in grams)', group: 'Lift - Macros' },
    { command: '/lift m', description: "Today's macro totals", group: 'Lift - Macros' },
    { command: '/lift m -1', description: "Yesterday's totals", group: 'Lift - Macros' },
    { command: '/lift m <date>', description: 'Specific date (M/D)', group: 'Lift - Macros' },
    { command: '/lift m <start>-<end>', description: 'Date range', group: 'Lift - Macros' },
    { command: '/lift m confirm', description: 'Log pending estimate', group: 'Lift - Macros' },
    { command: '/lift m adjust c<g> p<g> f<g>', description: 'Adjust and log estimate', group: 'Lift - Macros' },
  ],

  registerCommands: registerLiftCommand,

  tools: [powerliftingTool, warmupTool, estimateFoodMacrosTool, workoutTool],

  init: async (ctx: PluginContext) => {
    // Store db and claude references for command handlers
    pluginDb = ctx.db;
    pluginClaude = ctx.claude;

    // Tables are automatically prefixed with "plugin_lift_" via ctx.db.prefix
    // Note: init() must complete within 10 seconds or plugin loading fails

    // User preferences table (weight unit)
    ctx.db.exec(`
      CREATE TABLE IF NOT EXISTS ${ctx.db.prefix}user_prefs (
        user_id TEXT PRIMARY KEY,
        weight_unit TEXT NOT NULL DEFAULT 'lbs' CHECK(weight_unit IN ('lbs', 'kg')),
        updated_at INTEGER NOT NULL
      )
    `);

    // Workout sets table (flexible per-set tracking)
    ctx.db.exec(`
      CREATE TABLE IF NOT EXISTS ${ctx.db.prefix}workout_sets (
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
      CREATE INDEX IF NOT EXISTS idx_${ctx.db.prefix}workout_sets_user_date
        ON ${ctx.db.prefix}workout_sets(user_id, logged_at)
    `);
    ctx.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_${ctx.db.prefix}workout_sets_user_exercise
        ON ${ctx.db.prefix}workout_sets(user_id, exercise)
    `);

    // Macros table for nutrition tracking
    // Upper bounds prevent fat-finger errors (e.g., c20000 instead of c200)
    // Uses REAL columns to support decimal values (e.g., f2.5)
    ctx.db.exec(`
      CREATE TABLE IF NOT EXISTS ${ctx.db.prefix}macros (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        carbs_g REAL NOT NULL DEFAULT 0 CHECK(carbs_g >= 0 AND carbs_g <= 5000),
        fat_g REAL NOT NULL DEFAULT 0 CHECK(fat_g >= 0 AND fat_g <= 2000),
        protein_g REAL NOT NULL DEFAULT 0 CHECK(protein_g >= 0 AND protein_g <= 2000),
        logged_at INTEGER NOT NULL CHECK(logged_at > 0),
        created_at INTEGER NOT NULL CHECK(created_at > 0)
      )
    `);

    // Migration: Convert existing INTEGER columns to REAL if needed
    // SQLite doesn't support ALTER COLUMN, so we need to recreate the table
    await migrateToRealColumns(ctx.db, `${ctx.db.prefix}macros`, ['carbs_g', 'fat_g', 'protein_g']);

    ctx.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_${ctx.db.prefix}macros_user_date
        ON ${ctx.db.prefix}macros(user_id, logged_at)
    `);

    // Pending estimates table for image analysis confirmation flow
    // Uses REAL columns to support decimal values
    ctx.db.exec(`
      CREATE TABLE IF NOT EXISTS ${ctx.db.prefix}pending_estimates (
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

    // Migration: Convert existing INTEGER columns to REAL if needed
    await migrateToRealColumns(ctx.db, `${ctx.db.prefix}pending_estimates`, ['carbs_g', 'protein_g', 'fat_g']);

    ctx.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_${ctx.db.prefix}pending_user_channel
        ON ${ctx.db.prefix}pending_estimates(user_id, channel_id)
    `);

    logger.info('Lift plugin initialized', {
      version: ctx.version,
      tablePrefix: ctx.db.prefix,
    });
  },

  destroy: async (ctx: PluginContext) => {
    // Clear module-level references
    pluginDb = null;
    pluginClaude = undefined;
    // Note: destroy() must complete within 5 seconds
    logger.info('Lift plugin destroyed', { name: ctx.name });
  },
};

export default liftPlugin;

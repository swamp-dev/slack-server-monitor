/**
 * Lift Plugin - Powerlifting Calculator, Workout Tracker & Macro Tracker
 *
 * Example plugin demonstrating:
 * - Slash command registration (/lift)
 * - Subcommands (log, workout, pr, wilks, dots, 1rm, w, wh, bw, a, m, units)
 * - Claude AI tool integration
 * - Database access via PluginContext (see init() for schema setup)
 * - Using formatters (header, section, divider, context)
 *
 * Commands:
 *
 * Workout Tracking:
 * - /lift log <exercise> <weight> <reps> [@rpe] - Log a workout set
 * - /lift workout [date]                        - Today's workout (or -1, M/D)
 * - /lift pr [exercise]                         - Personal records
 *
 * Calculators:
 * - /lift wilks <total> [bw] <m|f> - Wilks score (auto-fills bw if logged)
 * - /lift dots <total> [bw] <m|f>  - DOTS score (auto-fills bw if logged)
 * - /lift 1rm <weight> <reps>      - Estimate 1 rep max
 * - /lift w <weight> [weight2] ... - Warmup sets with plate loading (gym)
 * - /lift wh <weight> [weight2]... - Home warmup (5lb bar <45 lbs, 45lb bar above)
 *
 * Food Analysis:
 * - /lift a [context]              - Analyze latest food photo in channel
 *
 * Macro Tracking:
 * - /lift m c20 p40 f15            - Log macros (carbs, protein, fat in grams)
 * - /lift m                        - Today's macro totals
 * - /lift m -1                     - Yesterday's totals
 * - /lift m 1/15                   - Specific date
 * - /lift m 1/10-1/15             - Date range
 * - /lift m confirm                - Log pending food analysis estimate
 * - /lift m adjust c<g> p<g> f<g>  - Adjust and log estimate
 *
 * Bodyweight:
 * - /lift bw <weight>              - Log today's bodyweight
 * - /lift bw                       - Show bodyweight trend (7d/30d)
 *
 * Settings:
 * - /lift units [lbs|kg]           - View or set weight unit preference
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

import type { Plugin, PluginContext, PluginClaude } from '../src/plugins/index.js';
import type { PluginDatabase } from '../src/services/plugin-database.js';
import { registerLiftWebRoutes, getLiftWidgets } from './lift/web.js';
import { registerLiftCommand } from './lift/commands.js';
import { createLiftTools } from './lift/tools.js';
import { migrateToRealColumns } from './lift/migration.js';
import { logger } from '../src/utils/logger.js';

// Re-export all public APIs so existing consumers keep working
export type { WeightUnit, MacroTotals, QuerySpec, PendingEstimate, MacroEstimateResult, WorkoutSet, PersonalRecord, PlateConfig, SlackClient, FoundImage } from './lift/types.js';
export { BAR_WEIGHT, PLATE_SIZES, HOME_PLATE_SIZES, HOME_LIGHT_PLATE_SIZES, WARMUP_PERCENTAGES, MAX_TARGET_WEIGHT, GYM_PLATES, HOME_PLATES, PENDING_ESTIMATE_TTL, FOOD_ANALYSIS_PROMPT } from './lift/types.js';
export { LBS_TO_KG, KG_TO_LBS, lbsToKg, kgToLbs, formatWeight, getUserUnit, setUserUnit } from './lift/units.js';
export { calculatePlateConfig } from './lift/calculations.js';
export { parseLogArgs, parseMacroArgs, parseDate, parseQueryArgs } from './lift/parsing.js';
export { logWorkoutSet, getWorkoutForDate, checkForPR, getPersonalRecords, getAllPersonalRecords, logBodyweight, getLatestBodyweight, getBodyweightHistory, formatBodyweightTrend } from './lift/data.js';
export { titleCase, formatWorkoutSummary, formatPersonalRecords, formatDateLabel, formatMacroSummary } from './lift/formatting.js';
export { getUserTimezone, parseTimezoneOffsetMs, getStartOfDayInTimezone, dateToStartOfDayInTimezone } from './lift/timezone.js';
export { findRecentImageInChannel } from './lift/food.js';

// =============================================================================
// Module-level state
// =============================================================================

let pluginDb: PluginDatabase | null = null;
let pluginClaude: PluginClaude | undefined;

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
    { command: '/lift wilks <total> [bw] <m|f>', description: 'Wilks score (auto-fills bw if logged)', group: 'Lift - Calculators' },
    { command: '/lift dots <total> [bw] <m|f>', description: 'DOTS score (auto-fills bw if logged)', group: 'Lift - Calculators' },
    { command: '/lift 1rm <weight> <reps>', description: 'Estimate 1 rep max (lbs or kg)', group: 'Lift - Calculators' },
    { command: '/lift w <weight> [weight2]', description: 'Warmup sets with plate loading', group: 'Lift - Calculators' },
    { command: '/lift wh <weight> [weight2]', description: 'Home warmup (5lb/45lb bar)', group: 'Lift - Calculators' },
    { command: '/lift bw <weight>', description: 'Log today\'s bodyweight', group: 'Lift - Bodyweight' },
    { command: '/lift bw', description: 'Show bodyweight trend (7d/30d)', group: 'Lift - Bodyweight' },
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

  webNavEntry: { label: 'Lift', icon: 'activity' },

  registerCommands: (app) => {
    registerLiftCommand(app, () => pluginDb, () => pluginClaude);
  },

  registerWebRoutes: registerLiftWebRoutes,

  getWidgets: function() {
    if (!pluginDb) return [];
    return getLiftWidgets(pluginDb);
  },

  tools: createLiftTools(() => pluginDb),

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

    // Bodyweight tracking table (one entry per user per day)
    ctx.db.exec(`
      CREATE TABLE IF NOT EXISTS ${ctx.db.prefix}bodyweight (
        user_id TEXT NOT NULL,
        weight_kg REAL NOT NULL CHECK(weight_kg > 0 AND weight_kg < 500),
        logged_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, logged_at)
      )
    `);

    ctx.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_${ctx.db.prefix}bodyweight_user
        ON ${ctx.db.prefix}bodyweight(user_id, logged_at)
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

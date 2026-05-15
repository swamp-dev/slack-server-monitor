/**
 * Lift Plugin — Claude AI Tool Definitions
 *
 * All 5 tool definitions for Claude AI integration.
 */

import type { ToolDefinition } from '../../src/services/tools/types.js';
import type { PluginDatabase } from '../../src/services/plugin-database.js';
import type { WeightUnit, MacroEstimateResult } from './types.js';
import { GYM_PLATES, HOME_PLATES, WARMUP_PERCENTAGES, MAX_TARGET_WEIGHT } from './types.js';
import { lbsToKg, kgToLbs, getUserUnit } from './units.js';
import { calculateWilks, calculateDots, calculate1rm, calculatePlateConfig } from './calculations.js';
import { getPersonalRecords, getAllPersonalRecords, getLatestBodyweight, getBodyweightHistory, formatBodyweightTrend } from './data.js';

// =============================================================================
// Tool: Powerlifting Score Calculator
// =============================================================================

export const powerliftingTool: ToolDefinition = {
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

// =============================================================================
// Tool: Warmup Calculator
// =============================================================================

export const warmupTool: ToolDefinition = {
  spec: {
    name: 'calculate_warmup_sets',
    description:
      'Calculate warmup set percentages and plate loading configuration for one or more target weights. ' +
      'Accepts weights in lbs or kg (specify via unit parameter, defaults to lbs). ' +
      'Plate loading is always shown in lbs (standard US gym plates). ' +
      'Use this when asked about warming up for a lift or what plates to load. ' +
      'Set home=true for home gym (5lb bar <45 lbs, 45lb bar above; plates: 55, 45, 35, 25, 15, 10, 5x2, 2.5, 1.25 lbs).',
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
        home: {
          type: 'boolean',
          description: 'Use home gym (5lb/45lb bar, plates: 55, 45, 35, 25, 15, 10, 5x2, 2.5, 1.25 lbs, 1 pair each)',
        },
      },
      required: ['target_weights'],
    },
  },
  execute: async (input) => {
    const { target_weights, unit: inputUnit, home } = input as { target_weights: number[]; unit?: string; home?: boolean };
    const config = home ? HOME_PLATES : GYM_PLATES;

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
      const lines: string[] = [`${config.label} for ${label}:`];
      for (const pct of WARMUP_PERCENTAGES) {
        const weight = Math.round(weightLbs * pct);
        const plateConfig = calculatePlateConfig(weight, config).plateStr;
        lines.push(`  ${Math.round(pct * 100)}%: ${weight} lbs - ${plateConfig}`);
      }
      results.push(lines.join('\n'));
    }

    return results.join('\n\n');
  },
};

// =============================================================================
// Tool: Food Macro Estimation (Vision)
// =============================================================================

/**
 * Vision tool for estimating macros from food images
 * Claude uses this to structure its analysis of food photos
 */
export const estimateFoodMacrosTool: ToolDefinition = {
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

// =============================================================================
// Tool: Workout History Query
// =============================================================================

/**
 * Creates the workout history tool.
 * Needs a function to get the current pluginDb reference since it's module-level state.
 */
export function createWorkoutTool(getDb: () => PluginDatabase | null): ToolDefinition {
  return {
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
      const db = getDb();
      if (!db) return 'Error: Database not initialized';

      const { user_id, exercise, days_back = 7, include_prs = false } = input as {
        user_id: string;
        exercise?: string;
        days_back?: number;
        include_prs?: boolean;
      };

      const daysBack = Math.min(Math.max(1, days_back), 90);
      const startTs = Date.now() - daysBack * 24 * 60 * 60 * 1000;

      let query = `SELECT exercise, weight_kg, reps, rpe, logged_at
        FROM ${db.prefix}workout_sets
        WHERE user_id = ? AND logged_at >= ?`;
      const params: (string | number)[] = [user_id, startTs];

      if (exercise) {
        query += ' AND exercise = ?';
        params.push(exercise.toLowerCase());
      }

      query += ' ORDER BY logged_at DESC LIMIT 500';

      const rows = db.prepare(query).all(...params) as {
        exercise: string;
        weight_kg: number;
        reps: number;
        rpe: number | null;
        logged_at: number;
      }[];

      const lines: string[] = [];
      lines.push(`Workout history (last ${daysBack} days): ${rows.length} sets`);

      if (rows.length > 0) {
        // Group by date (UTC — user timezone not available in tool context)
        const byDate = new Map<string, typeof rows>();
        for (const row of rows) {
          const d = new Date(row.logged_at);
          const key = `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
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
          ? getPersonalRecords(user_id, exercise, db)
          : getAllPersonalRecords(user_id, db);

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
}

// =============================================================================
// Tool: Bodyweight History
// =============================================================================

/**
 * Creates the bodyweight history tool.
 * Needs a function to get the current pluginDb reference since it's module-level state.
 */
export function createBodyweightTool(getDb: () => PluginDatabase | null): ToolDefinition {
  return {
    spec: {
      name: 'get_bodyweight_history',
      description:
        'Get a user\'s bodyweight history and trend. ' +
        'Returns recent bodyweight entries, averages, and direction. ' +
        'Use this when asked about bodyweight, weight trends, or body composition.',
      input_schema: {
        type: 'object',
        properties: {
          user_id: {
            type: 'string',
            description: 'Slack user ID to query bodyweight for',
          },
          days: {
            type: 'number',
            description: 'Number of days of history to retrieve (default: 30)',
          },
        },
        required: ['user_id'],
      },
    },
    execute: async (input) => {
      const { user_id, days = 30 } = input as { user_id: string; days?: number };

      const db = getDb();
      if (!db) {
        return 'Bodyweight tracking database not initialized.';
      }

      const unit = getUserUnit(user_id, db);
      const history = getBodyweightHistory(user_id, days, db);
      const latest = getLatestBodyweight(user_id, db);

      if (!latest || history.length === 0) {
        return `No bodyweight entries found for user. They can log with /lift bw <weight>.`;
      }

      const trend = formatBodyweightTrend(history, unit);
      const entries = history.map((e) => {
        const date = new Date(e.loggedAt).toISOString().split('T')[0];
        const weight = unit === 'kg' ? e.weightKg.toFixed(1) : kgToLbs(e.weightKg).toFixed(1);
        return `${date}: ${weight} ${unit}`;
      }).join('\n');

      return `Bodyweight trend (${String(days)}d): ${trend}\n\nHistory:\n${entries}`;
    },
  };
}

/**
 * Array of all lift tools (with static tools + factory-created tools)
 */
export function createLiftTools(getDb: () => PluginDatabase | null): ToolDefinition[] {
  return [
    powerliftingTool,
    warmupTool,
    estimateFoodMacrosTool,
    createWorkoutTool(getDb),
    createBodyweightTool(getDb),
  ];
}

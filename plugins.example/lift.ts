/**
 * Powerlifting Calculator Plugin
 *
 * Example plugin demonstrating:
 * - Slash command registration (/lift)
 * - Subcommands (wilks, dots, 1rm, warmup)
 * - Claude AI tool integration
 * - Using formatters (header, section, divider, context)
 *
 * Commands:
 * - /lift wilks <total_kg> <bodyweight_kg> <m|f> - Calculate Wilks score
 * - /lift dots <total_kg> <bodyweight_kg> <m|f> - Calculate DOTS score
 * - /lift 1rm <weight> <reps> - Estimate 1 rep max
 * - /lift warmup <weight> [weight2] ... - Calculate warmup sets with plate loading
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

import type { App } from '@slack/bolt';
import type { Plugin, PluginApp } from '../src/plugins/index.js';
import type { ToolDefinition } from '../src/services/tools/types.js';
import { header, section, divider, context, buildResponse } from '../src/formatters/blocks.js';
import { logger } from '../src/utils/logger.js';

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
      // Show as plates per side (e.g., "45x1" means one 45 on each side)
      plates.push(`${plateSize}x${pairCount}`);
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
// Slack Command Handler
// =============================================================================

function registerLiftCommand(app: App | PluginApp): void {
  app.command('/lift', async ({ command, ack, respond }) => {
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
          blocks.push(context('Percentages: 40%, 60%, 80%, 100% | Bar = 45 lbs | Plates shown per side'));

          await respond(buildResponse(blocks));
          break;
        }

        case 'help':
        default:
          await respond(
            buildResponse([
              header('Powerlifting Calculator'),
              section('Available commands:'),
              section(
                '• `/lift wilks <total_kg> <bodyweight_kg> <m|f>` - Calculate Wilks score\n' +
                  '• `/lift dots <total_kg> <bodyweight_kg> <m|f>` - Calculate DOTS score\n' +
                  '• `/lift 1rm <weight> <reps>` - Estimate 1 rep max\n' +
                  '• `/lift warmup <weight> [weight2] ...` - Calculate warmup sets with plate loading'
              ),
              divider(),
              context('Tip: Ask Claude with `/ask what\'s my wilks for a 500kg total at 83kg?`'),
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
  version: '1.0.0',
  description: 'Powerlifting calculator for Wilks, DOTS, 1RM estimates, and warmup plate loading',

  registerCommands: registerLiftCommand,

  tools: [powerliftingTool, warmupTool],

  init: async () => {
    // Example async init - could load config, connect to DB, etc.
    // Note: init() must complete within 10 seconds or plugin loading fails
    logger.info('Lift plugin initialized');
  },

  destroy: async () => {
    // Example cleanup
    // Note: destroy() must complete within 5 seconds
    logger.info('Lift plugin destroyed');
  },
};

export default liftPlugin;

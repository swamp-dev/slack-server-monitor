/**
 * Lift Plugin — Powerlifting Formulas and Plate Calculator
 *
 * Wilks, DOTS, 1RM estimation, plate loading configuration, and warmup tables.
 */

import type { PlateConfig } from './types.js';
import { BAR_WEIGHT, GYM_PLATES, WARMUP_PERCENTAGES } from './types.js';
import { header, section } from '../../src/formatters/blocks.js';

// =============================================================================
// Powerlifting Formulas
// =============================================================================

/**
 * Calculate Wilks score (2020 revision)
 * @see https://www.powerlifting.sport/fileadmin/ipf/data/ipf-formula/WilksFormula-Revision-2020.pdf
 */
export function calculateWilks(totalKg: number, bodyweightKg: number, isMale: boolean): number {
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
export function calculateDots(totalKg: number, bodyweightKg: number, isMale: boolean): number {
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
export function calculate1rm(weight: number, reps: number): number {
  if (reps === 1) return weight;
  return weight * (1 + reps / 30);
}

// =============================================================================
// Plate Calculator
// =============================================================================

/**
 * Calculate plate configuration for a given target weight
 * @param targetWeight Target weight in lbs
 * @param config Plate configuration (gym or home)
 * @returns String describing the plate configuration
 */
export function calculatePlateConfig(targetWeight: number, config: PlateConfig = GYM_PLATES): string {
  // Resolve effective bar and plates (light bar for low weights if available)
  let barWt = config.barWeight;
  let plateSizes: readonly number[] = config.plateSizes;
  if (config.lightBar && targetWeight < config.lightBar.threshold) {
    barWt = config.lightBar.weight;
    plateSizes = config.lightBar.plateSizes;
  }

  if (targetWeight < barWt) {
    if (barWt === BAR_WEIGHT) {
      // Gym: dumbbell fallback
      const perHandWeight = Math.round(targetWeight / 10) * 5;
      return `2x${perHandWeight}lb DBs`;
    }
    // Home light bar: bar only (no dumbbells)
    return `${barWt}lb bar only`;
  }

  // Greedy algorithm: fill with largest plates first
  // Note: May not hit exact weight if target isn't achievable with available plates
  let remaining = targetWeight - barWt;
  const plates: string[] = [];

  for (const plateSize of plateSizes) {
    if (config.singlePairOnly) {
      // Home gym: one pair per plate entry (5 appears twice for 2 pairs)
      if (remaining >= plateSize * 2) {
        remaining -= plateSize * 2;
        // Merge with previous if same plate size (e.g., two pairs of 5lb → 5x4)
        const last = plates.length > 0 ? plates[plates.length - 1] : '';
        if (last.startsWith(`${plateSize}x`)) {
          const prevCount = Number(last.split('x')[1]);
          plates[plates.length - 1] = `${plateSize}x${prevCount + 2}`;
        } else {
          plates.push(`${plateSize}x2`);
        }
      }
    } else {
      // Commercial gym: unlimited pairs
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
  }

  const barLabel = barWt === BAR_WEIGHT ? 'Bar' : `${barWt}lb bar`;
  return plates.length > 0 ? `${barLabel} + ${plates.join(' + ')}` : `${barLabel} only`;
}

// =============================================================================
// Warmup Table Formatting
// =============================================================================

/**
 * Format warmup table for a single target weight
 * @param targetWeight Target weight in lbs
 * @param config Plate configuration (gym or home)
 * @param displayLabel Optional label for the header (e.g., "100 kg (~220 lbs)"); defaults to "${targetWeight} lbs"
 * @returns Slack Block Kit blocks for the warmup table
 */
export function formatWarmupTable(targetWeight: number, config: PlateConfig, displayLabel?: string): ReturnType<typeof header | typeof section>[] {
  const rows = WARMUP_PERCENTAGES.map((pct) => {
    const weight = Math.round(targetWeight * pct);
    const plateConfig = calculatePlateConfig(weight, config);
    const pctStr = `${Math.round(pct * 100)}%`.padEnd(4);
    const weightStr = `${weight} lbs`.padEnd(8);
    return `${pctStr} │ ${weightStr} │ ${plateConfig}`;
  });

  return [
    header(`${config.label}: ${displayLabel ?? `${targetWeight} lbs`}`),
    section(
      '```\n' +
        '%    │ Weight   │ Configuration\n' +
        '─────┼──────────┼──────────────────────────\n' +
        rows.join('\n') +
        '\n```'
    ),
  ];
}

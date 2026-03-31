/**
 * Lift Plugin — Slack Block Kit Formatters
 */

import type { WorkoutSet, PersonalRecord, WeightUnit, MacroTotals } from './types.js';
import { kgToLbs } from './units.js';
import { header, section, context } from '../../src/formatters/blocks.js';

// =============================================================================
// Workout Formatting
// =============================================================================

/**
 * Title-case an exercise name: "close grip bench" → "Close Grip Bench"
 */
export function titleCase(str: string): string {
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
// Macro Formatting
// =============================================================================

/**
 * Format date as M/D
 */
export function formatDateLabel(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

/**
 * Format macro summary for Slack display
 */
export function formatMacroSummary(
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

/**
 * Lift Plugin — Input Parsing
 *
 * Parsers for workout log args, macro args, dates, and query specs.
 */

import type { QuerySpec } from './types.js';

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
// Macro Argument Parsing
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

// =============================================================================
// Date Parsing
// =============================================================================

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

// =============================================================================
// Query Argument Parsing
// =============================================================================

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

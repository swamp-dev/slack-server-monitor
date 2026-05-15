/**
 * Lift Plugin — Unit Conversion and User Preferences
 */

import type { PluginDatabase } from '../../src/services/plugin-database.js';
import type { WeightUnit } from './types.js';

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

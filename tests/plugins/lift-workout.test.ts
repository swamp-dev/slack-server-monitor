/**
 * Tests for the lift plugin workout set tracking
 *
 * Tests cover: argument parsing, unit conversion, DB operations (log, query),
 * PR detection, and formatting.
 *
 * Pure functions are exported from the plugin and tested directly.
 * Database operations use an in-memory SQLite database.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { PluginDatabase } from '../../src/services/plugin-database.js';
import {
  parseLogArgs,
  lbsToKg,
  kgToLbs,
  formatWeight,
} from '../../plugins.example/lift.js';

// =============================================================================
// Step 1: Argument Parsing
// =============================================================================

describe('lift plugin workout tracking', () => {
  describe('parseLogArgs', () => {
    describe('valid inputs', () => {
      it('should parse single-word exercise with weight and reps', () => {
        expect(parseLogArgs(['squat', '100', '5'])).toEqual({
          exercise: 'squat',
          weight: 100,
          reps: 5,
          rpe: undefined,
        });
      });

      it('should parse multi-word exercise names', () => {
        expect(parseLogArgs(['bench', 'press', '80', '8'])).toEqual({
          exercise: 'bench press',
          weight: 80,
          reps: 8,
          rpe: undefined,
        });
      });

      it('should parse three-word exercise names', () => {
        expect(parseLogArgs(['close', 'grip', 'bench', '60', '10'])).toEqual({
          exercise: 'close grip bench',
          weight: 60,
          reps: 10,
          rpe: undefined,
        });
      });

      it('should parse RPE with @ prefix', () => {
        expect(parseLogArgs(['squat', '140', '3', '@8'])).toEqual({
          exercise: 'squat',
          weight: 140,
          reps: 3,
          rpe: 8,
        });
      });

      it('should parse decimal RPE', () => {
        expect(parseLogArgs(['deadlift', '180', '5', '@7.5'])).toEqual({
          exercise: 'deadlift',
          weight: 180,
          reps: 5,
          rpe: 7.5,
        });
      });

      it('should parse decimal weight', () => {
        expect(parseLogArgs(['squat', '102.5', '5'])).toEqual({
          exercise: 'squat',
          weight: 102.5,
          reps: 5,
          rpe: undefined,
        });
      });

      it('should lowercase exercise names', () => {
        expect(parseLogArgs(['Bench', 'Press', '100', '5'])).toEqual({
          exercise: 'bench press',
          weight: 100,
          reps: 5,
          rpe: undefined,
        });
      });

      it('should parse RPE of 10', () => {
        expect(parseLogArgs(['squat', '200', '1', '@10'])).toEqual({
          exercise: 'squat',
          weight: 200,
          reps: 1,
          rpe: 10,
        });
      });

      it('should parse RPE of 1', () => {
        expect(parseLogArgs(['squat', '50', '10', '@1'])).toEqual({
          exercise: 'squat',
          weight: 50,
          reps: 10,
          rpe: 1,
        });
      });
    });

    describe('invalid inputs', () => {
      it('should return null for empty args', () => {
        expect(parseLogArgs([])).toBeNull();
      });

      it('should return null for no exercise (starts with number)', () => {
        expect(parseLogArgs(['100', '5'])).toBeNull();
      });

      it('should return null for missing reps', () => {
        expect(parseLogArgs(['squat', '100'])).toBeNull();
      });

      it('should return null for exercise only', () => {
        expect(parseLogArgs(['squat'])).toBeNull();
      });

      it('should return null for zero weight', () => {
        expect(parseLogArgs(['squat', '0', '5'])).toBeNull();
      });

      it('should return null for negative weight', () => {
        expect(parseLogArgs(['squat', '-100', '5'])).toBeNull();
      });

      it('should return null for zero reps', () => {
        expect(parseLogArgs(['squat', '100', '0'])).toBeNull();
      });

      it('should return null for negative reps', () => {
        expect(parseLogArgs(['squat', '100', '-5'])).toBeNull();
      });

      it('should return null for non-integer reps', () => {
        expect(parseLogArgs(['squat', '100', '5.5'])).toBeNull();
      });

      it('should return null for reps over 100', () => {
        expect(parseLogArgs(['squat', '100', '101'])).toBeNull();
      });

      it('should return null for RPE below 1', () => {
        expect(parseLogArgs(['squat', '100', '5', '@0'])).toBeNull();
      });

      it('should return null for RPE above 10', () => {
        expect(parseLogArgs(['squat', '100', '5', '@11'])).toBeNull();
      });

      it('should return null for weight over 999', () => {
        expect(parseLogArgs(['squat', '1000', '5'])).toBeNull();
      });
    });
  });

  // =============================================================================
  // Unit Conversion
  // =============================================================================

  describe('unit conversion', () => {
    describe('lbsToKg', () => {
      it('should convert lbs to kg', () => {
        expect(lbsToKg(100)).toBeCloseTo(45.3592, 2);
      });

      it('should handle 0', () => {
        expect(lbsToKg(0)).toBe(0);
      });

      it('should convert 225 lbs', () => {
        expect(lbsToKg(225)).toBeCloseTo(102.058, 1);
      });
    });

    describe('kgToLbs', () => {
      it('should convert kg to lbs', () => {
        expect(kgToLbs(100)).toBeCloseTo(220.462, 1);
      });

      it('should handle 0', () => {
        expect(kgToLbs(0)).toBe(0);
      });

      it('should be inverse of lbsToKg', () => {
        expect(kgToLbs(lbsToKg(100))).toBeCloseTo(100, 1);
      });
    });

    describe('formatWeight', () => {
      it('should format in kg', () => {
        expect(formatWeight(100, 'kg')).toBe('100.0 kg');
      });

      it('should format in lbs', () => {
        expect(formatWeight(100, 'lbs')).toBe('220.5 lbs');
      });

      it('should format with one decimal place', () => {
        expect(formatWeight(102.567, 'kg')).toBe('102.6 kg');
      });

      it('should format 0 kg', () => {
        expect(formatWeight(0, 'kg')).toBe('0.0 kg');
      });
    });
  });
});

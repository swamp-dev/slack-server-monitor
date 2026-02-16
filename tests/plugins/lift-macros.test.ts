/**
 * Tests for the lift plugin macros tracking
 *
 * These tests verify macro parsing, date calculations, and formatting
 * without needing to test Slack integration.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseMacroArgs,
  parseDate,
  parseQueryArgs,
  formatDateLabel,
  getStartOfDayInTimezone,
  dateToStartOfDayInTimezone,
  type MacroTotals,
} from '../../plugins.example/lift.js';

// =============================================================================
// Local helper for formatting (not exported from plugin)
// =============================================================================

/**
 * Format macro summary for display (simplified version for testing)
 */
function formatMacroSummary(
  label: string,
  totals: MacroTotals
): { header: string; body: string; context: string } {
  const calories = totals.carbs * 4 + totals.protein * 4 + totals.fat * 9;

  return {
    header: `Macros: ${label}`,
    body:
      '```\n' +
      `Carbs:   ${String(totals.carbs).padStart(4)}g\n` +
      `Protein: ${String(totals.protein).padStart(4)}g\n` +
      `Fat:     ${String(totals.fat).padStart(4)}g\n` +
      '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n' +
      `Calories: ~${calories.toLocaleString()}\n` +
      '```',
    context: `${totals.entries} entries`,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('lift plugin macros tracker', () => {
  describe('parseMacroArgs', () => {
    describe('valid inputs', () => {
      it('should parse all three macros', () => {
        expect(parseMacroArgs(['c20', 'p40', 'f15'])).toEqual({
          carbs: 20,
          protein: 40,
          fat: 15,
        });
      });

      it('should parse in any order', () => {
        expect(parseMacroArgs(['p40', 'c20', 'f15'])).toEqual({
          carbs: 20,
          protein: 40,
          fat: 15,
        });
        expect(parseMacroArgs(['f15', 'p40', 'c20'])).toEqual({
          carbs: 20,
          protein: 40,
          fat: 15,
        });
      });

      it('should handle single macro', () => {
        expect(parseMacroArgs(['p40'])).toEqual({
          carbs: 0,
          protein: 40,
          fat: 0,
        });
        expect(parseMacroArgs(['c30'])).toEqual({
          carbs: 30,
          protein: 0,
          fat: 0,
        });
        expect(parseMacroArgs(['f25'])).toEqual({
          carbs: 0,
          protein: 0,
          fat: 25,
        });
      });

      it('should handle two macros', () => {
        expect(parseMacroArgs(['c20', 'p40'])).toEqual({
          carbs: 20,
          protein: 40,
          fat: 0,
        });
        expect(parseMacroArgs(['p40', 'f15'])).toEqual({
          carbs: 0,
          protein: 40,
          fat: 15,
        });
      });

      it('should be case insensitive', () => {
        expect(parseMacroArgs(['C20', 'P40', 'F15'])).toEqual({
          carbs: 20,
          protein: 40,
          fat: 15,
        });
        expect(parseMacroArgs(['c20', 'P40', 'f15'])).toEqual({
          carbs: 20,
          protein: 40,
          fat: 15,
        });
      });

      it('should handle zero values', () => {
        expect(parseMacroArgs(['c0', 'p0', 'f0'])).toEqual({
          carbs: 0,
          protein: 0,
          fat: 0,
        });
      });

      it('should handle large values', () => {
        expect(parseMacroArgs(['c200', 'p300', 'f100'])).toEqual({
          carbs: 200,
          protein: 300,
          fat: 100,
        });
      });

      it('should parse decimal values', () => {
        expect(parseMacroArgs(['c20.5', 'p40', 'f2.5'])).toEqual({
          carbs: 20.5,
          protein: 40,
          fat: 2.5,
        });
      });

      it('should parse single decimal macro', () => {
        expect(parseMacroArgs(['f2.5'])).toEqual({
          carbs: 0,
          protein: 0,
          fat: 2.5,
        });
      });

      it('should parse mixed integer and decimal values', () => {
        expect(parseMacroArgs(['c100', 'p50.5', 'f15'])).toEqual({
          carbs: 100,
          protein: 50.5,
          fat: 15,
        });
      });

      it('should handle decimal with trailing zeros', () => {
        expect(parseMacroArgs(['f5.0'])).toEqual({
          carbs: 0,
          protein: 0,
          fat: 5.0,
        });
      });

      it('should handle small decimal values', () => {
        expect(parseMacroArgs(['f0.5'])).toEqual({
          carbs: 0,
          protein: 0,
          fat: 0.5,
        });
      });

      it('should ignore invalid args and parse valid ones', () => {
        expect(parseMacroArgs(['invalid', 'p40', 'foo'])).toEqual({
          carbs: 0,
          protein: 40,
          fat: 0,
        });
      });

      it('should use last value when macro specified multiple times', () => {
        expect(parseMacroArgs(['c10', 'c20'])).toEqual({
          carbs: 20,
          protein: 0,
          fat: 0,
        });
      });
    });

    describe('invalid inputs', () => {
      it('should return null for empty array', () => {
        expect(parseMacroArgs([])).toBeNull();
      });

      it('should return null for no valid macros', () => {
        expect(parseMacroArgs(['invalid'])).toBeNull();
        expect(parseMacroArgs(['help'])).toBeNull();
        expect(parseMacroArgs(['-1'])).toBeNull();
        expect(parseMacroArgs(['1/15'])).toBeNull();
      });

      it('should not parse negative numbers', () => {
        expect(parseMacroArgs(['c-20'])).toBeNull();
      });

      it('should not parse multiple decimal points', () => {
        expect(parseMacroArgs(['c20.5.5'])).toBeNull();
      });

      it('should not parse without number', () => {
        expect(parseMacroArgs(['c'])).toBeNull();
        expect(parseMacroArgs(['p'])).toBeNull();
        expect(parseMacroArgs(['f'])).toBeNull();
      });

      it('should not parse invalid letters', () => {
        expect(parseMacroArgs(['x20'])).toBeNull();
        expect(parseMacroArgs(['a40'])).toBeNull();
      });
    });
  });

  describe('parseDate', () => {
    it('should parse valid M/D format', () => {
      const result = parseDate('1/15');
      expect(result?.getMonth()).toBe(0); // January
      expect(result?.getDate()).toBe(15);
      // Year depends on current date due to heuristic
    });

    it('should parse two-digit month and day', () => {
      const result = parseDate('12/25');
      expect(result?.getMonth()).toBe(11); // December
      expect(result?.getDate()).toBe(25);
    });

    it('should parse single-digit month and day', () => {
      const result = parseDate('5/3');
      expect(result?.getMonth()).toBe(4); // May
      expect(result?.getDate()).toBe(3);
    });

    it('should return null for invalid format', () => {
      expect(parseDate('2024-01-15')).toBeNull();
      expect(parseDate('15/1/2024')).toBeNull();
      expect(parseDate('january 15')).toBeNull();
      expect(parseDate('abc')).toBeNull();
      expect(parseDate('')).toBeNull();
    });

    it('should return null for invalid dates', () => {
      expect(parseDate('13/1')).toBeNull(); // Invalid month
      expect(parseDate('0/15')).toBeNull(); // Invalid month
    });

    it('should use previous year for dates >30 days in future', () => {
      // This test depends on current date, so we test the behavior conceptually
      // If we're in early January and query December, it should be last year
      const now = new Date();
      const futureMonth = now.getMonth() + 3; // 3 months ahead
      if (futureMonth <= 11) {
        // Only test if 3 months ahead is still valid month number
        const dateStr = `${futureMonth + 1}/15`;
        const result = parseDate(dateStr);
        // Should be previous year since >30 days in future
        if (result) {
          expect(result.getFullYear()).toBe(now.getFullYear() - 1);
        }
      }
    });

    it('should use current year for dates within 30 days', () => {
      const now = new Date();
      // Query a date 10 days from now (should be current year)
      const futureDate = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);
      const dateStr = `${futureDate.getMonth() + 1}/${futureDate.getDate()}`;
      const result = parseDate(dateStr);
      expect(result?.getFullYear()).toBe(now.getFullYear());
    });
  });

  describe('parseQueryArgs', () => {
    describe('today query', () => {
      it('should return today for empty args', () => {
        expect(parseQueryArgs([])).toEqual({ type: 'today' });
      });
    });

    describe('relative days', () => {
      it('should parse -1 as yesterday', () => {
        const result = parseQueryArgs(['-1']);
        expect(result?.type).toBe('relative');
        expect(result?.daysAgo).toBe(-1);
      });

      it('should parse -7 as last 7 days', () => {
        const result = parseQueryArgs(['-7']);
        expect(result?.type).toBe('relative');
        expect(result?.daysAgo).toBe(-7);
      });

      it('should parse larger ranges', () => {
        const result = parseQueryArgs(['-30']);
        expect(result?.type).toBe('relative');
        expect(result?.daysAgo).toBe(-30);
      });

      it('should accept -365 (max allowed)', () => {
        const result = parseQueryArgs(['-365']);
        expect(result?.type).toBe('relative');
        expect(result?.daysAgo).toBe(-365);
      });

      it('should reject queries over 1 year', () => {
        expect(parseQueryArgs(['-366'])).toBeNull();
        expect(parseQueryArgs(['-999'])).toBeNull();
        expect(parseQueryArgs(['-9999'])).toBeNull();
      });
    });

    describe('single date', () => {
      it('should parse M/D format', () => {
        const result = parseQueryArgs(['1/15']);
        expect(result?.type).toBe('date');
        expect(result?.date?.getMonth()).toBe(0);
        expect(result?.date?.getDate()).toBe(15);
      });

      it('should parse 12/25 format', () => {
        const result = parseQueryArgs(['12/25']);
        expect(result?.type).toBe('date');
        expect(result?.date?.getMonth()).toBe(11);
        expect(result?.date?.getDate()).toBe(25);
      });
    });

    describe('date range', () => {
      it('should parse M/D-M/D format', () => {
        const result = parseQueryArgs(['1/10-1/15']);
        expect(result?.type).toBe('range');
        expect(result?.startDate?.getMonth()).toBe(0);
        expect(result?.startDate?.getDate()).toBe(10);
        expect(result?.endDate?.getMonth()).toBe(0);
        expect(result?.endDate?.getDate()).toBe(15);
      });

      it('should parse cross-month range', () => {
        const result = parseQueryArgs(['1/25-2/5']);
        expect(result?.type).toBe('range');
        expect(result?.startDate?.getMonth()).toBe(0);
        expect(result?.endDate?.getMonth()).toBe(1);
      });
    });

    describe('invalid queries', () => {
      it('should return null for macro-like input', () => {
        expect(parseQueryArgs(['c20'])).toBeNull();
        expect(parseQueryArgs(['p40', 'f15'])).toBeNull();
      });

      it('should return null for invalid range', () => {
        expect(parseQueryArgs(['abc-def'])).toBeNull();
      });

      it('should return null for backwards date range', () => {
        // 1/15-1/10 is backwards (end before start)
        expect(parseQueryArgs(['1/15-1/10'])).toBeNull();
      });
    });
  });

  describe('formatMacroSummary', () => {
    it('should format today with all macros', () => {
      const result = formatMacroSummary('Today', {
        carbs: 120,
        protein: 180,
        fat: 65,
        entries: 5,
      });

      expect(result.header).toBe('Macros: Today');
      expect(result.body).toContain('Carbs:    120g');
      expect(result.body).toContain('Protein:  180g');
      expect(result.body).toContain('Fat:       65g');
      // Calories: 120*4 + 180*4 + 65*9 = 480 + 720 + 585 = 1785
      expect(result.body).toContain('Calories: ~1,785');
      expect(result.context).toBe('5 entries');
    });

    it('should format empty totals', () => {
      const result = formatMacroSummary('Today', {
        carbs: 0,
        protein: 0,
        fat: 0,
        entries: 0,
      });

      expect(result.body).toContain('Carbs:      0g');
      expect(result.body).toContain('Protein:    0g');
      expect(result.body).toContain('Fat:        0g');
      expect(result.body).toContain('Calories: ~0');
      expect(result.context).toBe('0 entries');
    });

    it('should right-align values', () => {
      const result = formatMacroSummary('Today', {
        carbs: 5,
        protein: 50,
        fat: 500,
        entries: 1,
      });

      expect(result.body).toContain('Carbs:      5g');
      expect(result.body).toContain('Protein:   50g');
      expect(result.body).toContain('Fat:      500g');
    });

    it('should calculate calories correctly', () => {
      // 100c * 4 + 100p * 4 + 100f * 9 = 400 + 400 + 900 = 1700
      const result = formatMacroSummary('Test', {
        carbs: 100,
        protein: 100,
        fat: 100,
        entries: 3,
      });
      expect(result.body).toContain('Calories: ~1,700');
    });

    it('should format with custom label', () => {
      const result = formatMacroSummary('Yesterday', {
        carbs: 0,
        protein: 0,
        fat: 0,
        entries: 0,
      });
      expect(result.header).toBe('Macros: Yesterday');
    });

    it('should format date range label', () => {
      const result = formatMacroSummary('1/10 - 1/15', {
        carbs: 0,
        protein: 0,
        fat: 0,
        entries: 0,
      });
      expect(result.header).toBe('Macros: 1/10 - 1/15');
    });
  });

  describe('formatDateLabel', () => {
    it('should format date as M/D', () => {
      const date = new Date(2024, 0, 15); // January 15
      expect(formatDateLabel(date)).toBe('1/15');
    });

    it('should not zero-pad month or day', () => {
      const date = new Date(2024, 0, 5); // January 5
      expect(formatDateLabel(date)).toBe('1/5');
    });

    it('should handle December', () => {
      const date = new Date(2024, 11, 25); // December 25
      expect(formatDateLabel(date)).toBe('12/25');
    });
  });

  describe('calorie calculations', () => {
    it('should use 4 cal/g for carbs', () => {
      const result = formatMacroSummary('Test', {
        carbs: 100,
        protein: 0,
        fat: 0,
        entries: 1,
      });
      expect(result.body).toContain('Calories: ~400');
    });

    it('should use 4 cal/g for protein', () => {
      const result = formatMacroSummary('Test', {
        carbs: 0,
        protein: 100,
        fat: 0,
        entries: 1,
      });
      expect(result.body).toContain('Calories: ~400');
    });

    it('should use 9 cal/g for fat', () => {
      const result = formatMacroSummary('Test', {
        carbs: 0,
        protein: 0,
        fat: 100,
        entries: 1,
      });
      expect(result.body).toContain('Calories: ~900');
    });
  });

  describe('integration: command parsing flow', () => {
    /**
     * Simulates the command routing logic
     */
    function determineAction(
      args: string[]
    ): 'log' | 'help' | 'query' | 'invalid' {
      if (args.length === 1 && args[0].toLowerCase() === 'help') {
        return 'help';
      }

      const macros = parseMacroArgs(args);
      if (macros) {
        return 'log';
      }

      const query = parseQueryArgs(args);
      if (query) {
        return 'query';
      }

      return 'invalid';
    }

    it('should route to log for macro input', () => {
      expect(determineAction(['c20', 'p40', 'f15'])).toBe('log');
      expect(determineAction(['p40'])).toBe('log');
      expect(determineAction(['C30', 'F20'])).toBe('log');
    });

    it('should route to help', () => {
      expect(determineAction(['help'])).toBe('help');
      expect(determineAction(['HELP'])).toBe('help');
    });

    it('should route to query for date/relative', () => {
      expect(determineAction([])).toBe('query'); // today
      expect(determineAction(['-1'])).toBe('query');
      expect(determineAction(['-7'])).toBe('query');
      expect(determineAction(['1/15'])).toBe('query');
      expect(determineAction(['1/10-1/15'])).toBe('query');
    });

    it('should return invalid for unrecognized input', () => {
      expect(determineAction(['garbage'])).toBe('invalid');
      expect(determineAction(['foo', 'bar'])).toBe('invalid');
    });
  });

  describe('timezone utilities', () => {
    describe('getStartOfDayInTimezone', () => {
      it('should return UTC midnight when tz is null', () => {
        const result = getStartOfDayInTimezone(null, 0);
        const now = new Date();
        const expected = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
        expect(result).toBe(expected);
      });

      it('should return yesterday UTC midnight when daysAgo is 1', () => {
        const result = getStartOfDayInTimezone(null, 1);
        const now = new Date();
        const expected = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 24 * 60 * 60 * 1000;
        expect(result).toBe(expected);
      });

      it('should handle valid IANA timezone', () => {
        // Use a well-known timezone
        const result = getStartOfDayInTimezone('America/New_York', 0);
        // Result should be a valid timestamp
        expect(typeof result).toBe('number');
        expect(result).toBeGreaterThan(0);
      });

      it('should handle UTC timezone', () => {
        const result = getStartOfDayInTimezone('UTC', 0);
        expect(typeof result).toBe('number');
        expect(result).toBeGreaterThan(0);
      });

      it('should return different times for different timezones', () => {
        // Pin to a time where both NY (UTC-5) and LA (UTC-8) see the same date.
        // Without pinning, this fails during ~05:00-08:00 UTC when NY has
        // rolled to the next day but LA hasn't, producing different dates.
        vi.useFakeTimers({ now: Date.UTC(2026, 1, 3, 15, 0, 0) });
        try {
          const nyTime = getStartOfDayInTimezone('America/New_York', 0);
          const laTime = getStartOfDayInTimezone('America/Los_Angeles', 0);
          // LA is 3 hours behind NY, so midnight LA is later than midnight NY
          // (in UTC terms, LA midnight is a larger timestamp)
          expect(laTime).toBeGreaterThan(nyTime);
        } finally {
          vi.useRealTimers();
        }
      });

      it('should handle timezone with half-hour offset', () => {
        // India is UTC+5:30
        const result = getStartOfDayInTimezone('Asia/Kolkata', 0);
        expect(typeof result).toBe('number');
        expect(result).toBeGreaterThan(0);
      });
    });

    describe('getStartOfDayInTimezone (pinned timestamps)', () => {
      beforeEach(() => {
        // Pin to 2026-02-03T15:30:00Z
        vi.useFakeTimers({ now: Date.UTC(2026, 1, 3, 15, 30, 0) });
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it('should return midnight UTC for UTC timezone', () => {
        const result = getStartOfDayInTimezone('UTC', 0);
        // Midnight UTC Feb 3 2026
        expect(result).toBe(Date.UTC(2026, 1, 3));
      });

      it('should return midnight EST for America/New_York', () => {
        const result = getStartOfDayInTimezone('America/New_York', 0);
        // Midnight EST = 5 AM UTC (EST is UTC-5)
        expect(result).toBe(Date.UTC(2026, 1, 3, 5));
      });

      it('should return midnight PST for America/Los_Angeles', () => {
        const result = getStartOfDayInTimezone('America/Los_Angeles', 0);
        // Midnight PST = 8 AM UTC (PST is UTC-8)
        expect(result).toBe(Date.UTC(2026, 1, 3, 8));
      });

      it('should return midnight IST for Asia/Kolkata (+5:30)', () => {
        const result = getStartOfDayInTimezone('Asia/Kolkata', 0);
        // Midnight IST = previous day 18:30 UTC (IST is UTC+5:30)
        expect(result).toBe(Date.UTC(2026, 1, 2, 18, 30));
      });

      it('should handle daysAgo=1 with EST timezone', () => {
        const result = getStartOfDayInTimezone('America/New_York', 1);
        // Midnight EST Feb 2 = 5 AM UTC Feb 2
        expect(result).toBe(Date.UTC(2026, 1, 2, 5));
      });

      it('should use UTC date parts when tz is null', () => {
        // Pin to 2 AM UTC Feb 3 = 9 PM EST Feb 2
        // Null tz should use UTC date (Feb 3), NOT local date
        vi.setSystemTime(Date.UTC(2026, 1, 3, 2, 0, 0));
        const result = getStartOfDayInTimezone(null, 0);
        // Should be midnight UTC Feb 3
        expect(result).toBe(Date.UTC(2026, 1, 3));
      });
    });

    describe('dateToStartOfDayInTimezone (pinned timestamps)', () => {
      it('should return midnight EST for a date in EST timezone', () => {
        // 3:30 PM UTC Feb 3 = 10:30 AM EST Feb 3
        const date = new Date(Date.UTC(2026, 1, 3, 15, 30, 0));
        const result = dateToStartOfDayInTimezone(date, 'America/New_York');
        // Midnight EST Feb 3 = 5 AM UTC Feb 3
        expect(result).toBe(Date.UTC(2026, 1, 3, 5));
      });

      it('should handle cross-day boundary in EST', () => {
        // 3 AM UTC Feb 4 = 10 PM EST Feb 3
        const date = new Date(Date.UTC(2026, 1, 4, 3, 0, 0));
        const result = dateToStartOfDayInTimezone(date, 'America/New_York');
        // In EST this is still Feb 3, so midnight EST Feb 3 = 5 AM UTC Feb 3
        expect(result).toBe(Date.UTC(2026, 1, 3, 5));
      });
    });
  });
});

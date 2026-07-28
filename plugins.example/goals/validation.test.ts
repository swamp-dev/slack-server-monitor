import { describe, it, expect } from 'vitest';
import {
  LIMITS,
  parseId,
  parseIdList,
  parseIndex,
  parseText,
  parseOptionalText,
  parseDueDate,
  parseHexColor,
  parseVisibility,
  parseIdentity,
  parseClientId,
  parseBool,
} from './validation.js';

describe('goals validation', () => {
  describe('parseId', () => {
    it.each([
      ['a number', 5, 5],
      ['a numeric string', '42', 42],
      ['a padded numeric string', ' 7 ', 7],
    ])('accepts %s', (_label, input, expected) => {
      expect(parseId(input)).toBe(expected);
    });

    it.each([
      ['zero', '0'],
      ['a negative', -1],
      ['a fraction', 1.5],
      ['a trailing-garbage string', '1abc'],
      ['an empty string', ''],
      ['null', null],
      ['undefined', undefined],
      ['an array', [1]],
      ['Infinity', Infinity],
      ['NaN', NaN],
      ['a number beyond safe integers', Number.MAX_SAFE_INTEGER + 2],
    ])('rejects %s', (_label, input) => {
      expect(parseId(input)).toBeNull();
    });
  });

  describe('parseIdList', () => {
    it('accepts an array of ids', () => {
      expect(parseIdList([3, 1, 2])).toEqual([3, 1, 2]);
    });

    it('accepts a comma-separated string', () => {
      expect(parseIdList('3,1,2')).toEqual([3, 1, 2]);
    });

    it('rejects duplicates', () => {
      expect(parseIdList([1, 2, 1])).toBeNull();
    });

    it('rejects a list containing an invalid id', () => {
      expect(parseIdList([1, 'x'])).toBeNull();
    });

    it('rejects an empty list', () => {
      expect(parseIdList([])).toBeNull();
      expect(parseIdList('')).toBeNull();
    });

    it('rejects a list longer than the cap', () => {
      const tooMany = Array.from({ length: 65 }, (_v, i) => i + 1);
      expect(parseIdList(tooMany)).toBeNull();
    });
  });

  describe('parseIndex', () => {
    it('accepts zero and positive integers', () => {
      expect(parseIndex(0)).toBe(0);
      expect(parseIndex('3')).toBe(3);
    });

    it('rejects negatives, fractions and absurd values', () => {
      expect(parseIndex(-1)).toBeNull();
      expect(parseIndex(2.5)).toBeNull();
      expect(parseIndex(10001)).toBeNull();
    });
  });

  describe('parseText', () => {
    it('trims and returns the value', () => {
      expect(parseText('  Buy milk  ', LIMITS.cardTitle)).toBe('Buy milk');
    });

    it('rejects empty and whitespace-only input', () => {
      expect(parseText('', LIMITS.cardTitle)).toBeNull();
      expect(parseText('   ', LIMITS.cardTitle)).toBeNull();
    });

    it('rejects non-string input', () => {
      expect(parseText(null, LIMITS.cardTitle)).toBeNull();
      expect(parseText(42, LIMITS.cardTitle)).toBeNull();
    });

    it('measures length in code points so emoji are not truncated mid-surrogate', () => {
      // Astral-plane emoji: 8 UTF-16 units, 4 code points.
      const emoji = '\u{1F680}\u{1F680}\u{1F680}\u{1F680}';
      expect(emoji.length).toBe(8);
      expect(parseText(emoji, 4)).toBe(emoji);
      expect(parseText(emoji, 3)).toBeNull();
    });

    it('rejects input longer than the limit', () => {
      expect(parseText('a'.repeat(LIMITS.cardTitle + 1), LIMITS.cardTitle)).toBeNull();
    });

    it('strips C0 control characters but keeps newlines and tabs', () => {
      expect(parseText('a\u0000b\u0007c', 50)).toBe('abc');
      expect(parseText('a\nb\tc', 50, { multiline: true })).toBe('a\nb\tc');
    });

    it('normalises CRLF to LF', () => {
      expect(parseText('a\r\nb', 50, { multiline: true })).toBe('a\nb');
    });

    it('collapses newlines to spaces for single-line fields', () => {
      expect(parseText('a\nb', 50)).toBe('a b');
    });
  });

  describe('parseOptionalText', () => {
    it('returns an empty string for empty input rather than null', () => {
      expect(parseOptionalText('', LIMITS.cardDescription)).toBe('');
      expect(parseOptionalText(undefined, LIMITS.cardDescription)).toBe('');
    });

    it('still rejects over-length input', () => {
      expect(
        parseOptionalText('a'.repeat(LIMITS.cardDescription + 1), LIMITS.cardDescription)
      ).toBeNull();
    });

    it('preserves interior newlines', () => {
      expect(parseOptionalText('one\ntwo', 50)).toBe('one\ntwo');
    });
  });

  describe('parseDueDate', () => {
    it('accepts a valid calendar date', () => {
      expect(parseDueDate('2026-07-25')).toBe('2026-07-25');
    });

    it('treats an empty string as a clear', () => {
      expect(parseDueDate('')).toBe(null);
      expect(parseDueDate('   ')).toBe(null);
    });

    it.each([
      ['a non-existent day', '2026-02-31'],
      ['month 13', '2026-13-01'],
      ['day zero', '2026-01-00'],
      ['a loose format', '2026-7-5'],
      ['a timestamp', '2026-07-25T10:00:00Z'],
      ['garbage', 'tomorrow'],
      ['a year out of range', '0001-01-01'],
    ])('rejects %s', (_label, input) => {
      expect(parseDueDate(input)).toBe(false);
    });

    it('accepts a leap day in a leap year and rejects it otherwise', () => {
      expect(parseDueDate('2028-02-29')).toBe('2028-02-29');
      expect(parseDueDate('2027-02-29')).toBe(false);
    });
  });

  describe('parseHexColor', () => {
    it('accepts six-digit hex and lowercases it', () => {
      expect(parseHexColor('#7C3AED')).toBe('#7c3aed');
    });

    it.each([['#fff'], ['7c3aed'], ['red'], ['#12345g'], ['#7c3aed;color:red']])(
      'rejects %s',
      (input) => {
        expect(parseHexColor(input)).toBeNull();
      }
    );
  });

  describe('parseVisibility', () => {
    it('accepts the two known values', () => {
      expect(parseVisibility('shared')).toBe('shared');
      expect(parseVisibility('private')).toBe('private');
    });

    it('rejects anything else', () => {
      expect(parseVisibility('public')).toBeNull();
      expect(parseVisibility(undefined)).toBeNull();
    });
  });

  describe('parseIdentity', () => {
    it('accepts Slack and web identities', () => {
      expect(parseIdentity('U012ABC')).toBe('U012ABC');
      expect(parseIdentity('web:andy')).toBe('web:andy');
    });

    it('treats empty input as a clear', () => {
      expect(parseIdentity('')).toBe(null);
    });

    it('rejects characters outside the identity alphabet', () => {
      expect(parseIdentity('andy smith')).toBe(false);
      expect(parseIdentity('<script>')).toBe(false);
      expect(parseIdentity('a'.repeat(LIMITS.identity + 1))).toBe(false);
    });
  });

  describe('parseClientId', () => {
    it('accepts an alphanumeric token', () => {
      expect(parseClientId('a1b2c3d4')).toBe('a1b2c3d4');
    });

    it('returns an empty string for anything unusable', () => {
      expect(parseClientId('short')).toBe('');
      expect(parseClientId('has-dash-and-more')).toBe('');
      expect(parseClientId(undefined)).toBe('');
    });
  });

  describe('parseBool', () => {
    it('accepts the truthy and falsy forms the UI sends', () => {
      expect(parseBool('1')).toBe(true);
      expect(parseBool('true')).toBe(true);
      expect(parseBool(true)).toBe(true);
      expect(parseBool('0')).toBe(false);
      expect(parseBool('false')).toBe(false);
      expect(parseBool(false)).toBe(false);
    });

    it('returns null for anything else', () => {
      expect(parseBool('yes')).toBeNull();
      expect(parseBool(undefined)).toBeNull();
    });
  });
});

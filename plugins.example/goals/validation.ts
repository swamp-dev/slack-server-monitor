/**
 * Input validation for the goals plugin.
 *
 * Validators never throw — they return `null` for "unusable, reject the
 * request". Three-state validators (`parseDueDate`, `parseIdentity`) return
 * `false` for invalid and `null` for "the user cleared this field", because an
 * optional field needs to distinguish "leave it alone / clear it" from "this
 * was garbage".
 */
import type { BoardVisibility } from './types.js';

export const LIMITS = {
  boardTitle: 80,
  boardDescription: 500,
  columnName: 40,
  cardTitle: 200,
  cardDescription: 4000,
  commentBody: 2000,
  memberName: 40,
  identity: 64,

  maxColumnsPerBoard: 20,
  maxCardsPerColumn: 500,
  maxBoardsPerOwner: 50,
  maxCommentsPerCard: 500,
  maxIdListLength: 64,
  maxIndex: 10000,
} as const;

/** Positive safe integer, from a number or a numeric string. Rejects 0. */
export function parseId(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;

  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/** A non-empty list of distinct ids, from an array or a comma-separated string. */
export function parseIdList(value: unknown): number[] | null {
  let raw: unknown[];
  if (Array.isArray(value)) {
    raw = value;
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    raw = trimmed.split(',');
  } else {
    return null;
  }

  if (raw.length === 0 || raw.length > LIMITS.maxIdListLength) return null;

  const ids: number[] = [];
  const seen = new Set<number>();
  for (const entry of raw) {
    const id = parseId(entry);
    if (id === null || seen.has(id)) return null;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/** Non-negative array index. The caller still clamps against live data. */
export function parseIndex(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 && value <= LIMITS.maxIndex ? value : null;
  }
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;

  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed <= LIMITS.maxIndex ? parsed : null;
}

export interface TextOptions {
  /** Keep newlines and tabs instead of collapsing them to spaces. */
  multiline?: boolean;
}

function cleanText(value: string, options: TextOptions): string {
  let text = value.replace(/\r\n/g, '\n');

  // Strip C0 control characters. \n and \t survive only for multiline fields;
  // for single-line fields a newline becomes a space so pasted text doesn't
  // silently lose its word boundaries.
  text = options.multiline
    ? text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    : text.replace(/[\n\t]/g, ' ').replace(/[\u0000-\u001f]/g, '');

  return text.trim();
}

/** Length is measured in code points so emoji aren't cut mid-surrogate. */
function codePointLength(value: string): number {
  return [...value].length;
}

/** Required text field. */
export function parseText(value: unknown, maxLength: number, options: TextOptions = {}): string | null {
  if (typeof value !== 'string') return null;

  const text = cleanText(value, options);
  if (text === '') return null;
  if (codePointLength(text) > maxLength) return null;

  return text;
}

/** Optional text field — absent or empty yields `''`, over-length yields `null`. */
export function parseOptionalText(
  value: unknown,
  maxLength: number,
  options: TextOptions = { multiline: true }
): string | null {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') return null;

  const text = cleanText(value, options);
  if (text === '') return '';
  if (codePointLength(text) > maxLength) return null;

  return text;
}

/**
 * Strict `YYYY-MM-DD` calendar date.
 * Returns the date, `null` to clear it, or `false` when the input is invalid.
 */
export function parseDueDate(value: unknown): string | null | false {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return false;

  const trimmed = value.trim();
  if (trimmed === '') return null;

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1970 || year > 2999) return false;

  // Round-trip through Date so 2026-02-31 and 2027-02-29 are rejected rather
  // than silently rolling over into the next month.
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return false;
  }

  return trimmed;
}

/** Six-digit hex colour, lowercased. Anything else is rejected. */
export function parseHexColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed.toLowerCase() : null;
}

export function parseVisibility(value: unknown): BoardVisibility | null {
  return value === 'shared' || value === 'private' ? value : null;
}

/**
 * App identity string ('U123', 'web:andy', 'admin').
 * Returns the identity, `null` to unlink, or `false` when invalid.
 */
export function parseIdentity(value: unknown): string | null | false {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return false;

  const trimmed = value.trim();
  if (trimmed === '') return null;

  return /^[A-Za-z0-9_:.-]{1,64}$/.test(trimmed) ? trimmed : false;
}

/** Per-page-load token used to suppress a client's own SSE echo. Never rendered. */
export function parseClientId(value: unknown): string {
  if (typeof value !== 'string') return '';

  const trimmed = value.trim();
  return /^[a-z0-9]{6,32}$/.test(trimmed) ? trimmed : '';
}

export function parseBool(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value === '1' || value === 'true') return true;
  if (value === '0' || value === 'false') return false;
  return null;
}

/**
 * Lift Plugin — Timezone Cache and Date Boundary Calculations
 */

import type { SlackClient } from './types.js';
import { logger } from '../../src/utils/logger.js';

// Cache user timezones to avoid repeated API calls (userId -> { tz, expires })
const timezoneCache = new Map<string, { tz: string; expires: number }>();
const TIMEZONE_CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Get user's timezone from Slack API (cached for 1 hour)
 * Returns IANA timezone string like "America/New_York" or null if unavailable
 */
export async function getUserTimezone(userId: string, client: SlackClient): Promise<string | null> {
  // Check cache first
  const cached = timezoneCache.get(userId);
  if (cached && cached.expires > Date.now()) {
    return cached.tz;
  }

  try {
    const result = await client.users.info({ user: userId });
    const tz = result.user?.tz || null;

    if (tz) {
      timezoneCache.set(userId, { tz, expires: Date.now() + TIMEZONE_CACHE_TTL });
    }

    return tz;
  } catch (error) {
    logger.warn('Failed to get user timezone, using server time', { userId, error });
    return null;
  }
}

/**
 * Parse the UTC offset in milliseconds for a given date in a timezone.
 * Positive = east of UTC, negative = west of UTC.
 * Returns 0 if offset cannot be parsed (e.g., for UTC/GMT).
 */
export function parseTimezoneOffsetMs(date: Date, tz: string): number {
  const tzFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'shortOffset',
  });
  const tzParts = tzFormatter.formatToParts(date);
  const offsetPart = tzParts.find((p) => p.type === 'timeZoneName')?.value || '';

  const offsetMatch = offsetPart.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (offsetMatch) {
    const sign = offsetMatch[1] === '+' ? 1 : -1;
    const hours = parseInt(offsetMatch[2], 10);
    const minutes = parseInt(offsetMatch[3] || '0', 10);
    return sign * (hours * 60 + minutes) * 60 * 1000;
  }

  return 0;
}

/**
 * Get start of day in a specific timezone
 * @param tz IANA timezone string (e.g., "America/New_York")
 * @param daysAgo Number of days ago (0 = today, 1 = yesterday)
 */
export function getStartOfDayInTimezone(tz: string | null, daysAgo: number = 0): number {
  const now = new Date();

  if (!tz) {
    // Fallback to UTC date parts (server-timezone-independent)
    const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    return start - daysAgo * 24 * 60 * 60 * 1000;
  }

  // Get current date parts in user's timezone
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  // Parse the formatted date (YYYY-MM-DD format from en-CA locale)
  const parts = formatter.format(now).split('-');
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1; // JS months are 0-indexed
  const day = parseInt(parts[2], 10);

  // Create midnight UTC for the user's date, then adjust by timezone offset
  const midnightUTC = Date.UTC(year, month, day - daysAgo);

  // Get the UTC offset for that date in the target timezone
  const offsetMs = parseTimezoneOffsetMs(new Date(midnightUTC), tz);

  // Midnight in user's tz = midnight UTC - offset
  // If user is GMT-5, midnight their time = 5am UTC (midnightUTC - (-5h) = midnightUTC + 5h)
  return midnightUTC - offsetMs;
}

/**
 * Convert a Date to start of day in user's timezone
 */
export function dateToStartOfDayInTimezone(date: Date, tz: string | null): number {
  if (!tz) {
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  }

  // Get the date parts in user's timezone
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  // Format the original date in the user's timezone to get the correct date parts
  const parts = formatter.format(date).split('-');
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);

  // Create midnight UTC for that date, then adjust by timezone offset
  const midnightUTC = Date.UTC(year, month, day);
  const offsetMs = parseTimezoneOffsetMs(new Date(midnightUTC), tz);

  return midnightUTC - offsetMs;
}

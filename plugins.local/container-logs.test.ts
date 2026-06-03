/**
 * Tests for container-logs plugin
 *
 * Covers: log line parsing (ANSI stripping, timestamp parsing),
 * text filter/search over log lines, context extraction for search matches.
 */
import { describe, it, expect } from 'vitest';
import {
  stripAnsi,
  parseLogLines,
  filterLogLines,
  searchLogLines,
  parseContainerLogsCommand,
} from './container-logs.js';

// =============================================================================
// stripAnsi
// =============================================================================

describe('stripAnsi', () => {
  it('strips basic colour codes', () => {
    expect(stripAnsi('\x1b[32mhello\x1b[0m')).toBe('hello');
  });

  it('strips bold and reset codes', () => {
    expect(stripAnsi('\x1b[1mBold\x1b[0m text')).toBe('Bold text');
  });

  it('leaves plain text unchanged', () => {
    expect(stripAnsi('plain text')).toBe('plain text');
  });

  it('handles empty string', () => {
    expect(stripAnsi('')).toBe('');
  });

  it('strips multi-param codes', () => {
    expect(stripAnsi('\x1b[38;5;200mcolour\x1b[0m')).toBe('colour');
  });
});

// =============================================================================
// parseLogLines
// =============================================================================

describe('parseLogLines', () => {
  it('parses lines with docker --timestamps prefix', () => {
    const raw = '2024-01-15T10:30:00.123456789Z This is the message';
    const lines = parseLogLines(raw);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.timestamp).toBeInstanceOf(Date);
    expect(lines[0]!.timestamp.getFullYear()).toBe(2024);
    expect(lines[0]!.message).toBe('This is the message');
  });

  it('parses multiple lines', () => {
    const raw = [
      '2024-01-15T10:30:00.000Z Line one',
      '2024-01-15T10:30:01.000Z Line two',
    ].join('\n');
    const lines = parseLogLines(raw);
    expect(lines).toHaveLength(2);
    expect(lines[0]!.message).toBe('Line one');
    expect(lines[1]!.message).toBe('Line two');
  });

  it('parses lines without timestamp prefix', () => {
    const raw = 'plain log line without timestamp';
    const lines = parseLogLines(raw);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.message).toBe('plain log line without timestamp');
  });

  it('strips ANSI codes from message', () => {
    const raw = '2024-01-15T10:30:00.000Z \x1b[32mGreen message\x1b[0m';
    const lines = parseLogLines(raw);
    expect(lines[0]!.message).toBe('Green message');
  });

  it('skips blank lines', () => {
    const raw = '2024-01-15T10:30:00.000Z Line one\n\n2024-01-15T10:30:01.000Z Line two\n';
    const lines = parseLogLines(raw);
    expect(lines).toHaveLength(2);
  });

  it('returns empty array for empty input', () => {
    expect(parseLogLines('')).toEqual([]);
  });
});

// =============================================================================
// filterLogLines
// =============================================================================

describe('filterLogLines', () => {
  const lines = [
    { message: 'Server started on port 3000', timestamp: new Date() },
    { message: 'GET /health 200 OK', timestamp: new Date() },
    { message: 'ERROR: database connection failed', timestamp: new Date() },
    { message: 'GET /api/users 200 OK', timestamp: new Date() },
  ];

  it('returns all lines when filter is empty', () => {
    expect(filterLogLines(lines, '')).toHaveLength(4);
  });

  it('filters case-insensitively', () => {
    expect(filterLogLines(lines, 'error')).toHaveLength(1);
    expect(filterLogLines(lines, 'ERROR')).toHaveLength(1);
    expect(filterLogLines(lines, 'Error')).toHaveLength(1);
  });

  it('returns only matching lines', () => {
    const result = filterLogLines(lines, 'GET');
    expect(result).toHaveLength(2);
    expect(result.every((l) => l.message.includes('GET'))).toBe(true);
  });

  it('returns empty array when nothing matches', () => {
    expect(filterLogLines(lines, 'xyz-no-match')).toHaveLength(0);
  });

  it('handles empty lines array', () => {
    expect(filterLogLines([], 'anything')).toHaveLength(0);
  });
});

// =============================================================================
// searchLogLines
// =============================================================================

describe('searchLogLines', () => {
  const lines = Array.from({ length: 20 }, (_, i) => ({
    message: i === 10 ? 'ERROR: disk full' : `Normal log line ${String(i)}`,
    timestamp: new Date(),
  }));

  it('returns matching lines with context', () => {
    const results = searchLogLines(lines, 'ERROR', 2);
    expect(results.length).toBeGreaterThan(0);
    const match = results.find((r) => r.message.includes('ERROR'));
    expect(match).toBeDefined();
  });

  it('includes context lines around matches', () => {
    const results = searchLogLines(lines, 'ERROR', 2);
    // Should include lines 8-12 (2 before + match + 2 after)
    expect(results.length).toBeGreaterThanOrEqual(3);
  });

  it('returns empty array when no matches', () => {
    expect(searchLogLines(lines, 'xyz-no-match', 2)).toHaveLength(0);
  });

  it('deduplicates overlapping context windows', () => {
    // Two close matches should not duplicate shared context lines
    const twoMatches = [
      ...lines.slice(0, 5),
      { message: 'MATCH A', timestamp: new Date() },
      { message: 'MATCH B', timestamp: new Date() },
      ...lines.slice(7),
    ];
    const results = searchLogLines(twoMatches, 'MATCH', 2);
    const msgs = results.map((r) => r.message);
    // No duplicate messages
    expect(new Set(msgs).size).toBe(msgs.length);
  });

  it('handles empty lines array', () => {
    expect(searchLogLines([], 'ERROR', 2)).toHaveLength(0);
  });
});

// =============================================================================
// parseContainerLogsCommand
// =============================================================================

describe('parseContainerLogsCommand', () => {
  describe('help subcommand', () => {
    it('returns help for empty input', () => {
      expect(parseContainerLogsCommand('').subcommand).toBe('help');
    });

    it('returns help for "help"', () => {
      expect(parseContainerLogsCommand('help').subcommand).toBe('help');
    });

    it('returns help for "  " (whitespace only)', () => {
      expect(parseContainerLogsCommand('  ').subcommand).toBe('help');
    });
  });

  describe('logs subcommand (default)', () => {
    it('parses service name only — defaults to 50 lines', () => {
      const r = parseContainerLogsCommand('nginx');
      expect(r).toEqual({ subcommand: 'logs', service: 'nginx', lines: 50 });
    });

    it('parses service name with explicit line count', () => {
      const r = parseContainerLogsCommand('nginx 100');
      expect(r).toEqual({ subcommand: 'logs', service: 'nginx', lines: 100 });
    });

    it('clamps line count to 500 max', () => {
      const r = parseContainerLogsCommand('nginx 9999');
      expect(r).toEqual({ subcommand: 'logs', service: 'nginx', lines: 500 });
    });

    it('defaults to 50 when line count is 0', () => {
      const r = parseContainerLogsCommand('nginx 0');
      expect(r).toEqual({ subcommand: 'logs', service: 'nginx', lines: 50 });
    });

    it('defaults to 50 when line count is negative', () => {
      const r = parseContainerLogsCommand('nginx -5');
      expect(r).toEqual({ subcommand: 'logs', service: 'nginx', lines: 50 });
    });

    it('accepts hyphenated service names', () => {
      const r = parseContainerLogsCommand('my-service');
      expect(r).toEqual({ subcommand: 'logs', service: 'my-service', lines: 50 });
    });

    it('throws on invalid service name', () => {
      expect(() => parseContainerLogsCommand('../../etc/passwd')).toThrow();
    });

    it('throws on service name with shell metacharacters', () => {
      expect(() => parseContainerLogsCommand('nginx;rm -rf /')).toThrow();
    });
  });

  describe('tail subcommand', () => {
    it('parses tail with service name', () => {
      const r = parseContainerLogsCommand('tail nginx');
      expect(r).toEqual({ subcommand: 'tail', service: 'nginx' });
    });

    it('throws when service name is missing', () => {
      expect(() => parseContainerLogsCommand('tail')).toThrow(/service name/i);
    });

    it('throws on path traversal in service name', () => {
      expect(() => parseContainerLogsCommand('tail ../../etc/passwd')).toThrow();
    });

    it('throws on metacharacters in service name', () => {
      expect(() => parseContainerLogsCommand('tail nginx|cat /etc/shadow')).toThrow();
    });
  });

  describe('search subcommand', () => {
    it('parses search with service and single-word term', () => {
      const r = parseContainerLogsCommand('search nginx error');
      expect(r).toEqual({ subcommand: 'search', service: 'nginx', term: 'error' });
    });

    it('preserves multi-word search terms', () => {
      const r = parseContainerLogsCommand('search nginx connection refused');
      expect(r).toEqual({ subcommand: 'search', service: 'nginx', term: 'connection refused' });
    });

    it('throws when service is missing', () => {
      expect(() => parseContainerLogsCommand('search')).toThrow(/service name/i);
    });

    it('throws when term is missing', () => {
      expect(() => parseContainerLogsCommand('search nginx')).toThrow(/search term/i);
    });

    it('throws when term is whitespace only', () => {
      expect(() => parseContainerLogsCommand('search nginx   ')).toThrow(/search term/i);
    });

    it('throws on invalid service name', () => {
      expect(() => parseContainerLogsCommand('search ../evil error')).toThrow();
    });
  });
});

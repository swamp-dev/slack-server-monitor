/**
 * Tests for the container-logs plugin: command parser, log parser, and line filter.
 */
import { describe, it, expect } from 'vitest';
import { parseLogLine, parseContainerLogsCommand, filterLogLines } from './container-logs.js';

// =============================================================================
// parseLogLine
// =============================================================================

describe('parseLogLine', () => {
  it('parses a timestamped docker log line', () => {
    const line = '2024-01-15T08:30:00.123456789Z some log message here';
    const result = parseLogLine(line);
    expect(result.timestamp).toBe('2024-01-15T08:30:00.123456789Z');
    expect(result.content).toBe('some log message here');
  });

  it('handles lines without ISO timestamp prefix', () => {
    const line = 'plain log message without timestamp';
    const result = parseLogLine(line);
    expect(result.timestamp).toBe('');
    expect(result.content).toBe('plain log message without timestamp');
  });

  it('handles empty string', () => {
    const result = parseLogLine('');
    expect(result.timestamp).toBe('');
    expect(result.content).toBe('');
  });

  it('preserves multi-word content', () => {
    const line = '2024-01-15T08:30:00.000000000Z [INFO] Server started on port 8080';
    const result = parseLogLine(line);
    expect(result.content).toBe('[INFO] Server started on port 8080');
  });

  it('trims trailing whitespace from content', () => {
    const line = '2024-01-15T08:30:00.000000000Z hello   ';
    const result = parseLogLine(line);
    expect(result.content).toBe('hello');
  });
});

// =============================================================================
// parseContainerLogsCommand
// =============================================================================

describe('parseContainerLogsCommand', () => {
  describe('logs subcommand (default)', () => {
    it('parses service name only, defaults to 50 lines', () => {
      const result = parseContainerLogsCommand('nginx');
      expect(result).toEqual({ subcommand: 'logs', service: 'nginx', lines: 50 });
    });

    it('parses service name with explicit line count', () => {
      const result = parseContainerLogsCommand('nginx 100');
      expect(result).toEqual({ subcommand: 'logs', service: 'nginx', lines: 100 });
    });

    it('clamps line count to 500 max', () => {
      const result = parseContainerLogsCommand('nginx 9999');
      expect(result).toEqual({ subcommand: 'logs', service: 'nginx', lines: 500 });
    });

    it('accepts hyphenated service names', () => {
      const result = parseContainerLogsCommand('my-service');
      expect(result).toEqual({ subcommand: 'logs', service: 'my-service', lines: 50 });
    });

    it('accepts underscored service names', () => {
      const result = parseContainerLogsCommand('my_service 200');
      expect(result).toEqual({ subcommand: 'logs', service: 'my_service', lines: 200 });
    });
  });

  describe('tail subcommand', () => {
    it('parses tail with service name', () => {
      const result = parseContainerLogsCommand('tail nginx');
      expect(result).toEqual({ subcommand: 'tail', service: 'nginx' });
    });

    it('throws when service name is missing', () => {
      expect(() => parseContainerLogsCommand('tail')).toThrow(/service name is required/i);
    });
  });

  describe('search subcommand', () => {
    it('parses search with service and term', () => {
      const result = parseContainerLogsCommand('search nginx error');
      expect(result).toEqual({ subcommand: 'search', service: 'nginx', term: 'error' });
    });

    it('preserves multi-word search terms', () => {
      const result = parseContainerLogsCommand('search nginx connection refused');
      expect(result).toEqual({ subcommand: 'search', service: 'nginx', term: 'connection refused' });
    });

    it('throws when service name is missing', () => {
      expect(() => parseContainerLogsCommand('search')).toThrow(/service name is required/i);
    });

    it('throws when search term is missing', () => {
      expect(() => parseContainerLogsCommand('search nginx')).toThrow(/search term is required/i);
    });
  });

  describe('input validation', () => {
    it('throws on empty input', () => {
      expect(() => parseContainerLogsCommand('')).toThrow();
    });

    it('throws on path traversal in service name', () => {
      expect(() => parseContainerLogsCommand('../../etc/passwd')).toThrow();
    });

    it('throws on service name with shell metacharacters', () => {
      expect(() => parseContainerLogsCommand('nginx;rm -rf /')).toThrow();
    });
  });
});

// =============================================================================
// filterLogLines
// =============================================================================

describe('filterLogLines', () => {
  const lines = [
    { timestamp: '2024-01-01T00:00:00Z', content: '[INFO] Server started' },
    { timestamp: '2024-01-01T00:01:00Z', content: '[ERROR] Connection refused' },
    { timestamp: '2024-01-01T00:02:00Z', content: '[INFO] Request received from 10.0.0.1' },
    { timestamp: '2024-01-01T00:03:00Z', content: '[ERROR] Timeout after 30s' },
  ];

  it('filters lines containing the term', () => {
    const result = filterLogLines(lines, 'ERROR');
    expect(result).toHaveLength(2);
    expect(result[0]?.content).toBe('[ERROR] Connection refused');
    expect(result[1]?.content).toBe('[ERROR] Timeout after 30s');
  });

  it('is case-insensitive', () => {
    const result = filterLogLines(lines, 'error');
    expect(result).toHaveLength(2);
  });

  it('returns empty array when no matches', () => {
    const result = filterLogLines(lines, 'CRITICAL');
    expect(result).toHaveLength(0);
  });

  it('returns all lines when term is empty string', () => {
    const result = filterLogLines(lines, '');
    expect(result).toHaveLength(4);
  });

  it('searches only in content (not timestamp)', () => {
    const result = filterLogLines(lines, '2024');
    expect(result).toHaveLength(0);
  });

  it('handles empty input array', () => {
    const result = filterLogLines([], 'error');
    expect(result).toHaveLength(0);
  });

  it('matches partial words', () => {
    const result = filterLogLines(lines, 'refused');
    expect(result).toHaveLength(1);
    expect(result[0]?.content).toBe('[ERROR] Connection refused');
  });
});

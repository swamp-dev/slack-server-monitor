/**
 * Tests for docker-updates plugin parsers
 *
 * Covers: update history log parsing (JSON lines + text), Watchtower log parsing
 * for pending update detection.
 */
import { describe, it, expect } from 'vitest';
import {
  parseUpdateHistoryJson,
  parseUpdateHistoryText,
  parseUpdateHistory,
  parsePendingUpdates,
  parseImageTag,
} from './docker-updates.js';

// =============================================================================
// parseImageTag
// =============================================================================

describe('parseImageTag', () => {
  it('returns tag from standard image string', () => {
    expect(parseImageTag('nginx:1.25')).toBe('1.25');
  });

  it('returns latest when no tag', () => {
    expect(parseImageTag('nginx')).toBe('latest');
  });

  it('strips registry prefix', () => {
    expect(parseImageTag('docker.io/library/nginx:alpine')).toBe('alpine');
  });

  it('handles sha digest references', () => {
    const img = 'nginx@sha256:abc123def456';
    expect(parseImageTag(img)).toBe('sha256:abc123def456');
  });

  it('returns empty string for empty input', () => {
    expect(parseImageTag('')).toBe('');
  });
});

// =============================================================================
// parseUpdateHistoryJson
// =============================================================================

describe('parseUpdateHistoryJson', () => {
  it('parses a valid JSON lines log entry', () => {
    const line = JSON.stringify({
      ts: '2024-01-15T10:30:00Z',
      service: 'nginx',
      status: 'updated',
      from: 'sha256:aaa',
      to: 'sha256:bbb',
    });
    const result = parseUpdateHistoryJson(line);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      service: 'nginx',
      status: 'updated',
      fromImage: 'sha256:aaa',
      toImage: 'sha256:bbb',
    });
    expect(result[0]!.timestamp).toBeInstanceOf(Date);
  });

  it('parses multiple JSON lines', () => {
    const lines = [
      JSON.stringify({ ts: '2024-01-15T10:00:00Z', service: 'nginx', status: 'updated', from: 'sha256:a', to: 'sha256:b' }),
      JSON.stringify({ ts: '2024-01-15T11:00:00Z', service: 'portainer', status: 'no-change', from: 'sha256:c', to: 'sha256:c' }),
    ].join('\n');
    const result = parseUpdateHistoryJson(lines);
    expect(result).toHaveLength(2);
    expect(result[0]!.service).toBe('nginx');
    expect(result[1]!.service).toBe('portainer');
  });

  it('skips invalid JSON lines', () => {
    const lines = 'not json\n' + JSON.stringify({ ts: '2024-01-15T10:00:00Z', service: 'nginx', status: 'updated', from: 'a', to: 'b' }) + '\nalso not json';
    const result = parseUpdateHistoryJson(lines);
    expect(result).toHaveLength(1);
  });

  it('returns empty array for empty input', () => {
    expect(parseUpdateHistoryJson('')).toEqual([]);
  });

  it('returns empty array for whitespace-only input', () => {
    expect(parseUpdateHistoryJson('   \n  \n')).toEqual([]);
  });

  it('handles alternate timestamp fields (timestamp, date)', () => {
    const withTimestamp = JSON.stringify({ timestamp: '2024-01-15T10:00:00Z', service: 'app', status: 'updated', from: 'a', to: 'b' });
    const withDate = JSON.stringify({ date: '2024-01-15T10:00:00Z', service: 'app', status: 'updated', from: 'a', to: 'b' });
    expect(parseUpdateHistoryJson(withTimestamp)).toHaveLength(1);
    expect(parseUpdateHistoryJson(withDate)).toHaveLength(1);
  });

  it('skips entries missing required fields (service)', () => {
    const line = JSON.stringify({ ts: '2024-01-15T10:00:00Z', status: 'updated', from: 'a', to: 'b' });
    expect(parseUpdateHistoryJson(line)).toEqual([]);
  });
});

// =============================================================================
// parseUpdateHistoryText
// =============================================================================

describe('parseUpdateHistoryText', () => {
  it('parses ISO-prefixed "updated" lines', () => {
    const line = '2024-01-15T10:30:00Z nginx: updated sha256:aaa -> sha256:bbb';
    const result = parseUpdateHistoryText(line);
    expect(result).toHaveLength(1);
    expect(result[0]!.service).toBe('nginx');
    expect(result[0]!.status).toBe('updated');
  });

  it('parses date-prefixed lines without time', () => {
    const line = '2024-01-15 nginx updated';
    const result = parseUpdateHistoryText(line);
    expect(result).toHaveLength(1);
    expect(result[0]!.service).toBe('nginx');
  });

  it('parses lines with "no change" or "skipped" keywords', () => {
    const lines = [
      '2024-01-15T10:00:00Z nginx: no change',
      '2024-01-15T10:01:00Z portainer: skipped',
    ].join('\n');
    const result = parseUpdateHistoryText(lines);
    expect(result).toHaveLength(2);
    expect(result[0]!.status).toBe('no-change');
    expect(result[1]!.status).toBe('skipped');
  });

  it('parses lines with "failed" or "error" keywords', () => {
    const line = '2024-01-15T10:00:00Z nginx: failed to update';
    const result = parseUpdateHistoryText(line);
    expect(result).toHaveLength(1);
    expect(result[0]!.status).toBe('failed');
  });

  it('skips blank lines', () => {
    const lines = '\n2024-01-15T10:00:00Z nginx: updated\n\n';
    const result = parseUpdateHistoryText(lines);
    expect(result).toHaveLength(1);
  });

  it('returns empty array for empty input', () => {
    expect(parseUpdateHistoryText('')).toEqual([]);
  });
});

// =============================================================================
// parseUpdateHistory (format auto-detection)
// =============================================================================

describe('parseUpdateHistory', () => {
  it('auto-detects JSON lines format', () => {
    const content = JSON.stringify({ ts: '2024-01-15T10:00:00Z', service: 'nginx', status: 'updated', from: 'a', to: 'b' });
    const result = parseUpdateHistory(content);
    expect(result).toHaveLength(1);
    expect(result[0]!.service).toBe('nginx');
  });

  it('falls back to text parsing when JSON fails', () => {
    const content = '2024-01-15T10:00:00Z nginx: updated';
    const result = parseUpdateHistory(content);
    expect(result).toHaveLength(1);
    expect(result[0]!.service).toBe('nginx');
  });

  it('returns empty array for empty input', () => {
    expect(parseUpdateHistory('')).toEqual([]);
  });
});

// =============================================================================
// parsePendingUpdates (Watchtower log parsing)
// =============================================================================

describe('parsePendingUpdates', () => {
  it('parses Watchtower logrus "Found new image" format', () => {
    const logs = [
      'time="2024-01-15T10:00:00Z" level=info msg="Found new nginx image (sha256:newdigest) for /nginx" prefix=watchtower',
      'time="2024-01-15T10:00:01Z" level=info msg="Watchtower 1.7.1" prefix=watchtower',
    ].join('\n');
    const result = parsePendingUpdates(logs);
    expect(result).toHaveLength(1);
    expect(result[0]!.service).toBe('nginx');
    expect(result[0]!.newDigest).toBe('sha256:newdigest');
  });

  it('parses multiple pending updates', () => {
    const logs = [
      'time="2024-01-15T10:00:00Z" level=info msg="Found new nginx image (sha256:aaa) for /nginx" prefix=watchtower',
      'time="2024-01-15T10:00:01Z" level=info msg="Found new portainer image (sha256:bbb) for /portainer" prefix=watchtower',
    ].join('\n');
    const result = parsePendingUpdates(logs);
    expect(result).toHaveLength(2);
  });

  it('deduplicates by container name (latest detection wins)', () => {
    const logs = [
      'time="2024-01-14T10:00:00Z" level=info msg="Found new nginx image (sha256:old) for /nginx" prefix=watchtower',
      'time="2024-01-15T10:00:00Z" level=info msg="Found new nginx image (sha256:new) for /nginx" prefix=watchtower',
    ].join('\n');
    const result = parsePendingUpdates(logs);
    expect(result).toHaveLength(1);
    expect(result[0]!.newDigest).toBe('sha256:new');
  });

  it('returns empty array when no pending updates found', () => {
    const logs = [
      'time="2024-01-15T10:00:00Z" level=info msg="Watchtower 1.7.1" prefix=watchtower',
      'time="2024-01-15T10:00:01Z" level=info msg="Starting Watchtower" prefix=watchtower',
    ].join('\n');
    expect(parsePendingUpdates(logs)).toEqual([]);
  });

  it('returns empty array for empty input', () => {
    expect(parsePendingUpdates('')).toEqual([]);
  });

  it('strips leading slash from container name', () => {
    const logs = 'time="2024-01-15T10:00:00Z" level=info msg="Found new app image (sha256:abc) for /my-app" prefix=watchtower';
    const result = parsePendingUpdates(logs);
    expect(result[0]!.service).toBe('my-app');
  });

  it('handles Watchtower JSON log format', () => {
    const logs = JSON.stringify({
      level: 'info',
      msg: 'Found new nginx image (sha256:abc) for /nginx',
      time: '2024-01-15T10:00:00Z',
    });
    const result = parsePendingUpdates(logs);
    expect(result).toHaveLength(1);
    expect(result[0]!.service).toBe('nginx');
  });
});

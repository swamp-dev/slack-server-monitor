import { describe, it, expect, vi } from 'vitest';

// Mock child_process for CLI validation
vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

// Set required env vars before importing
vi.stubEnv('SLACK_BOT_TOKEN', 'xoxb-test-token');
vi.stubEnv('SLACK_APP_TOKEN', 'xapp-test-token');
vi.stubEnv('AUTHORIZED_USER_IDS', 'U12345678');

const { parseUserTokens } = await import('../../src/config/index.js');

describe('parseUserTokens', () => {
  it('should parse valid userId:token pairs', () => {
    const result = parseUserTokens('U01ABC123:abcdef0123456789,U02DEF456:9876543210fedcba');
    expect(result).toEqual([
      { userId: 'U01ABC123', token: 'abcdef0123456789' },
      { userId: 'U02DEF456', token: '9876543210fedcba' },
    ]);
  });

  it('should return empty array for empty string', () => {
    const result = parseUserTokens('');
    expect(result).toEqual([]);
  });

  it('should return empty array for undefined', () => {
    const result = parseUserTokens(undefined);
    expect(result).toEqual([]);
  });

  it('should parse a single entry', () => {
    const result = parseUserTokens('U01ABC123:abcdef0123456789');
    expect(result).toEqual([
      { userId: 'U01ABC123', token: 'abcdef0123456789' },
    ]);
  });

  it('should trim whitespace around pairs', () => {
    const result = parseUserTokens('  U01ABC123 : abcdef0123456789 , U02DEF456 : 9876543210fedcba  ');
    expect(result).toEqual([
      { userId: 'U01ABC123', token: 'abcdef0123456789' },
      { userId: 'U02DEF456', token: '9876543210fedcba' },
    ]);
  });

  it('should throw on missing colon', () => {
    expect(() => parseUserTokens('U01ABC123abcdef0123456789')).toThrow(
      'Invalid user token format'
    );
  });

  it('should throw on empty userId', () => {
    expect(() => parseUserTokens(':abcdef0123456789')).toThrow(
      'Both userId and token are required'
    );
  });

  it('should throw on empty token', () => {
    expect(() => parseUserTokens('U01ABC123:')).toThrow(
      'Both userId and token are required'
    );
  });

  it('should throw on duplicate tokens', () => {
    expect(() => parseUserTokens('U01ABC123:sametoken1234567,U02DEF456:sametoken1234567')).toThrow(
      'Duplicate token detected'
    );
  });

  it('should filter empty pairs from commas', () => {
    const result = parseUserTokens('U01ABC123:abcdef0123456789,,U02DEF456:9876543210fedcba');
    expect(result).toEqual([
      { userId: 'U01ABC123', token: 'abcdef0123456789' },
      { userId: 'U02DEF456', token: '9876543210fedcba' },
    ]);
  });

  it('should throw on duplicate userId', () => {
    expect(() => parseUserTokens('U01ABC123:token1_abcde1234,U01ABC123:token2_abcde5678')).toThrow(
      'Duplicate userId detected'
    );
  });
});

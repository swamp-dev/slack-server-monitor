import { describe, it, expect } from 'vitest';
import { parseSlackError } from '../../src/utils/slack-errors.js';

describe('parseSlackError', () => {
  describe('missing_scope errors', () => {
    it('should detect missing_scope error and suggest fix', () => {
      const error = new Error('An API error occurred: missing_scope');
      const parsed = parseSlackError(error);

      expect(parsed.type).toBe('missing_scope');
      expect(parsed.message).toContain('OAuth scope');
      expect(parsed.suggestion).toContain('api.slack.com/apps');
    });

    it('should detect missing_scope in various error formats', () => {
      const formats = [
        'missing_scope',
        'Error: missing_scope',
        'Slack API error: missing_scope needed: chat:write',
      ];

      for (const msg of formats) {
        const parsed = parseSlackError(new Error(msg));
        expect(parsed.type).toBe('missing_scope');
      }
    });
  });

  describe('rate_limited errors', () => {
    it('should detect rate_limited error', () => {
      const error = new Error('An API error occurred: rate_limited');
      const parsed = parseSlackError(error);

      expect(parsed.type).toBe('rate_limited');
      expect(parsed.message).toContain('rate limit');
      expect(parsed.suggestion).toContain('wait');
    });

    it('should handle ratelimited without underscore', () => {
      const parsed = parseSlackError(new Error('ratelimited'));
      expect(parsed.type).toBe('rate_limited');
    });
  });

  describe('not_in_channel errors', () => {
    it('should detect not_in_channel error', () => {
      const error = new Error('not_in_channel');
      const parsed = parseSlackError(error);

      expect(parsed.type).toBe('not_in_channel');
      expect(parsed.message).toContain('not in');
      expect(parsed.suggestion).toContain('invite');
    });
  });

  describe('channel_not_found errors', () => {
    it('should detect channel_not_found error', () => {
      const error = new Error('channel_not_found');
      const parsed = parseSlackError(error);

      expect(parsed.type).toBe('channel_not_found');
      expect(parsed.message).toContain('not found');
    });
  });

  describe('invalid_auth errors', () => {
    it('should detect invalid_auth error', () => {
      const error = new Error('invalid_auth');
      const parsed = parseSlackError(error);

      expect(parsed.type).toBe('invalid_auth');
      expect(parsed.message).toContain('token');
      expect(parsed.suggestion).toContain('SLACK_BOT_TOKEN');
    });

    it('should detect token_revoked error', () => {
      const parsed = parseSlackError(new Error('token_revoked'));
      expect(parsed.type).toBe('invalid_auth');
    });
  });

  describe('unknown errors', () => {
    it('should return unknown for unrecognized errors', () => {
      const error = new Error('Something completely unexpected happened');
      const parsed = parseSlackError(error);

      expect(parsed.type).toBe('unknown');
      expect(parsed.message).toBe('Something completely unexpected happened');
      expect(parsed.suggestion).toBe('');
    });

    it('should handle non-Error objects', () => {
      const parsed = parseSlackError('string error' as unknown as Error);
      expect(parsed.type).toBe('unknown');
    });
  });

  describe('formatSlackError', () => {
    it('should format error with suggestion when present', () => {
      const error = new Error('missing_scope');
      const parsed = parseSlackError(error);
      const formatted = parsed.format();

      expect(formatted).toContain(parsed.message);
      expect(formatted).toContain(parsed.suggestion);
    });

    it('should format error without suggestion when none', () => {
      const error = new Error('random error');
      const parsed = parseSlackError(error);
      const formatted = parsed.format();

      expect(formatted).toBe('random error');
    });
  });
});

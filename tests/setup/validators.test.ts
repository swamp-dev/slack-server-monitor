import { describe, it, expect } from 'vitest';
import {
  validateSlackBotToken,
  validateSlackAppToken,
  validateUserIds,
  validateChannelIds,
  validateUrl,
  validateAbsolutePath,
  generateSecret,
  checkCliExists,
} from '../../src/setup/validators.js';

describe('validators', () => {
  describe('validateSlackBotToken', () => {
    it('should accept valid xoxb- tokens', () => {
      expect(validateSlackBotToken('xoxb-1234-5678-abcdef')).toBeUndefined();
    });

    it('should reject tokens not starting with xoxb-', () => {
      expect(validateSlackBotToken('xoxp-1234')).toBe(
        'Bot token must start with xoxb-'
      );
    });

    it('should reject empty string', () => {
      expect(validateSlackBotToken('')).toBe(
        'Bot token must start with xoxb-'
      );
    });

    it('should reject xapp- tokens', () => {
      expect(validateSlackBotToken('xapp-1234')).toBe(
        'Bot token must start with xoxb-'
      );
    });
  });

  describe('validateSlackAppToken', () => {
    it('should accept valid xapp- tokens', () => {
      expect(validateSlackAppToken('xapp-1-A0B1C2-abcdef')).toBeUndefined();
    });

    it('should reject tokens not starting with xapp-', () => {
      expect(validateSlackAppToken('xoxb-1234')).toBe(
        'App token must start with xapp-'
      );
    });

    it('should reject empty string', () => {
      expect(validateSlackAppToken('')).toBe(
        'App token must start with xapp-'
      );
    });
  });

  describe('validateUserIds', () => {
    it('should accept single valid user ID', () => {
      expect(validateUserIds('U01ABC123')).toBeUndefined();
    });

    it('should accept comma-separated valid user IDs', () => {
      expect(validateUserIds('U01ABC123,U02DEF456')).toBeUndefined();
    });

    it('should accept IDs with spaces around commas', () => {
      expect(validateUserIds('U01ABC123, U02DEF456')).toBeUndefined();
    });

    it('should reject IDs not starting with U', () => {
      expect(validateUserIds('C01ABC123')).toBe(
        'Each user ID must match U[A-Z0-9]+ (e.g., U01ABC123)'
      );
    });

    it('should reject empty string', () => {
      expect(validateUserIds('')).toBe(
        'At least one user ID is required'
      );
    });

    it('should reject IDs with lowercase', () => {
      expect(validateUserIds('Uabc123')).toBe(
        'Each user ID must match U[A-Z0-9]+ (e.g., U01ABC123)'
      );
    });
  });

  describe('validateChannelIds', () => {
    it('should accept single valid channel ID', () => {
      expect(validateChannelIds('C01ABC123')).toBeUndefined();
    });

    it('should accept comma-separated valid channel IDs', () => {
      expect(validateChannelIds('C01ABC123,C02DEF456')).toBeUndefined();
    });

    it('should accept empty string (channels are optional)', () => {
      expect(validateChannelIds('')).toBeUndefined();
    });

    it('should reject IDs not starting with C', () => {
      expect(validateChannelIds('U01ABC123')).toBe(
        'Each channel ID must match C[A-Z0-9]+ (e.g., C01ABC123)'
      );
    });

    it('should reject IDs with lowercase', () => {
      expect(validateChannelIds('Cabc123')).toBe(
        'Each channel ID must match C[A-Z0-9]+ (e.g., C01ABC123)'
      );
    });
  });

  describe('validateUrl', () => {
    it('should accept valid http URL', () => {
      expect(validateUrl('http://localhost:8080')).toBeUndefined();
    });

    it('should accept valid https URL', () => {
      expect(validateUrl('https://example.com')).toBeUndefined();
    });

    it('should accept URL with hostname and port', () => {
      expect(validateUrl('http://nautilus.local:8080')).toBeUndefined();
    });

    it('should reject non-URL string', () => {
      expect(validateUrl('not-a-url')).toBe('Must be a valid URL (e.g., http://hostname:port)');
    });

    it('should reject empty string', () => {
      expect(validateUrl('')).toBe('Must be a valid URL (e.g., http://hostname:port)');
    });
  });

  describe('validateAbsolutePath', () => {
    it('should accept absolute path', () => {
      expect(validateAbsolutePath('/foo/bar')).toBeUndefined();
    });

    it('should accept root path', () => {
      expect(validateAbsolutePath('/')).toBeUndefined();
    });

    it('should reject relative path', () => {
      expect(validateAbsolutePath('foo/bar')).toBe(
        'Must be an absolute path (starting with /)'
      );
    });

    it('should reject path with ..', () => {
      expect(validateAbsolutePath('/foo/../bar')).toBe(
        'Path cannot contain ..'
      );
    });

    it('should reject empty string', () => {
      expect(validateAbsolutePath('')).toBe(
        'Must be an absolute path (starting with /)'
      );
    });
  });

  describe('generateSecret', () => {
    it('should return 32-character hex string', () => {
      const secret = generateSecret();
      expect(secret).toMatch(/^[0-9a-f]{32}$/);
    });

    it('should return unique values on each call', () => {
      const a = generateSecret();
      const b = generateSecret();
      expect(a).not.toBe(b);
    });
  });

  describe('checkCliExists', () => {
    it('should return true for a known command (node)', () => {
      expect(checkCliExists('node')).toBe(true);
    });

    it('should return false for a nonexistent command', () => {
      expect(checkCliExists('surely-does-not-exist-xyz-123')).toBe(false);
    });
  });
});

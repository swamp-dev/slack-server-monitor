import { describe, it, expect } from 'vitest';
import {
  scrubSensitiveData,
  truncateText,
  processLogsForSlack,
  countPotentialSecrets,
} from '../../src/formatters/scrub.js';

describe('scrub utilities', () => {
  describe('scrubSensitiveData', () => {
    describe('passwords', () => {
      it('should redact password= format', () => {
        expect(scrubSensitiveData('password=secret123')).toBe('password=[REDACTED]');
        expect(scrubSensitiveData('PASSWORD=secret123')).toBe('password=[REDACTED]');
        expect(scrubSensitiveData('password: secret123')).toBe('password=[REDACTED]');
      });

      it('should redact quoted passwords', () => {
        expect(scrubSensitiveData("password='secret123'")).toBe('password=[REDACTED]');
        expect(scrubSensitiveData('password="secret123"')).toBe('password=[REDACTED]');
      });

      it('should redact passwd and pwd', () => {
        expect(scrubSensitiveData('passwd=secret')).toBe('passwd=[REDACTED]');
        expect(scrubSensitiveData('pwd=secret')).toBe('pwd=[REDACTED]');
      });
    });

    describe('API keys and tokens', () => {
      it('should redact api_key formats', () => {
        expect(scrubSensitiveData('api_key=abc123')).toBe('api_key=[REDACTED]');
        expect(scrubSensitiveData('API-KEY=abc123')).toBe('api_key=[REDACTED]');
        expect(scrubSensitiveData('apikey=abc123')).toContain('[REDACTED]');
      });

      it('should redact token formats', () => {
        expect(scrubSensitiveData('token=xyz789')).toBe('token=[REDACTED]');
        expect(scrubSensitiveData('auth_token=xyz789')).toBe('auth_token=[REDACTED]');
        expect(scrubSensitiveData('access_token=xyz789')).toBe('access_token=[REDACTED]');
        expect(scrubSensitiveData('refresh_token=xyz789')).toBe('refresh_token=[REDACTED]');
      });

      it('should redact secrets', () => {
        expect(scrubSensitiveData('secret=shhh')).toBe('secret=[REDACTED]');
        expect(scrubSensitiveData('client_secret=shhh')).toBe('client_secret=[REDACTED]');
      });
    });

    describe('authorization headers', () => {
      it('should redact Bearer tokens', () => {
        const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9';
        expect(scrubSensitiveData(input)).toBe('Authorization: Bearer [REDACTED]');
      });

      it('should redact Basic auth', () => {
        const input = 'Authorization: Basic dXNlcjpwYXNz';
        expect(scrubSensitiveData(input)).toBe('Authorization: Basic [REDACTED]');
      });
    });

    describe('private keys', () => {
      it('should redact PEM format keys', () => {
        const key = `-----BEGIN RSA PRIVATE KEY-----
MIIEpQIBAAKCAQEA...
-----END RSA PRIVATE KEY-----`;
        expect(scrubSensitiveData(key)).toBe('[PRIVATE KEY REDACTED]');
      });
    });

    describe('AWS credentials', () => {
      it('should redact AWS access key ID', () => {
        expect(scrubSensitiveData('AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE'))
          .toBe('AWS_ACCESS_KEY_ID=[REDACTED]');
      });

      it('should redact AWS secret key', () => {
        expect(scrubSensitiveData('AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG'))
          .toBe('AWS_SECRET_ACCESS_KEY=[REDACTED]');
      });
    });

    describe('database connection strings', () => {
      it('should redact MySQL connection strings', () => {
        const input = 'mysql://user:password123@localhost:3306/db';
        expect(scrubSensitiveData(input)).toBe('mysql://[USER]:[REDACTED]@localhost:3306/db');
      });

      it('should redact PostgreSQL connection strings', () => {
        const input = 'postgresql://admin:secret@db.example.com/mydb';
        expect(scrubSensitiveData(input)).toBe('postgresql://[USER]:[REDACTED]@db.example.com/mydb');
      });

      it('should redact MongoDB connection strings', () => {
        const input = 'mongodb://admin:password@mongo.example.com/db';
        expect(scrubSensitiveData(input)).toBe('mongodb://[USER]:[REDACTED]@mongo.example.com/db');
      });

      it('should redact Redis connection strings', () => {
        const input = 'redis://user:pass@redis.example.com:6379';
        expect(scrubSensitiveData(input)).toBe('redis://[USER]:[REDACTED]@redis.example.com:6379');
      });

      it('should redact HTTPS URLs with credentials', () => {
        const input = 'https://user:secret@api.example.com/v1';
        expect(scrubSensitiveData(input)).toBe('https://[USER]:[REDACTED]@api.example.com/v1');
      });
    });

    describe('credit card numbers', () => {
      it('should redact credit card numbers', () => {
        expect(scrubSensitiveData('Card: 4111-1111-1111-1111')).toContain('[CARD NUMBER REDACTED]');
        expect(scrubSensitiveData('Card: 4111 1111 1111 1111')).toContain('[CARD NUMBER REDACTED]');
        expect(scrubSensitiveData('Card: 4111111111111111')).toContain('[CARD NUMBER REDACTED]');
      });
    });

    describe('SSN', () => {
      it('should redact Social Security Numbers', () => {
        expect(scrubSensitiveData('SSN: 123-45-6789')).toContain('[SSN REDACTED]');
      });
    });

    describe('edge cases', () => {
      it('should handle empty string', () => {
        expect(scrubSensitiveData('')).toBe('');
      });

      it('should handle text with no secrets', () => {
        const input = 'This is a normal log message with no secrets';
        expect(scrubSensitiveData(input)).toBe(input);
      });

      it('should handle multiple secrets in one line', () => {
        const input = 'password=secret api_key=abc123 token=xyz';
        const result = scrubSensitiveData(input);
        expect(result).toContain('password=[REDACTED]');
        expect(result).toContain('api_key=[REDACTED]');
        expect(result).toContain('token=[REDACTED]');
      });
    });
  });

  describe('truncateText', () => {
    it('should not truncate short text', () => {
      const text = 'Short text';
      expect(truncateText(text)).toBe(text);
    });

    it('should truncate long text', () => {
      const text = 'a'.repeat(3000);
      const result = truncateText(text);
      expect(result.length).toBeLessThan(3000);
      expect(result).toContain('[truncated]');
    });

    it('should use custom max length', () => {
      const text = 'a'.repeat(100);
      const result = truncateText(text, 50);
      expect(result.length).toBeLessThanOrEqual(70); // 50 + '... [truncated]'
      expect(result).toContain('[truncated]');
    });
  });

  describe('processLogsForSlack', () => {
    it('should both scrub and truncate', () => {
      const input = 'password=secret ' + 'a'.repeat(3000);
      const result = processLogsForSlack(input);
      expect(result).toContain('password=[REDACTED]');
      expect(result).toContain('[truncated]');
    });
  });

  describe('countPotentialSecrets', () => {
    it('should count secrets', () => {
      expect(countPotentialSecrets('password=x token=y')).toBe(2);
      expect(countPotentialSecrets('no secrets here')).toBe(0);
    });

    it('should handle empty string', () => {
      expect(countPotentialSecrets('')).toBe(0);
    });
  });
});

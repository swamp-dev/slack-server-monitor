import { describe, it, expect } from 'vitest';
import {
  sanitizeServiceName,
  sanitizeDomain,
  sanitizeLineCount,
  parseLogsArgs,
} from '../../src/utils/sanitize.js';

describe('sanitize utilities', () => {
  describe('sanitizeServiceName', () => {
    it('should accept valid service names', () => {
      expect(sanitizeServiceName('nginx')).toBe('nginx');
      expect(sanitizeServiceName('my-service')).toBe('my-service');
      expect(sanitizeServiceName('app_v2')).toBe('app_v2');
      expect(sanitizeServiceName('WordPress1')).toBe('WordPress1');
    });

    it('should trim whitespace', () => {
      expect(sanitizeServiceName('  nginx  ')).toBe('nginx');
    });

    it('should reject empty names', () => {
      expect(() => sanitizeServiceName('')).toThrow('Service name cannot be empty');
      expect(() => sanitizeServiceName('   ')).toThrow();
    });

    it('should reject names too long', () => {
      const longName = 'a'.repeat(64);
      expect(() => sanitizeServiceName(longName)).toThrow('too long');
    });

    it('should reject names starting with non-alphanumeric', () => {
      expect(() => sanitizeServiceName('-nginx')).toThrow();
      expect(() => sanitizeServiceName('_nginx')).toThrow();
      expect(() => sanitizeServiceName('.nginx')).toThrow();
    });

    it('should reject names with invalid characters', () => {
      expect(() => sanitizeServiceName('nginx.conf')).toThrow();
      expect(() => sanitizeServiceName('my service')).toThrow();
      expect(() => sanitizeServiceName('app@v2')).toThrow();
    });

    // SECURITY: Path traversal prevention
    // Note: The regex validation may trigger before refine checks,
    // but the important thing is that these are all rejected
    describe('path traversal prevention', () => {
      it('should reject forward slashes', () => {
        expect(() => sanitizeServiceName('nginx/conf')).toThrow();
        expect(() => sanitizeServiceName('../etc/passwd')).toThrow();
        expect(() => sanitizeServiceName('a/b/c')).toThrow();
      });

      it('should reject backslashes', () => {
        expect(() => sanitizeServiceName('nginx\\conf')).toThrow();
        expect(() => sanitizeServiceName('..\\etc\\passwd')).toThrow();
      });

      it('should reject double dots', () => {
        expect(() => sanitizeServiceName('..')).toThrow();
        expect(() => sanitizeServiceName('nginx..')).toThrow();
      });
    });
  });

  describe('sanitizeDomain', () => {
    it('should accept valid domains', () => {
      expect(sanitizeDomain('example.com')).toBe('example.com');
      expect(sanitizeDomain('sub.example.com')).toBe('sub.example.com');
      expect(sanitizeDomain('Example.COM')).toBe('example.com'); // lowercase
    });

    it('should reject invalid domains', () => {
      expect(() => sanitizeDomain('')).toThrow();
      expect(() => sanitizeDomain('example')).toThrow();
      expect(() => sanitizeDomain('.example.com')).toThrow();
    });
  });

  describe('sanitizeLineCount', () => {
    it('should return default for empty input', () => {
      expect(sanitizeLineCount(undefined)).toBe(50);
      expect(sanitizeLineCount('')).toBe(50);
      expect(sanitizeLineCount('   ')).toBe(50);
    });

    it('should parse valid numbers', () => {
      expect(sanitizeLineCount('100')).toBe(100);
      expect(sanitizeLineCount('1')).toBe(1);
      expect(sanitizeLineCount('500')).toBe(500);
    });

    it('should reject numbers over 500', () => {
      expect(() => sanitizeLineCount('501')).toThrow('Maximum 500');
      expect(() => sanitizeLineCount('1000')).toThrow('Maximum 500');
    });

    it('should reject invalid input', () => {
      expect(() => sanitizeLineCount('abc')).toThrow();
      expect(() => sanitizeLineCount('-1')).toThrow();
      expect(() => sanitizeLineCount('0')).toThrow();
      expect(() => sanitizeLineCount('1.5')).toThrow();
    });

    it('should allow custom default', () => {
      expect(sanitizeLineCount(undefined, 100)).toBe(100);
    });
  });

  describe('parseLogsArgs', () => {
    it('should parse service name only', () => {
      const result = parseLogsArgs('nginx');
      expect(result.serviceName).toBe('nginx');
      expect(result.lineCount).toBe(50);
    });

    it('should parse service name and line count', () => {
      const result = parseLogsArgs('nginx 100');
      expect(result.serviceName).toBe('nginx');
      expect(result.lineCount).toBe(100);
    });

    it('should handle multiple spaces', () => {
      const result = parseLogsArgs('nginx   200');
      expect(result.serviceName).toBe('nginx');
      expect(result.lineCount).toBe(200);
    });

    it('should require service name', () => {
      expect(() => parseLogsArgs('')).toThrow('Service name is required');
      expect(() => parseLogsArgs('   ')).toThrow('Service name is required');
    });

    it('should reject invalid service names', () => {
      expect(() => parseLogsArgs('../etc/passwd')).toThrow();
      expect(() => parseLogsArgs('nginx/conf')).toThrow();
    });

    it('should reject invalid line counts', () => {
      expect(() => parseLogsArgs('nginx 1000')).toThrow('Maximum 500');
      expect(() => parseLogsArgs('nginx abc')).toThrow();
    });
  });
});

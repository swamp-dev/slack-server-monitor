import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  checkCertificate,
  checkMultipleCertificates,
} from '../../src/executors/ssl.js';

// Mock executeCommand
vi.mock('../../src/utils/shell.js', () => ({
  executeCommand: vi.fn(),
}));

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('ssl executor', () => {
  let mockExecuteCommand: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const shell = await import('../../src/utils/shell.js');
    mockExecuteCommand = shell.executeCommand as ReturnType<typeof vi.fn>;
  });

  describe('checkCertificate', () => {
    // Mock date to make tests deterministic
    const mockNow = new Date('2024-06-15T12:00:00Z');

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(mockNow);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should parse certificate with valid expiry', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: '',
        stderr: `depth=2 C = US, O = DigiCert Inc, OU = www.digicert.com, CN = DigiCert Global Root CA
verify return:1
depth=1 C = US, O = DigiCert Inc, CN = DigiCert SHA2 Extended Validation Server CA
verify return:1
depth=0 businessCategory = Private Organization, jurisdictionC = US, jurisdictionST = California, serialNumber = C3268102, C = US, ST = California, L = San Francisco, O = Example Inc, CN = example.com
verify return:1
DONE
notAfter=Dec 15 23:59:59 2024 GMT`,
        // openssl s_client writes to stderr
      });

      const result = await checkCertificate('example.com');

      expect(result.domain).toBe('example.com');
      expect(result.valid).toBe(true);
      expect(result.expiresAt).toEqual(new Date('2024-12-15T23:59:59.000Z'));
      expect(result.daysRemaining).toBe(183); // ~6 months from June 15
      expect(result.status).toBe('ok');
    });

    it('should return warn status for expiry within 30 days', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: '',
        stderr: `verify return:1
DONE
notAfter=Jul 10 12:00:00 2024 GMT`,
      });

      const result = await checkCertificate('example.com');

      expect(result.daysRemaining).toBe(25);
      expect(result.status).toBe('warn');
    });

    it('should return error status for expiry within 7 days', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: '',
        stderr: `verify return:1
DONE
notAfter=Jun 20 12:00:00 2024 GMT`,
      });

      const result = await checkCertificate('example.com');

      expect(result.daysRemaining).toBe(5);
      expect(result.status).toBe('error');
    });

    it('should return error status for expired certificate', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: '',
        stderr: `verify return:1
DONE
notAfter=Jun 01 12:00:00 2024 GMT`,
      });

      const result = await checkCertificate('example.com');

      expect(result.daysRemaining).toBe(-14);
      expect(result.status).toBe('error');
      expect(result.valid).toBe(false);
    });

    it('should handle connection refused', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'connect: Connection refused\nconnect:errno=111',
      });

      const result = await checkCertificate('unreachable.example.com');

      expect(result.domain).toBe('unreachable.example.com');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Connection refused');
      expect(result.status).toBe('error');
    });

    it('should handle connection timeout', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'connect: Operation timed out',
      });

      const result = await checkCertificate('timeout.example.com');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('timed out');
    });

    it('should handle certificate verification failure', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: '',
        stderr: `depth=0 CN = self-signed.example.com
verify error:num=18:self-signed certificate
verify return:1
DONE
notAfter=Dec 31 23:59:59 2025 GMT`,
      });

      const result = await checkCertificate('self-signed.example.com');

      // Still parses expiry even with verification warning
      expect(result.domain).toBe('self-signed.example.com');
      expect(result.valid).toBe(true);
      expect(result.expiresAt).toBeDefined();
    });

    it('should handle unable to parse date', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: '',
        stderr: 'DONE',
      });

      const result = await checkCertificate('nodate.example.com');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Could not parse certificate expiry');
    });

    it('should handle custom port', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: '',
        stderr: `DONE
notAfter=Dec 31 23:59:59 2024 GMT`,
      });

      await checkCertificate('example.com', 8443);

      expect(mockExecuteCommand).toHaveBeenCalledWith(
        'openssl',
        expect.arrayContaining(['example.com:8443']),
        expect.any(Object)
      );
    });

    describe('domain validation (defense-in-depth)', () => {
      it('should reject empty domain', async () => {
        const result = await checkCertificate('');

        expect(result.valid).toBe(false);
        expect(result.error).toBe('Invalid domain format');
        expect(mockExecuteCommand).not.toHaveBeenCalled();
      });

      it('should reject domain with leading dot', async () => {
        const result = await checkCertificate('.example.com');

        expect(result.valid).toBe(false);
        expect(result.error).toBe('Invalid domain format');
        expect(mockExecuteCommand).not.toHaveBeenCalled();
      });

      it('should reject domain with trailing dot', async () => {
        const result = await checkCertificate('example.com.');

        expect(result.valid).toBe(false);
        expect(result.error).toBe('Invalid domain format');
        expect(mockExecuteCommand).not.toHaveBeenCalled();
      });

      it('should reject domain with consecutive dots', async () => {
        const result = await checkCertificate('example..com');

        expect(result.valid).toBe(false);
        expect(result.error).toBe('Invalid domain format');
        expect(mockExecuteCommand).not.toHaveBeenCalled();
      });

      it('should reject domain with leading hyphen in label', async () => {
        const result = await checkCertificate('-example.com');

        expect(result.valid).toBe(false);
        expect(result.error).toBe('Invalid domain format');
        expect(mockExecuteCommand).not.toHaveBeenCalled();
      });

      it('should reject domain with trailing hyphen in label', async () => {
        const result = await checkCertificate('example-.com');

        expect(result.valid).toBe(false);
        expect(result.error).toBe('Invalid domain format');
        expect(mockExecuteCommand).not.toHaveBeenCalled();
      });

      it('should reject domain exceeding 253 characters', async () => {
        const longDomain = 'a'.repeat(254);
        const result = await checkCertificate(longDomain);

        expect(result.valid).toBe(false);
        expect(result.error).toBe('Invalid domain format');
        expect(mockExecuteCommand).not.toHaveBeenCalled();
      });

      it('should reject domain with label exceeding 63 characters', async () => {
        const longLabel = 'a'.repeat(64) + '.com';
        const result = await checkCertificate(longLabel);

        expect(result.valid).toBe(false);
        expect(result.error).toBe('Invalid domain format');
        expect(mockExecuteCommand).not.toHaveBeenCalled();
      });

      it('should reject domain with special characters', async () => {
        const result = await checkCertificate('example;rm -rf /.com');

        expect(result.valid).toBe(false);
        expect(result.error).toBe('Invalid domain format');
        expect(mockExecuteCommand).not.toHaveBeenCalled();
      });

      it('should accept valid simple domain', async () => {
        mockExecuteCommand.mockResolvedValueOnce({
          exitCode: 0,
          stdout: '',
          stderr: `DONE\nnotAfter=Dec 31 23:59:59 2024 GMT`,
        });

        const result = await checkCertificate('example.com');

        expect(mockExecuteCommand).toHaveBeenCalled();
        expect(result.valid).toBe(true);
      });

      it('should accept valid domain with hyphens', async () => {
        mockExecuteCommand.mockResolvedValueOnce({
          exitCode: 0,
          stdout: '',
          stderr: `DONE\nnotAfter=Dec 31 23:59:59 2024 GMT`,
        });

        const result = await checkCertificate('my-example-site.example.com');

        expect(mockExecuteCommand).toHaveBeenCalled();
        expect(result.valid).toBe(true);
      });

      it('should accept valid domain with numbers', async () => {
        mockExecuteCommand.mockResolvedValueOnce({
          exitCode: 0,
          stdout: '',
          stderr: `DONE\nnotAfter=Dec 31 23:59:59 2024 GMT`,
        });

        const result = await checkCertificate('server01.example123.com');

        expect(mockExecuteCommand).toHaveBeenCalled();
        expect(result.valid).toBe(true);
      });
    });
  });

  describe('checkMultipleCertificates', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-06-15T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should check multiple domains', async () => {
      mockExecuteCommand
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: '',
          stderr: `DONE\nnotAfter=Dec 31 23:59:59 2024 GMT`,
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: '',
          stderr: `DONE\nnotAfter=Jun 20 12:00:00 2024 GMT`,
        })
        .mockResolvedValueOnce({
          exitCode: 1,
          stdout: '',
          stderr: 'connect: Connection refused',
        });

      const results = await checkMultipleCertificates([
        'good.example.com',
        'expiring.example.com',
        'unreachable.example.com',
      ]);

      expect(results).toHaveLength(3);
      expect(results[0].status).toBe('ok');
      expect(results[1].status).toBe('error'); // 5 days
      expect(results[2].valid).toBe(false);
    });

    it('should handle empty domain list', async () => {
      const results = await checkMultipleCertificates([]);

      expect(results).toEqual([]);
      expect(mockExecuteCommand).not.toHaveBeenCalled();
    });
  });
});

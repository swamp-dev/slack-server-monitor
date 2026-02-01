import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { App } from '@slack/bolt';

// Mock dependencies
vi.mock('../../src/executors/ssl.js', () => ({
  checkCertificate: vi.fn(),
  checkMultipleCertificates: vi.fn(),
}));

vi.mock('../../src/config/index.js', () => ({
  config: {
    server: {
      sslDomains: [],
    },
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Import after mocks
const { registerSslCommand } = await import('../../src/commands/ssl.js');
const { checkCertificate, checkMultipleCertificates } = await import(
  '../../src/executors/ssl.js'
);
const { config } = await import('../../src/config/index.js');
const { logger } = await import('../../src/utils/logger.js');

describe('/ssl command', () => {
  let mockApp: { command: ReturnType<typeof vi.fn> };
  let mockAck: ReturnType<typeof vi.fn>;
  let mockRespond: ReturnType<typeof vi.fn>;
  let commandHandler: (args: {
    command: { text: string };
    ack: () => Promise<void>;
    respond: (response: unknown) => Promise<void>;
  }) => Promise<void>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockAck = vi.fn().mockResolvedValue(undefined);
    mockRespond = vi.fn().mockResolvedValue(undefined);
    config.server.sslDomains = [];

    mockApp = {
      command: vi.fn((name: string, handler: typeof commandHandler) => {
        if (name === '/ssl') {
          commandHandler = handler;
        }
      }),
    };

    registerSslCommand(mockApp as unknown as App);
  });

  describe('domain validation', () => {
    it('should reject invalid domain format', async () => {
      await commandHandler({
        command: { text: 'not a valid domain!' },
        ack: mockAck,
        respond: mockRespond,
      });

      expect(checkCertificate).not.toHaveBeenCalled();
      expect(mockRespond).toHaveBeenCalledWith({
        blocks: expect.arrayContaining([
          expect.objectContaining({
            type: 'section',
            text: expect.objectContaining({
              text: expect.stringContaining('Invalid domain'),
            }),
          }),
        ]),
        response_type: 'ephemeral',
      });
    });

    it('should reject domain with shell metacharacters', async () => {
      await commandHandler({
        command: { text: 'example.com; rm -rf /' },
        ack: mockAck,
        respond: mockRespond,
      });

      expect(checkCertificate).not.toHaveBeenCalled();
    });

    it('should reject domain with spaces', async () => {
      await commandHandler({
        command: { text: 'example .com' },
        ack: mockAck,
        respond: mockRespond,
      });

      expect(checkCertificate).not.toHaveBeenCalled();
    });

    it('should accept valid domain', async () => {
      (checkCertificate as ReturnType<typeof vi.fn>).mockResolvedValue({
        domain: 'example.com',
        valid: true,
        status: 'ok',
        expiresAt: new Date('2025-12-31'),
        daysRemaining: 365,
      });

      await commandHandler({
        command: { text: 'example.com' },
        ack: mockAck,
        respond: mockRespond,
      });

      expect(checkCertificate).toHaveBeenCalledWith('example.com');
    });

    it('should accept subdomain', async () => {
      (checkCertificate as ReturnType<typeof vi.fn>).mockResolvedValue({
        domain: 'sub.example.com',
        valid: true,
        status: 'ok',
        expiresAt: new Date('2025-12-31'),
        daysRemaining: 365,
      });

      await commandHandler({
        command: { text: 'sub.example.com' },
        ack: mockAck,
        respond: mockRespond,
      });

      expect(checkCertificate).toHaveBeenCalledWith('sub.example.com');
    });

    it('should accept domain with hyphens', async () => {
      (checkCertificate as ReturnType<typeof vi.fn>).mockResolvedValue({
        domain: 'my-domain.example.com',
        valid: true,
        status: 'ok',
        expiresAt: new Date('2025-12-31'),
        daysRemaining: 365,
      });

      await commandHandler({
        command: { text: 'my-domain.example.com' },
        ack: mockAck,
        respond: mockRespond,
      });

      expect(checkCertificate).toHaveBeenCalledWith('my-domain.example.com');
    });
  });

  describe('single domain check', () => {
    it('should show valid certificate info', async () => {
      const expiryDate = new Date('2025-12-31');
      (checkCertificate as ReturnType<typeof vi.fn>).mockResolvedValue({
        domain: 'example.com',
        valid: true,
        status: 'ok',
        expiresAt: expiryDate,
        daysRemaining: 365,
      });

      await commandHandler({
        command: { text: 'example.com' },
        ack: mockAck,
        respond: mockRespond,
      });

      expect(mockRespond).toHaveBeenCalledWith({
        blocks: expect.arrayContaining([
          expect.objectContaining({
            type: 'header',
            text: expect.objectContaining({
              text: expect.stringContaining('example.com'),
            }),
          }),
        ]),
        response_type: 'ephemeral',
      });

      const response = mockRespond.mock.calls[0][0];
      const sectionTexts = response.blocks
        .filter((b: { type: string }) => b.type === 'section')
        .map((b: { text?: { text: string } }) => b.text?.text || '');

      expect(sectionTexts.some((t: string) => t.includes('Valid'))).toBe(true);
    });

    it('should show invalid certificate info', async () => {
      (checkCertificate as ReturnType<typeof vi.fn>).mockResolvedValue({
        domain: 'expired.com',
        valid: false,
        status: 'error',
        error: 'Certificate expired',
        expiresAt: new Date('2024-01-01'),
        daysRemaining: -30,
      });

      await commandHandler({
        command: { text: 'expired.com' },
        ack: mockAck,
        respond: mockRespond,
      });

      const response = mockRespond.mock.calls[0][0];
      const sectionTexts = response.blocks
        .filter((b: { type: string }) => b.type === 'section')
        .map((b: { text?: { text: string } }) => b.text?.text || '');

      expect(sectionTexts.some((t: string) => t.includes('expired'))).toBe(true);
    });

    it('should show warning for expiring certificate', async () => {
      (checkCertificate as ReturnType<typeof vi.fn>).mockResolvedValue({
        domain: 'expiring.com',
        valid: true,
        status: 'warn',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        daysRemaining: 7,
      });

      await commandHandler({
        command: { text: 'expiring.com' },
        ack: mockAck,
        respond: mockRespond,
      });

      expect(mockRespond).toHaveBeenCalled();
    });
  });

  describe('multi-domain check (no argument)', () => {
    it('should show message when no domains configured', async () => {
      config.server.sslDomains = [];

      await commandHandler({
        command: { text: '' },
        ack: mockAck,
        respond: mockRespond,
      });

      expect(checkMultipleCertificates).not.toHaveBeenCalled();
      expect(mockRespond).toHaveBeenCalledWith({
        blocks: expect.arrayContaining([
          expect.objectContaining({
            type: 'section',
            text: expect.objectContaining({
              text: expect.stringContaining('No domains configured'),
            }),
          }),
        ]),
        response_type: 'ephemeral',
      });
    });

    it('should check all configured domains', async () => {
      config.server.sslDomains = ['example.com', 'api.example.com'];
      (checkMultipleCertificates as ReturnType<typeof vi.fn>).mockResolvedValue([
        { domain: 'example.com', valid: true, status: 'ok', daysRemaining: 100 },
        { domain: 'api.example.com', valid: true, status: 'ok', daysRemaining: 50 },
      ]);

      await commandHandler({
        command: { text: '' },
        ack: mockAck,
        respond: mockRespond,
      });

      expect(checkMultipleCertificates).toHaveBeenCalledWith(['example.com', 'api.example.com']);
    });

    it('should display stats bar with certificate statuses', async () => {
      config.server.sslDomains = ['ok.com', 'expiring.com', 'invalid.com'];
      (checkMultipleCertificates as ReturnType<typeof vi.fn>).mockResolvedValue([
        { domain: 'ok.com', valid: true, status: 'ok', daysRemaining: 100 },
        { domain: 'expiring.com', valid: true, status: 'warn', daysRemaining: 5 },
        { domain: 'invalid.com', valid: false, status: 'error', error: 'Expired' },
      ]);

      await commandHandler({
        command: { text: '' },
        ack: mockAck,
        respond: mockRespond,
      });

      const response = mockRespond.mock.calls[0][0];
      const contextBlocks = response.blocks.filter(
        (b: { type: string }) => b.type === 'context'
      );
      const contextTexts = contextBlocks.map(
        (b: { elements?: { text: string }[] }) => b.elements?.[0]?.text || ''
      );

      // Should have stats bar with valid, expiring, issues
      expect(contextTexts.some((t: string) => t.includes('valid'))).toBe(true);
    });

    it('should sort results by status (errors first)', async () => {
      config.server.sslDomains = ['ok.com', 'error.com', 'warn.com'];
      (checkMultipleCertificates as ReturnType<typeof vi.fn>).mockResolvedValue([
        { domain: 'ok.com', valid: true, status: 'ok', daysRemaining: 100 },
        { domain: 'error.com', valid: false, status: 'error', error: 'Expired' },
        { domain: 'warn.com', valid: true, status: 'warn', daysRemaining: 5 },
      ]);

      await commandHandler({
        command: { text: '' },
        ack: mockAck,
        respond: mockRespond,
      });

      const response = mockRespond.mock.calls[0][0];
      const sectionBlocks = response.blocks.filter(
        (b: { type: string }) => b.type === 'section'
      );
      const sectionTexts = sectionBlocks.map(
        (b: { text?: { text: string } }) => b.text?.text || ''
      );

      // Find the indices of each domain in the sections
      const errorIndex = sectionTexts.findIndex((t: string) => t.includes('error.com'));
      const warnIndex = sectionTexts.findIndex((t: string) => t.includes('warn.com'));
      const okIndex = sectionTexts.findIndex((t: string) => t.includes('ok.com'));

      expect(errorIndex).toBeLessThan(warnIndex);
      expect(warnIndex).toBeLessThan(okIndex);
    });
  });

  describe('error handling', () => {
    it('should handle certificate check errors', async () => {
      (checkCertificate as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Connection refused')
      );

      await commandHandler({
        command: { text: 'example.com' },
        ack: mockAck,
        respond: mockRespond,
      });

      expect(logger.error).toHaveBeenCalledWith(
        'SSL command failed',
        expect.objectContaining({ error: 'Connection refused' })
      );
      expect(mockRespond).toHaveBeenCalledWith({
        blocks: expect.arrayContaining([
          expect.objectContaining({
            type: 'section',
            text: expect.objectContaining({
              text: expect.stringContaining('Connection refused'),
            }),
          }),
        ]),
        response_type: 'ephemeral',
      });
    });

    it('should handle multi-domain check errors', async () => {
      config.server.sslDomains = ['example.com'];
      (checkMultipleCertificates as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Network error')
      );

      await commandHandler({
        command: { text: '' },
        ack: mockAck,
        respond: mockRespond,
      });

      expect(logger.error).toHaveBeenCalled();
    });

    it('should handle non-Error exceptions', async () => {
      (checkCertificate as ReturnType<typeof vi.fn>).mockRejectedValue('string error');

      await commandHandler({
        command: { text: 'example.com' },
        ack: mockAck,
        respond: mockRespond,
      });

      expect(mockRespond).toHaveBeenCalledWith({
        blocks: expect.arrayContaining([
          expect.objectContaining({
            text: expect.objectContaining({
              text: expect.stringContaining('unexpected error'),
            }),
          }),
        ]),
        response_type: 'ephemeral',
      });
    });
  });
});

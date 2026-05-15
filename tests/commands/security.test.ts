import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { App } from '@slack/bolt';

// Mock dependencies
vi.mock('../../src/executors/security.js', () => ({
  getFail2banStatus: vi.fn(),
  getJailDetails: vi.fn(),
  isFail2banAvailable: vi.fn(),
}));

vi.mock('../../src/utils/sanitize.js', () => ({
  sanitizeServiceName: vi.fn((name: string) => name),
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
const { registerSecurityCommand } = await import('../../src/commands/security.js');
const { getFail2banStatus, getJailDetails, isFail2banAvailable } = await import(
  '../../src/executors/security.js'
);
const { sanitizeServiceName } = await import('../../src/utils/sanitize.js');
const { logger } = await import('../../src/utils/logger.js');

describe('/security command', () => {
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

    mockApp = {
      command: vi.fn((name: string, handler: typeof commandHandler) => {
        if (name === '/security') {
          commandHandler = handler;
        }
      }),
    };

    registerSecurityCommand(mockApp as unknown as App);
  });

  describe('fail2ban availability check', () => {
    it('should show message when fail2ban is not available', async () => {
      (isFail2banAvailable as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      await commandHandler({
        command: { text: '' },
        ack: mockAck,
        respond: mockRespond,
      });

      expect(mockAck).toHaveBeenCalled();
      expect(mockRespond).toHaveBeenCalledWith({
        blocks: expect.arrayContaining([
          expect.objectContaining({
            type: 'section',
            text: expect.objectContaining({
              text: expect.stringContaining('not installed'),
            }),
          }),
        ]),
        response_type: 'ephemeral',
      });
    });
  });

  describe('jail list (no arguments)', () => {
    beforeEach(() => {
      (isFail2banAvailable as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    });

    it('should show message when no jails configured', async () => {
      (getFail2banStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
        jailCount: 0,
        jails: [],
      });

      await commandHandler({
        command: { text: '' },
        ack: mockAck,
        respond: mockRespond,
      });

      expect(mockRespond).toHaveBeenCalledWith({
        blocks: expect.arrayContaining([
          expect.objectContaining({
            type: 'section',
            text: expect.objectContaining({
              text: expect.stringContaining('No fail2ban jails configured'),
            }),
          }),
        ]),
        response_type: 'ephemeral',
      });
    });

    it('should display jail list with ban counts', async () => {
      (getFail2banStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
        jailCount: 2,
        jails: ['sshd', 'nginx-http-auth'],
      });
      (getJailDetails as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          name: 'sshd',
          currentlyBanned: 5,
          totalBanned: 25,
          currentlyFailed: 2,
          totalFailed: 100,
          bannedIps: [],
          fileList: [],
        })
        .mockResolvedValueOnce({
          name: 'nginx-http-auth',
          currentlyBanned: 0,
          totalBanned: 10,
          currentlyFailed: 0,
          totalFailed: 50,
          bannedIps: [],
          fileList: [],
        });

      await commandHandler({
        command: { text: '' },
        ack: mockAck,
        respond: mockRespond,
      });

      expect(mockRespond).toHaveBeenCalledWith({
        blocks: expect.arrayContaining([
          expect.objectContaining({
            type: 'header',
            text: expect.objectContaining({
              text: 'Security Status',
            }),
          }),
        ]),
        response_type: 'ephemeral',
      });

      const response = mockRespond.mock.calls[0][0];
      const sectionTexts = response.blocks
        .filter((b: { type: string }) => b.type === 'section')
        .map((b: { text?: { text: string } }) => b.text?.text || '');

      expect(sectionTexts.some((t: string) => t.includes('sshd'))).toBe(true);
      expect(sectionTexts.some((t: string) => t.includes('nginx-http-auth'))).toBe(true);
    });

    it('should show stats bar with jail statuses', async () => {
      (getFail2banStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
        jailCount: 2,
        jails: ['sshd', 'nginx'],
      });
      (getJailDetails as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          name: 'sshd',
          currentlyBanned: 5,
          totalBanned: 25,
          currentlyFailed: 2,
          totalFailed: 100,
          bannedIps: [],
          fileList: [],
        })
        .mockResolvedValueOnce({
          name: 'nginx',
          currentlyBanned: 0,
          totalBanned: 0,
          currentlyFailed: 0,
          totalFailed: 0,
          bannedIps: [],
          fileList: [],
        });

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

      // Should show stats bar
      expect(contextTexts.some((t: string) => t.includes('quiet') || t.includes('active'))).toBe(
        true
      );
    });

    it('should handle jail details error gracefully', async () => {
      (getFail2banStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
        jailCount: 2,
        jails: ['sshd', 'broken-jail'],
      });
      (getJailDetails as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          name: 'sshd',
          currentlyBanned: 0,
          totalBanned: 0,
          currentlyFailed: 0,
          totalFailed: 0,
          bannedIps: [],
          fileList: [],
        })
        .mockRejectedValueOnce(new Error('Jail not found'));

      await commandHandler({
        command: { text: '' },
        ack: mockAck,
        respond: mockRespond,
      });

      expect(logger.error).toHaveBeenCalledWith(
        'Failed to get jail details',
        expect.objectContaining({ jail: 'broken-jail' })
      );

      const response = mockRespond.mock.calls[0][0];
      const sectionTexts = response.blocks
        .filter((b: { type: string }) => b.type === 'section')
        .map((b: { text?: { text: string } }) => b.text?.text || '');

      expect(sectionTexts.some((t: string) => t.includes('Failed to get details'))).toBe(true);
    });
  });

  describe('specific jail details', () => {
    beforeEach(() => {
      (isFail2banAvailable as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    });

    it('should show detailed jail info', async () => {
      const jailDetails = {
        name: 'sshd',
        currentlyBanned: 3,
        totalBanned: 50,
        currentlyFailed: 5,
        totalFailed: 200,
        bannedIps: ['192.168.1.100', '10.0.0.50'],
        fileList: ['/var/log/auth.log'],
      };

      (getJailDetails as ReturnType<typeof vi.fn>).mockResolvedValue(jailDetails);

      await commandHandler({
        command: { text: 'sshd' },
        ack: mockAck,
        respond: mockRespond,
      });

      expect(sanitizeServiceName).toHaveBeenCalledWith('sshd');
      expect(getJailDetails).toHaveBeenCalledWith('sshd');
      expect(mockRespond).toHaveBeenCalledWith({
        blocks: expect.arrayContaining([
          expect.objectContaining({
            type: 'header',
            text: expect.objectContaining({
              text: expect.stringContaining('sshd'),
            }),
          }),
        ]),
        response_type: 'ephemeral',
      });
    });

    it('should show banned IPs when present', async () => {
      const jailDetails = {
        name: 'sshd',
        currentlyBanned: 2,
        totalBanned: 10,
        currentlyFailed: 0,
        totalFailed: 50,
        bannedIps: ['192.168.1.100', '10.0.0.50'],
        fileList: [],
      };

      (getJailDetails as ReturnType<typeof vi.fn>).mockResolvedValue(jailDetails);

      await commandHandler({
        command: { text: 'sshd' },
        ack: mockAck,
        respond: mockRespond,
      });

      const response = mockRespond.mock.calls[0][0];
      const sectionTexts = response.blocks
        .filter((b: { type: string }) => b.type === 'section')
        .map((b: { text?: { text: string } }) => b.text?.text || '');

      expect(sectionTexts.some((t: string) => t.includes('Banned IPs'))).toBe(true);
    });

    it('should show monitored log files', async () => {
      const jailDetails = {
        name: 'sshd',
        currentlyBanned: 0,
        totalBanned: 0,
        currentlyFailed: 0,
        totalFailed: 0,
        bannedIps: [],
        fileList: ['/var/log/auth.log', '/var/log/syslog'],
      };

      (getJailDetails as ReturnType<typeof vi.fn>).mockResolvedValue(jailDetails);

      await commandHandler({
        command: { text: 'sshd' },
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

      expect(contextTexts.some((t: string) => t.includes('Log files'))).toBe(true);
    });

    it('should sanitize jail name input', async () => {
      (sanitizeServiceName as ReturnType<typeof vi.fn>).mockReturnValue('sanitized-jail');
      (getJailDetails as ReturnType<typeof vi.fn>).mockResolvedValue({
        name: 'sanitized-jail',
        currentlyBanned: 0,
        totalBanned: 0,
        currentlyFailed: 0,
        totalFailed: 0,
        bannedIps: [],
        fileList: [],
      });

      await commandHandler({
        command: { text: 'potentially-bad-input' },
        ack: mockAck,
        respond: mockRespond,
      });

      expect(sanitizeServiceName).toHaveBeenCalledWith('potentially-bad-input');
      expect(getJailDetails).toHaveBeenCalledWith('sanitized-jail');
    });
  });

  describe('error handling', () => {
    beforeEach(() => {
      (isFail2banAvailable as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    });

    it('should handle fail2ban status errors', async () => {
      (getFail2banStatus as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Permission denied')
      );

      await commandHandler({
        command: { text: '' },
        ack: mockAck,
        respond: mockRespond,
      });

      expect(logger.error).toHaveBeenCalledWith(
        'Security command failed',
        expect.objectContaining({ error: 'Permission denied' })
      );
      expect(mockRespond).toHaveBeenCalledWith({
        blocks: expect.arrayContaining([
          expect.objectContaining({
            type: 'section',
            text: expect.objectContaining({
              text: expect.stringContaining('Permission denied'),
            }),
          }),
        ]),
        response_type: 'ephemeral',
      });
    });

    it('should handle jail not found', async () => {
      (getJailDetails as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Jail not found: nonexistent')
      );

      await commandHandler({
        command: { text: 'nonexistent' },
        ack: mockAck,
        respond: mockRespond,
      });

      expect(logger.error).toHaveBeenCalled();
      expect(mockRespond).toHaveBeenCalledWith({
        blocks: expect.arrayContaining([
          expect.objectContaining({
            text: expect.objectContaining({
              text: expect.stringContaining('Jail not found'),
            }),
          }),
        ]),
        response_type: 'ephemeral',
      });
    });

    it('should handle non-Error exceptions', async () => {
      (getFail2banStatus as ReturnType<typeof vi.fn>).mockRejectedValue('string error');

      await commandHandler({
        command: { text: '' },
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

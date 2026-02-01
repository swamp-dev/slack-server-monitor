import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { App } from '@slack/bolt';

// Mock dependencies
vi.mock('../../src/executors/docker.js', () => ({
  getContainerLogs: vi.fn(),
}));

vi.mock('../../src/utils/sanitize.js', () => ({
  parseLogsArgs: vi.fn(),
}));

vi.mock('../../src/formatters/scrub.js', () => ({
  processLogsForSlack: vi.fn((logs: string) => logs),
  countPotentialSecrets: vi.fn(() => 0),
}));

vi.mock('../../src/config/index.js', () => ({
  config: {
    server: {
      maxLogLines: 500,
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
const { registerLogsCommand } = await import('../../src/commands/logs.js');
const { getContainerLogs } = await import('../../src/executors/docker.js');
const { parseLogsArgs } = await import('../../src/utils/sanitize.js');
const { processLogsForSlack, countPotentialSecrets } = await import(
  '../../src/formatters/scrub.js'
);
const { logger } = await import('../../src/utils/logger.js');

describe('/logs command', () => {
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
        if (name === '/logs') {
          commandHandler = handler;
        }
      }),
    };

    registerLogsCommand(mockApp as unknown as App);
  });

  describe('successful execution', () => {
    it('should parse arguments and get logs', async () => {
      (parseLogsArgs as ReturnType<typeof vi.fn>).mockReturnValue({
        serviceName: 'nginx',
        lineCount: 50,
      });
      (getContainerLogs as ReturnType<typeof vi.fn>).mockResolvedValue(
        '2024-01-01 Log line 1\n2024-01-01 Log line 2'
      );

      await commandHandler({
        command: { text: 'nginx' },
        ack: mockAck,
        respond: mockRespond,
      });

      expect(mockAck).toHaveBeenCalled();
      expect(parseLogsArgs).toHaveBeenCalledWith('nginx', 500);
      expect(getContainerLogs).toHaveBeenCalledWith('nginx', 50);
      expect(mockRespond).toHaveBeenCalled();
    });

    it('should display logs with header', async () => {
      (parseLogsArgs as ReturnType<typeof vi.fn>).mockReturnValue({
        serviceName: 'nginx',
        lineCount: 50,
      });
      (getContainerLogs as ReturnType<typeof vi.fn>).mockResolvedValue('Log output');

      await commandHandler({
        command: { text: 'nginx' },
        ack: mockAck,
        respond: mockRespond,
      });

      expect(mockRespond).toHaveBeenCalledWith({
        blocks: expect.arrayContaining([
          expect.objectContaining({
            type: 'header',
            text: expect.objectContaining({
              text: expect.stringContaining('nginx'),
            }),
          }),
        ]),
        response_type: 'ephemeral',
      });
    });

    it('should enforce maximum line count', async () => {
      (parseLogsArgs as ReturnType<typeof vi.fn>).mockReturnValue({
        serviceName: 'nginx',
        lineCount: 1000, // Over max
      });
      (getContainerLogs as ReturnType<typeof vi.fn>).mockResolvedValue('Logs');

      await commandHandler({
        command: { text: 'nginx 1000' },
        ack: mockAck,
        respond: mockRespond,
      });

      expect(getContainerLogs).toHaveBeenCalledWith('nginx', 500); // Capped at max
    });

    it('should process logs through scrubber', async () => {
      (parseLogsArgs as ReturnType<typeof vi.fn>).mockReturnValue({
        serviceName: 'nginx',
        lineCount: 50,
      });
      (getContainerLogs as ReturnType<typeof vi.fn>).mockResolvedValue(
        'password=secret123'
      );
      (processLogsForSlack as ReturnType<typeof vi.fn>).mockReturnValue(
        'password=[REDACTED]'
      );

      await commandHandler({
        command: { text: 'nginx' },
        ack: mockAck,
        respond: mockRespond,
      });

      expect(processLogsForSlack).toHaveBeenCalledWith('password=secret123');
    });

    it('should show warning about sensitive information', async () => {
      (parseLogsArgs as ReturnType<typeof vi.fn>).mockReturnValue({
        serviceName: 'nginx',
        lineCount: 50,
      });
      (getContainerLogs as ReturnType<typeof vi.fn>).mockResolvedValue('Logs');

      await commandHandler({
        command: { text: 'nginx' },
        ack: mockAck,
        respond: mockRespond,
      });

      const response = mockRespond.mock.calls[0][0];
      // Warning is a context block, not a section
      const contextBlocks = response.blocks.filter(
        (b: { type: string }) => b.type === 'context'
      );
      const contextTexts = contextBlocks.map(
        (b: { elements?: { text: string }[] }) => b.elements?.[0]?.text || ''
      );

      expect(contextTexts.some((t: string) => t.includes('sensitive'))).toBe(true);
    });

    it('should show secret count when secrets are detected', async () => {
      (parseLogsArgs as ReturnType<typeof vi.fn>).mockReturnValue({
        serviceName: 'nginx',
        lineCount: 50,
      });
      (getContainerLogs as ReturnType<typeof vi.fn>).mockResolvedValue('Logs with secrets');
      (countPotentialSecrets as ReturnType<typeof vi.fn>).mockReturnValue(3);

      await commandHandler({
        command: { text: 'nginx' },
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

      expect(contextTexts.some((t: string) => t.includes('3'))).toBe(true);
      expect(contextTexts.some((t: string) => t.includes('secret'))).toBe(true);
    });

    it('should show line count in response', async () => {
      (parseLogsArgs as ReturnType<typeof vi.fn>).mockReturnValue({
        serviceName: 'nginx',
        lineCount: 100,
      });
      (getContainerLogs as ReturnType<typeof vi.fn>).mockResolvedValue('Logs');

      await commandHandler({
        command: { text: 'nginx 100' },
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

      expect(contextTexts.some((t: string) => t.includes('100'))).toBe(true);
    });

    it('should handle empty logs', async () => {
      (parseLogsArgs as ReturnType<typeof vi.fn>).mockReturnValue({
        serviceName: 'nginx',
        lineCount: 50,
      });
      (getContainerLogs as ReturnType<typeof vi.fn>).mockResolvedValue('');
      (processLogsForSlack as ReturnType<typeof vi.fn>).mockReturnValue('');

      await commandHandler({
        command: { text: 'nginx' },
        ack: mockAck,
        respond: mockRespond,
      });

      const response = mockRespond.mock.calls[0][0];
      const hasEmptyMessage = response.blocks.some(
        (b: { type: string; text?: { text: string } }) =>
          b.type === 'section' && b.text?.text?.includes('no output')
      );

      expect(hasEmptyMessage).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should handle parse errors', async () => {
      (parseLogsArgs as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('Service name required');
      });

      await commandHandler({
        command: { text: '' },
        ack: mockAck,
        respond: mockRespond,
      });

      expect(logger.error).toHaveBeenCalledWith(
        'Logs command failed',
        expect.objectContaining({ error: 'Service name required' })
      );
      expect(mockRespond).toHaveBeenCalledWith({
        blocks: expect.arrayContaining([
          expect.objectContaining({
            type: 'section',
            text: expect.objectContaining({
              text: expect.stringContaining('Service name required'),
            }),
          }),
        ]),
        response_type: 'ephemeral',
      });
    });

    it('should handle container not found', async () => {
      (parseLogsArgs as ReturnType<typeof vi.fn>).mockReturnValue({
        serviceName: 'nonexistent',
        lineCount: 50,
      });
      (getContainerLogs as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Container not found')
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
              text: expect.stringContaining('Container not found'),
            }),
          }),
        ]),
        response_type: 'ephemeral',
      });
    });

    it('should handle non-Error exceptions', async () => {
      (parseLogsArgs as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw 'string error';
      });

      await commandHandler({
        command: { text: 'nginx' },
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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { App } from '@slack/bolt';

// Mock dependencies
vi.mock('../../src/executors/pm2.js', () => ({
  getPm2ProcessList: vi.fn(),
  isPm2Available: vi.fn(),
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
const { registerPm2Command } = await import('../../src/commands/pm2.js');
const { getPm2ProcessList, isPm2Available } = await import('../../src/executors/pm2.js');
const { logger } = await import('../../src/utils/logger.js');

describe('/pm2 command', () => {
  let mockApp: { command: ReturnType<typeof vi.fn> };
  let mockAck: ReturnType<typeof vi.fn>;
  let mockRespond: ReturnType<typeof vi.fn>;
  let commandHandler: (args: {
    ack: () => Promise<void>;
    respond: (response: unknown) => Promise<void>;
  }) => Promise<void>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockAck = vi.fn().mockResolvedValue(undefined);
    mockRespond = vi.fn().mockResolvedValue(undefined);

    mockApp = {
      command: vi.fn((name: string, handler: typeof commandHandler) => {
        if (name === '/pm2') {
          commandHandler = handler;
        }
      }),
    };

    registerPm2Command(mockApp as unknown as App);
  });

  describe('PM2 availability check', () => {
    it('should show message when PM2 is not available', async () => {
      (isPm2Available as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      await commandHandler({
        ack: mockAck,
        respond: mockRespond,
      });

      expect(mockAck).toHaveBeenCalled();
      expect(getPm2ProcessList).not.toHaveBeenCalled();
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

  describe('no processes running', () => {
    it('should show message when no processes are running', async () => {
      (isPm2Available as ReturnType<typeof vi.fn>).mockResolvedValue(true);
      (getPm2ProcessList as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await commandHandler({
        ack: mockAck,
        respond: mockRespond,
      });

      expect(mockRespond).toHaveBeenCalledWith({
        blocks: expect.arrayContaining([
          expect.objectContaining({
            type: 'section',
            text: expect.objectContaining({
              text: expect.stringContaining('No PM2 processes'),
            }),
          }),
        ]),
        response_type: 'ephemeral',
      });
    });
  });

  describe('process list display', () => {
    beforeEach(() => {
      (isPm2Available as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    });

    it('should display PM2 processes', async () => {
      const mockProcesses = [
        {
          name: 'api-server',
          status: 'online',
          cpu: 5.5,
          memory: 1024 * 1024 * 50, // 50MB
          uptime: Date.now() - 3600000, // 1 hour ago
          restarts: 0,
          mode: 'fork',
          instances: 1,
        },
      ];

      (getPm2ProcessList as ReturnType<typeof vi.fn>).mockResolvedValue(mockProcesses);

      await commandHandler({
        ack: mockAck,
        respond: mockRespond,
      });

      expect(mockRespond).toHaveBeenCalledWith({
        blocks: expect.arrayContaining([
          expect.objectContaining({
            type: 'header',
            text: expect.objectContaining({
              text: 'PM2 Status',
            }),
          }),
        ]),
        response_type: 'ephemeral',
      });

      const response = mockRespond.mock.calls[0][0];
      const sectionTexts = response.blocks
        .filter((b: { type: string }) => b.type === 'section')
        .map((b: { text?: { text: string } }) => b.text?.text || '');

      expect(sectionTexts.some((t: string) => t.includes('api-server'))).toBe(true);
    });

    it('should show stats bar with status counts', async () => {
      const mockProcesses = [
        { name: 'online1', status: 'online', cpu: 0, memory: 0, uptime: Date.now(), restarts: 0, mode: 'fork', instances: 1 },
        { name: 'online2', status: 'online', cpu: 0, memory: 0, uptime: Date.now(), restarts: 0, mode: 'fork', instances: 1 },
        { name: 'stopped1', status: 'stopped', cpu: 0, memory: 0, uptime: 0, restarts: 0, mode: 'fork', instances: 1 },
        { name: 'errored1', status: 'errored', cpu: 0, memory: 0, uptime: 0, restarts: 5, mode: 'fork', instances: 1 },
      ];

      (getPm2ProcessList as ReturnType<typeof vi.fn>).mockResolvedValue(mockProcesses);

      await commandHandler({
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

      // Should have stats bar
      expect(contextTexts.some((t: string) => t.includes('online'))).toBe(true);
    });

    it('should display cluster mode with instance count', async () => {
      const mockProcesses = [
        {
          name: 'cluster-app',
          status: 'online',
          cpu: 10,
          memory: 1024 * 1024 * 100,
          uptime: Date.now() - 3600000,
          restarts: 0,
          mode: 'cluster',
          instances: 4,
        },
      ];

      (getPm2ProcessList as ReturnType<typeof vi.fn>).mockResolvedValue(mockProcesses);

      await commandHandler({
        ack: mockAck,
        respond: mockRespond,
      });

      const response = mockRespond.mock.calls[0][0];
      const sectionTexts = response.blocks
        .filter((b: { type: string }) => b.type === 'section')
        .map((b: { text?: { text: string } }) => b.text?.text || '');

      expect(sectionTexts.some((t: string) => t.includes('4 instances'))).toBe(true);
    });

    it('should show process details (uptime, memory, CPU)', async () => {
      const mockProcesses = [
        {
          name: 'app',
          status: 'online',
          cpu: 25.5,
          memory: 1024 * 1024 * 256, // 256MB
          uptime: Date.now() - 86400000, // 1 day ago
          restarts: 2,
          mode: 'fork',
          instances: 1,
        },
      ];

      (getPm2ProcessList as ReturnType<typeof vi.fn>).mockResolvedValue(mockProcesses);

      await commandHandler({
        ack: mockAck,
        respond: mockRespond,
      });

      const response = mockRespond.mock.calls[0][0];
      const sectionTexts = response.blocks
        .filter((b: { type: string }) => b.type === 'section')
        .map((b: { text?: { text: string } }) => b.text?.text || '');

      // Should show uptime, memory, CPU
      const appSection = sectionTexts.find((t: string) => t.includes('app'));
      expect(appSection).toBeDefined();
      expect(appSection).toContain('Uptime');
      expect(appSection).toContain('Memory');
      expect(appSection).toContain('CPU');
    });

    it('should show N/A for stopped process uptime', async () => {
      const mockProcesses = [
        {
          name: 'stopped-app',
          status: 'stopped',
          cpu: 0,
          memory: 0,
          uptime: 0,
          restarts: 0,
          mode: 'fork',
          instances: 1,
        },
      ];

      (getPm2ProcessList as ReturnType<typeof vi.fn>).mockResolvedValue(mockProcesses);

      await commandHandler({
        ack: mockAck,
        respond: mockRespond,
      });

      const response = mockRespond.mock.calls[0][0];
      const sectionTexts = response.blocks
        .filter((b: { type: string }) => b.type === 'section')
        .map((b: { text?: { text: string } }) => b.text?.text || '');

      const appSection = sectionTexts.find((t: string) => t.includes('stopped-app'));
      expect(appSection).toContain('N/A');
    });

    it('should show high restart warning', async () => {
      const mockProcesses = [
        {
          name: 'unstable-app',
          status: 'online',
          cpu: 5,
          memory: 1024 * 1024 * 50,
          uptime: Date.now() - 3600000,
          restarts: 15,
          mode: 'fork',
          instances: 1,
        },
      ];

      (getPm2ProcessList as ReturnType<typeof vi.fn>).mockResolvedValue(mockProcesses);

      await commandHandler({
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

      expect(contextTexts.some((t: string) => t.includes('10+ restarts'))).toBe(true);
    });

    it('should order processes by status (online first, then errored, then stopped)', async () => {
      const mockProcesses = [
        { name: 'stopped1', status: 'stopped', cpu: 0, memory: 0, uptime: 0, restarts: 0, mode: 'fork', instances: 1 },
        { name: 'online1', status: 'online', cpu: 0, memory: 0, uptime: Date.now(), restarts: 0, mode: 'fork', instances: 1 },
        { name: 'errored1', status: 'errored', cpu: 0, memory: 0, uptime: 0, restarts: 5, mode: 'fork', instances: 1 },
      ];

      (getPm2ProcessList as ReturnType<typeof vi.fn>).mockResolvedValue(mockProcesses);

      await commandHandler({
        ack: mockAck,
        respond: mockRespond,
      });

      const response = mockRespond.mock.calls[0][0];
      const sectionTexts = response.blocks
        .filter((b: { type: string }) => b.type === 'section')
        .map((b: { text?: { text: string } }) => b.text?.text || '');

      // Find indices
      const onlineIndex = sectionTexts.findIndex((t: string) => t.includes('online1'));
      const erroredIndex = sectionTexts.findIndex((t: string) => t.includes('errored1'));
      const stoppedIndex = sectionTexts.findIndex((t: string) => t.includes('stopped1'));

      expect(onlineIndex).toBeLessThan(erroredIndex);
      expect(erroredIndex).toBeLessThan(stoppedIndex);
    });
  });

  describe('error handling', () => {
    beforeEach(() => {
      (isPm2Available as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    });

    it('should handle process list errors', async () => {
      (getPm2ProcessList as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('PM2 daemon not running')
      );

      await commandHandler({
        ack: mockAck,
        respond: mockRespond,
      });

      expect(logger.error).toHaveBeenCalledWith(
        'PM2 command failed',
        expect.objectContaining({ error: 'PM2 daemon not running' })
      );
      expect(mockRespond).toHaveBeenCalledWith({
        blocks: expect.arrayContaining([
          expect.objectContaining({
            type: 'section',
            text: expect.objectContaining({
              text: expect.stringContaining('PM2 daemon not running'),
            }),
          }),
        ]),
        response_type: 'ephemeral',
      });
    });

    it('should handle non-Error exceptions', async () => {
      (getPm2ProcessList as ReturnType<typeof vi.fn>).mockRejectedValue('string error');

      await commandHandler({
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

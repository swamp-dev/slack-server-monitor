import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { App } from '@slack/bolt';

// Mock dependencies
vi.mock('../../src/executors/system.js', () => ({
  getSystemResources: vi.fn(),
  getDiskUsage: vi.fn(),
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
const { registerResourcesCommand, registerDiskCommand } = await import(
  '../../src/commands/resources.js'
);
const { getSystemResources, getDiskUsage } = await import('../../src/executors/system.js');
const { logger } = await import('../../src/utils/logger.js');

describe('/resources command', () => {
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
        if (name === '/resources') {
          commandHandler = handler;
        }
      }),
    };

    registerResourcesCommand(mockApp as unknown as App);
  });

  describe('successful execution', () => {
    const mockResources = {
      cpu: { model: 'Intel Core i7', cores: 4 },
      memory: {
        total: 16384,
        used: 8192,
        available: 8192,
        percentUsed: 50,
        bufferCache: 2048,
      },
      swap: { total: 8192, used: 1024, percentUsed: 12.5 },
      loadAverage: [1.5, 1.2, 1.0],
      uptime: '5 days',
      uptimeSeconds: 432000,
      processes: { total: 150, running: 5, zombie: 0 },
    };

    it('should display system resources', async () => {
      (getSystemResources as ReturnType<typeof vi.fn>).mockResolvedValue(mockResources);

      await commandHandler({
        ack: mockAck,
        respond: mockRespond,
      });

      expect(mockAck).toHaveBeenCalled();
      expect(getSystemResources).toHaveBeenCalled();
      expect(mockRespond).toHaveBeenCalledWith({
        blocks: expect.arrayContaining([
          expect.objectContaining({
            type: 'header',
            text: expect.objectContaining({
              text: 'System Resources',
            }),
          }),
        ]),
        response_type: 'ephemeral',
      });
    });

    it('should show CPU information', async () => {
      (getSystemResources as ReturnType<typeof vi.fn>).mockResolvedValue(mockResources);

      await commandHandler({
        ack: mockAck,
        respond: mockRespond,
      });

      const response = mockRespond.mock.calls[0][0];
      const sectionTexts = response.blocks
        .filter((b: { type: string }) => b.type === 'section')
        .map((b: { text?: { text: string } }) => b.text?.text || '');

      expect(sectionTexts.some((t: string) => t.includes('CPU Load'))).toBe(true);
      expect(sectionTexts.some((t: string) => t.includes('Intel Core i7'))).toBe(true);
    });

    it('should show memory information', async () => {
      (getSystemResources as ReturnType<typeof vi.fn>).mockResolvedValue(mockResources);

      await commandHandler({
        ack: mockAck,
        respond: mockRespond,
      });

      const response = mockRespond.mock.calls[0][0];
      const sectionTexts = response.blocks
        .filter((b: { type: string }) => b.type === 'section')
        .map((b: { text?: { text: string } }) => b.text?.text || '');

      expect(sectionTexts.some((t: string) => t.includes('Memory'))).toBe(true);
    });

    it('should show swap information', async () => {
      (getSystemResources as ReturnType<typeof vi.fn>).mockResolvedValue(mockResources);

      await commandHandler({
        ack: mockAck,
        respond: mockRespond,
      });

      const response = mockRespond.mock.calls[0][0];
      const sectionTexts = response.blocks
        .filter((b: { type: string }) => b.type === 'section')
        .map((b: { text?: { text: string } }) => b.text?.text || '');

      expect(sectionTexts.some((t: string) => t.includes('Swap'))).toBe(true);
    });

    it('should show load average details', async () => {
      (getSystemResources as ReturnType<typeof vi.fn>).mockResolvedValue(mockResources);

      await commandHandler({
        ack: mockAck,
        respond: mockRespond,
      });

      const response = mockRespond.mock.calls[0][0];
      const sectionTexts = response.blocks
        .filter((b: { type: string }) => b.type === 'section')
        .map((b: { text?: { text: string } }) => b.text?.text || '');

      expect(sectionTexts.some((t: string) => t.includes('Load Average'))).toBe(true);
    });

    it('should warn when load exceeds cores', async () => {
      const overloadedResources = {
        ...mockResources,
        loadAverage: [5.0, 4.5, 4.0], // Load > 4 cores
      };

      (getSystemResources as ReturnType<typeof vi.fn>).mockResolvedValue(overloadedResources);

      await commandHandler({
        ack: mockAck,
        respond: mockRespond,
      });

      const response = mockRespond.mock.calls[0][0];
      const sectionTexts = response.blocks
        .filter((b: { type: string }) => b.type === 'section')
        .map((b: { text?: { text: string } }) => b.text?.text || '');

      expect(sectionTexts.some((t: string) => t.includes('exceeds'))).toBe(true);
    });

    it('should show zombie process warning when present', async () => {
      const resourcesWithZombies = {
        ...mockResources,
        processes: { total: 150, running: 5, zombie: 3 },
      };

      (getSystemResources as ReturnType<typeof vi.fn>).mockResolvedValue(resourcesWithZombies);

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

      expect(contextTexts.some((t: string) => t.includes('zombie'))).toBe(true);
    });

    it('should handle no swap configured', async () => {
      const noSwapResources = {
        ...mockResources,
        swap: { total: 0, used: 0, percentUsed: 0 },
      };

      (getSystemResources as ReturnType<typeof vi.fn>).mockResolvedValue(noSwapResources);

      await commandHandler({
        ack: mockAck,
        respond: mockRespond,
      });

      const response = mockRespond.mock.calls[0][0];
      const sectionTexts = response.blocks
        .filter((b: { type: string }) => b.type === 'section')
        .map((b: { text?: { text: string } }) => b.text?.text || '');

      expect(sectionTexts.some((t: string) => t.includes('Not configured'))).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should handle executor errors gracefully', async () => {
      (getSystemResources as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Failed to get system resources')
      );

      await commandHandler({
        ack: mockAck,
        respond: mockRespond,
      });

      expect(logger.error).toHaveBeenCalledWith(
        'Resources command failed',
        expect.objectContaining({ error: 'Failed to get system resources' })
      );
      expect(mockRespond).toHaveBeenCalledWith({
        blocks: expect.arrayContaining([
          expect.objectContaining({
            type: 'section',
          }),
        ]),
        response_type: 'ephemeral',
      });
    });
  });
});

describe('/disk command', () => {
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
        if (name === '/disk') {
          commandHandler = handler;
        }
      }),
    };

    registerDiskCommand(mockApp as unknown as App);
  });

  describe('successful execution', () => {
    const mockMounts = [
      {
        mountPoint: '/',
        size: '100G',
        used: '50G',
        available: '50G',
        percentUsed: 50,
      },
      {
        mountPoint: '/home',
        size: '500G',
        used: '250G',
        available: '250G',
        percentUsed: 50,
      },
    ];

    it('should display disk usage', async () => {
      (getDiskUsage as ReturnType<typeof vi.fn>).mockResolvedValue(mockMounts);

      await commandHandler({
        ack: mockAck,
        respond: mockRespond,
      });

      expect(mockAck).toHaveBeenCalled();
      expect(getDiskUsage).toHaveBeenCalled();
      expect(mockRespond).toHaveBeenCalledWith({
        blocks: expect.arrayContaining([
          expect.objectContaining({
            type: 'header',
            text: expect.objectContaining({
              text: 'Disk Usage',
            }),
          }),
        ]),
        response_type: 'ephemeral',
      });
    });

    it('should show mount count', async () => {
      (getDiskUsage as ReturnType<typeof vi.fn>).mockResolvedValue(mockMounts);

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

      expect(contextTexts.some((t: string) => t.includes('2 mount'))).toBe(true);
    });

    it('should show stats bar with health summary', async () => {
      const mixedMounts = [
        { mountPoint: '/', size: '100G', used: '50G', available: '50G', percentUsed: 50 },
        { mountPoint: '/home', size: '100G', used: '80G', available: '20G', percentUsed: 80 },
        { mountPoint: '/var', size: '100G', used: '95G', available: '5G', percentUsed: 95 },
      ];

      (getDiskUsage as ReturnType<typeof vi.fn>).mockResolvedValue(mixedMounts);

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

      // Should have stats with healthy, warning, critical
      expect(contextTexts.some((t: string) => t.includes('healthy'))).toBe(true);
    });

    it('should handle empty mounts list', async () => {
      (getDiskUsage as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await commandHandler({
        ack: mockAck,
        respond: mockRespond,
      });

      const response = mockRespond.mock.calls[0][0];
      const sectionTexts = response.blocks
        .filter((b: { type: string }) => b.type === 'section')
        .map((b: { text?: { text: string } }) => b.text?.text || '');

      expect(sectionTexts.some((t: string) => t.includes('No disk mounts found'))).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should handle executor errors gracefully', async () => {
      (getDiskUsage as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Failed to get disk usage')
      );

      await commandHandler({
        ack: mockAck,
        respond: mockRespond,
      });

      expect(logger.error).toHaveBeenCalledWith(
        'Disk command failed',
        expect.objectContaining({ error: 'Failed to get disk usage' })
      );
    });
  });
});

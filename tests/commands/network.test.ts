import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { App } from '@slack/bolt';

// Mock dependencies
vi.mock('../../src/executors/docker.js', () => ({
  getNetworkList: vi.fn(),
  getContainerStatus: vi.fn(),
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
const { registerNetworkCommand } = await import('../../src/commands/network.js');
const { getNetworkList, getContainerStatus } = await import('../../src/executors/docker.js');
const { logger } = await import('../../src/utils/logger.js');

describe('/network command', () => {
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
        if (name === '/network') {
          commandHandler = handler;
        }
      }),
    };

    registerNetworkCommand(mockApp as unknown as App);
  });

  describe('successful execution', () => {
    const mockNetworks = [
      { id: 'abc123', name: 'bridge', driver: 'bridge', scope: 'local' },
      { id: 'def456', name: 'custom_net', driver: 'overlay', scope: 'swarm' },
    ];

    const mockContainers = [
      {
        id: '1',
        name: 'nginx',
        image: 'nginx',
        status: 'Up',
        state: 'running',
        ports: '80/tcp, 443/tcp',
        created: '',
      },
      {
        id: '2',
        name: 'redis',
        image: 'redis',
        status: 'Exited',
        state: 'exited',
        ports: '',
        created: '',
      },
    ];

    it('should fetch networks and containers in parallel', async () => {
      (getNetworkList as ReturnType<typeof vi.fn>).mockResolvedValue(mockNetworks);
      (getContainerStatus as ReturnType<typeof vi.fn>).mockResolvedValue(mockContainers);

      await commandHandler({
        ack: mockAck,
        respond: mockRespond,
      });

      expect(mockAck).toHaveBeenCalled();
      expect(getNetworkList).toHaveBeenCalled();
      expect(getContainerStatus).toHaveBeenCalled();
    });

    it('should display network overview header', async () => {
      (getNetworkList as ReturnType<typeof vi.fn>).mockResolvedValue(mockNetworks);
      (getContainerStatus as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await commandHandler({
        ack: mockAck,
        respond: mockRespond,
      });

      expect(mockRespond).toHaveBeenCalledWith({
        blocks: expect.arrayContaining([
          expect.objectContaining({
            type: 'header',
            text: expect.objectContaining({
              text: 'Network Overview',
            }),
          }),
        ]),
        response_type: 'ephemeral',
      });
    });

    it('should show Docker Networks section', async () => {
      (getNetworkList as ReturnType<typeof vi.fn>).mockResolvedValue(mockNetworks);
      (getContainerStatus as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await commandHandler({
        ack: mockAck,
        respond: mockRespond,
      });

      const response = mockRespond.mock.calls[0][0];
      const sectionTexts = response.blocks
        .filter((b: { type: string }) => b.type === 'section')
        .map((b: { text?: { text: string } }) => b.text?.text || '');

      expect(sectionTexts.some((t: string) => t.includes('Docker Networks'))).toBe(true);
    });

    it('should display network details', async () => {
      (getNetworkList as ReturnType<typeof vi.fn>).mockResolvedValue(mockNetworks);
      (getContainerStatus as ReturnType<typeof vi.fn>).mockResolvedValue([]);

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

      expect(contextTexts.some((t: string) => t.includes('bridge'))).toBe(true);
      expect(contextTexts.some((t: string) => t.includes('custom_net'))).toBe(true);
    });

    it('should show Port Mappings section for running containers', async () => {
      (getNetworkList as ReturnType<typeof vi.fn>).mockResolvedValue(mockNetworks);
      (getContainerStatus as ReturnType<typeof vi.fn>).mockResolvedValue(mockContainers);

      await commandHandler({
        ack: mockAck,
        respond: mockRespond,
      });

      const response = mockRespond.mock.calls[0][0];
      const sectionTexts = response.blocks
        .filter((b: { type: string }) => b.type === 'section')
        .map((b: { text?: { text: string } }) => b.text?.text || '');

      expect(sectionTexts.some((t: string) => t.includes('Port Mappings'))).toBe(true);
    });

    it('should display container port mappings', async () => {
      (getNetworkList as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (getContainerStatus as ReturnType<typeof vi.fn>).mockResolvedValue(mockContainers);

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

      expect(contextTexts.some((t: string) => t.includes('nginx'))).toBe(true);
      expect(contextTexts.some((t: string) => t.includes('80/tcp'))).toBe(true);
    });

    it('should not show Port Mappings when no running containers have ports', async () => {
      const containersWithoutPorts = [
        {
          id: '1',
          name: 'nginx',
          image: 'nginx',
          status: 'Up',
          state: 'running',
          ports: '', // No ports
          created: '',
        },
      ];

      (getNetworkList as ReturnType<typeof vi.fn>).mockResolvedValue(mockNetworks);
      (getContainerStatus as ReturnType<typeof vi.fn>).mockResolvedValue(containersWithoutPorts);

      await commandHandler({
        ack: mockAck,
        respond: mockRespond,
      });

      const response = mockRespond.mock.calls[0][0];
      const sectionTexts = response.blocks
        .filter((b: { type: string }) => b.type === 'section')
        .map((b: { text?: { text: string } }) => b.text?.text || '');

      expect(sectionTexts.some((t: string) => t.includes('Port Mappings'))).toBe(false);
    });

    it('should not show Port Mappings for stopped containers', async () => {
      const stoppedContainers = [
        {
          id: '1',
          name: 'nginx',
          image: 'nginx',
          status: 'Exited',
          state: 'exited',
          ports: '80/tcp', // Has ports but stopped
          created: '',
        },
      ];

      (getNetworkList as ReturnType<typeof vi.fn>).mockResolvedValue(mockNetworks);
      (getContainerStatus as ReturnType<typeof vi.fn>).mockResolvedValue(stoppedContainers);

      await commandHandler({
        ack: mockAck,
        respond: mockRespond,
      });

      const response = mockRespond.mock.calls[0][0];
      const sectionTexts = response.blocks
        .filter((b: { type: string }) => b.type === 'section')
        .map((b: { text?: { text: string } }) => b.text?.text || '');

      expect(sectionTexts.some((t: string) => t.includes('Port Mappings'))).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should handle network list errors', async () => {
      (getNetworkList as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Docker daemon not running')
      );
      (getContainerStatus as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await commandHandler({
        ack: mockAck,
        respond: mockRespond,
      });

      expect(logger.error).toHaveBeenCalledWith(
        'Network command failed',
        expect.objectContaining({ error: 'Docker daemon not running' })
      );
      expect(mockRespond).toHaveBeenCalledWith({
        blocks: expect.arrayContaining([
          expect.objectContaining({
            type: 'section',
            text: expect.objectContaining({
              text: expect.stringContaining('Docker daemon not running'),
            }),
          }),
        ]),
        response_type: 'ephemeral',
      });
    });

    it('should handle container status errors', async () => {
      (getNetworkList as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (getContainerStatus as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Permission denied')
      );

      await commandHandler({
        ack: mockAck,
        respond: mockRespond,
      });

      expect(logger.error).toHaveBeenCalled();
    });

    it('should handle non-Error exceptions', async () => {
      (getNetworkList as ReturnType<typeof vi.fn>).mockRejectedValue('string error');

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

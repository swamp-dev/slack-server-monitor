import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { App } from '@slack/bolt';

// Mock dependencies
vi.mock('../../src/executors/docker.js', () => ({
  getContainerStatus: vi.fn(),
  getContainerDetails: vi.fn(),
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
const { registerServicesCommand } = await import('../../src/commands/status.js');
const { getContainerStatus, getContainerDetails } = await import(
  '../../src/executors/docker.js'
);
const { sanitizeServiceName } = await import('../../src/utils/sanitize.js');
const { logger } = await import('../../src/utils/logger.js');

describe('/services command', () => {
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
        if (name === '/services') {
          commandHandler = handler;
        }
      }),
    };

    registerServicesCommand(mockApp as unknown as App);
  });

  describe('without arguments (list all containers)', () => {
    it('should list all containers', async () => {
      const mockContainers = [
        {
          id: 'abc123',
          name: 'nginx',
          image: 'nginx:latest',
          status: 'Up 2 hours',
          state: 'running',
          ports: '80/tcp',
          created: '2024-01-01',
        },
        {
          id: 'def456',
          name: 'redis',
          image: 'redis:7',
          status: 'Exited (0)',
          state: 'exited',
          ports: '',
          created: '2024-01-01',
        },
      ];

      (getContainerStatus as ReturnType<typeof vi.fn>).mockResolvedValue(mockContainers);

      await commandHandler({
        command: { text: '' },
        ack: mockAck,
        respond: mockRespond,
      });

      expect(mockAck).toHaveBeenCalled();
      expect(getContainerStatus).toHaveBeenCalled();
      expect(mockRespond).toHaveBeenCalledWith({
        blocks: expect.arrayContaining([
          expect.objectContaining({ type: 'header' }),
        ]),
        response_type: 'ephemeral',
      });
    });

    it('should show empty state when no containers found', async () => {
      (getContainerStatus as ReturnType<typeof vi.fn>).mockResolvedValue([]);

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
              text: expect.stringContaining('No containers found'),
            }),
          }),
        ]),
        response_type: 'ephemeral',
      });
    });

    it('should group containers by status', async () => {
      const mockContainers = [
        { id: '1', name: 'running1', image: 'img', status: 'Up', state: 'running', ports: '', created: '' },
        { id: '2', name: 'running2', image: 'img', status: 'Up', state: 'running', ports: '', created: '' },
        { id: '3', name: 'stopped1', image: 'img', status: 'Exited', state: 'exited', ports: '', created: '' },
      ];

      (getContainerStatus as ReturnType<typeof vi.fn>).mockResolvedValue(mockContainers);

      await commandHandler({
        command: { text: '' },
        ack: mockAck,
        respond: mockRespond,
      });

      expect(mockRespond).toHaveBeenCalled();
      const response = mockRespond.mock.calls[0][0];
      const blockTexts = response.blocks
        .filter((b: { type: string }) => b.type === 'section')
        .map((b: { text?: { text: string } }) => b.text?.text || '');

      // Check that both Running and Stopped sections exist
      expect(blockTexts.some((t: string) => t.includes('Running'))).toBe(true);
      expect(blockTexts.some((t: string) => t.includes('Stopped'))).toBe(true);
    });

    it('should use compact view for 8+ containers', async () => {
      const mockContainers = Array.from({ length: 10 }, (_, i) => ({
        id: String(i),
        name: `container${i}`,
        image: 'img',
        status: 'Up',
        state: 'running',
        ports: '',
        created: '',
      }));

      (getContainerStatus as ReturnType<typeof vi.fn>).mockResolvedValue(mockContainers);

      await commandHandler({
        command: { text: '' },
        ack: mockAck,
        respond: mockRespond,
      });

      // Compact view should have context elements with multiple container names
      const response = mockRespond.mock.calls[0][0];
      const contextBlocks = response.blocks.filter(
        (b: { type: string }) => b.type === 'context'
      );
      expect(contextBlocks.length).toBeGreaterThan(0);
    });
  });

  describe('with service name argument', () => {
    it('should show detailed container info', async () => {
      const mockDetails = {
        id: 'abc123456789',
        name: 'nginx',
        image: 'nginx:latest',
        state: {
          status: 'running',
          running: true,
          startedAt: '2024-01-01T10:00:00.000Z',
          finishedAt: '0001-01-01T00:00:00Z',
        },
        restartCount: 0,
        platform: 'linux',
        mounts: [{ source: '/var/www', destination: '/usr/share/nginx/html', mode: 'ro' }],
        networks: ['bridge'],
        ports: { '80/tcp': '8080' },
      };

      (getContainerDetails as ReturnType<typeof vi.fn>).mockResolvedValue(mockDetails);

      await commandHandler({
        command: { text: 'nginx' },
        ack: mockAck,
        respond: mockRespond,
      });

      expect(sanitizeServiceName).toHaveBeenCalledWith('nginx');
      expect(getContainerDetails).toHaveBeenCalledWith('nginx');
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

    it('should sanitize service name input', async () => {
      (sanitizeServiceName as ReturnType<typeof vi.fn>).mockReturnValue('sanitized-name');
      (getContainerDetails as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: '123',
        name: 'sanitized-name',
        image: 'img',
        state: { status: 'running', running: true, startedAt: '', finishedAt: '' },
        restartCount: 0,
        platform: 'linux',
        mounts: [],
        networks: [],
        ports: {},
      });

      await commandHandler({
        command: { text: 'potentially-bad-input' },
        ack: mockAck,
        respond: mockRespond,
      });

      expect(sanitizeServiceName).toHaveBeenCalledWith('potentially-bad-input');
      expect(getContainerDetails).toHaveBeenCalledWith('sanitized-name');
    });

    it('should show networks section when container has networks', async () => {
      (getContainerDetails as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: '123',
        name: 'test',
        image: 'img',
        state: { status: 'running', running: true, startedAt: '', finishedAt: '' },
        restartCount: 0,
        platform: 'linux',
        mounts: [],
        networks: ['bridge', 'custom_network'],
        ports: {},
      });

      await commandHandler({
        command: { text: 'test' },
        ack: mockAck,
        respond: mockRespond,
      });

      const response = mockRespond.mock.calls[0][0];
      const sectionTexts = response.blocks
        .filter((b: { type: string }) => b.type === 'section')
        .map((b: { text?: { text: string } }) => b.text?.text || '');

      expect(sectionTexts.some((t: string) => t.includes('Networks'))).toBe(true);
    });

    it('should show ports section when container has port mappings', async () => {
      (getContainerDetails as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: '123',
        name: 'test',
        image: 'img',
        state: { status: 'running', running: true, startedAt: '', finishedAt: '' },
        restartCount: 0,
        platform: 'linux',
        mounts: [],
        networks: [],
        ports: { '80/tcp': '8080', '443/tcp': '8443' },
      });

      await commandHandler({
        command: { text: 'test' },
        ack: mockAck,
        respond: mockRespond,
      });

      const response = mockRespond.mock.calls[0][0];
      const sectionTexts = response.blocks
        .filter((b: { type: string }) => b.type === 'section')
        .map((b: { text?: { text: string } }) => b.text?.text || '');

      expect(sectionTexts.some((t: string) => t.includes('Ports'))).toBe(true);
    });

    it('should show mounts section when container has mounts', async () => {
      (getContainerDetails as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: '123',
        name: 'test',
        image: 'img',
        state: { status: 'running', running: true, startedAt: '', finishedAt: '' },
        restartCount: 0,
        platform: 'linux',
        mounts: [
          { source: '/host/path', destination: '/container/path', mode: 'rw' },
        ],
        networks: [],
        ports: {},
      });

      await commandHandler({
        command: { text: 'test' },
        ack: mockAck,
        respond: mockRespond,
      });

      const response = mockRespond.mock.calls[0][0];
      const sectionTexts = response.blocks
        .filter((b: { type: string }) => b.type === 'section')
        .map((b: { text?: { text: string } }) => b.text?.text || '');

      expect(sectionTexts.some((t: string) => t.includes('Mounts'))).toBe(true);
    });

    it('should limit displayed mounts to 5', async () => {
      const manyMounts = Array.from({ length: 10 }, (_, i) => ({
        source: `/host/${i}`,
        destination: `/container/${i}`,
        mode: 'rw',
      }));

      (getContainerDetails as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: '123',
        name: 'test',
        image: 'img',
        state: { status: 'running', running: true, startedAt: '', finishedAt: '' },
        restartCount: 0,
        platform: 'linux',
        mounts: manyMounts,
        networks: [],
        ports: {},
      });

      await commandHandler({
        command: { text: 'test' },
        ack: mockAck,
        respond: mockRespond,
      });

      const response = mockRespond.mock.calls[0][0];
      const contextBlocks = response.blocks.filter(
        (b: { type: string }) => b.type === 'context'
      );

      // Should have "...and X more" message
      const contextTexts = contextBlocks.map(
        (b: { elements?: { text: string }[] }) => b.elements?.[0]?.text || ''
      );
      expect(contextTexts.some((t: string) => t.includes('more'))).toBe(true);
    });

    it('should show stopped time for non-running containers', async () => {
      (getContainerDetails as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: '123',
        name: 'test',
        image: 'img',
        state: {
          status: 'exited',
          running: false,
          startedAt: '2024-01-01T10:00:00.000Z',
          finishedAt: '2024-01-01T12:00:00.000Z',
        },
        restartCount: 0,
        platform: 'linux',
        mounts: [],
        networks: [],
        ports: {},
      });

      await commandHandler({
        command: { text: 'test' },
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

      expect(contextTexts.some((t: string) => t.includes('Stopped'))).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should handle executor errors gracefully', async () => {
      (getContainerStatus as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Docker daemon not running')
      );

      await commandHandler({
        command: { text: '' },
        ack: mockAck,
        respond: mockRespond,
      });

      expect(logger.error).toHaveBeenCalledWith(
        'Services command failed',
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

    it('should handle container not found', async () => {
      (getContainerDetails as ReturnType<typeof vi.fn>).mockRejectedValue(
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
      (getContainerStatus as ReturnType<typeof vi.fn>).mockRejectedValue('string error');

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

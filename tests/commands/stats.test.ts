import { describe, it, expect, vi } from 'vitest';

// Mock config
vi.mock('../../src/config/index.js', () => ({
  config: {
    claude: {
      dbPath: ':memory:',
      conversationTtlHours: 24,
    },
    server: {
      diskLabels: {},
    },
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const mockGetSessionStats = vi.fn().mockReturnValue({
  totalSessions: 15,
  activeSessions: 3,
  totalMessages: 42,
  totalToolCalls: 28,
  avgToolDurationMs: 450,
  toolFailureRate: 0.05,
  topTools: [
    { name: 'get_container_status', count: 12, avgDurationMs: 300 },
    { name: 'run_command', count: 8, avgDurationMs: 600 },
  ],
});

const mockCountUniqueUsers = vi.fn().mockReturnValue(4);

vi.mock('../../src/services/conversation-store.js', () => ({
  getConversationStore: vi.fn(() => ({
    getSessionStats: mockGetSessionStats,
    countUniqueUsers: mockCountUniqueUsers,
  })),
}));

vi.mock('../../src/services/server-health.js', () => ({
  getServerHealth: vi.fn().mockResolvedValue({
    uptime: '5 days, 3 hours',
    uptimeSeconds: 442800,
    loadAverage: [0.5, 0.4, 0.3],
    cpu: { cores: 4, model: 'Intel' },
    memory: { used: 4096, total: 8192, available: 4096, bufferCache: 2048, percentUsed: 50 },
    swap: { used: 0, total: 2048, percentUsed: 0 },
    disks: [
      { mountPoint: '/', size: '500G', used: '200G', available: '300G', percentUsed: 40 },
      { mountPoint: '/mnt/storage', size: '8T', used: '2T', available: '6T', percentUsed: 25 },
    ],
  }),
}));

import { registerStatsCommand } from '../../src/commands/stats.js';

describe('stats command', () => {
  it('should register /stats command', () => {
    const app = { command: vi.fn() };
    registerStatsCommand(app as never);
    expect(app.command).toHaveBeenCalledWith('/stats', expect.any(Function));
  });

  it('should respond with usage stats and system health', async () => {
    const app = { command: vi.fn() };
    registerStatsCommand(app as never);

    const ack = vi.fn();
    const respond = vi.fn();
    const handler = app.command.mock.calls[0][1];

    await handler({ ack, respond });

    expect(ack).toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({
        blocks: expect.arrayContaining([
          // Header
          expect.objectContaining({ type: 'header' }),
          // Stats section with session counts
          expect.objectContaining({
            type: 'section',
            text: expect.objectContaining({
              text: expect.stringContaining('Sessions:'),
            }),
          }),
        ]),
      })
    );

    // Verify the response includes key stats
    const blocks = respond.mock.calls[0][0].blocks;
    const allText = blocks
      .filter((b: Record<string, unknown>) => b.type === 'section')
      .map((b: Record<string, unknown>) => (b.text as Record<string, string>).text)
      .join('\n');

    expect(allText).toContain('15'); // totalSessions
    expect(allText).toContain('Users:'); // unique users
    expect(allText).toContain('Tool Calls:');
    expect(allText).toContain('get_container_status');
    expect(allText).toContain('Uptime:');
    expect(allText).toContain('/mnt/storage');
  });

  it('should call countUniqueUsers with 24 hours', async () => {
    const app = { command: vi.fn() };
    registerStatsCommand(app as never);

    const handler = app.command.mock.calls[0][1];
    await handler({ ack: vi.fn(), respond: vi.fn() });

    expect(mockCountUniqueUsers).toHaveBeenCalledWith(24);
  });

  it('should show disk sizes alongside percentage', async () => {
    const app = { command: vi.fn() };
    registerStatsCommand(app as never);

    const ack = vi.fn();
    const respond = vi.fn();
    const handler = app.command.mock.calls[0][1];
    await handler({ ack, respond });

    const blocks = respond.mock.calls[0][0].blocks;
    const allText = blocks
      .filter((b: Record<string, unknown>) => b.type === 'section')
      .map((b: Record<string, unknown>) => (b.text as Record<string, string>).text)
      .join('\n');

    // Disk size info should appear in format "used / size"
    expect(allText).toContain('2T / 8T');   // /mnt/storage mock values
    expect(allText).toContain('200G / 500G'); // / mock values
  });

  it('should split system and attached disks into separate sections when both present', async () => {
    const app = { command: vi.fn() };
    registerStatsCommand(app as never);

    const ack = vi.fn();
    const respond = vi.fn();
    const handler = app.command.mock.calls[0][1];
    await handler({ ack, respond });

    const blocks = respond.mock.calls[0][0].blocks;
    const sectionTexts = blocks
      .filter((b: Record<string, unknown>) => b.type === 'section')
      .map((b: Record<string, unknown>) => (b.text as Record<string, string>).text);

    expect(sectionTexts.some((t: string) => t.includes('System Disk'))).toBe(true);
    expect(sectionTexts.some((t: string) => t.includes('Attached Storage'))).toBe(true);
  });
});

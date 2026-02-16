import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { App } from '@slack/bolt';

// Mock dependencies
vi.mock('../../src/config/index.js', () => ({
  config: {
    claude: undefined as
      | { contextOptions: { alias: string; path: string }[] }
      | undefined,
  },
}));

vi.mock('../../src/plugins/loader.js', () => ({
  getPluginHelpData: vi.fn().mockReturnValue([]),
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
const { registerHelpCommand } = await import('../../src/commands/help.js');
const { config } = await import('../../src/config/index.js');
const { getPluginHelpData } = await import('../../src/plugins/loader.js');

describe('/help command', () => {
  let mockApp: { command: ReturnType<typeof vi.fn> };
  let mockAck: ReturnType<typeof vi.fn>;
  let mockRespond: ReturnType<typeof vi.fn>;
  let commandHandler: (args: {
    ack: () => Promise<void>;
    respond: (response: unknown) => Promise<void>;
  }) => Promise<void>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset config to no Claude
    (config as { claude: unknown }).claude = undefined;

    // Reset plugin help data to empty
    (getPluginHelpData as ReturnType<typeof vi.fn>).mockReturnValue([]);

    mockAck = vi.fn().mockResolvedValue(undefined);
    mockRespond = vi.fn().mockResolvedValue(undefined);

    mockApp = {
      command: vi.fn((name: string, handler: typeof commandHandler) => {
        if (name === '/help') {
          commandHandler = handler;
        }
      }),
    };

    registerHelpCommand(mockApp as unknown as App);
  });

  it('should register /help command', () => {
    expect(mockApp.command).toHaveBeenCalledWith('/help', expect.any(Function));
  });

  it('should call ack before respond', async () => {
    const callOrder: string[] = [];
    mockAck.mockImplementation(async () => { callOrder.push('ack'); });
    mockRespond.mockImplementation(async () => { callOrder.push('respond'); });

    await commandHandler({ ack: mockAck, respond: mockRespond });

    expect(callOrder[0]).toBe('ack');
    expect(callOrder[1]).toBe('respond');
  });

  it('should respond with ephemeral response', async () => {
    await commandHandler({ ack: mockAck, respond: mockRespond });

    expect(mockRespond).toHaveBeenCalledWith(
      expect.objectContaining({ response_type: 'ephemeral' })
    );
  });

  describe('core sections', () => {
    it('should include Containers section', async () => {
      await commandHandler({ ack: mockAck, respond: mockRespond });

      const response = mockRespond.mock.calls[0][0];
      const text = JSON.stringify(response.blocks);
      expect(text).toContain('Containers');
      expect(text).toContain('/services');
      expect(text).toContain('/logs');
      expect(text).toContain('/network');
    });

    it('should include System section', async () => {
      await commandHandler({ ack: mockAck, respond: mockRespond });

      const response = mockRespond.mock.calls[0][0];
      const text = JSON.stringify(response.blocks);
      expect(text).toContain('System');
      expect(text).toContain('/resources');
      expect(text).toContain('/disk');
    });

    it('should include Monitoring section', async () => {
      await commandHandler({ ack: mockAck, respond: mockRespond });

      const response = mockRespond.mock.calls[0][0];
      const text = JSON.stringify(response.blocks);
      expect(text).toContain('Monitoring');
      expect(text).toContain('/security');
      expect(text).toContain('/ssl');
      expect(text).toContain('/backups');
      expect(text).toContain('/pm2');
    });
  });

  describe('Claude AI section', () => {
    it('should hide Claude section when config.claude is undefined', async () => {
      (config as { claude: unknown }).claude = undefined;

      await commandHandler({ ack: mockAck, respond: mockRespond });

      const response = mockRespond.mock.calls[0][0];
      const text = JSON.stringify(response.blocks);
      expect(text).not.toContain('Claude AI');
      expect(text).not.toContain('/ask');
    });

    it('should show Claude section when config.claude is set', async () => {
      (config as { claude: unknown }).claude = { contextOptions: [] };

      await commandHandler({ ack: mockAck, respond: mockRespond });

      const response = mockRespond.mock.calls[0][0];
      const text = JSON.stringify(response.blocks);
      expect(text).toContain('Claude AI');
      expect(text).toContain('/ask');
      expect(text).toContain('/sessions');
    });

    it('should show /context command when contextOptions is non-empty', async () => {
      (config as { claude: unknown }).claude = {
        contextOptions: [{ alias: 'home', path: '/opt/home' }],
      };

      await commandHandler({ ack: mockAck, respond: mockRespond });

      const response = mockRespond.mock.calls[0][0];
      const text = JSON.stringify(response.blocks);
      expect(text).toContain('/context');
    });

    it('should hide /context command when contextOptions is empty', async () => {
      (config as { claude: unknown }).claude = { contextOptions: [] };

      await commandHandler({ ack: mockAck, respond: mockRespond });

      const response = mockRespond.mock.calls[0][0];
      const text = JSON.stringify(response.blocks);
      expect(text).not.toContain('/context');
    });
  });

  describe('plugin sections', () => {
    it('should render structured helpEntries when present', async () => {
      (getPluginHelpData as ReturnType<typeof vi.fn>).mockReturnValue([
        {
          name: 'health',
          description: 'Health tracker',
          helpEntries: [
            { command: '/health', description: "Today's dashboard", group: 'Health' },
            { command: '/health add <name>', description: 'Add member', group: 'Health - Members' },
          ],
        },
      ]);

      await commandHandler({ ack: mockAck, respond: mockRespond });

      const response = mockRespond.mock.calls[0][0];
      const text = JSON.stringify(response.blocks);
      expect(text).toContain('Plugins');
      expect(text).toContain('/health');
      expect(text).toContain("Today's dashboard");
      expect(text).toContain('/health add <name>');
      expect(text).toContain('Add member');
    });

    it('should group entries by group field', async () => {
      (getPluginHelpData as ReturnType<typeof vi.fn>).mockReturnValue([
        {
          name: 'health',
          helpEntries: [
            { command: '/health', description: 'Dashboard', group: 'Health' },
            { command: '/health add <name>', description: 'Add member', group: 'Health - Members' },
            { command: '/health list', description: 'List members', group: 'Health - Members' },
          ],
        },
      ]);

      await commandHandler({ ack: mockAck, respond: mockRespond });

      const response = mockRespond.mock.calls[0][0];
      const text = JSON.stringify(response.blocks);
      // Both groups should appear
      expect(text).toContain('*Health*');
      expect(text).toContain('*Health - Members*');
    });

    it('should default group to plugin name when group is omitted', async () => {
      (getPluginHelpData as ReturnType<typeof vi.fn>).mockReturnValue([
        {
          name: 'weather',
          helpEntries: [
            { command: '/weather', description: 'Current weather' },
            { command: '/weather forecast', description: '5-day forecast' },
          ],
        },
      ]);

      await commandHandler({ ack: mockAck, respond: mockRespond });

      const response = mockRespond.mock.calls[0][0];
      const text = JSON.stringify(response.blocks);
      expect(text).toContain('*weather*');
      expect(text).toContain('Current weather');
      expect(text).toContain('5-day forecast');
    });

    it('should show fallback for plugins without helpEntries', async () => {
      (getPluginHelpData as ReturnType<typeof vi.fn>).mockReturnValue([
        {
          name: 'simple',
          description: 'A simple plugin',
        },
      ]);

      await commandHandler({ ack: mockAck, respond: mockRespond });

      const response = mockRespond.mock.calls[0][0];
      const text = JSON.stringify(response.blocks);
      expect(text).toContain('*simple*');
      expect(text).toContain('A simple plugin');
      expect(text).toContain('/simple help');
      // Must NOT contain double-slash
      expect(text).not.toContain('//simple');
    });

    it('should show fallback without description when not provided', async () => {
      (getPluginHelpData as ReturnType<typeof vi.fn>).mockReturnValue([
        { name: 'bare' },
      ]);

      await commandHandler({ ack: mockAck, respond: mockRespond });

      const response = mockRespond.mock.calls[0][0];
      const text = JSON.stringify(response.blocks);
      expect(text).toContain('*bare*');
      expect(text).toContain('/bare help');
    });

    it('should handle no plugins gracefully', async () => {
      (getPluginHelpData as ReturnType<typeof vi.fn>).mockReturnValue([]);

      await commandHandler({ ack: mockAck, respond: mockRespond });

      const response = mockRespond.mock.calls[0][0];
      const text = JSON.stringify(response.blocks);
      // Core sections still present
      expect(text).toContain('Containers');
      expect(text).toContain('System');
      expect(text).toContain('Monitoring');
      // No plugins header
      expect(text).not.toContain('*Plugins*');
    });

    it('should render multiple plugins', async () => {
      (getPluginHelpData as ReturnType<typeof vi.fn>).mockReturnValue([
        {
          name: 'health',
          helpEntries: [
            { command: '/health', description: 'Dashboard', group: 'Health' },
          ],
        },
        {
          name: 'lift',
          helpEntries: [
            { command: '/lift 1rm <w> <r>', description: 'Estimate 1RM', group: 'Lift' },
          ],
        },
      ]);

      await commandHandler({ ack: mockAck, respond: mockRespond });

      const response = mockRespond.mock.calls[0][0];
      const text = JSON.stringify(response.blocks);
      expect(text).toContain('*Health*');
      expect(text).toContain('*Lift*');
    });

    it('should render all sections in correct order when everything is enabled', async () => {
      (config as { claude: unknown }).claude = {
        contextOptions: [{ alias: 'home', path: '/opt/home' }],
      };
      (getPluginHelpData as ReturnType<typeof vi.fn>).mockReturnValue([
        {
          name: 'health',
          helpEntries: [
            { command: '/health', description: 'Dashboard', group: 'Health' },
          ],
        },
        {
          name: 'lift',
          helpEntries: [
            { command: '/lift 1rm <w> <r>', description: 'Estimate', group: 'Lift' },
          ],
        },
      ]);

      await commandHandler({ ack: mockAck, respond: mockRespond });

      const response = mockRespond.mock.calls[0][0];
      const text = JSON.stringify(response.blocks);

      // All sections present
      expect(text).toContain('Containers');
      expect(text).toContain('System');
      expect(text).toContain('Monitoring');
      expect(text).toContain('Claude AI');
      expect(text).toContain('/context');
      expect(text).toContain('*Plugins*');
      expect(text).toContain('*Health*');
      expect(text).toContain('*Lift*');

      // Verify ordering: core sections before Claude before Plugins
      const containersIdx = text.indexOf('Containers');
      const claudeIdx = text.indexOf('Claude AI');
      const pluginsIdx = text.indexOf('*Plugins*');
      expect(containersIdx).toBeLessThan(claudeIdx);
      expect(claudeIdx).toBeLessThan(pluginsIdx);
    });
  });
});

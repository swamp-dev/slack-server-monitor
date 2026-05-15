import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { App } from '@slack/bolt';

// Create a mutable config object that tests can modify
const mockClaudeConfig: { value: unknown } = { value: null };

// Mock the config module before importing the commands
vi.mock('../../src/config/index.js', () => ({
  get config() {
    return { claude: mockClaudeConfig.value };
  },
}));

// Mock the logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock context-loader to prevent file system access
vi.mock('../../src/services/context-loader.js', () => ({
  getContext: vi.fn().mockResolvedValue(null),
  getContextByAlias: vi.fn().mockResolvedValue(null),
}));

import { registerAskCommand } from '../../src/commands/ask.js';
import { registerContextCommand } from '../../src/commands/context.js';
import { registerSessionsCommand } from '../../src/commands/sessions.js';

describe('Claude disabled message', () => {
  let mockApp: App;
  let commandHandlers: Map<string, (args: unknown) => Promise<void>>;
  let mockRespond: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Ensure Claude is disabled for these tests
    mockClaudeConfig.value = null;

    // Capture registered command handlers
    commandHandlers = new Map();
    mockRespond = vi.fn();

    mockApp = {
      command: vi.fn((name: string, handler: (args: unknown) => Promise<void>) => {
        commandHandlers.set(name, handler);
      }),
    } as unknown as App;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('/ask command', () => {
    it('should register handler even when Claude is disabled', async () => {
      await registerAskCommand(mockApp);

      expect(mockApp.command).toHaveBeenCalledWith('/ask', expect.any(Function));
      expect(commandHandlers.has('/ask')).toBe(true);
    });

    it('should return helpful error message when Claude is disabled', async () => {
      await registerAskCommand(mockApp);

      const handler = commandHandlers.get('/ask');
      if (!handler) throw new Error('Handler not registered');

      await handler({
        command: {
          text: 'test question',
          user_id: 'U123',
          channel_id: 'C123',
        },
        ack: vi.fn(),
        respond: mockRespond,
        client: {},
      });

      expect(mockRespond).toHaveBeenCalledWith({
        blocks: [
          expect.objectContaining({
            type: 'section',
            text: expect.objectContaining({
              text: expect.stringContaining('Claude AI is not enabled'),
            }),
          }),
        ],
        response_type: 'ephemeral',
      });

      // Verify the message mentions CLAUDE_ENABLED
      const call = mockRespond.mock.calls[0]?.[0];
      expect(call.blocks[0].text.text).toContain('CLAUDE_ENABLED=true');
    });
  });

  describe('/context command', () => {
    it('should register handler even when Claude is disabled', () => {
      registerContextCommand(mockApp);

      expect(mockApp.command).toHaveBeenCalledWith('/context', expect.any(Function));
      expect(commandHandlers.has('/context')).toBe(true);
    });

    it('should return helpful error message when Claude is disabled', async () => {
      registerContextCommand(mockApp);

      const handler = commandHandlers.get('/context');
      if (!handler) throw new Error('Handler not registered');

      await handler({
        command: {
          text: '',
          user_id: 'U123',
          channel_id: 'C123',
        },
        ack: vi.fn(),
        respond: mockRespond,
      });

      expect(mockRespond).toHaveBeenCalledWith({
        blocks: [
          expect.objectContaining({
            type: 'section',
            text: expect.objectContaining({
              text: expect.stringContaining('Claude AI is not enabled'),
            }),
          }),
        ],
        response_type: 'ephemeral',
      });

      // Verify the message mentions CLAUDE_ENABLED
      const call = mockRespond.mock.calls[0]?.[0];
      expect(call.blocks[0].text.text).toContain('CLAUDE_ENABLED=true');
    });
  });

  describe('/sessions command', () => {
    it('should register handler even when Claude is disabled', () => {
      registerSessionsCommand(mockApp);

      expect(mockApp.command).toHaveBeenCalledWith('/sessions', expect.any(Function));
      expect(commandHandlers.has('/sessions')).toBe(true);
    });

    it('should return helpful error message when Claude is disabled', async () => {
      registerSessionsCommand(mockApp);

      const handler = commandHandlers.get('/sessions');
      if (!handler) throw new Error('Handler not registered');

      await handler({
        command: {
          text: '',
          user_id: 'U123',
          channel_id: 'C123',
        },
        ack: vi.fn(),
        respond: mockRespond,
      });

      expect(mockRespond).toHaveBeenCalledWith({
        blocks: [
          expect.objectContaining({
            type: 'section',
            text: expect.objectContaining({
              text: expect.stringContaining('Claude AI is not enabled'),
            }),
          }),
        ],
        response_type: 'ephemeral',
      });

      // Verify the message mentions CLAUDE_ENABLED
      const call = mockRespond.mock.calls[0]?.[0];
      expect(call.blocks[0].text.text).toContain('CLAUDE_ENABLED=true');
    });
  });
});

describe('/context with no options configured', () => {
  let mockApp: App;
  let commandHandlers: Map<string, (args: unknown) => Promise<void>>;
  let mockRespond: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Enable Claude but with no context options
    mockClaudeConfig.value = {
      dbPath: '/tmp/test.db',
      contextOptions: [],
    };

    commandHandlers = new Map();
    mockRespond = vi.fn();

    mockApp = {
      command: vi.fn((name: string, handler: (args: unknown) => Promise<void>) => {
        commandHandlers.set(name, handler);
      }),
    } as unknown as App;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should return helpful error message when no context options configured', async () => {
    registerContextCommand(mockApp);

    const handler = commandHandlers.get('/context');
    if (!handler) throw new Error('Handler not registered');

    await handler({
      command: {
        text: '',
        user_id: 'U123',
        channel_id: 'C123',
      },
      ack: vi.fn(),
      respond: mockRespond,
    });

    expect(mockRespond).toHaveBeenCalledWith({
      blocks: [
        expect.objectContaining({
          type: 'section',
          text: expect.objectContaining({
            text: expect.stringContaining('No context options configured'),
          }),
        }),
      ],
      response_type: 'ephemeral',
    });

    // Verify the message mentions CLAUDE_CONTEXT_OPTIONS
    const call = mockRespond.mock.calls[0]?.[0];
    expect(call.blocks[0].text.text).toContain('CLAUDE_CONTEXT_OPTIONS');
  });
});

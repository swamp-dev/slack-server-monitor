import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  checkAndRecordClaudeRequest,
  getRemainingRequests,
  clearRateLimitForUser,
  clearAllRateLimits,
} from '../../src/services/claude-rate-limit.js';

// ──────────────────────────────────────────────
// Mocks
// ──────────────────────────────────────────────

const mockProcessConversationTurn = vi.fn();
const mockInitDefaultContext = vi.fn();

vi.mock('../../src/services/conversation-processor.js', () => ({
  processConversationTurn: (...args: unknown[]) => mockProcessConversationTurn(...args),
  initDefaultContext: (...args: unknown[]) => mockInitDefaultContext(...args),
}));

const mockGetConversationStore = vi.fn();
vi.mock('../../src/services/conversation-store.js', () => ({
  getConversationStore: (...args: unknown[]) => mockGetConversationStore(...args),
}));

const mockGetBySlackId = vi.fn();
vi.mock('../../src/services/user-store.js', () => ({
  getUserStore: () => ({ getBySlackId: (id: string) => mockGetBySlackId(id) }),
  resolveUserStoreDbPath: (p: string) => p,
}));

const mockGetConversationUrl = vi.fn().mockReturnValue('http://localhost:8080/c/1234.5678/C123TEST');
vi.mock('../../src/web/index.js', () => ({
  getConversationUrl: (...args: unknown[]) => mockGetConversationUrl(...args),
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../src/utils/image.js', () => ({
  isValidImageUrl: vi.fn().mockReturnValue(true),
  fetchImageAsBase64: vi.fn().mockResolvedValue({ data: 'base64data', mediaType: 'image/png' }),
  downloadImageToFile: vi.fn().mockResolvedValue('image/png'),
  cleanupTempImage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/utils/slack-errors.js', () => ({
  parseSlackError: vi.fn().mockReturnValue({
    type: 'unknown' as const,
    message: 'test error',
    suggestion: '',
    format: () => 'test error',
  }),
}));

vi.mock('../../src/formatters/scrub.js', () => ({
  scrubSensitiveData: vi.fn((s: string) => s),
  truncateText: vi.fn((s: string, max: number) => {
    if (s.length <= max) return s;
    return s.slice(0, max) + '\n... [truncated]';
  }),
}));

// Mock config - we'll override per test via mockConfig
const mockConfig: Record<string, unknown> = {
  claude: {
    rateLimitMax: 5,
    rateLimitWindowSeconds: 60,
    dbPath: ':memory:',
    conversationTtlHours: 24,
    contextDir: undefined,
  },
  slack: {
    botToken: 'xoxb-test-token',
  },
  web: undefined,
  authorization: {
    userIds: ['U123TEST'],
  },
};

vi.mock('../../src/config/index.js', () => ({
  get config() {
    return mockConfig;
  },
}));

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function createMockCommand(overrides: Record<string, unknown> = {}) {
  return {
    command: {
      text: 'test question',
      user_id: 'U123TEST',
      channel_id: 'C123TEST',
      ...overrides,
    },
    ack: vi.fn().mockResolvedValue(undefined),
    respond: vi.fn().mockResolvedValue(undefined),
    client: {
      chat: {
        postMessage: vi.fn().mockResolvedValue({ ok: true, ts: '1234.5678' }),
        update: vi.fn().mockResolvedValue({ ok: true }),
      },
    },
  };
}

function createMockStore() {
  return {
    getOrCreateConversation: vi.fn().mockReturnValue({
      id: 1,
      threadTs: '1234.5678',
      channelId: 'C123TEST',
      userId: 'U123TEST',
      messages: [{ role: 'user', content: 'test question' }],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      archivedAt: null,
      favoritedAt: null,
    }),
    addAssistantMessage: vi.fn(),
    logToolCall: vi.fn(),
    getConversationByThreadTs: vi.fn(),
    getConversation: vi.fn(),
    createConversation: vi.fn().mockReturnValue({
      id: 2,
      threadTs: '9999.1111',
      channelId: 'C123TEST',
      userId: 'U123TEST',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      archivedAt: null,
      favoritedAt: null,
    }),
  };
}

function defaultTurnResult(overrides: Record<string, unknown> = {}) {
  return {
    response: 'Test response from Claude',
    toolCalls: [],
    usage: { inputTokens: 100, outputTokens: 200 },
    ...overrides,
  };
}

/**
 * Capture the handler registered via app.command('/ask', handler)
 * and optionally the message event handler
 */
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- dynamic import needed for test isolation
type App = import('@slack/bolt').App;

async function captureHandlers() {
  const mockApp = {
    command: vi.fn(),
    event: vi.fn(),
  };

  const { registerAskCommand, registerThreadHandler } = await import('../../src/commands/ask.js');
  await registerAskCommand(mockApp as unknown as App);
  registerThreadHandler(mockApp as unknown as App);

  const askCall = mockApp.command.mock.calls.find(
    (call: unknown[]) => call[0] === '/ask'
  );
  const eventCall = mockApp.event.mock.calls.find(
    (call: unknown[]) => call[0] === 'message'
  );

  if (!askCall) {
    throw new Error('Failed to capture /ask handler');
  }

  return {
    askHandler: askCall[1] as (...args: unknown[]) => Promise<void>,
    messageHandler: eventCall?.[1] as ((args: Record<string, unknown>) => Promise<void>) | undefined,
  };
}

/**
 * Assert that the message handler was registered and return it with narrowed type
 */
function assertMessageHandler(
  handler: ((args: Record<string, unknown>) => Promise<void>) | undefined,
): (args: Record<string, unknown>) => Promise<void> {
  expect(handler).toBeDefined();
  // Safe after the expect assertion above
  return handler as (args: Record<string, unknown>) => Promise<void>;
}

// ──────────────────────────────────────────────
// Rate limiting tests (preserved from original)
// ──────────────────────────────────────────────

describe('Claude rate limiting', () => {
  beforeEach(() => {
    clearAllRateLimits();
  });

  afterEach(() => {
    clearAllRateLimits();
  });

  describe('checkAndRecordClaudeRequest', () => {
    it('should allow requests under the limit', () => {
      const userId = 'U12345678';

      // First request should be allowed
      expect(checkAndRecordClaudeRequest(userId)).toBe(true);
      expect(getRemainingRequests(userId)).toBe(4);

      // Second request should be allowed
      expect(checkAndRecordClaudeRequest(userId)).toBe(true);
      expect(getRemainingRequests(userId)).toBe(3);
    });

    it('should deny requests at the limit', () => {
      const userId = 'U12345678';

      // Make 5 requests (at limit)
      for (let i = 0; i < 5; i++) {
        expect(checkAndRecordClaudeRequest(userId)).toBe(true);
      }

      // 6th request should be denied
      expect(checkAndRecordClaudeRequest(userId)).toBe(false);
      expect(getRemainingRequests(userId)).toBe(0);
    });

    it('should track users independently', () => {
      const user1 = 'U11111111';
      const user2 = 'U22222222';

      // User 1 makes 5 requests
      for (let i = 0; i < 5; i++) {
        expect(checkAndRecordClaudeRequest(user1)).toBe(true);
      }

      // User 1 is at limit
      expect(checkAndRecordClaudeRequest(user1)).toBe(false);

      // User 2 should still be able to make requests
      expect(checkAndRecordClaudeRequest(user2)).toBe(true);
      expect(getRemainingRequests(user2)).toBe(4);
    });

    it('should atomically check and record (no race condition)', () => {
      const userId = 'U12345678';

      // Make 4 requests
      for (let i = 0; i < 4; i++) {
        checkAndRecordClaudeRequest(userId);
      }

      // Only 1 slot remaining
      expect(getRemainingRequests(userId)).toBe(1);

      // Single atomic call should succeed and consume the slot
      expect(checkAndRecordClaudeRequest(userId)).toBe(true);

      // Now at limit, should fail
      expect(checkAndRecordClaudeRequest(userId)).toBe(false);
      expect(getRemainingRequests(userId)).toBe(0);
    });
  });

  describe('getRemainingRequests', () => {
    it('should return full limit for new users', () => {
      expect(getRemainingRequests('U_NEW_USER')).toBe(5);
    });

    it('should return correct remaining count', () => {
      const userId = 'U12345678';

      expect(getRemainingRequests(userId)).toBe(5);

      checkAndRecordClaudeRequest(userId);
      expect(getRemainingRequests(userId)).toBe(4);

      checkAndRecordClaudeRequest(userId);
      checkAndRecordClaudeRequest(userId);
      expect(getRemainingRequests(userId)).toBe(2);
    });

    it('should return 0 when at limit', () => {
      const userId = 'U12345678';

      for (let i = 0; i < 5; i++) {
        checkAndRecordClaudeRequest(userId);
      }

      expect(getRemainingRequests(userId)).toBe(0);
    });
  });

  describe('clearRateLimitForUser', () => {
    it('should reset rate limit for a specific user', () => {
      const user1 = 'U11111111';
      const user2 = 'U22222222';

      // Both users make requests
      for (let i = 0; i < 3; i++) {
        checkAndRecordClaudeRequest(user1);
        checkAndRecordClaudeRequest(user2);
      }

      expect(getRemainingRequests(user1)).toBe(2);
      expect(getRemainingRequests(user2)).toBe(2);

      // Clear only user1
      clearRateLimitForUser(user1);

      // User 1 should be reset, user 2 unchanged
      expect(getRemainingRequests(user1)).toBe(5);
      expect(getRemainingRequests(user2)).toBe(2);
    });
  });

  describe('clearAllRateLimits', () => {
    it('should reset rate limits for all users', () => {
      const user1 = 'U11111111';
      const user2 = 'U22222222';

      // Both users make requests
      for (let i = 0; i < 3; i++) {
        checkAndRecordClaudeRequest(user1);
        checkAndRecordClaudeRequest(user2);
      }

      expect(getRemainingRequests(user1)).toBe(2);
      expect(getRemainingRequests(user2)).toBe(2);

      // Clear all
      clearAllRateLimits();

      // Both should be reset
      expect(getRemainingRequests(user1)).toBe(5);
      expect(getRemainingRequests(user2)).toBe(5);
    });
  });

  describe('window expiry', () => {
    it('should reset count after window expires', async () => {
      // This test uses fake timers to simulate window expiry
      vi.useFakeTimers();

      const userId = 'U12345678';

      // Make 5 requests
      for (let i = 0; i < 5; i++) {
        checkAndRecordClaudeRequest(userId);
      }

      expect(getRemainingRequests(userId)).toBe(0);
      expect(checkAndRecordClaudeRequest(userId)).toBe(false);

      // Advance time past the window (60 seconds + buffer)
      vi.advanceTimersByTime(61000);

      // Should be able to make requests again
      expect(getRemainingRequests(userId)).toBe(5);
      expect(checkAndRecordClaudeRequest(userId)).toBe(true);

      vi.useRealTimers();
    });
  });
});

// ──────────────────────────────────────────────
// Handler tests
// ──────────────────────────────────────────────

describe('registerAskCommand handler', () => {
  let askHandler: (...args: unknown[]) => Promise<void>;
  let messageHandler: ((args: Record<string, unknown>) => Promise<void>) | undefined;

  beforeEach(async () => {
    vi.clearAllMocks();
    clearAllRateLimits();

    // Reset config to defaults
    mockConfig.claude = {
      rateLimitMax: 5,
      rateLimitWindowSeconds: 60,
      dbPath: ':memory:',
      conversationTtlHours: 24,
      contextDir: undefined,
    };
    mockConfig.web = undefined;
    mockConfig.authorization = { userIds: ['U123TEST'] };

    // Set up default mocks
    const store = createMockStore();
    mockGetConversationStore.mockReturnValue(store);
    mockProcessConversationTurn.mockResolvedValue(defaultTurnResult());

    // Default UserStore lookup: any user is authorized + active. Per-test
    // overrides simulate unknown / deactivated / storage-failure cases.
    mockGetBySlackId.mockReturnValue({
      id: 1,
      slackId: 'U123TEST',
      role: 'user',
      isActive: true,
    });

    const handlers = await captureHandlers();
    askHandler = handlers.askHandler;
    messageHandler = handlers.messageHandler;
  });

  afterEach(() => {
    clearAllRateLimits();
    vi.restoreAllMocks();
  });

  it('should ack the command immediately', async () => {
    const mock = createMockCommand();
    await askHandler(mock);

    expect(mock.ack).toHaveBeenCalledTimes(1);
  });

  it('should respond with error when question is empty', async () => {
    const mock = createMockCommand({ text: '' });
    await askHandler(mock);

    expect(mock.ack).toHaveBeenCalledTimes(1);
    expect(mock.respond).toHaveBeenCalledWith(
      expect.objectContaining({
        response_type: 'ephemeral',
        blocks: expect.arrayContaining([
          expect.objectContaining({
            text: expect.objectContaining({
              text: expect.stringContaining('Please provide a question'),
            }),
          }),
        ]),
      })
    );
    // Should NOT call Claude
    expect(mockProcessConversationTurn).not.toHaveBeenCalled();
  });

  it('should respond with error when Claude is disabled', async () => {
    mockConfig.claude = undefined;
    const mock = createMockCommand();
    await askHandler(mock);

    expect(mock.ack).toHaveBeenCalledTimes(1);
    expect(mock.respond).toHaveBeenCalledWith(
      expect.objectContaining({
        response_type: 'ephemeral',
        blocks: expect.arrayContaining([
          expect.objectContaining({
            text: expect.objectContaining({
              text: expect.stringContaining('Claude AI is not enabled'),
            }),
          }),
        ]),
      })
    );
    expect(mockProcessConversationTurn).not.toHaveBeenCalled();
  });

  it('should respond with error when rate limit exceeded', async () => {
    // Exhaust rate limit
    for (let i = 0; i < 5; i++) {
      checkAndRecordClaudeRequest('U123TEST');
    }

    const mock = createMockCommand();
    await askHandler(mock);

    expect(mock.ack).toHaveBeenCalledTimes(1);
    expect(mock.respond).toHaveBeenCalledWith(
      expect.objectContaining({
        response_type: 'ephemeral',
        blocks: expect.arrayContaining([
          expect.objectContaining({
            text: expect.objectContaining({
              text: expect.stringContaining('Rate limit exceeded'),
            }),
          }),
        ]),
      })
    );
    expect(mockProcessConversationTurn).not.toHaveBeenCalled();
  });

  it('should post initial message and update with response', async () => {
    const mock = createMockCommand({ text: 'What containers are running?' });
    await askHandler(mock);

    // Should post initial "thinking" message
    expect(mock.client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'C123TEST',
        blocks: expect.arrayContaining([
          expect.objectContaining({
            text: expect.objectContaining({
              text: expect.stringContaining('What containers are running?'),
            }),
          }),
        ]),
      })
    );

    // Should call processConversationTurn
    expect(mockProcessConversationTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 1,
        threadTs: '1234.5678',
        channelId: 'C123TEST',
        userId: 'U123TEST',
        userMessage: 'What containers are running?',
      })
    );

    // Should update the message with the response
    expect(mock.client.chat.update).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'C123TEST',
        ts: '1234.5678',
        blocks: expect.arrayContaining([
          expect.objectContaining({
            text: expect.objectContaining({
              text: 'Test response from Claude',
            }),
          }),
        ]),
      })
    );
  });

  it('should truncate long questions in section blocks but pass full question to Claude', async () => {
    const longQuestion = 'A'.repeat(6000);
    const mock = createMockCommand({ text: longQuestion });
    await askHandler(mock);

    // Should post initial message with truncated question in blocks
    const postCall = mock.client.chat.postMessage.mock.calls[0][0];
    const questionBlock = postCall.blocks.find(
      (b: Record<string, unknown>) => b.type === 'section' &&
        (b.text as Record<string, string>)?.text?.includes('Question:')
    );
    expect(questionBlock).toBeDefined();
    const blockText = (questionBlock.text as Record<string, string>).text;
    expect(blockText.length).toBeLessThan(3000);
    expect(blockText).toContain('[truncated]');

    // But the full question should be passed to Claude
    expect(mockProcessConversationTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        userMessage: longQuestion,
      })
    );
  });

  it('should include tool and token info in context block', async () => {
    mockProcessConversationTurn.mockResolvedValue(defaultTurnResult({
      toolCalls: [{ name: 'get_container_status', input: {}, outputPreview: '...' }],
      usage: { inputTokens: 500, outputTokens: 300 },
    }));

    const mock = createMockCommand();
    await askHandler(mock);

    // The context block should include tool count and token count
    expect(mock.client.chat.update).toHaveBeenCalledWith(
      expect.objectContaining({
        blocks: expect.arrayContaining([
          expect.objectContaining({
            type: 'context',
            elements: expect.arrayContaining([
              expect.objectContaining({
                text: expect.stringMatching(/Tools used: 1.*Tokens: 800/),
              }),
            ]),
          }),
        ]),
      })
    );
  });

  it('should show truncation notice when context was truncated', async () => {
    mockProcessConversationTurn.mockResolvedValue(defaultTurnResult({
      contextStatus: {
        wasTruncated: true,
        removedCount: 12,
        percentUsed: 0.79,
        isWarning: false,
      },
    }));

    const mock = createMockCommand();
    await askHandler(mock);

    expect(mock.client.chat.update).toHaveBeenCalledWith(
      expect.objectContaining({
        blocks: expect.arrayContaining([
          expect.objectContaining({
            type: 'context',
            elements: expect.arrayContaining([
              expect.objectContaining({
                text: expect.stringContaining('Conversation trimmed'),
              }),
            ]),
          }),
        ]),
      })
    );
  });

  it('should show warning when context is approaching limit', async () => {
    mockProcessConversationTurn.mockResolvedValue(defaultTurnResult({
      contextStatus: {
        wasTruncated: false,
        removedCount: 0,
        percentUsed: 0.75,
        isWarning: true,
      },
    }));

    const mock = createMockCommand();
    await askHandler(mock);

    expect(mock.client.chat.update).toHaveBeenCalledWith(
      expect.objectContaining({
        blocks: expect.arrayContaining([
          expect.objectContaining({
            type: 'context',
            elements: expect.arrayContaining([
              expect.objectContaining({
                text: expect.stringContaining('Long conversation'),
              }),
            ]),
          }),
        ]),
      })
    );
  });

  it('should not show context warning when usage is low', async () => {
    mockProcessConversationTurn.mockResolvedValue(defaultTurnResult({
      contextStatus: {
        wasTruncated: false,
        removedCount: 0,
        percentUsed: 0.3,
        isWarning: false,
      },
    }));

    const mock = createMockCommand();
    await askHandler(mock);

    const updateCall = mock.client.chat.update.mock.calls[0]?.[0] as { blocks?: { type: string; elements?: { text?: string }[] }[] } | undefined;
    const blocks = updateCall?.blocks ?? [];
    const contextBlocks = blocks.filter((b: { type: string; elements?: { text?: string }[] }) => b.type === 'context');
    // Should have the footer context block but no warning/truncation block
    const warningBlocks = contextBlocks.filter((b: { elements?: { text?: string }[] }) =>
      b.elements?.some((e: { text?: string }) =>
        e.text?.includes('trimmed') || e.text?.includes('Long conversation')
      )
    );
    expect(warningBlocks).toHaveLength(0);
  });

  it('should not show context warning when contextStatus is undefined', async () => {
    // Default result has no contextStatus
    mockProcessConversationTurn.mockResolvedValue(defaultTurnResult());

    const mock = createMockCommand();
    await askHandler(mock);

    const updateCall = mock.client.chat.update.mock.calls[0]?.[0] as { blocks?: { type: string; elements?: { text?: string }[] }[] } | undefined;
    const blocks = updateCall?.blocks ?? [];
    const contextBlocks = blocks.filter((b: { type: string; elements?: { text?: string }[] }) => b.type === 'context');
    const warningBlocks = contextBlocks.filter((b: { elements?: { text?: string }[] }) =>
      b.elements?.some((e: { text?: string }) =>
        e.text?.includes('trimmed') || e.text?.includes('Long conversation')
      )
    );
    expect(warningBlocks).toHaveLength(0);
  });

  it('should generate web link for long responses', async () => {
    // Enable web config
    mockConfig.web = {
      enabled: true,
      port: 8080,
      baseUrl: 'http://localhost:8080',
      authToken: 'test-token-1234567890123456',
      userTokens: new Map(),
      sessionTtlHours: 72,
    };

    // Return a response longer than SLACK_TEXT_LIMIT (2900 chars)
    const longResponse = 'A'.repeat(3000);
    mockProcessConversationTurn.mockResolvedValue(defaultTurnResult({
      response: longResponse,
    }));

    const mock = createMockCommand();
    await askHandler(mock);

    // Should call getConversationUrl
    expect(mockGetConversationUrl).toHaveBeenCalledWith(
      '1234.5678',
      'C123TEST',
      mockConfig.web,
      'U123TEST',
    );

    // Should update message with web link
    expect(mock.client.chat.update).toHaveBeenCalledWith(
      expect.objectContaining({
        blocks: expect.arrayContaining([
          expect.objectContaining({
            text: expect.objectContaining({
              text: expect.stringContaining('View full response'),
            }),
          }),
        ]),
      })
    );
  });

  it('should not generate web link when web is disabled', async () => {
    mockConfig.web = undefined;

    const longResponse = 'A'.repeat(3000);
    mockProcessConversationTurn.mockResolvedValue(defaultTurnResult({
      response: longResponse,
    }));

    const mock = createMockCommand();
    await askHandler(mock);

    // Should NOT call getConversationUrl
    expect(mockGetConversationUrl).not.toHaveBeenCalled();

    // Should still update with the (long) response directly
    expect(mock.client.chat.update).toHaveBeenCalled();
  });

  it('should handle processConversationTurn errors gracefully', async () => {
    mockProcessConversationTurn.mockRejectedValue(new Error('Claude CLI exited with code 1'));

    const mock = createMockCommand();
    await askHandler(mock);

    // Should try to update the thinking message with error
    expect(mock.client.chat.update).toHaveBeenCalledWith(
      expect.objectContaining({
        ts: '1234.5678',
        blocks: expect.arrayContaining([
          expect.objectContaining({
            text: expect.objectContaining({
              text: expect.stringContaining('Failed to get response'),
            }),
          }),
        ]),
      })
    );
  });

  it('should fall back to respond() when chat.update fails in error handler', async () => {
    mockProcessConversationTurn.mockRejectedValue(new Error('Claude failed'));
    const mock = createMockCommand();
    mock.client.chat.update.mockRejectedValue(new Error('message_not_found'));

    await askHandler(mock);

    // Should fall back to respond()
    expect(mock.respond).toHaveBeenCalledWith(
      expect.objectContaining({
        response_type: 'ephemeral',
        blocks: expect.arrayContaining([
          expect.objectContaining({
            text: expect.objectContaining({
              text: expect.stringContaining('Failed to get response'),
            }),
          }),
        ]),
      })
    );
  });

  it('should fall back to postMessage when both update and respond fail', async () => {
    mockProcessConversationTurn.mockRejectedValue(new Error('Claude failed'));
    const mock = createMockCommand();
    mock.client.chat.update.mockRejectedValue(new Error('message_not_found'));
    mock.respond.mockRejectedValue(new Error('response_url expired'));

    await askHandler(mock);

    // The first postMessage call posts the "thinking" message, second is fallback error
    const postCalls = mock.client.chat.postMessage.mock.calls;
    const errorCall = postCalls.find(
      (call: unknown[]) => {
        const arg = call[0] as Record<string, unknown>;
        return typeof arg.text === 'string' && arg.text.includes('Sorry, I encountered an error');
      }
    );
    expect(errorCall).toBeDefined();
  });

  it('should delegate to handleContinue for /ask continue <thread_ts>', async () => {
    const store = createMockStore();
    store.getConversationByThreadTs.mockReturnValue({
      id: 1,
      threadTs: '9876.5432',
      channelId: 'C123TEST',
      userId: 'U123TEST',
      messages: [
        { role: 'user', content: 'original question' },
        { role: 'assistant', content: 'original answer' },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    mockGetConversationStore.mockReturnValue(store);

    const mock = createMockCommand({ text: 'continue 9876.5432' });
    await askHandler(mock);

    expect(mock.ack).toHaveBeenCalledTimes(1);
    // handleContinue should look up conversation by thread_ts
    expect(store.getConversationByThreadTs).toHaveBeenCalledWith('9876.5432');
  });

  it('should initialize default context when contextDir is set', async () => {
    // Test verifies that registerAskCommand calls initDefaultContext
    // when config.claude.contextDir is set. We set it and re-register.
    mockConfig.claude = {
      rateLimitMax: 5,
      rateLimitWindowSeconds: 60,
      dbPath: ':memory:',
      conversationTtlHours: 24,
      contextDir: '/opt/infrastructure',
    };

    const freshApp = { command: vi.fn(), event: vi.fn() };
    const { registerAskCommand: register } = await import('../../src/commands/ask.js');
    await register(freshApp as unknown as App);

    expect(mockInitDefaultContext).toHaveBeenCalledWith('/opt/infrastructure');
  });

  // ──────────────────────────────────────────
  // handleContinue sub-tests
  // ──────────────────────────────────────────

  describe('handleContinue (via /ask continue)', () => {
    it('should reject invalid thread_ts format', async () => {
      const mock = createMockCommand({ text: 'continue invalid-ts' });
      await askHandler(mock);

      expect(mock.respond).toHaveBeenCalledWith(
        expect.objectContaining({
          response_type: 'ephemeral',
          blocks: expect.arrayContaining([
            expect.objectContaining({
              text: expect.objectContaining({
                text: expect.stringContaining('Invalid thread timestamp format'),
              }),
            }),
          ]),
        })
      );
      expect(mockProcessConversationTurn).not.toHaveBeenCalled();
    });

    it('should respond with error when conversation not found', async () => {
      const store = createMockStore();
      store.getConversationByThreadTs.mockReturnValue(null);
      mockGetConversationStore.mockReturnValue(store);

      const mock = createMockCommand({ text: 'continue 9876.5432' });
      await askHandler(mock);

      expect(mock.respond).toHaveBeenCalledWith(
        expect.objectContaining({
          response_type: 'ephemeral',
          blocks: expect.arrayContaining([
            expect.objectContaining({
              text: expect.objectContaining({
                text: expect.stringContaining('No conversation found'),
              }),
            }),
          ]),
        })
      );
      expect(mockProcessConversationTurn).not.toHaveBeenCalled();
    });

    it('should check rate limit after conversation lookup', async () => {
      const store = createMockStore();
      store.getConversationByThreadTs.mockReturnValue({
        id: 1,
        threadTs: '9876.5432',
        channelId: 'C123TEST',
        userId: 'U123TEST',
        messages: [{ role: 'user', content: 'test' }],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      mockGetConversationStore.mockReturnValue(store);

      // Exhaust rate limit
      for (let i = 0; i < 5; i++) {
        checkAndRecordClaudeRequest('U123TEST');
      }

      const mock = createMockCommand({ text: 'continue 9876.5432' });
      await askHandler(mock);

      // Should find conversation first, then check rate limit
      expect(store.getConversationByThreadTs).toHaveBeenCalledWith('9876.5432');
      expect(mock.respond).toHaveBeenCalledWith(
        expect.objectContaining({
          response_type: 'ephemeral',
          blocks: expect.arrayContaining([
            expect.objectContaining({
              text: expect.objectContaining({
                text: expect.stringContaining('Rate limit exceeded'),
              }),
            }),
          ]),
        })
      );
      expect(mockProcessConversationTurn).not.toHaveBeenCalled();
    });

    it('should create new thread with original history', async () => {
      const store = createMockStore();
      const originalMessages = [
        { role: 'user' as const, content: 'original question' },
        { role: 'assistant' as const, content: 'original answer' },
      ];
      store.getConversationByThreadTs.mockReturnValue({
        id: 1,
        threadTs: '9876.5432',
        channelId: 'C123TEST',
        userId: 'U123TEST',
        messages: originalMessages,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      mockGetConversationStore.mockReturnValue(store);

      const mock = createMockCommand({ text: 'continue 9876.5432 follow up question' });
      await askHandler(mock);

      // Should create new conversation with original messages + new question
      expect(store.createConversation).toHaveBeenCalledWith(
        '1234.5678', // new thread ts from postMessage
        'C123TEST',
        'U123TEST',
        [
          ...originalMessages,
          { role: 'user', content: 'follow up question' },
        ],
      );

      // Should process the turn
      expect(mockProcessConversationTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          userMessage: 'follow up question',
        })
      );
    });

    it('should use default question when no follow-up provided', async () => {
      const store = createMockStore();
      store.getConversationByThreadTs.mockReturnValue({
        id: 1,
        threadTs: '9876.5432',
        channelId: 'C123TEST',
        userId: 'U123TEST',
        messages: [{ role: 'user', content: 'test' }],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      mockGetConversationStore.mockReturnValue(store);

      const mock = createMockCommand({ text: 'continue 9876.5432' });
      await askHandler(mock);

      // Should use default continuation question
      expect(store.createConversation).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: expect.stringContaining('continue where we left off'),
          }),
        ]),
      );
    });

    it('should handle errors in continue and respond with error', async () => {
      const store = createMockStore();
      store.getConversationByThreadTs.mockReturnValue({
        id: 1,
        threadTs: '9876.5432',
        channelId: 'C123TEST',
        userId: 'U123TEST',
        messages: [{ role: 'user', content: 'test' }],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      mockGetConversationStore.mockReturnValue(store);
      mockProcessConversationTurn.mockRejectedValue(new Error('Claude timeout'));

      const mock = createMockCommand({ text: 'continue 9876.5432' });
      await askHandler(mock);

      expect(mock.respond).toHaveBeenCalledWith(
        expect.objectContaining({
          response_type: 'ephemeral',
          blocks: expect.arrayContaining([
            expect.objectContaining({
              text: expect.objectContaining({
                text: expect.stringContaining('Failed to continue conversation'),
              }),
            }),
          ]),
        })
      );
    });

    it('should include context warning blocks when truncated', async () => {
      const store = createMockStore();
      store.getConversationByThreadTs.mockReturnValue({
        id: 1,
        threadTs: '9876.5432',
        channelId: 'C123TEST',
        userId: 'U123TEST',
        messages: [
          { role: 'user', content: 'original question' },
          { role: 'assistant', content: 'original answer' },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      mockGetConversationStore.mockReturnValue(store);
      mockProcessConversationTurn.mockResolvedValue(defaultTurnResult({
        contextStatus: {
          wasTruncated: true,
          removedCount: 5,
          percentUsed: 0.78,
          isWarning: false,
        },
      }));

      const mock = createMockCommand({ text: 'continue 9876.5432 more questions' });
      await askHandler(mock);

      expect(mock.client.chat.update).toHaveBeenCalledWith(
        expect.objectContaining({
          blocks: expect.arrayContaining([
            expect.objectContaining({
              type: 'context',
              elements: expect.arrayContaining([
                expect.objectContaining({
                  text: expect.stringContaining('Conversation trimmed'),
                }),
              ]),
            }),
          ]),
        })
      );
    });
  });

  // ──────────────────────────────────────────
  // Thread handler sub-tests
  // ──────────────────────────────────────────

  describe('registerThreadHandler', () => {
    function createThreadEvent(overrides: Record<string, unknown> = {}) {
      return {
        channel: 'C123TEST',
        user: 'U123TEST',
        text: 'follow up question',
        thread_ts: '1234.5678',
        ...overrides,
      };
    }

    function createMockClient() {
      return {
        chat: {
          postMessage: vi.fn().mockResolvedValue({ ok: true, ts: '5555.6666' }),
          update: vi.fn().mockResolvedValue({ ok: true }),
        },
      };
    }

    beforeEach(() => {
      // Set up store with tracked conversation
      const store = createMockStore();
      store.getConversation.mockReturnValue({
        id: 1,
        threadTs: '1234.5678',
        channelId: 'C123TEST',
        userId: 'U123TEST',
        messages: [{ role: 'user', content: 'original' }],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      mockGetConversationStore.mockReturnValue(store);
      mockProcessConversationTurn.mockResolvedValue(defaultTurnResult());
    });

    it('should ignore messages without thread_ts', async () => {
      const handler = assertMessageHandler(messageHandler);
      const client = createMockClient();

      await handler({
        event: createThreadEvent({ thread_ts: undefined }),
        client,
      });

      expect(mockProcessConversationTurn).not.toHaveBeenCalled();
    });

    it('should ignore bot messages', async () => {
      const handler = assertMessageHandler(messageHandler);
      const client = createMockClient();

      await handler({
        event: createThreadEvent({ bot_id: 'B123' }),
        client,
      });

      expect(mockProcessConversationTurn).not.toHaveBeenCalled();
    });

    it('should ignore messages with subtypes', async () => {
      const handler = assertMessageHandler(messageHandler);
      const client = createMockClient();

      await handler({
        event: createThreadEvent({ subtype: 'message_changed' }),
        client,
      });

      expect(mockProcessConversationTurn).not.toHaveBeenCalled();
    });

    it('should ignore messages from users not in the users table', async () => {
      // #278: DB is the sole source of truth at request time.
      mockGetBySlackId.mockReturnValueOnce(null);

      const handler = assertMessageHandler(messageHandler);
      const client = createMockClient();

      await handler({
        event: createThreadEvent({ user: 'UUNAUTHORIZED' }),
        client,
      });

      expect(mockProcessConversationTurn).not.toHaveBeenCalled();
    });

    it('should ignore messages from deactivated users', async () => {
      // #278: even if a user exists in the table, isActive=false rejects.
      mockGetBySlackId.mockReturnValueOnce({
        id: 1,
        slackId: 'U123TEST',
        role: 'user',
        isActive: false,
      });

      const handler = assertMessageHandler(messageHandler);
      const client = createMockClient();

      await handler({
        event: createThreadEvent({ user: 'U123TEST' }),
        client,
      });

      expect(mockProcessConversationTurn).not.toHaveBeenCalled();
    });

    it('should fail closed when UserStore throws', async () => {
      // #278: storage errors must reject the request, not fall back to env.
      mockGetBySlackId.mockImplementationOnce(() => {
        throw new Error('database is locked');
      });

      const handler = assertMessageHandler(messageHandler);
      const client = createMockClient();

      await handler({
        event: createThreadEvent({ user: 'U123TEST' }),
        client,
      });

      expect(mockProcessConversationTurn).not.toHaveBeenCalled();
    });

    it('should ignore messages not in tracked conversations', async () => {
      const store = createMockStore();
      store.getConversation.mockReturnValue(null);
      mockGetConversationStore.mockReturnValue(store);

      const handler = assertMessageHandler(messageHandler);
      const client = createMockClient();

      await handler({
        event: createThreadEvent({ thread_ts: '9999.0000' }),
        client,
      });

      expect(mockProcessConversationTurn).not.toHaveBeenCalled();
    });

    it('should call Claude with conversation history for thread replies', async () => {
      const handler = assertMessageHandler(messageHandler);
      const client = createMockClient();

      await handler({
        event: createThreadEvent({ text: 'follow up question in thread' }),
        client,
      });

      // Should post a thinking message in the thread
      expect(client.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'C123TEST',
          thread_ts: '1234.5678',
          text: 'Analyzing...',
        })
      );

      // Should process the conversation turn
      expect(mockProcessConversationTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          threadTs: '1234.5678',
          channelId: 'C123TEST',
          userId: 'U123TEST',
          userMessage: 'follow up question in thread',
        })
      );

      // Should update the thinking message with the response
      expect(client.chat.update).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'C123TEST',
          ts: '5555.6666',
          blocks: expect.arrayContaining([
            expect.objectContaining({
              text: expect.objectContaining({
                text: 'Test response from Claude',
              }),
            }),
          ]),
        })
      );
    });

    it('should handle rate limit for thread replies', async () => {
      // Exhaust rate limit
      for (let i = 0; i < 5; i++) {
        checkAndRecordClaudeRequest('U123TEST');
      }

      const handler = assertMessageHandler(messageHandler);
      const client = createMockClient();

      await handler({
        event: createThreadEvent(),
        client,
      });

      // Should post rate limit message in thread
      expect(client.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'C123TEST',
          thread_ts: '1234.5678',
          text: expect.stringContaining('Rate limit exceeded'),
        })
      );
      expect(mockProcessConversationTurn).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully with fallback messaging', async () => {
      mockProcessConversationTurn.mockRejectedValueOnce(new Error('Claude CLI crashed'));

      const handler = assertMessageHandler(messageHandler);
      const client = createMockClient();

      // Should not throw - error is caught internally
      await handler({
        event: createThreadEvent({ text: 'question that causes error' }),
        client,
      });

      // Should have posted at least the thinking message
      expect(client.chat.postMessage).toHaveBeenCalled();

      // Should have attempted to send an error message (either via postMessage or update)
      // The thread handler catches errors and posts an error message in the thread
      const allPostCalls = client.chat.postMessage.mock.calls;
      const allUpdateCalls = client.chat.update.mock.calls;
      const totalCalls = allPostCalls.length + allUpdateCalls.length;
      // At minimum: 1 thinking message + 1 error message attempt
      expect(totalCalls).toBeGreaterThanOrEqual(2);
    });

    it('should not register handler when Claude is disabled', async () => {
      mockConfig.claude = undefined;

      const mockApp = { command: vi.fn(), event: vi.fn() };
      const { registerThreadHandler: register } = await import('../../src/commands/ask.js');
      register(mockApp as unknown as App);

      expect(mockApp.event).not.toHaveBeenCalled();
    });

    it('should generate web link for long thread responses', async () => {
      mockConfig.web = {
        enabled: true,
        port: 8080,
        baseUrl: 'http://localhost:8080',
        authToken: 'test-token-1234567890123456',
        userTokens: new Map(),
        sessionTtlHours: 72,
      };

      const longResponse = 'B'.repeat(3000);
      mockProcessConversationTurn.mockResolvedValue(defaultTurnResult({
        response: longResponse,
      }));

      const handler = assertMessageHandler(messageHandler);
      const client = createMockClient();

      await handler({
        event: createThreadEvent({ text: 'question needing long answer' }),
        client,
      });

      expect(mockGetConversationUrl).toHaveBeenCalled();
      expect(client.chat.update).toHaveBeenCalledWith(
        expect.objectContaining({
          blocks: expect.arrayContaining([
            expect.objectContaining({
              text: expect.objectContaining({
                text: expect.stringContaining('View full response'),
              }),
            }),
          ]),
        })
      );
    });

    it('should process image file uploads in thread replies', async () => {
      const handler = assertMessageHandler(messageHandler);
      const client = createMockClient();

      await handler({
        event: createThreadEvent({
          text: 'What is in this image?',
          files: [{
            id: 'F123',
            name: 'screenshot.png',
            mimetype: 'image/png',
            filetype: 'png',
            size: 500000,
            url_private_download: 'https://files.slack.com/files-pri/T123/screenshot.png',
          }],
        }),
        client,
      });

      // Should process the message with askOptions containing localImagePath
      expect(mockProcessConversationTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          userMessage: 'What is in this image?',
          askOptions: expect.objectContaining({
            localImagePath: expect.stringContaining('.png'),
          }),
        })
      );
    });

    it('should allow file_share subtype for thread replies with files', async () => {
      const handler = assertMessageHandler(messageHandler);
      const client = createMockClient();

      await handler({
        event: createThreadEvent({
          subtype: 'file_share',
          text: 'check this',
          files: [{
            id: 'F456',
            name: 'photo.jpg',
            mimetype: 'image/jpeg',
            filetype: 'jpg',
            size: 100000,
            url_private_download: 'https://files.slack.com/files-pri/T123/photo.jpg',
          }],
        }),
        client,
      });

      expect(mockProcessConversationTurn).toHaveBeenCalled();
    });

    it('should ignore non-image files in thread replies', async () => {
      const handler = assertMessageHandler(messageHandler);
      const client = createMockClient();

      await handler({
        event: createThreadEvent({
          text: 'check this file',
          files: [{
            id: 'F789',
            name: 'document.pdf',
            mimetype: 'application/pdf',
            filetype: 'pdf',
            size: 100000,
            url_private_download: 'https://files.slack.com/files-pri/T123/document.pdf',
          }],
        }),
        client,
      });

      // Should still process the text, just without image
      expect(mockProcessConversationTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          userMessage: 'check this file',
        })
      );
      // askOptions should not have localImagePath
      const callArgs = mockProcessConversationTurn.mock.calls[0][0];
      expect(callArgs.askOptions).toBeUndefined();
    });

    it('should include context warning blocks when truncated in thread reply', async () => {
      mockProcessConversationTurn.mockResolvedValue(defaultTurnResult({
        contextStatus: {
          wasTruncated: true,
          removedCount: 8,
          percentUsed: 0.77,
          isWarning: false,
        },
      }));

      const handler = assertMessageHandler(messageHandler);
      const client = createMockClient();

      await handler({
        event: createThreadEvent({ text: 'question about containers' }),
        client,
      });

      expect(client.chat.update).toHaveBeenCalledWith(
        expect.objectContaining({
          blocks: expect.arrayContaining([
            expect.objectContaining({
              type: 'context',
              elements: expect.arrayContaining([
                expect.objectContaining({
                  text: expect.stringContaining('Conversation trimmed'),
                }),
              ]),
            }),
          ]),
        })
      );
    });
  });
});

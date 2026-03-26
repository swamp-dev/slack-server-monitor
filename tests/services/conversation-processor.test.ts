import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ConversationStore } from '../../src/services/conversation-store.js';

// Mock dependencies
vi.mock('../../src/config/index.js', () => ({
  config: {
    claude: {
      provider: 'cli',
      cliPath: 'claude',
      cliModel: 'sonnet',
      sdkModel: 'claude-sonnet-4-20250514',
      maxTokens: 2048,
      maxToolCalls: 40,
      maxIterations: 50,
      rateLimitMax: 5,
      rateLimitWindowSeconds: 60,
      conversationTtlHours: 24,
      dbPath: './data/test.db',
      allowedDirs: ['/tmp'],
      maxFileSizeKb: 100,
      maxLogLines: 50,
      contextDir: undefined,
      contextOptions: [],
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

const mockAsk = vi.fn();
vi.mock('../../src/services/claude.js', () => ({
  getClaudeService: vi.fn(() => ({
    ask: mockAsk,
    providerName: 'cli',
    supportsImages: true,
  })),
}));

vi.mock('../../src/services/context-store.js', () => ({
  getContextStore: vi.fn(() => ({
    getChannelContext: vi.fn(() => null),
  })),
}));

vi.mock('../../src/services/user-config.js', () => ({
  loadUserConfig: vi.fn().mockResolvedValue({
    disabledTools: [],
    toolConfig: { allowedDirs: ['/tmp'], maxFileSizeKb: 100, maxLogLines: 50 },
  }),
}));

// We need to mock getConversationStore to return our test store
let testStore: ConversationStore;
vi.mock('../../src/services/conversation-store.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    getConversationStore: vi.fn(() => testStore),
  };
});

describe('processConversationTurn', () => {
  let testDbPath: string;

  beforeEach(() => {
    vi.clearAllMocks();
    testDbPath = path.join(os.tmpdir(), `test-processor-${Date.now()}.db`);
    testStore = new ConversationStore(testDbPath, 24);

    mockAsk.mockResolvedValue({
      response: 'Claude response here',
      toolCalls: [
        {
          name: 'get_disk_usage',
          input: { mount: '/' },
          outputPreview: '45% used',
          durationMs: 100,
          isError: false,
        },
      ],
      usage: { inputTokens: 100, outputTokens: 200 },
    });
  });

  afterEach(() => {
    testStore.close();
    try { fs.unlinkSync(testDbPath); } catch { /* ignore */ }
    try { fs.unlinkSync(testDbPath + '-wal'); } catch { /* ignore */ }
    try { fs.unlinkSync(testDbPath + '-shm'); } catch { /* ignore */ }
  });

  it('should call Claude with correct history and store the response', async () => {
    const { processConversationTurn } = await import('../../src/services/conversation-processor.js');

    // Create a conversation with existing history
    const conversation = testStore.createConversation('1234.5678', 'C123', 'U456', [
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'First answer' },
      { role: 'user', content: 'Follow-up question' },
    ]);

    const result = await processConversationTurn({
      conversationId: conversation.id,
      threadTs: '1234.5678',
      channelId: 'C123',
      userId: 'U456',
      userMessage: 'Follow-up question',
      claudeConfig: {
        provider: 'cli' as const,
        cliPath: 'claude',
        cliModel: 'sonnet',
        sdkModel: 'claude-sonnet-4-20250514',
        maxTokens: 2048,
        maxToolCalls: 40,
        maxIterations: 50,
        rateLimitMax: 5,
        rateLimitWindowSeconds: 60,
        conversationTtlHours: 24,
        dbPath: testDbPath,
        allowedDirs: ['/tmp'],
        maxFileSizeKb: 100,
        maxLogLines: 50,
        contextOptions: [],
      },
    });

    // Verify Claude was called with the right history (everything except the last message)
    expect(mockAsk).toHaveBeenCalledWith(
      'Follow-up question',
      [
        { role: 'user', content: 'First question' },
        { role: 'assistant', content: 'First answer' },
      ],
      expect.any(Object),
      undefined
    );

    // Verify the result
    expect(result.response).toBe('Claude response here');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.usage.inputTokens).toBe(100);

    // Verify response was stored
    const updated = testStore.getConversation('1234.5678', 'C123');
    expect(updated?.messages).toHaveLength(4); // 3 original + 1 assistant
    expect(updated?.messages[3]?.content).toBe('Claude response here');

    // Verify tool call was logged
    const toolCalls = testStore.getToolCalls(conversation.id);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]?.toolName).toBe('get_disk_usage');
  });

  it('should forward askOptions to Claude', async () => {
    const { processConversationTurn } = await import('../../src/services/conversation-processor.js');

    const conversation = testStore.createConversation('1234.5678', 'C123', 'U456', [
      { role: 'user', content: 'Analyze this image' },
    ]);

    const imageOptions = {
      images: [{ data: 'base64data', mediaType: 'image/png' as const }],
    };

    await processConversationTurn({
      conversationId: conversation.id,
      threadTs: '1234.5678',
      channelId: 'C123',
      userId: 'U456',
      userMessage: 'Analyze this image',
      claudeConfig: {
        provider: 'cli' as const,
        cliPath: 'claude',
        cliModel: 'sonnet',
        sdkModel: 'claude-sonnet-4-20250514',
        maxTokens: 2048,
        maxToolCalls: 40,
        maxIterations: 50,
        rateLimitMax: 5,
        rateLimitWindowSeconds: 60,
        conversationTtlHours: 24,
        dbPath: testDbPath,
        allowedDirs: ['/tmp'],
        maxFileSizeKb: 100,
        maxLogLines: 50,
        contextOptions: [],
      },
      askOptions: imageOptions,
    });

    // Verify askOptions were forwarded to Claude
    expect(mockAsk).toHaveBeenCalledWith(
      'Analyze this image',
      [], // No history for single-message conversation
      expect.any(Object),
      imageOptions
    );
  });

  it('should pass empty history for first message in conversation', async () => {
    const { processConversationTurn } = await import('../../src/services/conversation-processor.js');

    const conversation = testStore.createConversation('first.msg', 'C123', 'U456', [
      { role: 'user', content: 'First ever question' },
    ]);

    await processConversationTurn({
      conversationId: conversation.id,
      threadTs: 'first.msg',
      channelId: 'C123',
      userId: 'U456',
      userMessage: 'First ever question',
      claudeConfig: {
        provider: 'cli' as const,
        cliPath: 'claude',
        cliModel: 'sonnet',
        sdkModel: 'claude-sonnet-4-20250514',
        maxTokens: 2048,
        maxToolCalls: 40,
        maxIterations: 50,
        rateLimitMax: 5,
        rateLimitWindowSeconds: 60,
        conversationTtlHours: 24,
        dbPath: testDbPath,
        allowedDirs: ['/tmp'],
        maxFileSizeKb: 100,
        maxLogLines: 50,
        contextOptions: [],
      },
    });

    // First message should have empty history
    expect(mockAsk).toHaveBeenCalledWith(
      'First ever question',
      [],
      expect.any(Object),
      undefined
    );
  });

  it('should handle response with no tool calls', async () => {
    const { processConversationTurn } = await import('../../src/services/conversation-processor.js');

    mockAsk.mockResolvedValue({
      response: 'Simple response without tools',
      toolCalls: [],
      usage: { inputTokens: 50, outputTokens: 80 },
    });

    const conversation = testStore.createConversation('no.tools', 'C123', 'U456', [
      { role: 'user', content: 'Simple question' },
    ]);

    const result = await processConversationTurn({
      conversationId: conversation.id,
      threadTs: 'no.tools',
      channelId: 'C123',
      userId: 'U456',
      userMessage: 'Simple question',
      claudeConfig: {
        provider: 'cli' as const,
        cliPath: 'claude',
        cliModel: 'sonnet',
        sdkModel: 'claude-sonnet-4-20250514',
        maxTokens: 2048,
        maxToolCalls: 40,
        maxIterations: 50,
        rateLimitMax: 5,
        rateLimitWindowSeconds: 60,
        conversationTtlHours: 24,
        dbPath: testDbPath,
        allowedDirs: ['/tmp'],
        maxFileSizeKb: 100,
        maxLogLines: 50,
        contextOptions: [],
      },
    });

    expect(result.response).toBe('Simple response without tools');
    expect(result.toolCalls).toHaveLength(0);
    expect(result.usage.inputTokens).toBe(50);
    expect(result.usage.outputTokens).toBe(80);

    // Verify no tool calls were logged
    const toolCalls = testStore.getToolCalls(conversation.id);
    expect(toolCalls).toHaveLength(0);
  });

  it('should log multiple tool calls', async () => {
    const { processConversationTurn } = await import('../../src/services/conversation-processor.js');

    mockAsk.mockResolvedValue({
      response: 'Checked multiple things',
      toolCalls: [
        { name: 'get_disk_usage', input: {}, outputPreview: '45%', durationMs: 50, isError: false },
        { name: 'get_system_resources', input: {}, outputPreview: 'CPU: 20%', durationMs: 30, isError: false },
        { name: 'get_container_status', input: { name: 'nginx' }, outputPreview: 'running', durationMs: 40, isError: false },
      ],
      usage: { inputTokens: 200, outputTokens: 300 },
    });

    const conversation = testStore.createConversation('multi.tools', 'C123', 'U456', [
      { role: 'user', content: 'Check everything' },
    ]);

    const result = await processConversationTurn({
      conversationId: conversation.id,
      threadTs: 'multi.tools',
      channelId: 'C123',
      userId: 'U456',
      userMessage: 'Check everything',
      claudeConfig: {
        provider: 'cli' as const,
        cliPath: 'claude',
        cliModel: 'sonnet',
        sdkModel: 'claude-sonnet-4-20250514',
        maxTokens: 2048,
        maxToolCalls: 40,
        maxIterations: 50,
        rateLimitMax: 5,
        rateLimitWindowSeconds: 60,
        conversationTtlHours: 24,
        dbPath: testDbPath,
        allowedDirs: ['/tmp'],
        maxFileSizeKb: 100,
        maxLogLines: 50,
        contextOptions: [],
      },
    });

    expect(result.toolCalls).toHaveLength(3);

    // Verify all tool calls were logged in the store
    const loggedCalls = testStore.getToolCalls(conversation.id);
    expect(loggedCalls).toHaveLength(3);
    const toolNames = loggedCalls.map(tc => tc.toolName).sort();
    expect(toolNames).toEqual([
      'get_container_status',
      'get_disk_usage',
      'get_system_resources',
    ]);
  });

  it('should log tool call errors correctly', async () => {
    const { processConversationTurn } = await import('../../src/services/conversation-processor.js');

    mockAsk.mockResolvedValue({
      response: 'There was an error',
      toolCalls: [
        { name: 'run_command', input: { command: 'bad' }, outputPreview: 'Command not allowed', durationMs: 5, isError: true },
      ],
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    const conversation = testStore.createConversation('error.tool', 'C123', 'U456', [
      { role: 'user', content: 'Run bad command' },
    ]);

    await processConversationTurn({
      conversationId: conversation.id,
      threadTs: 'error.tool',
      channelId: 'C123',
      userId: 'U456',
      userMessage: 'Run bad command',
      claudeConfig: {
        provider: 'cli' as const,
        cliPath: 'claude',
        cliModel: 'sonnet',
        sdkModel: 'claude-sonnet-4-20250514',
        maxTokens: 2048,
        maxToolCalls: 40,
        maxIterations: 50,
        rateLimitMax: 5,
        rateLimitWindowSeconds: 60,
        conversationTtlHours: 24,
        dbPath: testDbPath,
        allowedDirs: ['/tmp'],
        maxFileSizeKb: 100,
        maxLogLines: 50,
        contextOptions: [],
      },
    });

    const loggedCalls = testStore.getToolCalls(conversation.id);
    expect(loggedCalls).toHaveLength(1);
    expect(loggedCalls[0]?.success).toBe(false);
  });

  it('should throw when conversation is not found', async () => {
    const { processConversationTurn } = await import('../../src/services/conversation-processor.js');

    await expect(processConversationTurn({
      conversationId: 99999,
      threadTs: 'nonexistent',
      channelId: 'C123',
      userId: 'U456',
      userMessage: 'Hello',
      claudeConfig: {
        provider: 'cli' as const,
        cliPath: 'claude',
        cliModel: 'sonnet',
        sdkModel: 'claude-sonnet-4-20250514',
        maxTokens: 2048,
        maxToolCalls: 40,
        maxIterations: 50,
        rateLimitMax: 5,
        rateLimitWindowSeconds: 60,
        conversationTtlHours: 24,
        dbPath: testDbPath,
        allowedDirs: ['/tmp'],
        maxFileSizeKb: 100,
        maxLogLines: 50,
        contextOptions: [],
      },
    })).rejects.toThrow('Conversation 99999 not found');
  });
});

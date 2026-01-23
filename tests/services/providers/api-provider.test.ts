import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiProvider } from '../../../src/services/providers/api-provider.js';
import type { ConversationMessage, UserConfig } from '../../../src/services/providers/types.js';

// Mock the Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn(),
    },
  })),
}));

// Mock getToolSpecs and executeTool
vi.mock('../../../src/services/tools/index.js', () => ({
  getToolSpecs: vi.fn().mockReturnValue([
    { name: 'test_tool', description: 'A test tool', input_schema: { type: 'object' } },
  ]),
  executeTool: vi.fn().mockResolvedValue({
    toolUseId: 'test-id',
    content: 'tool result',
    isError: false,
  }),
}));

// Mock buildSystemPrompt
vi.mock('../../../src/config/prompts.js', () => ({
  buildSystemPrompt: vi.fn().mockReturnValue('System prompt'),
}));

// Mock scrubSensitiveData
vi.mock('../../../src/formatters/scrub.js', () => ({
  scrubSensitiveData: vi.fn((text: string) => text),
}));

// Mock logger
vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('ApiProvider', () => {
  const config = {
    apiKey: 'test-api-key',
    model: 'claude-sonnet-4-20250514',
    maxTokens: 2048,
    maxToolCalls: 10,
    maxIterations: 20,
  };

  const defaultUserConfig: UserConfig = {
    disabledTools: [],
    toolConfig: {
      allowedDirs: ['/opt'],
      maxFileSizeKb: 100,
      maxLogLines: 50,
    },
  };

  describe('constructor', () => {
    it('should create provider with correct name', () => {
      const provider = new ApiProvider(config);
      expect(provider.name).toBe('api');
    });

    it('should track tokens', () => {
      const provider = new ApiProvider(config);
      expect(provider.tracksTokens).toBe(true);
    });
  });

  describe('buildMessages', () => {
    function buildMessages(history: ConversationMessage[], newQuestion: string) {
      const provider = new ApiProvider(config);
      const build = (
        provider as unknown as {
          buildMessages: (h: ConversationMessage[], q: string) => { role: string; content: string }[];
        }
      ).buildMessages.bind(provider);
      return build(history, newQuestion);
    }

    it('should build messages from empty history', () => {
      const result = buildMessages([], 'What is the server status?');

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        role: 'user',
        content: 'What is the server status?',
      });
    });

    it('should include conversation history', () => {
      const history: ConversationMessage[] = [
        { role: 'user', content: 'First question' },
        { role: 'assistant', content: 'First answer' },
      ];

      const result = buildMessages(history, 'Follow up question');

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ role: 'user', content: 'First question' });
      expect(result[1]).toEqual({ role: 'assistant', content: 'First answer' });
      expect(result[2]).toEqual({ role: 'user', content: 'Follow up question' });
    });

    it('should preserve message order', () => {
      const history: ConversationMessage[] = [
        { role: 'user', content: 'Q1' },
        { role: 'assistant', content: 'A1' },
        { role: 'user', content: 'Q2' },
        { role: 'assistant', content: 'A2' },
      ];

      const result = buildMessages(history, 'Q3');

      expect(result).toHaveLength(5);
      expect(result.map((m: { role: string; content: string }) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user']);
    });
  });

  describe('extractPartialResponse', () => {
    function extractPartialResponse(content: { type: string; text?: string }[]) {
      const provider = new ApiProvider(config);
      const extract = (
        provider as unknown as {
          extractPartialResponse: (c: { type: string; text?: string }[]) => string;
        }
      ).extractPartialResponse.bind(provider);
      return extract(content);
    }

    it('should extract text from text blocks', () => {
      const content = [{ type: 'text', text: 'This is the response.' }];

      const result = extractPartialResponse(content);

      expect(result).toBe('This is the response.');
    });

    it('should join multiple text blocks', () => {
      const content = [
        { type: 'text', text: 'First part.' },
        { type: 'text', text: 'Second part.' },
      ];

      const result = extractPartialResponse(content);

      expect(result).toBe('First part.\nSecond part.');
    });

    it('should ignore non-text blocks', () => {
      const content = [
        { type: 'text', text: 'Text content' },
        { type: 'tool_use' },
        { type: 'text', text: 'More text' },
      ];

      const result = extractPartialResponse(content);

      expect(result).toBe('Text content\nMore text');
    });

    it('should return default message for empty content', () => {
      const result = extractPartialResponse([]);

      expect(result).toBe('No partial response available.');
    });

    it('should return default message when no text blocks', () => {
      const content = [{ type: 'tool_use' }];

      const result = extractPartialResponse(content);

      expect(result).toBe('No partial response available.');
    });
  });

  describe('ask', () => {
    let mockCreate: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      vi.clearAllMocks();

      // Reset the mock to get fresh instance
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      mockCreate = vi.fn();
      (Anthropic as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        messages: { create: mockCreate },
      }));
    });

    it('should return response when no tool calls', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'The server is healthy.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const provider = new ApiProvider(config);
      const result = await provider.ask('How is the server?', [], defaultUserConfig);

      expect(result.response).toBe('The server is healthy.');
      expect(result.toolCalls).toHaveLength(0);
      expect(result.usage.inputTokens).toBe(100);
      expect(result.usage.outputTokens).toBe(50);
    });

    it('should execute tool calls and continue', async () => {
      const { executeTool } = await import('../../../src/services/tools/index.js');

      // First call returns tool use
      mockCreate.mockResolvedValueOnce({
        content: [
          { type: 'text', text: 'Let me check.' },
          { type: 'tool_use', id: 'tool-1', name: 'get_container_status', input: {} },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      // Second call returns final response
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'All containers are running.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 150, output_tokens: 75 },
      });

      const provider = new ApiProvider(config);
      const result = await provider.ask('Check containers', [], defaultUserConfig);

      expect(executeTool).toHaveBeenCalledOnce();
      expect(result.response).toBe('All containers are running.');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('get_container_status');
      expect(result.usage.inputTokens).toBe(250);
      expect(result.usage.outputTokens).toBe(125);
    });

    it('should respect maxToolCalls limit', async () => {
      const limitedConfig = { ...config, maxToolCalls: 2 };

      // Return tool calls for each iteration
      mockCreate.mockResolvedValue({
        content: [
          { type: 'text', text: 'Checking...' },
          { type: 'tool_use', id: 'tool-1', name: 'test_tool', input: {} },
          { type: 'tool_use', id: 'tool-2', name: 'test_tool', input: {} },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const provider = new ApiProvider(limitedConfig);
      const result = await provider.ask('Keep checking', [], defaultUserConfig);

      expect(result.response).toContain('maximum number of tool calls');
      expect(result.response).toContain('2');
    });

    it('should return fallback when response is empty', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [],
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 0 },
      });

      const provider = new ApiProvider(config);
      const result = await provider.ask('Question', [], defaultUserConfig);

      expect(result.response).toBe('I apologize, but I was unable to generate a response.');
    });

    it('should accumulate token usage across multiple calls', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'tool_use', id: 'tool-1', name: 'test_tool', input: {} }],
        stop_reason: 'tool_use',
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'tool_use', id: 'tool-2', name: 'test_tool', input: {} }],
        stop_reason: 'tool_use',
        usage: { input_tokens: 200, output_tokens: 100 },
      });

      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Done' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 300, output_tokens: 150 },
      });

      const provider = new ApiProvider(config);
      const result = await provider.ask('Question', [], defaultUserConfig);

      expect(result.usage.inputTokens).toBe(600);
      expect(result.usage.outputTokens).toBe(300);
    });
  });
});

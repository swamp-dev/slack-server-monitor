import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SdkProviderConfig } from '../../../src/services/providers/types.js';

// All mocks must be hoisted and not reference external variables
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: vi.fn() },
  })),
}));

vi.mock('../../../src/services/tools/index.js', () => ({
  getToolSpecs: vi.fn().mockReturnValue([
    {
      name: 'test_tool',
      description: 'A test tool',
      input_schema: { type: 'object', properties: {} },
    },
  ]),
  executeTool: vi.fn().mockResolvedValue({
    toolUseId: 'test-id',
    content: 'Tool executed successfully',
    isError: false,
  }),
}));

vi.mock('../../../src/config/prompts.js', () => ({
  buildSystemPrompt: vi.fn().mockReturnValue('Test system prompt'),
}));

vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Import after mocks are set up
import { SdkProvider } from '../../../src/services/providers/sdk-provider.js';
import Anthropic from '@anthropic-ai/sdk';
import { getToolSpecs, executeTool } from '../../../src/services/tools/index.js';

describe('SdkProvider', () => {
  const config: SdkProviderConfig = {
    apiKey: 'test-api-key',
    model: 'claude-sonnet-4-20250514',
    maxTokens: 2048,
    maxToolCalls: 10,
    maxIterations: 20,
  };

  const userConfig = {
    disabledTools: [],
    toolConfig: {
      allowedDirs: [],
      maxFileSizeKb: 100,
      maxLogLines: 50,
    },
  };

  // Get references to the mocked functions
  let mockCreate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset tool mocks to default values
    vi.mocked(getToolSpecs).mockReturnValue([
      {
        name: 'test_tool',
        description: 'A test tool',
        input_schema: { type: 'object', properties: {} },
      },
    ]);
    vi.mocked(executeTool).mockResolvedValue({
      toolUseId: 'test-id',
      content: 'Tool executed successfully',
      isError: false,
    });

    // Create fresh mock for messages.create
    mockCreate = vi.fn();
    vi.mocked(Anthropic).mockImplementation(
      () =>
        ({
          messages: { create: mockCreate },
        }) as unknown as Anthropic
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create provider with correct name', () => {
      const provider = new SdkProvider(config);
      expect(provider.name).toBe('sdk');
    });
  });

  describe('ask', () => {
    it('should return text response when stop_reason is end_turn', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Hello from Claude!' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const provider = new SdkProvider(config);
      const result = await provider.ask('Hello', [], userConfig);

      expect(result.response).toBe('Hello from Claude!');
      expect(result.usage.inputTokens).toBe(100);
      expect(result.usage.outputTokens).toBe(50);
      expect(result.toolCalls).toHaveLength(0);
    });

    it('should handle tool_use response and execute tools', async () => {
      mockCreate
        // First call returns tool_use
        .mockResolvedValueOnce({
          content: [
            { type: 'text', text: 'Let me check...' },
            {
              type: 'tool_use',
              id: 'toolu_123',
              name: 'test_tool',
              input: { param: 'value' },
            },
          ],
          stop_reason: 'tool_use',
          usage: { input_tokens: 50, output_tokens: 30 },
        })
        // Second call returns final response
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: 'The tool returned results.' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 80, output_tokens: 40 },
        });

      const provider = new SdkProvider(config);
      const result = await provider.ask('Test with tool', [], userConfig);

      expect(executeTool).toHaveBeenCalledWith(
        'toolu_123',
        'test_tool',
        { param: 'value' },
        userConfig.toolConfig
      );
      expect(result.response).toBe('The tool returned results.');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('test_tool');
      expect(result.usage.inputTokens).toBe(130); // 50 + 80
      expect(result.usage.outputTokens).toBe(70); // 30 + 40
    });

    it('should include images in the request when provided', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'I see the image.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 200, output_tokens: 50 },
      });

      const provider = new SdkProvider(config);
      const result = await provider.ask('What is in this image?', [], userConfig, {
        images: [
          {
            data: 'base64encodedimage',
            mediaType: 'image/jpeg',
          },
        ],
      });

      expect(result.response).toBe('I see the image.');

      // Verify the create call included image content
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'user',
              content: expect.arrayContaining([
                expect.objectContaining({
                  type: 'image',
                  source: expect.objectContaining({
                    type: 'base64',
                    media_type: 'image/jpeg',
                    data: 'base64encodedimage',
                  }),
                }),
                expect.objectContaining({
                  type: 'text',
                  text: 'What is in this image?',
                }),
              ]),
            }),
          ]),
        })
      );
    });

    it('should stop when max tool calls reached', async () => {
      // Create a config with very low max tool calls
      const lowLimitConfig: SdkProviderConfig = {
        ...config,
        maxToolCalls: 2,
      };

      // Return 3 tool calls in one response (exceeds limit)
      mockCreate.mockResolvedValue({
        content: [
          { type: 'text', text: 'Checking...' },
          { type: 'tool_use', id: 'tool_1', name: 'test_tool', input: {} },
          { type: 'tool_use', id: 'tool_2', name: 'test_tool', input: {} },
          { type: 'tool_use', id: 'tool_3', name: 'test_tool', input: {} },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 50, output_tokens: 30 },
      });

      const provider = new SdkProvider(lowLimitConfig);
      const result = await provider.ask('Test', [], userConfig);

      expect(result.response).toContain('maximum number of tool calls');
      expect(result.response).toContain('2');
    });

    it('should handle max_tokens stop reason', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Truncated response...' }],
        stop_reason: 'max_tokens',
        usage: { input_tokens: 100, output_tokens: 2048 },
      });

      const provider = new SdkProvider(config);
      const result = await provider.ask('Tell me everything', [], userConfig);

      expect(result.response).toBe('Truncated response...');
    });

    it('should include conversation history in messages', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Continuing the conversation.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 150, output_tokens: 50 },
      });

      const provider = new SdkProvider(config);
      const history = [
        { role: 'user' as const, content: 'Previous question' },
        { role: 'assistant' as const, content: 'Previous answer' },
      ];

      await provider.ask('Follow up question', history, userConfig);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            { role: 'user', content: 'Previous question' },
            { role: 'assistant', content: 'Previous answer' },
            expect.objectContaining({ role: 'user' }),
          ],
        })
      );
    });

    it('should provide fallback response when no text blocks present', async () => {
      mockCreate.mockResolvedValue({
        content: [], // No content blocks
        stop_reason: 'end_turn',
        usage: { input_tokens: 50, output_tokens: 0 },
      });

      const provider = new SdkProvider(config);
      const result = await provider.ask('Question', [], userConfig);

      expect(result.response).toContain('unable to generate a response');
    });

    it('should stop after max iterations reached', async () => {
      // Config with very low max iterations
      const lowIterConfig: SdkProviderConfig = {
        ...config,
        maxIterations: 2,
        maxToolCalls: 100, // High limit so we hit iteration limit first
      };

      // Always return tool_use to force iteration
      mockCreate.mockResolvedValue({
        content: [{ type: 'tool_use', id: 'toolu_loop', name: 'test_tool', input: {} }],
        stop_reason: 'tool_use',
        usage: { input_tokens: 50, output_tokens: 30 },
      });

      const provider = new SdkProvider(lowIterConfig);
      const result = await provider.ask('Infinite loop test', [], userConfig);

      expect(result.response).toContain('maximum iterations reached');
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPluginClaude, createDisabledPluginClaude } from '../../src/services/plugin-claude.js';
import type { ClaudeProvider } from '../../src/services/providers/types.js';
import type { ToolDefinition } from '../../src/services/tools/types.js';

// Mock the tools index
vi.mock('../../src/services/tools/index.js', () => ({
  getToolSpecs: vi.fn().mockReturnValue([
    {
      name: 'builtin_tool',
      description: 'A built-in tool',
      input_schema: { type: 'object', properties: {} },
    },
  ]),
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

describe('plugin-claude', () => {
  describe('createPluginClaude', () => {
    const mockProvider: ClaudeProvider = {
      name: 'sdk',
      ask: vi.fn().mockResolvedValue({
        response: 'Test response',
        toolCalls: [],
        usage: { inputTokens: 100, outputTokens: 50 },
      }),
    };

    const pluginTools: ToolDefinition[] = [
      {
        spec: {
          name: 'lift:calculate_score',
          description: 'Calculate a score',
          input_schema: { type: 'object', properties: {} },
        },
        execute: vi.fn().mockResolvedValue('result'),
      },
    ];

    const toolConfig = {
      allowedDirs: ['/test'],
      maxFileSizeKb: 100,
      maxLogLines: 50,
    };

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should create an enabled PluginClaude instance', () => {
      const checkRateLimit = vi.fn().mockReturnValue(true);

      const pluginClaude = createPluginClaude({
        provider: mockProvider,
        pluginName: 'lift',
        pluginTools,
        checkRateLimit,
        toolConfig,
      });

      expect(pluginClaude.enabled).toBe(true);
    });

    it('should report supportsImages based on provider name', () => {
      const checkRateLimit = vi.fn().mockReturnValue(true);

      // SDK provider supports images
      const sdkClaude = createPluginClaude({
        provider: { ...mockProvider, name: 'sdk' },
        pluginName: 'test',
        pluginTools: [],
        checkRateLimit,
        toolConfig,
      });
      expect(sdkClaude.supportsImages).toBe(true);

      // CLI provider does not support images
      const cliClaude = createPluginClaude({
        provider: { ...mockProvider, name: 'cli' },
        pluginName: 'test',
        pluginTools: [],
        checkRateLimit,
        toolConfig,
      });
      expect(cliClaude.supportsImages).toBe(false);
    });

    it('should call provider.ask with correct parameters', async () => {
      const checkRateLimit = vi.fn().mockReturnValue(true);

      const pluginClaude = createPluginClaude({
        provider: mockProvider,
        pluginName: 'lift',
        pluginTools,
        checkRateLimit,
        toolConfig,
      });

      const result = await pluginClaude.ask('What is my Wilks score?', 'U123');

      expect(mockProvider.ask).toHaveBeenCalledWith(
        'What is my Wilks score?',
        [],
        expect.objectContaining({
          disabledTools: [],
          toolConfig,
        }),
        expect.anything()
      );

      expect(result.response).toBe('Test response');
      expect(result.usage.inputTokens).toBe(100);
    });

    it('should throw error when rate limited', async () => {
      const checkRateLimit = vi.fn().mockReturnValue(false);

      const pluginClaude = createPluginClaude({
        provider: mockProvider,
        pluginName: 'lift',
        pluginTools,
        checkRateLimit,
        toolConfig,
      });

      await expect(pluginClaude.ask('Test', 'U123')).rejects.toThrow('Rate limit exceeded');
      expect(mockProvider.ask).not.toHaveBeenCalled();
    });

    it('should pass images to provider when provided', async () => {
      const checkRateLimit = vi.fn().mockReturnValue(true);

      const pluginClaude = createPluginClaude({
        provider: mockProvider,
        pluginName: 'lift',
        pluginTools,
        checkRateLimit,
        toolConfig,
      });

      await pluginClaude.ask('Analyze this food', 'U123', {
        images: [
          {
            data: 'base64data',
            mediaType: 'image/jpeg',
          },
        ],
      });

      expect(mockProvider.ask).toHaveBeenCalledWith(
        'Analyze this food',
        [],
        expect.anything(),
        expect.objectContaining({
          images: [
            {
              data: 'base64data',
              mediaType: 'image/jpeg',
            },
          ],
        })
      );
    });

    it('should pass systemPromptAddition in userConfig', async () => {
      const checkRateLimit = vi.fn().mockReturnValue(true);

      const pluginClaude = createPluginClaude({
        provider: mockProvider,
        pluginName: 'lift',
        pluginTools,
        checkRateLimit,
        toolConfig,
      });

      await pluginClaude.ask('Test', 'U123', {
        systemPromptAddition: 'You are a nutrition expert.',
      });

      expect(mockProvider.ask).toHaveBeenCalledWith(
        'Test',
        [],
        expect.objectContaining({
          systemPromptAddition: 'You are a nutrition expert.',
        }),
        expect.anything()
      );
    });

    it('should return tool calls from provider response', async () => {
      const checkRateLimit = vi.fn().mockReturnValue(true);
      const mockProviderWithTools: ClaudeProvider = {
        name: 'sdk',
        ask: vi.fn().mockResolvedValue({
          response: 'Done',
          toolCalls: [
            { name: 'lift:calculate_score', input: { value: 100 }, outputPreview: 'Score: 300' },
          ],
          usage: { inputTokens: 100, outputTokens: 50 },
        }),
      };

      const pluginClaude = createPluginClaude({
        provider: mockProviderWithTools,
        pluginName: 'lift',
        pluginTools,
        checkRateLimit,
        toolConfig,
      });

      const result = await pluginClaude.ask('Calculate my score', 'U123');

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('lift:calculate_score');
      expect(result.toolCalls[0].input).toEqual({ value: 100 });
    });

    it('should throw error when images passed to CLI provider', async () => {
      const checkRateLimit = vi.fn().mockReturnValue(true);
      const cliProvider = { ...mockProvider, name: 'cli' };

      const cliClaude = createPluginClaude({
        provider: cliProvider,
        pluginName: 'lift',
        pluginTools,
        checkRateLimit,
        toolConfig,
      });

      await expect(
        cliClaude.ask('Analyze this food', 'U123', {
          images: [{ data: 'base64data', mediaType: 'image/jpeg' }],
        })
      ).rejects.toThrow('Image analysis requires SDK provider');

      expect(cliProvider.ask).not.toHaveBeenCalled();
    });

    it('should allow images with SDK provider', async () => {
      const checkRateLimit = vi.fn().mockReturnValue(true);
      const sdkProvider = { ...mockProvider, name: 'sdk' };

      const sdkClaude = createPluginClaude({
        provider: sdkProvider,
        pluginName: 'lift',
        pluginTools,
        checkRateLimit,
        toolConfig,
      });

      await sdkClaude.ask('Analyze this food', 'U123', {
        images: [{ data: 'base64data', mediaType: 'image/jpeg' }],
      });

      expect(sdkProvider.ask).toHaveBeenCalledWith(
        'Analyze this food',
        [],
        expect.anything(),
        expect.objectContaining({
          images: [{ data: 'base64data', mediaType: 'image/jpeg' }],
        })
      );
    });
  });

  describe('createDisabledPluginClaude', () => {
    it('should create a disabled PluginClaude instance', () => {
      const pluginClaude = createDisabledPluginClaude();

      expect(pluginClaude.enabled).toBe(false);
      expect(pluginClaude.supportsImages).toBe(false);
    });

    it('should throw error when ask is called', async () => {
      const pluginClaude = createDisabledPluginClaude();

      await expect(pluginClaude.ask('Test', 'U123')).rejects.toThrow(
        'Claude is not enabled'
      );
    });
  });
});

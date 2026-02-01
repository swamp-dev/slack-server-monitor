/**
 * Plugin Claude API - provides Claude access to plugins
 *
 * This service wraps the Claude provider to provide a simplified API for plugins.
 * Features:
 * - Rate limiting (uses user's quota)
 * - Optional access to plugin's own tools
 * - Optional access to built-in server monitoring tools
 * - Image support (SDK provider only)
 */

import type { ToolDefinition, ToolSpec, ToolConfig } from './tools/types.js';
import type {
  PluginClaude,
  PluginClaudeOptions,
  PluginClaudeResult,
  PluginImageInput,
} from '../plugins/types.js';
import type { ClaudeProvider, UserConfig, ImageInput } from './providers/types.js';
import { getToolSpecs } from './tools/index.js';
import { logger } from '../utils/logger.js';

/**
 * Configuration for the plugin Claude service
 */
export interface PluginClaudeConfig {
  /** Claude provider instance */
  provider: ClaudeProvider;
  /** Plugin name (for logging) */
  pluginName: string;
  /** Plugin's own tools (namespaced) */
  pluginTools: ToolDefinition[];
  /** Rate limiter function - returns true if allowed */
  checkRateLimit: (userId: string) => boolean;
  /** Tool config for built-in tools */
  toolConfig: ToolConfig;
}

/**
 * Create a PluginClaude instance for a specific plugin
 */
export function createPluginClaude(config: PluginClaudeConfig): PluginClaude {
  const { provider, pluginName, pluginTools, checkRateLimit, toolConfig } = config;

  return {
    enabled: true,
    supportsImages: provider.name === 'sdk',

    async ask(
      question: string,
      userId: string,
      options?: PluginClaudeOptions
    ): Promise<PluginClaudeResult> {
      // Check rate limit first
      if (!checkRateLimit(userId)) {
        throw new Error('Rate limit exceeded. Please try again later.');
      }

      logger.debug('Plugin Claude request', {
        plugin: pluginName,
        userId,
        hasImages: !!options?.images?.length,
        includeBuiltinTools: options?.includeBuiltinTools,
      });

      // Build tools list (for future use when provider supports custom tool sets)
      let _tools: ToolSpec[] = [];

      // Include plugin's own tools (already namespaced)
      _tools = pluginTools.map((t) => t.spec);

      // Optionally include built-in tools
      if (options?.includeBuiltinTools) {
        const builtinSpecs = getToolSpecs([]);
        _tools = [..._tools, ...builtinSpecs];
      }

      // Create user config for the provider
      const userConfig: UserConfig = {
        systemPromptAddition: options?.systemPromptAddition,
        disabledTools: [],
        toolConfig,
      };

      // Convert images if provided
      const images: ImageInput[] | undefined = options?.images?.map((img: PluginImageInput) => ({
        data: img.data,
        mediaType: img.mediaType,
      }));

      // Throw error if images requested but not supported
      if (images && images.length > 0 && provider.name !== 'sdk') {
        throw new Error(
          'Image analysis requires SDK provider. Set ANTHROPIC_API_KEY and CLAUDE_PROVIDER=sdk to enable.'
        );
      }

      // Call the provider
      // Note: We're using the provider directly rather than the full tool loop
      // because plugins may want to handle tool calls differently
      const result = await provider.ask(question, [], userConfig, { images });

      logger.debug('Plugin Claude response', {
        plugin: pluginName,
        responseLength: result.response.length,
        toolCalls: result.toolCalls.length,
        usage: result.usage,
      });

      return {
        response: result.response,
        toolCalls: result.toolCalls.map((tc) => ({
          name: tc.name,
          input: tc.input,
        })),
        usage: result.usage,
      };
    },
  };
}

/**
 * Create a disabled PluginClaude instance (when Claude is not configured)
 */
export function createDisabledPluginClaude(): PluginClaude {
  return {
    enabled: false,
    supportsImages: false,
    ask(): Promise<PluginClaudeResult> {
      return Promise.reject(new Error('Claude is not enabled. Set CLAUDE_ENABLED=true to use this feature.'));
    },
  };
}

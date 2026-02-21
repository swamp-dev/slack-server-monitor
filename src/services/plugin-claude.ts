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

import type { ToolDefinition, ToolConfig } from './tools/types.js';
import type {
  PluginClaude,
  PluginClaudeOptions,
  PluginClaudeResult,
  PluginImageInput,
} from '../plugins/types.js';
import type { ClaudeProvider, UserConfig, ImageInput } from './providers/types.js';
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
  const { provider, pluginName, checkRateLimit, toolConfig } = config;

  return {
    enabled: true,
    // CLI provider supports images via localImagePath
    supportsImages: true,

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

      // Create user config for the provider
      const userConfig: UserConfig = {
        systemPromptAddition: options?.systemPromptAddition,
        disabledTools: [],
        toolConfig,
      };

      // Convert images if provided (for legacy support)
      const images: ImageInput[] | undefined = options?.images?.map((img: PluginImageInput) => ({
        data: img.data,
        mediaType: img.mediaType,
      }));

      // Call the provider
      // Note: We're using the provider directly rather than the full tool loop
      // because plugins may want to handle tool calls differently
      // CLI provider supports localImagePath for image analysis
      const result = await provider.ask(question, [], userConfig, {
        images,
        localImagePath: options?.localImagePath,
      });

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

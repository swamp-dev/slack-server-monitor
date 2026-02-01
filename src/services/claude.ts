/**
 * Claude service - re-exports from providers for backward compatibility
 */

import {
  createProvider,
  resetProvider,
  providerSupportsImages,
  type ProviderConfig,
} from './providers/index.js';
import type {
  ClaudeProvider,
  UserConfig,
  AskResult,
  AskOptions,
  ImageInput,
  ConversationMessage,
  ToolCallLog,
} from './providers/types.js';

// Re-export types for backward compatibility
export type { UserConfig, AskResult, AskOptions, ImageInput, ConversationMessage, ToolCallLog };

/**
 * Configuration for Claude service
 */
export interface ClaudeConfig {
  /** Provider selection mode */
  provider: 'auto' | 'sdk' | 'cli';
  /** Anthropic API key (required for SDK provider) */
  apiKey?: string;
  /** Path to CLI executable */
  cliPath: string;
  /** Model alias for CLI backend */
  cliModel: string;
  /** Model for SDK provider */
  sdkModel: string;
  /** Maximum tokens for response */
  maxTokens: number;
  /** Maximum tool calls per turn */
  maxToolCalls: number;
  /** Maximum agentic loop iterations */
  maxIterations: number;
}

/**
 * Claude AI service with tool use support
 *
 * This class wraps the provider for backward compatibility.
 * New code should use getProvider() directly.
 */
export class ClaudeService {
  private provider: ClaudeProvider;

  constructor(config: ClaudeConfig) {
    const providerConfig: ProviderConfig = {
      provider: config.provider,
      apiKey: config.apiKey,
      cliPath: config.cliPath,
      cliModel: config.cliModel,
      sdkModel: config.sdkModel,
      maxTokens: config.maxTokens,
      maxToolCalls: config.maxToolCalls,
      maxIterations: config.maxIterations,
    };

    this.provider = createProvider(providerConfig);
  }

  /**
   * Ask Claude a question with tool access
   */
  async ask(
    question: string,
    conversationHistory: ConversationMessage[],
    userConfig: UserConfig,
    options?: AskOptions
  ): Promise<AskResult> {
    return this.provider.ask(question, conversationHistory, userConfig, options);
  }

  /**
   * Get the provider name (for logging)
   */
  get providerName(): string {
    return this.provider.name;
  }

  /**
   * Check if the current provider supports image inputs
   */
  get supportsImages(): boolean {
    return this.provider.name === 'sdk';
  }
}

// Singleton instance
let claudeService: ClaudeService | null = null;

/**
 * Get or create the Claude service singleton
 */
export function getClaudeService(config: ClaudeConfig): ClaudeService {
  claudeService ??= new ClaudeService(config);
  return claudeService;
}

/**
 * Reset the Claude service singleton (for testing)
 */
export function resetClaudeService(): void {
  claudeService = null;
  resetProvider();
}

/**
 * Check if the current provider supports images
 */
export { providerSupportsImages };

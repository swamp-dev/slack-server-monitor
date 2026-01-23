/**
 * Claude service - re-exports from providers for backward compatibility
 */

import { createProvider, resetProvider, type BackendType, type ProviderFactoryConfig } from './providers/index.js';
import type { ClaudeProvider, UserConfig, AskResult, ConversationMessage, ToolCallLog } from './providers/types.js';

// Re-export types for backward compatibility
export type { UserConfig, AskResult, ConversationMessage, ToolCallLog, BackendType };

/**
 * Configuration for Claude service
 */
export interface ClaudeConfig {
  /** Backend type: api, cli, or auto */
  backend: BackendType;
  /** API key (required for api backend) */
  apiKey?: string;
  /** Model for API backend */
  model: string;
  /** Path to CLI executable */
  cliPath: string;
  /** Model alias for CLI backend */
  cliModel: string;
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
    const factoryConfig: ProviderFactoryConfig = {
      backend: config.backend,
    };

    // Configure API provider if we have an API key
    if (config.apiKey) {
      factoryConfig.api = {
        apiKey: config.apiKey,
        model: config.model,
        maxTokens: config.maxTokens,
        maxToolCalls: config.maxToolCalls,
        maxIterations: config.maxIterations,
      };
    }

    // Configure CLI provider
    factoryConfig.cli = {
      cliPath: config.cliPath,
      model: config.cliModel,
      maxTokens: config.maxTokens,
      maxToolCalls: config.maxToolCalls,
      maxIterations: config.maxIterations,
    };

    this.provider = createProvider(factoryConfig);
  }

  /**
   * Ask Claude a question with tool access
   */
  async ask(
    question: string,
    conversationHistory: ConversationMessage[],
    userConfig: UserConfig
  ): Promise<AskResult> {
    return this.provider.ask(question, conversationHistory, userConfig);
  }

  /**
   * Get the provider name (for logging)
   */
  get providerName(): string {
    return this.provider.name;
  }

  /**
   * Whether this provider tracks token usage
   */
  get tracksTokens(): boolean {
    return this.provider.tracksTokens;
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

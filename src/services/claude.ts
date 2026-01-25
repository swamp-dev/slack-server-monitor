/**
 * Claude service - re-exports from providers for backward compatibility
 */

import { createProvider, resetProvider, type CliProviderConfig } from './providers/index.js';
import type { ClaudeProvider, UserConfig, AskResult, ConversationMessage, ToolCallLog } from './providers/types.js';

// Re-export types for backward compatibility
export type { UserConfig, AskResult, ConversationMessage, ToolCallLog };

/**
 * Configuration for Claude service
 */
export interface ClaudeConfig {
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
    const cliConfig: CliProviderConfig = {
      cliPath: config.cliPath,
      model: config.cliModel,
      maxTokens: config.maxTokens,
      maxToolCalls: config.maxToolCalls,
      maxIterations: config.maxIterations,
    };

    this.provider = createProvider(cliConfig);
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

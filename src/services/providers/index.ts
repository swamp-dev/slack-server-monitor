import { CliProvider } from './cli-provider.js';
import type { ClaudeProvider, CliProviderConfig } from './types.js';
import { logger } from '../../utils/logger.js';

export type {
  ClaudeProvider,
  UserConfig,
  AskResult,
  AskOptions,
  ImageInput,
  ConversationMessage,
  ToolCallLog,
  CliProviderConfig,
} from './types.js';

/**
 * Provider selection mode (CLI-only now)
 */
export type ProviderMode = 'cli';

/**
 * Combined configuration for provider creation
 */
export interface ProviderConfig {
  /** Provider selection mode (only 'cli' supported) */
  provider: ProviderMode | 'auto' | 'sdk' | 'hybrid'; // Accept legacy values for compatibility
  /** Anthropic API key (no longer used - CLI only) */
  apiKey?: string;
  /** CLI path (required for CLI provider) */
  cliPath: string;
  /** Model for CLI provider */
  cliModel: string;
  /** Model for SDK provider (legacy, ignored) */
  sdkModel: string;
  /** Max tokens for response */
  maxTokens: number;
  /** Max tool calls per conversation */
  maxToolCalls: number;
  /** Max agentic iterations */
  maxIterations: number;
}

// Singleton provider instance
let providerInstance: ClaudeProvider | null = null;

/**
 * Create a Claude provider based on configuration
 * Now always creates CLI provider (SDK/hybrid removed)
 */
export function createProvider(config: ProviderConfig): ClaudeProvider {
  // Log if legacy SDK/hybrid was requested
  if (config.provider === 'sdk' || config.provider === 'hybrid') {
    logger.warn('SDK and hybrid providers have been removed. Using CLI provider instead.', {
      requestedProvider: config.provider,
    });
  }

  logger.info('Using CLI provider (Claude Code CLI)', { model: config.cliModel });
  const cliConfig: CliProviderConfig = {
    cliPath: config.cliPath,
    model: config.cliModel,
    maxTokens: config.maxTokens,
    maxToolCalls: config.maxToolCalls,
    maxIterations: config.maxIterations,
  };
  return new CliProvider(cliConfig);
}

/**
 * Get or create the Claude provider singleton
 */
export function getProvider(config: ProviderConfig): ClaudeProvider {
  if (providerInstance) {
    return providerInstance;
  }

  providerInstance = createProvider(config);
  return providerInstance;
}

/**
 * Reset the provider singleton (for testing)
 */
export function resetProvider(): void {
  providerInstance = null;
}

/**
 * Check if the current provider supports images
 * CLI provider now supports images via local file path
 */
export function providerSupportsImages(): boolean {
  // CLI provider supports images via localImagePath option
  return true;
}

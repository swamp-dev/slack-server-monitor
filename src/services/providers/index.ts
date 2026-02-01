import { CliProvider } from './cli-provider.js';
import { SdkProvider } from './sdk-provider.js';
import type { ClaudeProvider, CliProviderConfig, SdkProviderConfig } from './types.js';
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
  SdkProviderConfig,
} from './types.js';

/**
 * Provider selection mode
 */
export type ProviderMode = 'auto' | 'sdk' | 'cli';

/**
 * Combined configuration for provider creation
 */
export interface ProviderConfig {
  /** Provider selection mode */
  provider: ProviderMode;
  /** Anthropic API key (required for SDK provider) */
  apiKey?: string;
  /** CLI path (required for CLI provider) */
  cliPath: string;
  /** Model for CLI provider */
  cliModel: string;
  /** Model for SDK provider */
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
 * Determine which provider to use based on config
 */
function selectProvider(config: ProviderConfig): 'sdk' | 'cli' {
  if (config.provider === 'sdk') {
    if (!config.apiKey) {
      throw new Error('SDK provider requires ANTHROPIC_API_KEY to be set');
    }
    return 'sdk';
  }

  if (config.provider === 'cli') {
    return 'cli';
  }

  // Auto mode: prefer SDK if API key is available
  if (config.apiKey) {
    return 'sdk';
  }

  return 'cli';
}

/**
 * Create a Claude provider based on configuration
 */
export function createProvider(config: ProviderConfig): ClaudeProvider {
  const selectedProvider = selectProvider(config);

  if (selectedProvider === 'sdk') {
    // selectProvider only returns 'sdk' when apiKey is set
    if (!config.apiKey) {
      throw new Error('SDK provider selected but no API key configured');
    }
    logger.info('Using SDK provider (Anthropic API)', { model: config.sdkModel });
    const sdkConfig: SdkProviderConfig = {
      apiKey: config.apiKey,
      model: config.sdkModel,
      maxTokens: config.maxTokens,
      maxToolCalls: config.maxToolCalls,
      maxIterations: config.maxIterations,
    };
    return new SdkProvider(sdkConfig);
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
 */
export function providerSupportsImages(): boolean {
  return providerInstance?.name === 'sdk';
}

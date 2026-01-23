import { ApiProvider } from './api-provider.js';
import { CliProvider } from './cli-provider.js';
import type { ClaudeProvider, ApiProviderConfig, CliProviderConfig } from './types.js';
import { logger } from '../../utils/logger.js';

export type { ClaudeProvider, UserConfig, AskResult, ConversationMessage, ToolCallLog } from './types.js';
export type { ApiProviderConfig, CliProviderConfig };

/**
 * Backend type for Claude provider
 */
export type BackendType = 'api' | 'cli' | 'auto';

/**
 * Combined provider configuration
 */
export interface ProviderFactoryConfig {
  backend: BackendType;
  api?: ApiProviderConfig;
  cli?: CliProviderConfig;
}

// Singleton provider instance
let providerInstance: ClaudeProvider | null = null;

/**
 * Create a Claude provider based on configuration
 */
export function createProvider(config: ProviderFactoryConfig): ClaudeProvider {
  const { backend } = config;

  // API backend: use Anthropic SDK
  if (backend === 'api') {
    if (!config.api) {
      throw new Error('API provider requires apiKey configuration');
    }
    logger.info('Using API provider (Anthropic SDK)');
    return new ApiProvider(config.api);
  }

  // CLI backend: use Claude CLI
  if (backend === 'cli') {
    if (!config.cli) {
      throw new Error('CLI provider requires cliPath configuration');
    }
    logger.info('Using CLI provider (Claude Code CLI)');
    return new CliProvider(config.cli);
  }

  // Auto backend: prefer API if available, fall back to CLI
  // backend === 'auto' at this point
  if (config.api) {
    logger.info('Auto-selecting API provider (API key available)');
    return new ApiProvider(config.api);
  }
  if (config.cli) {
    logger.info('Auto-selecting CLI provider (no API key, CLI configured)');
    return new CliProvider(config.cli);
  }

  throw new Error(`No valid provider configuration found for backend: ${backend}`);
}

/**
 * Get or create the Claude provider singleton
 *
 * For backward compatibility, accepts either the new ProviderFactoryConfig
 * or the legacy ApiProviderConfig (when api key is present)
 */
export function getProvider(config: ProviderFactoryConfig | ApiProviderConfig): ClaudeProvider {
  if (providerInstance) {
    return providerInstance;
  }

  // Check if this is a legacy ApiProviderConfig (has apiKey directly)
  if ('apiKey' in config) {
    providerInstance = new ApiProvider(config);
  } else {
    providerInstance = createProvider(config);
  }

  return providerInstance;
}

/**
 * Reset the provider singleton (for testing)
 */
export function resetProvider(): void {
  providerInstance = null;
}

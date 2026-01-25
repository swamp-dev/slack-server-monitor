import { CliProvider } from './cli-provider.js';
import type { ClaudeProvider, CliProviderConfig } from './types.js';
import { logger } from '../../utils/logger.js';

export type { ClaudeProvider, UserConfig, AskResult, ConversationMessage, ToolCallLog, CliProviderConfig } from './types.js';

// Singleton provider instance
let providerInstance: ClaudeProvider | null = null;

/**
 * Create a Claude provider using CLI backend
 */
export function createProvider(config: CliProviderConfig): ClaudeProvider {
  logger.info('Using CLI provider (Claude Code CLI)');
  return new CliProvider(config);
}

/**
 * Get or create the Claude provider singleton
 */
export function getProvider(config: CliProviderConfig): ClaudeProvider {
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

import type { ToolConfig } from '../tools/types.js';

/**
 * User-specific configuration passed to providers
 */
export interface UserConfig {
  systemPromptAddition?: string;
  contextDirContent?: string;
  disabledTools: string[];
  toolConfig: ToolConfig;
}

/**
 * Tool call log entry
 */
export interface ToolCallLog {
  name: string;
  input: Record<string, unknown>;
  outputPreview: string;
}

/**
 * Result from asking Claude
 */
export interface AskResult {
  response: string;
  toolCalls: ToolCallLog[];
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * Simple message for conversation history
 */
export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Base configuration shared by all providers
 */
export interface BaseProviderConfig {
  model: string;
  maxTokens: number;
  maxToolCalls: number;
  maxIterations: number;
}

/**
 * Configuration for API provider (Anthropic SDK)
 */
export interface ApiProviderConfig extends BaseProviderConfig {
  apiKey: string;
}

/**
 * Configuration for CLI provider (claude command)
 */
export interface CliProviderConfig extends BaseProviderConfig {
  cliPath: string;
}

/**
 * Provider interface - abstraction over different Claude backends
 */
export interface ClaudeProvider {
  /**
   * Ask Claude a question with tool access
   */
  ask(
    question: string,
    conversationHistory: ConversationMessage[],
    userConfig: UserConfig
  ): Promise<AskResult>;

  /**
   * Get the provider name (for logging)
   */
  readonly name: string;

  /**
   * Whether this provider tracks token usage
   */
  readonly tracksTokens: boolean;
}

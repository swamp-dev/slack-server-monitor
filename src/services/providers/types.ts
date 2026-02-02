import type { ToolConfig } from '../tools/types.js';

/**
 * Image input for multimodal requests
 */
export interface ImageInput {
  /** Base64-encoded image data */
  data: string;
  /** Image MIME type */
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
}

/**
 * Options for the ask() method
 */
export interface AskOptions {
  /** Images to include in the request (base64 encoded) */
  images?: ImageInput[];
  /** Path to a local image file for CLI provider to read */
  localImagePath?: string;
}

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
 * Configuration for CLI provider (claude command)
 */
export interface CliProviderConfig extends BaseProviderConfig {
  cliPath: string;
}

/**
 * Configuration for SDK provider (Anthropic API)
 * @deprecated SDK provider has been removed - use CLI provider instead
 */
export interface SdkProviderConfig extends BaseProviderConfig {
  apiKey: string;
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
    userConfig: UserConfig,
    options?: AskOptions
  ): Promise<AskResult>;

  /**
   * Get the provider name (for logging)
   */
  readonly name: string;
}

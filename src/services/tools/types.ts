import type { Tool } from '@anthropic-ai/sdk/resources/messages.js';

/**
 * Tool definition with execution handler
 */
export interface ToolDefinition {
  /** Anthropic tool specification */
  spec: Tool;
  /** Execute the tool and return result as string */
  execute: (input: Record<string, unknown>, config: ToolConfig) => Promise<string>;
}

/**
 * Configuration passed to tool execution
 */
export interface ToolConfig {
  /** Directories allowed for file reading */
  allowedDirs: string[];
  /** Maximum file size in KB */
  maxFileSizeKb: number;
  /** Maximum log lines */
  maxLogLines: number;
}

/**
 * Result from tool execution
 */
export interface ToolResult {
  toolUseId: string;
  content: string;
  isError?: boolean;
}

import type { ToolDefinition, ToolConfig, ToolResult, ToolSpec } from './types.js';
import { serverTools } from './server-tools.js';
import { fileTools } from './file-tools.js';
import { scrubSensitiveData } from '../../formatters/scrub.js';
import { logger } from '../../utils/logger.js';

/**
 * All available tools
 */
const ALL_TOOLS: ToolDefinition[] = [...serverTools, ...fileTools];

/**
 * Map tool name to definition
 */
const TOOL_MAP = new Map<string, ToolDefinition>(
  ALL_TOOLS.map(tool => [tool.spec.name, tool])
);

/**
 * Get all tool specifications for Claude
 */
export function getToolSpecs(disabledTools: string[] = []): ToolSpec[] {
  return ALL_TOOLS
    .filter(tool => !disabledTools.includes(tool.spec.name))
    .map(tool => tool.spec);
}

/**
 * Get list of available tool names
 */
export function getToolNames(): string[] {
  return ALL_TOOLS.map(tool => tool.spec.name);
}

/**
 * Execute a tool by name
 */
export async function executeTool(
  toolUseId: string,
  toolName: string,
  input: Record<string, unknown>,
  config: ToolConfig
): Promise<ToolResult> {
  const tool = TOOL_MAP.get(toolName);

  if (!tool) {
    logger.warn('Unknown tool requested', { toolName });
    return {
      toolUseId,
      content: `Error: Unknown tool "${toolName}"`,
      isError: true,
    };
  }

  try {
    logger.debug('Executing tool', { toolName, input });
    const result = await tool.execute(input, config);

    // Always scrub output for safety
    const scrubbedResult = scrubSensitiveData(result);

    logger.debug('Tool execution complete', {
      toolName,
      outputLength: scrubbedResult.length,
    });

    return {
      toolUseId,
      content: scrubbedResult,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Tool execution failed', { toolName, error: message });

    return {
      toolUseId,
      content: `Error executing ${toolName}: ${message}`,
      isError: true,
    };
  }
}

export type { ToolDefinition, ToolConfig, ToolResult };

import type { ToolDefinition, ToolConfig, ToolResult, ToolSpec } from './types.js';
import { serverTools } from './server-tools.js';
import { fileTools } from './file-tools.js';
import { getPluginTools } from '../../plugins/index.js';
import { scrubSensitiveData } from '../../formatters/scrub.js';
import { logger } from '../../utils/logger.js';
// Tool validation is handled by the plugin loader
// See ../plugins/loader.ts for validation implementation

/**
 * Built-in tools (always available)
 */
const BUILTIN_TOOLS: ToolDefinition[] = [...serverTools, ...fileTools];

/**
 * Namespace a plugin tool name with the plugin prefix
 * Format: pluginname:toolname
 */
function namespaceToolName(toolName: string, pluginName: string): string {
  return `${pluginName}:${toolName}`;
}

/**
 * Get all available tools (built-in + namespaced plugins)
 */
function getAllTools(): ToolDefinition[] {
  const pluginTools = getPluginTools();

  // Namespace plugin tools to prevent collision with built-ins
  const namespacedPluginTools = pluginTools.map((tool) => {
    if (!tool._pluginName) {
      throw new Error(`Plugin tool "${tool.spec.name}" missing _pluginName - this is a loader bug`);
    }

    // Create namespaced copy of the tool
    return {
      ...tool,
      spec: {
        ...tool.spec,
        name: namespaceToolName(tool.spec.name, tool._pluginName),
      },
    };
  });

  return [...BUILTIN_TOOLS, ...namespacedPluginTools];
}

/**
 * Lazy-initialized tool map (rebuilt when refreshed)
 */
let toolMap = new Map<string, ToolDefinition>();

/**
 * Get the tool map, building it if needed
 */
function getToolMap(): Map<string, ToolDefinition> {
  if (toolMap.size === 0) {
    toolMap = new Map<string, ToolDefinition>(getAllTools().map((tool) => [tool.spec.name, tool]));
  }
  return toolMap;
}

/**
 * Refresh the tool map (call after plugins are loaded)
 * Uses atomic reference swap to prevent race conditions
 */
export function refreshToolMap(): void {
  const newMap = new Map(getAllTools().map((tool) => [tool.spec.name, tool]));
  toolMap = newMap; // Atomic swap
}

/**
 * Get all tool specifications for Claude
 */
export function getToolSpecs(disabledTools: string[] = []): ToolSpec[] {
  return getAllTools()
    .filter((tool) => !disabledTools.includes(tool.spec.name))
    .map((tool) => tool.spec);
}

/**
 * Get list of available tool names
 */
export function getToolNames(): string[] {
  return getAllTools().map((tool) => tool.spec.name);
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
  const tool = getToolMap().get(toolName);

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

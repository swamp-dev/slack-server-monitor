#!/usr/bin/env node

/**
 * Slack Server Monitor MCP Server
 *
 * Exposes read-only server monitoring tools to Claude Code via MCP protocol.
 * Tools mirror the slack-server-monitor bot's capabilities.
 */

import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

import { loadConfig, getToolConfig } from './config.js';
import { TOOLS, executeTool } from './tools/index.js';

// Verify parent package (slack-server-monitor) is built before starting
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const parentDist = resolve(__dirname, '../../../dist');

if (!existsSync(parentDist)) {
  console.error('Error: Parent package (slack-server-monitor) is not built.');
  console.error(`Expected dist directory at: ${parentDist}`);
  console.error('Run: cd .. && npm install && npm run build');
  process.exit(1);
}

// Load configuration
const config = loadConfig();
const toolConfig = getToolConfig(config);

// Log startup info to stderr (MCP uses stdout for protocol)
console.error('Slack Server Monitor MCP Server starting...');
// Don't log actual paths to avoid exposing sensitive directory structure
console.error(`Allowed directories: ${String(config.allowedDirs.length)} configured`);
if (config.allowedDirs.length === 0) {
  console.error('Warning: No allowed directories configured. read_file tool will be unavailable.');
}
console.error(`Max log lines: ${String(config.maxLogLines)}`);
console.error(`Max file size: ${String(config.maxFileSizeKb)}KB`);

// Create MCP server
const server = new Server(
  {
    name: 'slack-server-monitor-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Filter tools based on configuration
// read_file requires allowedDirs to be configured
const availableTools = config.allowedDirs.length > 0
  ? TOOLS
  : TOOLS.filter(tool => tool.name !== 'read_file');

// Register available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: availableTools.map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const result = await executeTool(name, args ?? {}, toolConfig);

    return {
      content: [
        {
          type: 'text',
          text: result,
        },
      ],
    };
  } catch (error) {
    if (error instanceof McpError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : 'Unknown error';

    // Check if it's an unknown tool error
    if (message.startsWith('Unknown tool:')) {
      throw new McpError(ErrorCode.MethodNotFound, message);
    }

    throw new McpError(ErrorCode.InternalError, message);
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Slack Server Monitor MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

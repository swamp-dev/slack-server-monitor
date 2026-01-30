import { z } from 'zod';

// Import executors from parent package (built output)
// These are the same executors used by the Slack bot
import {
  getContainerStatus,
  getContainerDetails,
  getContainerLogs,
  getNetworkList,
} from '../../../dist/executors/docker.js';
import {
  getSystemResources,
  getDiskUsage,
} from '../../../dist/executors/system.js';

// Import security utilities
import {
  executeCommand,
  getAllowedCommands,
  ShellSecurityError,
} from '../../../dist/utils/shell.js';
import { scrubSensitiveData } from '../../../dist/formatters/scrub.js';
import {
  isPathAllowed,
  validateRealPath,
  isSafeExtension,
} from '../../../dist/services/tools/file-tools.js';

// File reading imports
import fs from 'fs/promises';

/**
 * Tool configuration passed to handlers
 */
export interface ToolConfig {
  allowedDirs: string[];
  maxFileSizeKb: number;
  maxLogLines: number;
}

/**
 * MCP Tool definition
 */
export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Input schemas for validation
 */
const ContainerStatusInputSchema = z.object({
  container_name: z.string().optional(),
});

const ContainerLogsInputSchema = z.object({
  container_name: z.string(),
  lines: z.number().positive().optional(),
});

const RunCommandInputSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).optional(),
});

const ReadFileInputSchema = z.object({
  path: z.string(),
  max_lines: z.number().positive().optional(),
});

/**
 * All 7 tools exposed by this MCP server
 */
export const TOOLS: McpTool[] = [
  {
    name: 'get_container_status',
    description: 'Get status of all Docker containers or detailed info for a specific container. Returns container names, images, states (running/stopped), uptime, and ports.',
    inputSchema: {
      type: 'object',
      properties: {
        container_name: {
          type: 'string',
          description: 'Optional: specific container name for detailed info including mounts, networks, and restart count',
        },
      },
    },
  },
  {
    name: 'get_container_logs',
    description: 'Get recent logs from a Docker container. Logs are automatically scrubbed to remove sensitive data like passwords and tokens.',
    inputSchema: {
      type: 'object',
      properties: {
        container_name: {
          type: 'string',
          description: 'Name of the container to get logs from',
        },
        lines: {
          type: 'number',
          description: 'Number of log lines to retrieve (default: 50, max configured limit)',
        },
      },
      required: ['container_name'],
    },
  },
  {
    name: 'get_system_resources',
    description: 'Get current system resource usage including CPU load average (1, 5, 15 min), memory usage (total, used, available), swap usage, and system uptime.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_disk_usage',
    description: 'Get disk usage for all mounted filesystems. Returns size, used, available, and percent used for each mount point. Excludes temporary filesystems like tmpfs.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_network_info',
    description: 'List all Docker networks with their drivers (bridge, host, overlay, etc.) and scope (local, swarm, global).',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'run_command',
    description: `Execute a read-only shell command for system diagnostics. Available commands: ${getAllowedCommands().join(', ')}.
Commands have security restrictions:
- docker: only ps, inspect, logs, network, images, version, info
- systemctl: only status, show, list-units, list-unit-files, is-active, is-enabled, cat
- journalctl: read-only (no flush/rotate/vacuum)
- curl: GET only (no POST/PUT/upload)
- File commands (cat, ls, head, tail, find, grep): restricted to allowed directories`,
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The command to run (e.g., "ps", "systemctl", "journalctl")',
        },
        args: {
          type: 'array',
          items: { type: 'string' },
          description: 'Command arguments as an array (e.g., ["aux"] for ps aux, ["-u", "nginx", "-n", "50"] for journalctl)',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'read_file',
    description: 'Read a text file from allowed directories (ansible configs, docker-compose files, etc.). Only text files are supported. Sensitive data like passwords and tokens are automatically redacted.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Absolute path to the file',
        },
        max_lines: {
          type: 'number',
          description: 'Maximum number of lines to read (default: 200, max: 500)',
        },
      },
      required: ['path'],
    },
  },
];

/**
 * Execute a tool and return the result
 */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  config: ToolConfig
): Promise<string> {
  switch (name) {
    case 'get_container_status':
      return handleGetContainerStatus(args);

    case 'get_container_logs':
      return handleGetContainerLogs(args, config);

    case 'get_system_resources':
      return handleGetSystemResources();

    case 'get_disk_usage':
      return handleGetDiskUsage();

    case 'get_network_info':
      return handleGetNetworkInfo();

    case 'run_command':
      return handleRunCommand(args);

    case 'read_file':
      return handleReadFile(args, config);

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/**
 * Tool: get_container_status
 */
async function handleGetContainerStatus(args: Record<string, unknown>): Promise<string> {
  try {
    const input = ContainerStatusInputSchema.parse(args);

    if (input.container_name) {
      const details = await getContainerDetails(input.container_name);
      return scrubSensitiveData(JSON.stringify({
        name: details.name,
        image: details.image,
        state: details.state,
        restartCount: details.restartCount,
        networks: details.networks,
        ports: details.ports,
        mounts: details.mounts.map(m => ({
          source: m.source,
          destination: m.destination,
          mode: m.mode,
        })),
      }, null, 2));
    }

    const containers = await getContainerStatus();
    return scrubSensitiveData(JSON.stringify(
      containers.map(c => ({
        name: c.name,
        image: c.image,
        state: c.state,
        status: c.status,
        ports: c.ports,
      })),
      null,
      2
    ));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return `Error getting container status: ${message}`;
  }
}

/**
 * Tool: get_container_logs
 */
async function handleGetContainerLogs(
  args: Record<string, unknown>,
  config: ToolConfig
): Promise<string> {
  try {
    const input = ContainerLogsInputSchema.parse(args);
    const lines = Math.min(input.lines ?? 50, config.maxLogLines);

    const logs = await getContainerLogs(input.container_name, lines);
    return scrubSensitiveData(logs);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return `Error getting logs: ${message}`;
  }
}

/**
 * Tool: get_system_resources
 */
async function handleGetSystemResources(): Promise<string> {
  try {
    const resources = await getSystemResources();
    return JSON.stringify({
      memory: {
        totalMB: resources.memory.total,
        usedMB: resources.memory.used,
        availableMB: resources.memory.available,
        percentUsed: resources.memory.percentUsed,
      },
      swap: {
        totalMB: resources.swap.total,
        usedMB: resources.swap.used,
        percentUsed: resources.swap.percentUsed,
      },
      loadAverage: {
        '1min': resources.loadAverage[0],
        '5min': resources.loadAverage[1],
        '15min': resources.loadAverage[2],
      },
      uptime: resources.uptime,
    }, null, 2);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return `Error getting system resources: ${message}`;
  }
}

/**
 * Tool: get_disk_usage
 */
async function handleGetDiskUsage(): Promise<string> {
  try {
    const mounts = await getDiskUsage();
    return JSON.stringify(
      mounts.map(m => ({
        mountPoint: m.mountPoint,
        filesystem: m.filesystem,
        size: m.size,
        used: m.used,
        available: m.available,
        percentUsed: m.percentUsed,
      })),
      null,
      2
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return `Error getting disk usage: ${message}`;
  }
}

/**
 * Tool: get_network_info
 */
async function handleGetNetworkInfo(): Promise<string> {
  try {
    const networks = await getNetworkList();
    return JSON.stringify(
      networks.map(n => ({
        name: n.name,
        driver: n.driver,
        scope: n.scope,
      })),
      null,
      2
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return `Error getting network info: ${message}`;
  }
}

/**
 * Tool: run_command
 */
async function handleRunCommand(args: Record<string, unknown>): Promise<string> {
  try {
    const input = RunCommandInputSchema.parse(args);
    const commandArgs = input.args ?? [];

    const result = await executeCommand(input.command, commandArgs);
    const scrubbedOutput = scrubSensitiveData(result.stdout);

    if (result.exitCode !== 0) {
      return `Command exited with code ${String(result.exitCode)}\n\nSTDOUT:\n${scrubbedOutput}\n\nSTDERR:\n${scrubSensitiveData(result.stderr)}`;
    }

    return scrubbedOutput || '(no output)';
  } catch (error) {
    if (error instanceof ShellSecurityError) {
      return `Security error: ${error.message}`;
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    return `Error: ${message}`;
  }
}

/**
 * Tool: read_file
 */
async function handleReadFile(
  args: Record<string, unknown>,
  config: ToolConfig
): Promise<string> {
  try {
    const input = ReadFileInputSchema.parse(args);
    const filePath = input.path;
    let maxLines = input.max_lines;

    // Check if allowed directories are configured
    if (config.allowedDirs.length === 0) {
      return 'Error: No allowed directories configured. Set MCP_ALLOWED_DIRS environment variable.';
    }

    // Validate path is within allowed directories (logical path)
    if (!isPathAllowed(filePath, config.allowedDirs)) {
      return `Error: Access denied. File must be in one of the allowed directories:\n${config.allowedDirs.join('\n')}`;
    }

    // SECURITY: Validate symlink target is also within allowed directories
    const realPathResult = await validateRealPath(filePath, config.allowedDirs);
    if (!realPathResult.valid) {
      return `Error: ${realPathResult.error ?? 'Invalid path'}`;
    }
    const actualPath = realPathResult.realPath ?? filePath;

    // Check file extension for safety
    if (!isSafeExtension(actualPath)) {
      return 'Error: Cannot read binary or unsupported file type. Only text files are supported.';
    }

    // Check file exists and is a file (not directory)
    try {
      const stats = await fs.stat(actualPath);
      if (!stats.isFile()) {
        return `Error: Path is not a file: ${filePath}`;
      }

      // Check file size
      const fileSizeKb = stats.size / 1024;
      if (fileSizeKb > config.maxFileSizeKb) {
        return `Error: File too large (${fileSizeKb.toFixed(1)}KB). Maximum allowed: ${String(config.maxFileSizeKb)}KB`;
      }
    } catch {
      return `Error: File not found: ${filePath}`;
    }

    // Read file as buffer first to detect binary content
    const buffer = await fs.readFile(actualPath);

    // SECURITY: Detect binary content (null bytes indicate binary data)
    if (buffer.includes(0)) {
      return 'Error: File contains binary data and cannot be read as text.';
    }

    const content = buffer.toString('utf-8');

    // Limit lines
    maxLines = Math.min(maxLines ?? 200, 500);
    const lines = content.split('\n');
    const truncated = lines.length > maxLines;
    const limitedContent = lines.slice(0, maxLines).join('\n');

    // Scrub sensitive data
    const scrubbed = scrubSensitiveData(limitedContent);

    if (truncated) {
      return `${scrubbed}\n\n... [truncated, showing ${String(maxLines)} of ${String(lines.length)} lines]`;
    }

    return scrubbed;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return `Error reading file: ${message}`;
  }
}

// Re-export for tests
export { ShellSecurityError };

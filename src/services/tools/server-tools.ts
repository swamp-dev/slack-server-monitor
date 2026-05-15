import type { ToolDefinition, ToolConfig } from './types.js';
import {
  getContainerStatus,
  getContainerDetails,
  getContainerLogs,
  getNetworkList,
} from '../../executors/docker.js';
import {
  getSystemResources,
  getDiskUsage,
} from '../../executors/system.js';
import { scrubSensitiveData } from '../../formatters/scrub.js';
import { executeCommand, getAllowedCommands } from '../../utils/shell.js';

/**
 * Tool: get_container_status
 * Get status of all Docker containers or a specific container
 */
export const containerStatusTool: ToolDefinition = {
  spec: {
    name: 'get_container_status',
    description: 'Get status of all Docker containers or detailed info for a specific container. Returns container names, images, states (running/stopped), uptime, and ports.',
    input_schema: {
      type: 'object' as const,
      properties: {
        container_name: {
          type: 'string',
          description: 'Optional: specific container name for detailed info including mounts, networks, and restart count',
        },
      },
    },
  },
  async execute(input: Record<string, unknown>): Promise<string> {
    try {
      const containerName = input.container_name as string | undefined;

      if (containerName) {
        const details = await getContainerDetails(containerName);
        return JSON.stringify({
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
        }, null, 2);
      }

      const containers = await getContainerStatus();
      return JSON.stringify(
        containers.map(c => ({
          name: c.name,
          image: c.image,
          state: c.state,
          status: c.status,
          ports: c.ports,
        })),
        null,
        2
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return `Error getting container status: ${message}`;
    }
  },
};

/**
 * Tool: get_container_logs
 * Get recent logs from a Docker container
 */
export const containerLogsTool: ToolDefinition = {
  spec: {
    name: 'get_container_logs',
    description: 'Get recent logs from a Docker container. Logs are automatically scrubbed to remove sensitive data like passwords and tokens.',
    input_schema: {
      type: 'object' as const,
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
  async execute(input: Record<string, unknown>, config: ToolConfig): Promise<string> {
    try {
      const containerName = input.container_name as string;
      let lines = input.lines as number | undefined;

      if (!containerName) {
        return 'Error: container_name is required';
      }

      // Cap lines to configured max
      lines = Math.min(lines ?? 50, config.maxLogLines);

      const logs = await getContainerLogs(containerName, lines);
      return scrubSensitiveData(logs);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return `Error getting logs: ${message}`;
    }
  },
};

/**
 * Tool: get_system_resources
 * Get current system resource usage
 */
export const systemResourcesTool: ToolDefinition = {
  spec: {
    name: 'get_system_resources',
    description: 'Get current system resource usage including CPU load average (1, 5, 15 min), memory usage (total, used, available), swap usage, and system uptime.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  async execute(): Promise<string> {
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
  },
};

/**
 * Tool: get_disk_usage
 * Get disk usage for all mounted filesystems
 */
export const diskUsageTool: ToolDefinition = {
  spec: {
    name: 'get_disk_usage',
    description: 'Get disk usage for all mounted filesystems. Returns size, used, available, and percent used for each mount point. Excludes temporary filesystems like tmpfs.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  async execute(): Promise<string> {
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
  },
};

/**
 * Tool: get_network_info
 * List Docker networks
 */
export const networkInfoTool: ToolDefinition = {
  spec: {
    name: 'get_network_info',
    description: 'List all Docker networks with their drivers (bridge, host, overlay, etc.) and scope (local, swarm, global).',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  async execute(): Promise<string> {
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
  },
};

/**
 * Tool: search_container_logs
 * Search container logs for a pattern
 */
export const searchContainerLogsTool: ToolDefinition = {
  spec: {
    name: 'search_container_logs',
    description: 'Search Docker container logs for a specific pattern. Returns only matching lines with line numbers. Useful for finding errors, specific events, or patterns in large log outputs.',
    input_schema: {
      type: 'object' as const,
      properties: {
        container_name: {
          type: 'string',
          description: 'Name of the container to search logs from',
        },
        search_pattern: {
          type: 'string',
          description: 'Text pattern to search for in log lines',
        },
        lines: {
          type: 'number',
          description: 'Number of recent log lines to search through (default: 500, max: 2000)',
        },
        since: {
          type: 'string',
          description: 'Only search logs since this duration (e.g., "1h", "30m", "2h30m")',
        },
        case_insensitive: {
          type: 'boolean',
          description: 'Case-insensitive search (default: true)',
        },
      },
      required: ['container_name', 'search_pattern'],
    },
  },
  async execute(input: Record<string, unknown>, config: ToolConfig): Promise<string> {
    try {
      const containerName = input.container_name as string;
      const searchPattern = input.search_pattern as string;
      const lines = Math.min(typeof input.lines === 'number' ? input.lines : 500, 2000);
      const since = input.since as string | undefined;
      const caseInsensitive = typeof input.case_insensitive === 'boolean' ? input.case_insensitive : true;

      if (!containerName) return 'Error: container_name is required';
      if (!searchPattern) return 'Error: search_pattern is required';

      // Build docker logs args
      const args: string[] = ['logs', '--tail', String(lines)];
      if (since) {
        args.push('--since', since);
      }
      args.push(containerName);

      const result = await executeCommand('docker', args, { timeout: 30000 });

      // Docker logs outputs to both stdout and stderr (stderr for older logs)
      const allOutput = (result.stdout + '\n' + result.stderr).trim();

      if (!allOutput) {
        return 'No logs found for the specified criteria.';
      }

      // Filter lines in-process (no shell pipes needed)
      const logLines = allOutput.split('\n');
      const matchingLines: string[] = [];
      const pattern = caseInsensitive ? searchPattern.toLowerCase() : searchPattern;

      for (let i = 0; i < logLines.length; i++) {
        const line = logLines[i];
        if (!line) continue;
        const compareLine = caseInsensitive ? line.toLowerCase() : line;
        if (compareLine.includes(pattern)) {
          matchingLines.push(`[${String(i + 1)}] ${line}`);
        }
      }

      if (matchingLines.length === 0) {
        return `No matches found for "${searchPattern}" in the last ${String(lines)} log lines of ${containerName}.`;
      }

      // Cap output to prevent overwhelming responses
      const maxResults = Math.min(matchingLines.length, config.maxLogLines * 2);
      const truncated = matchingLines.length > maxResults;
      const output = matchingLines.slice(0, maxResults).join('\n');

      const header = `Found ${String(matchingLines.length)} matches for "${searchPattern}" in ${containerName}:`;
      const footer = truncated
        ? `\n\n... [showing ${String(maxResults)} of ${String(matchingLines.length)} matches]`
        : '';

      return scrubSensitiveData(`${header}\n\n${output}${footer}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return `Error searching logs: ${message}`;
    }
  },
};

/**
 * Tool: get_docker_images
 * List Docker images with size and creation info
 */
export const dockerImagesTool: ToolDefinition = {
  spec: {
    name: 'get_docker_images',
    description: 'List all Docker images on the server with repository, tag, size, and creation date. Useful for identifying large or outdated images.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  async execute(): Promise<string> {
    try {
      const result = await executeCommand('docker', [
        'images',
        '--format', '{{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.CreatedAt}}\t{{.ID}}',
      ]);

      if (result.exitCode !== 0) {
        return `Error listing images: ${result.stderr || 'Unknown error'}`;
      }

      if (!result.stdout.trim()) {
        return 'No Docker images found.';
      }

      // Parse and format as structured output
      const lines = result.stdout.trim().split('\n');
      const images = lines.map(line => {
        const [repository, tag, size, createdAt, id] = line.split('\t');
        return { repository, tag, size, createdAt, id };
      });

      return JSON.stringify(images, null, 2);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return `Error listing Docker images: ${message}`;
    }
  },
};

/**
 * Tool: run_command
 * Execute a shell command from the allowlist
 */
export const runCommandTool: ToolDefinition = {
  spec: {
    name: 'run_command',
    description: `Execute a read-only shell command for system diagnostics. Available commands: ${getAllowedCommands().join(', ')}.
Commands have security restrictions:
- docker: only ps, inspect, logs, network, images, version, info, compose (ps/config/ls/images/logs/top), stats
- systemctl: only status, show, list-units, list-unit-files, is-active, is-enabled, cat
- journalctl: read-only (no flush/rotate/vacuum)
- curl: GET only (no POST/PUT/upload)
- gh: only issue (create/list/view), pr (list/view), repo (view)
- File commands (cat, ls, head, tail, find, grep): restricted to allowed directories`,
    input_schema: {
      type: 'object' as const,
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
  async execute(input: Record<string, unknown>): Promise<string> {
    try {
      const command = input.command as string;
      const args = Array.isArray(input.args) ? (input.args as string[]) : [];

      if (!command) {
        return 'Error: command is required';
      }

      const result = await executeCommand(command, args);

      // Scrub sensitive data from output
      const scrubbedOutput = scrubSensitiveData(result.stdout);

      if (result.exitCode !== 0) {
        return `Command exited with code ${String(result.exitCode)}\n\nSTDOUT:\n${scrubbedOutput}\n\nSTDERR:\n${scrubSensitiveData(result.stderr)}`;
      }

      return scrubbedOutput || '(no output)';
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return `Error: ${message}`;
    }
  },
};

/**
 * All server monitoring tools
 */
export const serverTools: ToolDefinition[] = [
  containerStatusTool,
  containerLogsTool,
  searchContainerLogsTool,
  systemResourcesTool,
  diskUsageTool,
  networkInfoTool,
  dockerImagesTool,
  runCommandTool,
];

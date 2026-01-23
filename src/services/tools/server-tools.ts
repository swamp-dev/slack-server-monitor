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
 * All server monitoring tools
 */
export const serverTools: ToolDefinition[] = [
  containerStatusTool,
  containerLogsTool,
  systemResourcesTool,
  diskUsageTool,
  networkInfoTool,
];

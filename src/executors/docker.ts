import { executeCommand } from '../utils/shell.js';
import { logger } from '../utils/logger.js';

/**
 * Container information from docker ps
 */
export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  status: string;
  state: 'running' | 'exited' | 'paused' | 'restarting' | 'dead' | 'created' | 'removing';
  ports: string;
  created: string;
}

/**
 * Detailed container information from docker inspect
 */
export interface ContainerDetails {
  id: string;
  name: string;
  image: string;
  state: {
    status: string;
    running: boolean;
    startedAt: string;
    finishedAt: string;
  };
  restartCount: number;
  platform: string;
  mounts: {
    source: string;
    destination: string;
    mode: string;
  }[];
  networks: string[];
  ports: Record<string, string>;
  // SECURITY: Environment variables intentionally excluded - they often contain secrets
}

/**
 * Docker network information
 */
export interface NetworkInfo {
  id: string;
  name: string;
  driver: string;
  scope: string;
}

/**
 * Get list of all containers
 */
export async function getContainerStatus(
  filterPrefix?: string
): Promise<ContainerInfo[]> {
  const format = '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.State}}\t{{.Ports}}\t{{.CreatedAt}}';
  const args = ['ps', '-a', '--format', format];

  const result = await executeCommand('docker', args);

  if (result.exitCode !== 0) {
    logger.error('Failed to get container status', { stderr: result.stderr });
    throw new Error(`Failed to get container status: ${result.stderr}`);
  }

  const containers: ContainerInfo[] = [];

  for (const line of result.stdout.trim().split('\n')) {
    if (!line) continue;

    const parts = line.split('\t');
    if (parts.length < 7) continue;

    const [id, name, image, status, state, ports, created] = parts;

    // Filter by prefix if specified
    if (filterPrefix && !name?.toLowerCase().startsWith(filterPrefix.toLowerCase())) {
      continue;
    }

    containers.push({
      id: id ?? '',
      name: name ?? '',
      image: image ?? '',
      status: status ?? '',
      state: (state ?? 'created') as ContainerInfo['state'],
      ports: ports ?? '',
      created: created ?? '',
    });
  }

  return containers;
}

/**
 * Get detailed information for a specific container
 */
export async function getContainerDetails(containerName: string): Promise<ContainerDetails> {
  const result = await executeCommand('docker', ['inspect', containerName]);

  if (result.exitCode !== 0) {
    if (result.stderr.includes('No such object')) {
      throw new Error(`Container not found: ${containerName}`);
    }
    logger.error('Failed to inspect container', { containerName, stderr: result.stderr });
    throw new Error(`Failed to inspect container: ${result.stderr}`);
  }

  try {
    const data = JSON.parse(result.stdout) as unknown[];
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('Invalid inspect response');
    }

    const container = data[0] as Record<string, unknown>;
    const containerState = container.State as Record<string, unknown> | undefined;
    const hostConfig = container.HostConfig as Record<string, unknown> | undefined;
    const networkSettings = container.NetworkSettings as Record<string, unknown> | undefined;
    const containerConfig = container.Config as Record<string, unknown> | undefined;
    const mounts = container.Mounts as Record<string, unknown>[] | undefined;

    // Extract port bindings
    const portBindings = hostConfig?.PortBindings as Record<string, { HostPort: string }[]> | undefined;
    const ports: Record<string, string> = {};
    if (portBindings) {
      for (const [containerPort, bindings] of Object.entries(portBindings)) {
        const firstBinding = bindings[0];
        if (firstBinding) {
          ports[containerPort] = firstBinding.HostPort;
        }
      }
    }

    // Extract network names
    const networks = networkSettings?.Networks as Record<string, unknown> | undefined;
    const networkNames = networks ? Object.keys(networks) : [];

    // Helper to safely convert unknown to string
    const toStr = (val: unknown, fallback = ''): string => {
      if (val === null || val === undefined) return fallback;
      if (typeof val === 'string') return val;
      if (typeof val === 'number' || typeof val === 'boolean') return String(val);
      // For objects, return fallback to avoid [object Object]
      return fallback;
    };

    return {
      id: toStr(container.Id),
      name: toStr(container.Name).replace(/^\//, ''),
      image: toStr(containerConfig?.Image),
      state: {
        status: toStr(containerState?.Status),
        running: Boolean(containerState?.Running),
        startedAt: toStr(containerState?.StartedAt),
        finishedAt: toStr(containerState?.FinishedAt),
      },
      restartCount: Number(containerState?.RestartCount ?? 0),
      platform: toStr(container.Platform, 'linux'),
      mounts: (mounts ?? []).map((m) => ({
        source: toStr(m.Source),
        destination: toStr(m.Destination),
        mode: toStr(m.Mode),
      })),
      networks: networkNames,
      ports,
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('Failed to parse container details');
    }
    throw error;
  }
}

/**
 * Get logs for a specific container
 */
export async function getContainerLogs(
  containerName: string,
  lines: number
): Promise<string> {
  const result = await executeCommand('docker', [
    'logs',
    '--tail',
    String(lines),
    '--timestamps',
    containerName,
  ]);

  // Docker logs writes to stderr for container stderr output
  // Combine both outputs
  const output = result.stdout + result.stderr;

  if (result.exitCode !== 0 && !output) {
    throw new Error(`Failed to get logs: ${result.stderr}`);
  }

  return output;
}

/**
 * Get list of Docker networks
 */
export async function getNetworkList(): Promise<NetworkInfo[]> {
  const format = '{{.ID}}\t{{.Name}}\t{{.Driver}}\t{{.Scope}}';
  const result = await executeCommand('docker', ['network', 'ls', '--format', format]);

  if (result.exitCode !== 0) {
    throw new Error(`Failed to list networks: ${result.stderr}`);
  }

  const networks: NetworkInfo[] = [];

  for (const line of result.stdout.trim().split('\n')) {
    if (!line) continue;

    const parts = line.split('\t');
    if (parts.length < 4) continue;

    const [id, name, driver, scope] = parts;
    networks.push({
      id: id ?? '',
      name: name ?? '',
      driver: driver ?? '',
      scope: scope ?? '',
    });
  }

  return networks;
}

/**
 * Get Docker version info
 */
export async function getDockerVersion(): Promise<string> {
  const result = await executeCommand('docker', ['version', '--format', '{{.Server.Version}}']);
  return result.stdout.trim();
}

/**
 * Check if Docker is accessible
 */
export async function isDockerAvailable(): Promise<boolean> {
  try {
    const result = await executeCommand('docker', ['info']);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

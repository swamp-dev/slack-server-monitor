import { executeCommand } from '../utils/shell.js';

/**
 * System memory information
 */
export interface MemoryInfo {
  total: number; // MB
  used: number; // MB
  free: number; // MB
  available: number; // MB
  percentUsed: number;
}

/**
 * Swap information
 */
export interface SwapInfo {
  total: number; // MB
  used: number; // MB
  free: number; // MB
  percentUsed: number;
}

/**
 * Disk mount information
 */
export interface DiskMount {
  filesystem: string;
  size: string;
  used: string;
  available: string;
  percentUsed: number;
  mountPoint: string;
}

/**
 * System resource summary
 */
export interface SystemResources {
  memory: MemoryInfo;
  swap: SwapInfo;
  loadAverage: [number, number, number];
  uptime: string;
}

/**
 * Get memory information using 'free' command
 */
export async function getMemoryInfo(): Promise<MemoryInfo> {
  const result = await executeCommand('free', ['-m']);

  if (result.exitCode !== 0) {
    throw new Error(`Failed to get memory info: ${result.stderr}`);
  }

  // Parse free -m output:
  // Mem:  total  used  free  shared  buff/cache  available
  const lines = result.stdout.trim().split('\n');
  const memLine = lines.find((l) => l.startsWith('Mem:'));

  if (!memLine) {
    throw new Error('Failed to parse memory info');
  }

  const parts = memLine.split(/\s+/);
  const total = parseInt(parts[1] ?? '0', 10);
  const used = parseInt(parts[2] ?? '0', 10);
  const free = parseInt(parts[3] ?? '0', 10);
  const available = parseInt(parts[6] ?? '0', 10);

  return {
    total,
    used,
    free,
    available,
    percentUsed: total > 0 ? Math.round((used / total) * 100) : 0,
  };
}

/**
 * Get swap information using 'free' command
 */
export async function getSwapInfo(): Promise<SwapInfo> {
  const result = await executeCommand('free', ['-m']);

  if (result.exitCode !== 0) {
    throw new Error(`Failed to get swap info: ${result.stderr}`);
  }

  // Parse free -m output:
  // Swap: total  used  free
  const lines = result.stdout.trim().split('\n');
  const swapLine = lines.find((l) => l.startsWith('Swap:'));

  if (!swapLine) {
    return { total: 0, used: 0, free: 0, percentUsed: 0 };
  }

  const parts = swapLine.split(/\s+/);
  const total = parseInt(parts[1] ?? '0', 10);
  const used = parseInt(parts[2] ?? '0', 10);
  const free = parseInt(parts[3] ?? '0', 10);

  return {
    total,
    used,
    free,
    percentUsed: total > 0 ? Math.round((used / total) * 100) : 0,
  };
}

/**
 * Get disk usage information using 'df' command
 */
export async function getDiskUsage(): Promise<DiskMount[]> {
  const result = await executeCommand('df', ['-h', '--output=source,size,used,avail,pcent,target']);

  if (result.exitCode !== 0) {
    throw new Error(`Failed to get disk info: ${result.stderr}`);
  }

  const lines = result.stdout.trim().split('\n');
  const mounts: DiskMount[] = [];

  // Skip header line
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    const parts = line.trim().split(/\s+/);
    if (parts.length < 6) continue;

    // Skip special filesystems
    const fs = parts[0] ?? '';
    if (
      fs.startsWith('tmpfs') ||
      fs.startsWith('devtmpfs') ||
      fs.startsWith('overlay') ||
      fs === 'shm'
    ) {
      continue;
    }

    const percentStr = parts[4] ?? '0%';
    const percentUsed = parseInt(percentStr.replace('%', ''), 10);

    mounts.push({
      filesystem: fs,
      size: parts[1] ?? '',
      used: parts[2] ?? '',
      available: parts[3] ?? '',
      percentUsed,
      mountPoint: parts[5] ?? '',
    });
  }

  return mounts;
}

/**
 * Get system uptime and load average
 */
export async function getUptimeInfo(): Promise<{ uptime: string; loadAverage: [number, number, number] }> {
  const result = await executeCommand('uptime', []);

  if (result.exitCode !== 0) {
    throw new Error(`Failed to get uptime: ${result.stderr}`);
  }

  // Parse uptime output:
  // 12:34:56 up 5 days, 3:21, 1 user, load average: 0.15, 0.10, 0.09
  const output = result.stdout.trim();

  // Extract uptime part
  const upMatch = /up\s+([^,]+(?:,\s*\d+:\d+)?)/.exec(output);
  const uptime = upMatch?.[1]?.trim() ?? 'unknown';

  // Extract load average
  const loadMatch = /load average:\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(output);
  const loadAverage: [number, number, number] = loadMatch
    ? [
        parseFloat(loadMatch[1] ?? '0'),
        parseFloat(loadMatch[2] ?? '0'),
        parseFloat(loadMatch[3] ?? '0'),
      ]
    : [0, 0, 0];

  return { uptime, loadAverage };
}

/**
 * Get combined system resources
 */
export async function getSystemResources(): Promise<SystemResources> {
  const [memory, swap, uptimeInfo] = await Promise.all([
    getMemoryInfo(),
    getSwapInfo(),
    getUptimeInfo(),
  ]);

  return {
    memory,
    swap,
    loadAverage: uptimeInfo.loadAverage,
    uptime: uptimeInfo.uptime,
  };
}

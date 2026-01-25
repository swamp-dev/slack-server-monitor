import { executeCommand } from '../utils/shell.js';

/**
 * CPU information
 */
export interface CpuInfo {
  cores: number;
  model: string;
  usagePercent: number; // Current CPU usage percentage
}

/**
 * System memory information
 */
export interface MemoryInfo {
  total: number; // MB
  used: number; // MB
  free: number; // MB
  available: number; // MB
  bufferCache: number; // MB
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
 * Process information
 */
export interface ProcessInfo {
  total: number;
  running: number;
  sleeping: number;
  zombie: number;
}

/**
 * System resource summary
 */
export interface SystemResources {
  cpu: CpuInfo;
  memory: MemoryInfo;
  swap: SwapInfo;
  processes: ProcessInfo;
  loadAverage: [number, number, number];
  uptime: string;
  uptimeSeconds: number;
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
  const bufferCache = parseInt(parts[5] ?? '0', 10);
  const available = parseInt(parts[6] ?? '0', 10);

  return {
    total,
    used,
    free,
    available,
    bufferCache,
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
export async function getUptimeInfo(): Promise<{ uptime: string; uptimeSeconds: number; loadAverage: [number, number, number] }> {
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

  // Calculate uptime in seconds from the string
  const uptimeSeconds = parseUptimeToSeconds(uptime);

  return { uptime, uptimeSeconds, loadAverage };
}

/**
 * Parse uptime string to seconds
 * Examples: "5 days, 3:21" -> 450060, "3:45" -> 13500, "5 min" -> 300
 */
function parseUptimeToSeconds(uptime: string): number {
  let seconds = 0;

  // Extract days
  const daysMatch = /(\d+)\s*days?/.exec(uptime);
  if (daysMatch) {
    seconds += parseInt(daysMatch[1] ?? '0', 10) * 86400;
  }

  // Extract hours:minutes
  const timeMatch = /(\d+):(\d+)/.exec(uptime);
  if (timeMatch) {
    seconds += parseInt(timeMatch[1] ?? '0', 10) * 3600;
    seconds += parseInt(timeMatch[2] ?? '0', 10) * 60;
  }

  // Extract minutes only (e.g., "5 min")
  const minMatch = /(\d+)\s*min/.exec(uptime);
  if (minMatch && !timeMatch) {
    seconds += parseInt(minMatch[1] ?? '0', 10) * 60;
  }

  return seconds;
}

/**
 * Get CPU information
 */
export async function getCpuInfo(): Promise<CpuInfo> {
  // Get CPU model and core count from /proc/cpuinfo
  const cpuinfoResult = await executeCommand('cat', ['/proc/cpuinfo']);

  let model = 'Unknown';
  let cores = 0;

  if (cpuinfoResult.exitCode === 0) {
    const lines = cpuinfoResult.stdout.split('\n');
    for (const line of lines) {
      if (line.startsWith('model name')) {
        model = line.split(':')[1]?.trim() ?? 'Unknown';
      }
      if (line.startsWith('processor')) {
        cores++;
      }
    }
  }

  // Get CPU usage from top (one iteration, batch mode)
  // Use stat instead for more reliable CPU usage
  const statResult = await executeCommand('cat', ['/proc/stat']);

  let usagePercent = 0;
  if (statResult.exitCode === 0) {
    const cpuLine = statResult.stdout.split('\n').find(l => l.startsWith('cpu '));
    if (cpuLine) {
      // cpu user nice system idle iowait irq softirq steal guest guest_nice
      const parts = cpuLine.split(/\s+/).slice(1).map(n => parseInt(n, 10));
      const idle = parts[3] ?? 0;
      const iowait = parts[4] ?? 0;
      const total = parts.reduce((a, b) => a + b, 0);
      const idleTotal = idle + iowait;
      usagePercent = total > 0 ? Math.round(((total - idleTotal) / total) * 100) : 0;
    }
  }

  return {
    cores: cores || 1,
    model: model.replace(/\s+/g, ' ').slice(0, 50), // Truncate long model names
    usagePercent,
  };
}

/**
 * Get process information
 */
export async function getProcessInfo(): Promise<ProcessInfo> {
  const result = await executeCommand('ps', ['ax', '-o', 'stat']);

  if (result.exitCode !== 0) {
    return { total: 0, running: 0, sleeping: 0, zombie: 0 };
  }

  const lines = result.stdout.trim().split('\n').slice(1); // Skip header
  let running = 0;
  let sleeping = 0;
  let zombie = 0;

  for (const line of lines) {
    const stat = line.trim().charAt(0);
    switch (stat) {
      case 'R':
        running++;
        break;
      case 'S':
      case 'D':
      case 'I':
        sleeping++;
        break;
      case 'Z':
        zombie++;
        break;
    }
  }

  return {
    total: lines.length,
    running,
    sleeping,
    zombie,
  };
}

/**
 * Get combined system resources
 */
export async function getSystemResources(): Promise<SystemResources> {
  const [cpu, memory, swap, processes, uptimeInfo] = await Promise.all([
    getCpuInfo(),
    getMemoryInfo(),
    getSwapInfo(),
    getProcessInfo(),
    getUptimeInfo(),
  ]);

  return {
    cpu,
    memory,
    swap,
    processes,
    loadAverage: uptimeInfo.loadAverage,
    uptime: uptimeInfo.uptime,
    uptimeSeconds: uptimeInfo.uptimeSeconds,
  };
}

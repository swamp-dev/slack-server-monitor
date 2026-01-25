import { executeCommand } from '../utils/shell.js';

/**
 * CPU information
 */
export interface CpuInfo {
  cores: number;
  model: string;
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
 * Uses /proc/uptime for precise uptime seconds, uptime command for load average
 */
export async function getUptimeInfo(): Promise<{ uptime: string; uptimeSeconds: number; loadAverage: [number, number, number] }> {
  // Get precise uptime from /proc/uptime (format: "seconds.centiseconds idle_seconds")
  const procUptimeResult = await executeCommand('cat', ['/proc/uptime']);
  let uptimeSeconds = 0;

  if (procUptimeResult.exitCode === 0) {
    const firstValue = procUptimeResult.stdout.trim().split(' ')[0];
    uptimeSeconds = Math.floor(parseFloat(firstValue ?? '0'));
  }

  // Get load average from uptime command (more reliable than parsing /proc/loadavg)
  const uptimeResult = await executeCommand('uptime', []);

  if (uptimeResult.exitCode !== 0) {
    throw new Error(`Failed to get uptime: ${uptimeResult.stderr}`);
  }

  const output = uptimeResult.stdout.trim();

  // Extract load average
  const loadMatch = /load average:\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(output);
  const loadAverage: [number, number, number] = loadMatch
    ? [
        parseFloat(loadMatch[1] ?? '0'),
        parseFloat(loadMatch[2] ?? '0'),
        parseFloat(loadMatch[3] ?? '0'),
      ]
    : [0, 0, 0];

  // Format uptime as human-readable string from seconds
  const uptime = formatUptimeString(uptimeSeconds);

  return { uptime, uptimeSeconds, loadAverage };
}

/**
 * Format uptime seconds to human-readable string
 * Examples: 444060 -> "5d 3h 21m", 3660 -> "1h 1m", 45 -> "45s"
 */
export function formatUptimeString(seconds: number): string {
  if (seconds <= 0) return 'unknown';

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${String(days)}d`);
  if (hours > 0) parts.push(`${String(hours)}h`);
  if (minutes > 0) parts.push(`${String(minutes)}m`);
  if (parts.length === 0) parts.push(`${String(secs)}s`);

  return parts.join(' ');
}

/**
 * Get CPU information
 * Note: Does not include real-time CPU usage as that requires delta calculations.
 * Use load average for CPU pressure indication instead.
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

  // Clean up model name: normalize whitespace, truncate with ellipsis if needed
  let cleanModel = model.replace(/\s+/g, ' ');
  if (cleanModel.length > 60) {
    cleanModel = cleanModel.slice(0, 57) + '...';
  }

  return {
    cores: cores || 1, // Default to 1 if parsing fails
    model: cleanModel,
  };
}

/**
 * Get process information
 * Process states: R=running, S=sleeping, D=disk sleep, I=idle,
 *                 Z=zombie, T=stopped, t=tracing stop
 */
export async function getProcessInfo(): Promise<ProcessInfo> {
  const result = await executeCommand('ps', ['-eo', 'stat']);

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
      case 'S': // Interruptible sleep
      case 'D': // Uninterruptible disk sleep
      case 'I': // Idle kernel thread
      case 'T': // Stopped by job control
      case 't': // Stopped by debugger
        sleeping++;
        break;
      case 'Z': // Zombie
      case 'X': // Dead (should never be seen)
        zombie++;
        break;
      // Other states (W=paging) are rare and can be ignored
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

import { executeCommand } from '../utils/shell.js';
import { logger } from '../utils/logger.js';

/**
 * Valid PM2 process statuses
 */
const VALID_PM2_STATUSES = ['online', 'stopped', 'errored', 'stopping', 'launching', 'one-launch-status'] as const;
type Pm2Status = typeof VALID_PM2_STATUSES[number];

/**
 * SECURITY: Validate PM2 status to prevent unsafe type assertions
 * Falls back to 'stopped' for unknown statuses
 */
function validatePm2Status(status: unknown): Pm2Status {
  if (typeof status === 'string' && VALID_PM2_STATUSES.includes(status as Pm2Status)) {
    return status as Pm2Status;
  }
  return 'stopped';
}

/**
 * PM2 process information
 */
export interface Pm2Process {
  name: string;
  pmId: number;
  status: Pm2Status;
  memory: number; // bytes
  cpu: number; // percentage
  uptime: number; // timestamp (ms)
  restarts: number;
  mode: 'fork' | 'cluster';
  instances: number;
}

/**
 * Raw PM2 jlist output structure
 */
interface Pm2JlistItem {
  name: string;
  pm_id: number;
  monit?: {
    memory?: number;
    cpu?: number;
  };
  pm2_env?: {
    status?: string;
    pm_uptime?: number;
    restart_time?: number;
    exec_mode?: string;
    instances?: number;
    node_version?: string;
  };
}

/**
 * Get list of all PM2 processes
 */
export async function getPm2ProcessList(): Promise<Pm2Process[]> {
  const result = await executeCommand('pm2', ['jlist']);

  if (result.exitCode !== 0) {
    logger.error('Failed to get PM2 process list', { stderr: result.stderr });
    throw new Error(`Failed to get PM2 process list: ${result.stderr}`);
  }

  let data: Pm2JlistItem[];
  try {
    data = JSON.parse(result.stdout) as Pm2JlistItem[];
  } catch {
    throw new Error('Failed to parse PM2 output');
  }

  if (!Array.isArray(data)) {
    throw new Error('Invalid PM2 output format');
  }

  return data.map((item) => ({
    name: item.name,
    pmId: item.pm_id,
    status: validatePm2Status(item.pm2_env?.status),
    memory: item.monit?.memory ?? 0,
    cpu: item.monit?.cpu ?? 0,
    uptime: item.pm2_env?.pm_uptime ?? 0,
    restarts: item.pm2_env?.restart_time ?? 0,
    mode: item.pm2_env?.exec_mode === 'cluster' ? 'cluster' : 'fork',
    instances: item.pm2_env?.instances ?? 1,
  }));
}

/**
 * Check if PM2 is available
 */
export async function isPm2Available(): Promise<boolean> {
  try {
    const result = await executeCommand('pm2', ['jlist']);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

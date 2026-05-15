import { executeCommand } from '../utils/shell.js';
import { logger } from '../utils/logger.js';

/**
 * fail2ban overall status
 */
export interface Fail2banStatus {
  jailCount: number;
  jails: string[];
}

/**
 * Detailed jail information
 */
export interface JailDetails {
  name: string;
  currentlyFailed: number;
  totalFailed: number;
  currentlyBanned: number;
  totalBanned: number;
  bannedIps: string[];
  fileList: string[];
}

/**
 * Get fail2ban overall status with list of all jails
 */
export async function getFail2banStatus(): Promise<Fail2banStatus> {
  const result = await executeCommand('fail2ban-client', ['status']);

  if (result.exitCode !== 0) {
    if (result.stderr.includes('Unable to contact server') || result.stderr.includes('Is it running')) {
      throw new Error('fail2ban is not running');
    }
    logger.error('Failed to get fail2ban status', { stderr: result.stderr });
    throw new Error(`Failed to get fail2ban status: ${result.stderr}`);
  }

  // Parse output like:
  // Status
  // |- Number of jail:	3
  // `- Jail list:	sshd, nginx-http-auth, nginx-botsearch

  const lines = result.stdout.split('\n');
  let jailCount = 0;
  let jails: string[] = [];

  for (const line of lines) {
    const countMatch = /Number of jail:\s*(\d+)/.exec(line);
    if (countMatch?.[1]) {
      jailCount = parseInt(countMatch[1], 10);
    }

    const listMatch = /Jail list:\s*(.*)/.exec(line);
    if (listMatch?.[1] !== undefined) {
      const jailList = listMatch[1].trim();
      if (jailList) {
        jails = jailList.split(',').map((j) => j.trim()).filter((j) => j.length > 0);
      }
    }
  }

  return { jailCount, jails };
}

/**
 * Get detailed status for a specific jail
 */
export async function getJailDetails(jailName: string): Promise<JailDetails> {
  const result = await executeCommand('fail2ban-client', ['status', jailName]);

  if (result.exitCode !== 0) {
    if (result.stderr.includes('Unable to contact server') || result.stderr.includes('Is it running')) {
      throw new Error('fail2ban is not running');
    }
    if (result.stderr.includes('does not exist')) {
      throw new Error(`Jail not found: ${jailName}`);
    }
    logger.error('Failed to get jail details', { jailName, stderr: result.stderr });
    throw new Error(`Failed to get jail details: ${result.stderr}`);
  }

  // Parse output like:
  // Status for the jail: sshd
  // |- Filter
  // |  |- Currently failed:	5
  // |  |- Total failed:	127
  // |  `- File list:	/var/log/auth.log
  // `- Actions
  //    |- Currently banned:	3
  //    |- Total banned:	45
  //    `- Banned IP list:	192.168.1.100 10.0.0.50 172.16.0.25

  const lines = result.stdout.split('\n');
  let currentlyFailed = 0;
  let totalFailed = 0;
  let currentlyBanned = 0;
  let totalBanned = 0;
  let bannedIps: string[] = [];
  let fileList: string[] = [];

  for (const line of lines) {
    const currentlyFailedMatch = /Currently failed:\s*(\d+)/.exec(line);
    if (currentlyFailedMatch?.[1]) {
      currentlyFailed = parseInt(currentlyFailedMatch[1], 10);
    }

    const totalFailedMatch = /Total failed:\s*(\d+)/.exec(line);
    if (totalFailedMatch?.[1]) {
      totalFailed = parseInt(totalFailedMatch[1], 10);
    }

    const currentlyBannedMatch = /Currently banned:\s*(\d+)/.exec(line);
    if (currentlyBannedMatch?.[1]) {
      currentlyBanned = parseInt(currentlyBannedMatch[1], 10);
    }

    const totalBannedMatch = /Total banned:\s*(\d+)/.exec(line);
    if (totalBannedMatch?.[1]) {
      totalBanned = parseInt(totalBannedMatch[1], 10);
    }

    const bannedIpsMatch = /Banned IP list:\s*(.*)/.exec(line);
    if (bannedIpsMatch?.[1] !== undefined) {
      const ipList = bannedIpsMatch[1].trim();
      if (ipList) {
        bannedIps = ipList.split(/\s+/).filter((ip) => ip.length > 0);
      }
    }

    const fileListMatch = /File list:\s*(.*)/.exec(line);
    if (fileListMatch?.[1] !== undefined) {
      const files = fileListMatch[1].trim();
      if (files) {
        fileList = files.split(/\s+/).filter((f) => f.length > 0);
      }
    }
  }

  return {
    name: jailName,
    currentlyFailed,
    totalFailed,
    currentlyBanned,
    totalBanned,
    bannedIps,
    fileList,
  };
}

/**
 * Check if fail2ban is available and running
 */
export async function isFail2banAvailable(): Promise<boolean> {
  try {
    const result = await executeCommand('fail2ban-client', ['status']);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

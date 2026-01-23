import { executeCommand } from '../utils/shell.js';
import { logger } from '../utils/logger.js';

/**
 * File information from backup directory
 */
export interface BackupFile {
  name: string;
  size: number;
  modified: string;
}

/**
 * Local backup directory status
 */
export interface BackupDirStatus {
  path: string;
  exists: boolean;
  files: BackupFile[];
  status: 'ok' | 'warn' | 'error';
  error?: string;
  lastBackupAge?: number; // hours
}

/**
 * S3 backup status
 */
export interface S3BackupStatus {
  bucket: string;
  prefix?: string;
  accessible: boolean;
  files: BackupFile[];
  status: 'ok' | 'warn' | 'error';
  error?: string;
  lastBackupAge?: number; // hours
}

/**
 * Combined backup status
 */
export interface AllBackupStatus {
  local: BackupDirStatus[];
  s3?: S3BackupStatus;
}

const MAX_FILES = 5;
const WARN_HOURS = 24;
const ERROR_HOURS = 48;

/**
 * Parse file size from ls -l output
 * Size is the 5th field in ls -l output
 */
function parseFileSize(sizeStr: string): number {
  const size = parseInt(sizeStr, 10);
  return isNaN(size) ? 0 : size;
}

/**
 * Calculate backup status based on last file's age
 *
 * Handles year boundary correctly:
 * - If ls -l shows a year, use that year directly
 * - If ls -l shows a time (HH:MM), the file is from within the last ~6 months
 *   and we need to determine the year based on the month
 */
function calculateBackupStatus(lastModifiedStr: string): { status: 'ok' | 'warn' | 'error'; ageHours: number } {
  // Parse date from ls -l format: "Jun 15 10:00" or "Jun 15 2024"
  try {
    const now = new Date();
    const parts = lastModifiedStr.trim().split(/\s+/);

    if (parts.length < 2) {
      return { status: 'error', ageHours: -1 };
    }

    const months: Record<string, number> = {
      Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
      Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
    };

    const monthName = parts[0];
    const dayStr = parts[1];

    if (!monthName || !dayStr) {
      return { status: 'error', ageHours: -1 };
    }

    const fileMonth = months[monthName];
    const day = parseInt(dayStr, 10);

    if (fileMonth === undefined || isNaN(day)) {
      return { status: 'error', ageHours: -1 };
    }

    let year = now.getFullYear();
    let hours = 0;
    let minutes = 0;
    let hasExplicitYear = false;

    // Third part is either time (HH:MM) or year
    const thirdPart = parts[2];
    if (thirdPart?.includes(':')) {
      const timeParts = thirdPart.split(':');
      hours = parseInt(timeParts[0] ?? '0', 10) || 0;
      minutes = parseInt(timeParts[1] ?? '0', 10) || 0;
    } else if (thirdPart) {
      year = parseInt(thirdPart, 10);
      hasExplicitYear = true;
    }

    let fileDate = new Date(year, fileMonth, day, hours, minutes);

    // If no explicit year was provided (time format), we need to handle year boundary
    // ls -l shows time for files < ~6 months old, otherwise shows year
    if (!hasExplicitYear && fileDate > now) {
      // The file appears to be in the future, meaning it's actually from last year
      // This happens at year boundaries: e.g., now=Jan 2025, file=Dec (showing Dec 15 10:00)
      //
      // However, we need to be careful: if the file month is after the current month
      // in a non-boundary case, it still means previous year.
      //
      // Example: now=Jan 5, file="Dec 31 10:00" -> Dec 31, 2024 (not 2025)
      fileDate = new Date(year - 1, fileMonth, day, hours, minutes);
    }

    const ageMs = now.getTime() - fileDate.getTime();
    const ageHours = ageMs / (1000 * 60 * 60);

    // Sanity check: if age is negative after adjustment, something is wrong
    if (ageHours < 0) {
      // This shouldn't happen, but if it does, treat as error
      return { status: 'error', ageHours: -1 };
    }

    let status: 'ok' | 'warn' | 'error';
    if (ageHours > ERROR_HOURS) {
      status = 'error';
    } else if (ageHours > WARN_HOURS) {
      status = 'warn';
    } else {
      status = 'ok';
    }

    return { status, ageHours };
  } catch {
    return { status: 'error', ageHours: -1 };
  }
}

/**
 * Get local backup directory status
 */
export async function getLocalBackupStatus(dirPath: string): Promise<BackupDirStatus> {
  const result = await executeCommand('ls', ['-lt', dirPath]);

  if (result.exitCode !== 0) {
    if (result.stderr.includes('No such file or directory')) {
      return {
        path: dirPath,
        exists: false,
        files: [],
        status: 'error',
        error: 'Directory not found',
      };
    }

    if (result.stderr.includes('Permission denied')) {
      return {
        path: dirPath,
        exists: true,
        files: [],
        status: 'error',
        error: 'Permission denied',
      };
    }

    return {
      path: dirPath,
      exists: false,
      files: [],
      status: 'error',
      error: result.stderr || 'Unknown error',
    };
  }

  const files: BackupFile[] = [];
  const lines = result.stdout.split('\n');

  for (const line of lines) {
    // Skip empty lines, total line, and directories
    if (!line || line.startsWith('total') || line.startsWith('d')) continue;

    // Parse ls -l output: -rw-r--r-- 1 root root 10485760 Jun 15 10:00 filename
    const parts = line.split(/\s+/);
    if (parts.length < 9) continue;

    // Permissions at index 0, size at index 4, date starts at index 5
    const sizeStr = parts[4];
    const month = parts[5];
    const dayPart = parts[6];
    const timePart = parts[7];

    if (!sizeStr || !month || !dayPart || !timePart) continue;

    const size = parseFileSize(sizeStr);
    const dateStr = `${month} ${dayPart} ${timePart}`;
    const name = parts.slice(8).join(' ');

    if (name) {
      files.push({
        name,
        size,
        modified: dateStr,
      });
    }

    // Limit to MAX_FILES
    if (files.length >= MAX_FILES) break;
  }

  const firstFile = files[0];
  if (!firstFile) {
    return {
      path: dirPath,
      exists: true,
      files: [],
      status: 'error',
      error: 'No backup files found',
    };
  }

  // Calculate status based on most recent file (first in list since sorted by -t)
  const { status, ageHours } = calculateBackupStatus(firstFile.modified);

  return {
    path: dirPath,
    exists: true,
    files,
    status,
    lastBackupAge: ageHours >= 0 ? Math.round(ageHours) : undefined,
  };
}

/**
 * Get S3 backup status
 */
export async function getS3BackupStatus(
  bucket: string,
  prefix?: string
): Promise<S3BackupStatus> {
  const s3Path = prefix ? `s3://${bucket}/${prefix}` : `s3://${bucket}/`;

  const result = await executeCommand('aws', ['s3', 'ls', s3Path, '--human-readable'], { timeout: 30000 });

  if (result.exitCode !== 0) {
    if (result.stderr.includes('NoSuchBucket')) {
      return {
        bucket,
        prefix,
        accessible: false,
        files: [],
        status: 'error',
        error: 'Bucket not found',
      };
    }

    if (result.stderr.includes('AccessDenied')) {
      return {
        bucket,
        prefix,
        accessible: false,
        files: [],
        status: 'error',
        error: 'Access denied',
      };
    }

    if (result.stderr.includes('Unable to locate credentials')) {
      return {
        bucket,
        prefix,
        accessible: false,
        files: [],
        status: 'error',
        error: 'AWS credentials not configured',
      };
    }

    return {
      bucket,
      prefix,
      accessible: false,
      files: [],
      status: 'error',
      error: result.stderr || 'Unknown error',
    };
  }

  const files: BackupFile[] = [];
  const lines = result.stdout.split('\n');

  for (const line of lines) {
    if (!line.trim()) continue;

    // Parse aws s3 ls output: 2024-06-15 10:00:00   10485760 filename
    // With --human-readable: 2024-06-15 10:00:00  10.0 MiB filename
    const match = /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+(\d+)\s+(.+)$/.exec(line);
    if (match) {
      const [, date, time, sizeStr, name] = match;
      if (date && time && sizeStr && name) {
        files.push({
          name,
          size: parseInt(sizeStr, 10),
          modified: `${date} ${time}`,
        });
      }
    }

    if (files.length >= MAX_FILES) break;
  }

  if (files.length === 0) {
    return {
      bucket,
      prefix,
      accessible: true,
      files: [],
      status: 'error',
      error: 'No backup files found',
    };
  }

  // Calculate status based on most recent file
  const lastFile = files[0];
  if (!lastFile) {
    return {
      bucket,
      prefix,
      accessible: true,
      files: [],
      status: 'error',
      error: 'No backup files found',
    };
  }
  const lastModified = new Date(`${lastFile.modified.replace(' ', 'T')}Z`);
  const ageMs = Date.now() - lastModified.getTime();
  const ageHours = ageMs / (1000 * 60 * 60);

  let status: 'ok' | 'warn' | 'error';
  if (ageHours > ERROR_HOURS) {
    status = 'error';
  } else if (ageHours > WARN_HOURS) {
    status = 'warn';
  } else {
    status = 'ok';
  }

  return {
    bucket,
    prefix,
    accessible: true,
    files,
    status,
    lastBackupAge: Math.round(ageHours),
  };
}

/**
 * Get status of all configured backup locations
 */
export async function getAllBackupStatus(
  localDirs: string[],
  s3Bucket?: string,
  s3Prefix?: string
): Promise<AllBackupStatus> {
  const local: BackupDirStatus[] = [];

  for (const dir of localDirs) {
    try {
      const status = await getLocalBackupStatus(dir);
      local.push(status);
    } catch (error) {
      logger.error('Failed to get local backup status', { dir, error });
      local.push({
        path: dir,
        exists: false,
        files: [],
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  let s3: S3BackupStatus | undefined;
  if (s3Bucket) {
    try {
      s3 = await getS3BackupStatus(s3Bucket, s3Prefix);
    } catch (error) {
      logger.error('Failed to get S3 backup status', { bucket: s3Bucket, error });
      s3 = {
        bucket: s3Bucket,
        prefix: s3Prefix,
        accessible: false,
        files: [],
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  return { local, s3 };
}

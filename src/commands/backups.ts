import type { App } from '@slack/bolt';
import type { KnownBlock } from '@slack/types';
import { getAllBackupStatus, type BackupDirStatus, type S3BackupStatus } from '../executors/backups.js';
import { config } from '../config/index.js';
import { formatBytes } from '../formatters/blocks.js';
import {
  header,
  section,
  divider,
  context,
  statusEmoji,
  error,
  statsBar,
  helpTip,
} from '../formatters/blocks.js';
import { logger } from '../utils/logger.js';

/**
 * Format age in hours to human readable string
 */
function formatAge(hours: number | undefined): string {
  if (hours === undefined || hours < 0) return 'Unknown';

  if (hours < 1) return 'Just now';
  if (hours < 24) return `${String(Math.round(hours))}h ago`;
  const days = Math.floor(hours / 24);
  return `${String(days)}d ago`;
}

/**
 * Build blocks for a local backup directory
 */
function buildLocalBackupBlocks(backup: BackupDirStatus): KnownBlock[] {
  const emoji = statusEmoji(backup.status);
  const blocks: KnownBlock[] = [];

  if (!backup.exists) {
    blocks.push(
      section(`${emoji} *${backup.path}*\n_${backup.error ?? 'Directory not found'}_`)
    );
    return blocks;
  }

  if (backup.error) {
    blocks.push(
      section(`${emoji} *${backup.path}*\n_${backup.error}_`)
    );
    return blocks;
  }

  const ageStr = formatAge(backup.lastBackupAge);
  blocks.push(
    section(`${emoji} *${backup.path}*\nLast backup: ${ageStr}`)
  );

  // Show recent files
  if (backup.files.length > 0) {
    const fileList = backup.files
      .slice(0, 5)
      .map((f) => `\`${f.name}\` (${formatBytes(f.size)})`)
      .join('\n');
    blocks.push(context(fileList));
  }

  return blocks;
}

/**
 * Build blocks for S3 backup status
 */
function buildS3BackupBlocks(backup: S3BackupStatus): KnownBlock[] {
  const emoji = statusEmoji(backup.status);
  const blocks: KnownBlock[] = [];

  const location = backup.prefix ? `${backup.bucket}/${backup.prefix}` : backup.bucket;

  if (!backup.accessible) {
    blocks.push(
      section(`${emoji} *S3: ${location}*\n_${backup.error ?? 'Not accessible'}_`)
    );
    return blocks;
  }

  if (backup.error) {
    blocks.push(
      section(`${emoji} *S3: ${location}*\n_${backup.error}_`)
    );
    return blocks;
  }

  const ageStr = formatAge(backup.lastBackupAge);
  blocks.push(
    section(`${emoji} *S3: ${location}*\nLast backup: ${ageStr}`)
  );

  // Show recent files
  if (backup.files.length > 0) {
    const fileList = backup.files
      .slice(0, 5)
      .map((f) => `\`${f.name}\` (${formatBytes(f.size)})`)
      .join('\n');
    blocks.push(context(fileList));
  }

  return blocks;
}

/**
 * Register the /backups command
 *
 * Usage:
 *   /backups - Show status of all configured backup locations
 */
export function registerBackupsCommand(app: App): void {
  app.command('/backups', async ({ ack, respond }) => {
    await ack();

    try {
      const localDirs = config.server.backupDirs;
      const s3Bucket = config.server.s3BackupBucket;

      if (localDirs.length === 0 && !s3Bucket) {
        await respond({
          blocks: [
            header('Backup Status'),
            section(':information_source: No backup locations configured.'),
            context('Set `BACKUP_DIRS` and/or `S3_BACKUP_BUCKET` environment variables.'),
          ],
          response_type: 'ephemeral',
        });
        return;
      }

      const status = await getAllBackupStatus(localDirs, s3Bucket);

      const blocks: KnownBlock[] = [
        header('Backup Status'),
        context(`Checking ${String(localDirs.length)} local dir(s)${s3Bucket ? ' and S3' : ''}`),
        divider(),
      ];

      // Local backups
      for (const backup of status.local) {
        blocks.push(...buildLocalBackupBlocks(backup));
      }

      // S3 backups
      if (status.s3) {
        if (status.local.length > 0) {
          blocks.push(divider());
        }
        blocks.push(...buildS3BackupBlocks(status.s3));
      }

      // Summary using stats bar
      const allStatuses = [
        ...status.local.map((b) => b.status),
        ...(status.s3 ? [status.s3.status] : []),
      ];

      const errorCount = allStatuses.filter((s) => s === 'error').length;
      const warnCount = allStatuses.filter((s) => s === 'warn').length;
      const okCount = allStatuses.filter((s) => s === 'ok').length;

      blocks.push(divider());
      blocks.push(
        context(
          statsBar([
            { count: okCount, label: 'current', status: 'ok' },
            { count: warnCount, label: 'stale (>24h)', status: 'warn' },
            { count: errorCount, label: 'issues', status: 'error' },
          ])
        )
      );

      // Add helpful tips
      blocks.push(
        helpTip([
          'Stale = >24h since last backup',
          'Issues = >48h or directory missing',
        ])
      );

      await respond({ blocks, response_type: 'ephemeral' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred';
      logger.error('Backups command failed', { error: message });
      await respond({ blocks: [error(message)], response_type: 'ephemeral' });
    }
  });
}

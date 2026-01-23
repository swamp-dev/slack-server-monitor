import type { App } from '@slack/bolt';
import type { KnownBlock } from '@slack/types';
import { getSystemResources, getDiskUsage } from '../executors/system.js';
import {
  header,
  section,
  sectionWithFields,
  divider,
  context,
  progressBar,
  statusEmoji,
  error,
} from '../formatters/blocks.js';
import { logger } from '../utils/logger.js';

/**
 * Register the /resources command
 *
 * Usage:
 *   /resources - Show CPU, memory, disk, and swap overview
 */
export function registerResourcesCommand(app: App): void {
  app.command('/resources', async ({ ack, respond }) => {
    await ack();

    try {
      const resources = await getSystemResources();

      // Determine status indicators
      const memStatus = getUsageStatus(resources.memory.percentUsed);
      const swapStatus = getUsageStatus(resources.swap.percentUsed);

      const blocks: KnownBlock[] = [
        header('System Resources'),
        context(`Uptime: ${resources.uptime} | Load: ${resources.loadAverage.join(', ')}`),
        divider(),

        // Memory
        section(
          `${statusEmoji(memStatus)} *Memory*\n` +
            `${progressBar(resources.memory.used, resources.memory.total)}\n` +
            `${String(resources.memory.used)} MB / ${String(resources.memory.total)} MB used`
        ),

        // Swap
        section(
          resources.swap.total > 0
            ? `${statusEmoji(swapStatus)} *Swap*\n` +
                `${progressBar(resources.swap.used, resources.swap.total)}\n` +
                `${String(resources.swap.used)} MB / ${String(resources.swap.total)} MB used`
            : `${statusEmoji('unknown')} *Swap*\nNot configured`
        ),
      ];

      await respond({ blocks, response_type: 'ephemeral' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred';
      logger.error('Resources command failed', { error: message });
      await respond({ blocks: [error(message)], response_type: 'ephemeral' });
    }
  });
}

/**
 * Register the /disk command
 *
 * Usage:
 *   /disk - Show detailed disk usage per mount
 */
export function registerDiskCommand(app: App): void {
  app.command('/disk', async ({ ack, respond }) => {
    await ack();

    try {
      const mounts = await getDiskUsage();

      const blocks: KnownBlock[] = [
        header('Disk Usage'),
        context(`${String(mounts.length)} mount(s) found`),
        divider(),
      ];

      for (const mount of mounts) {
        const status = getUsageStatus(mount.percentUsed);
        blocks.push(
          sectionWithFields([
            `*${mount.mountPoint}*\n${statusEmoji(status)} ${String(mount.percentUsed)}% used`,
            `*Size:* ${mount.size}\n*Used:* ${mount.used}\n*Free:* ${mount.available}`,
          ])
        );
      }

      if (mounts.length === 0) {
        blocks.push(section('No disk mounts found.'));
      }

      await respond({ blocks, response_type: 'ephemeral' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred';
      logger.error('Disk command failed', { error: message });
      await respond({ blocks: [error(message)], response_type: 'ephemeral' });
    }
  });
}

/**
 * Get status type based on usage percentage
 */
function getUsageStatus(percent: number): 'ok' | 'warn' | 'error' {
  if (percent >= 90) return 'error';
  if (percent >= 75) return 'warn';
  return 'ok';
}

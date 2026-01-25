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
  formatUptime,
  helpTip,
  statsBar,
} from '../formatters/blocks.js';
import { logger } from '../utils/logger.js';

/**
 * Format memory size in MB to human-readable string
 */
function formatMB(mb: number): string {
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(1)} GB`;
  }
  return `${String(mb)} MB`;
}

/**
 * Get load average status based on cores
 * Load > cores means overloaded
 */
function getLoadStatus(load1m: number, cores: number): 'ok' | 'warn' | 'error' {
  const loadPerCore = load1m / cores;
  if (loadPerCore >= 1.0) return 'error';
  if (loadPerCore >= 0.7) return 'warn';
  return 'ok';
}

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
      const loadStatus = getLoadStatus(resources.loadAverage[0], resources.cpu.cores);
      const memStatus = getUsageStatus(resources.memory.percentUsed);
      const swapStatus = getUsageStatus(resources.swap.percentUsed);

      // Format uptime nicely
      const uptimeFormatted = resources.uptimeSeconds > 0
        ? formatUptime(resources.uptimeSeconds)
        : resources.uptime;

      // Calculate load as percentage of cores for progress bar
      const loadPercent = Math.min(100, Math.round((resources.loadAverage[0] / resources.cpu.cores) * 100));

      const blocks: KnownBlock[] = [
        header('System Resources'),
        divider(),

        // System Overview - uptime, processes
        sectionWithFields([
          `*Uptime*\n:clock1: ${uptimeFormatted}`,
          `*Processes*\n:gear: ${String(resources.processes.total)} total (${String(resources.processes.running)} running)`,
        ]),

        divider(),

        // CPU & Load Section
        section(
          `${statusEmoji(loadStatus)} *CPU Load*\n` +
            `${progressBar(loadPercent, 100)}\n` +
            `\`${resources.cpu.model}\` (${String(resources.cpu.cores)} cores)`
        ),

        // Load Average details
        section(
          `*Load Average*\n` +
            `1m: \`${resources.loadAverage[0].toFixed(2)}\` · ` +
            `5m: \`${resources.loadAverage[1].toFixed(2)}\` · ` +
            `15m: \`${resources.loadAverage[2].toFixed(2)}\`\n` +
            `_${resources.loadAverage[0] > resources.cpu.cores ? ':warning: Load exceeds core count!' : `Load per core: ${(resources.loadAverage[0] / resources.cpu.cores).toFixed(2)}`}_`
        ),

        divider(),

        // Memory Section
        section(
          `${statusEmoji(memStatus)} *Memory*\n` +
            `${progressBar(resources.memory.used, resources.memory.total)}\n` +
            `Used: \`${formatMB(resources.memory.used)}\` / \`${formatMB(resources.memory.total)}\`\n` +
            `Available: \`${formatMB(resources.memory.available)}\` · Buffer/Cache: \`${formatMB(resources.memory.bufferCache)}\``
        ),

        // Swap Section
        section(
          resources.swap.total > 0
            ? `${statusEmoji(swapStatus)} *Swap*\n` +
                `${progressBar(resources.swap.used, resources.swap.total)}\n` +
                `Used: \`${formatMB(resources.swap.used)}\` / \`${formatMB(resources.swap.total)}\``
            : `${statusEmoji('unknown')} *Swap*\n_Not configured_`
        ),
      ];

      // Add zombie warning if any
      if (resources.processes.zombie > 0) {
        blocks.push(
          context(`:warning: ${String(resources.processes.zombie)} zombie process${resources.processes.zombie > 1 ? 'es' : ''} detected`)
        );
      }

      // Add helpful tips
      blocks.push(divider());
      blocks.push(
        helpTip([`Use \`/disk\` for detailed disk usage per mount point`])
      );

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

      // Add summary stats bar
      const criticalMounts = mounts.filter((m) => m.percentUsed >= 90).length;
      const warningMounts = mounts.filter((m) => m.percentUsed >= 75 && m.percentUsed < 90).length;
      const healthyMounts = mounts.filter((m) => m.percentUsed < 75).length;

      if (mounts.length > 0) {
        blocks.push(divider());
        blocks.push(
          context(
            statsBar([
              { count: healthyMounts, label: 'healthy', status: 'ok' },
              { count: warningMounts, label: 'warning', status: 'warn' },
              { count: criticalMounts, label: 'critical', status: 'error' },
            ])
          )
        );
        blocks.push(
          helpTip([`Use \`/resources\` for CPU, memory, and load average`])
        );
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

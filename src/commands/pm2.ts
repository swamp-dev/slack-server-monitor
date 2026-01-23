import type { App } from '@slack/bolt';
import type { KnownBlock } from '@slack/types';
import { getPm2ProcessList, isPm2Available, type Pm2Process } from '../executors/pm2.js';
import { formatBytes, formatUptime } from '../formatters/blocks.js';
import {
  header,
  section,
  divider,
  context,
  statusEmoji,
  error,
} from '../formatters/blocks.js';
import { logger } from '../utils/logger.js';

/**
 * Get status emoji for PM2 process status
 */
function getProcessStatusEmoji(status: Pm2Process['status']): string {
  switch (status) {
    case 'online':
      return statusEmoji('ok');
    case 'stopped':
    case 'stopping':
      return statusEmoji('warn');
    case 'errored':
      return statusEmoji('error');
    case 'launching':
    case 'one-launch-status':
      return statusEmoji('warn');
    default:
      return statusEmoji('unknown');
  }
}

/**
 * Format uptime from timestamp
 */
function formatProcessUptime(uptimeMs: number): string {
  if (!uptimeMs || uptimeMs <= 0) return 'N/A';

  const now = Date.now();
  const uptimeSeconds = Math.floor((now - uptimeMs) / 1000);

  if (uptimeSeconds < 0) return 'N/A';

  return formatUptime(uptimeSeconds);
}

/**
 * Register the /pm2 command
 *
 * Usage:
 *   /pm2 - Show all PM2 processes
 */
export function registerPm2Command(app: App): void {
  app.command('/pm2', async ({ ack, respond }) => {
    await ack();

    try {
      // Check if PM2 is available
      const available = await isPm2Available();
      if (!available) {
        await respond({
          blocks: [
            header('PM2 Status'),
            section(':information_source: PM2 is not installed or not running on this server.'),
          ],
          response_type: 'ephemeral',
        });
        return;
      }

      const processes = await getPm2ProcessList();

      if (processes.length === 0) {
        await respond({
          blocks: [
            header('PM2 Status'),
            section(':information_source: No PM2 processes are running.'),
          ],
          response_type: 'ephemeral',
        });
        return;
      }

      // Group by status
      const online = processes.filter((p) => p.status === 'online');
      const stopped = processes.filter((p) => p.status === 'stopped');
      const errored = processes.filter((p) => p.status === 'errored');
      const other = processes.filter(
        (p) => !['online', 'stopped', 'errored'].includes(p.status)
      );

      const blocks: KnownBlock[] = [
        header('PM2 Status'),
        context(
          `${String(processes.length)} process(es) | ` +
          `${String(online.length)} online | ` +
          `${String(stopped.length)} stopped | ` +
          `${String(errored.length)} errored`
        ),
        divider(),
      ];

      // Show all processes
      for (const proc of [...online, ...errored, ...other, ...stopped]) {
        const emoji = getProcessStatusEmoji(proc.status);
        const uptimeStr = proc.status === 'online' ? formatProcessUptime(proc.uptime) : 'N/A';
        const memStr = proc.memory > 0 ? formatBytes(proc.memory) : 'N/A';
        const cpuStr = proc.cpu > 0 ? `${proc.cpu.toFixed(1)}%` : 'N/A';

        const modeInfo = proc.mode === 'cluster' && proc.instances > 1
          ? ` (${String(proc.instances)} instances)`
          : '';

        blocks.push(
          section(
            `${emoji} *${proc.name}*${modeInfo}\n` +
            `Status: ${proc.status} | ` +
            `Uptime: ${uptimeStr} | ` +
            `Memory: ${memStr} | ` +
            `CPU: ${cpuStr}` +
            (proc.restarts > 0 ? ` | Restarts: ${String(proc.restarts)}` : '')
          )
        );
      }

      // Warning for processes with high restart counts
      const highRestarts = processes.filter((p) => p.restarts >= 10);
      if (highRestarts.length > 0) {
        blocks.push(divider());
        blocks.push(
          context(
            `:warning: ${String(highRestarts.length)} process(es) have 10+ restarts: ` +
            highRestarts.map((p) => p.name).join(', ')
          )
        );
      }

      await respond({ blocks, response_type: 'ephemeral' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred';
      logger.error('PM2 command failed', { error: message });
      await respond({ blocks: [error(message)], response_type: 'ephemeral' });
    }
  });
}

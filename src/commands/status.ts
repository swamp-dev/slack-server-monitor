import type { App } from '@slack/bolt';
import type { KnownBlock } from '@slack/types';
import { getContainerStatus, getContainerDetails } from '../executors/docker.js';
import { sanitizeServiceName } from '../utils/sanitize.js';
import {
  header,
  section,
  sectionWithFields,
  divider,
  context,
  statusEmoji,
  error,
  statsBar,
  compactStatusRow,
  helpTip,
} from '../formatters/blocks.js';
import { logger } from '../utils/logger.js';

/**
 * Register the /services command
 *
 * Note: Originally /status, but that's a reserved Slack command
 *
 * Usage:
 *   /services           - List all containers
 *   /services <service> - Show details for a specific container
 */
export function registerServicesCommand(app: App): void {
  app.command('/services', async ({ command, ack, respond }) => {
    await ack();

    const serviceName = command.text.trim();

    try {
      if (serviceName) {
        // Show detailed status for specific service
        const sanitized = sanitizeServiceName(serviceName);
        const details = await getContainerDetails(sanitized);
        const status = details.state.running ? statusEmoji('ok') : statusEmoji('error');

        const blocks: KnownBlock[] = [
          header(`Container: ${details.name}`),
          sectionWithFields([
            `*Status:*\n${status} ${details.state.status}`,
            `*Image:*\n${details.image}`,
            `*Restarts:*\n${String(details.restartCount)}`,
            `*Platform:*\n${details.platform}`,
          ]),
        ];

        // Networks
        if (details.networks.length > 0) {
          blocks.push(divider());
          blocks.push(section(`*Networks:* ${details.networks.join(', ')}`));
        }

        // Ports
        if (Object.keys(details.ports).length > 0) {
          const portList = Object.entries(details.ports)
            .map(([containerPort, host]) => `${host} -> ${containerPort}`)
            .join(', ');
          blocks.push(section(`*Ports:* ${portList}`));
        }

        // Mounts
        if (details.mounts.length > 0) {
          blocks.push(divider());
          blocks.push(section('*Mounts:*'));
          for (const mount of details.mounts.slice(0, 5)) {
            blocks.push(context(`\`${mount.source}\` -> \`${mount.destination}\` (${mount.mode || 'rw'})`));
          }
          if (details.mounts.length > 5) {
            blocks.push(context(`_...and ${String(details.mounts.length - 5)} more_`));
          }
        }

        // Timing
        blocks.push(divider());
        blocks.push(
          context(
            details.state.running
              ? `Started: ${new Date(details.state.startedAt).toLocaleString()}`
              : `Stopped: ${new Date(details.state.finishedAt).toLocaleString()}`
          )
        );

        await respond({ blocks, response_type: 'ephemeral' });
      } else {
        // Show overview of all containers
        const containers = await getContainerStatus();

        if (containers.length === 0) {
          await respond({
            blocks: [
              header('Container Status'),
              section(':package: No containers found.'),
              helpTip(['Run `docker ps -a` to verify Docker is working']),
            ],
            response_type: 'ephemeral',
          });
          return;
        }

        // Group by status
        const running = containers.filter((c) => c.state === 'running');
        const stopped = containers.filter((c) => c.state !== 'running');
        const unhealthy = containers.filter(
          (c) => c.state === 'exited' || c.state === 'dead'
        );

        // Build summary stats
        const stats = statsBar([
          { count: running.length, label: 'running', status: 'ok' },
          { count: stopped.length - unhealthy.length, label: 'stopped', status: 'warn' },
          { count: unhealthy.length, label: 'unhealthy', status: 'error' },
        ]);

        const blocks: KnownBlock[] = [
          header('Container Status'),
          context(stats),
          divider(),
        ];

        // Compact view threshold - use compact mode for 8+ containers
        const useCompactView = containers.length >= 8;

        if (useCompactView) {
          // Compact view: show containers in rows with status indicators
          if (running.length > 0) {
            blocks.push(section('*Running*'));
            const runningItems = running.map((c) => ({
              name: c.name,
              status: 'ok' as const,
            }));
            for (const row of compactStatusRow(runningItems, 4)) {
              blocks.push(context(row));
            }
          }

          if (stopped.length > 0) {
            if (running.length > 0) blocks.push(divider());
            blocks.push(section('*Stopped/Other*'));
            const stoppedItems = stopped.map((c) => ({
              name: c.name,
              status: getStatusType(c.state),
            }));
            for (const row of compactStatusRow(stoppedItems, 4)) {
              blocks.push(context(row));
            }
          }

          blocks.push(divider());
          blocks.push(
            helpTip([`Use \`/services <name>\` for container details (ports, mounts, image)`])
          );
        } else {
          // Detailed view for fewer containers
          if (running.length > 0) {
            blocks.push(section('*Running*'));
            for (const container of running) {
              const emoji = getStatusEmoji(container.state);
              blocks.push(
                section(`${emoji} *${container.name}*\n\`${container.image}\`\n_${container.status}_`)
              );
            }
          }

          if (stopped.length > 0) {
            if (running.length > 0) blocks.push(divider());
            blocks.push(section('*Stopped/Other*'));
            for (const container of stopped) {
              const emoji = getStatusEmoji(container.state);
              blocks.push(
                section(`${emoji} *${container.name}*\n\`${container.image}\`\n_${container.status}_`)
              );
            }
          }

          blocks.push(divider());
          blocks.push(
            helpTip([`Use \`/services <name>\` for details`, `Use \`/logs <name>\` for logs`])
          );
        }

        await respond({ blocks, response_type: 'ephemeral' });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred';
      logger.error('Services command failed', { error: message, serviceName });
      await respond({ blocks: [error(message)], response_type: 'ephemeral' });
    }
  });
}

/**
 * Get status emoji for container state
 */
function getStatusEmoji(state: string): string {
  switch (state) {
    case 'running':
      return statusEmoji('ok');
    case 'exited':
    case 'dead':
      return statusEmoji('error');
    case 'paused':
    case 'restarting':
      return statusEmoji('warn');
    default:
      return statusEmoji('unknown');
  }
}

/**
 * Get status type for container state (for compact status row)
 */
function getStatusType(state: string): 'ok' | 'warn' | 'error' | 'unknown' {
  switch (state) {
    case 'running':
      return 'ok';
    case 'exited':
    case 'dead':
      return 'error';
    case 'paused':
    case 'restarting':
      return 'warn';
    default:
      return 'unknown';
  }
}

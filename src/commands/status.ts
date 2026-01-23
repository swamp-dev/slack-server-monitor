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
} from '../formatters/blocks.js';
import { logger } from '../utils/logger.js';

/**
 * Register the /status command
 *
 * Usage:
 *   /status           - List all containers
 *   /status <service> - Show details for a specific container
 */
export function registerStatusCommand(app: App): void {
  app.command('/status', async ({ command, ack, respond }) => {
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
            blocks: [header('Container Status'), section('No containers found.')],
            response_type: 'ephemeral',
          });
          return;
        }

        // Group by status
        const running = containers.filter((c) => c.state === 'running');
        const stopped = containers.filter((c) => c.state !== 'running');

        const blocks: KnownBlock[] = [
          header('Container Status'),
          context(`${String(containers.length)} containers total | ${String(running.length)} running | ${String(stopped.length)} stopped`),
          divider(),
        ];

        // Show running containers
        if (running.length > 0) {
          blocks.push(section('*Running*'));
          for (const container of running) {
            const emoji = getStatusEmoji(container.state);
            blocks.push(
              section(`${emoji} *${container.name}*\n\`${container.image}\`\n_${container.status}_`)
            );
          }
        }

        // Show stopped containers
        if (stopped.length > 0) {
          if (running.length > 0) {
            blocks.push(divider());
          }
          blocks.push(section('*Stopped/Other*'));
          for (const container of stopped) {
            const emoji = getStatusEmoji(container.state);
            blocks.push(
              section(`${emoji} *${container.name}*\n\`${container.image}\`\n_${container.status}_`)
            );
          }
        }

        await respond({ blocks, response_type: 'ephemeral' });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred';
      logger.error('Status command failed', { error: message, serviceName });
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

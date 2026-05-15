import type { App } from '@slack/bolt';
import type { KnownBlock } from '@slack/types';
import { getNetworkList, getContainerStatus } from '../executors/docker.js';
import { header, section, divider, context, error } from '../formatters/blocks.js';
import { logger } from '../utils/logger.js';

/**
 * Register the /network command
 *
 * Usage:
 *   /network - Show Docker networks and port mappings
 */
export function registerNetworkCommand(app: App): void {
  app.command('/network', async ({ ack, respond }) => {
    await ack();

    try {
      const [networks, containers] = await Promise.all([
        getNetworkList(),
        getContainerStatus(),
      ]);

      const blocks: KnownBlock[] = [
        header('Network Overview'),
        divider(),
        section('*Docker Networks*'),
      ];

      // Show networks
      for (const network of networks) {
        blocks.push(
          context(`\`${network.name}\` (${network.driver}) - ${network.scope}`)
        );
      }

      // Show port mappings for running containers
      const runningWithPorts = containers.filter(
        (c) => c.state === 'running' && c.ports
      );

      if (runningWithPorts.length > 0) {
        blocks.push(divider());
        blocks.push(section('*Port Mappings*'));

        for (const container of runningWithPorts) {
          if (container.ports) {
            blocks.push(context(`*${container.name}:* ${container.ports}`));
          }
        }
      }

      await respond({ blocks, response_type: 'ephemeral' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred';
      logger.error('Network command failed', { error: message });
      await respond({ blocks: [error(message)], response_type: 'ephemeral' });
    }
  });
}

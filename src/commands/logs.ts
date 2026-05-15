import type { App } from '@slack/bolt';
import type { KnownBlock } from '@slack/types';
import { getContainerLogs } from '../executors/docker.js';
import { parseLogsArgs } from '../utils/sanitize.js';
import { processLogsForSlack, countPotentialSecrets } from '../formatters/scrub.js';
import { header, codeBlock, warning, context, error } from '../formatters/blocks.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

/**
 * Register the /logs command
 *
 * Usage:
 *   /logs <service>        - Show last 50 lines of logs
 *   /logs <service> <n>    - Show last n lines (max 500)
 */
export function registerLogsCommand(app: App): void {
  app.command('/logs', async ({ command, ack, respond }) => {
    await ack();

    try {
      // Parse and validate arguments
      const { serviceName, lineCount } = parseLogsArgs(command.text, config.server.maxLogLines);

      // Enforce maximum line count
      const lines = Math.min(lineCount, config.server.maxLogLines);

      // Get logs
      const rawLogs = await getContainerLogs(serviceName, lines);

      // Process logs for safe display
      const processedLogs = processLogsForSlack(rawLogs);
      const secretCount = countPotentialSecrets(rawLogs);

      // Build response
      const blocks: KnownBlock[] = [
        header(`Logs: ${serviceName}`),
        warning(
          'Logs may contain sensitive information. Automatic scrubbing is applied but may not catch everything.'
        ),
      ];

      // Add additional warning if secrets were detected
      if (secretCount > 0) {
        blocks.push(
          context(
            `:rotating_light: ${String(secretCount)} potential secret(s) were detected and redacted.`
          )
        );
      }

      blocks.push(context(`Showing last ${String(lines)} lines`));
      blocks.push(codeBlock(processedLogs || '(no output)'));

      await respond({ blocks, response_type: 'ephemeral' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred';
      logger.error('Logs command failed', { error: message, text: command.text });
      await respond({ blocks: [error(message)], response_type: 'ephemeral' });
    }
  });
}

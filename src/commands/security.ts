import type { App } from '@slack/bolt';
import type { KnownBlock } from '@slack/types';
import { getFail2banStatus, getJailDetails, isFail2banAvailable } from '../executors/security.js';
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
 * Register the /security command
 *
 * Usage:
 *   /security         - List all jails with ban counts
 *   /security <jail>  - Show details for a specific jail
 */
export function registerSecurityCommand(app: App): void {
  app.command('/security', async ({ command, ack, respond }) => {
    await ack();

    const jailName = command.text.trim();

    try {
      // Check if fail2ban is available
      const available = await isFail2banAvailable();
      if (!available) {
        await respond({
          blocks: [
            header('Security Status'),
            section(':information_source: fail2ban is not installed or not running on this server.'),
          ],
          response_type: 'ephemeral',
        });
        return;
      }

      if (jailName) {
        // Show details for specific jail
        const sanitized = sanitizeServiceName(jailName);
        const details = await getJailDetails(sanitized);

        const bannedCount = details.currentlyBanned;
        const status = bannedCount > 0 ? statusEmoji('warn') : statusEmoji('ok');

        const blocks: KnownBlock[] = [
          header(`Jail: ${details.name}`),
          sectionWithFields([
            `*Currently Banned:*\n${status} ${String(bannedCount)}`,
            `*Total Banned:*\n${String(details.totalBanned)}`,
            `*Currently Failed:*\n${String(details.currentlyFailed)}`,
            `*Total Failed:*\n${String(details.totalFailed)}`,
          ]),
        ];

        // Show banned IPs
        if (details.bannedIps.length > 0) {
          blocks.push(divider());
          blocks.push(section('*Banned IPs:*'));
          const ipList = details.bannedIps.slice(0, 10).map((ip) => `\`${ip}\``).join(', ');
          blocks.push(context(ipList));
          if (details.bannedIps.length > 10) {
            blocks.push(context(`_...and ${String(details.bannedIps.length - 10)} more_`));
          }
        }

        // Show monitored files
        if (details.fileList.length > 0) {
          blocks.push(divider());
          blocks.push(context(`*Log files:* ${details.fileList.join(', ')}`));
        }

        await respond({ blocks, response_type: 'ephemeral' });
      } else {
        // Show overview of all jails
        const status = await getFail2banStatus();

        if (status.jailCount === 0) {
          await respond({
            blocks: [
              header('Security Status'),
              section(':information_source: No fail2ban jails configured.'),
            ],
            response_type: 'ephemeral',
          });
          return;
        }

        const blocks: KnownBlock[] = [
          header('Security Status'),
          context(`${String(status.jailCount)} jail(s) active`),
          divider(),
        ];

        // Get details for each jail
        for (const jail of status.jails) {
          try {
            const details = await getJailDetails(jail);
            const bannedCount = details.currentlyBanned;
            const emoji = bannedCount > 0 ? statusEmoji('warn') : statusEmoji('ok');

            blocks.push(
              section(
                `${emoji} *${details.name}*\n` +
                `Banned: ${String(bannedCount)} | Failed: ${String(details.currentlyFailed)} | Total banned: ${String(details.totalBanned)}`
              )
            );
          } catch (err) {
            logger.error('Failed to get jail details', { jail, error: err });
            blocks.push(section(`${statusEmoji('error')} *${jail}*\n_Failed to get details_`));
          }
        }

        blocks.push(divider());
        blocks.push(context('Use `/security <jail>` for detailed jail information'));

        await respond({ blocks, response_type: 'ephemeral' });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred';
      logger.error('Security command failed', { error: message, jailName });
      await respond({ blocks: [error(message)], response_type: 'ephemeral' });
    }
  });
}

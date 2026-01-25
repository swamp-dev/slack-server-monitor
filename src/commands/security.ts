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
  statsBar,
  compactList,
  helpTip,
  link,
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

        // Show banned IPs using compact list
        if (details.bannedIps.length > 0) {
          blocks.push(divider());
          blocks.push(section(`*Banned IPs (${String(details.bannedIps.length)}):*`));
          blocks.push(context(compactList(details.bannedIps, 15)));
        }

        // Show monitored files
        if (details.fileList.length > 0) {
          blocks.push(divider());
          blocks.push(context(`*Log files:* ${details.fileList.join(', ')}`));
        }

        // Add helpful tips
        blocks.push(divider());
        blocks.push(
          helpTip([
            `Use \`fail2ban-client set ${details.name} unbanip <IP>\` to unban`,
            link('https://www.fail2ban.org/wiki/index.php/Main_Page', 'Fail2ban Docs'),
          ])
        );

        await respond({ blocks, response_type: 'ephemeral' });
      } else {
        // Show overview of all jails
        const status = await getFail2banStatus();

        if (status.jailCount === 0) {
          await respond({
            blocks: [
              header('Security Status'),
              section(':information_source: No fail2ban jails configured.'),
              helpTip([`Configure jails in \`/etc/fail2ban/jail.local\``]),
            ],
            response_type: 'ephemeral',
          });
          return;
        }

        // Calculate totals for stats bar
        let totalBanned = 0;
        let totalFailed = 0;
        const jailDetails: {
          name: string;
          banned: number;
          failed: number;
          totalBanned: number;
        }[] = [];

        for (const jail of status.jails) {
          try {
            const details = await getJailDetails(jail);
            totalBanned += details.currentlyBanned;
            totalFailed += details.currentlyFailed;
            jailDetails.push({
              name: details.name,
              banned: details.currentlyBanned,
              failed: details.currentlyFailed,
              totalBanned: details.totalBanned,
            });
          } catch (err) {
            logger.error('Failed to get jail details', { jail, error: err });
            jailDetails.push({
              name: jail,
              banned: -1,
              failed: -1,
              totalBanned: 0,
            });
          }
        }

        // Build stats bar
        // Note: banned === -1 indicates an error getting jail details
        const healthyJails = jailDetails.filter((j) => j.banned === 0).length;
        const activeJails = jailDetails.filter((j) => j.banned > 0).length;
        const errorJails = jailDetails.filter((j) => j.banned < 0).length;

        const stats = statsBar([
          { count: healthyJails, label: 'quiet', status: 'ok' },
          { count: activeJails, label: 'active', status: 'warn' },
          { count: errorJails, label: 'error', status: 'error' },
        ]);

        const blocks: KnownBlock[] = [
          header('Security Status'),
          context(stats),
          context(`:shield: ${String(totalBanned)} IPs currently banned  ·  ${String(totalFailed)} recent failures`),
          divider(),
        ];

        // Show each jail
        for (const jail of jailDetails) {
          if (jail.banned < 0) {
            blocks.push(section(`${statusEmoji('error')} *${jail.name}*\n_Failed to get details_`));
            continue;
          }

          const emoji = jail.banned > 0 ? statusEmoji('warn') : statusEmoji('ok');
          blocks.push(
            section(
              `${emoji} *${jail.name}*\n` +
              `Banned: ${String(jail.banned)} | Failed: ${String(jail.failed)} | Total banned: ${String(jail.totalBanned)}`
            )
          );
        }

        blocks.push(divider());
        blocks.push(
          helpTip([
            'Use `/security <jail>` for details and banned IPs',
            link('https://www.fail2ban.org/wiki/index.php/Main_Page', 'Fail2ban Docs'),
          ])
        );

        await respond({ blocks, response_type: 'ephemeral' });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred';
      logger.error('Security command failed', { error: message, jailName });
      await respond({ blocks: [error(message)], response_type: 'ephemeral' });
    }
  });
}

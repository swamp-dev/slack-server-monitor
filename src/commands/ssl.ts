import type { App } from '@slack/bolt';
import type { KnownBlock } from '@slack/types';
import { checkCertificate, checkMultipleCertificates } from '../executors/ssl.js';
import { config } from '../config/index.js';
import {
  header,
  section,
  divider,
  context,
  statusEmoji,
  error,
  statsBar,
  helpTip,
  link,
} from '../formatters/blocks.js';
import { logger } from '../utils/logger.js';

/**
 * Format expiry date for display
 */
function formatExpiry(expiresAt: Date | undefined, daysRemaining: number | undefined): string {
  if (!expiresAt || daysRemaining === undefined) {
    return 'Unknown';
  }

  const dateStr = expiresAt.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  if (daysRemaining < 0) {
    return `${dateStr} (expired ${String(Math.abs(daysRemaining))} days ago)`;
  }

  return `${dateStr} (${String(daysRemaining)} days)`;
}

/**
 * SECURITY: Validate domain input using RFC 1035 compliant rules
 *
 * Rules:
 * - Total length <= 253 characters
 * - Labels separated by dots
 * - Each label 1-63 characters
 * - Labels start and end with alphanumeric
 * - Labels can contain hyphens (but not at start/end)
 * - No consecutive dots or leading/trailing dots
 */
function isValidDomain(domain: string): boolean {
  // Basic length checks
  if (!domain || domain.length > 253) return false;

  // No leading/trailing dots
  if (domain.startsWith('.') || domain.endsWith('.')) return false;

  // No consecutive dots
  if (domain.includes('..')) return false;

  // Split into labels and validate each
  const labels = domain.split('.');

  // Must have at least one label
  if (labels.length === 0) return false;

  for (const label of labels) {
    // Label length: 1-63 characters
    if (label.length < 1 || label.length > 63) return false;

    // Label must match: starts/ends with alphanumeric, can have hyphens in middle
    if (!/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(label)) {
      // Special case: single character label
      if (label.length === 1 && /^[a-zA-Z0-9]$/.test(label)) {
        continue;
      }
      return false;
    }
  }

  return true;
}

/**
 * Register the /ssl command
 *
 * Usage:
 *   /ssl           - Check all configured SSL_DOMAINS
 *   /ssl <domain>  - Check a specific domain
 */
export function registerSslCommand(app: App): void {
  app.command('/ssl', async ({ command, ack, respond }) => {
    await ack();

    const domainInput = command.text.trim();

    try {
      if (domainInput) {
        // Check specific domain
        if (!isValidDomain(domainInput)) {
          await respond({
            blocks: [error('Invalid domain format. Please provide a valid domain name.')],
            response_type: 'ephemeral',
          });
          return;
        }

        const result = await checkCertificate(domainInput);
        const emoji = statusEmoji(result.status);

        const blocks: KnownBlock[] = [
          header(`SSL: ${result.domain}`),
        ];

        if (result.valid) {
          blocks.push(
            section(
              `${emoji} *Status:* Valid\n` +
              `*Expires:* ${formatExpiry(result.expiresAt, result.daysRemaining)}`
            )
          );
        } else {
          blocks.push(
            section(
              `${emoji} *Status:* ${result.error ?? 'Invalid'}\n` +
              (result.expiresAt ? `*Expires:* ${formatExpiry(result.expiresAt, result.daysRemaining)}` : '')
            )
          );
        }

        await respond({ blocks, response_type: 'ephemeral' });
      } else {
        // Check all configured domains
        const domains = config.server.sslDomains;

        if (domains.length === 0) {
          await respond({
            blocks: [
              header('SSL Certificate Status'),
              section(':information_source: No domains configured. Set `SSL_DOMAINS` environment variable.'),
              context('Usage: `/ssl <domain>` to check a specific domain'),
            ],
            response_type: 'ephemeral',
          });
          return;
        }

        const results = await checkMultipleCertificates(domains);

        // Sort by status (errors first, then warnings, then ok)
        const statusOrder: Record<string, number> = { error: 0, warn: 1, ok: 2 };
        results.sort((a, b) => (statusOrder[a.status] ?? 2) - (statusOrder[b.status] ?? 2));

        const blocks: KnownBlock[] = [
          header('SSL Certificate Status'),
          context(`Checking ${String(domains.length)} domain(s)`),
          divider(),
        ];

        for (const result of results) {
          const emoji = statusEmoji(result.status);

          if (result.valid) {
            blocks.push(
              section(
                `${emoji} *${result.domain}*\n` +
                `Expires: ${formatExpiry(result.expiresAt, result.daysRemaining)}`
              )
            );
          } else {
            blocks.push(
              section(
                `${emoji} *${result.domain}*\n` +
                (result.error ?? 'Invalid certificate')
              )
            );
          }
        }

        // Summary using stats bar
        const errorCount = results.filter((r) => r.status === 'error').length;
        const warnCount = results.filter((r) => r.status === 'warn').length;
        const okCount = results.filter((r) => r.status === 'ok').length;

        blocks.push(divider());
        blocks.push(
          context(
            statsBar([
              { count: okCount, label: 'valid', status: 'ok' },
              { count: warnCount, label: 'expiring', status: 'warn' },
              { count: errorCount, label: 'issues', status: 'error' },
            ])
          )
        );

        // Add helpful tips
        blocks.push(
          helpTip([
            `Use \`/ssl <domain>\` to check a specific domain`,
            `${link('https://letsencrypt.org/docs/', "Let's Encrypt Docs")} for certificate renewal`,
          ])
        );

        await respond({ blocks, response_type: 'ephemeral' });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred';
      logger.error('SSL command failed', { error: message, domain: domainInput });
      await respond({ blocks: [error(message)], response_type: 'ephemeral' });
    }
  });
}

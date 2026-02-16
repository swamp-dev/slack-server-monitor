import type { App } from '@slack/bolt';
import type { KnownBlock } from '@slack/types';
import { config } from '../config/index.js';
import { getPluginHelpData } from '../plugins/loader.js';
import {
  header,
  section,
  divider,
  context,
  buildResponse,
} from '../formatters/blocks.js';

/**
 * Register the /help command
 *
 * Shows all available commands grouped by category.
 * Plugin commands are rendered from structured helpEntries when available,
 * with a generic fallback for plugins that don't declare them.
 * Response is ephemeral (only visible to the requesting user).
 */
export function registerHelpCommand(app: App): void {
  app.command('/help', async ({ ack, respond }) => {
    await ack();

    const blocks: KnownBlock[] = [
      header('Server Monitor Commands'),

      // --- Containers ---
      section(
        '*Containers*\n' +
        '`/services [name]` - Container status (all or specific)\n' +
        '`/logs <service> [lines]` - Container logs (default: 50, max: 500)\n' +
        '`/network` - Docker networks and port mappings'
      ),
      context('Example: `/logs nginx 100`'),
      divider(),

      // --- System ---
      section(
        '*System*\n' +
        '`/resources` - CPU, memory, swap overview\n' +
        '`/disk` - Disk usage per mount point'
      ),
      divider(),

      // --- Monitoring ---
      section(
        '*Monitoring*\n' +
        '`/security [jail]` - fail2ban jail status\n' +
        '`/ssl [domain]` - SSL certificate expiry\n' +
        '`/backups` - Local and S3 backup status\n' +
        '`/pm2` - PM2 process list'
      ),
      context('Example: `/security sshd` or `/ssl example.com`'),
    ];

    // Claude AI section (only if enabled)
    if (config.claude) {
      blocks.push(divider());

      let claudeText =
        '*Claude AI*\n' +
        '`/ask <question>` - AI-powered server diagnostics\n' +
        '`/sessions [mine|stats]` - Claude session history';

      if (config.claude.contextOptions.length > 0) {
        claudeText += '\n`/context [set <alias>|clear]` - Switch context directory';
      }

      blocks.push(section(claudeText));
      blocks.push(context('Thread replies continue the conversation with context.'));
    }

    // Plugin section (dynamic from loaded plugins)
    const plugins = getPluginHelpData();
    if (plugins.length > 0) {
      blocks.push(divider());
      blocks.push(section('*Plugins*'));

      for (const plugin of plugins) {
        if (plugin.helpEntries && plugin.helpEntries.length > 0) {
          // Group entries by their group field (default to plugin name)
          const groups = new Map<string, { command: string; description: string }[]>();
          for (const entry of plugin.helpEntries) {
            const groupName = entry.group ?? plugin.name;
            let group = groups.get(groupName);
            if (!group) {
              group = [];
              groups.set(groupName, group);
            }
            group.push({ command: entry.command, description: entry.description });
          }

          for (const [groupName, entries] of groups) {
            const lines = entries
              .map((e) => `\`${e.command}\` - ${e.description}`)
              .join('\n');
            blocks.push(section(`*${groupName}*\n${lines}`));
          }
        } else {
          // Fallback for plugins without helpEntries
          const desc = plugin.description ? ` - ${plugin.description}` : '';
          blocks.push(section(`*${plugin.name}*${desc}\n\`/${plugin.name} help\` - Show commands`));
        }
      }
    }

    blocks.push(context('All commands are read-only.'));

    await respond(buildResponse(blocks));
  });
}

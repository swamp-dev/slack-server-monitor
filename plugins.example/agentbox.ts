/**
 * AgentBox Plugin — Automated ticket-to-code pipeline
 *
 * Integrates AgentBox (Docker-sandboxed AI coding agent) with the Slack bot.
 * Part of epic #154: AgentBox integration.
 *
 * Phase A provides:
 * - Plugin skeleton with database tables
 * - /agentbox status command
 * - Config loading from env vars
 *
 * To use:
 *   cp plugins.example/agentbox.ts plugins.local/
 *   cp -r plugins.example/agentbox/ plugins.local/agentbox/
 */
import type { Plugin, PluginContext } from '../src/plugins/index.js';
import type { PluginDatabase } from '../src/services/plugin-database.js';
import { createSchema, getRecentRuns } from './agentbox/schema.js';
import { loadAgentboxConfig } from './agentbox/config.js';

// Module-level state
let pluginDb: PluginDatabase | null = null;

const STATUS_EMOJI: Record<string, string> = {
  pending: ':hourglass_flowing_sand:',
  running: ':gear:',
  success: ':white_check_mark:',
  failed: ':x:',
  cancelled: ':no_entry_sign:',
};

const agentboxPlugin: Plugin = {
  name: 'agentbox',
  version: '0.1.0',
  description: 'Automated ticket-to-code pipeline via AgentBox',

  helpEntries: [
    {
      command: '/agentbox status',
      description: 'Show recent AgentBox runs',
      group: 'AgentBox',
    },
  ],

  registerCommands: (app) => {
    app.command('/agentbox', async ({ command, ack, respond }) => {
      await ack();

      const subcommand = (command.text || '').trim().split(/\s+/)[0] || 'status';

      if (subcommand === 'status') {
        if (!pluginDb) {
          await respond('AgentBox plugin not initialized.');
          return;
        }

        const runs = getRecentRuns(pluginDb, 5);

        if (runs.length === 0) {
          await respond('No AgentBox runs yet.');
          return;
        }

        const lines = runs.map((r) => {
          const emoji = STATUS_EMOJI[r.status] || ':question:';
          const issue = r.issueNumber ? `#${r.issueNumber}` : 'manual';
          const pr = r.prUrl ? ` | <${r.prUrl}|PR>` : '';
          return `${emoji} ${issue} (${r.repo}) — *${r.status}*${pr}`;
        });

        await respond({
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*Recent AgentBox Runs*\n\n${lines.join('\n')}`,
              },
            },
          ],
        });
      } else if (subcommand === 'help') {
        await respond(
          '*AgentBox Commands*\n' +
            '`/agentbox status` — Show recent runs\n' +
            '`/agentbox help` — This message',
        );
      } else {
        await respond(`Unknown subcommand: \`${subcommand}\`. Try \`/agentbox help\`.`);
      }
    });
  },

  init: async (ctx: PluginContext) => {
    pluginDb = ctx.db;
    const config = loadAgentboxConfig();

    createSchema(ctx.db);

    if (config.enabled) {
      ctx.notify('AgentBox plugin loaded', { level: 'info' });
    }
  },

  destroy: async () => {
    pluginDb = null;
  },
};

export default agentboxPlugin;

/**
 * AgentBox Plugin — GitHub Issue Agent Runner
 */

import type { Plugin, PluginContext } from '../src/plugins/index.js';
import type { PluginDatabase } from '../src/services/plugin-database.js';
import type { ToolDefinition } from '../src/services/tools/types.js';
import type { AgentboxConfig } from './agentbox/types.js';
import { linkIssueToThread, getLinkForIssue } from './agentbox/linking.js';
import { logger } from '../src/utils/logger.js';
import { execFile } from 'node:child_process';

let pluginDb: PluginDatabase | null = null;

const config: AgentboxConfig = {
  enabled: process.env.AGENTBOX_ENABLED === 'true',
  binaryPath: process.env.AGENTBOX_BINARY_PATH ?? '/root/agentbox/agentbox',
  workDir: process.env.AGENTBOX_WORK_DIR ?? './data/agentbox-runs',
  defaultRepo: process.env.AGENTBOX_DEFAULT_REPO || undefined,
};

export function getPluginDb(): PluginDatabase | null {
  return pluginDb;
}

export function getConfig(): AgentboxConfig {
  return config;
}

export function handleStatus(db: PluginDatabase): string {
  const rows = db
    .prepare(
      `SELECT id, issue_number, repo, status, branch, pr_url, started_at, finished_at, error, created_at
       FROM ${db.prefix}runs ORDER BY created_at DESC LIMIT 5`,
    )
    .all() as Array<Record<string, unknown>>;

  if (rows.length === 0) {
    return 'No AgentBox runs yet.';
  }

  const lines = rows.map((r) => {
    const status = String(r.status).toUpperCase();
    const issue = `#${r.issue_number}`;
    const repo = String(r.repo);
    return `\u2022 ${repo}${issue} \u2014 ${status}`;
  });

  return `*Recent AgentBox Runs*\n${lines.join('\n')}`;
}

/**
 * Idempotent schema migration — adds columns introduced in T10 (ingestion layer).
 * Uses PRAGMA table_info to check existing columns before ALTER TABLE ADD COLUMN.
 */
export function migrateRunsTable(db: PluginDatabase): void {
  const columns = db
    .prepare(`PRAGMA table_info(${db.prefix}runs)`)
    .all() as Array<{ name: string }>;
  const existing = new Set(columns.map((c) => c.name));

  const newColumns: Array<{ name: string; definition: string }> = [
    { name: 'session_id', definition: 'TEXT' },
    { name: 'progress_pct', definition: 'INTEGER DEFAULT 0' },
    { name: 'tasks_total', definition: 'INTEGER' },
    { name: 'tasks_completed', definition: 'INTEGER' },
    { name: 'prd_path', definition: 'TEXT' },
    { name: 'cancelled_by', definition: 'TEXT' },
    { name: 'paused_at', definition: 'INTEGER' },
  ];

  const toAdd = newColumns.filter((col) => !existing.has(col.name));
  if (toAdd.length > 0) {
    db.transaction(() => {
      for (const col of toAdd) {
        db.exec(`ALTER TABLE ${db.prefix}runs ADD COLUMN ${col.name} ${col.definition}`);
      }
    });
  }
}

const REPO_FORMAT = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;

function resolveRepo(input: Record<string, unknown>): string {
  const repo = (input.repo as string | undefined) || config.defaultRepo;
  if (!repo) throw new Error('No repo specified and AGENTBOX_DEFAULT_REPO is not configured');
  if (!REPO_FORMAT.test(repo)) throw new Error(`Invalid repo format: ${repo}`);
  return repo;
}

function validateIssueNumber(input: Record<string, unknown>): number {
  const n = input.issue_number;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) {
    throw new Error(`Invalid issue number: ${String(n)}`);
  }
  return n;
}

function ghLabelAdd(issueNumber: number, repo: string, label: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      '/usr/bin/gh',
      ['issue', 'edit', String(issueNumber), '--repo', repo, '--add-label', label],
      { timeout: 30_000 },
      (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve(stdout.trim() || `Label "${label}" added to ${repo}#${issueNumber}`);
      },
    );
  });
}

function createTools(): ToolDefinition[] {
  return [
    {
      spec: {
        name: 'link_issue',
        description: 'Link a GitHub issue to a Slack thread so agentbox results can be posted back',
        input_schema: {
          type: 'object',
          properties: {
            issue_number: { type: 'number', description: 'GitHub issue number' },
            repo: { type: 'string', description: 'GitHub repo (owner/repo). Defaults to AGENTBOX_DEFAULT_REPO.' },
            thread_ts: { type: 'string', description: 'Slack thread timestamp' },
            channel_id: { type: 'string', description: 'Slack channel ID' },
          },
          required: ['issue_number', 'thread_ts', 'channel_id'],
        },
      },
      execute: async (input) => {
        if (!pluginDb) return 'AgentBox plugin is not initialized';
        try {
          const repo = resolveRepo(input);
          const issueNumber = validateIssueNumber(input);
          linkIssueToThread(pluginDb, {
            issueNumber,
            repo,
            threadTs: input.thread_ts as string,
            channelId: input.channel_id as string,
            createdBy: 'claude',
            createdAt: Date.now(),
          });
          return `Linked ${repo}#${issueNumber} to thread ${input.thread_ts}`;
        } catch (err) {
          return `Failed to link issue: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    {
      spec: {
        name: 'mark_for_automation',
        description: 'Add the "agentbox-ready" label to a GitHub issue for automated execution',
        input_schema: {
          type: 'object',
          properties: {
            issue_number: { type: 'number', description: 'GitHub issue number' },
            repo: { type: 'string', description: 'GitHub repo (owner/repo). Defaults to AGENTBOX_DEFAULT_REPO.' },
          },
          required: ['issue_number'],
        },
      },
      execute: async (input) => {
        try {
          const repo = resolveRepo(input);
          const issueNumber = validateIssueNumber(input);
          return await ghLabelAdd(issueNumber, repo, 'agentbox-ready');
        } catch (err) {
          return `Failed to mark for automation: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    {
      spec: {
        name: 'get_issue_link',
        description: 'Get the Slack thread linked to a GitHub issue',
        input_schema: {
          type: 'object',
          properties: {
            issue_number: { type: 'number', description: 'GitHub issue number' },
            repo: { type: 'string', description: 'GitHub repo (owner/repo). Defaults to AGENTBOX_DEFAULT_REPO.' },
          },
          required: ['issue_number'],
        },
      },
      execute: async (input) => {
        if (!pluginDb) return 'AgentBox plugin is not initialized';
        try {
          const repo = resolveRepo(input);
          const issueNumber = validateIssueNumber(input);
          const link = getLinkForIssue(pluginDb, issueNumber, repo);
          if (!link) return `No link found for ${repo}#${issueNumber}`;
          return JSON.stringify(link);
        } catch (err) {
          return `Failed to get issue link: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
  ];
}

const agentboxPlugin: Plugin = {
  name: 'agentbox',
  version: '1.0.0',
  description: 'GitHub issue agent runner \u2014 tracks AgentBox runs and links issues to Slack threads',

  helpEntries: [
    { command: '/agentbox status', description: 'Show recent AgentBox runs', group: 'AgentBox' },
  ],

  tools: createTools(),

  init: async (ctx: PluginContext) => {
    pluginDb = ctx.db;

    ctx.db.exec(`
      CREATE TABLE IF NOT EXISTS ${ctx.db.prefix}runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        issue_number INTEGER,
        repo TEXT,
        status TEXT CHECK(status IN ('pending','running','success','failed','cancelled')),
        branch TEXT,
        pr_url TEXT,
        started_at INTEGER,
        finished_at INTEGER,
        output_path TEXT,
        error TEXT,
        created_at INTEGER NOT NULL
      )
    `);

    ctx.db.exec(`
      CREATE TABLE IF NOT EXISTS ${ctx.db.prefix}issue_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        issue_number INTEGER NOT NULL,
        repo TEXT NOT NULL,
        thread_ts TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(issue_number, repo)
      )
    `);

    migrateRunsTable(ctx.db);

    logger.info('AgentBox plugin initialized', {
      version: ctx.version,
      tablePrefix: ctx.db.prefix,
      enabled: config.enabled,
    });
  },

  destroy: async () => {
    pluginDb = null;
    logger.info('AgentBox plugin destroyed');
  },

  registerCommands: (app) => {
    app.command('/agentbox', async ({ command, ack, respond }) => {
      await ack();

      if (!pluginDb) {
        await respond('AgentBox plugin is not initialized.');
        return;
      }

      const subcommand = (command.text ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? '';

      switch (subcommand) {
        case 'status':
        case '': {
          await respond(handleStatus(pluginDb));
          break;
        }
        default:
          await respond(`Unknown subcommand: \`${subcommand}\`. Try \`/agentbox status\`.`);
      }
    });
  },
};

export default agentboxPlugin;

/**
 * Container Logs Plugin
 *
 * Read-only web log viewer for any Docker container, with Slack command
 * shortcuts and Claude tool integration. Coexists with the built-in
 * /logs command; web dashboard and SSE live tail added in PR 2b.
 *
 * Commands: /container-logs <service> [n] | tail <service> | search <service> <term> | help
 * Web: /p/container-logs/ (PR 2b)
 * Tools: container_logs:get_logs | search_logs | list_containers
 */

import type { Plugin } from '../src/plugins/index.js';
import type { ToolDefinition, ToolConfig } from '../src/services/tools/types.js';
import { executeCommand } from '../src/utils/shell.js';
import { sanitizeServiceName } from '../src/utils/sanitize.js';
import { scrubSensitiveData, processLogsForSlack, countPotentialSecrets } from '../src/formatters/scrub.js';
import { logger } from '../src/utils/logger.js';

// =============================================================================
// Types
// =============================================================================

export interface LogLine {
  timestamp: Date;
  message: string;
}

// =============================================================================
// Pure functions (exported for tests)
// =============================================================================

/** Strip ANSI escape codes from a string */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[mGKHF]/g, '');
}

const DOCKER_TIMESTAMP_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)\s+(.*)/;

/**
 * Parse raw docker logs output into structured log lines.
 * Strips ANSI codes and handles optional docker --timestamps prefix.
 */
export function parseLogLines(raw: string): LogLine[] {
  if (!raw.trim()) return [];

  const lines: LogLine[] = [];

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const m = DOCKER_TIMESTAMP_RE.exec(trimmed);
    if (m) {
      lines.push({
        timestamp: new Date(m[1] ?? ''),
        message: stripAnsi((m[2] ?? '').trimStart()),
      });
    } else {
      lines.push({
        timestamp: new Date(0),
        message: stripAnsi(trimmed),
      });
    }
  }

  return lines;
}

/**
 * Filter log lines to those whose message contains the search term (case-insensitive).
 * Empty term returns all lines.
 */
export function filterLogLines(lines: LogLine[], term: string): LogLine[] {
  if (!term) return lines;
  const lower = term.toLowerCase();
  return lines.filter((l) => l.message.toLowerCase().includes(lower));
}

/**
 * Search log lines for a term and return matching lines plus N lines of context.
 * Overlapping context windows are deduplicated.
 */
export function searchLogLines(lines: LogLine[], term: string, context = 2): LogLine[] {
  if (!term || lines.length === 0) return [];

  const lower = term.toLowerCase();
  const included = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.message.toLowerCase().includes(lower)) {
      for (let j = Math.max(0, i - context); j <= Math.min(lines.length - 1, i + context); j++) {
        included.add(j);
      }
    }
  }

  return Array.from(included)
    .sort((a, b) => a - b)
    .map((i) => lines[i]!);
}

// =============================================================================
// Data fetchers
// =============================================================================

const DEFAULT_LINES = 50;
const MAX_LINES = 500;

async function fetchContainerLogs(containerName: string, lines: number): Promise<string> {
  const result = await executeCommand('docker', [
    'logs',
    '--tail',
    String(lines),
    '--timestamps',
    containerName,
  ]);

  if (result.exitCode !== 0 && !result.stdout && !result.stderr) {
    throw new Error(`Failed to get logs for ${containerName}`);
  }

  // docker writes container stderr to process stderr — combine both
  return result.stdout + result.stderr;
}

async function listRunningContainers(): Promise<string[]> {
  const result = await executeCommand('docker', [
    'ps',
    '--format',
    '{{.Names}}',
  ]);

  if (result.exitCode !== 0) return [];

  return result.stdout
    .trim()
    .split('\n')
    .map((n) => n.trim())
    .filter(Boolean);
}

// =============================================================================
// Claude AI tools
// =============================================================================

const tools: ToolDefinition[] = [
  {
    spec: {
      name: 'list_containers',
      description: 'List all currently running Docker containers by name.',
      input_schema: { type: 'object', properties: {} },
    },
    execute: async (_input: Record<string, unknown>, _config: ToolConfig) => {
      try {
        const names = await listRunningContainers();
        if (names.length === 0) return 'No running containers found.';
        return `Running containers (${String(names.length)}):\n${names.map((n) => `• ${n}`).join('\n')}`;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  },
  {
    spec: {
      name: 'get_logs',
      description: 'Fetch recent log lines for a named container. Output is scrubbed for secrets.',
      input_schema: {
        type: 'object',
        properties: {
          container: { type: 'string', description: 'Container name' },
          lines: { type: 'number', description: 'Number of lines to fetch (default 50, max 200)' },
        },
        required: ['container'],
      },
    },
    execute: async (input: Record<string, unknown>, _config: ToolConfig) => {
      try {
        const rawContainer = String(input.container ?? '').trim();
        if (!rawContainer) return 'Error: container name is required';
        if (rawContainer.startsWith('-') || rawContainer.length > 255) return 'Error: invalid container name';

        const n = Math.min(Number(input.lines ?? DEFAULT_LINES), 200);
        const raw = await fetchContainerLogs(rawContainer, n);
        const scrubbed = scrubSensitiveData(raw);
        const lines = parseLogLines(scrubbed);
        if (lines.length === 0) return `No log output from ${rawContainer}`;
        return `Logs: ${rawContainer} (last ${String(lines.length)} lines)\n${lines.map((l) => l.message).join('\n')}`;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  },
  {
    spec: {
      name: 'search_logs',
      description: 'Search recent logs of a container for a pattern. Returns matching lines with 2 lines of context. Output is scrubbed for secrets.',
      input_schema: {
        type: 'object',
        properties: {
          container: { type: 'string', description: 'Container name' },
          term: { type: 'string', description: 'Search term (case-insensitive)' },
          lines: { type: 'number', description: 'Lines to search (default 500, max 1000)' },
        },
        required: ['container', 'term'],
      },
    },
    execute: async (input: Record<string, unknown>, _config: ToolConfig) => {
      try {
        const rawContainer = String(input.container ?? '').trim();
        if (!rawContainer) return 'Error: container name is required';
        if (rawContainer.startsWith('-') || rawContainer.length > 255) return 'Error: invalid container name';

        const term = String(input.term ?? '').trim();
        if (!term) return 'Error: search term is required';

        const n = Math.min(Number(input.lines ?? 500), 1000);
        const raw = await fetchContainerLogs(rawContainer, n);
        const scrubbed = scrubSensitiveData(raw);
        const all = parseLogLines(scrubbed);
        const results = searchLogLines(all, term);

        if (results.length === 0) return `No matches for "${term}" in ${rawContainer} logs.`;
        return `Found ${String(results.length)} lines matching "${term}" in ${rawContainer}:\n${results.map((l) => l.message).join('\n')}`;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  },
];

// =============================================================================
// Plugin export
// =============================================================================

const containerLogsPlugin: Plugin = {
  name: 'container-logs',
  version: '1.0.0',
  description: 'Web log viewer for Docker containers with live tail and search',

  helpEntries: [
    { command: '/container-logs <service> [n]', description: 'Post last N lines (default 50)', group: 'Container Logs' },
    { command: '/container-logs tail <service>', description: 'Post link to live tail view', group: 'Container Logs' },
    { command: '/container-logs search <service> <term>', description: 'Search logs for term', group: 'Container Logs' },
    { command: '/container-logs help', description: 'Command reference', group: 'Container Logs' },
  ],

  registerCommands(app) {
    app.command('/container-logs', async ({ command, ack, respond }) => {
      await ack();

      const parts = (command.text ?? '').trim().split(/\s+/);
      const sub = parts[0]?.toLowerCase() ?? '';

      try {
        if (!sub || sub === 'help') {
          await respond({
            text: [
              '*Container Logs*',
              '`/container-logs <service> [n]` — last N lines (default 50, max 500)',
              '`/container-logs tail <service>` — link to live tail view',
              '`/container-logs search <service> <term>` — search recent logs',
              '`/container-logs help` — this message',
            ].join('\n'),
            response_type: 'ephemeral',
          });
          return;
        }

        if (sub === 'tail') {
          const serviceName = parts[1] ?? '';
          if (!serviceName) {
            await respond({ text: 'Usage: `/container-logs tail <service>`', response_type: 'ephemeral' });
            return;
          }
          const baseUrl = process.env['WEB_BASE_URL'] ?? '';
          const tailUrl = baseUrl
            ? `${baseUrl}/p/container-logs/tail?container=${encodeURIComponent(serviceName)}`
            : '(set WEB_BASE_URL in .env to enable direct links)';
          await respond({
            text: `Live tail for *${serviceName}*:\n${tailUrl}`,
            response_type: 'ephemeral',
          });
          return;
        }

        if (sub === 'search') {
          const serviceName = parts[1] ?? '';
          const term = parts.slice(2).join(' ');
          if (!serviceName || !term) {
            await respond({ text: 'Usage: `/container-logs search <service> <term>`', response_type: 'ephemeral' });
            return;
          }

          let sanitized: string;
          try { sanitized = sanitizeServiceName(serviceName); } catch {
            await respond({ text: 'Error: invalid container name', response_type: 'ephemeral' });
            return;
          }

          const raw = await fetchContainerLogs(sanitized, MAX_LINES);
          const scrubbed = scrubSensitiveData(raw);
          const all = parseLogLines(scrubbed);
          const results = searchLogLines(all, term);

          if (results.length === 0) {
            await respond({ text: `No matches for \`${term}\` in *${sanitized}* logs.`, response_type: 'ephemeral' });
            return;
          }

          const text = results.map((l) => l.message).join('\n');
          const truncated = text.length > 2800 ? text.slice(0, 2800) + '\n…(truncated)' : text;
          await respond({
            text: `*${sanitized}* — matches for \`${term}\`:\n\`\`\`${truncated}\`\`\``,
            response_type: 'ephemeral',
          });
          return;
        }

        // Default: fetch logs for the named container
        // sub is the container name; parts[1] is the optional line count
        const containerName = sub;
        const lineCount = Math.min(parseInt(parts[1] ?? String(DEFAULT_LINES), 10) || DEFAULT_LINES, MAX_LINES);

        let sanitized: string;
        try { sanitized = sanitizeServiceName(containerName); } catch {
          await respond({ text: 'Error: invalid container name', response_type: 'ephemeral' });
          return;
        }

        const raw = await fetchContainerLogs(sanitized, lineCount);
        const processed = processLogsForSlack(raw);
        const secretCount = countPotentialSecrets(raw);

        const warning = '⚠️ Logs may contain sensitive info. Scrubbing applied but not foolproof.';
        const secretNote = secretCount > 0 ? `\n🔒 ${String(secretCount)} potential secret(s) redacted.` : '';
        const header = `*Logs: ${sanitized}* (last ${String(lineCount)} lines)${secretNote}`;

        await respond({
          text: `${warning}\n${header}\n\`\`\`${processed || '(no output)'}\`\`\``,
          response_type: 'ephemeral',
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unexpected error';
        logger.error('container-logs command failed', { error: message, text: command.text });
        await respond({ text: `❌ Error: ${message}`, response_type: 'ephemeral' });
      }
    });
  },

  tools,
};

export default containerLogsPlugin;

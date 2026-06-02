/**
 * Docker Updates Plugin
 *
 * Read-only observability for container update status. Shows current image
 * versions, pending updates detected by Watchtower (monitor-only mode), and
 * update history from /var/log/docker-update/.
 *
 * NOTE: Manual update triggering is intentionally excluded — the bot is
 * read-only by design (see src/utils/shell.ts allowlist and CLAUDE.md).
 *
 * Commands: /docker-updates status | pending | history [n] | help
 * Web: /p/docker-updates/ (added in PR 1b)
 * Tools: docker_updates:list_pending | get_history | get_service_version
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Plugin } from '../src/plugins/index.js';
import type { ToolDefinition, ToolConfig } from '../src/services/tools/types.js';
import { executeCommand } from '../src/utils/shell.js';
import { logger } from '../src/utils/logger.js';

// =============================================================================
// Types
// =============================================================================

export interface ContainerVersion {
  name: string;
  image: string;
  tag: string;
  digest: string;
  state: string;
}

export interface UpdateRecord {
  timestamp: Date;
  service: string;
  fromImage: string;
  toImage: string;
  status: 'updated' | 'no-change' | 'skipped' | 'failed' | 'unknown';
}

export interface PendingUpdate {
  service: string;
  newDigest: string;
  detectedAt: Date;
}

// =============================================================================
// Pure parsing functions (exported for unit tests)
// =============================================================================

/**
 * Extract the image tag from an image reference string.
 * Handles: name:tag, registry/name:tag, name@sha256:digest, bare name
 */
export function parseImageTag(image: string): string {
  if (!image) return '';

  // SHA digest reference: name@sha256:abc...
  const digestIdx = image.indexOf('@');
  if (digestIdx !== -1) {
    return image.slice(digestIdx + 1);
  }

  // Get the last path segment (strip registry/org prefix)
  const lastSlash = image.lastIndexOf('/');
  const nameWithTag = lastSlash === -1 ? image : image.slice(lastSlash + 1);

  const colonIdx = nameWithTag.indexOf(':');
  if (colonIdx !== -1) {
    return nameWithTag.slice(colonIdx + 1);
  }

  return 'latest';
}

/**
 * Parse update history from JSON lines format.
 * Expects one JSON object per line with fields:
 *   ts/timestamp/date, service, status, from/fromImage, to/toImage
 */
export function parseUpdateHistoryJson(content: string): UpdateRecord[] {
  if (!content.trim()) return [];

  const results: UpdateRecord[] = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('{')) continue;

    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }

    const service = obj.service ?? obj.name ?? obj.container;
    if (typeof service !== 'string' || !service) continue;

    const rawTs = obj.ts ?? obj.timestamp ?? obj.date;
    const timestamp = typeof rawTs === 'string' ? new Date(rawTs) : new Date();

    const rawStatus = String(obj.status ?? 'unknown').toLowerCase();
    const status = normalizeStatus(rawStatus);

    const fromImage = String(obj.from ?? obj.fromImage ?? obj.from_image ?? '');
    const toImage = String(obj.to ?? obj.toImage ?? obj.to_image ?? '');

    results.push({ timestamp, service, fromImage, toImage, status });
  }

  return results;
}

function normalizeStatus(raw: string): UpdateRecord['status'] {
  if (raw.includes('no') && raw.includes('change')) return 'no-change';
  if (raw.includes('skip')) return 'skipped';
  if (raw.includes('fail') || raw.includes('error')) return 'failed';
  if (raw.includes('updat')) return 'updated';
  return 'unknown';
}

/**
 * Parse update history from plain-text log format.
 * Handles lines like:
 *   2024-01-15T10:30:00Z nginx: updated sha256:aaa -> sha256:bbb
 *   2024-01-15 portainer updated
 */
export function parseUpdateHistoryText(content: string): UpdateRecord[] {
  if (!content.trim()) return [];

  // Match: <date[Ttime][Z]> <service>[:]  <rest>
  const LINE_RE = /^(\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})?)?)\s+([\w][\w.-]*):?\s+(.*)/;
  const ARROW_RE = /(\S+)\s*->\s*(\S+)/;

  const results: UpdateRecord[] = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const m = LINE_RE.exec(trimmed);
    if (!m) continue;

    const [, rawDate, service, rest] = m;
    const timestamp = new Date(rawDate ?? '');
    const lowerRest = (rest ?? '').toLowerCase();
    const status = normalizeStatus(lowerRest);

    const arrowMatch = ARROW_RE.exec(rest ?? '');
    const fromImage = arrowMatch ? (arrowMatch[1] ?? '') : '';
    const toImage = arrowMatch ? (arrowMatch[2] ?? '') : '';

    results.push({ timestamp, service: service ?? '', fromImage, toImage, status });
  }

  return results;
}

/**
 * Parse update history with auto-detection of format (JSON lines vs text).
 */
export function parseUpdateHistory(content: string): UpdateRecord[] {
  if (!content.trim()) return [];

  // If first non-empty line looks like JSON, use JSON parser
  const firstLine = content.split('\n').find((l) => l.trim());
  if (firstLine?.trim().startsWith('{')) {
    const result = parseUpdateHistoryJson(content);
    if (result.length > 0) return result;
  }

  return parseUpdateHistoryText(content);
}

/** Pattern matching Watchtower "Found new image" entries (logrus key=value format) */
const WATCHTOWER_LOGRUS_RE = /msg="Found new [\w-]+ image \(([^)]+)\) for \/?([\w][\w.-]*)"/;
/** Pattern matching Watchtower JSON log entries */
const WATCHTOWER_MSG_RE = /Found new [\w-]+ image \(([^)]+)\) for \/?([\w][\w.-]*)/;
/** Extract timestamp from logrus format */
const WATCHTOWER_TIME_RE = /time="([^"]+)"/;

/**
 * Parse Watchtower log output to find pending updates.
 * Supports both logrus key=value and JSON log formats.
 * Deduplicates by container name — last detection wins.
 */
export function parsePendingUpdates(logs: string): PendingUpdate[] {
  if (!logs.trim()) return [];

  const byService = new Map<string, PendingUpdate>();

  for (const line of logs.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let digest = '';
    let service = '';
    let detectedAt = new Date();

    if (trimmed.startsWith('{')) {
      // JSON log format
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        continue;
      }
      const msg = typeof obj.msg === 'string' ? obj.msg : '';
      const m = WATCHTOWER_MSG_RE.exec(msg);
      if (!m) continue;
      digest = m[1] ?? '';
      service = (m[2] ?? '').replace(/^\//, '');
      const rawTime = obj.time ?? obj.timestamp;
      if (typeof rawTime === 'string') detectedAt = new Date(rawTime);
    } else {
      // Logrus key=value format
      const m = WATCHTOWER_LOGRUS_RE.exec(trimmed);
      if (!m) continue;
      digest = m[1] ?? '';
      service = (m[2] ?? '').replace(/^\//, '');
      const tm = WATCHTOWER_TIME_RE.exec(trimmed);
      if (tm) detectedAt = new Date(tm[1] ?? '');
    }

    if (service && digest) {
      byService.set(service, { service, newDigest: digest, detectedAt });
    }
  }

  return Array.from(byService.values());
}

// =============================================================================
// Data fetchers (shell out to docker)
// =============================================================================

const UPDATE_LOG_DIR = '/var/log/docker-update';
const WATCHTOWER_CONTAINER = 'watchtower';
const MAX_WATCHTOWER_TAIL = 1000;

async function getContainerVersions(): Promise<ContainerVersion[]> {
  const format = '{{.Names}}\t{{.Image}}\t{{.State}}';
  const result = await executeCommand('docker', ['ps', '-a', '--format', format]);

  if (result.exitCode !== 0) {
    logger.warn('docker-updates: failed to list containers', { stderr: result.stderr });
    return [];
  }

  const versions: ContainerVersion[] = [];

  for (const line of result.stdout.trim().split('\n')) {
    if (!line) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const [name, image, state] = parts;
    const inspectResult = await executeCommand('docker', ['inspect', '--format', '{{.Image}}', name ?? '']);
    const digest = inspectResult.exitCode === 0 ? inspectResult.stdout.trim() : '';
    versions.push({
      name: (name ?? '').replace(/^\//, ''),
      image: image ?? '',
      tag: parseImageTag(image ?? ''),
      digest,
      state: state ?? '',
    });
  }

  return versions;
}

async function getUpdateHistory(n: number): Promise<UpdateRecord[]> {
  let allRecords: UpdateRecord[] = [];

  try {
    const entries = await readdir(UPDATE_LOG_DIR);
    const logFiles = entries
      .filter((f) => !f.startsWith('.'))
      .sort()
      .reverse();

    for (const file of logFiles) {
      if (allRecords.length >= n * 3) break; // read enough to fill request
      try {
        const content = await readFile(join(UPDATE_LOG_DIR, file), 'utf-8');
        allRecords = allRecords.concat(parseUpdateHistory(content));
      } catch {
        // skip unreadable files
      }
    }
  } catch {
    logger.debug('docker-updates: update log dir not found or unreadable', { dir: UPDATE_LOG_DIR });
  }

  // Sort newest first, trim to requested count
  return allRecords
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    .slice(0, n);
}

async function getPendingUpdates(): Promise<PendingUpdate[]> {
  const result = await executeCommand('docker', [
    'logs',
    '--tail',
    String(MAX_WATCHTOWER_TAIL),
    WATCHTOWER_CONTAINER,
  ]);

  if (result.exitCode !== 0) {
    logger.debug('docker-updates: watchtower container not available', { stderr: result.stderr });
    return [];
  }

  // docker logs mixes stdout+stderr; combine both
  return parsePendingUpdates(result.stdout + result.stderr);
}

// =============================================================================
// Slack command formatting helpers
// =============================================================================

function fmtStatus(status: UpdateRecord['status']): string {
  switch (status) {
    case 'updated': return '✅';
    case 'no-change': return '–';
    case 'skipped': return '⏭️';
    case 'failed': return '❌';
    default: return '?';
  }
}

function fmtDate(d: Date): string {
  return isNaN(d.getTime()) ? 'unknown' : d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

// =============================================================================
// Claude AI tools
// =============================================================================

const tools: ToolDefinition[] = [
  {
    spec: {
      name: 'list_pending',
      description:
        'List containers with pending image updates detected by Watchtower. Returns service name, new image digest, and when the update was detected.',
      input_schema: { type: 'object', properties: {} },
    },
    execute: async (_input: Record<string, unknown>, _config: ToolConfig) => {
      try {
        const pending = await getPendingUpdates();
        if (pending.length === 0) return 'No pending updates detected.';
        const lines = pending.map((p) => `• ${p.service}: ${p.newDigest} (detected ${fmtDate(p.detectedAt)})`);
        return `Pending updates (${String(pending.length)}):\n${lines.join('\n')}`;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  },
  {
    spec: {
      name: 'get_history',
      description: 'Return recent container update history from /var/log/docker-update/ logs.',
      input_schema: {
        type: 'object',
        properties: {
          count: {
            type: 'number',
            description: 'Number of records to return (default 10, max 50)',
          },
        },
      },
    },
    execute: async (input: Record<string, unknown>, _config: ToolConfig) => {
      try {
        const n = Math.min(Number(input.count ?? 10), 50);
        const history = await getUpdateHistory(n);
        if (history.length === 0) return 'No update history found.';
        const lines = history.map(
          (r) => `${fmtStatus(r.status)} ${r.service} [${r.status}] ${fmtDate(r.timestamp)}`
        );
        return `Update history (last ${String(history.length)}):\n${lines.join('\n')}`;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  },
  {
    spec: {
      name: 'get_service_version',
      description: 'Get the current image tag and digest for a named container.',
      input_schema: {
        type: 'object',
        properties: {
          service: { type: 'string', description: 'Container name (e.g. nginx, portainer)' },
        },
        required: ['service'],
      },
    },
    execute: async (input: Record<string, unknown>, _config: ToolConfig) => {
      try {
        const service = String(input.service ?? '').trim();
        if (!service) return 'Error: service name is required';

        const result = await executeCommand('docker', [
          'inspect',
          '--format',
          '{{.Config.Image}}\t{{.Image}}\t{{.State.Status}}',
          service,
        ]);

        if (result.exitCode !== 0) {
          return result.stderr.includes('No such object')
            ? `Container not found: ${service}`
            : `Error: ${result.stderr}`;
        }

        const parts = result.stdout.trim().split('\t');
        const [image, digest, state] = parts;
        return `${service}: image=${image ?? 'unknown'} tag=${parseImageTag(image ?? '')} digest=${(digest ?? '').slice(0, 19)}... state=${state ?? 'unknown'}`;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  },
];

// =============================================================================
// Plugin export
// =============================================================================

const dockerUpdatesPlugin: Plugin = {
  name: 'docker-updates',
  version: '1.0.0',
  description: 'Container update status — versions, pending updates, history',

  helpEntries: [
    { command: '/docker-updates', description: 'Show update summary', group: 'Docker Updates' },
    { command: '/docker-updates status', description: 'N up-to-date, M pending', group: 'Docker Updates' },
    { command: '/docker-updates pending', description: 'List available updates', group: 'Docker Updates' },
    { command: '/docker-updates history [n]', description: 'Last N updates (default 10)', group: 'Docker Updates' },
    { command: '/docker-updates help', description: 'Command reference', group: 'Docker Updates' },
  ],

  registerCommands(app) {
    app.command('/docker-updates', async ({ command, ack, respond }) => {
      await ack();

      const args = (command.text ?? '').trim().split(/\s+/);
      const sub = args[0]?.toLowerCase() ?? 'status';

      try {
        if (sub === 'help') {
          await respond({
            text: [
              '*Docker Updates*',
              '`/docker-updates status` — summary of up-to-date vs pending',
              '`/docker-updates pending` — list services with available updates',
              '`/docker-updates history [n]` — last N updates from log (default 10)',
              '`/docker-updates help` — this message',
            ].join('\n'),
            response_type: 'ephemeral',
          });
          return;
        }

        if (sub === 'pending') {
          const pending = await getPendingUpdates();
          if (pending.length === 0) {
            await respond({ text: '✅ No pending updates detected.', response_type: 'ephemeral' });
            return;
          }
          const lines = ['*Pending updates:*', ...pending.map((p) => `• *${p.service}* — ${p.newDigest.slice(0, 19)}... (detected ${fmtDate(p.detectedAt)})`)];
          await respond({ text: lines.join('\n'), response_type: 'ephemeral' });
          return;
        }

        if (sub === 'history') {
          const n = Math.min(parseInt(args[1] ?? '10', 10) || 10, 50);
          const history = await getUpdateHistory(n);
          if (history.length === 0) {
            await respond({ text: 'No update history found in `/var/log/docker-update/`.', response_type: 'ephemeral' });
            return;
          }
          const lines = [
            `*Last ${String(history.length)} updates:*`,
            ...history.map((r) => `${fmtStatus(r.status)} *${r.service}* [${r.status}] — ${fmtDate(r.timestamp)}`),
          ];
          await respond({ text: lines.join('\n'), response_type: 'ephemeral' });
          return;
        }

        // Default: status
        const [versions, pending] = await Promise.all([
          getContainerVersions(),
          getPendingUpdates(),
        ]);

        const running = versions.filter((v) => v.state === 'running');
        const lines = [
          `*Docker Update Status*`,
          `• Running containers: ${String(running.length)}`,
          `• Pending updates: ${pending.length > 0 ? `⚠️ ${String(pending.length)}` : '✅ none'}`,
        ];

        if (pending.length > 0) {
          lines.push('', '*Services with available updates:*');
          lines.push(...pending.map((p) => `  • ${p.service}`));
        }

        await respond({ text: lines.join('\n'), response_type: 'ephemeral' });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unexpected error';
        logger.error('docker-updates command failed', { error: message, sub });
        await respond({ text: `❌ Error: ${message}`, response_type: 'ephemeral' });
      }
    });
  },

  tools,
};

export default dockerUpdatesPlugin;

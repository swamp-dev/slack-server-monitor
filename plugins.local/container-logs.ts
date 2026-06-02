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

import type { Plugin, DashboardWidget } from '../src/plugins/index.js';
import type { PluginRouter } from '../src/plugins/index.js';
import type { PluginContext } from '../src/plugins/types.js';
import { renderPluginPage, pluginTable, escapeHtml } from '../src/plugins/index.js';
import type { ToolDefinition, ToolConfig } from '../src/services/tools/types.js';
import { executeCommand } from '../src/utils/shell.js';
import { getContainerStatus } from '../src/executors/docker.js';
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
// Web dashboard
// =============================================================================

const WEB_CSS = `
  .cl-toolbar { display:flex; gap:.6rem; align-items:center; flex-wrap:wrap; margin-bottom:1rem; }
  .cl-select, .cl-input, .cl-btn { padding:.35rem .7rem; border-radius:6px; font-size:.875rem; border:1px solid var(--border); background:var(--card-bg); color:var(--text); }
  .cl-select { cursor:pointer; }
  .cl-btn { cursor:pointer; font-weight:600; background:var(--accent,#2f81f7); color:#fff; border-color:transparent; }
  .cl-btn:hover { opacity:.9; }
  .cl-btn.secondary { background:var(--card-bg); color:var(--text); border-color:var(--border); }
  .cl-log-area { background:var(--code-bg,#0d1117); border:1px solid var(--border); border-radius:6px; padding:.75rem 1rem; font-family:var(--font-mono,monospace); font-size:.78rem; line-height:1.55; overflow-x:auto; max-height:70vh; overflow-y:auto; white-space:pre-wrap; word-break:break-all; }
  .cl-log-line { display:block; }
  .cl-log-line.hidden { display:none; }
  .cl-log-line .ts { color:var(--text-muted); margin-right:.4rem; }
  .cl-empty { color:var(--text-muted); font-style:italic; padding:.5rem 0; }
  .cl-warn { color:var(--warning,#e6a817); font-size:.8rem; margin-bottom:.75rem; }
  .cl-status { font-size:.78rem; color:var(--text-muted); margin-top:.5rem; text-align:right; }
  .cl-tail-header { display:flex; align-items:center; gap:.75rem; margin-bottom:1rem; flex-wrap:wrap; }
  .cl-tail-header h2 { margin:0; font-size:1.05rem; }
  .cl-dot { width:8px; height:8px; border-radius:50%; background:#3fb950; display:inline-block; animation:cl-blink 1.2s ease-in-out infinite; }
  @keyframes cl-blink { 0%,100%{opacity:1} 50%{opacity:.25} }
`;

const CLIENT_FILTER_JS = `
  function applyFilter() {
    const term = document.getElementById('cl-filter')?.value?.toLowerCase() ?? '';
    document.querySelectorAll('.cl-log-line').forEach(el => {
      el.classList.toggle('hidden', term !== '' && !el.textContent?.toLowerCase().includes(term));
    });
    const vis = document.querySelectorAll('.cl-log-line:not(.hidden)').length;
    const status = document.getElementById('cl-status');
    if (status) status.textContent = term ? vis + ' matching lines' : '';
  }
  document.getElementById('cl-filter')?.addEventListener('input', applyFilter);
  document.getElementById('cl-ts-toggle')?.addEventListener('change', e => {
    document.querySelectorAll('.ts').forEach(el => el.style.display = e.target.checked ? '' : 'none');
  });
`;

async function buildDashboardHtml(req: { query: Record<string, string> }): Promise<string> {
  const containers = await listRunningContainers();
  const selectedContainer = req.query['container'] ?? '';
  const lineCount = Math.min(Math.max(1, parseInt(req.query['lines'] ?? '100', 10) || 100), 500);

  const containerOptions = containers
    .map((c) => `<option value="${escapeHtml(c)}"${c === selectedContainer ? ' selected' : ''}>${escapeHtml(c)}</option>`)
    .join('');
  const noneOption = containers.length === 0 ? '<option value="">No running containers</option>' : '<option value="">— pick a container —</option>';

  const toolbar = `<form method="get" action="/p/container-logs/" class="cl-toolbar">
    <select name="container" class="cl-select">${noneOption}${containerOptions}</select>
    <select name="lines" class="cl-select">
      ${[50, 100, 500].map((n) => `<option value="${String(n)}"${n === lineCount ? ' selected' : ''}>${String(n)} lines</option>`).join('')}
    </select>
    <button type="submit" class="cl-btn">Load logs</button>
    ${selectedContainer ? `<a href="/p/container-logs/tail?container=${encodeURIComponent(selectedContainer)}" class="cl-btn secondary">Live tail ›</a>` : ''}
    <input id="cl-filter" placeholder="Filter lines…" class="cl-input" style="flex:1;min-width:140px">
    <label style="display:flex;gap:.3rem;align-items:center;font-size:.85rem"><input type="checkbox" id="cl-ts-toggle" checked> timestamps</label>
  </form>`;

  let logHtml = '';
  let warnHtml = '';
  if (selectedContainer) {
    try {
      const raw = await fetchContainerLogs(selectedContainer, lineCount);
      const secretCount = countPotentialSecrets(raw);
      if (secretCount > 0) {
        warnHtml = `<p class="cl-warn">🔒 ${String(secretCount)} potential secret(s) redacted. Review carefully.</p>`;
      }
      const scrubbed = scrubSensitiveData(raw);
      const lines = parseLogLines(scrubbed);
      if (lines.length === 0) {
        logHtml = '<div class="cl-log-area"><span class="cl-empty">(no output)</span></div>';
      } else {
        const lineHtml = lines.map((l) => {
          const ts = l.timestamp.getTime() > 0 ? `<span class="ts">${escapeHtml(l.timestamp.toISOString().replace('T', ' ').slice(0, 23))}</span>` : '';
          return `<span class="cl-log-line">${ts}${escapeHtml(l.message)}</span>`;
        }).join('\n');
        logHtml = `<div class="cl-log-area" id="cl-log">${lineHtml}</div><div class="cl-status" id="cl-status"></div>`;
      }
    } catch (err) {
      logHtml = `<p class="cl-empty">Error: ${escapeHtml(err instanceof Error ? err.message : String(err))}</p>`;
    }
  } else {
    logHtml = '<p class="cl-empty">Select a container above to view its logs.</p>';
  }

  return `${toolbar}${warnHtml}${logHtml}`;
}

function buildTailHtml(container: string): string {
  const safeContainer = escapeHtml(container);
  return `<div class="cl-tail-header">
    <span class="cl-dot" id="cl-dot"></span>
    <h2>Live tail: <code>${safeContainer}</code></h2>
    <button class="cl-btn secondary" id="cl-stop" onclick="toggleTail()">Pause</button>
    <a href="/p/container-logs/?container=${encodeURIComponent(container)}" class="cl-btn secondary">← Logs</a>
    <input id="cl-filter" placeholder="Filter lines…" class="cl-input" style="flex:1;min-width:140px">
    <label style="display:flex;gap:.3rem;align-items:center;font-size:.85rem"><input type="checkbox" id="cl-ts-toggle" checked> timestamps</label>
  </div>
  <div class="cl-log-area" id="cl-log" style="max-height:80vh"></div>
  <div class="cl-status" id="cl-status">Connecting…</div>`;
}

// SSE tail state — single shared stream (home server single-user model)
let tailPollTimer: ReturnType<typeof setInterval> | null = null;
let tailContainer = '';
let tailLastTs = '';

function startTailPolling(container: string, ctx: PluginContext): void {
  tailContainer = container;
  tailLastTs = '';

  if (tailPollTimer) return;

  tailPollTimer = setInterval(async () => {
    if (ctx.sse.clientCount() === 0) {
      stopTailPolling();
      return;
    }

    try {
      const args = ['logs', '--timestamps', tailContainer];
      if (tailLastTs) {
        args.push('--since', tailLastTs);
      } else {
        args.push('--tail', '50');
      }

      const result = await executeCommand('docker', args, { timeout: 5000 });
      if (result.exitCode !== 0) return;

      const raw = result.stdout + result.stderr;
      const lines = parseLogLines(scrubSensitiveData(raw));

      if (lines.length > 0) {
        const last = lines[lines.length - 1]!;
        if (last.timestamp.getTime() > 0) {
          tailLastTs = last.timestamp.toISOString();
        }
        ctx.sse.broadcast('log-lines', lines.map((l) => ({ ts: l.timestamp.toISOString(), msg: l.message })));
      }
    } catch {
      // poll errors are transient; keep trying
    }
  }, 2000);
}

function stopTailPolling(): void {
  if (tailPollTimer) {
    clearInterval(tailPollTimer);
    tailPollTimer = null;
  }
  tailContainer = '';
  tailLastTs = '';
}

function registerContainerLogsWebRoutes(router: PluginRouter): void {
  router.get('/', async (req, res) => {
    try {
      const query = req.query as Record<string, string>;
      const body = await buildDashboardHtml({ query });
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(renderPluginPage({ title: 'Container Logs', pluginName: 'container-logs', body, styles: WEB_CSS, scripts: `<script>${CLIENT_FILTER_JS}</script>`, unreadCount: 0 }));
    } catch (err) {
      logger.error('container-logs dashboard error', { error: err instanceof Error ? err.message : String(err) });
      res.status(500).send('Error loading dashboard');
    }
  });

  router.get('/tail', (req, res, ctx) => {
    const container = (req.query as Record<string, string>)['container'] ?? '';
    if (!container) { res.redirect('/p/container-logs/'); return; }

    startTailPolling(container, ctx);

    const tailJs = `<script>
      const es = new EventSource('/p/container-logs/stream');
      const log = document.getElementById('cl-log');
      const status = document.getElementById('cl-status');
      const dot = document.getElementById('cl-dot');
      let running = true;
      es.addEventListener('log-lines', e => {
        const lines = JSON.parse(e.data);
        lines.forEach(l => {
          const span = document.createElement('span');
          span.className = 'cl-log-line';
          const tsEl = document.createElement('span');
          tsEl.className = 'ts';
          tsEl.textContent = l.ts.replace('T',' ').slice(0,23) + ' ';
          if (!document.getElementById('cl-ts-toggle').checked) tsEl.style.display = 'none';
          span.appendChild(tsEl);
          span.appendChild(document.createTextNode(l.msg));
          log.appendChild(span);
          applyFilter();
        });
        log.scrollTop = log.scrollHeight;
        if (status) status.textContent = log.querySelectorAll('.cl-log-line').length + ' lines';
      });
      es.addEventListener('error', () => { if (status) status.textContent = 'Connection lost — reconnecting…'; });
      function toggleTail() {
        running = !running;
        document.getElementById('cl-stop').textContent = running ? 'Pause' : 'Resume';
        dot.style.animationPlayState = running ? 'running' : 'paused';
      }
      ${CLIENT_FILTER_JS}
    </script>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderPluginPage({ title: `Tail: ${container}`, pluginName: 'container-logs', body: buildTailHtml(container), styles: WEB_CSS, scripts: tailJs, unreadCount: 0 }));
  });
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

  if (result.exitCode !== 0) {
    const msg = (result.stderr || result.stdout).trim();
    throw new Error(
      msg.toLowerCase().includes('no such') ? `Container not found: ${containerName}` : `docker logs failed: ${msg}`
    );
  }

  // docker writes container stderr to process stderr — combine both
  return result.stdout + result.stderr;
}

async function listRunningContainers(): Promise<string[]> {
  const containers = await getContainerStatus();
  return containers.filter((c) => c.state === 'running').map((c) => c.name);
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
          const safeDisplay = serviceName.replace(/[*_`~]/g, '\\$&');
          await respond({
            text: `Live tail for *${safeDisplay}*:\n${tailUrl}`,
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
        const rawN = parseInt(parts[1] ?? String(DEFAULT_LINES), 10);
        const lineCount = Math.min(Math.max(1, isNaN(rawN) ? DEFAULT_LINES : rawN), MAX_LINES);

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

  webNavEntry: { label: 'Container Logs', icon: 'file-text' },

  webPages: [
    { name: 'Dashboard', path: '/' },
    { name: 'Live Tail', path: '/tail' },
  ],

  registerWebRoutes: registerContainerLogsWebRoutes,

  getWidgets(): DashboardWidget[] {
    return [{
      title: 'Container Logs',
      icon: 'file-text',
      html: '<span style="color:var(--text-muted);font-size:.85rem">View and search container logs</span>',
      link: '/p/container-logs/',
      priority: 80,
      size: 'small',
    }];
  },

  destroy(): Promise<void> {
    stopTailPolling();
    return Promise.resolve();
  },
};

export default containerLogsPlugin;

/**
 * container-logs plugin
 *
 * General-purpose container log viewer:
 *   - Web dashboard at /p/container_logs/ — container selector, log view, search, live tail
 *   - Slack: /container-logs <service> [n] | tail <service> | search <service> <term>
 *   - Claude tools: container_logs:get_logs, container_logs:search_logs, container_logs:list_containers
 */

import { spawn } from 'child_process';
import type { Plugin } from '../src/plugins/index.js';
import type { ToolDefinition } from '../src/services/tools/types.js';
import { getContainerLogs, getContainerStatus } from '../src/executors/docker.js';
import { scrubSensitiveData, processLogsForSlack, countPotentialSecrets } from '../src/formatters/scrub.js';
import { sanitizeServiceName, sanitizeLineCount } from '../src/utils/sanitize.js';
import { renderPluginPage, escapeHtml } from '../src/plugins/index.js';
import { header, codeBlock, warning, context, error as errorBlock } from '../src/formatters/blocks.js';
import { logger } from '../src/utils/logger.js';

// =============================================================================
// Types
// =============================================================================

export interface ParsedLogLine {
  timestamp: string;
  content: string;
}

export type ContainerLogsCommand =
  | { subcommand: 'logs'; service: string; lines: number }
  | { subcommand: 'tail'; service: string }
  | { subcommand: 'search'; service: string; term: string };

// =============================================================================
// Pure / testable functions (exported)
// =============================================================================

const DOCKER_TS_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)\s(.*)/;

export function parseLogLine(line: string): ParsedLogLine {
  if (!line) return { timestamp: '', content: '' };
  const m = DOCKER_TS_RE.exec(line);
  if (!m) return { timestamp: '', content: line };
  return { timestamp: m[1] ?? '', content: (m[2] ?? '').trimEnd() };
}

const MAX_LINES = 500;

export function parseContainerLogsCommand(text: string): ContainerLogsCommand {
  const parts = text.trim().split(/\s+/);
  const first = parts[0];

  if (!first) {
    throw new Error('Service name is required. Usage: /container-logs <service> [lines]');
  }

  if (first === 'tail') {
    const service = parts[1];
    if (!service) throw new Error('Service name is required. Usage: /container-logs tail <service>');
    return { subcommand: 'tail', service: sanitizeServiceName(service) };
  }

  if (first === 'search') {
    const service = parts[1];
    if (!service) throw new Error('Service name is required. Usage: /container-logs search <service> <term>');
    sanitizeServiceName(service);
    const term = parts.slice(2).join(' ').trim();
    if (!term) throw new Error('Search term is required. Usage: /container-logs search <service> <term>');
    return { subcommand: 'search', service: sanitizeServiceName(service), term };
  }

  // Default: logs subcommand
  const service = sanitizeServiceName(first);
  const parsed = parts[1] ? parseInt(parts[1], 10) : NaN;
  const rawLines = isNaN(parsed) || parsed < 1 ? 50 : parsed;
  const lines = Math.min(rawLines, MAX_LINES);
  return { subcommand: 'logs', service, lines };
}

export function filterLogLines(lines: ParsedLogLine[], term: string): ParsedLogLine[] {
  if (!term) return lines;
  const lower = term.toLowerCase();
  return lines.filter((l) => l.content.toLowerCase().includes(lower));
}

// =============================================================================
// Web UI helpers
// =============================================================================

const DOCKER_BIN = '/usr/bin/docker';

const PAGE_STYLES = `
.controls { display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap; margin-bottom:0.75rem; }
.controls select, .controls button { padding:0.35rem 0.6rem; border-radius:4px; border:1px solid var(--border); background:var(--bg-secondary); color:var(--text); cursor:pointer; font-size:0.875rem; }
.controls button { background:var(--accent); color:#fff; border-color:var(--accent); }
.controls button:hover { opacity:0.85; }
.controls label { display:flex; align-items:center; gap:0.3rem; font-size:0.875rem; cursor:pointer; }
.search-row { display:flex; align-items:center; gap:0.5rem; margin-bottom:0.5rem; }
.search-row input { flex:1; padding:0.35rem 0.6rem; border-radius:4px; border:1px solid var(--border); background:var(--bg-secondary); color:var(--text); font-size:0.875rem; }
.match-count { font-size:0.8rem; color:var(--text-muted); white-space:nowrap; }
.log-area { background:var(--bg-secondary); border:1px solid var(--border); border-radius:4px; padding:0.75rem; overflow:auto; max-height:70vh; font-size:0.8125rem; line-height:1.5; white-space:pre-wrap; word-break:break-all; margin:0; }
.log-area .ts { color:var(--text-muted); margin-right:0.5rem; }
.log-empty { color:var(--text-muted); font-style:italic; }
.tail-active { color:var(--success,#22c55e); }
`;

function buildDashboardHtml(containerNames: string[], webBase: string): string {
  const opts = containerNames.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');

  return `
<div class="container-logs-ui">
  <div class="controls">
    <select id="cl-container" aria-label="Container">
      <option value="">— select container —</option>
      ${opts}
    </select>
    <select id="cl-lines" aria-label="Line count">
      <option value="100">Last 100</option>
      <option value="500" selected>Last 500</option>
      <option value="1000">Last 1000</option>
    </select>
    <button id="cl-load">Load</button>
    <label><input type="checkbox" id="cl-tail"> Live tail</label>
    <label><input type="checkbox" id="cl-ts" checked> Timestamps</label>
  </div>
  <div class="search-row">
    <input type="text" id="cl-search" placeholder="Filter lines…" autocomplete="off"/>
    <span class="match-count" id="cl-count"></span>
  </div>
  <pre class="log-area" id="cl-output"><span class="log-empty">(no logs loaded)</span></pre>
</div>
<script>
(function() {
  var allLines = [];
  var tailEs = null;
  var searchTimer = null;
  var base = ${JSON.stringify(webBase)};

  function qs(id) { return document.getElementById(id); }

  function escHtml(s) {
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;');
  }

  function renderLines() {
    var term = (qs('cl-search').value || '').toLowerCase();
    var showTs = qs('cl-ts').checked;
    var filtered = term
      ? allLines.filter(function(l) { return l.content.toLowerCase().indexOf(term) !== -1; })
      : allLines;
    qs('cl-count').textContent = term ? filtered.length + ' match' + (filtered.length === 1 ? '' : 'es') : '';
    if (!filtered.length) {
      qs('cl-output').innerHTML = '<span class="log-empty">' + (allLines.length ? '(no matching lines)' : '(no logs loaded)') + '</span>';
      return;
    }
    var html = filtered.map(function(l) {
      var ts = showTs && l.timestamp ? '<span class="ts">' + escHtml(l.timestamp) + '</span>' : '';
      return ts + escHtml(l.content);
    }).join('\\n');
    qs('cl-output').textContent = '';
    qs('cl-output').innerHTML = html;
  }

  function appendLine(line) {
    allLines.push(line);
    if (allLines.length > 2000) allLines = allLines.slice(-2000);
    renderLines();
    var el = qs('cl-output');
    el.scrollTop = el.scrollHeight;
  }

  function stopTail() {
    if (tailEs) { tailEs.close(); tailEs = null; }
    qs('cl-tail').classList.remove('tail-active');
  }

  function startTail() {
    stopTail();
    var container = qs('cl-container').value;
    if (!container) { qs('cl-tail').checked = false; return; }
    tailEs = new EventSource(base + '/tail?container=' + encodeURIComponent(container));
    tailEs.addEventListener('line', function(e) {
      try { appendLine(JSON.parse(e.data)); } catch(_) {}
    });
    tailEs.addEventListener('error', function() { stopTail(); qs('cl-tail').checked = false; });
  }

  qs('cl-load').addEventListener('click', function() {
    var container = qs('cl-container').value;
    var lines = qs('cl-lines').value;
    if (!container) return;
    stopTail();
    qs('cl-output').innerHTML = '<span class="log-empty">(loading…)</span>';
    fetch(base + '/logs?container=' + encodeURIComponent(container) + '&lines=' + lines)
      .then(function(r) { return r.json(); })
      .then(function(data) {
        allLines = data.lines || [];
        renderLines();
      })
      .catch(function(err) {
        qs('cl-output').innerHTML = '<span class="log-empty">(error: ' + escHtml(String(err)) + ')</span>';
      });
  });

  qs('cl-tail').addEventListener('change', function() {
    if (this.checked) startTail(); else stopTail();
  });

  qs('cl-ts').addEventListener('change', function() { renderLines(); });

  qs('cl-search').addEventListener('input', function() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderLines, 150);
  });
})();
</script>`;
}

// =============================================================================
// Claude tools
// =============================================================================

const tools: ToolDefinition[] = [
  {
    spec: {
      name: 'list_containers',
      description: 'List all running Docker containers by name. Use this to discover which containers are available before fetching logs.',
      input_schema: { type: 'object' as const, properties: {} },
    },
    async execute(): Promise<string> {
      try {
        const containers = await getContainerStatus();
        const running = containers.filter((c) => c.state === 'running');
        if (!running.length) return 'No running containers.';
        return running.map((c) => `${c.name} (${c.image}, ${c.status})`).join('\n');
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  },
  {
    spec: {
      name: 'get_logs',
      description: 'Fetch recent log lines from a Docker container. Logs are scrubbed to remove secrets.',
      input_schema: {
        type: 'object' as const,
        properties: {
          container_name: { type: 'string', description: 'Container name' },
          lines: { type: 'number', description: 'Number of lines to fetch (default: 50, max: 500)' },
        },
        required: ['container_name'],
      },
    },
    async execute(input: Record<string, unknown>): Promise<string> {
      try {
        const containerName = typeof input.container_name === 'string' ? input.container_name : '';
        if (!containerName) return 'Error: container_name is required';
        const service = sanitizeServiceName(containerName);
        const lines = Math.min(typeof input.lines === 'number' ? input.lines : 50, MAX_LINES);
        const raw = await getContainerLogs(service, lines);
        return scrubSensitiveData(raw) || '(no output)';
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  },
  {
    spec: {
      name: 'search_logs',
      description: 'Search recent log lines from a Docker container for a pattern. Returns matching lines with context.',
      input_schema: {
        type: 'object' as const,
        properties: {
          container_name: { type: 'string', description: 'Container name' },
          pattern: { type: 'string', description: 'Search term (case-insensitive)' },
          lines: { type: 'number', description: 'Lines to search through (default: 200, max: 500)' },
        },
        required: ['container_name', 'pattern'],
      },
    },
    async execute(input: Record<string, unknown>): Promise<string> {
      try {
        const containerName = typeof input.container_name === 'string' ? input.container_name : '';
        const pattern = typeof input.pattern === 'string' ? input.pattern : '';
        if (!containerName) return 'Error: container_name is required';
        if (!pattern) return 'Error: pattern is required';
        const service = sanitizeServiceName(containerName);
        const lines = Math.min(typeof input.lines === 'number' ? input.lines : 200, MAX_LINES);
        const raw = await getContainerLogs(service, lines);
        const scrubbed = scrubSensitiveData(raw);
        const parsed = scrubbed.split('\n').map(parseLogLine);
        const matches = filterLogLines(parsed, pattern);
        if (!matches.length) return `No lines matching "${pattern}" in ${service} (searched last ${lines} lines).`;
        const formatted = matches.map((l) => (l.timestamp ? `${l.timestamp} ${l.content}` : l.content)).join('\n');
        return `${matches.length} match(es) for "${pattern}" in ${service}:\n\n${formatted}`;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  },
];

// =============================================================================
// Plugin
// =============================================================================

const containerLogsPlugin: Plugin = {
  name: 'container_logs',
  version: '1.0.0',
  description: 'General-purpose container log viewer — web dashboard, Slack commands, Claude tools',

  helpEntries: [
    { command: '/container-logs <service> [n]', description: 'Show last N lines of container logs', group: 'Container Logs' },
    { command: '/container-logs tail <service>', description: 'Post link to live tail view', group: 'Container Logs' },
    { command: '/container-logs search <service> <term>', description: 'Search logs for a term', group: 'Container Logs' },
  ],

  registerCommands(app) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (app as any).command('/container-logs', async ({ command, ack, respond }: any) => {
      await ack();
      try {
        const cmd = parseContainerLogsCommand(command.text ?? '');

        if (cmd.subcommand === 'tail') {
          const url = `/p/container_logs/?container=${encodeURIComponent(cmd.service)}&tail=1`;
          await respond({
            blocks: [
              header(`Live tail: ${cmd.service}`),
              context(`Open the live tail view in your browser: ${url}`),
            ],
            response_type: 'ephemeral',
          });
          return;
        }

        if (cmd.subcommand === 'search') {
          const lines = 200;
          const raw = await getContainerLogs(cmd.service, lines);
          const scrubbed = scrubSensitiveData(raw);
          const parsed = scrubbed.split('\n').map(parseLogLine);
          const matches = filterLogLines(parsed, cmd.term);
          const blocks = [header(`Search: "${cmd.term}" in ${cmd.service}`)];
          if (!matches.length) {
            blocks.push(context(`No matches in last ${lines} lines.`));
          } else {
            const text = matches
              .slice(0, 50)
              .map((l) => (l.timestamp ? `${l.timestamp} ${l.content}` : l.content))
              .join('\n');
            blocks.push(codeBlock(text));
            if (matches.length > 50) {
              blocks.push(context(`Showing 50 of ${matches.length} matches.`));
            }
          }
          await respond({ blocks, response_type: 'ephemeral' });
          return;
        }

        // Default: logs
        const raw = await getContainerLogs(cmd.service, cmd.lines);
        const processed = processLogsForSlack(raw);
        const secretCount = countPotentialSecrets(raw);
        const blocks = [
          header(`Logs: ${cmd.service}`),
          warning('Logs may contain sensitive information. Automatic scrubbing is applied but may not catch everything.'),
        ];
        if (secretCount > 0) {
          blocks.push(context(`:rotating_light: ${String(secretCount)} potential secret(s) detected and redacted.`));
        }
        blocks.push(context(`Showing last ${cmd.lines} lines`));
        blocks.push(codeBlock(processed || '(no output)'));
        await respond({ blocks, response_type: 'ephemeral' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'An unexpected error occurred';
        logger.error('container-logs command failed', { error: msg, text: command.text });
        await respond({ blocks: [errorBlock(msg)], response_type: 'ephemeral' });
      }
    });
  },

  webNavEntry: { label: 'Logs', icon: 'terminal' },

  registerWebRoutes(router) {
    const webBase = `/p/${router.pluginName}`;

    // Main dashboard page
    router.get('/', async (req, res) => {
      try {
        const containers = await getContainerStatus();
        const names = containers.map((c) => c.name).sort();
        const body = buildDashboardHtml(names, webBase);
        res.send(renderPluginPage({
          title: 'Container Logs',
          pluginName: 'container_logs',
          body,
          styles: PAGE_STYLES,
        }));
      } catch (err) {
        logger.error('container-logs dashboard error', { error: err instanceof Error ? err.message : String(err) });
        res.status(500).send('Failed to load container list.');
      }
    });

    // JSON API: fetch log lines
    router.get('/logs', async (req, res) => {
      try {
        const container = typeof req.query['container'] === 'string' ? req.query['container'] : '';
        const rawLines = typeof req.query['lines'] === 'string' ? parseInt(req.query['lines'], 10) : 500;
        if (!container) { res.status(400).json({ error: 'container is required' }); return; }
        const service = sanitizeServiceName(container);
        const lines = Math.min(isNaN(rawLines) ? 500 : rawLines, 1000);
        const raw = await getContainerLogs(service, lines);
        const scrubbed = scrubSensitiveData(raw);
        const parsed = scrubbed.split('\n').filter(Boolean).map(parseLogLine);
        res.json({ lines: parsed });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error('container-logs /logs error', { error: msg });
        res.status(500).json({ error: msg });
      }
    });

    // SSE: live tail via docker logs --follow
    router.get('/tail', (req, res) => {
      const container = typeof req.query['container'] === 'string' ? req.query['container'] : '';
      let service: string;
      try {
        service = sanitizeServiceName(container);
      } catch (err) {
        res.status(400).send('Invalid container name');
        return;
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      const child = spawn(DOCKER_BIN, ['logs', '--follow', '--tail', '20', '--timestamps', service]);
      let buffer = '';

      const handleChunk = (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        const lineBreak = buffer.lastIndexOf('\n');
        if (lineBreak === -1) return;
        const complete = buffer.slice(0, lineBreak);
        buffer = buffer.slice(lineBreak + 1);
        for (const raw of complete.split('\n')) {
          if (!raw) continue;
          const scrubbed = scrubSensitiveData(raw);
          const parsed = parseLogLine(scrubbed);
          const payload = JSON.stringify(parsed);
          res.write(`event: line\ndata: ${payload}\n\n`);
        }
      };

      child.stdout.on('data', handleChunk);
      child.stderr.on('data', handleChunk);

      child.on('error', (err) => {
        logger.error('container-logs tail spawn error', { service, error: err.message });
        if (!res.writableEnded) res.end();
      });

      child.on('close', () => {
        if (!res.writableEnded) res.end();
      });

      req.on('close', () => {
        child.kill('SIGTERM');
      });
    });
  },

  tools,
};

export default containerLogsPlugin;

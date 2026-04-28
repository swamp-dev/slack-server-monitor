/**
 * AgentBox Workflows web UI — route registration (#241 / T11).
 *
 * Pages registered under /p/agentbox/:
 *   - GET /            →  dashboard (status banner + stats + active run + recent)
 *   - GET /queue       →  ready-issue queue (split #2)
 *   - GET /runs        →  paginated run history (split #3)
 *   - GET /runs/:id    →  single-run detail (split #4)
 *
 * Live updates (split #5):
 *   - 10s poll broadcasts `dashboard-update` events on the plugin
 *     SSE channel while a run is active. The dashboard's embedded
 *     client-side JS subscribes and re-renders the active-run +
 *     stats sections without a page reload. The plugin SSE channel
 *     is auto-mounted at /p/agentbox/stream by the plugin router.
 */
import type { PluginRouter } from '../../src/plugins/index.js';
import { renderPluginPage, escapeHtml } from '../../src/web/plugin-helpers.js';
import { logger } from '../../src/utils/logger.js';
import {
  loadDashboardData,
  renderDashboard,
  renderQueue,
  renderNavPills,
  loadRunHistory,
  renderRunHistory,
  parsePageParam,
  loadRunDetail,
  renderRunDetail,
  parseRunIdParam,
  DASHBOARD_CSS,
  DASHBOARD_CLIENT_JS,
  buildWidgetSummary,
  type QueueIssue,
} from './web-templates.js';
import { listReadyIssues } from './scheduler.js';
import type { PluginDatabase } from '../../src/services/plugin-database.js';
import type { PluginContext, DashboardWidget } from '../../src/plugins/types.js';

let pluginDb: PluginDatabase | null = null;
let defaultRepo = '';
let pluginCtxRef: PluginContext | null = null;
let sseTimer: ReturnType<typeof setInterval> | null = null;

const SSE_POLL_INTERVAL_MS = 10_000;

export function setWebPluginDb(db: PluginDatabase | null): void {
  pluginDb = db;
}

/**
 * Set the default repo the queue page polls. Configured at plugin
 * init from AGENTBOX_DEFAULT_REPO; the queue page surfaces a friendly
 * "not configured" message rather than silently rendering empty.
 */
export function setWebDefaultRepo(repo: string): void {
  defaultRepo = repo;
}

/**
 * Start the 10s polling loop that broadcasts dashboard-update SSE
 * events while a run is active. Stop with stopSSEPolling() in
 * destroy(). Calling startSSEPolling() while a timer is already
 * running updates the context reference (so a re-init points at
 * fresh state) but does not stack timers.
 *
 * The broadcast payload is intentionally narrow — only `stats` and
 * `activeRun` — so internal `error` strings on completed runs aren't
 * pushed to every connected client every 10s.
 */
export function startSSEPolling(ctx: PluginContext): void {
  pluginCtxRef = ctx;
  if (sseTimer) return;
  sseTimer = setInterval(() => {
    if (!pluginCtxRef || !pluginDb) return;
    if (pluginCtxRef.sse.clientCount() === 0) return;
    try {
      const data = loadDashboardData(pluginDb);
      pluginCtxRef.sse.broadcast('dashboard-update', {
        stats: data.stats,
        activeRun: data.activeRun,
      });
    } catch (err) {
      logger.warn('AgentBox SSE poll failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, SSE_POLL_INTERVAL_MS);
}

export function stopSSEPolling(): void {
  if (sseTimer) {
    clearInterval(sseTimer);
    sseTimer = null;
  }
  pluginCtxRef = null;
}

/**
 * Build the home-page DashboardWidget summarising AgentBox state.
 * Consumed by the plugin manifest's getWidgets() hook.
 */
export function getAgentboxWidgets(): DashboardWidget[] {
  if (!pluginDb) {
    return [{
      title: 'AgentBox',
      icon: 'robot',
      html: '<p style="color:var(--text-muted);font-size:0.875rem;">Plugin not initialised.</p>',
      link: '/p/agentbox/',
      priority: 30,
      size: 'small',
    }];
  }
  let html: string;
  try {
    const data = loadDashboardData(pluginDb);
    html = buildWidgetSummary(data);
  } catch (err) {
    logger.warn('AgentBox widget render failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    html = '<p style="color:var(--text-muted);font-size:0.875rem;">Could not load AgentBox state.</p>';
  }
  return [{
    title: 'AgentBox',
    icon: 'robot',
    html,
    link: '/p/agentbox/',
    priority: 30,
    size: 'small',
  }];
}

export function registerAgentboxWebRoutes(router: PluginRouter): void {
  // GET /  →  dashboard
  router.get('/', (_req, res, ctx) => {
    if (!pluginDb) {
      res.send(renderPluginPage({
        title: 'Workflows',
        pluginName: ctx.name,
        body: '<div class="agentbox-card"><h2>Not initialized</h2><p>The AgentBox plugin database is not available.</p></div>',
        styles: DASHBOARD_CSS,
      }));
      return;
    }
    let body: string;
    try {
      const data = loadDashboardData(pluginDb);
      body = renderDashboard(data);
    } catch (err) {
      logger.error('AgentBox web: dashboard render failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      body = `<div class="agentbox-card"><h2>Error</h2><p>Could not load dashboard: ${escapeHtml(err instanceof Error ? err.message : String(err))}</p></div>`;
    }
    res.send(renderPluginPage({
      title: 'Workflows',
      pluginName: ctx.name,
      body,
      styles: DASHBOARD_CSS,
      scripts: DASHBOARD_CLIENT_JS,
    }));
  });

  // GET /queue  →  ready-issue queue
  // Returning the Promise lets the plugin router's wrapHandler handle
  // any rejection by logging it and sending a 500, instead of us
  // having to wire a self-contained .catch.
  router.get('/queue', async (_req, res, ctx) => {
    let body: string;
    if (!defaultRepo) {
      body = `${renderNavPills('queue')}
<div class="agentbox-card">
  <h2>Ready Queue</h2>
  <p class="agentbox-muted">AGENTBOX_DEFAULT_REPO is not configured. Set it to enable queue polling.</p>
</div>`;
    } else {
      try {
        const issues = (await listReadyIssues(defaultRepo)) as QueueIssue[];
        body = renderQueue(issues, defaultRepo);
      } catch (err) {
        logger.error('AgentBox web: queue load failed', {
          error: err instanceof Error ? err.message : String(err),
        });
        body = `${renderNavPills('queue')}
<div class="agentbox-card">
  <h2>Error</h2>
  <p>Could not load ready queue: ${escapeHtml(err instanceof Error ? err.message : String(err))}</p>
</div>`;
      }
    }
    res.send(renderPluginPage({
      title: 'Workflows · Queue',
      pluginName: ctx.name,
      body,
      styles: DASHBOARD_CSS,
    }));
  });

  // GET /runs  →  paginated run history
  router.get('/runs', (req, res, ctx) => {
    if (!pluginDb) {
      res.send(renderPluginPage({
        title: 'Workflows · Runs',
        pluginName: ctx.name,
        body: `${renderNavPills('runs')}<div class="agentbox-card"><h2>Not initialized</h2><p>The AgentBox plugin database is not available.</p></div>`,
        styles: DASHBOARD_CSS,
      }));
      return;
    }
    let body: string;
    try {
      const page = parsePageParam(req.query?.page);
      const data = loadRunHistory(pluginDb, page);
      body = renderRunHistory(data);
    } catch (err) {
      logger.error('AgentBox web: run history load failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      body = `${renderNavPills('runs')}
<div class="agentbox-card">
  <h2>Error</h2>
  <p>Could not load run history: ${escapeHtml(err instanceof Error ? err.message : String(err))}</p>
</div>`;
    }
    res.send(renderPluginPage({
      title: 'Workflows · Runs',
      pluginName: ctx.name,
      body,
      styles: DASHBOARD_CSS,
    }));
  });

  // GET /runs/:id  →  run detail page
  router.get('/runs/:id', (req, res, ctx) => {
    if (!pluginDb) {
      res.send(renderPluginPage({
        title: 'Workflows · Run',
        pluginName: ctx.name,
        body: `${renderNavPills('runs')}<div class="agentbox-card"><h2>Not initialized</h2><p>The AgentBox plugin database is not available.</p></div>`,
        styles: DASHBOARD_CSS,
      }));
      return;
    }
    const runId = parseRunIdParam(req.params?.id);
    if (runId === null) {
      // 404 for malformed ids — same shape as a not-found run.
      res.status(404).send(renderPluginPage({
        title: 'Workflows · Not Found',
        pluginName: ctx.name,
        body: `${renderNavPills('runs')}<div class="agentbox-card"><h2>Run not found</h2><p class="agentbox-muted">The run id in the URL must be a positive integer.</p></div>`,
        styles: DASHBOARD_CSS,
      }));
      return;
    }
    let body: string;
    let statusCode = 200;
    try {
      const detail = loadRunDetail(pluginDb, runId);
      if (!detail) {
        statusCode = 404;
        body = `${renderNavPills('runs')}<div class="agentbox-card"><h2>Run not found</h2><p class="agentbox-muted">No run with id ${String(runId)} exists in this workspace.</p></div>`;
      } else {
        body = renderRunDetail(detail);
      }
    } catch (err) {
      logger.error('AgentBox web: run detail load failed', {
        runId,
        error: err instanceof Error ? err.message : String(err),
      });
      statusCode = 500;
      body = `${renderNavPills('runs')}
<div class="agentbox-card">
  <h2>Error</h2>
  <p>Could not load run #${String(runId)}: ${escapeHtml(err instanceof Error ? err.message : String(err))}</p>
</div>`;
    }
    res.status(statusCode).send(renderPluginPage({
      title: `Workflows · Run #${String(runId)}`,
      pluginName: ctx.name,
      body,
      styles: DASHBOARD_CSS,
    }));
  });
}

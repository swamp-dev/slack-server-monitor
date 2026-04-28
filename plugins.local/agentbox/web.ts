/**
 * AgentBox Workflows web UI — route registration (#241 / T11).
 *
 * Pages registered under /p/agentbox/:
 *   - GET /            →  dashboard (status banner + stats + active run + recent)
 *   - GET /queue       →  ready-issue queue (split #2)
 *   - GET /runs        →  paginated run history (split #3)
 *   - GET /runs/:id    →  single-run detail (split #4)
 *
 * SSE event broadcasting (split #5) lands in a follow-up PR.
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
  type QueueIssue,
} from './web-templates.js';
import { listReadyIssues } from './scheduler.js';
import type { PluginDatabase } from '../../src/services/plugin-database.js';

let pluginDb: PluginDatabase | null = null;
let defaultRepo = '';

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

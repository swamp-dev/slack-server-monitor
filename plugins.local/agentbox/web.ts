/**
 * AgentBox Workflows web UI — route registration (#241 / T11).
 *
 * Pages registered under /p/agentbox/:
 *   - GET /        →  dashboard (status banner + stats + active run + recent)
 *   - GET /queue   →  ready-issue queue (split #2)
 *
 * Run history, run detail, and SSE event broadcasting will land in
 * follow-up PRs (T11 split).
 */
import type { PluginRouter } from '../../src/plugins/index.js';
import { renderPluginPage, escapeHtml } from '../../src/web/plugin-helpers.js';
import { logger } from '../../src/utils/logger.js';
import {
  loadDashboardData,
  renderDashboard,
  renderQueue,
  renderNavPills,
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
}

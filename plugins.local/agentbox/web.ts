/**
 * AgentBox Workflows web UI — route registration (#241 / T11).
 *
 * Pages registered under /p/agentbox/:
 *   - GET /  →  dashboard (status banner + stats + active run + recent)
 *
 * Queue, run history, run detail, and SSE event broadcasting will
 * land in follow-up PRs (T11 split).
 */
import type { PluginRouter } from '../../src/plugins/index.js';
import { renderPluginPage, escapeHtml } from '../../src/web/plugin-helpers.js';
import { logger } from '../../src/utils/logger.js';
import { loadDashboardData, renderDashboard, DASHBOARD_CSS } from './web-templates.js';
import type { PluginDatabase } from '../../src/services/plugin-database.js';

let pluginDb: PluginDatabase | null = null;

export function setWebPluginDb(db: PluginDatabase | null): void {
  pluginDb = db;
}

export function registerAgentboxWebRoutes(router: PluginRouter): void {
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
}

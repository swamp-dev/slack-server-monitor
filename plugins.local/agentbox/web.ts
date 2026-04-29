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
import { listReadyIssues, cancelRun, pauseRun, resumeRun } from './scheduler.js';
import type { PluginDatabase } from '../../src/services/plugin-database.js';
import type { PluginContext, DashboardWidget } from '../../src/plugins/types.js';

let pluginDb: PluginDatabase | null = null;
let defaultRepo = '';
let pluginCtxRef: PluginContext | null = null;
let sseTimer: ReturnType<typeof setInterval> | null = null;

// Tracks the last active run we observed in the polling loop so we
// can detect the running→terminal transition and emit a one-shot
// `run-complete` event for client toast notifications. Reset whenever
// startSSEPolling is (re)called and on stopSSEPolling.
let lastActiveRunId: number | null = null;

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
  // Only reset transition state when actually starting a fresh
  // timer — bailing early on an already-running poller shouldn't
  // wipe in-progress run tracking.
  lastActiveRunId = null;
  sseTimer = setInterval(() => {
    if (!pluginCtxRef || !pluginDb) return;
    if (pluginCtxRef.sse.clientCount() === 0) return;
    try {
      const data = loadDashboardData(pluginDb);
      pluginCtxRef.sse.broadcast('dashboard-update', {
        stats: data.stats,
        activeRun: data.activeRun,
      });

      // Detect running→terminal transition and emit a one-shot
      // run-complete event so connected clients can show a toast.
      // The lookup re-reads the runs table because activeRun is null
      // at the moment the run finishes — we need the row's terminal
      // status to populate the toast.
      //
      // Known limitation: if two runs both start AND finish within
      // a single 10s tick, only the first will fire run-complete —
      // the second's transition is invisible because lastActiveRunId
      // is already null when its row appears terminal. Acceptable
      // for the toast UX since agentbox runs are minutes long, not
      // seconds.
      const currentActiveId = data.activeRun ? data.activeRun.id : null;
      if (lastActiveRunId !== null && currentActiveId !== lastActiveRunId) {
        const completed = pluginDb
          .prepare(
            `SELECT id, issue_number, repo, status FROM ${pluginDb.prefix}runs WHERE id = ?`,
          )
          .get(lastActiveRunId) as
          | { id: number; issue_number: number; repo: string; status: string }
          | undefined;
        if (completed && (completed.status === 'success' || completed.status === 'failed' || completed.status === 'cancelled')) {
          pluginCtxRef.sse.broadcast('run-complete', {
            runId: completed.id,
            issueNumber: completed.issue_number,
            repo: completed.repo,
            status: completed.status,
          });
        }
      }
      lastActiveRunId = currentActiveId;
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
  lastActiveRunId = null;
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

  // POST /runs/:id/cancel  →  cancel an in-flight run (T12 split 1).
  // Wraps scheduler.cancelRun() — which is idempotent for already-
  // terminal runs and a no-op when the runId isn't the active one.
  // After a successful cancel, broadcasts a `dashboard-update` SSE
  // event (same channel split #5's poller uses) so any open dashboard
  // re-renders without waiting for the next 10s poll.
  router.post('/runs/:id/cancel', async (req, res, _ctx) => {
    if (!pluginDb) {
      res.status(503).send('AgentBox plugin database is not available.');
      return;
    }
    const runId = parseRunIdParam(req.params?.id);
    if (runId === null) {
      res.status(400).send('Invalid run id.');
      return;
    }
    if (!defaultRepo) {
      res.status(500).send('AGENTBOX_DEFAULT_REPO is not configured.');
      return;
    }
    try {
      // The actor is best-effort — auth middleware populates
      // res.locals.userId when a session is present. The cancel
      // attribution is just a comment string, not an authorisation
      // gate, so 'web' is a safe fallback.
      const cancelledBy =
        (typeof res.locals?.userId === 'string' && res.locals.userId) || 'web';
      await cancelRun(runId, cancelledBy, { db: pluginDb, repo: defaultRepo });

      // Push a fresh dashboard snapshot + run-complete event so
      // connected clients see the status flip immediately and surface
      // a toast. Best-effort — failures here don't affect the cancel.
      if (pluginCtxRef && pluginCtxRef.sse.clientCount() > 0) {
        try {
          const data = loadDashboardData(pluginDb);
          pluginCtxRef.sse.broadcast('dashboard-update', {
            stats: data.stats,
            activeRun: data.activeRun,
          });
          const cancelledRow = pluginDb
            .prepare(
              `SELECT id, issue_number, repo, status FROM ${pluginDb.prefix}runs WHERE id = ?`,
            )
            .get(runId) as
            | { id: number; issue_number: number; repo: string; status: string }
            | undefined;
          if (cancelledRow && cancelledRow.status === 'cancelled') {
            pluginCtxRef.sse.broadcast('run-complete', {
              runId: cancelledRow.id,
              issueNumber: cancelledRow.issue_number,
              repo: cancelledRow.repo,
              status: cancelledRow.status,
            });
          }
        } catch {
          /* best-effort */
        }
      }
      res.redirect(`/p/agentbox/runs/${String(runId)}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('AgentBox web: cancel failed', { runId, error: message });
      // cancelRun throws "Run X does not exist" for unknown ids —
      // surface as 404 so the caller can distinguish from a real 500.
      const notFound = /does not exist/i.test(message);
      res.status(notFound ? 404 : 500).send(`Failed to cancel run #${String(runId)}: ${message}`);
    }
  });

  // POST /runs/:id/pause  →  checkpoint + pause an in-flight run (T14).
  // pauseRun is idempotent for already-terminal/already-paused runs
  // and a no-op when the runId isn't the active one.
  router.post('/runs/:id/pause', async (req, res, _ctx) => {
    if (!pluginDb) {
      res.status(503).send('AgentBox plugin database is not available.');
      return;
    }
    const runId = parseRunIdParam(req.params?.id);
    if (runId === null) {
      res.status(400).send('Invalid run id.');
      return;
    }
    if (!defaultRepo) {
      res.status(500).send('AGENTBOX_DEFAULT_REPO is not configured.');
      return;
    }
    try {
      await pauseRun(runId, { db: pluginDb, repo: defaultRepo });
      // Live update so any open dashboard re-renders without waiting
      // for the next 10s poll. The run-complete event is intentionally
      // NOT broadcast on pause — the run isn't done.
      if (pluginCtxRef && pluginCtxRef.sse.clientCount() > 0) {
        try {
          const data = loadDashboardData(pluginDb);
          pluginCtxRef.sse.broadcast('dashboard-update', {
            stats: data.stats,
            activeRun: data.activeRun,
          });
        } catch {
          /* best-effort */
        }
      }
      res.redirect(`/p/agentbox/runs/${String(runId)}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('AgentBox web: pause failed', { runId, error: message });
      const notFound = /does not exist/i.test(message);
      res.status(notFound ? 404 : 500).send(`Failed to pause run #${String(runId)}: ${message}`);
    }
  });

  // POST /runs/:id/resume  →  resume a paused run (T14).
  // The resume itself runs for as long as the agentbox session takes
  // (potentially hours), so we can't await it. We pre-validate the
  // row synchronously, then kick off resumeRun fire-and-forget.
  router.post('/runs/:id/resume', (req, res, _ctx) => {
    if (!pluginDb) {
      res.status(503).send('AgentBox plugin database is not available.');
      return;
    }
    const runId = parseRunIdParam(req.params?.id);
    if (runId === null) {
      res.status(400).send('Invalid run id.');
      return;
    }
    if (!defaultRepo) {
      res.status(500).send('AGENTBOX_DEFAULT_REPO is not configured.');
      return;
    }

    // Pre-validate the row before kicking off the long-running
    // resume. The user-visible 4xx errors must surface before we
    // return; once resumeRun is dispatched its errors land in logs.
    const row = pluginDb
      .prepare(`SELECT id, status, output_path FROM ${pluginDb.prefix}runs WHERE id = ?`)
      .get(runId) as { id: number; status: string; output_path: string | null } | undefined;
    if (!row) {
      res.status(404).send(`Run #${String(runId)} does not exist.`);
      return;
    }
    if (row.status !== 'paused') {
      res.status(409).send(`Run #${String(runId)} is not paused (status=${row.status}).`);
      return;
    }
    if (!row.output_path) {
      res.status(409).send(`Run #${String(runId)} has no recorded workDir — cannot resume.`);
      return;
    }

    // Validation passed — kick off the resume. Don't await: the
    // session can run for hours. The resume goes through label
    // transitions before flipping the row to 'running', so we don't
    // broadcast a dashboard-update here (it would still show the
    // paused state). The 10s polling loop catches the transition.
    //
    // ExecutorBusyError lands as a logged error in the .catch — if
    // a second run is already in flight we can't actually resume,
    // and the operator will see the row stuck at 'paused' on next
    // poll.
    void resumeRun(runId, { db: pluginDb, repo: defaultRepo }).catch((err) => {
      logger.error('AgentBox web: resumed run failed', {
        runId,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    res.redirect(`/p/agentbox/runs/${String(runId)}`);
  });
}

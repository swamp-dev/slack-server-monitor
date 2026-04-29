/**
 * Tests for the POST /runs/:id/cancel route (#242 / T12 split 1).
 *
 * The cancel route wraps scheduler.cancelRun which itself spawns gh
 * subprocesses for label transitions and the cancel comment. We mock
 * the scheduler boundary so the test can focus on the route's own
 * behaviour: param validation, error mapping, redirect target, and
 * the SSE broadcast on success.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { PluginDatabase } from '../../src/services/plugin-database.js';
import type { PluginRouter, PluginRouteHandler } from '../../src/web/plugin-router.js';
import type { PluginContext } from '../../src/plugins/types.js';

vi.mock('./scheduler.js', () => ({
  cancelRun: vi.fn(),
  pauseRun: vi.fn(),
  resumeRun: vi.fn(),
  listReadyIssues: vi.fn(),
}));

import { cancelRun, pauseRun, resumeRun } from './scheduler.js';
import {
  registerAgentboxWebRoutes,
  setWebPluginDb,
  setWebDefaultRepo,
  startSSEPolling,
  stopSSEPolling,
} from './web.js';
import { createSchema } from '../../plugins.example/agentbox/schema.js';
import { migrateRunsTable } from '../agentbox.js';

let rawDb: Database.Database;
let pluginDb: PluginDatabase;

interface CapturedRoute {
  method: 'GET' | 'POST';
  path: string;
  handler: PluginRouteHandler;
}

function makeFakeRouter(): { router: PluginRouter; routes: CapturedRoute[] } {
  const routes: CapturedRoute[] = [];
  const router: PluginRouter = {
    pluginName: 'agentbox',
    get(path, handler) { routes.push({ method: 'GET', path, handler }); },
    post(path, handler) { routes.push({ method: 'POST', path, handler }); },
  };
  return { router, routes };
}

interface FakeRes {
  statusCode: number;
  body: string | null;
  redirected: string | null;
  locals: Record<string, unknown>;
  status(code: number): FakeRes;
  send(body: string): FakeRes;
  redirect(target: string): FakeRes;
}

function makeRes(locals: Record<string, unknown> = {}): FakeRes {
  const res: FakeRes = {
    statusCode: 200,
    body: null,
    redirected: null,
    locals,
    status(code) { this.statusCode = code; return this; },
    send(body) { this.body = body; return this; },
    redirect(target) { this.redirected = target; this.statusCode = 302; return this; },
  };
  return res;
}

function findCancelHandler(routes: CapturedRoute[]): PluginRouteHandler {
  const route = routes.find((r) => r.method === 'POST' && r.path === '/runs/:id/cancel');
  if (!route) throw new Error('cancel route not registered');
  return route.handler;
}

function makeCtx(): PluginContext {
  return {
    db: pluginDb,
    name: 'agentbox',
    version: '1.0.0',
    notify: vi.fn(),
    sse: { broadcast: vi.fn(), clientCount: () => 0 },
  };
}

beforeEach(() => {
  rawDb = new Database(':memory:');
  rawDb.pragma('journal_mode = WAL');
  pluginDb = new PluginDatabase(rawDb, 'agentbox');
  createSchema(pluginDb);
  migrateRunsTable(pluginDb);
  setWebPluginDb(pluginDb);
  setWebDefaultRepo('org/repo');
  vi.mocked(cancelRun).mockReset();
  vi.mocked(pauseRun).mockReset();
  vi.mocked(resumeRun).mockReset();
});

afterEach(() => {
  setWebPluginDb(null);
  setWebDefaultRepo('');
  stopSSEPolling();
  rawDb.close();
});

describe('POST /runs/:id/cancel (#242 split 1)', () => {
  it('redirects to the run detail page after a successful cancel', async () => {
    rawDb.prepare(
      `INSERT INTO ${pluginDb.prefix}runs (issue_number, repo, status, created_at) VALUES (?, ?, ?, ?)`,
    ).run(7, 'org/repo', 'running', Date.now());
    vi.mocked(cancelRun).mockResolvedValueOnce(undefined);

    const { router, routes } = makeFakeRouter();
    registerAgentboxWebRoutes(router);
    const handler = findCancelHandler(routes);
    const res = makeRes({ userId: 'admin' });

    await handler({ params: { id: '1' } } as never, res as never, makeCtx());

    expect(res.redirected).toBe('/p/agentbox/runs/1');
    expect(cancelRun).toHaveBeenCalledTimes(1);
    expect(vi.mocked(cancelRun).mock.calls[0]![0]).toBe(1);
    expect(vi.mocked(cancelRun).mock.calls[0]![1]).toBe('admin');
    expect(vi.mocked(cancelRun).mock.calls[0]![2]).toEqual({ db: pluginDb, repo: 'org/repo' });
  });

  it('falls back to "web" attribution when no userId is on the session', async () => {
    rawDb.prepare(
      `INSERT INTO ${pluginDb.prefix}runs (issue_number, repo, status, created_at) VALUES (?, ?, ?, ?)`,
    ).run(7, 'org/repo', 'running', Date.now());
    vi.mocked(cancelRun).mockResolvedValueOnce(undefined);

    const { router, routes } = makeFakeRouter();
    registerAgentboxWebRoutes(router);
    const handler = findCancelHandler(routes);
    const res = makeRes(); // no userId

    await handler({ params: { id: '1' } } as never, res as never, makeCtx());

    expect(vi.mocked(cancelRun).mock.calls[0]![1]).toBe('web');
  });

  it('returns 400 for a non-numeric run id', async () => {
    const { router, routes } = makeFakeRouter();
    registerAgentboxWebRoutes(router);
    const handler = findCancelHandler(routes);
    const res = makeRes();

    await handler({ params: { id: 'abc' } } as never, res as never, makeCtx());

    expect(res.statusCode).toBe(400);
    expect(cancelRun).not.toHaveBeenCalled();
  });

  it('returns 400 for a zero / negative run id', async () => {
    const { router, routes } = makeFakeRouter();
    registerAgentboxWebRoutes(router);
    const handler = findCancelHandler(routes);

    const resA = makeRes();
    await handler({ params: { id: '0' } } as never, resA as never, makeCtx());
    expect(resA.statusCode).toBe(400);

    const resB = makeRes();
    await handler({ params: { id: '-3' } } as never, resB as never, makeCtx());
    expect(resB.statusCode).toBe(400);
  });

  it('returns 503 when the plugin db is not initialised', async () => {
    setWebPluginDb(null);
    const { router, routes } = makeFakeRouter();
    registerAgentboxWebRoutes(router);
    const handler = findCancelHandler(routes);
    const res = makeRes();

    await handler({ params: { id: '1' } } as never, res as never, makeCtx());

    expect(res.statusCode).toBe(503);
    expect(cancelRun).not.toHaveBeenCalled();
  });

  it('returns 500 when AGENTBOX_DEFAULT_REPO is not configured', async () => {
    setWebDefaultRepo('');
    const { router, routes } = makeFakeRouter();
    registerAgentboxWebRoutes(router);
    const handler = findCancelHandler(routes);
    const res = makeRes();

    await handler({ params: { id: '1' } } as never, res as never, makeCtx());

    expect(res.statusCode).toBe(500);
    expect(cancelRun).not.toHaveBeenCalled();
  });

  it('returns 404 when cancelRun reports the run does not exist', async () => {
    vi.mocked(cancelRun).mockRejectedValueOnce(new Error('Run 99 does not exist'));
    const { router, routes } = makeFakeRouter();
    registerAgentboxWebRoutes(router);
    const handler = findCancelHandler(routes);
    const res = makeRes();

    await handler({ params: { id: '99' } } as never, res as never, makeCtx());

    expect(res.statusCode).toBe(404);
    expect(res.body).toContain('does not exist');
  });

  it('returns 500 for any other cancelRun failure', async () => {
    vi.mocked(cancelRun).mockRejectedValueOnce(new Error('subprocess kill failed'));
    const { router, routes } = makeFakeRouter();
    registerAgentboxWebRoutes(router);
    const handler = findCancelHandler(routes);
    const res = makeRes();

    await handler({ params: { id: '1' } } as never, res as never, makeCtx());

    expect(res.statusCode).toBe(500);
    expect(res.body).toContain('subprocess kill failed');
  });

  it('broadcasts a dashboard-update SSE event when clients are connected', async () => {
    rawDb.prepare(
      `INSERT INTO ${pluginDb.prefix}runs (issue_number, repo, status, created_at) VALUES (?, ?, ?, ?)`,
    ).run(7, 'org/repo', 'running', Date.now());
    vi.mocked(cancelRun).mockResolvedValueOnce(undefined);

    const broadcast = vi.fn();
    const ctx: PluginContext = {
      db: pluginDb, name: 'agentbox', version: '1.0.0', notify: vi.fn(),
      sse: { broadcast, clientCount: () => 2 },
    };
    // SSE polling stores its own ctx ref — start it so the cancel
    // handler can find a live ctx to broadcast through.
    startSSEPolling(ctx);

    const { router, routes } = makeFakeRouter();
    registerAgentboxWebRoutes(router);
    const handler = findCancelHandler(routes);
    const res = makeRes();

    await handler({ params: { id: '1' } } as never, res as never, ctx);

    expect(broadcast).toHaveBeenCalledWith(
      'dashboard-update',
      expect.objectContaining({ stats: expect.any(Object) }),
    );
    // Narrow payload — recentRuns shouldn't leak.
    const payload = broadcast.mock.calls[0]![1] as Record<string, unknown>;
    expect('recentRuns' in payload).toBe(false);
  });

  it('broadcasts run-complete after a successful cancel (#242 split 2)', async () => {
    rawDb.prepare(
      `INSERT INTO ${pluginDb.prefix}runs (issue_number, repo, status, created_at) VALUES (?, ?, ?, ?)`,
    ).run(7, 'org/repo', 'cancelled', Date.now());
    vi.mocked(cancelRun).mockResolvedValueOnce(undefined);

    const broadcast = vi.fn();
    const ctx: PluginContext = {
      db: pluginDb, name: 'agentbox', version: '1.0.0', notify: vi.fn(),
      sse: { broadcast, clientCount: () => 1 },
    };
    startSSEPolling(ctx);

    const { router, routes } = makeFakeRouter();
    registerAgentboxWebRoutes(router);
    const handler = findCancelHandler(routes);
    const res = makeRes();

    await handler({ params: { id: '1' } } as never, res as never, ctx);

    const completes = broadcast.mock.calls.filter((c) => c[0] === 'run-complete');
    expect(completes).toHaveLength(1);
    const payload = completes[0]![1] as Record<string, unknown>;
    expect(payload.status).toBe('cancelled');
    expect(payload.runId).toBe(1);
    expect(payload.repo).toBe('org/repo');
    expect(payload.issueNumber).toBe(7);
  });

  it('does not broadcast run-complete if the row is not actually cancelled (race)', async () => {
    // Edge case: cancelRun resolved (the run was already terminal,
    // e.g. it succeeded a microsecond before the cancel hit), so the
    // row's status is something other than 'cancelled'. The cancel
    // route should not falsely claim a cancel completed.
    rawDb.prepare(
      `INSERT INTO ${pluginDb.prefix}runs (issue_number, repo, status, created_at) VALUES (?, ?, ?, ?)`,
    ).run(7, 'org/repo', 'success', Date.now());
    vi.mocked(cancelRun).mockResolvedValueOnce(undefined);

    const broadcast = vi.fn();
    const ctx: PluginContext = {
      db: pluginDb, name: 'agentbox', version: '1.0.0', notify: vi.fn(),
      sse: { broadcast, clientCount: () => 1 },
    };
    startSSEPolling(ctx);

    const { router, routes } = makeFakeRouter();
    registerAgentboxWebRoutes(router);
    const handler = findCancelHandler(routes);
    const res = makeRes();

    await handler({ params: { id: '1' } } as never, res as never, ctx);

    expect(broadcast.mock.calls.find((c) => c[0] === 'run-complete')).toBeUndefined();
  });

  it('does not broadcast when no SSE clients are connected', async () => {
    rawDb.prepare(
      `INSERT INTO ${pluginDb.prefix}runs (issue_number, repo, status, created_at) VALUES (?, ?, ?, ?)`,
    ).run(7, 'org/repo', 'running', Date.now());
    vi.mocked(cancelRun).mockResolvedValueOnce(undefined);

    const broadcast = vi.fn();
    const ctx: PluginContext = {
      db: pluginDb, name: 'agentbox', version: '1.0.0', notify: vi.fn(),
      sse: { broadcast, clientCount: () => 0 },
    };
    startSSEPolling(ctx);

    const { router, routes } = makeFakeRouter();
    registerAgentboxWebRoutes(router);
    const handler = findCancelHandler(routes);
    const res = makeRes();

    await handler({ params: { id: '1' } } as never, res as never, ctx);

    expect(broadcast).not.toHaveBeenCalled();
    expect(res.redirected).toBe('/p/agentbox/runs/1');
  });
});

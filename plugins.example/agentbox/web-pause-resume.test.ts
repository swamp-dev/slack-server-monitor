/**
 * Tests for the POST /runs/:id/pause and /runs/:id/resume routes
 * (#244 / T14). Same fake-router pattern as web-cancel.test.ts —
 * mocks the scheduler boundary so we exercise route logic in
 * isolation.
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

import { pauseRun, resumeRun } from './scheduler.js';
import {
  registerAgentboxWebRoutes,
  setWebPluginDb,
  setWebDefaultRepo,
  startSSEPolling,
  stopSSEPolling,
} from './web.js';
import { createSchema } from './schema.js';
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

function makeRes(): FakeRes {
  const res: FakeRes = {
    statusCode: 200,
    body: null,
    redirected: null,
    locals: {},
    status(code) { this.statusCode = code; return this; },
    send(body) { this.body = body; return this; },
    redirect(target) { this.redirected = target; this.statusCode = 302; return this; },
  };
  return res;
}

function findHandler(routes: CapturedRoute[], method: 'GET' | 'POST', path: string): PluginRouteHandler {
  const route = routes.find((r) => r.method === method && r.path === path);
  if (!route) throw new Error(`${method} ${path} route not registered`);
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
  vi.mocked(pauseRun).mockReset();
  vi.mocked(resumeRun).mockReset();
});

afterEach(() => {
  setWebPluginDb(null);
  setWebDefaultRepo('');
  stopSSEPolling();
  rawDb.close();
});

describe('POST /runs/:id/pause (#244)', () => {
  it('redirects to the run detail page after a successful pause', async () => {
    rawDb.prepare(
      `INSERT INTO ${pluginDb.prefix}runs (issue_number, repo, status, created_at) VALUES (?, ?, ?, ?)`,
    ).run(7, 'org/repo', 'running', Date.now());
    vi.mocked(pauseRun).mockResolvedValueOnce(undefined);

    const { router, routes } = makeFakeRouter();
    registerAgentboxWebRoutes(router);
    const handler = findHandler(routes, 'POST', '/runs/:id/pause');
    const res = makeRes();

    await handler({ params: { id: '1' } } as never, res as never, makeCtx());

    expect(res.redirected).toBe('/p/agentbox/runs/1');
    expect(pauseRun).toHaveBeenCalledTimes(1);
    expect(vi.mocked(pauseRun).mock.calls[0]![0]).toBe(1);
    expect(vi.mocked(pauseRun).mock.calls[0]![1]).toEqual({ db: pluginDb, repo: 'org/repo' });
  });

  it('returns 400 for non-numeric run ids', async () => {
    const { router, routes } = makeFakeRouter();
    registerAgentboxWebRoutes(router);
    const handler = findHandler(routes, 'POST', '/runs/:id/pause');
    const res = makeRes();

    await handler({ params: { id: 'abc' } } as never, res as never, makeCtx());

    expect(res.statusCode).toBe(400);
    expect(pauseRun).not.toHaveBeenCalled();
  });

  it('returns 503 when plugin db is not available', async () => {
    setWebPluginDb(null);
    const { router, routes } = makeFakeRouter();
    registerAgentboxWebRoutes(router);
    const handler = findHandler(routes, 'POST', '/runs/:id/pause');
    const res = makeRes();

    await handler({ params: { id: '1' } } as never, res as never, makeCtx());

    expect(res.statusCode).toBe(503);
  });

  it('returns 500 when AGENTBOX_DEFAULT_REPO is unset', async () => {
    setWebDefaultRepo('');
    const { router, routes } = makeFakeRouter();
    registerAgentboxWebRoutes(router);
    const handler = findHandler(routes, 'POST', '/runs/:id/pause');
    const res = makeRes();

    await handler({ params: { id: '1' } } as never, res as never, makeCtx());

    expect(res.statusCode).toBe(500);
  });

  it('returns 404 when pauseRun reports the run does not exist', async () => {
    vi.mocked(pauseRun).mockRejectedValueOnce(new Error('Run 99 does not exist'));
    const { router, routes } = makeFakeRouter();
    registerAgentboxWebRoutes(router);
    const handler = findHandler(routes, 'POST', '/runs/:id/pause');
    const res = makeRes();

    await handler({ params: { id: '99' } } as never, res as never, makeCtx());

    expect(res.statusCode).toBe(404);
  });

  it('does NOT broadcast a run-complete event on pause (run is not done)', async () => {
    rawDb.prepare(
      `INSERT INTO ${pluginDb.prefix}runs (issue_number, repo, status, created_at) VALUES (?, ?, ?, ?)`,
    ).run(7, 'org/repo', 'paused', Date.now());
    vi.mocked(pauseRun).mockResolvedValueOnce(undefined);

    const broadcast = vi.fn();
    const ctx: PluginContext = {
      db: pluginDb, name: 'agentbox', version: '1.0.0', notify: vi.fn(),
      sse: { broadcast, clientCount: () => 1 },
    };
    startSSEPolling(ctx);

    const { router, routes } = makeFakeRouter();
    registerAgentboxWebRoutes(router);
    const handler = findHandler(routes, 'POST', '/runs/:id/pause');
    const res = makeRes();

    await handler({ params: { id: '1' } } as never, res as never, ctx);

    // dashboard-update fires (live UI), but run-complete must not —
    // the run is reversible, not done.
    expect(broadcast.mock.calls.find((c) => c[0] === 'dashboard-update')).toBeDefined();
    expect(broadcast.mock.calls.find((c) => c[0] === 'run-complete')).toBeUndefined();
  });
});

describe('POST /runs/:id/resume (#244)', () => {
  it('redirects to the run detail page after kicking off resume', async () => {
    rawDb.prepare(
      `INSERT INTO ${pluginDb.prefix}runs (issue_number, repo, status, output_path, paused_at, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(7, 'org/repo', 'paused', '/tmp/work-7/run.log', Date.now(), Date.now());
    vi.mocked(resumeRun).mockReturnValueOnce(new Promise(() => { /* never resolves — long-running */ }) as never);

    const { router, routes } = makeFakeRouter();
    registerAgentboxWebRoutes(router);
    const handler = findHandler(routes, 'POST', '/runs/:id/resume');
    const res = makeRes();

    await handler({ params: { id: '1' } } as never, res as never, makeCtx());

    expect(res.redirected).toBe('/p/agentbox/runs/1');
    expect(resumeRun).toHaveBeenCalledTimes(1);
    expect(vi.mocked(resumeRun).mock.calls[0]![0]).toBe(1);
  });

  it('returns 404 when the row does not exist', async () => {
    const { router, routes } = makeFakeRouter();
    registerAgentboxWebRoutes(router);
    const handler = findHandler(routes, 'POST', '/runs/:id/resume');
    const res = makeRes();

    await handler({ params: { id: '99' } } as never, res as never, makeCtx());

    expect(res.statusCode).toBe(404);
    expect(resumeRun).not.toHaveBeenCalled();
  });

  it('returns 409 when the row is not in paused state', async () => {
    rawDb.prepare(
      `INSERT INTO ${pluginDb.prefix}runs (issue_number, repo, status, output_path, created_at) VALUES (?, ?, ?, ?, ?)`,
    ).run(7, 'org/repo', 'running', '/tmp/run.log', Date.now());

    const { router, routes } = makeFakeRouter();
    registerAgentboxWebRoutes(router);
    const handler = findHandler(routes, 'POST', '/runs/:id/resume');
    const res = makeRes();

    await handler({ params: { id: '1' } } as never, res as never, makeCtx());

    expect(res.statusCode).toBe(409);
    expect(res.body).toContain('not paused');
    expect(resumeRun).not.toHaveBeenCalled();
  });

  it('returns 409 when the row has no recorded workDir', async () => {
    rawDb.prepare(
      `INSERT INTO ${pluginDb.prefix}runs (issue_number, repo, status, output_path, created_at) VALUES (?, ?, ?, ?, ?)`,
    ).run(7, 'org/repo', 'paused', null, Date.now());

    const { router, routes } = makeFakeRouter();
    registerAgentboxWebRoutes(router);
    const handler = findHandler(routes, 'POST', '/runs/:id/resume');
    const res = makeRes();

    await handler({ params: { id: '1' } } as never, res as never, makeCtx());

    expect(res.statusCode).toBe(409);
    expect(res.body).toContain('workDir');
    expect(resumeRun).not.toHaveBeenCalled();
  });

  it('returns 400 for non-numeric run ids', async () => {
    const { router, routes } = makeFakeRouter();
    registerAgentboxWebRoutes(router);
    const handler = findHandler(routes, 'POST', '/runs/:id/resume');
    const res = makeRes();

    await handler({ params: { id: 'abc' } } as never, res as never, makeCtx());

    expect(res.statusCode).toBe(400);
    expect(resumeRun).not.toHaveBeenCalled();
  });
});

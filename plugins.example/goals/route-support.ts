/**
 * Fake router and req/res doubles for the route tests.
 * Mirrors the harness in plugins.example/agentbox/web-cancel.test.ts.
 */
import type { Request, Response } from 'express';
import type { PluginRouter, PluginRouteHandler } from '../../src/web/plugin-router.js';
import type { PluginContext } from '../../src/plugins/types.js';
import { registerGoalsWebRoutes } from './web.js';

export interface CapturedRoute {
  method: 'GET' | 'POST';
  path: string;
  handler: PluginRouteHandler;
}

export function captureRoutes(): CapturedRoute[] {
  const routes: CapturedRoute[] = [];
  const router: PluginRouter = {
    pluginName: 'goals',
    get(path, handler) {
      routes.push({ method: 'GET', path, handler });
    },
    post(path, handler) {
      routes.push({ method: 'POST', path, handler });
    },
  };
  registerGoalsWebRoutes(router);
  return routes;
}

export function routeFor(
  routes: CapturedRoute[],
  method: 'GET' | 'POST',
  path: string
): PluginRouteHandler {
  const found = routes.find((route) => route.method === method && route.path === path);
  if (!found) throw new Error(`no ${method} route registered for ${path}`);
  return found.handler;
}

export interface FakeRes {
  statusCode: number;
  body: string | null;
  /** Payload captured from res.json(), or null when the route redirected. */
  jsonBody: Record<string, unknown> | null;
  redirected: string | null;
  contentType: string | null;
  locals: Record<string, unknown>;
  status(code: number): FakeRes;
  send(body: string): FakeRes;
  json(payload: Record<string, unknown>): FakeRes;
  type(value: string): FakeRes;
  redirect(status: number | string, target?: string): FakeRes;
}

export function makeRes(locals: Record<string, unknown> = {}): FakeRes {
  const res: FakeRes = {
    statusCode: 200,
    body: null,
    jsonBody: null,
    redirected: null,
    contentType: null,
    locals,
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(value) {
      this.body = value;
      return this;
    },
    json(payload) {
      this.jsonBody = payload;
      return this;
    },
    type(value) {
      this.contentType = value;
      return this;
    },
    redirect(status, target) {
      if (typeof status === 'number') {
        this.statusCode = status;
        this.redirected = target ?? null;
      } else {
        this.statusCode = 302;
        this.redirected = status;
      }
      return this;
    },
  };

  return res;
}

export interface FakeReqOptions {
  params?: Record<string, string>;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
  accept?: string;
}

export function makeReq(options: FakeReqOptions = {}): Request {
  return {
    params: options.params ?? {},
    query: options.query ?? {},
    body: options.body ?? {},
    get: (header: string) =>
      header.toLowerCase() === 'accept' ? (options.accept ?? '') : undefined,
  } as unknown as Request;
}

/** A JSON-flavoured request: what the client script sends. */
export function makeAjaxReq(body: Record<string, unknown>): Request {
  return makeReq({ body: { ...body, ajax: '1' }, accept: 'application/json' });
}

export type Invoke = (
  method: 'GET' | 'POST',
  path: string,
  req: Request,
  res: FakeRes,
  ctx: PluginContext
) => Promise<void>;

export function makeInvoker(routes: CapturedRoute[]): Invoke {
  return async (method, path, req, res, ctx) => {
    await routeFor(routes, method, path)(req, res as unknown as Response, ctx);
  };
}

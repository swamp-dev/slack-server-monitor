import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { PluginContext } from '../../src/plugins/types.js';
import { makeTestDb, makeMockContext, type TestDb } from './test-support.js';
import { captureRoutes, makeReq, makeRes, makeInvoker, type Invoke } from './route-support.js';
import { createBoard } from './boards.js';
import { createColumn } from './columns.js';
import { createCard } from './cards.js';

describe('goals read routes', () => {
  let t: TestDb;
  let ctx: PluginContext;
  let invoke: Invoke;
  let boardId: number;
  let cardId: number;

  beforeEach(() => {
    t = makeTestDb();
    ctx = makeMockContext(t.db);
    invoke = makeInvoker(captureRoutes());

    const board = createBoard(t.db, {
      title: 'Family goals',
      ownerId: 'web:andy',
      withDefaultColumns: false,
    });
    boardId = board.id;
    const todo = createColumn(t.db, { boardId, name: 'Todo' });
    cardId = createCard(t.db, { columnId: todo.id, title: 'Learn to sail', createdBy: 'web:andy' }).id;
  });

  afterEach(() => {
    t.close();
  });

  const owner = { userId: 'web:andy', isAdmin: false };
  const stranger = { userId: 'U999', isAdmin: false };

  describe('registration', () => {
    it('registers only GET and POST routes', () => {
      const routes = captureRoutes();
      expect(routes.length).toBeGreaterThan(0);
      expect(routes.every((route) => route.method === 'GET' || route.method === 'POST')).toBe(true);
    });

    it('does not register the auto-mounted SSE endpoint', () => {
      expect(captureRoutes().some((route) => route.path === '/stream')).toBe(false);
    });
  });

  describe('GET /', () => {
    it('renders the board index for a signed-in visitor', async () => {
      const res = makeRes(owner);
      await invoke('GET', '/', makeReq(), res, ctx);

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('Family goals');
      expect(res.body).toContain('<!DOCTYPE html>');
    });

    it('refuses an unauthenticated visitor', async () => {
      const res = makeRes({});
      await invoke('GET', '/', makeReq(), res, ctx);

      expect(res.statusCode).toBe(303);
    });

    it('surfaces an error passed back on the redirect', async () => {
      const res = makeRes(owner);
      await invoke('GET', '/', makeReq({ query: { err: 'Give the board a name' } }), res, ctx);

      expect(res.body).toContain('Give the board a name');
    });

    it('escapes an error message from the query string', async () => {
      const res = makeRes(owner);
      await invoke('GET', '/', makeReq({ query: { err: '<img src=x onerror=1>' } }), res, ctx);

      expect(res.body).not.toContain('<img src=x onerror=1>');
    });
  });

  describe('GET /b/:boardId', () => {
    it('renders the board with its client script', async () => {
      const res = makeRes(owner);
      await invoke('GET', '/b/:boardId', makeReq({ params: { boardId: String(boardId) } }), res, ctx);

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('Learn to sail');
      expect(res.body).toContain(`var BOARD_ID = ${String(boardId)};`);
      expect(res.body).toContain('goals-region');
    });

    it('404s an unknown board', async () => {
      const res = makeRes(owner);
      await invoke('GET', '/b/:boardId', makeReq({ params: { boardId: '999' } }), res, ctx);

      expect(res.statusCode).toBe(404);
    });

    it('404s a non-numeric id', async () => {
      const res = makeRes(owner);
      await invoke('GET', '/b/:boardId', makeReq({ params: { boardId: '1abc' } }), res, ctx);

      expect(res.statusCode).toBe(404);
    });

    it('hides a private board behind the same 404, not a 403', async () => {
      const priv = createBoard(t.db, {
        title: 'Andy only',
        ownerId: 'web:andy',
        visibility: 'private',
        withDefaultColumns: false,
      });

      const res = makeRes(stranger);
      await invoke('GET', '/b/:boardId', makeReq({ params: { boardId: String(priv.id) } }), res, ctx);

      // A 403 here would confirm the board exists.
      expect(res.statusCode).toBe(404);
      expect(res.body).not.toContain('Andy only');
    });
  });

  describe('GET /b/:boardId/fragment', () => {
    it('returns the columns region without the page shell', async () => {
      const res = makeRes(owner);
      await invoke(
        'GET',
        '/b/:boardId/fragment',
        makeReq({ params: { boardId: String(boardId) } }),
        res,
        ctx
      );

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('goals-board');
      expect(res.body).toContain('Learn to sail');
      expect(res.body).not.toContain('<!DOCTYPE html>');
      expect(res.body).not.toContain('goals-region');
    });

    it('returns an empty 404 for a board the visitor cannot see', async () => {
      const priv = createBoard(t.db, {
        title: 'Secret',
        ownerId: 'web:andy',
        visibility: 'private',
        withDefaultColumns: false,
      });

      const res = makeRes(stranger);
      await invoke(
        'GET',
        '/b/:boardId/fragment',
        makeReq({ params: { boardId: String(priv.id) } }),
        res,
        ctx
      );

      expect(res.statusCode).toBe(404);
      expect(res.body).toBe('');
    });
  });

  describe('GET /card/:cardId', () => {
    it('renders the permalink page', async () => {
      const res = makeRes(owner);
      await invoke('GET', '/card/:cardId', makeReq({ params: { cardId: String(cardId) } }), res, ctx);

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('Learn to sail');
      expect(res.body).toContain('<!DOCTYPE html>');
    });

    it('404s a card on a board the visitor cannot see', async () => {
      const priv = createBoard(t.db, {
        title: 'Secret',
        ownerId: 'web:andy',
        visibility: 'private',
        withDefaultColumns: false,
      });
      const column = createColumn(t.db, { boardId: priv.id, name: 'Todo' });
      const hidden = createCard(t.db, { columnId: column.id, title: 'Hidden', createdBy: 'web:andy' });

      const res = makeRes(stranger);
      await invoke(
        'GET',
        '/card/:cardId',
        makeReq({ params: { cardId: String(hidden.id) } }),
        res,
        ctx
      );

      expect(res.statusCode).toBe(404);
      expect(res.body).not.toContain('Hidden');
    });
  });

  describe('GET /card/:cardId/fragment', () => {
    it('returns the detail body only', async () => {
      const res = makeRes(owner);
      await invoke(
        'GET',
        '/card/:cardId/fragment',
        makeReq({ params: { cardId: String(cardId) } }),
        res,
        ctx
      );

      expect(res.body).toContain('goals-card-form');
      expect(res.body).not.toContain('<!DOCTYPE html>');
    });
  });

  describe('GET /members', () => {
    it('renders the roster', async () => {
      const res = makeRes(owner);
      await invoke('GET', '/members', makeReq(), res, ctx);

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('People');
      expect(res.body).toContain('action="/p/goals/members/create"');
    });
  });
});

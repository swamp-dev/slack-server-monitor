import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { PluginContext } from '../../src/plugins/types.js';
import { makeTestDb, makeMockContext, cardOrder, type TestDb } from './test-support.js';
import { captureRoutes, makeReq, makeAjaxReq, makeRes, makeInvoker, type Invoke } from './route-support.js';
import { createBoard } from './boards.js';
import { createColumn } from './columns.js';
import { createCard, getCard } from './cards.js';

const owner = { userId: 'web:andy', isAdmin: false };
const stranger = { userId: 'U999', isAdmin: false };

describe('POST /cards/move', () => {
  let t: TestDb;
  let ctx: PluginContext;
  let invoke: Invoke;
  let boardId: number;
  let todoId: number;
  let doingId: number;
  let cards: number[];

  beforeEach(() => {
    t = makeTestDb();
    ctx = makeMockContext(t.db);
    invoke = makeInvoker(captureRoutes());

    const board = createBoard(t.db, {
      title: 'Family',
      ownerId: 'web:andy',
      withDefaultColumns: false,
    });
    boardId = board.id;
    todoId = createColumn(t.db, { boardId, name: 'Todo' }).id;
    doingId = createColumn(t.db, { boardId, name: 'Doing' }).id;

    cards = ['A', 'B', 'C'].map(
      (title) => createCard(t.db, { columnId: todoId, title, createdBy: 'web:andy' }).id
    );
  });

  afterEach(() => {
    t.close();
  });

  it('moves the card and reports where it landed', async () => {
    const res = makeRes(owner);
    await invoke(
      'POST',
      '/cards/move',
      makeAjaxReq({ cardId: cards[0], toColumnId: doingId, toIndex: 0 }),
      res,
      ctx
    );

    expect(res.jsonBody).toEqual({
      ok: true,
      fromColumnId: todoId,
      toColumnId: doingId,
      toIndex: 0,
    });
    expect(cardOrder(t, doingId)).toEqual([cards[0]]);
    expect(cardOrder(t, todoId)).toEqual([cards[1], cards[2]]);
  });

  it('reorders within a column', async () => {
    const res = makeRes(owner);
    await invoke(
      'POST',
      '/cards/move',
      makeAjaxReq({ cardId: cards[0], toColumnId: todoId, toIndex: 2 }),
      res,
      ctx
    );

    expect(cardOrder(t, todoId)).toEqual([cards[1], cards[2], cards[0]]);
  });

  it('clamps an index past the end rather than rejecting it', async () => {
    const res = makeRes(owner);
    await invoke(
      'POST',
      '/cards/move',
      makeAjaxReq({ cardId: cards[0], toColumnId: doingId, toIndex: 99 }),
      res,
      ctx
    );

    expect(res.jsonBody?.toIndex).toBe(0);
  });

  it('echoes the caller client id so it can ignore its own update', async () => {
    const res = makeRes(owner);
    await invoke(
      'POST',
      '/cards/move',
      makeAjaxReq({ cardId: cards[0], toColumnId: doingId, toIndex: 0, clientId: 'ab12cd34' }),
      res,
      ctx
    );

    expect(ctx.sse.broadcast).toHaveBeenCalledWith('board-changed', {
      boardId,
      originId: 'ab12cd34',
      kind: 'cards',
    });
  });

  it('drops a malformed client id rather than echoing it back', async () => {
    const res = makeRes(owner);
    await invoke(
      'POST',
      '/cards/move',
      makeAjaxReq({ cardId: cards[0], toColumnId: doingId, toIndex: 0, clientId: '<script>' }),
      res,
      ctx
    );

    expect(ctx.sse.broadcast).toHaveBeenCalledWith(
      'board-changed',
      expect.objectContaining({ originId: '' })
    );
  });

  it('does not broadcast when nobody is listening', async () => {
    const quiet = makeMockContext(t.db, 0);
    const res = makeRes(owner);
    await invoke(
      'POST',
      '/cards/move',
      makeAjaxReq({ cardId: cards[0], toColumnId: doingId, toIndex: 0 }),
      res,
      quiet
    );

    expect(quiet.sse.broadcast).not.toHaveBeenCalled();
    expect(res.jsonBody?.ok).toBe(true);
  });

  describe('rejections', () => {
    it('400s a non-integer index', async () => {
      const res = makeRes(owner);
      await invoke(
        'POST',
        '/cards/move',
        makeAjaxReq({ cardId: cards[0], toColumnId: doingId, toIndex: 'first' }),
        res,
        ctx
      );

      expect(res.statusCode).toBe(400);
      expect(res.jsonBody?.ok).toBe(false);
      expect(cardOrder(t, todoId)).toEqual(cards);
    });

    it('400s a missing card id', async () => {
      const res = makeRes(owner);
      await invoke('POST', '/cards/move', makeAjaxReq({ toColumnId: doingId, toIndex: 0 }), res, ctx);

      expect(res.statusCode).toBe(400);
    });

    it('404s an unknown card', async () => {
      const res = makeRes(owner);
      await invoke(
        'POST',
        '/cards/move',
        makeAjaxReq({ cardId: 999, toColumnId: doingId, toIndex: 0 }),
        res,
        ctx
      );

      expect(res.statusCode).toBe(404);
    });

    it('409s a column on another board', async () => {
      const other = createBoard(t.db, {
        title: 'Other',
        ownerId: 'web:andy',
        withDefaultColumns: false,
      });
      const foreign = createColumn(t.db, { boardId: other.id, name: 'Foreign' });

      const res = makeRes(owner);
      await invoke(
        'POST',
        '/cards/move',
        makeAjaxReq({ cardId: cards[0], toColumnId: foreign.id, toIndex: 0 }),
        res,
        ctx
      );

      expect(res.statusCode).toBe(409);
      expect(res.jsonBody?.code).toBe('CROSS_BOARD');
      expect(getCard(t.db, cards[0]!)?.columnId).toBe(todoId);
    });

    it('404s a card on a private board the caller cannot see', async () => {
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
        'POST',
        '/cards/move',
        makeAjaxReq({ cardId: hidden.id, toColumnId: column.id, toIndex: 0 }),
        res,
        ctx
      );

      expect(res.statusCode).toBe(404);
    });

    it('401s an unauthenticated caller', async () => {
      const res = makeRes({});
      await invoke(
        'POST',
        '/cards/move',
        makeAjaxReq({ cardId: cards[0], toColumnId: doingId, toIndex: 0 }),
        res,
        ctx
      );

      expect(res.statusCode).toBe(401);
      expect(cardOrder(t, todoId)).toEqual(cards);
    });

    it('lets anyone who can see a shared board move its cards', async () => {
      const res = makeRes(stranger);
      await invoke(
        'POST',
        '/cards/move',
        makeAjaxReq({ cardId: cards[0], toColumnId: doingId, toIndex: 0 }),
        res,
        ctx
      );

      expect(res.jsonBody?.ok).toBe(true);
    });
  });

  describe('response shape', () => {
    it('redirects instead of returning JSON for a plain form post', async () => {
      const res = makeRes(owner);
      await invoke(
        'POST',
        '/cards/move',
        makeReq({ body: { cardId: cards[0], toColumnId: doingId, toIndex: 0 } }),
        res,
        ctx
      );

      expect(res.statusCode).toBe(303);
      expect(res.redirected).toBe(`/p/goals/b/${String(boardId)}`);
      expect(res.jsonBody).toBeNull();
    });

    it('redirects with the message when a form post fails', async () => {
      const res = makeRes(owner);
      await invoke(
        'POST',
        '/cards/move',
        makeReq({ body: { cardId: 999, toColumnId: doingId, toIndex: 0 } }),
        res,
        ctx
      );

      expect(res.statusCode).toBe(303);
      expect(res.redirected).toContain('err=');
    });
  });

  it('leaves positions dense after a sequence of moves', async () => {
    const run = async (cardId: number, toColumnId: number, toIndex: number) => {
      await invoke('POST', '/cards/move', makeAjaxReq({ cardId, toColumnId, toIndex }), makeRes(owner), ctx);
    };

    await run(cards[0]!, doingId, 0);
    await run(cards[2]!, doingId, 0);
    await run(cards[1]!, doingId, 1);

    expect(cardOrder(t, todoId)).toEqual([]);
    expect(cardOrder(t, doingId)).toEqual([cards[2], cards[1], cards[0]]);
    const positions = t.raw
      .prepare(`SELECT position FROM ${t.db.prefix}cards WHERE column_id = ? ORDER BY position`)
      .all(doingId) as { position: number }[];
    expect(positions.map((p) => p.position)).toEqual([0, 1, 2]);
  });

  it('does not notify anyone about a move', async () => {
    await invoke(
      'POST',
      '/cards/move',
      makeAjaxReq({ cardId: cards[0], toColumnId: doingId, toIndex: 0 }),
      makeRes(owner),
      ctx
    );

    expect(ctx.notify).not.toHaveBeenCalled();
    expect(vi.isMockFunction(ctx.notify)).toBe(true);
  });
});

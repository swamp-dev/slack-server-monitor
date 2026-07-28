import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { PluginContext } from '../../src/plugins/types.js';
import { makeTestDb, makeMockContext, cardOrder, columnOrder, type TestDb } from './test-support.js';
import { captureRoutes, makeReq, makeAjaxReq, makeRes, makeInvoker, type Invoke } from './route-support.js';
import { getBoard, createBoard } from './boards.js';
import { listColumns, getColumn, createColumn } from './columns.js';
import { getCard, createCard } from './cards.js';
import { listComments, createComment } from './comments.js';
import { listMembers, getMember, createMember, setMemberArchived } from './members.js';

const owner = { userId: 'web:andy', isAdmin: false };
const stranger = { userId: 'U999', isAdmin: false };
const admin = { userId: 'admin', isAdmin: true };

describe('goals mutation routes', () => {
  let t: TestDb;
  let ctx: PluginContext;
  let invoke: Invoke;
  let boardId: number;
  let todoId: number;
  let doneId: number;
  let cardId: number;

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
    doneId = createColumn(t.db, { boardId, name: 'Done', isDone: true }).id;
    cardId = createCard(t.db, { columnId: todoId, title: 'Learn to sail', createdBy: 'web:andy' }).id;
  });

  afterEach(() => {
    t.close();
  });

  describe('boards', () => {
    it('creates a board owned by the caller', async () => {
      const res = makeRes(owner);
      await invoke('POST', '/boards/create', makeAjaxReq({ title: 'Summer' }), res, ctx);

      expect(res.jsonBody?.ok).toBe(true);
      const created = getBoard(t.db, res.jsonBody?.boardId as number);
      expect(created?.title).toBe('Summer');
      expect(created?.ownerId).toBe('web:andy');
      expect(listColumns(t.db, created!.id).length).toBeGreaterThan(0);
    });

    it('400s a board with no name', async () => {
      const res = makeRes(owner);
      await invoke('POST', '/boards/create', makeAjaxReq({ title: '   ' }), res, ctx);

      expect(res.statusCode).toBe(400);
    });

    it('400s an unknown visibility', async () => {
      const res = makeRes(owner);
      await invoke(
        'POST',
        '/boards/create',
        makeAjaxReq({ title: 'Public board', visibility: 'public' }),
        res,
        ctx
      );

      expect(res.statusCode).toBe(400);
    });

    it('renames a board for its owner', async () => {
      const res = makeRes(owner);
      await invoke('POST', '/boards/update', makeAjaxReq({ boardId, title: 'Renamed' }), res, ctx);

      expect(getBoard(t.db, boardId)?.title).toBe('Renamed');
    });

    it('403s a rename by someone who is not the owner', async () => {
      const res = makeRes(stranger);
      await invoke('POST', '/boards/update', makeAjaxReq({ boardId, title: 'Mine now' }), res, ctx);

      expect(res.statusCode).toBe(403);
      expect(getBoard(t.db, boardId)?.title).toBe('Family');
    });

    it('lets an app admin administer any board', async () => {
      const res = makeRes(admin);
      await invoke('POST', '/boards/update', makeAjaxReq({ boardId, title: 'Tidied' }), res, ctx);

      expect(res.jsonBody?.ok).toBe(true);
    });

    it('refuses to delete a board without the typed confirmation', async () => {
      const res = makeRes(owner);
      await invoke('POST', '/boards/delete', makeAjaxReq({ boardId, confirm: 'Famly' }), res, ctx);

      expect(res.statusCode).toBe(400);
      expect(getBoard(t.db, boardId)).not.toBeNull();
    });

    it('deletes a board when the name matches', async () => {
      const res = makeRes(owner);
      await invoke('POST', '/boards/delete', makeAjaxReq({ boardId, confirm: 'Family' }), res, ctx);

      expect(res.jsonBody?.ok).toBe(true);
      expect(getBoard(t.db, boardId)).toBeNull();
      expect(ctx.sse.broadcast).toHaveBeenCalledWith('boards-changed', expect.anything());
    });
  });

  describe('columns', () => {
    it('adds a column for a board admin', async () => {
      const res = makeRes(owner);
      await invoke(
        'POST',
        '/columns/create',
        makeAjaxReq({ boardId, name: 'Doing', color: '#06b6d4' }),
        res,
        ctx
      );

      const created = getColumn(t.db, res.jsonBody?.columnId as number);
      expect(created?.name).toBe('Doing');
      expect(created?.color).toBe('#06b6d4');
      expect(ctx.sse.broadcast).toHaveBeenCalledWith(
        'board-changed',
        expect.objectContaining({ kind: 'columns' })
      );
    });

    it('403s a column added by a non-admin on a shared board', async () => {
      const res = makeRes(stranger);
      await invoke('POST', '/columns/create', makeAjaxReq({ boardId, name: 'Mine' }), res, ctx);

      expect(res.statusCode).toBe(403);
      expect(listColumns(t.db, boardId)).toHaveLength(2);
    });

    it('400s an invalid card limit', async () => {
      const res = makeRes(owner);
      await invoke(
        'POST',
        '/columns/create',
        makeAjaxReq({ boardId, name: 'Doing', wipLimit: 'lots' }),
        res,
        ctx
      );

      expect(res.statusCode).toBe(400);
    });

    it('treats an empty card limit as no limit', async () => {
      const res = makeRes(owner);
      await invoke(
        'POST',
        '/columns/create',
        makeAjaxReq({ boardId, name: 'Doing', wipLimit: '' }),
        res,
        ctx
      );

      expect(getColumn(t.db, res.jsonBody?.columnId as number)?.wipLimit).toBeNull();
    });

    it('renames a column', async () => {
      const res = makeRes(owner);
      await invoke(
        'POST',
        '/columns/update',
        makeAjaxReq({ columnId: todoId, name: 'Backlog' }),
        res,
        ctx
      );

      expect(getColumn(t.db, todoId)?.name).toBe('Backlog');
    });

    it('409s deleting the last column', async () => {
      const solo = createBoard(t.db, {
        title: 'Solo',
        ownerId: 'web:andy',
        withDefaultColumns: false,
      });
      const only = createColumn(t.db, { boardId: solo.id, name: 'Only' });

      const res = makeRes(owner);
      await invoke(
        'POST',
        '/columns/delete',
        makeAjaxReq({ columnId: only.id, mode: 'delete', expectedCardCount: 0 }),
        res,
        ctx
      );

      expect(res.statusCode).toBe(409);
      expect(res.jsonBody?.code).toBe('LAST_COLUMN');
    });

    it('409s a stale card count', async () => {
      const res = makeRes(owner);
      await invoke(
        'POST',
        '/columns/delete',
        makeAjaxReq({ columnId: todoId, mode: 'delete', expectedCardCount: 0 }),
        res,
        ctx
      );

      expect(res.statusCode).toBe(409);
      expect(res.jsonBody?.code).toBe('COUNT_MISMATCH');
      expect(getCard(t.db, cardId)).not.toBeNull();
    });

    it('400s a delete with no mode', async () => {
      const res = makeRes(owner);
      await invoke(
        'POST',
        '/columns/delete',
        makeAjaxReq({ columnId: todoId, expectedCardCount: 1 }),
        res,
        ctx
      );

      expect(res.statusCode).toBe(400);
      expect(getColumn(t.db, todoId)).not.toBeNull();
    });

    it('moves the cards out when asked to', async () => {
      const res = makeRes(owner);
      await invoke(
        'POST',
        '/columns/delete',
        makeAjaxReq({
          columnId: todoId,
          mode: 'move',
          targetColumnId: doneId,
          expectedCardCount: 1,
        }),
        res,
        ctx
      );

      expect(res.jsonBody?.moved).toBe(1);
      expect(getCard(t.db, cardId)?.columnId).toBe(doneId);
      expect(columnOrder(t, boardId)).toEqual([doneId]);
    });

    it('deletes the cards when asked to', async () => {
      const res = makeRes(owner);
      await invoke(
        'POST',
        '/columns/delete',
        makeAjaxReq({ columnId: todoId, mode: 'delete', expectedCardCount: 1 }),
        res,
        ctx
      );

      expect(res.jsonBody?.deleted).toBe(1);
      expect(getCard(t.db, cardId)).toBeNull();
    });
  });

  describe('cards', () => {
    it('creates a card recording who added it', async () => {
      const res = makeRes(owner);
      await invoke(
        'POST',
        '/cards/create',
        makeAjaxReq({ columnId: todoId, title: 'Book the ferry' }),
        res,
        ctx
      );

      const created = getCard(t.db, res.jsonBody?.cardId as number);
      expect(created?.title).toBe('Book the ferry');
      expect(created?.createdBy).toBe('web:andy');
      expect(cardOrder(t, todoId)).toEqual([cardId, created!.id]);
    });

    it('lets anyone who can see a shared board add a card', async () => {
      const res = makeRes(stranger);
      await invoke('POST', '/cards/create', makeAjaxReq({ columnId: todoId, title: 'Mine' }), res, ctx);

      expect(res.jsonBody?.ok).toBe(true);
    });

    it('400s an invalid due date', async () => {
      const res = makeRes(owner);
      await invoke(
        'POST',
        '/cards/create',
        makeAjaxReq({ columnId: todoId, title: 'Card', dueDate: '2026-02-31' }),
        res,
        ctx
      );

      expect(res.statusCode).toBe(400);
      expect(res.jsonBody?.error).toContain('2026-08-01');
    });

    it('400s an assignee who is not on the roster', async () => {
      const res = makeRes(owner);
      await invoke(
        'POST',
        '/cards/create',
        makeAjaxReq({ columnId: todoId, title: 'Card', assigneeId: 999 }),
        res,
        ctx
      );

      expect(res.statusCode).toBe(400);
    });

    it('updates only the fields sent', async () => {
      const res = makeRes(owner);
      await invoke('POST', '/cards/update', makeAjaxReq({ cardId, title: 'Learn to sail well' }), res, ctx);

      const updated = getCard(t.db, cardId);
      expect(updated?.title).toBe('Learn to sail well');
      expect(updated?.columnId).toBe(todoId);
    });

    it('clears the assignee and due date when sent empty', async () => {
      const member = createMember(t.db, { displayName: 'Ada', color: '#7c3aed', identity: null });
      await invoke(
        'POST',
        '/cards/update',
        makeAjaxReq({ cardId, assigneeId: member.id, dueDate: '2026-08-01' }),
        makeRes(owner),
        ctx
      );

      await invoke(
        'POST',
        '/cards/update',
        makeAjaxReq({ cardId, assigneeId: '', dueDate: '' }),
        makeRes(owner),
        ctx
      );

      const updated = getCard(t.db, cardId);
      expect(updated?.assigneeId).toBeNull();
      expect(updated?.dueDate).toBeNull();
    });

    it('notifies the person a goal was handed to', async () => {
      const ada = createMember(t.db, { displayName: 'Ada', color: '#7c3aed', identity: 'web:ada' });

      await invoke(
        'POST',
        '/cards/update',
        makeAjaxReq({ cardId, assigneeId: ada.id }),
        makeRes(owner),
        ctx
      );

      expect(ctx.notify).toHaveBeenCalledWith(
        'Ada was given a goal',
        expect.objectContaining({ body: 'Learn to sail' })
      );
    });

    it('does not notify you about your own goal', async () => {
      const andy = createMember(t.db, { displayName: 'Andy', color: '#7c3aed', identity: 'web:andy' });

      await invoke(
        'POST',
        '/cards/update',
        makeAjaxReq({ cardId, assigneeId: andy.id }),
        makeRes(owner),
        ctx
      );

      expect(ctx.notify).not.toHaveBeenCalled();
    });

    it('archives and restores a card', async () => {
      await invoke('POST', '/cards/archive', makeAjaxReq({ cardId, archived: '1' }), makeRes(owner), ctx);
      expect(getCard(t.db, cardId)?.archived).toBe(true);

      await invoke('POST', '/cards/archive', makeAjaxReq({ cardId, archived: '0' }), makeRes(owner), ctx);
      expect(getCard(t.db, cardId)?.archived).toBe(false);
    });

    it('400s an archive flag it does not understand', async () => {
      const res = makeRes(owner);
      await invoke('POST', '/cards/archive', makeAjaxReq({ cardId, archived: 'maybe' }), res, ctx);

      expect(res.statusCode).toBe(400);
    });

    it('deletes a card and its comments', async () => {
      createComment(t.db, { cardId, authorId: 'web:andy', body: 'bye' });

      const res = makeRes(owner);
      await invoke('POST', '/cards/delete', makeAjaxReq({ cardId }), res, ctx);

      expect(getCard(t.db, cardId)).toBeNull();
      expect(listComments(t.db, cardId)).toEqual([]);
    });
  });

  describe('comments', () => {
    it('records the author from the session, not the request', async () => {
      const res = makeRes(stranger);
      await invoke(
        'POST',
        '/comments/create',
        makeAjaxReq({ cardId, body: 'Nice idea', authorId: 'web:andy' }),
        res,
        ctx
      );

      const [comment] = listComments(t.db, cardId);
      expect(comment?.authorId).toBe('U999');
      expect(comment?.body).toBe('Nice idea');
    });

    it('400s an empty comment', async () => {
      const res = makeRes(owner);
      await invoke('POST', '/comments/create', makeAjaxReq({ cardId, body: '   ' }), res, ctx);

      expect(res.statusCode).toBe(400);
    });

    it('keeps newlines in a comment', async () => {
      await invoke(
        'POST',
        '/comments/create',
        makeAjaxReq({ cardId, body: 'one\ntwo' }),
        makeRes(owner),
        ctx
      );

      expect(listComments(t.db, cardId)[0]?.body).toBe('one\ntwo');
    });

    it('lets the author delete their comment', async () => {
      const comment = createComment(t.db, { cardId, authorId: 'web:andy', body: 'mine' });

      const res = makeRes(owner);
      await invoke('POST', '/comments/delete', makeAjaxReq({ commentId: comment.id }), res, ctx);

      expect(listComments(t.db, cardId)).toEqual([]);
    });

    it('403s someone else deleting it, but allows an admin', async () => {
      const comment = createComment(t.db, { cardId, authorId: 'web:andy', body: 'mine' });

      const denied = makeRes(stranger);
      await invoke('POST', '/comments/delete', makeAjaxReq({ commentId: comment.id }), denied, ctx);
      expect(denied.statusCode).toBe(403);
      expect(listComments(t.db, cardId)).toHaveLength(1);

      const allowed = makeRes(admin);
      await invoke('POST', '/comments/delete', makeAjaxReq({ commentId: comment.id }), allowed, ctx);
      expect(listComments(t.db, cardId)).toEqual([]);
    });
  });

  describe('members', () => {
    it('adds someone with no linked account', async () => {
      const res = makeRes(owner);
      await invoke('POST', '/members/create', makeAjaxReq({ name: 'Robin' }), res, ctx);

      const member = getMember(t.db, res.jsonBody?.memberId as number);
      expect(member?.displayName).toBe('Robin');
      expect(member?.identity).toBeNull();
      expect(ctx.sse.broadcast).toHaveBeenCalledWith('members-changed', expect.anything());
    });

    it('400s a malformed account identity', async () => {
      const res = makeRes(owner);
      await invoke(
        'POST',
        '/members/create',
        makeAjaxReq({ name: 'Robin', identity: 'robin smith' }),
        res,
        ctx
      );

      expect(res.statusCode).toBe(400);
      expect(listMembers(t.db)).toEqual([]);
    });

    it('409s a duplicate account identity', async () => {
      createMember(t.db, { displayName: 'Ada', color: '#7c3aed', identity: 'U123' });

      const res = makeRes(owner);
      await invoke(
        'POST',
        '/members/create',
        makeAjaxReq({ name: 'Impostor', identity: 'U123' }),
        res,
        ctx
      );

      expect(res.statusCode).toBe(409);
      expect(res.jsonBody?.code).toBe('IDENTITY_TAKEN');
    });

    it('falls back to a default colour rather than rejecting a bad one', async () => {
      const res = makeRes(owner);
      await invoke('POST', '/members/create', makeAjaxReq({ name: 'Robin', color: 'red' }), res, ctx);

      expect(getMember(t.db, res.jsonBody?.memberId as number)?.color).toBe('#06b6d4');
    });

    it('lets anyone signed in fix a name or colour', async () => {
      const member = createMember(t.db, { displayName: 'Robn', color: '#7c3aed', identity: null });

      const res = makeRes(stranger);
      await invoke(
        'POST',
        '/members/update',
        makeAjaxReq({ memberId: member.id, name: 'Robin' }),
        res,
        ctx
      );

      expect(res.jsonBody?.ok).toBe(true);
      expect(getMember(t.db, member.id)?.displayName).toBe('Robin');
    });

    it('403s a non-admin relinking someone to a different account', async () => {
      const member = createMember(t.db, {
        displayName: 'Ada',
        color: '#7c3aed',
        identity: 'web:ada',
      });

      const res = makeRes(stranger);
      await invoke(
        'POST',
        '/members/update',
        makeAjaxReq({ memberId: member.id, identity: 'U999' }),
        res,
        ctx
      );

      // Relinking decides whose /goals add auto-assigns to this member.
      expect(res.statusCode).toBe(403);
      expect(getMember(t.db, member.id)?.identity).toBe('web:ada');
    });

    it('403s a non-admin unlinking an account', async () => {
      const member = createMember(t.db, {
        displayName: 'Ada',
        color: '#7c3aed',
        identity: 'web:ada',
      });

      const res = makeRes(stranger);
      await invoke(
        'POST',
        '/members/update',
        makeAjaxReq({ memberId: member.id, identity: '' }),
        res,
        ctx
      );

      expect(res.statusCode).toBe(403);
      expect(getMember(t.db, member.id)?.identity).toBe('web:ada');
    });

    it('lets an admin relink someone', async () => {
      const member = createMember(t.db, {
        displayName: 'Ada',
        color: '#7c3aed',
        identity: 'web:ada',
      });

      const res = makeRes(admin);
      await invoke(
        'POST',
        '/members/update',
        makeAjaxReq({ memberId: member.id, identity: 'U777' }),
        res,
        ctx
      );

      expect(res.jsonBody?.ok).toBe(true);
      expect(getMember(t.db, member.id)?.identity).toBe('U777');
    });

    it('allows a non-admin update that resends the unchanged identity', async () => {
      const member = createMember(t.db, {
        displayName: 'Ada',
        color: '#7c3aed',
        identity: 'web:ada',
      });

      const res = makeRes(stranger);
      await invoke(
        'POST',
        '/members/update',
        makeAjaxReq({ memberId: member.id, name: 'Ada L', identity: 'web:ada' }),
        res,
        ctx
      );

      expect(res.jsonBody?.ok).toBe(true);
      expect(getMember(t.db, member.id)?.displayName).toBe('Ada L');
    });

    it('archives and restores someone', async () => {
      const member = createMember(t.db, { displayName: 'Ada', color: '#7c3aed', identity: null });

      await invoke(
        'POST',
        '/members/archive',
        makeAjaxReq({ memberId: member.id, archived: '1' }),
        makeRes(owner),
        ctx
      );
      expect(getMember(t.db, member.id)?.archived).toBe(true);

      await invoke(
        'POST',
        '/members/archive',
        makeAjaxReq({ memberId: member.id, archived: '0' }),
        makeRes(owner),
        ctx
      );
      expect(getMember(t.db, member.id)?.archived).toBe(false);
    });

    it('403s a hard delete by a non-admin', async () => {
      const member = createMember(t.db, { displayName: 'Ada', color: '#7c3aed', identity: null });
      setMemberArchived(t.db, member.id, true);

      const res = makeRes(owner);
      await invoke('POST', '/members/delete', makeAjaxReq({ memberId: member.id }), res, ctx);

      expect(res.statusCode).toBe(403);
      expect(getMember(t.db, member.id)).not.toBeNull();
    });

    it('409s an admin deleting someone still assigned work', async () => {
      const member = createMember(t.db, { displayName: 'Ada', color: '#7c3aed', identity: null });
      createCard(t.db, {
        columnId: todoId,
        title: 'Theirs',
        createdBy: 'web:andy',
        assigneeId: member.id,
      });

      const res = makeRes(admin);
      await invoke('POST', '/members/delete', makeAjaxReq({ memberId: member.id }), res, ctx);

      expect(res.statusCode).toBe(409);
      expect(res.jsonBody?.code).toBe('IN_USE');
    });

    it('lets an admin delete an unreferenced person', async () => {
      const member = createMember(t.db, { displayName: 'Ada', color: '#7c3aed', identity: null });

      const res = makeRes(admin);
      await invoke('POST', '/members/delete', makeAjaxReq({ memberId: member.id }), res, ctx);

      expect(res.jsonBody?.ok).toBe(true);
      expect(getMember(t.db, member.id)).toBeNull();
    });
  });

  describe('non-JavaScript path', () => {
    it('redirects back to the board after a form post', async () => {
      const res = makeRes(owner);
      await invoke(
        'POST',
        '/cards/create',
        makeReq({ body: { columnId: todoId, title: 'From a form' } }),
        res,
        ctx
      );

      expect(res.statusCode).toBe(303);
      expect(res.redirected).toBe(`/p/goals/b/${String(boardId)}`);
    });

    it('carries the failure message back on the redirect', async () => {
      const res = makeRes(owner);
      await invoke(
        'POST',
        '/cards/create',
        makeReq({ body: { columnId: todoId, title: '' } }),
        res,
        ctx
      );

      expect(res.statusCode).toBe(303);
      expect(res.redirected).toContain('err=Give%20the%20goal%20a%20title');
    });
  });
});

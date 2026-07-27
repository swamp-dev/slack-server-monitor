/**
 * HTTP routes for the goals plugin.
 *
 * The only layer that touches req/res. It validates input, maps GoalsError
 * codes to status codes, and broadcasts to other viewers. All rendering is
 * delegated to the pure view modules, and all persistence to the stores.
 *
 * Reads return HTML — including the dynamic ones, which return fragments rather
 * than JSON. That keeps every bit of escaping on the server, so the client
 * never templates a user-supplied string.
 */
import type { Request, Response } from 'express';
import type { PluginRouter, PluginRouteHandler } from '../../src/web/plugin-router.js';
import type { PluginContext } from '../../src/plugins/types.js';
import type { PluginDatabase } from '../../src/services/plugin-database.js';
import { renderPluginPage, escapeHtml, pluginAlert } from '../../src/web/plugin-helpers.js';
import { logger } from '../../src/utils/logger.js';

import {
  GoalsError,
  isGoalsError,
  type Actor,
  type GoalsErrorCode,
  type Board,
} from './types.js';
import {
  LIMITS,
  parseId,
  parseIndex,
  parseText,
  parseOptionalText,
  parseDueDate,
  parseHexColor,
  parseVisibility,
  parseIdentity,
  parseClientId,
  parseBool,
} from './validation.js';
import { actorFrom, canViewBoard, canEditBoardContent, canAdminBoard, canDeleteComment, canHardDeleteMember } from './access.js';
import { getBoard, createBoard, updateBoard, deleteBoard } from './boards.js';
import { getColumn, createColumn, updateColumn, deleteColumn, countCardsInColumn } from './columns.js';
import { getCard, createCard, updateCard, setCardArchived, deleteCard, moveCard } from './cards.js';
import { getComment, createComment, deleteComment } from './comments.js';
import {
  listMembers,
  getMember,
  createMember,
  updateMember,
  setMemberArchived,
  hardDeleteMember,
} from './members.js';
import { loadBoardView, loadIndexView, loadCardDetail } from './queries.js';
import { GOALS_CSS } from './styles.js';
import { renderBoardPage, renderColumnsRegion } from './view-board.js';
import { renderBoardsIndex } from './view-index.js';
import { renderCardDetail, renderCardPermalink } from './view-card.js';
import { renderMembersPage } from './view-members.js';
import { boardClientJs, INDEX_CLIENT_JS, MEMBERS_CLIENT_JS } from './client-js.js';

const STATUS_BY_CODE: Record<GoalsErrorCode, number> = {
  NOT_FOUND: 404,
  CROSS_BOARD: 409,
  LAST_COLUMN: 409,
  COUNT_MISMATCH: 409,
  IN_USE: 409,
  IDENTITY_TAKEN: 409,
  LIMIT_REACHED: 409,
  INVALID: 400,
};

function body(req: Request): Record<string, unknown> {
  const value: unknown = req.body;
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/** True when the caller wants JSON rather than a redirect. */
function wantsJson(req: Request): boolean {
  if (body(req).ajax === '1') return true;
  return (req.get('accept') ?? '').includes('application/json');
}

export function respondOk(
  req: Request,
  res: Response,
  payload: Record<string, unknown>,
  redirectTo: string
): void {
  if (wantsJson(req)) {
    res.json({ ok: true, ...payload });
    return;
  }
  // POST-redirect-GET, so the no-JS form path survives a refresh.
  res.redirect(303, redirectTo);
}

export function respondErr(
  req: Request,
  res: Response,
  status: number,
  code: string,
  message: string,
  redirectTo: string
): void {
  if (wantsJson(req)) {
    res.status(status).json({ ok: false, code, error: message });
    return;
  }
  const separator = redirectTo.includes('?') ? '&' : '?';
  res.redirect(303, `${redirectTo}${separator}err=${encodeURIComponent(message)}`);
}

/** Turn a thrown GoalsError into the right status, and anything else into a 500. */
function handleFailure(
  req: Request,
  res: Response,
  err: unknown,
  redirectTo: string,
  context: string
): void {
  if (isGoalsError(err)) {
    respondErr(req, res, STATUS_BY_CODE[err.code], err.code, err.message, redirectTo);
    return;
  }
  logger.error('goals route failed', {
    context,
    error: err instanceof Error ? err.message : String(err),
  });
  respondErr(req, res, 500, 'INTERNAL', 'Something went wrong. Try again.', redirectTo);
}

function requireActor(req: Request, res: Response): Actor | null {
  const actor = actorFrom(res);
  if (actor) return actor;

  respondErr(req, res, 401, 'UNAUTHENTICATED', 'Sign in to use goals.', '/p/goals/');
  return null;
}

function sendPage(res: Response, html: string, title: string, scripts: string, status = 200): void {
  res.status(status).type('html').send(
    renderPluginPage({
      title,
      pluginName: 'goals',
      body: html,
      styles: GOALS_CSS,
      scripts,
    })
  );
}

function sendFragment(res: Response, html: string): void {
  res.type('html').send(html);
}

function sendNotice(res: Response, title: string, message: string, status: number): void {
  sendPage(
    res,
    `<div class="goals-root"><div class="goals-empty">` +
      `<p class="goals-empty-title">${escapeHtml(title)}</p>` +
      `<p>${escapeHtml(message)}</p>` +
      `<p style="margin-top:var(--space-4)"><a class="btn btn-primary" href="/p/goals/">All boards</a></p>` +
      `</div></div>`,
    title,
    '',
    status
  );
}

/** Error banner rendered from ?err= on the non-JS path. */
function noticeFrom(req: Request): string {
  const err = req.query.err;
  if (typeof err !== 'string' || err === '') return '';
  return pluginAlert(err.slice(0, 300), { level: 'error', dismissible: true });
}

interface BoardAccess {
  board: Board;
  actor: Actor;
}

/**
 * Resolve a board from the database and check access against it.
 * Never trusts a board id travelling alongside a card or column id.
 */
function requireBoardAccess(
  req: Request,
  res: Response,
  db: PluginDatabase,
  boardId: number,
  level: 'view' | 'edit' | 'admin',
  redirectTo: string
): BoardAccess | null {
  const actor = requireActor(req, res);
  if (!actor) return null;

  const board = getBoard(db, boardId);
  if (!board || !canViewBoard(board, actor)) {
    // Refuse to distinguish "not yours" from "not there" for a board you
    // cannot see — otherwise the 403 is an existence oracle.
    respondErr(req, res, 404, 'NOT_FOUND', 'That board no longer exists', redirectTo);
    return null;
  }

  const allowed =
    level === 'view'
      ? true
      : level === 'edit'
        ? canEditBoardContent(board, actor)
        : canAdminBoard(board, actor);

  if (!allowed) {
    respondErr(req, res, 403, 'FORBIDDEN', 'Only the board owner can change that', redirectTo);
    return null;
  }

  return { board, actor };
}

type ChangeKind = 'cards' | 'columns' | 'board';

function broadcastBoard(ctx: PluginContext, boardId: number, originId: string, kind: ChangeKind): void {
  if (ctx.sse.clientCount() === 0) return;
  ctx.sse.broadcast('board-changed', { boardId, originId, kind });
}

// ── Routes ─────────────────────────────────────────────────────────

export function registerGoalsWebRoutes(router: PluginRouter): void {
  const boardPath = (id: number) => `/p/goals/b/${String(id)}`;

  // --- Board index ---

  const index: PluginRouteHandler = (req, res, ctx) => {
    const actor = requireActor(req, res);
    if (!actor) return;

    sendPage(
      res,
      noticeFrom(req) + renderBoardsIndex(loadIndexView(ctx.db, actor), actor),
      'Goals',
      INDEX_CLIENT_JS
    );
  };

  router.get('/', index);

  // --- Board ---

  router.get('/b/:boardId', (req, res, ctx) => {
    const boardId = parseId(req.params.boardId);
    if (boardId === null) {
      sendNotice(res, 'Board not found', 'That link does not point at a board.', 404);
      return;
    }

    const actor = actorFrom(res);
    const board = actor ? getBoard(ctx.db, boardId) : null;
    if (!actor || !board || !canViewBoard(board, actor)) {
      sendNotice(res, 'Board not found', 'That board no longer exists, or is not shared with you.', 404);
      return;
    }

    const view = loadBoardView(ctx.db, boardId);
    if (!view) {
      sendNotice(res, 'Board not found', 'That board no longer exists.', 404);
      return;
    }

    sendPage(
      res,
      noticeFrom(req) + renderBoardPage(view, actor),
      view.board.title,
      boardClientJs(boardId)
    );
  });

  router.get('/b/:boardId/fragment', (req, res, ctx) => {
    const boardId = parseId(req.params.boardId);
    const actor = actorFrom(res);
    if (boardId === null || !actor) {
      res.status(404).type('html').send('');
      return;
    }

    const view = loadBoardView(ctx.db, boardId);
    if (!view || !canViewBoard(view.board, actor)) {
      res.status(404).type('html').send('');
      return;
    }

    sendFragment(res, renderColumnsRegion(view, actor));
  });

  // --- Card ---

  router.get('/card/:cardId', (req, res, ctx) => {
    const cardId = parseId(req.params.cardId);
    const actor = actorFrom(res);
    if (cardId === null || !actor) {
      sendNotice(res, 'Goal not found', 'That link does not point at a goal.', 404);
      return;
    }

    const detail = loadCardDetail(ctx.db, cardId);
    if (!detail || !canViewBoard(detail.board, actor)) {
      sendNotice(res, 'Goal not found', 'That goal no longer exists, or is on a board you cannot see.', 404);
      return;
    }

    sendPage(res, renderCardPermalink(detail, actor), detail.card.title, boardClientJs(detail.board.id));
  });

  router.get('/card/:cardId/fragment', (req, res, ctx) => {
    const cardId = parseId(req.params.cardId);
    const actor = actorFrom(res);
    if (cardId === null || !actor) {
      res.status(404).type('html').send('');
      return;
    }

    const detail = loadCardDetail(ctx.db, cardId);
    if (!detail || !canViewBoard(detail.board, actor)) {
      res.status(404).type('html').send('');
      return;
    }

    sendFragment(res, renderCardDetail(detail, actor));
  });

  // --- Members ---

  router.get('/members', (req, res, ctx) => {
    const actor = requireActor(req, res);
    if (!actor) return;

    sendPage(
      res,
      noticeFrom(req) + renderMembersPage(listMembers(ctx.db), actor),
      'People',
      MEMBERS_CLIENT_JS
    );
  });

  // --- Board mutations ---

  router.post('/boards/create', (req, res, ctx) => {
    const actor = requireActor(req, res);
    if (!actor) return;

    const fields = body(req);
    const title = parseText(fields.title, LIMITS.boardTitle);
    const description = parseOptionalText(fields.description, LIMITS.boardDescription);
    const visibility = fields.visibility === undefined ? 'shared' : parseVisibility(fields.visibility);

    if (title === null) {
      respondErr(req, res, 400, 'INVALID', 'Give the board a name', '/p/goals/');
      return;
    }
    if (description === null || visibility === null) {
      respondErr(req, res, 400, 'INVALID', 'Check the board details and try again', '/p/goals/');
      return;
    }

    try {
      const board = createBoard(ctx.db, {
        title,
        description,
        ownerId: actor.userId,
        visibility,
      });
      ctx.sse.broadcast('boards-changed', { originId: parseClientId(fields.clientId) });
      respondOk(req, res, { boardId: board.id }, boardPath(board.id));
    } catch (err) {
      handleFailure(req, res, err, '/p/goals/', 'boards/create');
    }
  });

  router.post('/boards/update', (req, res, ctx) => {
    const fields = body(req);
    const boardId = parseId(fields.boardId);
    if (boardId === null) {
      respondErr(req, res, 400, 'INVALID', 'Unknown board', '/p/goals/');
      return;
    }

    const access = requireBoardAccess(req, res, ctx.db, boardId, 'admin', boardPath(boardId));
    if (!access) return;

    const title = fields.title === undefined ? undefined : parseText(fields.title, LIMITS.boardTitle);
    const description =
      fields.description === undefined
        ? undefined
        : parseOptionalText(fields.description, LIMITS.boardDescription);
    const visibility =
      fields.visibility === undefined ? undefined : parseVisibility(fields.visibility);

    if (title === null || description === null || visibility === null) {
      respondErr(req, res, 400, 'INVALID', 'Check the board details and try again', boardPath(boardId));
      return;
    }

    try {
      updateBoard(ctx.db, boardId, { title, description, visibility });
      broadcastBoard(ctx, boardId, parseClientId(fields.clientId), 'board');
      respondOk(req, res, {}, boardPath(boardId));
    } catch (err) {
      handleFailure(req, res, err, boardPath(boardId), 'boards/update');
    }
  });

  router.post('/boards/delete', (req, res, ctx) => {
    const fields = body(req);
    const boardId = parseId(fields.boardId);
    if (boardId === null) {
      respondErr(req, res, 400, 'INVALID', 'Unknown board', '/p/goals/');
      return;
    }

    const access = requireBoardAccess(req, res, ctx.db, boardId, 'admin', boardPath(boardId));
    if (!access) return;

    // Typing the name is the confirmation — this destroys every card on it.
    if (fields.confirm !== access.board.title) {
      respondErr(req, res, 400, 'INVALID', 'Type the board name to confirm', boardPath(boardId));
      return;
    }

    try {
      deleteBoard(ctx.db, boardId);
      ctx.sse.broadcast('boards-changed', { originId: parseClientId(fields.clientId) });
      respondOk(req, res, {}, '/p/goals/');
    } catch (err) {
      handleFailure(req, res, err, boardPath(boardId), 'boards/delete');
    }
  });

  // --- Column mutations ---

  router.post('/columns/create', (req, res, ctx) => {
    const fields = body(req);
    const boardId = parseId(fields.boardId);
    if (boardId === null) {
      respondErr(req, res, 400, 'INVALID', 'Unknown board', '/p/goals/');
      return;
    }

    const access = requireBoardAccess(req, res, ctx.db, boardId, 'admin', boardPath(boardId));
    if (!access) return;

    const name = parseText(fields.name, LIMITS.columnName);
    if (name === null) {
      respondErr(req, res, 400, 'INVALID', 'Give the column a name', boardPath(boardId));
      return;
    }

    const color = fields.color === undefined ? undefined : (parseHexColor(fields.color) ?? undefined);
    const isDone = fields.isDone === undefined ? false : parseBool(fields.isDone) === true;
    const wipLimit = parseWipLimit(fields.wipLimit);
    if (wipLimit === false) {
      respondErr(req, res, 400, 'INVALID', 'Card limit must be a number', boardPath(boardId));
      return;
    }

    try {
      const column = createColumn(ctx.db, { boardId, name, color, isDone, wipLimit });
      broadcastBoard(ctx, boardId, parseClientId(fields.clientId), 'columns');
      respondOk(req, res, { columnId: column.id }, boardPath(boardId));
    } catch (err) {
      handleFailure(req, res, err, boardPath(boardId), 'columns/create');
    }
  });

  router.post('/columns/update', (req, res, ctx) => {
    const fields = body(req);
    const columnId = parseId(fields.columnId);
    if (columnId === null) {
      respondErr(req, res, 400, 'INVALID', 'Unknown column', '/p/goals/');
      return;
    }

    const column = getColumn(ctx.db, columnId);
    if (!column) {
      respondErr(req, res, 404, 'NOT_FOUND', 'That column no longer exists', '/p/goals/');
      return;
    }

    const access = requireBoardAccess(
      req,
      res,
      ctx.db,
      column.boardId,
      'admin',
      boardPath(column.boardId)
    );
    if (!access) return;

    const name = fields.name === undefined ? undefined : parseText(fields.name, LIMITS.columnName);
    if (name === null) {
      respondErr(req, res, 400, 'INVALID', 'Give the column a name', boardPath(column.boardId));
      return;
    }

    const color = fields.color === undefined ? undefined : (parseHexColor(fields.color) ?? undefined);
    const isDone = fields.isDone === undefined ? undefined : parseBool(fields.isDone) === true;
    const wipLimit = parseWipLimit(fields.wipLimit);
    if (wipLimit === false) {
      respondErr(req, res, 400, 'INVALID', 'Card limit must be a number', boardPath(column.boardId));
      return;
    }

    try {
      updateColumn(ctx.db, columnId, { name, color, isDone, wipLimit });
      broadcastBoard(ctx, column.boardId, parseClientId(fields.clientId), 'columns');
      respondOk(req, res, {}, boardPath(column.boardId));
    } catch (err) {
      handleFailure(req, res, err, boardPath(column.boardId), 'columns/update');
    }
  });

  router.post('/columns/delete', (req, res, ctx) => {
    const fields = body(req);
    const columnId = parseId(fields.columnId);
    if (columnId === null) {
      respondErr(req, res, 400, 'INVALID', 'Unknown column', '/p/goals/');
      return;
    }

    const column = getColumn(ctx.db, columnId);
    if (!column) {
      respondErr(req, res, 404, 'NOT_FOUND', 'That column no longer exists', '/p/goals/');
      return;
    }

    const access = requireBoardAccess(
      req,
      res,
      ctx.db,
      column.boardId,
      'admin',
      boardPath(column.boardId)
    );
    if (!access) return;

    const mode = fields.mode === 'move' || fields.mode === 'delete' ? fields.mode : null;
    const expectedCardCount = parseIndex(fields.expectedCardCount);
    if (mode === null || expectedCardCount === null) {
      respondErr(
        req,
        res,
        400,
        'INVALID',
        'Say whether to move or delete the cards in this column',
        boardPath(column.boardId)
      );
      return;
    }

    const targetColumnId =
      fields.targetColumnId === undefined || fields.targetColumnId === null
        ? undefined
        : (parseId(fields.targetColumnId) ?? undefined);

    try {
      const result = deleteColumn(ctx.db, { columnId, mode, targetColumnId, expectedCardCount });
      broadcastBoard(ctx, column.boardId, parseClientId(fields.clientId), 'columns');
      respondOk(req, res, { moved: result.moved, deleted: result.deleted }, boardPath(column.boardId));
    } catch (err) {
      handleFailure(req, res, err, boardPath(column.boardId), 'columns/delete');
    }
  });

  // --- Card mutations ---

  router.post('/cards/create', (req, res, ctx) => {
    const fields = body(req);
    const columnId = parseId(fields.columnId);
    if (columnId === null) {
      respondErr(req, res, 400, 'INVALID', 'Pick a column', '/p/goals/');
      return;
    }

    const column = getColumn(ctx.db, columnId);
    if (!column) {
      respondErr(req, res, 404, 'NOT_FOUND', 'That column no longer exists', '/p/goals/');
      return;
    }

    const access = requireBoardAccess(
      req,
      res,
      ctx.db,
      column.boardId,
      'edit',
      boardPath(column.boardId)
    );
    if (!access) return;

    const parsed = parseCardFields(fields, ctx.db);
    if (typeof parsed === 'string') {
      respondErr(req, res, 400, 'INVALID', parsed, boardPath(column.boardId));
      return;
    }

    const title = parseText(fields.title, LIMITS.cardTitle);
    if (title === null) {
      respondErr(req, res, 400, 'INVALID', 'Give the goal a title', boardPath(column.boardId));
      return;
    }

    try {
      const card = createCard(ctx.db, {
        columnId,
        title,
        description: parsed.description ?? '',
        assigneeId: parsed.assigneeId ?? null,
        dueDate: parsed.dueDate ?? null,
        createdBy: access.actor.userId,
      });

      broadcastBoard(ctx, column.boardId, parseClientId(fields.clientId), 'cards');
      notifyAssignment(ctx, access.actor, parsed.assigneeId ?? null, title, column.boardId);
      respondOk(req, res, { cardId: card.id }, boardPath(column.boardId));
    } catch (err) {
      handleFailure(req, res, err, boardPath(column.boardId), 'cards/create');
    }
  });

  router.post('/cards/update', (req, res, ctx) => {
    const fields = body(req);
    const cardId = parseId(fields.cardId);
    if (cardId === null) {
      respondErr(req, res, 400, 'INVALID', 'Unknown goal', '/p/goals/');
      return;
    }

    const card = getCard(ctx.db, cardId);
    if (!card) {
      respondErr(req, res, 404, 'NOT_FOUND', 'That goal no longer exists', '/p/goals/');
      return;
    }

    const access = requireBoardAccess(req, res, ctx.db, card.boardId, 'edit', boardPath(card.boardId));
    if (!access) return;

    const parsed = parseCardFields(fields, ctx.db);
    if (typeof parsed === 'string') {
      respondErr(req, res, 400, 'INVALID', parsed, boardPath(card.boardId));
      return;
    }

    const title = fields.title === undefined ? undefined : parseText(fields.title, LIMITS.cardTitle);
    if (title === null) {
      respondErr(req, res, 400, 'INVALID', 'Give the goal a title', boardPath(card.boardId));
      return;
    }

    try {
      updateCard(ctx.db, cardId, {
        title,
        description: parsed.description,
        assigneeId: parsed.assigneeId,
        dueDate: parsed.dueDate,
      });

      broadcastBoard(ctx, card.boardId, parseClientId(fields.clientId), 'cards');
      if (parsed.assigneeId !== undefined && parsed.assigneeId !== card.assigneeId) {
        notifyAssignment(ctx, access.actor, parsed.assigneeId, title ?? card.title, card.boardId);
      }
      respondOk(req, res, {}, boardPath(card.boardId));
    } catch (err) {
      handleFailure(req, res, err, boardPath(card.boardId), 'cards/update');
    }
  });

  router.post('/cards/move', (req, res, ctx) => {
    const fields = body(req);
    const cardId = parseId(fields.cardId);
    const toColumnId = parseId(fields.toColumnId);
    const toIndex = parseIndex(fields.toIndex);

    if (cardId === null || toColumnId === null || toIndex === null) {
      respondErr(req, res, 400, 'INVALID', 'That move was not understood', '/p/goals/');
      return;
    }

    const card = getCard(ctx.db, cardId);
    if (!card) {
      respondErr(req, res, 404, 'NOT_FOUND', 'That goal no longer exists', '/p/goals/');
      return;
    }

    // The board comes from the card, never from the request.
    const access = requireBoardAccess(req, res, ctx.db, card.boardId, 'edit', boardPath(card.boardId));
    if (!access) return;

    try {
      const result = moveCard(ctx.db, { cardId, toColumnId, toIndex });
      broadcastBoard(ctx, result.boardId, parseClientId(fields.clientId), 'cards');
      respondOk(
        req,
        res,
        {
          fromColumnId: result.fromColumnId,
          toColumnId: result.toColumnId,
          toIndex: result.toIndex,
        },
        boardPath(result.boardId)
      );
    } catch (err) {
      handleFailure(req, res, err, boardPath(card.boardId), 'cards/move');
    }
  });

  router.post('/cards/archive', (req, res, ctx) => {
    const fields = body(req);
    const cardId = parseId(fields.cardId);
    const archived = parseBool(fields.archived);

    if (cardId === null || archived === null) {
      respondErr(req, res, 400, 'INVALID', 'That request was not understood', '/p/goals/');
      return;
    }

    const card = getCard(ctx.db, cardId);
    if (!card) {
      respondErr(req, res, 404, 'NOT_FOUND', 'That goal no longer exists', '/p/goals/');
      return;
    }

    const access = requireBoardAccess(req, res, ctx.db, card.boardId, 'edit', boardPath(card.boardId));
    if (!access) return;

    try {
      setCardArchived(ctx.db, cardId, archived);
      broadcastBoard(ctx, card.boardId, parseClientId(fields.clientId), 'cards');
      respondOk(req, res, {}, boardPath(card.boardId));
    } catch (err) {
      handleFailure(req, res, err, boardPath(card.boardId), 'cards/archive');
    }
  });

  router.post('/cards/delete', (req, res, ctx) => {
    const fields = body(req);
    const cardId = parseId(fields.cardId);
    if (cardId === null) {
      respondErr(req, res, 400, 'INVALID', 'Unknown goal', '/p/goals/');
      return;
    }

    const card = getCard(ctx.db, cardId);
    if (!card) {
      respondErr(req, res, 404, 'NOT_FOUND', 'That goal no longer exists', '/p/goals/');
      return;
    }

    const access = requireBoardAccess(req, res, ctx.db, card.boardId, 'edit', boardPath(card.boardId));
    if (!access) return;

    try {
      deleteCard(ctx.db, cardId);
      broadcastBoard(ctx, card.boardId, parseClientId(fields.clientId), 'cards');
      respondOk(req, res, {}, boardPath(card.boardId));
    } catch (err) {
      handleFailure(req, res, err, boardPath(card.boardId), 'cards/delete');
    }
  });

  // --- Comments ---

  router.post('/comments/create', (req, res, ctx) => {
    const fields = body(req);
    const cardId = parseId(fields.cardId);
    if (cardId === null) {
      respondErr(req, res, 400, 'INVALID', 'Unknown goal', '/p/goals/');
      return;
    }

    const card = getCard(ctx.db, cardId);
    if (!card) {
      respondErr(req, res, 404, 'NOT_FOUND', 'That goal no longer exists', '/p/goals/');
      return;
    }

    const access = requireBoardAccess(req, res, ctx.db, card.boardId, 'edit', boardPath(card.boardId));
    if (!access) return;

    const text = parseText(fields.body, LIMITS.commentBody, { multiline: true });
    if (text === null) {
      respondErr(req, res, 400, 'INVALID', 'Write something first', boardPath(card.boardId));
      return;
    }

    try {
      const comment = createComment(ctx.db, { cardId, authorId: access.actor.userId, body: text });
      broadcastBoard(ctx, card.boardId, parseClientId(fields.clientId), 'cards');
      respondOk(req, res, { commentId: comment.id }, `/p/goals/card/${String(cardId)}`);
    } catch (err) {
      handleFailure(req, res, err, boardPath(card.boardId), 'comments/create');
    }
  });

  router.post('/comments/delete', (req, res, ctx) => {
    const fields = body(req);
    const commentId = parseId(fields.commentId);
    if (commentId === null) {
      respondErr(req, res, 400, 'INVALID', 'Unknown comment', '/p/goals/');
      return;
    }

    const actor = requireActor(req, res);
    if (!actor) return;

    const comment = getComment(ctx.db, commentId);
    if (!comment) {
      respondErr(req, res, 404, 'NOT_FOUND', 'That comment no longer exists', '/p/goals/');
      return;
    }

    const card = getCard(ctx.db, comment.cardId);
    if (!card) {
      respondErr(req, res, 404, 'NOT_FOUND', 'That goal no longer exists', '/p/goals/');
      return;
    }

    const access = requireBoardAccess(req, res, ctx.db, card.boardId, 'edit', boardPath(card.boardId));
    if (!access) return;

    if (!canDeleteComment(comment, access.actor)) {
      respondErr(
        req,
        res,
        403,
        'FORBIDDEN',
        'Only the author can delete that comment',
        `/p/goals/card/${String(card.id)}`
      );
      return;
    }

    try {
      deleteComment(ctx.db, commentId);
      broadcastBoard(ctx, card.boardId, parseClientId(fields.clientId), 'cards');
      respondOk(req, res, {}, `/p/goals/card/${String(card.id)}`);
    } catch (err) {
      handleFailure(req, res, err, `/p/goals/card/${String(card.id)}`, 'comments/delete');
    }
  });

  // --- Members ---

  router.post('/members/create', (req, res, ctx) => {
    const actor = requireActor(req, res);
    if (!actor) return;

    const fields = body(req);
    const displayName = parseText(fields.name, LIMITS.memberName);
    const identity = parseIdentity(fields.identity);
    const color = parseHexColor(fields.color) ?? '#06b6d4';

    if (displayName === null) {
      respondErr(req, res, 400, 'INVALID', 'Give this person a name', '/p/goals/members');
      return;
    }
    if (identity === false) {
      respondErr(
        req,
        res,
        400,
        'INVALID',
        'An account looks like U012ABC or web:name',
        '/p/goals/members'
      );
      return;
    }

    try {
      const member = createMember(ctx.db, { displayName, color, identity });
      ctx.sse.broadcast('members-changed', { originId: parseClientId(fields.clientId) });
      respondOk(req, res, { memberId: member.id }, '/p/goals/members');
    } catch (err) {
      handleFailure(req, res, err, '/p/goals/members', 'members/create');
    }
  });

  router.post('/members/update', (req, res, ctx) => {
    const actor = requireActor(req, res);
    if (!actor) return;

    const fields = body(req);
    const memberId = parseId(fields.memberId);
    if (memberId === null) {
      respondErr(req, res, 400, 'INVALID', 'Unknown person', '/p/goals/members');
      return;
    }

    const displayName =
      fields.name === undefined ? undefined : parseText(fields.name, LIMITS.memberName);
    if (displayName === null) {
      respondErr(req, res, 400, 'INVALID', 'Give this person a name', '/p/goals/members');
      return;
    }

    const color = fields.color === undefined ? undefined : (parseHexColor(fields.color) ?? undefined);
    const identity = fields.identity === undefined ? undefined : parseIdentity(fields.identity);
    if (identity === false) {
      respondErr(
        req,
        res,
        400,
        'INVALID',
        'An account looks like U012ABC or web:name',
        '/p/goals/members'
      );
      return;
    }

    try {
      updateMember(ctx.db, memberId, { displayName, color, identity });
      ctx.sse.broadcast('members-changed', { originId: parseClientId(fields.clientId) });
      respondOk(req, res, {}, '/p/goals/members');
    } catch (err) {
      handleFailure(req, res, err, '/p/goals/members', 'members/update');
    }
  });

  router.post('/members/archive', (req, res, ctx) => {
    const actor = requireActor(req, res);
    if (!actor) return;

    const fields = body(req);
    const memberId = parseId(fields.memberId);
    const archived = parseBool(fields.archived);
    if (memberId === null || archived === null) {
      respondErr(req, res, 400, 'INVALID', 'That request was not understood', '/p/goals/members');
      return;
    }

    try {
      setMemberArchived(ctx.db, memberId, archived);
      ctx.sse.broadcast('members-changed', { originId: parseClientId(fields.clientId) });
      respondOk(req, res, {}, '/p/goals/members');
    } catch (err) {
      handleFailure(req, res, err, '/p/goals/members', 'members/archive');
    }
  });

  router.post('/members/delete', (req, res, ctx) => {
    const actor = requireActor(req, res);
    if (!actor) return;

    const fields = body(req);
    const memberId = parseId(fields.memberId);
    if (memberId === null) {
      respondErr(req, res, 400, 'INVALID', 'Unknown person', '/p/goals/members');
      return;
    }

    if (!canHardDeleteMember(actor)) {
      respondErr(
        req,
        res,
        403,
        'FORBIDDEN',
        'Only an admin can delete someone outright. Archive them instead.',
        '/p/goals/members'
      );
      return;
    }

    try {
      hardDeleteMember(ctx.db, memberId);
      ctx.sse.broadcast('members-changed', { originId: parseClientId(fields.clientId) });
      respondOk(req, res, {}, '/p/goals/members');
    } catch (err) {
      handleFailure(req, res, err, '/p/goals/members', 'members/delete');
    }
  });
}

// ── Field helpers ──────────────────────────────────────────────────

/** `false` means invalid; `undefined` means "leave it alone". */
function parseWipLimit(value: unknown): number | null | undefined | false {
  if (value === undefined) return undefined;
  if (value === '' || value === null) return null;

  const parsed = parseIndex(value);
  if (parsed === null || parsed === 0) return false;
  return parsed;
}

interface CardFields {
  description?: string;
  assigneeId?: number | null;
  dueDate?: string | null;
}

/** Returns a message string when something is wrong, so callers can 400 with it. */
function parseCardFields(
  fields: Record<string, unknown>,
  db: PluginDatabase
): CardFields | string {
  const out: CardFields = {};

  if (fields.description !== undefined) {
    const description = parseOptionalText(fields.description, LIMITS.cardDescription);
    if (description === null) return 'Those notes are too long';
    out.description = description;
  }

  if (fields.assigneeId !== undefined) {
    if (fields.assigneeId === '' || fields.assigneeId === null) {
      out.assigneeId = null;
    } else {
      const assigneeId = parseId(fields.assigneeId);
      if (assigneeId === null || !getMember(db, assigneeId)) return 'Pick someone from the roster';
      out.assigneeId = assigneeId;
    }
  }

  if (fields.dueDate !== undefined) {
    const dueDate = parseDueDate(fields.dueDate);
    if (dueDate === false) return 'Use a date like 2026-08-01';
    out.dueDate = dueDate;
  }

  return out;
}

/** Tell someone when work lands on them — but never notify yourself. */
function notifyAssignment(
  ctx: PluginContext,
  actor: Actor,
  assigneeId: number | null,
  title: string,
  boardId: number
): void {
  if (assigneeId === null) return;

  const member = getMember(ctx.db, assigneeId);
  if (!member?.identity || member.identity === actor.userId) return;

  ctx.notify(`${member.displayName} was given a goal`, {
    level: 'info',
    body: title,
    link: `/p/goals/b/${String(boardId)}`,
  });
}

export { countCardsInColumn };

/**
 * Who can do what.
 *
 * Two levels of authority per board:
 *   - content  — add, edit, move and comment on cards. Anyone who can see the
 *                board. That is the point of a shared family board.
 *   - admin    — rename, change visibility, delete, and all column structure.
 *                Owner or an app admin only.
 */
import type { Response } from 'express';
import type { Actor, Board, Comment } from './types.js';

/**
 * Build an Actor from the response locals populated by sessionAuthMiddleware.
 *
 * Returns null when there is no usable identity. The plugin is not public, so
 * this should never happen — but it fails closed rather than trusting that a
 * future `public: true` would keep the invariant.
 */
export function actorFrom(res: Response): Actor | null {
  const locals = res.locals as Record<string, unknown> | undefined;
  const userId = locals?.userId;

  if (typeof userId !== 'string' || userId.trim() === '') return null;

  return { userId, isAdmin: locals?.isAdmin === true };
}

export function canViewBoard(board: Board, actor: Actor): boolean {
  if (board.visibility === 'shared') return true;
  return board.ownerId === actor.userId || actor.isAdmin;
}

/** Deliberately identical to view access — see the module comment. */
export function canEditBoardContent(board: Board, actor: Actor): boolean {
  return canViewBoard(board, actor);
}

export function canAdminBoard(board: Board, actor: Actor): boolean {
  return board.ownerId === actor.userId || actor.isAdmin;
}

export function canDeleteComment(comment: Comment, actor: Actor): boolean {
  return comment.authorId === actor.userId || actor.isAdmin;
}

/**
 * Hard-deleting a member destroys historical attribution, so it is admin-only.
 * The caller must also confirm the member is unreferenced (see members.ts).
 */
export function canHardDeleteMember(actor: Actor): boolean {
  return actor.isAdmin;
}

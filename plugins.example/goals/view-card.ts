/**
 * Card detail — rendered both as a dialog fragment and as a standalone
 * permalink page, so a link from Slack works without JavaScript.
 */
import { escapeHtml, icon, formatTimestamp } from '../../src/web/plugin-helpers.js';
import type { Actor, CardDetail, CommentView } from './types.js';
import { canDeleteComment } from './access.js';
import { renderAvatar, safeColor, dueTone, initials } from './view-board.js';
import { todayIso } from './queries.js';

function renderComment(comment: CommentView, actor: Actor): string {
  const name = comment.authorMember?.displayName ?? comment.authorId;
  const color = safeColor(comment.authorMember?.color);

  const avatar = comment.authorMember
    ? renderAvatar(comment.authorMember, 28)
    : `<span class="goals-avatar" style="background:${escapeHtml(color)};width:28px;height:28px" ` +
      `aria-hidden="true">${escapeHtml(initials(name))}</span>`;

  const remove = canDeleteComment(comment, actor)
    ? `<button type="button" class="goals-icon-btn goals-comment-delete" ` +
      `data-comment-id="${String(comment.id)}" aria-label="Delete this comment">${icon('x', 14)}</button>`
    : '';

  return (
    `<li class="goals-comment" data-comment-id="${String(comment.id)}">` +
    avatar +
    `<div class="goals-comment-body">` +
    `<div class="goals-comment-head">` +
    `<span class="goals-comment-author">${escapeHtml(name)}</span>` +
    `<span class="goals-comment-time">${escapeHtml(formatTimestamp(comment.createdAt))}</span>` +
    remove +
    `</div>` +
    `<p class="goals-comment-text">${escapeHtml(comment.body)}</p>` +
    `</div></li>`
  );
}

/** The dialog body — also the whole content of the permalink page. */
export function renderCardDetail(detail: CardDetail, actor: Actor, today = todayIso()): string {
  const { card, board, column, columns, comments, members } = detail;

  const memberOptions = members
    .map(
      (member) =>
        `<option value="${String(member.id)}"${member.id === card.assigneeId ? ' selected' : ''}>` +
        `${escapeHtml(member.displayName)}</option>`
    )
    .join('');

  const columnOptions = columns
    .map(
      (c) =>
        `<option value="${String(c.id)}"${c.id === card.columnId ? ' selected' : ''}>` +
        `${escapeHtml(c.name)}</option>`
    )
    .join('');

  const dueClass = card.dueDate ? dueTone(card.dueDate, today) : 'later';

  const commentList =
    comments.length === 0
      ? `<p class="goals-detail-empty">No comments yet.</p>`
      : `<ul class="goals-comments">${comments.map((c) => renderComment(c, actor)).join('')}</ul>`;

  return (
    `<form method="post" action="/p/goals/cards/update" class="goals-card-form" ` +
    `data-card-id="${String(card.id)}" data-board-id="${String(board.id)}" ` +
    `data-due-tone="${escapeHtml(dueClass)}">` +
    `<input type="hidden" name="cardId" value="${String(card.id)}">` +
    `<div class="goals-field"><label for="goals-detail-title">Title</label>` +
    `<input class="goals-input" id="goals-detail-title" name="title" required maxlength="200" ` +
    `value="${escapeHtml(card.title)}"></div>` +
    `<div class="goals-field"><label for="goals-detail-description">Notes</label>` +
    `<textarea class="goals-textarea" id="goals-detail-description" name="description" maxlength="4000" ` +
    `placeholder="What does done look like?">${escapeHtml(card.description)}</textarea></div>` +
    `<div class="goals-row">` +
    `<div class="goals-field"><label for="goals-detail-assignee">Assigned to</label>` +
    `<select class="goals-select" id="goals-detail-assignee" name="assigneeId">` +
    `<option value=""${card.assigneeId === null ? ' selected' : ''}>Nobody</option>` +
    memberOptions +
    `</select></div>` +
    `<div class="goals-field"><label for="goals-detail-due">Due</label>` +
    `<input class="goals-input" id="goals-detail-due" name="dueDate" type="date" ` +
    `value="${escapeHtml(card.dueDate ?? '')}"></div>` +
    `<div class="goals-field"><label for="goals-detail-column">Column</label>` +
    `<select class="goals-select" id="goals-detail-column" name="columnId" data-current="${String(
      card.columnId
    )}">${columnOptions}</select></div>` +
    `</div>` +
    `<div class="goals-dialog-foot">` +
    `<button type="button" class="btn btn-danger goals-card-delete" data-card-id="${String(card.id)}">` +
    `Delete</button>` +
    `<button type="submit" class="btn btn-primary">Save changes</button>` +
    `</div>` +
    `</form>` +

    `<p class="goals-hint">Added ${escapeHtml(formatTimestamp(card.createdAt))} in ` +
    `${escapeHtml(board.title)} · ${escapeHtml(column.name)}</p>` +

    `<h3 class="goals-dialog-title" style="font-size:var(--text-sm);margin-top:var(--space-5)">` +
    `Comments</h3>` +
    commentList +
    `<form method="post" action="/p/goals/comments/create" class="goals-comment-form" ` +
    `style="margin-top:var(--space-3)">` +
    `<input type="hidden" name="cardId" value="${String(card.id)}">` +
    `<div class="goals-quick-add">` +
    `<input class="goals-input" name="body" required maxlength="2000" placeholder="Add a comment" ` +
    `aria-label="Add a comment" autocomplete="off">` +
    `<button type="submit" class="btn btn-primary">${icon('send', 14)}Post</button>` +
    `</div></form>`
  );
}

/** Standalone page wrapper for /p/goals/card/:id. */
export function renderCardPermalink(detail: CardDetail, actor: Actor, today = todayIso()): string {
  return (
    `<div class="goals-root">` +
    `<div class="goals-head"><div>` +
    `<div class="goals-eyebrow">${icon('layers', 12)}` +
    `<a href="/p/goals/b/${String(detail.board.id)}">${escapeHtml(detail.board.title)}</a></div>` +
    `<h1 class="goals-title">${escapeHtml(detail.card.title)}</h1>` +
    `</div></div>` +
    `<div class="card">${renderCardDetail(detail, actor, today)}</div>` +
    `</div>`
  );
}

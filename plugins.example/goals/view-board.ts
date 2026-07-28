/**
 * Board rendering. Pure functions — no database, no request.
 *
 * All user text is escaped here and only here; the client never templates a
 * user string, it swaps in server-rendered HTML.
 */
import { escapeHtml, icon } from '../../src/web/plugin-helpers.js';
import type { Actor, BoardView, CardView, ColumnView, Member } from './types.js';
import { parseHexColor } from './validation.js';
import { canAdminBoard } from './access.js';
import { todayIso } from './queries.js';

const FALLBACK_COLOR = '#64748b';

/**
 * Colours come from the database, and the database is not a trust boundary —
 * re-validate before interpolating into a style attribute.
 */
export function safeColor(value: string | null | undefined): string {
  return parseHexColor(value ?? '') ?? FALLBACK_COLOR;
}

/** First letters of a name, for the assignee disc. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return [...parts[0]!].slice(0, 2).join('').toUpperCase();
  return ([...parts[0]!][0]! + [...parts[parts.length - 1]!][0]!).toUpperCase();
}

export type DueTone = 'overdue' | 'today' | 'soon' | 'later';

/** How much attention a due date deserves. */
export function dueTone(dueDate: string, today = todayIso()): DueTone {
  if (dueDate < today) return 'overdue';
  if (dueDate === today) return 'today';

  const due = Date.parse(`${dueDate}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  const days = (due - now) / 86400000;
  return days <= 7 ? 'soon' : 'later';
}

/** Short, human due-date label: "Overdue", "Today", "Fri", "12 Aug". */
export function dueLabel(dueDate: string, today = todayIso()): string {
  const tone = dueTone(dueDate, today);
  if (tone === 'overdue') return 'Overdue';
  if (tone === 'today') return 'Today';

  const due = new Date(`${dueDate}T00:00:00Z`);
  if (tone === 'soon') {
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][due.getUTCDay()] ?? dueDate;
  }

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${String(due.getUTCDate())} ${months[due.getUTCMonth()] ?? ''}`.trim();
}

export function renderAvatar(member: Member, size = 22): string {
  const color = safeColor(member.color);
  return (
    `<span class="goals-avatar" style="background:${escapeHtml(color)};width:${String(size)}px;height:${String(size)}px" ` +
    `title="${escapeHtml(member.displayName)}" aria-label="Assigned to ${escapeHtml(member.displayName)}">` +
    `${escapeHtml(initials(member.displayName))}</span>`
  );
}

export function renderCard(card: CardView, column: ColumnView, today = todayIso()): string {
  const meta: string[] = [];

  if (card.dueDate) {
    const tone = dueTone(card.dueDate, today);
    const toneClass = tone === 'later' ? '' : ` is-${tone}`;
    meta.push(
      `<span class="goals-due${toneClass}" title="Due ${escapeHtml(card.dueDate)}">` +
        `${icon('clock', 12)}${escapeHtml(dueLabel(card.dueDate, today))}</span>`
    );
  }

  if (card.commentCount > 0) {
    meta.push(
      `<span class="goals-comment-count" aria-label="${String(card.commentCount)} comment(s)">` +
        `${icon('message-circle', 12)}${String(card.commentCount)}</span>`
    );
  }

  if (card.assignee) {
    meta.push(renderAvatar(card.assignee));
  }

  const doneClass = column.isDone ? ' is-done' : '';

  return (
    `<li class="goals-card${doneClass}" role="listitem" tabindex="0" ` +
    `data-card-id="${String(card.id)}" data-column-id="${String(card.columnId)}" ` +
    `data-title="${escapeHtml(card.title)}">` +
    `<div class="goals-card-head">` +
    `<p class="goals-card-title">${escapeHtml(card.title)}</p>` +
    `<div class="goals-card-actions">` +
    `<button type="button" class="goals-icon-btn goals-grip" tabindex="-1" aria-hidden="true" ` +
    `title="Drag to move">${icon('grid', 14)}</button>` +
    `<button type="button" class="goals-icon-btn goals-menu-trigger" aria-haspopup="menu" ` +
    `aria-expanded="false" aria-label="Move ${escapeHtml(card.title)}">${icon('arrow-right', 14)}</button>` +
    `</div>` +
    `</div>` +
    `<div class="goals-card-meta">${meta.join('')}</div>` +
    `</li>`
  );
}

function renderColumnHead(column: ColumnView, share: number, canAdmin: boolean): string {
  const overLimit = column.wipLimit !== null && column.cards.length > column.wipLimit;
  const countTitle =
    column.wipLimit === null
      ? `${String(column.cards.length)} card(s)`
      : `${String(column.cards.length)} of ${String(column.wipLimit)} card(s)`;

  const settings = canAdmin
    ? `<button type="button" class="goals-icon-btn goals-column-edit" ` +
      `data-column-id="${String(column.id)}" aria-label="Edit ${escapeHtml(column.name)}">` +
      `${icon('wrench', 14)}</button>`
    : '';

  return (
    `<div class="goals-column-head">` +
    `<h2 class="goals-column-name">${escapeHtml(column.name)}</h2>` +
    `<span class="goals-column-count${overLimit ? ' is-over' : ''}" title="${escapeHtml(countTitle)}">` +
    `${String(column.cards.length)}${column.wipLimit === null ? '' : `/${String(column.wipLimit)}`}</span>` +
    settings +
    `</div>` +
    `<span class="goals-sr">${escapeHtml(column.name)} holds ${String(share)}% of this board</span>`
  );
}

export function renderColumn(
  column: ColumnView,
  boardTotal: number,
  canAdmin: boolean,
  today = todayIso()
): string {
  const share = boardTotal === 0 ? 0 : Math.round((column.cards.length / boardTotal) * 100);
  const color = safeColor(column.color);

  const cards = column.cards.map((card) => renderCard(card, column, today)).join('');

  return (
    `<section class="goals-column" data-column-id="${String(column.id)}" ` +
    `data-column-name="${escapeHtml(column.name)}" data-is-done="${column.isDone ? '1' : '0'}" ` +
    `style="--goals-column-color:${escapeHtml(color)};--goals-column-share:${String(share)}%">` +
    renderColumnHead(column, share, canAdmin) +
    `<ul class="goals-cards" role="list" aria-label="${escapeHtml(column.name)}">${cards}</ul>` +
    `<div class="goals-column-foot">` +
    `<button type="button" class="btn btn-ghost btn-sm goals-add-card" ` +
    `data-column-id="${String(column.id)}">${icon('plus', 14)}Add a goal</button>` +
    `</div>` +
    `</section>`
  );
}

function renderTrajectory(view: BoardView): string {
  const total = view.columns.reduce((sum, column) => sum + column.cards.length, 0);
  if (total === 0) return '';

  const segments = view.columns
    .filter((column) => column.cards.length > 0)
    .map(
      (column) =>
        `<div class="goals-trajectory-seg" style="flex-grow:${String(column.cards.length)};` +
        `background:${escapeHtml(safeColor(column.color))}" ` +
        `title="${escapeHtml(column.name)}: ${String(column.cards.length)}"></div>`
    )
    .join('');

  return `<div class="goals-trajectory" role="presentation">${segments}</div>`;
}

/**
 * The part of the page that changes — re-fetched whole after any board update.
 * Kept separate from the shell so an SSE refresh never touches the header,
 * dialogs, or the page script.
 */
export function renderColumnsRegion(view: BoardView, actor: Actor, today = todayIso()): string {
  const canAdmin = canAdminBoard(view.board, actor);
  const total = view.columns.reduce((sum, column) => sum + column.cards.length, 0);

  const columns = view.columns
    .map((column) => renderColumn(column, total, canAdmin, today))
    .join('');

  const addColumn = canAdmin
    ? `<div class="goals-column goals-add-column-tile" style="--goals-column-color:${escapeHtml(
        FALLBACK_COLOR
      )};--goals-column-share:0%">` +
      `<div class="goals-column-foot">` +
      `<button type="button" class="btn btn-ghost btn-sm goals-add-column">${icon('plus', 14)}Add a column</button>` +
      `</div></div>`
    : '';

  return (
    renderTrajectory(view) +
    `<div class="goals-board-scroll"><div class="goals-board" data-board-id="${String(
      view.board.id
    )}">${columns}${addColumn}</div></div>`
  );
}

function renderMemberOptions(members: Member[], selectedId: number | null): string {
  const options = members
    .map(
      (member) =>
        `<option value="${String(member.id)}"${member.id === selectedId ? ' selected' : ''}>` +
        `${escapeHtml(member.displayName)}</option>`
    )
    .join('');
  return `<option value=""${selectedId === null ? ' selected' : ''}>Nobody</option>${options}`;
}

/** Dialogs live outside the refreshed region so an update never closes one. */
function renderDialogs(view: BoardView, canAdmin: boolean): string {
  const cardDialog =
    `<dialog class="goals-dialog" id="goals-card-dialog" aria-label="Goal">` +
    `<div class="goals-dialog-head">` +
    `<h2 class="goals-dialog-title" id="goals-card-dialog-title">Goal</h2>` +
    `<button type="button" class="goals-icon-btn" data-close-dialog aria-label="Close">${icon('x', 16)}</button>` +
    `</div>` +
    `<div id="goals-card-dialog-body"><p class="goals-detail-empty">Loading…</p></div>` +
    `</dialog>`;

  const newCardDialog =
    `<dialog class="goals-dialog" id="goals-new-card-dialog" aria-label="Add a goal">` +
    `<form method="post" action="/p/goals/cards/create" id="goals-new-card-form">` +
    `<div class="goals-dialog-head"><h2 class="goals-dialog-title">Add a goal</h2>` +
    `<button type="button" class="goals-icon-btn" data-close-dialog aria-label="Close">${icon('x', 16)}</button></div>` +
    `<input type="hidden" name="columnId" value="">` +
    `<div class="goals-field"><label for="goals-new-card-title">Title</label>` +
    `<input class="goals-input" id="goals-new-card-title" name="title" required maxlength="200" ` +
    `placeholder="Learn to sail" autocomplete="off"></div>` +
    `<div class="goals-field"><label for="goals-new-card-description">Notes</label>` +
    `<textarea class="goals-textarea" id="goals-new-card-description" name="description" ` +
    `maxlength="4000" placeholder="What does done look like?"></textarea></div>` +
    `<div class="goals-row">` +
    `<div class="goals-field"><label for="goals-new-card-assignee">Assigned to</label>` +
    `<select class="goals-select" id="goals-new-card-assignee" name="assigneeId">` +
    `${renderMemberOptions(view.members, null)}</select></div>` +
    `<div class="goals-field"><label for="goals-new-card-due">Due</label>` +
    `<input class="goals-input" id="goals-new-card-due" name="dueDate" type="date"></div>` +
    `</div>` +
    `<div class="goals-dialog-foot">` +
    `<button type="button" class="btn btn-ghost" data-close-dialog>Cancel</button>` +
    `<button type="submit" class="btn btn-primary">Add goal</button>` +
    `</div></form></dialog>`;

  if (!canAdmin) return cardDialog + newCardDialog;

  const boardDialog =
    `<dialog class="goals-dialog" id="goals-board-dialog" aria-label="Board settings">` +
    `<form method="post" action="/p/goals/boards/update">` +
    `<div class="goals-dialog-head"><h2 class="goals-dialog-title">Board settings</h2>` +
    `<button type="button" class="goals-icon-btn" data-close-dialog aria-label="Close">${icon('x', 16)}</button></div>` +
    `<input type="hidden" name="boardId" value="${String(view.board.id)}">` +
    `<div class="goals-field"><label for="goals-board-edit-title">Name</label>` +
    `<input class="goals-input" id="goals-board-edit-title" name="title" required maxlength="80" ` +
    `value="${escapeHtml(view.board.title)}"></div>` +
    `<div class="goals-field"><label for="goals-board-edit-description">What is this board for?</label>` +
    `<input class="goals-input" id="goals-board-edit-description" name="description" maxlength="500" ` +
    `value="${escapeHtml(view.board.description)}"></div>` +
    `<div class="goals-field"><label for="goals-board-edit-visibility">Who can see it</label>` +
    `<select class="goals-select" id="goals-board-edit-visibility" name="visibility">` +
    `<option value="shared"${view.board.visibility === 'shared' ? ' selected' : ''}>Everyone in the family</option>` +
    `<option value="private"${view.board.visibility === 'private' ? ' selected' : ''}>Just me</option>` +
    `</select></div>` +
    `<div class="goals-dialog-foot">` +
    `<button type="button" class="btn btn-danger" id="goals-board-delete" ` +
    `data-board-id="${String(view.board.id)}" data-board-title="${escapeHtml(view.board.title)}">` +
    `Delete board</button>` +
    `<button type="button" class="btn btn-ghost" data-close-dialog>Cancel</button>` +
    `<button type="submit" class="btn btn-primary">Save board</button>` +
    `</div></form></dialog>`;

  const columnDialog =
    `<dialog class="goals-dialog" id="goals-column-dialog" aria-label="Column">` +
    `<form method="post" action="/p/goals/columns/create" id="goals-column-form">` +
    `<div class="goals-dialog-head">` +
    `<h2 class="goals-dialog-title" id="goals-column-dialog-title">Add a column</h2>` +
    `<button type="button" class="goals-icon-btn" data-close-dialog aria-label="Close">${icon('x', 16)}</button></div>` +
    `<input type="hidden" name="boardId" value="${String(view.board.id)}">` +
    `<input type="hidden" name="columnId" value="">` +
    `<div class="goals-field"><label for="goals-column-name">Name</label>` +
    `<input class="goals-input" id="goals-column-name" name="name" required maxlength="40" ` +
    `placeholder="In progress" autocomplete="off"></div>` +
    `<div class="goals-row">` +
    `<div class="goals-field"><label for="goals-column-color">Colour</label>` +
    `<input class="goals-input" id="goals-column-color" name="color" type="color" value="#7c3aed"></div>` +
    `<div class="goals-field"><label for="goals-column-wip">Card limit</label>` +
    `<input class="goals-input" id="goals-column-wip" name="wipLimit" type="number" min="1" max="500" ` +
    `placeholder="No limit"></div>` +
    `</div>` +
    `<div class="goals-field">` +
    `<label for="goals-column-done">Cards here are complete</label>` +
    `<select class="goals-select" id="goals-column-done" name="isDone">` +
    `<option value="0">No — still in flight</option>` +
    `<option value="1">Yes — this is the finish line</option>` +
    `</select></div>` +
    `<div class="goals-dialog-foot">` +
    `<button type="button" class="btn btn-danger goals-column-delete" hidden>Delete column</button>` +
    `<button type="button" class="btn btn-ghost" data-close-dialog>Cancel</button>` +
    `<button type="submit" class="btn btn-primary">Save column</button>` +
    `</div></form></dialog>`;

  return cardDialog + newCardDialog + columnDialog + boardDialog;
}

export function renderBoardPage(view: BoardView, actor: Actor, today = todayIso()): string {
  const canAdmin = canAdminBoard(view.board, actor);
  const { total, done } = view.stats;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);

  const summary =
    total === 0
      ? 'No goals yet — add the first one.'
      : `${String(done)} of ${String(total)} done · ${String(percent)}%`;

  const settings = canAdmin
    ? `<button type="button" class="btn btn-ghost btn-sm" id="goals-board-settings">${icon(
        'wrench',
        14
      )}Board settings</button>`
    : '';

  return (
    `<div class="goals-root">` +
    `<div class="goals-head">` +
    `<div>` +
    `<div class="goals-eyebrow">${icon('layers', 12)}<a href="/p/goals/">All boards</a></div>` +
    `<h1 class="goals-title">${escapeHtml(view.board.title)}</h1>` +
    `<p class="goals-subtitle">${escapeHtml(view.board.description || summary)}</p>` +
    `</div>` +
    `<div class="goals-actions">` +
    `<a class="btn btn-ghost btn-sm" href="/p/goals/members">${icon('star', 14)}People</a>` +
    settings +
    `</div>` +
    `</div>` +
    `<div id="goals-region">${renderColumnsRegion(view, actor, today)}</div>` +
    `<p class="goals-hint">Drag a card to move it, or press <kbd>m</kbd> on a focused card for the move menu.</p>` +
    `<div class="goals-sr" role="status" aria-live="polite" id="goals-live"></div>` +
    renderDialogs(view, canAdmin) +
    `</div>`
  );
}

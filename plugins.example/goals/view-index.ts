/**
 * The board index — every board this person can open, with its progress.
 */
import { escapeHtml, icon } from '../../src/web/plugin-helpers.js';
import type { Actor, BoardSummary } from './types.js';

export function renderBoardTile(summary: BoardSummary): string {
  const { board, stats, columnCount } = summary;
  const percent = stats.total === 0 ? 0 : Math.round((stats.done / stats.total) * 100);

  const visibility =
    board.visibility === 'private'
      ? `<span class="goals-due" title="Only you and admins can see this board">${icon('eye-off', 12)}Private</span>`
      : '';

  const overdue =
    stats.overdue > 0
      ? `<span class="goals-due is-overdue">${icon('clock', 12)}${String(stats.overdue)} overdue</span>`
      : '';

  const open = stats.total - stats.done;

  return (
    `<a class="goals-tile" href="/p/goals/b/${String(board.id)}">` +
    `<h2 class="goals-tile-title">${escapeHtml(board.title)}</h2>` +
    `<p class="goals-tile-desc">${escapeHtml(board.description)}</p>` +
    `<div class="goals-meter"><div class="goals-meter-fill" style="width:${String(percent)}%"></div></div>` +
    `<div class="goals-tile-stats">` +
    `<span class="goals-tile-figure">${String(open)}</span>` +
    `<span>open of ${String(stats.total)}</span>` +
    `</div>` +
    `<div class="goals-card-meta">` +
    `<span class="goals-due">${icon('layers', 12)}${String(columnCount)} columns</span>` +
    overdue +
    visibility +
    `</div>` +
    `</a>`
  );
}

function renderNewBoardDialog(): string {
  return (
    `<dialog class="goals-dialog" id="goals-new-board-dialog" aria-label="New board">` +
    `<form method="post" action="/p/goals/boards/create">` +
    `<div class="goals-dialog-head"><h2 class="goals-dialog-title">New board</h2>` +
    `<button type="button" class="goals-icon-btn" data-close-dialog aria-label="Close">${icon('x', 16)}</button></div>` +
    `<div class="goals-field"><label for="goals-board-title">Name</label>` +
    `<input class="goals-input" id="goals-board-title" name="title" required maxlength="80" ` +
    `placeholder="Summer plans" autocomplete="off"></div>` +
    `<div class="goals-field"><label for="goals-board-description">What is this board for?</label>` +
    `<input class="goals-input" id="goals-board-description" name="description" maxlength="500" ` +
    `placeholder="Everything we want to do before September"></div>` +
    `<div class="goals-field"><label for="goals-board-visibility">Who can see it</label>` +
    `<select class="goals-select" id="goals-board-visibility" name="visibility">` +
    `<option value="shared">Everyone in the family</option>` +
    `<option value="private">Just me</option>` +
    `</select></div>` +
    `<div class="goals-dialog-foot">` +
    `<button type="button" class="btn btn-ghost" data-close-dialog>Cancel</button>` +
    `<button type="submit" class="btn btn-primary">Create board</button>` +
    `</div></form></dialog>`
  );
}

export function renderBoardsIndex(summaries: BoardSummary[], _actor: Actor): string {
  const head =
    `<div class="goals-head">` +
    `<div>` +
    `<div class="goals-eyebrow">${icon('layers', 12)}Goals</div>` +
    `<h1 class="goals-title">Boards</h1>` +
    `<p class="goals-subtitle">Plans for the family and for yourself, one board at a time.</p>` +
    `</div>` +
    `<div class="goals-actions">` +
    `<a class="btn btn-ghost btn-sm" href="/p/goals/members">${icon('star', 14)}People</a>` +
    `<button type="button" class="btn btn-primary btn-sm" id="goals-new-board">${icon('plus', 14)}New board</button>` +
    `</div>` +
    `</div>`;

  const body =
    summaries.length === 0
      ? `<div class="goals-empty">` +
        `<p class="goals-empty-title">Nothing planned yet</p>` +
        `<p>Create a board to start tracking what you want to get done.</p>` +
        `<p style="margin-top:var(--space-4)">` +
        `<button type="button" class="btn btn-primary" id="goals-new-board-empty">${icon('plus', 14)}New board</button>` +
        `</p></div>`
      : `<div class="goals-board-grid">${summaries.map(renderBoardTile).join('')}</div>`;

  return `<div class="goals-root">${head}${body}${renderNewBoardDialog()}</div>`;
}

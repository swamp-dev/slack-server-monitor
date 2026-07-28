/**
 * The people roster.
 *
 * Members are owned by this plugin, not the app's user table, so someone with
 * no login can still be assigned a goal. Linking an app identity is optional
 * and is what makes `/goals add` auto-assign.
 */
import { escapeHtml, icon } from '../../src/web/plugin-helpers.js';
import type { Actor, Member } from './types.js';
import { renderAvatar } from './view-board.js';

const SWATCHES = ['#7c3aed', '#06b6d4', '#ec4899', '#10b981', '#f59e0b', '#f97316', '#a855f7'];

function renderMember(member: Member, actor: Actor): string {
  const identity = member.identity
    ? `<div class="goals-member-identity">${escapeHtml(member.identity)}</div>`
    : `<div class="goals-member-identity">No login linked</div>`;

  const archiveLabel = member.archived ? 'Restore' : 'Archive';
  const archiveValue = member.archived ? '0' : '1';

  const remove =
    actor.isAdmin && member.archived
      ? `<form method="post" action="/p/goals/members/delete" style="display:inline">` +
        `<input type="hidden" name="memberId" value="${String(member.id)}">` +
        `<button type="submit" class="btn btn-danger btn-sm">Delete</button></form>`
      : '';

  return (
    `<li class="goals-member${member.archived ? ' is-archived' : ''}" data-member-id="${String(member.id)}">` +
    renderAvatar(member, 32) +
    `<div class="goals-member-body">` +
    `<div class="goals-member-name">${escapeHtml(member.displayName)}</div>` +
    identity +
    `</div>` +
    `<form method="post" action="/p/goals/members/archive" style="display:inline">` +
    `<input type="hidden" name="memberId" value="${String(member.id)}">` +
    `<input type="hidden" name="archived" value="${archiveValue}">` +
    `<button type="submit" class="btn btn-ghost btn-sm">${escapeHtml(archiveLabel)}</button>` +
    `</form>` +
    remove +
    `</li>`
  );
}

export function renderMembersPage(members: Member[], actor: Actor): string {
  const active = members.filter((m) => !m.archived);
  const archived = members.filter((m) => m.archived);

  const head =
    `<div class="goals-head"><div>` +
    `<div class="goals-eyebrow">${icon('layers', 12)}<a href="/p/goals/">All boards</a></div>` +
    `<h1 class="goals-title">People</h1>` +
    `<p class="goals-subtitle">Everyone who can be assigned a goal. Add family members who ` +
    `don't have a login here too — linking an account is optional.</p>` +
    `</div></div>`;

  const swatches = SWATCHES.map(
    (color) =>
      `<button type="button" class="goals-menu-dot goals-swatch" data-color="${escapeHtml(color)}" ` +
      `style="background:${escapeHtml(color)};width:20px;height:20px;border:none;cursor:pointer" ` +
      `aria-label="Use ${escapeHtml(color)}"></button>`
  ).join('');

  const form =
    `<div class="card" style="margin-bottom:var(--space-5)">` +
    `<form method="post" action="/p/goals/members/create">` +
    `<div class="goals-row">` +
    `<div class="goals-field"><label for="goals-member-name">Name</label>` +
    `<input class="goals-input" id="goals-member-name" name="name" required maxlength="40" ` +
    `placeholder="Robin" autocomplete="off"></div>` +
    `<div class="goals-field"><label for="goals-member-identity">Linked account</label>` +
    `<input class="goals-input" id="goals-member-identity" name="identity" maxlength="64" ` +
    `placeholder="U012ABC or web:robin" autocomplete="off"></div>` +
    `<div class="goals-field"><label for="goals-member-color">Colour</label>` +
    `<input class="goals-input" id="goals-member-color" name="color" type="color" value="#7c3aed"></div>` +
    `</div>` +
    `<div style="display:flex;gap:6px;align-items:center;margin-bottom:var(--space-3)">${swatches}</div>` +
    `<button type="submit" class="btn btn-primary">${icon('plus', 14)}Add person</button>` +
    `</form></div>`;

  const activeList =
    active.length === 0
      ? `<div class="goals-empty"><p class="goals-empty-title">No one here yet</p>` +
        `<p>Add the people whose goals you want to track.</p></div>`
      : `<ul class="goals-members">${active.map((m) => renderMember(m, actor)).join('')}</ul>`;

  const archivedList =
    archived.length === 0
      ? ''
      : `<h2 class="goals-eyebrow" style="margin-top:var(--space-6)">Archived</h2>` +
        `<ul class="goals-members">${archived.map((m) => renderMember(m, actor)).join('')}</ul>`;

  return `<div class="goals-root">${head}${form}${activeList}${archivedList}</div>`;
}

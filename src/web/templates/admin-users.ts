/**
 * Admin user management page (#277). Renders two sections:
 *   1. Users table with create form + per-row actions (toggle active,
 *      promote/demote, reset password).
 *   2. Invites table with create form + per-row actions (copy URL, delete).
 *
 * All forms POST back to admin routes; no client-side JS required for
 * core flows. A small inline script handles the "copy invite URL"
 * button and "show password" toggle.
 */
import type { User } from '../../types/user.js';
import type { InviteCode } from '../../services/invite-store.js';
import { wrapInShell } from './shell.js';
import { icon } from './icons.js';
import { escapeHtml } from './utils.js';

export interface AdminUsersPageData {
  users: User[];
  invites: InviteCode[];
  /** Base URL used to build registration links from invite codes. */
  baseUrl?: string;
  /** One-time success message (e.g. after a redirect). */
  flash?: string;
  /** One-time error message. */
  error?: string;
}

const styles = `
  .admin-page { max-width: 1100px; margin: 0 auto; padding: 24px; }
  .admin-page h1 {
    font-size: 1.5rem;
    margin: 0 0 4px;
  }
  .admin-page > p {
    color: var(--text-muted);
    margin: 0 0 24px;
  }
  .admin-section {
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 24px;
    margin-bottom: 24px;
    box-shadow: 0 4px 16px var(--shadow);
  }
  .admin-section h2 {
    font-size: 1.125rem;
    margin: 0 0 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text);
  }
  .admin-section h2 svg { color: var(--accent); }
  .admin-section .description {
    color: var(--text-muted);
    font-size: 0.875rem;
    margin: 0 0 16px;
  }
  .admin-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.875rem;
    margin-bottom: 16px;
  }
  .admin-table th, .admin-table td {
    padding: 10px 12px;
    text-align: left;
    border-bottom: 1px solid var(--border);
    vertical-align: middle;
  }
  .admin-table th {
    color: var(--text-muted);
    font-size: 0.6875rem;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .admin-table tbody tr:hover { background: rgba(139,233,253,0.04); }
  .admin-table tbody tr.deactivated { opacity: 0.55; }
  .admin-table .mono { font-family: 'SF Mono', monospace; font-size: 0.8125rem; }
  .role-pill {
    display: inline-block;
    padding: 2px 10px;
    border-radius: 12px;
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .role-pill.admin {
    background: rgba(189,147,249,0.15);
    color: var(--purple);
    border: 1px solid var(--purple);
  }
  .role-pill.user {
    background: rgba(139,233,253,0.10);
    color: var(--cyan);
    border: 1px solid var(--cyan);
  }
  .status-pill {
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--green);
  }
  .status-pill.inactive { color: var(--text-muted); }
  .row-actions {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .row-actions button, .row-actions a {
    padding: 4px 10px;
    font-size: 0.75rem;
    font-family: inherit;
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 5px;
    cursor: pointer;
    text-decoration: none;
  }
  .row-actions button:hover { border-color: var(--accent); }
  .row-actions button.danger:hover { border-color: var(--red); color: var(--red); }
  .row-actions form { display: inline; margin: 0; }
  .admin-form {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 10px;
    align-items: end;
    padding-top: 16px;
    border-top: 1px solid var(--border);
  }
  .admin-form label {
    display: block;
    font-size: 0.75rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 4px;
  }
  .admin-form input, .admin-form select {
    width: 100%;
    padding: 8px 10px;
    font-size: 0.875rem;
    font-family: 'SF Mono', monospace;
    background: var(--code-bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
  }
  .admin-form input:focus, .admin-form select:focus { border-color: var(--accent); outline: none; }
  .admin-form button[type="submit"] {
    padding: 8px 18px;
    font-size: 0.875rem;
    font-family: inherit;
    color: #fff;
    background: linear-gradient(135deg, var(--accent), var(--accent-secondary));
    border: none;
    border-radius: 6px;
    cursor: pointer;
  }
  .admin-form button[type="submit"]:hover { opacity: 0.9; }
  .invite-link {
    word-break: break-all;
    font-size: 0.75rem;
    color: var(--text-muted);
  }
  .copy-btn {
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
    padding: 2px 4px;
    font-size: 0.75rem;
  }
  .copy-btn:hover { text-decoration: underline; }
  .flash {
    padding: 10px 14px;
    border-radius: 6px;
    font-size: 0.875rem;
    margin-bottom: 16px;
  }
  .flash.success {
    background: rgba(80,250,123,0.10);
    border: 1px solid var(--green);
    color: var(--green);
  }
  .flash.error {
    background: rgba(255,85,85,0.15);
    border: 1px solid var(--red);
    color: var(--red);
  }
  .empty-state {
    color: var(--text-muted);
    font-size: 0.875rem;
    padding: 16px;
    text-align: center;
  }
`;

function fmtDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function fmtExpiry(ts: number): string {
  return new Date(ts).toISOString().replace('T', ' ').slice(0, 16) + 'Z';
}

function renderUsersSection(users: User[]): string {
  const rows = users.length === 0
    ? `<tr><td colspan="6" class="empty-state">No users yet.</td></tr>`
    : users.map((u) => `
      <tr class="${u.isActive ? '' : 'deactivated'}">
        <td class="mono">${escapeHtml(u.username ?? '—')}</td>
        <td class="mono">${escapeHtml(u.slackId ?? '—')}</td>
        <td>${escapeHtml(u.displayName ?? '')}</td>
        <td><span class="role-pill ${u.role}">${u.role}</span></td>
        <td><span class="status-pill ${u.isActive ? 'active' : 'inactive'}">${u.isActive ? '● active' : '○ inactive'}</span></td>
        <td>${fmtDate(u.createdAt)}</td>
        <td>
          <div class="row-actions">
            ${u.role === 'admin'
              ? `<form method="POST" action="/admin/users/${String(u.id)}/role"><input type="hidden" name="role" value="user"><button type="submit">Demote</button></form>`
              : `<form method="POST" action="/admin/users/${String(u.id)}/role"><input type="hidden" name="role" value="admin"><button type="submit">Promote</button></form>`}
            <form method="POST" action="/admin/users/${String(u.id)}/toggle-active">
              <button type="submit" class="${u.isActive ? 'danger' : ''}">${u.isActive ? 'Deactivate' : 'Activate'}</button>
            </form>
            <button type="button" class="reset-pw-btn" data-id="${String(u.id)}" data-username="${escapeHtml(u.username ?? u.slackId ?? '')}">Reset password</button>
          </div>
        </td>
      </tr>
    `).join('');

  return `
    <section class="admin-section">
      <h2>${icon('user', 18)} Users (${String(users.length)})</h2>
      <p class="description">Manage user accounts, roles, and access.</p>
      <table class="admin-table">
        <thead>
          <tr>
            <th>Username</th>
            <th>Slack ID</th>
            <th>Display name</th>
            <th>Role</th>
            <th>Status</th>
            <th>Created</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <form class="admin-form" method="POST" action="/admin/users">
        <div>
          <label for="new-slack-id">Slack ID</label>
          <input id="new-slack-id" name="slack_id" type="text" placeholder="U01ABC..." pattern="^U[A-Z0-9]+$">
        </div>
        <div>
          <label for="new-display-name">Display name (optional)</label>
          <input id="new-display-name" name="display_name" type="text" maxlength="200">
        </div>
        <div>
          <label for="new-role">Role</label>
          <select id="new-role" name="role">
            <option value="user">user</option>
            <option value="admin">admin</option>
          </select>
        </div>
        <button type="submit">${icon('plus', 14)} Add user</button>
      </form>
    </section>
  `;
}

function renderInvitesSection(invites: InviteCode[], baseUrl?: string): string {
  const rows = invites.length === 0
    ? `<tr><td colspan="5" class="empty-state">No active invites.</td></tr>`
    : invites.map((i) => {
        // i.code is hex by construction (InviteStore.createInvite), but
        // encodeURIComponent is cheap and keeps this layer agnostic to
        // future code-format changes.
        const url = baseUrl
          ? `${baseUrl.replace(/\/$/, '')}/register?invite=${encodeURIComponent(i.code)}`
          : '';
        return `
          <tr>
            <td class="mono">${escapeHtml(i.code.slice(0, 8))}…</td>
            <td><span class="role-pill ${i.role}">${i.role}</span></td>
            <td class="mono">${escapeHtml(i.slackUserId ?? '—')}</td>
            <td>${fmtExpiry(i.expiresAt)}</td>
            <td>
              <div class="row-actions">
                ${url ? `<button type="button" class="copy-btn" data-url="${escapeHtml(url)}">Copy URL</button>` : ''}
                <form method="POST" action="/admin/invites/${escapeHtml(i.code)}/delete">
                  <button type="submit" class="danger">Delete</button>
                </form>
              </div>
            </td>
          </tr>
        `;
      }).join('');

  return `
    <section class="admin-section">
      <h2>${icon('plus', 18)} Invites (${String(invites.length)})</h2>
      <p class="description">Generate codes for new users to register at <code>/register</code>.</p>
      <table class="admin-table">
        <thead>
          <tr>
            <th>Code</th>
            <th>Role</th>
            <th>Pre-link</th>
            <th>Expires</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <form class="admin-form" method="POST" action="/admin/invites">
        <div>
          <label for="invite-role">Role</label>
          <select id="invite-role" name="role">
            <option value="user">user</option>
            <option value="admin">admin</option>
          </select>
        </div>
        <div>
          <label for="invite-ttl">TTL (hours)</label>
          <input id="invite-ttl" name="ttl_hours" type="number" min="1" max="8760" value="72">
        </div>
        <div>
          <label for="invite-slack">Pre-link Slack ID (optional)</label>
          <input id="invite-slack" name="slack_user_id" type="text" placeholder="U01ABC..." pattern="^U[A-Z0-9]+$">
        </div>
        <button type="submit">${icon('plus', 14)} Generate invite</button>
      </form>
    </section>
  `;
}

const dialogHtml = `
  <dialog id="reset-pw-dialog" style="margin:auto;border:1px solid var(--border);background:var(--card-bg);color:var(--text);border-radius:12px;padding:24px;max-width:400px;">
    <form method="POST" id="reset-pw-form">
      <h3 style="margin:0 0 8px;font-size:1.125rem;">Reset password</h3>
      <p style="margin:0 0 16px;font-size:0.875rem;color:var(--text-muted);" id="reset-pw-target">For user.</p>
      <label for="reset-pw-input" style="display:block;font-size:0.75rem;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);margin-bottom:6px;">New password (min 8 chars)</label>
      <input id="reset-pw-input" name="password" type="password" required minlength="8" autocomplete="new-password" style="width:100%;padding:8px 10px;font-size:0.9375rem;font-family:'SF Mono',monospace;background:var(--code-bg);border:1px solid var(--border);border-radius:6px;color:var(--text);">
      <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end;">
        <button type="button" id="reset-pw-cancel" style="padding:8px 14px;font-family:inherit;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:6px;cursor:pointer;">Cancel</button>
        <button type="submit" style="padding:8px 14px;font-family:inherit;color:#fff;background:linear-gradient(135deg,var(--accent),var(--accent-secondary));border:none;border-radius:6px;cursor:pointer;">Reset password</button>
      </div>
    </form>
  </dialog>
`;

const scripts = `
  <script>
  (function() {
    // Copy-to-clipboard for invite URLs
    document.querySelectorAll('.copy-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var url = btn.getAttribute('data-url');
        if (!url) return;
        navigator.clipboard.writeText(url).then(function() {
          var prev = btn.textContent;
          btn.textContent = 'Copied!';
          setTimeout(function() { btn.textContent = prev; }, 1500);
        });
      });
    });

    // Reset password — proper <dialog> with type="password" so the value
    // is masked and the field has the right autocomplete/security
    // semantics. Avoids both prompt()'s plaintext display and the
    // hidden-field-from-prompt pattern.
    var dialog = document.getElementById('reset-pw-dialog');
    var form = document.getElementById('reset-pw-form');
    var input = document.getElementById('reset-pw-input');
    var cancel = document.getElementById('reset-pw-cancel');
    var target = document.getElementById('reset-pw-target');
    document.querySelectorAll('.reset-pw-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var id = btn.getAttribute('data-id');
        var name = btn.getAttribute('data-username');
        if (!dialog || !form || !input || !target) return;
        form.action = '/admin/users/' + id + '/reset-password';
        target.textContent = 'For ' + (name || 'user #' + id) + '.';
        input.value = '';
        if (typeof dialog.showModal === 'function') dialog.showModal();
        else dialog.setAttribute('open', 'open');
        input.focus();
      });
    });
    if (cancel && dialog) cancel.addEventListener('click', function() { dialog.close(); });
  })();
  </script>
`;

export function renderAdminUsers(data: AdminUsersPageData): string {
  const flashHtml = data.flash
    ? `<div class="flash success">${escapeHtml(data.flash)}</div>`
    : '';
  const errorHtml = data.error
    ? `<div class="flash error">${escapeHtml(data.error)}</div>`
    : '';

  const body = `
    <main class="admin-page">
      <h1>User administration</h1>
      <p>Manage accounts and invites.</p>
      ${errorHtml}
      ${flashHtml}
      ${renderUsersSection(data.users)}
      ${renderInvitesSection(data.invites, data.baseUrl)}
    </main>
    ${dialogHtml}
  `;

  return wrapInShell({
    title: 'User Administration',
    styles,
    body,
    scripts,
    isAuthenticated: true,
    isAdmin: true,
  });
}

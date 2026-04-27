/**
 * Registration page template (#275). Reuses the styles from `renderLogin`
 * by depending on the same `wrapInShell` shell — matching look + feel
 * keeps the auth flow visually coherent.
 */
import { escapeHtml } from './utils.js';
import { icon } from './icons.js';
import { wrapInShell } from './shell.js';

export interface RegisterPagePrefill {
  /** Invite code (typically taken from the `?invite=` query param). */
  inviteCode?: string;
  /** Username to repopulate after a validation error. */
  username?: string;
}

/**
 * Render the `/register` page. Errors are shown inline so the user can
 * correct them without losing the invite code or username they typed.
 *
 * The form posts the same fields back to `POST /register`.
 */
export function renderRegister(error?: string, prefill: RegisterPagePrefill = {}): string {
  const errorHtml = error ? `<div class="login-error">${escapeHtml(error)}</div>` : '';
  const inviteValue = prefill.inviteCode ? escapeHtml(prefill.inviteCode) : '';
  const usernameValue = prefill.username ? escapeHtml(prefill.username) : '';

  const styles = `
    .login-page {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, var(--bg), var(--bg-secondary));
      position: relative;
      overflow: hidden;
    }
    .login-page::before {
      content: '';
      position: absolute;
      inset: 0;
      background-image:
        linear-gradient(var(--border) 1px, transparent 1px),
        linear-gradient(90deg, var(--border) 1px, transparent 1px);
      background-size: 40px 40px;
      opacity: 0.15;
      pointer-events: none;
    }
    .login-form {
      width: 100%;
      max-width: 440px;
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 36px;
      box-shadow: 0 8px 32px var(--shadow);
      position: relative;
      z-index: 1;
    }
    .login-brand { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
    .login-brand svg { color: var(--accent); }
    .login-form h1 { font-size: 1.5rem; }
    .login-subtitle { color: var(--text-muted); font-size: 0.875rem; margin-top: 4px; margin-bottom: 24px; }
    .login-form label { display: block; font-size: 0.875rem; color: var(--text-muted); margin: 14px 0 6px; }
    .login-form label:first-of-type { margin-top: 0; }
    .login-form input {
      width: 100%;
      padding: 10px 12px;
      font-size: 0.9375rem;
      font-family: 'SF Mono', monospace;
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
      outline: none;
      transition: border-color 0.2s;
    }
    .login-form input:focus { border-color: var(--accent); }
    .login-form button[type="submit"] {
      width: 100%;
      margin-top: 20px;
      padding: 10px;
      font-size: 0.9375rem;
      font-family: inherit;
      color: #fff;
      background: linear-gradient(135deg, var(--accent), var(--accent-secondary));
      border: none;
      border-radius: 6px;
      cursor: pointer;
      transition: opacity 0.2s;
    }
    .login-form button[type="submit"]:hover { opacity: 0.9; }
    .login-error {
      background: rgba(255, 85, 85, 0.15);
      border: 1px solid var(--red);
      border-radius: 6px;
      padding: 10px 14px;
      margin-bottom: 16px;
      font-size: 0.875rem;
      color: var(--red);
    }
    .login-help { margin-top: 10px; margin-bottom: 0; font-size: 0.75rem; color: var(--text-muted); }
    .login-back {
      margin-top: 18px;
      text-align: center;
      font-size: 0.875rem;
      color: var(--text-muted);
    }
    .login-back a { color: var(--accent); text-decoration: none; }
    .login-back a:hover { text-decoration: underline; }
  `;

  const bodyHtml = `
  <main class="login-page">
    <form class="login-form" method="POST" action="/register">
      <div class="login-brand">${icon('robot', 28)} <h1>Register</h1></div>
      <p class="login-subtitle">Redeem an invite code to create your account.</p>
      ${errorHtml}

      <label for="invite">Invite code</label>
      <input type="text" id="invite" name="invite" required autocomplete="off"${inviteValue ? ` value="${inviteValue}"` : ''}>

      <label for="username">Username</label>
      <input type="text" id="username" name="username" required autocomplete="username"${usernameValue ? ` value="${usernameValue}"` : ''}>

      <label for="password">Password (min 8 chars)</label>
      <input type="password" id="password" name="password" required autocomplete="new-password" minlength="8">

      <label for="confirm-password">Confirm password</label>
      <input type="password" id="confirm-password" name="confirm_password" required autocomplete="new-password" minlength="8">

      <button type="submit">${icon('check', 16)} Create account</button>
      <p class="login-back"><a href="/login">Back to login</a></p>
    </form>
  </main>`;

  return wrapInShell({
    title: 'Register - Server Monitor',
    styles,
    body: bodyHtml,
    showNav: false,
  });
}

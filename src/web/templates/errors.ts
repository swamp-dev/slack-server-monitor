/**
 * Error and authentication page templates
 */

import { escapeHtml } from './utils.js';
import { icon } from './icons.js';
import { wrapInShell } from './shell.js';

// ─── Error / Auth Pages ────────────────────────────────────────────────

/**
 * Render a 404 error page
 */
export function render404(): string {
  const bodyHtml = `
  <main class="container">
    <div class="empty" style="margin-top: 100px;">
      ${icon('search', 48)}
      <h1 style="font-size: 3rem; margin: 20px 0 12px;">404</h1>
      <p>Page not found.</p>
      <p style="margin-top: 20px;"><a href="/" class="export-btn">${icon('home', 14)} Back to dashboard</a></p>
    </div>
  </main>`;

  return wrapInShell({
    title: 'Not Found',
    styles: '',
    body: bodyHtml,
  });
}

/**
 * Render a 401 unauthorized page with redirect to login
 */
export function render401(returnTo?: string): string {
  const loginUrl = returnTo ? `/login?return_to=${encodeURIComponent(returnTo)}` : '/login';
  const bodyHtml = `
  <main class="container">
    <div class="empty" style="margin-top: 100px;">
      ${icon('eye-off', 48)}
      <h1 style="font-size: 3rem; margin: 20px 0 12px;">401</h1>
      <p>Authentication required.</p>
      <p style="margin-top: 20px;"><a href="${escapeHtml(loginUrl)}" class="export-btn">${icon('logout', 14)} Log in</a> or use the link provided in Slack.</p>
    </div>
  </main>`;

  return wrapInShell({
    title: 'Unauthorized',
    styles: '',
    body: bodyHtml,
    showNav: false,
  });
}

/**
 * Render the login page
 */
export function renderLogin(error?: string, returnTo?: string): string {
  const errorHtml = error
    ? `<div class="login-error">${escapeHtml(error)}</div>`
    : '';
  const returnToInput = returnTo
    ? `<input type="hidden" name="return_to" value="${escapeHtml(returnTo)}">`
    : '';

  const loginStyles = `
    .login-page {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, var(--bg), var(--bg-secondary));
      position: relative;
      overflow: hidden;
    }
    /* Circuit-board background pattern */
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
    .login-brand {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
    }
    .login-brand svg {
      color: var(--accent);
      animation: robot-float 3s ease-in-out infinite;
    }
    @keyframes robot-float {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-4px); }
    }
    .login-form h1 {
      font-size: 1.5rem;
    }
    .login-subtitle {
      color: var(--text-muted);
      font-size: 0.875rem;
      margin-top: 4px;
    }
    .login-form p {
      color: var(--text-muted);
      font-size: 0.875rem;
      margin-bottom: 24px;
    }
    .login-form label {
      display: block;
      font-size: 0.875rem;
      color: var(--text-muted);
      margin-bottom: 6px;
    }
    .login-input-wrapper {
      position: relative;
    }
    .login-form input[type="password"],
    .login-form input[type="text"] {
      width: 100%;
      padding: 10px 64px 10px 12px;
      font-size: 0.9375rem;
      font-family: 'SF Mono', monospace;
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
      outline: none;
      transition: border-color 0.2s;
    }
    .login-form input:focus {
      border-color: var(--accent);
    }
    .toggle-password {
      position: absolute;
      right: 8px;
      top: 50%;
      transform: translateY(-50%);
      background: none;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      padding: 4px;
      display: flex;
    }
    .toggle-password:hover { color: var(--text); }
    .login-form button[type="submit"] {
      width: 100%;
      margin-top: 16px;
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
    .login-form button[type="submit"]:hover {
      opacity: 0.9;
    }
    .login-error {
      background: rgba(255, 85, 85, 0.15);
      border: 1px solid var(--red);
      border-radius: 6px;
      padding: 10px 14px;
      margin-bottom: 16px;
      font-size: 0.875rem;
      color: var(--red);
    }
    /* Token validation checkmark */
    .token-check {
      position: absolute;
      right: 40px;
      top: 50%;
      transform: translateY(-50%) scale(0);
      color: var(--green);
      transition: transform 0.2s ease;
      pointer-events: none;
    }
    .token-check.valid {
      transform: translateY(-50%) scale(1);
    }
    .login-help {
      margin-top: 10px;
      margin-bottom: 0;
      font-size: 0.75rem;
      color: var(--text-muted);
    }
    .login-help code {
      padding: 1px 5px;
      background: var(--code-bg);
      border-radius: 3px;
      font-size: 0.7rem;
    }
  `;

  const bodyHtml = `
  <main class="login-page">
    <form class="login-form" method="POST" action="/login">
      <div class="login-brand">${icon('robot', 28)} <h1>Server Monitor</h1></div>
      <p class="login-subtitle">AI-powered server diagnostics</p>
      <p>Enter your access token to continue.</p>
      ${errorHtml}
      <label for="token">Access Token</label>
      <div class="login-input-wrapper">
        <input type="password" id="token" name="token" required autocomplete="off" autofocus>
        <span class="token-check" id="token-check">${icon('check', 14)}</span>
        <button type="button" class="toggle-password" id="toggle-password" aria-label="Show password">${icon('eye', 16)}</button>
      </div>
      <p class="login-help">Your token is the <code>WEB_AUTH_TOKEN</code> value in your <code>.env</code> file.</p>
      ${returnToInput}
      <button type="submit">${icon('logout', 16)} Log in</button>
    </form>
  </main>`;

  const scripts = `
  <script>
  (function() {
    var btn = document.getElementById('toggle-password');
    var input = document.getElementById('token');
    var check = document.getElementById('token-check');
    if (!btn || !input) return;
    btn.addEventListener('click', function() {
      var isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';
    });
    // Token validation checkmark (min 16 chars matches WEB_AUTH_TOKEN requirement)
    if (input && check) {
      input.addEventListener('input', function() {
        if (input.value.length >= 16) {
          check.classList.add('valid');
        } else {
          check.classList.remove('valid');
        }
      });
    }
  })();
  </script>`;

  return wrapInShell({
    title: 'Login - Server Monitor',
    styles: loginStyles,
    body: bodyHtml,
    scripts,
    showNav: false,
  });
}

/**
 * Render a generic error page
 */
export function renderError(message: string): string {
  const bodyHtml = `
  <main class="container">
    <div class="empty" style="margin-top: 100px;">
      ${icon('x', 48)}
      <h1 style="font-size: 2rem; margin: 20px 0 12px;">Error</h1>
      <p>${escapeHtml(message)}</p>
      <p style="margin-top: 20px;"><a href="/" class="export-btn">${icon('home', 14)} Back to dashboard</a></p>
    </div>
  </main>`;

  return wrapInShell({
    title: 'Error',
    styles: '',
    body: bodyHtml,
  });
}

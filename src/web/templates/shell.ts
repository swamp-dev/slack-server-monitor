/**
 * HTML shell / layout wrapper
 */

import { escapeHtml } from './utils.js';
import { getThemeStyles } from './theme.js';
import { getBaseStyles, getAnimationStyles } from './styles.js';
import { icon } from './icons.js';
import { getKeyboardShortcutScript, getKeyboardHelpOverlay } from './keyboard.js';

// ─── Shell / Layout ────────────────────────────────────────────────────

export interface ShellOptions {
  title: string;
  styles: string;
  body: string;
  scripts?: string;
  showNav?: boolean;
  highlightJs?: boolean;
}

/**
 * Wrap page content in the full HTML shell with nav, theme, fonts
 */
export function wrapInShell(opts: ShellOptions): string {
  const { title, styles: pageStyles, body, scripts = '', showNav = true, highlightJs = false } = opts;

  const hljsLink = highlightJs
    ? `<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css" integrity="sha384-wH75j6z1lH97ZOpMOInqhgKzFkAInZPPSPlZpYKYTOqsaizPvhQZmAtLcPKXpLyH" crossorigin="anonymous">`
    : '';
  const hljsScript = highlightJs
    ? `<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js" integrity="sha384-F/bZzf7p3Joyp5psL90p/p89AZJsndkSoGwRpXcZhleCWhd8SnRuoYo4d0yirjJp" crossorigin="anonymous"></script>
  <script>hljs.highlightAll();</script>`
    : '';

  const navHtml = showNav ? `
  <nav class="nav-bar">
    <a href="/" class="nav-brand">${icon('robot', 22)} Server Monitor</a>
    <button class="nav-hamburger" id="nav-hamburger" type="button" aria-label="Menu">${icon('chevron-down', 20)}</button>
    <div class="nav-actions" id="nav-actions">
      <button class="theme-toggle" id="theme-toggle" type="button" aria-label="Toggle theme"><span class="icon-sun">${icon('sun', 18)}</span><span class="icon-moon">${icon('moon', 18)}</span></button>
      <form method="POST" action="/logout" style="margin:0;">
        <button class="logout-btn" type="submit" aria-label="Log out">${icon('logout', 18)}</button>
      </form>
    </div>
  </nav>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='none' stroke='%23ff79c6' stroke-width='1.5'%3E%3Crect x='4' y='6' width='12' height='10' rx='2'/%3E%3Ccircle cx='7.5' cy='11' r='1.5'/%3E%3Ccircle cx='12.5' cy='11' r='1.5'/%3E%3Cpath d='M10 2v4M6 6V4M14 6V4'/%3E%3C/svg%3E">
  <title>${escapeHtml(title)}</title>
  ${hljsLink}
  <script>
    (function() {
      try {
        var raw = localStorage.getItem('ssm-theme');
        if (raw === 'dracula' || raw === 'light') {
          document.documentElement.setAttribute('data-theme', raw);
        } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
          document.documentElement.setAttribute('data-theme', 'light');
        } else {
          document.documentElement.setAttribute('data-theme', 'dracula');
        }
      } catch(e) {}
    })();
  </script>
  <style>${getThemeStyles()}${getBaseStyles()}${getAnimationStyles()}${pageStyles}</style>
</head>
<body>
  ${navHtml}
  ${body}
  <footer>
    <div class="container">
      ${icon('robot', 14)} Powered by Claude
    </div>
  </footer>
  <div class="toast-container" id="toast-container"></div>
  ${hljsScript}
  <script>
  function showToast(msg, type) {
    var c = document.getElementById('toast-container');
    if (!c) return;
    var d = document.createElement('div');
    d.className = 'toast ' + (type || 'success');
    d.textContent = msg;
    c.appendChild(d);
    setTimeout(function() {
      d.classList.add('removing');
      setTimeout(function() { d.remove(); }, 300);
    }, 3000);
  }
  // Theme toggle
  (function() {
    var btn = document.getElementById('theme-toggle');
    if (!btn) return;
    btn.addEventListener('click', function() {
      var current = document.documentElement.getAttribute('data-theme') || 'dracula';
      var next = current === 'dracula' ? 'light' : 'dracula';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('ssm-theme', next);
    });
  })();
  // Hamburger menu
  (function() {
    var btn = document.getElementById('nav-hamburger');
    var actions = document.getElementById('nav-actions');
    if (!btn || !actions) return;
    btn.addEventListener('click', function() {
      actions.classList.toggle('open');
    });
  })();
  </script>
  ${getKeyboardShortcutScript()}
  ${scripts}
  ${getKeyboardHelpOverlay()}
</body>
</html>`;
}

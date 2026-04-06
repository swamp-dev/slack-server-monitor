/**
 * Theme system - CSS variables for Dracula and light themes
 */

// ─── Theme System ──────────────────────────────────────────────────────

/**
 * CSS variables for Dracula (default) and light themes
 */
export function getThemeStyles(): string {
  return `
  :root, [data-theme="dracula"] {
    --bg: #282a36;
    --bg-secondary: #1e1f29;
    --surface: #44475a;
    --surface-hover: #525568;
    --text: #f8f8f2;
    --text-muted: #6272a4;
    --text-muted-boost: #8893b5;
    --accent: #ff79c6;
    --accent-secondary: #bd93f9;
    --cyan: #8be9fd;
    --green: #50fa7b;
    --orange: #ffb86c;
    --purple: #bd93f9;
    --red: #ff5555;
    --yellow: #f1fa8c;
    --pink: #ff79c6;
    --code-bg: #21222c;
    --border: #44475a;
    --shadow: rgba(0, 0, 0, 0.3);
    --card-bg: #2d2f3d;
    --nav-bg: #21222c;
    --link: #8be9fd;
    color-scheme: dark;
  }

  [data-theme="light"] {
    --bg: #f8f8f2;
    --bg-secondary: #eee;
    --surface: #e8e8e2;
    --surface-hover: #d8d8d2;
    --text: #282a36;
    --text-muted: #6272a4;
    --text-muted-boost: #6272a4;
    --accent: #d6368f;
    --accent-secondary: #7c4ddb;
    --cyan: #0e7490;
    --green: #16803c;
    --orange: #c2410c;
    --purple: #7c3aed;
    --red: #dc2626;
    --yellow: #a16207;
    --pink: #d6368f;
    --code-bg: #e8e8e2;
    --border: #d4d4d4;
    --shadow: rgba(0, 0, 0, 0.08);
    --card-bg: #fff;
    --nav-bg: #fff;
    --link: #0e7490;
    color-scheme: light;
  }

  /* View Transitions API (Chrome 111+): handles cross-document transitions
     automatically. The JS overlay in shell.ts is a fallback for older browsers.
     Browsers that don't support this at-rule ignore it safely. */
  @view-transition {
    navigation: auto;
  }
  ::view-transition-old(root) {
    animation: 150ms ease-out both fade-out;
  }
  ::view-transition-new(root) {
    animation: 200ms ease-out both fade-in;
  }
  @keyframes fade-out {
    to { opacity: 0; }
  }
  @keyframes fade-in {
    from { opacity: 0; }
  }
  /* Keep nav bar fully static during view transitions */
  ::view-transition-group(nav) { animation: none; }
  ::view-transition-old(nav),
  ::view-transition-new(nav) { animation: none; mix-blend-mode: normal; }
  `;
}

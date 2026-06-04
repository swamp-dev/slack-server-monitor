/**
 * Theme system - CSS variables for Cosmic (dark) and light themes
 */

// ─── Theme System ──────────────────────────────────────────────────────

/**
 * CSS variables for Cosmic/Dracula (default) and light themes.
 * Selectors keep 'dracula' / 'light' so existing localStorage prefs work.
 */
export function getThemeStyles(): string {
  return `
  :root, [data-theme="dracula"] {
    /* ── Backgrounds ────────────────────────────────────────── */
    --bg: #05050f;
    --bg-secondary: #080816;
    --surface: #0d0d20;
    --surface-hover: #13132e;
    --card-bg: #11112a;
    --nav-bg: rgba(8,8,22,0.85);
    --code-bg: #080816;

    /* ── Borders & Shadows ──────────────────────────────────── */
    --border: rgba(255,255,255,0.07);
    --shadow-sm: 0 1px 3px rgba(0,0,0,0.5);
    --shadow: 0 4px 16px rgba(0,0,0,0.6);
    --shadow-lg: 0 8px 32px rgba(0,0,0,0.7);
    --shadow-xl: 0 16px 64px rgba(0,0,0,0.8);

    /* ── Surface alpha (theme-aware layering) ────────────────── */
    --surface-alpha: rgba(255,255,255,0.04);
    --hover-alpha: rgba(255,255,255,0.08);
    --glass-bg: rgba(255,255,255,0.02);
    --glass-border: rgba(255,255,255,0.08);

    /* ── Text ───────────────────────────────────────────────── */
    --text: #e2e8f0;
    --text-muted: #64748b;
    --text-muted-boost: #94a3b8;

    /* ── Accent / Brand ─────────────────────────────────────── */
    --accent: #7c3aed;
    --accent-secondary: #4f46e5;
    --accent-glow: rgba(124,58,237,0.4);
    --link: #818cf8;

    /* ── Semantic Colors ────────────────────────────────────── */
    --green: #10b981;
    --yellow: #f59e0b;
    --orange: #f97316;
    --red: #ef4444;
    --cyan: #06b6d4;
    --pink: #ec4899;
    --purple: #a855f7;

    /* ── Gradients ──────────────────────────────────────────── */
    --gradient-primary: linear-gradient(135deg, #7c3aed 0%, #4f46e5 50%, #06b6d4 100%);
    --gradient-accent: linear-gradient(135deg, #7c3aed, #ec4899);
    --gradient-card: linear-gradient(135deg, rgba(124,58,237,0.05) 0%, rgba(6,182,212,0.03) 100%);

    /* ── Typography Scale ───────────────────────────────────── */
    --text-xs: 0.75rem;
    --text-sm: 0.875rem;
    --text-base: 1rem;
    --text-lg: 1.125rem;
    --text-xl: 1.25rem;
    --text-2xl: 1.5rem;
    --text-3xl: 1.875rem;
    --text-4xl: 2.25rem;

    /* ── Spacing Scale (4px base) ───────────────────────────── */
    --space-1: 4px;
    --space-2: 8px;
    --space-3: 12px;
    --space-4: 16px;
    --space-5: 20px;
    --space-6: 24px;
    --space-8: 32px;
    --space-10: 40px;
    --space-12: 48px;
    --space-16: 64px;

    /* ── Border Radius ──────────────────────────────────────── */
    --radius-sm: 4px;
    --radius: 6px;
    --radius-md: 8px;
    --radius-lg: 12px;
    --radius-xl: 16px;
    --radius-2xl: 24px;
    --radius-full: 9999px;

    color-scheme: dark;
  }

  [data-theme="light"] {
    /* ── Backgrounds ────────────────────────────────────────── */
    --bg: #f8fafc;
    --bg-secondary: #f1f5f9;
    --surface: #f1f5f9;
    --surface-hover: #e2e8f0;
    --card-bg: #ffffff;
    --nav-bg: rgba(248,250,252,0.9);
    --code-bg: #f1f5f9;

    /* ── Borders & Shadows ──────────────────────────────────── */
    --border: rgba(0,0,0,0.08);
    --shadow-sm: 0 1px 3px rgba(0,0,0,0.08);
    --shadow: 0 4px 16px rgba(0,0,0,0.1);
    --shadow-lg: 0 8px 32px rgba(0,0,0,0.12);
    --shadow-xl: 0 16px 64px rgba(0,0,0,0.15);

    /* ── Surface alpha (inverted for light: dark-on-light) ───── */
    --surface-alpha: rgba(0,0,0,0.04);
    --hover-alpha: rgba(0,0,0,0.06);
    --glass-bg: rgba(0,0,0,0.02);
    --glass-border: rgba(0,0,0,0.1);

    /* ── Text ───────────────────────────────────────────────── */
    --text: #0f172a;
    --text-muted: #64748b;
    --text-muted-boost: #475569;

    /* ── Accent / Brand ─────────────────────────────────────── */
    --accent: #7c3aed;
    --accent-secondary: #4f46e5;
    --accent-glow: rgba(124,58,237,0.2);
    --link: #4f46e5;

    /* ── Semantic Colors ────────────────────────────────────── */
    --green: #059669;
    --yellow: #d97706;
    --orange: #ea580c;
    --red: #dc2626;
    --cyan: #0891b2;
    --pink: #db2777;
    --purple: #9333ea;

    /* ── Gradients ──────────────────────────────────────────── */
    --gradient-primary: linear-gradient(135deg, #7c3aed 0%, #4f46e5 50%, #06b6d4 100%);
    --gradient-accent: linear-gradient(135deg, #7c3aed, #ec4899);
    --gradient-card: linear-gradient(135deg, rgba(124,58,237,0.04) 0%, rgba(6,182,212,0.02) 100%);

    /* Scale tokens inherit from dark theme (same values, no override needed) */

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

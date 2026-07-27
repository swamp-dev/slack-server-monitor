/**
 * Goals stylesheet.
 *
 * Selectors are written unscoped and passed through `renderPluginPage`'s
 * `styles` option, which prefixes each one with `.plugin-goals` and leaves
 * at-rule preludes intact. styles.test.ts asserts nothing here is hand-prefixed
 * (that would double up) and that the media queries and keyframes survive.
 *
 * Because every rule ends up scoped under `.plugin-goals`, the drag ghost and
 * the move menu are appended to `.goals-root` rather than `document.body` —
 * see client-js.ts. `.goals-root` also owns the custom properties below.
 *
 * The design extends the app's cosmic-dark system rather than introducing a
 * second identity: violet accent, the existing spacing and radius scale, the
 * existing type scale. It spends its boldness in one place — picking up a card.
 */

export const GOALS_CSS = `
.goals-root {
  --goals-rail: 3px;
  --goals-column-width: 300px;
  --goals-card-radius: var(--radius-lg);
}

/* ── Board chrome ─────────────────────────────────────────────── */

.goals-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
  flex-wrap: wrap;
  margin-bottom: var(--space-5);
}
.goals-title {
  font-size: var(--text-3xl);
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.1;
  margin: 0;
}
.goals-subtitle {
  color: var(--text-muted);
  font-size: var(--text-sm);
  margin: var(--space-2) 0 0;
  max-width: 60ch;
}
.goals-eyebrow {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: var(--space-2);
}
.goals-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

/* Progress across the whole board, one segment per column. */
.goals-trajectory {
  display: flex;
  height: 6px;
  border-radius: var(--radius-full);
  overflow: hidden;
  background: var(--surface);
  margin-bottom: var(--space-5);
}
.goals-trajectory-seg {
  transition: flex-grow 400ms cubic-bezier(0.22, 1, 0.36, 1);
  min-width: 2px;
}
.goals-trajectory-seg + .goals-trajectory-seg {
  border-left: 1px solid var(--bg);
}

/* ── The board ────────────────────────────────────────────────── */

/*
 * The shell caps .container at 1100px. A kanban board needs the whole
 * viewport, so break out of it and re-apply the container's own padding.
 */
.goals-board-scroll {
  width: 100vw;
  margin-left: calc(50% - 50vw);
  padding: var(--space-2) var(--space-6) var(--space-6);
  overflow-x: auto;
  overflow-y: visible;
  scrollbar-width: thin;
}
.goals-board {
  display: flex;
  align-items: flex-start;
  gap: var(--space-4);
  min-height: 60vh;
}

.goals-column {
  flex: 0 0 var(--goals-column-width);
  width: var(--goals-column-width);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  padding: var(--space-3);
  position: relative;
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 220px);
}
/* The rail encodes this column's share of the board. */
.goals-column::before {
  content: '';
  position: absolute;
  left: 0;
  top: var(--space-4);
  bottom: var(--space-4);
  width: var(--goals-rail);
  border-radius: var(--radius-full);
  background: linear-gradient(
    to bottom,
    var(--goals-column-color) 0%,
    var(--goals-column-color) var(--goals-column-share),
    var(--surface-hover) var(--goals-column-share),
    var(--surface-hover) 100%
  );
}
.goals-column.is-drop-target {
  border-color: var(--goals-column-color);
  background: var(--surface-hover);
}

.goals-column-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2) var(--space-3) var(--space-3);
}
.goals-column-name {
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text);
  margin: 0;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.goals-column-count {
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
  background: var(--surface-hover);
  border-radius: var(--radius-full);
  padding: 2px 8px;
}
.goals-column-count.is-over {
  color: var(--orange);
  background: color-mix(in srgb, var(--orange) 18%, transparent);
}

.goals-cards {
  list-style: none;
  margin: 0;
  padding: 0 var(--space-1);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  overflow-y: auto;
  flex: 1;
  min-height: 60px;
}
.goals-column-foot {
  padding: var(--space-2) var(--space-1) 0;
}

/* ── Cards ────────────────────────────────────────────────────── */

.goals-card {
  position: relative;
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: var(--goals-card-radius);
  padding: var(--space-3);
  cursor: pointer;
  touch-action: pan-y;
  transition:
    transform 160ms cubic-bezier(0.22, 1, 0.36, 1),
    border-color 160ms ease,
    box-shadow 160ms ease;
}
.goals-card:hover {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  transform: translateY(-1px);
}
.goals-card:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

/* The lift — the one deliberately loud moment on the page. */
.goals-card.is-dragging {
  opacity: 0.3;
  transform: none;
}
.goals-ghost {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 60;
  width: var(--goals-column-width);
  pointer-events: none;
  will-change: transform;
  transform-origin: 12% 50%;
  rotate: 2deg;
  scale: 1.03;
  box-shadow:
    0 18px 40px rgba(0, 0, 0, 0.45),
    0 0 0 1px var(--accent),
    0 0 32px var(--accent-glow);
}
.goals-placeholder {
  border: 1px dashed color-mix(in srgb, var(--accent) 60%, transparent);
  border-radius: var(--goals-card-radius);
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  animation: goals-breathe 1.6s ease-in-out infinite;
}
@keyframes goals-breathe {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}
.goals-card.just-landed {
  animation: goals-land 320ms cubic-bezier(0.34, 1.56, 0.64, 1);
}
@keyframes goals-land {
  0% { transform: scale(1.04); }
  100% { transform: scale(1); }
}

.goals-card-title {
  font-size: var(--text-sm);
  font-weight: 500;
  line-height: 1.4;
  margin: 0;
  color: var(--text);
  overflow-wrap: anywhere;
}
.goals-card.is-done .goals-card-title {
  color: var(--text-muted);
  text-decoration: line-through;
  text-decoration-color: color-mix(in srgb, var(--text-muted) 60%, transparent);
}
.goals-card-meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
  margin-top: var(--space-3);
}
.goals-card-meta:empty {
  display: none;
}

/* Due-date temperature: how much attention this needs, at a glance. */
.goals-due {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  padding: 2px 8px;
  border-radius: var(--radius-full);
  color: var(--text-muted);
  background: var(--surface-hover);
  white-space: nowrap;
}
.goals-due.is-overdue {
  color: var(--red);
  background: color-mix(in srgb, var(--red) 16%, transparent);
}
.goals-due.is-today {
  color: var(--yellow);
  background: color-mix(in srgb, var(--yellow) 16%, transparent);
}
.goals-due.is-soon {
  color: var(--cyan);
  background: color-mix(in srgb, var(--cyan) 14%, transparent);
}

.goals-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: var(--radius-full);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
  flex-shrink: 0;
}
.goals-comment-count {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--text-xs);
  color: var(--text-muted);
}
.goals-card-actions {
  position: absolute;
  top: 6px;
  right: 6px;
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity 120ms ease;
}
.goals-card:hover .goals-card-actions,
.goals-card:focus-within .goals-card-actions {
  opacity: 1;
}
.goals-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: var(--radius);
  background: var(--surface-alpha);
  color: var(--text-muted);
  cursor: pointer;
  padding: 0;
}
.goals-icon-btn:hover {
  background: var(--surface-hover);
  color: var(--text);
}
.goals-grip {
  cursor: grab;
  touch-action: none;
}
.goals-grip:active {
  cursor: grabbing;
}

/* ── Move menu (the keyboard and touch path) ──────────────────── */

.goals-menu {
  position: fixed;
  z-index: 70;
  min-width: 200px;
  max-height: 60vh;
  overflow-y: auto;
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  padding: var(--space-1);
}
.goals-menu-label {
  padding: var(--space-2) var(--space-3) var(--space-1);
  font-size: var(--text-xs);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.goals-menu-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-2) var(--space-3);
  border: none;
  border-radius: var(--radius);
  background: none;
  color: var(--text);
  font-size: var(--text-sm);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}
.goals-menu-item:hover:not(:disabled),
.goals-menu-item:focus-visible {
  background: var(--surface-hover);
  outline: none;
}
.goals-menu-item:disabled {
  color: var(--text-muted);
  cursor: default;
  opacity: 0.5;
}
.goals-menu-dot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  flex-shrink: 0;
}

/* ── Forms and dialogs ────────────────────────────────────────── */

.goals-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: var(--space-3);
}
.goals-field label {
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.goals-input,
.goals-textarea,
.goals-select {
  width: 100%;
  padding: 9px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-secondary);
  color: var(--text);
  font-family: inherit;
  font-size: var(--text-sm);
}
.goals-input:focus,
.goals-textarea:focus,
.goals-select:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-glow);
}
.goals-textarea {
  min-height: 96px;
  resize: vertical;
  line-height: 1.5;
}
.goals-row {
  display: flex;
  gap: var(--space-2);
  align-items: flex-end;
  flex-wrap: wrap;
}
.goals-row > * {
  flex: 1 1 140px;
  min-width: 0;
}
.goals-quick-add {
  display: flex;
  gap: var(--space-2);
}
.goals-quick-add .goals-input {
  flex: 1;
}

.goals-dialog {
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: var(--card-bg);
  color: var(--text);
  padding: var(--space-5);
  width: min(560px, calc(100vw - 2rem));
  box-shadow: var(--shadow-xl);
}
.goals-dialog::backdrop {
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(2px);
}
.goals-dialog-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}
.goals-dialog-title {
  font-size: var(--text-lg);
  font-weight: 600;
  margin: 0;
}
.goals-dialog-foot {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-4);
}

/* ── Card detail ──────────────────────────────────────────────── */

.goals-detail-desc {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--text);
  line-height: 1.6;
  font-size: var(--text-sm);
}
.goals-detail-empty {
  color: var(--text-muted);
  font-style: italic;
  font-size: var(--text-sm);
}
.goals-comments {
  list-style: none;
  margin: var(--space-3) 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.goals-comment {
  display: flex;
  gap: var(--space-3);
}
.goals-comment-body {
  flex: 1;
  min-width: 0;
}
.goals-comment-head {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  margin-bottom: 2px;
}
.goals-comment-author {
  font-size: var(--text-sm);
  font-weight: 600;
}
.goals-comment-time {
  font-size: var(--text-xs);
  color: var(--text-muted);
}
.goals-comment-text {
  font-size: var(--text-sm);
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin: 0;
}

/* ── Board index ──────────────────────────────────────────────── */

.goals-board-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--space-4);
}
.goals-tile {
  display: block;
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  padding: var(--space-5);
  color: inherit;
  text-decoration: none;
  transition:
    transform 160ms cubic-bezier(0.22, 1, 0.36, 1),
    border-color 160ms ease;
}
.goals-tile:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--accent) 50%, var(--border));
}
.goals-tile-title {
  font-size: var(--text-lg);
  font-weight: 600;
  margin: 0 0 var(--space-1);
  letter-spacing: -0.01em;
}
.goals-tile-desc {
  font-size: var(--text-sm);
  color: var(--text-muted);
  margin: 0 0 var(--space-4);
  min-height: 1.4em;
}
.goals-tile-stats {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  font-size: var(--text-xs);
  color: var(--text-muted);
  margin-top: var(--space-2);
}
.goals-tile-figure {
  font-size: var(--text-2xl);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--text);
  letter-spacing: -0.02em;
}
.goals-meter {
  height: 4px;
  border-radius: var(--radius-full);
  background: var(--surface);
  overflow: hidden;
}
.goals-meter-fill {
  height: 100%;
  background: var(--gradient-primary);
  border-radius: var(--radius-full);
  transition: width 400ms cubic-bezier(0.22, 1, 0.36, 1);
}

/* ── Members ──────────────────────────────────────────────────── */

.goals-members {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.goals-member {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
}
.goals-member.is-archived {
  opacity: 0.55;
}
.goals-member-name {
  font-weight: 500;
  font-size: var(--text-sm);
}
.goals-member-identity {
  font-size: var(--text-xs);
  color: var(--text-muted);
  font-family: 'SF Mono', monospace;
}
.goals-member-body {
  flex: 1;
  min-width: 0;
}

/* ── Misc ─────────────────────────────────────────────────────── */

.goals-empty {
  text-align: center;
  padding: var(--space-10) var(--space-4);
  color: var(--text-muted);
}
.goals-empty-title {
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--text);
  margin: 0 0 var(--space-2);
}
.goals-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.goals-hint {
  font-size: var(--text-xs);
  color: var(--text-muted);
  margin-top: var(--space-3);
}

@media (max-width: 900px) {
  .goals-board-scroll {
    padding-left: var(--space-3);
    padding-right: var(--space-3);
  }
  .goals-column {
    max-height: none;
  }
  .goals-title {
    font-size: var(--text-2xl);
  }
}

@media (max-width: 640px) {
  {
    --goals-column-width: 82vw;
  }
  .goals-head {
    flex-direction: column;
    align-items: stretch;
  }
  .goals-card-actions {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .goals-ghost {
    rotate: none;
    scale: 1;
  }
  .goals-placeholder {
    animation: none;
    opacity: 1;
  }
  .goals-card.just-landed {
    animation: none;
  }
  .goals-card,
  .goals-tile,
  .goals-meter-fill,
  .goals-trajectory-seg {
    transition: none;
  }
}
`;

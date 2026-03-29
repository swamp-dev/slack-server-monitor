/**
 * Template barrel re-exports
 *
 * Preserves the public API of the original monolithic templates.ts.
 * All consumers import from this file.
 */

export { icon } from './icons.js';
export { getThemeStyles } from './theme.js';
export { getBaseStyles, getAnimationStyles } from './styles.js';
export { wrapInShell, type ShellOptions } from './shell.js';
export { renderDashboard } from './dashboard.js';
export { renderSessionList } from './session-list.js';
export { renderConversation } from './conversation.js';
export { renderMarkdownExport } from './export.js';
export { render404, render401, renderLogin, renderError } from './errors.js';

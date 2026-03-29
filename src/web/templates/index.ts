/**
 * Template barrel exports
 *
 * Re-exports only the public API that was originally exported from templates.ts.
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
export { renderNotificationBell, renderNotificationDropdown, renderNotificationPage } from './notifications.js';

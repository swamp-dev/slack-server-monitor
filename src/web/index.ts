/**
 * Web module for hosting long Claude responses
 */

export { startWebServer, stopWebServer, getConversationUrl } from './server.js';
export {
  renderConversation,
  renderSessionList,
  render404,
  render401,
  renderLogin,
  renderError,
} from './templates.js';
export { resolveToken, parseCookies, type TokenIdentity } from './auth.js';

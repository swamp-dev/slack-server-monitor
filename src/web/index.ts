/**
 * Web module for hosting long Claude responses
 */

export { startWebServer, stopWebServer, getConversationUrl } from './server.js';
export {
  renderConversation,
  render404,
  render401,
  renderError,
} from './templates.js';

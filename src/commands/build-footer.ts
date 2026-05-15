import type { WebConfig } from '../config/index.js';
import { getConversationUrl } from '../web/index.js';

export interface FooterOptions {
  toolCalls: number;
  tokens: number;
  threadTs: string;
  channelId: string;
  userId: string;
  historyMsgs?: number;
  showReplyHint?: boolean;
  /** Pre-built web URL (avoids minting a second HMAC token when one already exists) */
  webUrl?: string;
  /** Web config — used to generate a URL only when webUrl is not provided */
  webConfig?: WebConfig;
}

/**
 * Build the context footer string for Claude responses.
 * Returns a pipe-separated, italicized metadata line.
 */
export function buildFooter(opts: FooterOptions): string {
  const parts: string[] = [
    `Tools used: ${String(opts.toolCalls)}`,
    `Tokens: ${opts.tokens.toLocaleString()}`,
  ];

  if (opts.historyMsgs !== undefined) {
    parts.push(`History: ${String(opts.historyMsgs)} msgs`);
  }

  if (opts.showReplyHint) {
    parts.push('Reply in thread to continue');
  }

  parts.push(`\`/ask continue ${opts.threadTs}\``);

  // Use pre-built URL if provided, otherwise generate from webConfig
  let url = opts.webUrl;
  if (!url) {
    const { webConfig } = opts;
    const webEnabled = webConfig && webConfig.enabled && webConfig.baseUrl;
    if (webEnabled) {
      url = getConversationUrl(opts.threadTs, opts.channelId, webConfig, opts.userId);
    }
  }
  if (url) {
    parts.push(`<${url}|View in UI>`);
  }

  return `_${parts.join(' | ')}_`;
}

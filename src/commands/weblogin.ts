import type { App, SlackCommandMiddlewareArgs, AllMiddlewareArgs } from '@slack/bolt';
import { config } from '../config/index.js';
import { createLinkToken } from '../web/auth.js';
import { logger } from '../utils/logger.js';
import {
  section,
  error as errorBlock,
} from '../formatters/blocks.js';

/**
 * Register the /weblogin command
 *
 * Generates a short-lived HMAC magic link for the web UI.
 * The link is posted as an ephemeral message (only visible to the requesting user).
 */
export function registerWebLoginCommand(app: App): void {
  app.command('/weblogin', async ({ command, ack, respond }: SlackCommandMiddlewareArgs & AllMiddlewareArgs) => {
    await ack();

    const webConfig = config.web;
    if (!webConfig?.enabled || !webConfig.baseUrl) {
      await respond({
        blocks: [errorBlock('Web UI is not enabled. Set `WEB_ENABLED=true` and `WEB_BASE_URL` to use this command.')],
        response_type: 'ephemeral',
      });
      return;
    }

    const userId = command.user_id;
    const token = createLinkToken(userId, webConfig.authToken, webConfig.linkTokenTtlMinutes);
    const loginUrl = `${webConfig.baseUrl}/c?token=${encodeURIComponent(token)}`;

    logger.info('Web login link generated', { userId });

    await respond({
      blocks: [
        section(`*Web UI Login*\nClick to access the web UI (link expires in ${String(webConfig.linkTokenTtlMinutes)} minutes):\n<${loginUrl}|Open Web UI>`),
      ],
      response_type: 'ephemeral',
    });
  });
}

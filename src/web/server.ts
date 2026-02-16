/**
 * Web server for hosting long Claude responses
 *
 * Provides a simple HTTP server that renders conversation pages.
 * Used when responses exceed Slack's block text limit.
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import type { Server } from 'http';
import { config, type WebConfig } from '../config/index.js';
import { getConversationStore } from '../services/conversation-store.js';
import { logger } from '../utils/logger.js';
import { renderConversation, renderMarkdownExport, render404, render401 } from './templates.js';

let server: Server | null = null;

/**
 * Token authentication middleware
 * Validates the token query parameter against the configured auth token
 */
function authMiddleware(webConfig: WebConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const token = req.query.token;

    if (!token || token !== webConfig.authToken) {
      logger.warn('Unauthorized web access attempt', {
        ip: req.ip,
        path: req.path,
        hasToken: !!token,
      });
      res.status(401).send(render401());
      return;
    }

    next();
  };
}

/**
 * Start the web server
 *
 * @param webConfig - Web server configuration
 * @returns Promise that resolves when server is listening
 */
export async function startWebServer(webConfig: WebConfig): Promise<void> {
  if (!config.claude) {
    logger.warn('Web server requires Claude to be enabled');
    return;
  }

  const claudeConfig = config.claude;
  const app = express();

  // Security headers
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    next();
  });

  // Apply auth middleware to conversation routes
  app.use('/c', authMiddleware(webConfig));

  // Conversation endpoint: GET /c/:threadTs/:channelId?token=<authToken>
  app.get('/c/:threadTs/:channelId', (req: Request, res: Response) => {
    const threadTs = req.params.threadTs;
    const channelId = req.params.channelId;

    // Type guard: params could be string or string[]
    if (!threadTs || !channelId || typeof threadTs !== 'string' || typeof channelId !== 'string') {
      res.status(400).send(render404());
      return;
    }

    try {
      const store = getConversationStore(claudeConfig.dbPath, claudeConfig.conversationTtlHours);
      const conversation = store.getConversation(threadTs, channelId);

      if (!conversation) {
        logger.debug('Conversation not found for web view', { threadTs, channelId });
        res.status(404).send(render404());
        return;
      }

      // Get tool calls for this conversation
      const toolCalls = store.getToolCalls(conversation.id);

      // Render the conversation page
      const html = renderConversation(conversation.messages, toolCalls, {
        threadTs: conversation.threadTs,
        channelId: conversation.channelId,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
      });

      res.type('html').send(html);

      logger.debug('Served conversation web page', {
        threadTs,
        channelId,
        messageCount: conversation.messages.length,
        toolCallCount: toolCalls.length,
      });
    } catch (err) {
      logger.error('Error serving conversation', {
        error: err instanceof Error ? err.message : String(err),
        threadTs,
        channelId,
      });
      res.status(500).send(render404());
    }
  });

  // Markdown export endpoint: GET /c/:threadTs/:channelId/export/md?token=<authToken>&tools=true|false
  app.get('/c/:threadTs/:channelId/export/md', (req: Request, res: Response) => {
    const threadTs = req.params.threadTs;
    const channelId = req.params.channelId;

    if (!threadTs || !channelId || typeof threadTs !== 'string' || typeof channelId !== 'string') {
      res.status(400).send(render404());
      return;
    }

    try {
      const store = getConversationStore(claudeConfig.dbPath, claudeConfig.conversationTtlHours);
      const conversation = store.getConversation(threadTs, channelId);

      if (!conversation) {
        res.status(404).send(render404());
        return;
      }

      const includeTools = req.query.tools !== 'false';
      const toolCalls = includeTools ? store.getToolCalls(conversation.id) : [];

      const md = renderMarkdownExport(conversation.messages, toolCalls, {
        threadTs: conversation.threadTs,
        channelId: conversation.channelId,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
      });

      res.type('text/markdown');
      res.setHeader('Content-Disposition', `attachment; filename="conversation-${threadTs}.md"`);
      res.send(md);

      logger.debug('Served markdown export', { threadTs, channelId, includeTools });
    } catch (err) {
      logger.error('Error exporting conversation', {
        error: err instanceof Error ? err.message : String(err),
        threadTs,
        channelId,
      });
      res.status(500).send(render404());
    }
  });

  // Health check endpoint (no auth required)
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  // 404 for everything else
  app.use((_req: Request, res: Response) => {
    res.status(404).send(render404());
  });

  return new Promise((resolve, reject) => {
    try {
      // Bind to 0.0.0.0 for local network access
      server = app.listen(webConfig.port, '0.0.0.0', () => {
        const baseUrl = webConfig.baseUrl ?? `http://localhost:${String(webConfig.port)}`;
        logger.info('Web server started', {
          port: webConfig.port,
          baseUrl,
        });
        resolve();
      });

      server.on('error', (err) => {
        logger.error('Web server error', { error: err.message });
        reject(err);
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/**
 * Stop the web server
 */
export async function stopWebServer(): Promise<void> {
  const serverInstance = server;
  if (!serverInstance) {
    return;
  }

  return new Promise((resolve, reject) => {
    serverInstance.close((err) => {
      if (err) {
        logger.error('Error stopping web server', { error: err.message });
        reject(err);
      } else {
        logger.info('Web server stopped');
        server = null;
        resolve();
      }
    });
  });
}

/**
 * Generate a web URL for a conversation
 *
 * @param threadTs - Thread timestamp
 * @param channelId - Channel ID
 * @param webConfig - Web configuration
 * @returns Full URL with authentication token
 */
export function getConversationUrl(
  threadTs: string,
  channelId: string,
  webConfig: WebConfig
): string {
  const baseUrl = webConfig.baseUrl ?? `http://localhost:${String(webConfig.port)}`;
  return `${baseUrl}/c/${threadTs}/${channelId}?token=${encodeURIComponent(webConfig.authToken)}`;
}

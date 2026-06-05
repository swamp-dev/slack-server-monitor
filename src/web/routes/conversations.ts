import { Router, type Request, type Response } from 'express';
import type { Config } from '../../config/schema.js';
import { getConversationStore } from '../../services/conversation-store.js';
import { processConversationTurn } from '../../services/conversation-processor.js';
import { checkAndRecordClaudeRequest } from '../../services/claude-rate-limit.js';
import { getSharedSSEManager } from '../sse.js';
import { logger } from '../../utils/logger.js';
import {
  renderConversation,
  renderMarkdownExport,
  renderSessionList,
  render404,
  renderError,
} from '../templates/index.js';
import { formatMarkdown } from '../templates/utils.js';
import { getUserFilterIds, isConversationOwner } from '../middleware/auth.js';
import { parsePagination, attachTags } from './helpers.js';

type ClaudeConfig = NonNullable<Config['claude']>;

export function createConversationsRouter(claudeConfig: ClaudeConfig, dbPath: string): Router {
  const router = Router();

  // GET / — session list
  router.get('/', (req: Request, res: Response) => {
    try {
      const store = getConversationStore(claudeConfig.dbPath, claudeConfig.conversationTtlHours);
      const { page, pageSize, offset } = parsePagination(req);

      const userId = res.locals.userId as string;
      const filterIds = getUserFilterIds(res, dbPath);
      const adminViewingOwn = filterIds === undefined && req.query.mine === 'true';
      const effectiveFilter = filterIds ?? (adminViewingOwn ? userId : undefined);
      const showMine = filterIds !== undefined || adminViewingOwn;

      const sessions = store.listRecentSessions(pageSize, offset, effectiveFilter);
      attachTags(sessions, store);
      const totalItems = store.countSessions(effectiveFilter);
      const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
      const allTags = store.listAllTags(effectiveFilter);

      const html = renderSessionList(sessions, { page, pageSize, totalItems, totalPages }, { allTags, currentUserId: userId, showMine });
      res.type('html').send(html);
    } catch (err) {
      logger.error('Error serving session list', { error: err instanceof Error ? err.message : String(err) });
      res.status(500).send(renderError('Failed to load conversations.'));
    }
  });

  // GET /search
  router.get('/search', (req: Request, res: Response) => {
    try {
      const store = getConversationStore(claudeConfig.dbPath, claudeConfig.conversationTtlHours);
      const { page, pageSize, offset } = parsePagination(req);
      const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';

      if (!query) {
        res.redirect(302, '/c');
        return;
      }

      const filterIds = getUserFilterIds(res, dbPath);
      const sessions = store.searchConversations(query, pageSize, offset, filterIds);
      attachTags(sessions, store);
      const totalItems = store.countSearchResults(query, filterIds);
      const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
      const allTags = store.listAllTags(filterIds);

      const html = renderSessionList(sessions, { page, pageSize, totalItems, totalPages }, { searchQuery: query, allTags });
      res.type('html').send(html);
    } catch (err) {
      logger.error('Error serving search results', { error: err instanceof Error ? err.message : String(err) });
      res.status(500).send(renderError('Failed to search conversations.'));
    }
  });

  // GET /favorites
  router.get('/favorites', (req: Request, res: Response) => {
    try {
      const store = getConversationStore(claudeConfig.dbPath, claudeConfig.conversationTtlHours);
      const { page, pageSize, offset } = parsePagination(req);

      const filterIds = getUserFilterIds(res, dbPath);
      const sessions = store.listFavoriteSessions(pageSize, offset, filterIds);
      attachTags(sessions, store);
      const totalItems = store.countFavoriteSessions(filterIds);
      const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
      const allTags = store.listAllTags(filterIds);

      const html = renderSessionList(sessions, { page, pageSize, totalItems, totalPages }, { favorites: true, allTags });
      res.type('html').send(html);
    } catch (err) {
      logger.error('Error serving favorites', { error: err instanceof Error ? err.message : String(err) });
      res.status(500).send(renderError('Failed to load favorites.'));
    }
  });

  // GET /archived
  router.get('/archived', (req: Request, res: Response) => {
    try {
      const store = getConversationStore(claudeConfig.dbPath, claudeConfig.conversationTtlHours);
      const { page, pageSize, offset } = parsePagination(req);

      const filterIds = getUserFilterIds(res, dbPath);
      const sessions = store.listArchivedSessions(pageSize, offset, filterIds);
      const totalItems = store.countArchivedSessions(filterIds);
      const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

      const html = renderSessionList(sessions, { page, pageSize, totalItems, totalPages }, { archived: true });
      res.type('html').send(html);
    } catch (err) {
      logger.error('Error serving archived session list', { error: err instanceof Error ? err.message : String(err) });
      res.status(500).send(renderError('Failed to load archived conversations.'));
    }
  });

  // GET /tag/:tag
  router.get('/tag/:tag', (req: Request, res: Response) => {
    try {
      const store = getConversationStore(claudeConfig.dbPath, claudeConfig.conversationTtlHours);
      const { page, pageSize, offset } = parsePagination(req);
      const tag = typeof req.params.tag === 'string' ? req.params.tag : '';

      const filterIds = getUserFilterIds(res, dbPath);
      const sessions = store.listSessionsByTag(tag, pageSize, offset, filterIds);
      attachTags(sessions, store);
      const totalItems = store.countSessionsByTag(tag, filterIds);
      const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
      const allTags = store.listAllTags(filterIds);

      const html = renderSessionList(sessions, { page, pageSize, totalItems, totalPages }, { activeTag: tag, allTags });
      res.type('html').send(html);
    } catch (err) {
      logger.error('Error serving tag-filtered sessions', { error: err instanceof Error ? err.message : String(err) });
      res.status(500).send(renderError('Failed to load tagged conversations.'));
    }
  });

  // POST /:id/favorite
  router.post('/:id/favorite', (req: Request, res: Response) => {
    try {
      const store = getConversationStore(claudeConfig.dbPath, claudeConfig.conversationTtlHours);
      const id = parseInt(typeof req.params.id === 'string' ? req.params.id : '', 10);
      if (isNaN(id)) {
        res.status(400).json({ error: 'Invalid conversation ID' });
        return;
      }
      const conversation = store.getConversationById(id);
      if (!conversation || !isConversationOwner(conversation, res, dbPath)) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      const isFavorited = store.toggleFavorite(id);
      res.json({ isFavorited });
    } catch (err) {
      logger.error('Error toggling favorite', { error: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: 'Failed to toggle favorite' });
    }
  });

  // POST /:id/tag
  router.post('/:id/tag', (req: Request, res: Response) => {
    try {
      const store = getConversationStore(claudeConfig.dbPath, claudeConfig.conversationTtlHours);
      const id = parseInt(typeof req.params.id === 'string' ? req.params.id : '', 10);
      const body = req.body as Record<string, unknown>;
      const tag = typeof body.tag === 'string' ? body.tag.trim().toLowerCase() : '';

      if (isNaN(id) || !tag) {
        res.status(400).json({ error: 'Invalid conversation ID or tag' });
        return;
      }

      if (tag.length > 50 || !/^[a-z0-9][a-z0-9-_]*$/.test(tag)) {
        res.status(400).json({ error: 'Tag must be 1-50 characters, alphanumeric with hyphens/underscores' });
        return;
      }

      const conversation = store.getConversationById(id);
      if (!conversation || !isConversationOwner(conversation, res, dbPath)) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      store.addTag(id, tag);
      res.json({ tags: store.getTags(id) });
    } catch (err) {
      logger.error('Error adding tag', { error: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: 'Failed to add tag' });
    }
  });

  // DELETE /:id/tag/:tag
  router.delete('/:id/tag/:tag', (req: Request, res: Response) => {
    try {
      const store = getConversationStore(claudeConfig.dbPath, claudeConfig.conversationTtlHours);
      const id = parseInt(typeof req.params.id === 'string' ? req.params.id : '', 10);
      const tag = typeof req.params.tag === 'string' ? req.params.tag : '';

      if (isNaN(id) || !tag) {
        res.status(400).json({ error: 'Invalid conversation ID or tag' });
        return;
      }

      const conversation = store.getConversationById(id);
      if (!conversation || !isConversationOwner(conversation, res, dbPath)) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      store.removeTag(id, tag);
      res.json({ tags: store.getTags(id) });
    } catch (err) {
      logger.error('Error removing tag', { error: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: 'Failed to remove tag' });
    }
  });

  // POST /:id/archive
  router.post('/:id/archive', (req: Request, res: Response) => {
    try {
      const store = getConversationStore(claudeConfig.dbPath, claudeConfig.conversationTtlHours);
      const id = parseInt(typeof req.params.id === 'string' ? req.params.id : '', 10);
      if (isNaN(id)) {
        res.status(400).json({ error: 'Invalid conversation ID' });
        return;
      }
      const conversation = store.getConversationById(id);
      if (!conversation || !isConversationOwner(conversation, res, dbPath)) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      const archived = store.archiveConversation(id);
      res.json({ archived });
    } catch (err) {
      logger.error('Error archiving conversation', { error: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: 'Failed to archive conversation' });
    }
  });

  // POST /:id/fork
  router.post('/:id/fork', (req: Request, res: Response) => {
    try {
      const store = getConversationStore(claudeConfig.dbPath, claudeConfig.conversationTtlHours);
      const id = parseInt(typeof req.params.id === 'string' ? req.params.id : '', 10);
      const body = req.body as Record<string, unknown>;
      const messageIndex = typeof body.messageIndex === 'number' ? body.messageIndex : -1;

      if (isNaN(id)) {
        res.status(400).json({ error: 'Invalid conversation ID' });
        return;
      }
      if (!Number.isInteger(messageIndex) || messageIndex < 0) {
        res.status(400).json({ error: 'messageIndex is required and must be a non-negative integer' });
        return;
      }

      const parent = store.getConversationById(id);
      if (!parent) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }
      if (!isConversationOwner(parent, res, dbPath)) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      const branch = store.branchConversation(id, messageIndex, res.locals.userId as string);
      res.json({ threadTs: branch.threadTs, channelId: branch.channelId, id: branch.id });
    } catch (err) {
      logger.error('Error forking conversation', { error: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: 'Failed to fork conversation' });
    }
  });

  // GET /:threadTs/:channelId — conversation view
  router.get('/:threadTs/:channelId', (req: Request, res: Response) => {
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
        logger.debug('Conversation not found for web view', { threadTs, channelId });
        res.status(404).send(render404());
        return;
      }
      if (!isConversationOwner(conversation, res, dbPath)) {
        // Don't leak existence to non-owners — render the same 404 they'd
        // see for a truly missing thread.
        logger.debug('Conversation access denied (non-owner)', {
          threadTs,
          channelId,
          requesterId: res.locals.userId as string,
        });
        res.status(404).send(render404());
        return;
      }

      const toolCalls = store.getToolCalls(conversation.id);
      const tags = store.getTags(conversation.id);
      const branches = store.listBranches(conversation.id).map((b) => ({
        threadTs: b.threadTs,
        channelId: b.channelId,
        createdAt: b.createdAt,
        branchPointIndex: b.branchPointIndex,
      }));
      const html = renderConversation(conversation.messages, toolCalls, {
        threadTs: conversation.threadTs,
        channelId: conversation.channelId,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        canContinue: true,
        conversationId: conversation.id,
        isFavorited: conversation.favoritedAt != null,
        tags,
        userId: conversation.userId,
        contextStatus: conversation.contextStatus,
        parentConversationId: conversation.parentConversationId,
        branchPointIndex: conversation.branchPointIndex,
        branches,
      });

      res.type('html').send(html);

      logger.debug('Served conversation web page', {
        threadTs,
        channelId,
        userId: res.locals.userId as string,
        messageCount: conversation.messages.length,
        toolCallCount: toolCalls.length,
      });
    } catch (err) {
      logger.error('Error serving conversation', {
        error: err instanceof Error ? err.message : String(err),
        threadTs,
        channelId,
      });
      res.status(500).send(renderError('An unexpected error occurred.'));
    }
  });

  // POST /:threadTs/:channelId/ask — continue conversation
  router.post('/:threadTs/:channelId/ask', (req: Request, res: Response) => {
    const threadTs = req.params.threadTs;
    const channelId = req.params.channelId;

    if (!threadTs || !channelId || typeof threadTs !== 'string' || typeof channelId !== 'string') {
      res.status(400).json({ error: 'Invalid parameters' });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const message = typeof body.message === 'string' ? body.message.trim() : '';

    if (!message) {
      res.status(400).json({ error: 'Message is required' });
      return;
    }

    if (message.length > 4000) {
      res.status(400).json({ error: 'Message is too long (max 4000 characters)' });
      return;
    }

    const userId = res.locals.userId as string | undefined;
    if (!userId) {
      logger.error('Web continuation reached without authenticated user', { threadTs, channelId });
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (!checkAndRecordClaudeRequest(userId)) {
      res.status(429).json({ error: 'Rate limit exceeded. Please wait before asking another question.' });
      return;
    }

    try {
      const store = getConversationStore(claudeConfig.dbPath, claudeConfig.conversationTtlHours);

      const existing = store.getConversation(threadTs, channelId);
      if (existing && !isConversationOwner(existing, res, dbPath)) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      const conversation = store.getOrCreateConversation(threadTs, channelId, userId, message);

      if (conversation.messages.length <= 1) {
        res.status(404).json({ error: 'Conversation not found or has expired' });
        return;
      }

      res.json({ success: true });

      const streamChannel = `conversation:${threadTs}:${channelId}`;
      processConversationTurn({
        conversationId: conversation.id,
        threadTs,
        channelId,
        userId,
        userMessage: message,
        claudeConfig,
        askOptions: {
          onProgress: (event) => {
            if (event.type !== 'done') {
              getSharedSSEManager()?.broadcast(streamChannel, event.type, event);
            }
          },
        },
      })
        .then((result) => {
          getSharedSSEManager()?.broadcast(streamChannel, 'done', {
            type: 'done',
            responseHtml: formatMarkdown(result.response),
          });
        })
        .catch((err: unknown) => {
          const errMessage = err instanceof Error ? err.message : 'An unexpected error occurred';
          logger.error('Web continuation failed', { error: errMessage, threadTs, channelId, userId });
          getSharedSSEManager()?.broadcast(streamChannel, 'error', { type: 'error', message: errMessage });
        });
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : 'An unexpected error occurred';
      logger.error('Error in web continuation setup', { error: errMessage, threadTs, channelId });
      res.status(500).json({ error: errMessage });
    }
  });

  // GET /:threadTs/:channelId/stream — SSE conversation stream
  router.get('/:threadTs/:channelId/stream', (req: Request, res: Response) => {
    const threadTs = req.params.threadTs;
    const channelId = req.params.channelId;
    if (!threadTs || !channelId || typeof threadTs !== 'string' || typeof channelId !== 'string') {
      res.status(400).json({ error: 'Invalid parameters' });
      return;
    }

    const userId = res.locals.userId as string | undefined;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const store = getConversationStore(claudeConfig.dbPath, claudeConfig.conversationTtlHours);
    const conversation = store.getConversation(threadTs, channelId);
    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }
    if (!isConversationOwner(conversation, res, dbPath)) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    getSharedSSEManager()?.addClient(`conversation:${threadTs}:${channelId}`, res);
  });

  // GET /:threadTs/:channelId/export/md — markdown export
  router.get('/:threadTs/:channelId/export/md', (req: Request, res: Response) => {
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
      if (!isConversationOwner(conversation, res, dbPath)) {
        // Don't leak existence to non-owners — same 404 as a missing thread.
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
      res.status(500).send(renderError('An unexpected error occurred.'));
    }
  });

  return router;
}

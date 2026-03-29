import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import type { Server } from 'http';

// Mock the config module before importing anything that uses it
vi.mock('../../src/config/index.js', () => ({
  config: {
    claude: {
      dbPath: ':memory:',
      conversationTtlHours: 24,
    },
    web: {
      enabled: true,
      port: 0, // Let OS pick a port
      baseUrl: 'http://localhost:8080',
      authToken: 'test-auth-token-1234',
    },
  },
}));

// Mock the logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock the conversation store
const mockConversation = {
  id: 1,
  threadTs: '1234567890.123456',
  channelId: 'C123ABC',
  userId: 'U123ABC',
  messages: [
    { role: 'user' as const, content: 'What is the status?' },
    { role: 'assistant' as const, content: 'All systems operational.' },
  ],
  createdAt: Date.now() - 60000,
  updatedAt: Date.now(),
};

const mockToolCalls = [
  {
    id: 1,
    conversationId: 1,
    toolName: 'get_container_status',
    input: { container: 'nginx' },
    outputPreview: 'running',
    timestamp: Date.now(),
    durationMs: null as number | null,
    success: true,
  },
];

vi.mock('../../src/services/conversation-store.js', () => ({
  getConversationStore: vi.fn(() => ({
    getConversation: vi.fn((threadTs: string, channelId: string) => {
      if (threadTs === '1234567890.123456' && channelId === 'C123ABC') {
        return mockConversation;
      }
      return null;
    }),
    getToolCalls: vi.fn(() => mockToolCalls),
  })),
}));

import { renderConversation, renderMarkdownExport, render404, render401 } from '../../src/web/templates.js';

// Create a test server that mirrors the real server's behavior
function createTestServer(authToken: string) {
  const app = express();

  // Auth middleware
  app.use('/c', (req, res, next) => {
    const token = req.query.token;
    if (!token || token !== authToken) {
      res.status(401).send(render401());
      return;
    }
    next();
  });

  // Conversation endpoint
  app.get('/c/:threadTs/:channelId', (req, res) => {
    const { threadTs, channelId } = req.params;

    if (!threadTs || !channelId) {
      res.status(400).send(render404());
      return;
    }

    // Simulate conversation lookup
    if (threadTs === '1234567890.123456' && channelId === 'C123ABC') {
      const html = renderConversation(mockConversation.messages, mockToolCalls, {
        threadTs: mockConversation.threadTs,
        channelId: mockConversation.channelId,
        createdAt: mockConversation.createdAt,
        updatedAt: mockConversation.updatedAt,
      });
      res.type('html').send(html);
    } else {
      res.status(404).send(render404());
    }
  });

  // Markdown export endpoint
  app.get('/c/:threadTs/:channelId/export/md', (req, res) => {
    const { threadTs, channelId } = req.params;

    if (!threadTs || !channelId) {
      res.status(400).send(render404());
      return;
    }

    if (threadTs === '1234567890.123456' && channelId === 'C123ABC') {
      const includeTools = req.query.tools !== 'false';
      const toolCalls = includeTools ? mockToolCalls : [];
      const md = renderMarkdownExport(mockConversation.messages, toolCalls, {
        threadTs: mockConversation.threadTs,
        channelId: mockConversation.channelId,
        createdAt: mockConversation.createdAt,
        updatedAt: mockConversation.updatedAt,
      });
      res.type('text/markdown');
      res.setHeader('Content-Disposition', `attachment; filename="conversation-${threadTs}.md"`);
      res.send(md);
    } else {
      res.status(404).send(render404());
    }
  });

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // 404 for everything else
  app.use((_req, res) => {
    res.status(404).send(render404());
  });

  return app;
}

describe('web server integration', () => {
  let server: Server;
  let baseUrl: string;
  const authToken = 'test-auth-token-1234';

  beforeAll(async () => {
    const app = createTestServer(authToken);
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          baseUrl = `http://localhost:${String(addr.port)}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });

  describe('authentication', () => {
    it('should return 401 for requests without token', async () => {
      const response = await fetch(`${baseUrl}/c/1234567890.123456/C123ABC`);
      expect(response.status).toBe(401);
      const text = await response.text();
      expect(text).toContain('401');
      expect(text).toContain('Authentication required');
    });

    it('should return 401 for requests with invalid token', async () => {
      const response = await fetch(`${baseUrl}/c/1234567890.123456/C123ABC?token=wrong-token`);
      expect(response.status).toBe(401);
    });

    it('should allow requests with valid token', async () => {
      const response = await fetch(`${baseUrl}/c/1234567890.123456/C123ABC?token=${authToken}`);
      expect(response.status).toBe(200);
    });
  });

  describe('conversation endpoint', () => {
    it('should return conversation HTML for valid conversation', async () => {
      const response = await fetch(`${baseUrl}/c/1234567890.123456/C123ABC?token=${authToken}`);
      expect(response.status).toBe(200);

      const html = await response.text();
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('What is the status?');
      expect(html).toContain('All systems operational.');
      expect(html).toContain('get_container_status');
    });

    it('should return 404 for non-existent conversation', async () => {
      const response = await fetch(`${baseUrl}/c/9999999999.999999/CNOTFOUND?token=${authToken}`);
      expect(response.status).toBe(404);

      const html = await response.text();
      expect(html).toContain('404');
      expect(html).toContain('not found');
    });
  });

  describe('health endpoint', () => {
    it('should return OK without authentication', async () => {
      const response = await fetch(`${baseUrl}/health`);
      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json).toEqual({ status: 'ok' });
    });
  });

  describe('markdown export endpoint', () => {
    it('should return markdown with Content-Disposition header', async () => {
      const response = await fetch(`${baseUrl}/c/1234567890.123456/C123ABC/export/md?token=${authToken}`);
      expect(response.status).toBe(200);

      const contentType = response.headers.get('content-type');
      expect(contentType).toContain('text/markdown');

      const disposition = response.headers.get('content-disposition');
      expect(disposition).toContain('attachment');
      expect(disposition).toContain('conversation-1234567890.123456.md');

      const md = await response.text();
      expect(md).toContain('# Claude Conversation');
      expect(md).toContain('What is the status?');
      expect(md).toContain('All systems operational.');
    });

    it('should include tool calls by default', async () => {
      const response = await fetch(`${baseUrl}/c/1234567890.123456/C123ABC/export/md?token=${authToken}`);
      const md = await response.text();

      expect(md).toContain('## Tool Calls');
      expect(md).toContain('get_container_status');
    });

    it('should exclude tool calls when tools=false', async () => {
      const response = await fetch(`${baseUrl}/c/1234567890.123456/C123ABC/export/md?token=${authToken}&tools=false`);
      const md = await response.text();

      expect(md).toContain('What is the status?');
      expect(md).not.toContain('## Tool Calls');
    });

    it('should return 404 for non-existent conversation export', async () => {
      const response = await fetch(`${baseUrl}/c/9999999999.999999/CNOTFOUND/export/md?token=${authToken}`);
      expect(response.status).toBe(404);
    });

    it('should require authentication for export', async () => {
      const response = await fetch(`${baseUrl}/c/1234567890.123456/C123ABC/export/md`);
      expect(response.status).toBe(401);
    });
  });

  describe('404 handling', () => {
    it('should return 404 for unknown routes', async () => {
      const response = await fetch(`${baseUrl}/unknown/path`);
      expect(response.status).toBe(404);
    });
  });
});

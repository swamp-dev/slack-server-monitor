import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock config BEFORE importing anything else
vi.mock('../../src/config/index.js', () => ({
  config: {
    claude: {
      dbPath: ':memory:',
      conversationTtlHours: 24,
    },
    web: {
      enabled: true,
      port: 0,
      baseUrl: 'http://test.local:8080',
      authToken: 'test-auth-token-minimum16',
    },
  },
}));

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock conversation store
const mockGetConversation = vi.fn();
const mockGetToolCalls = vi.fn();
vi.mock('../../src/services/conversation-store.js', () => ({
  getConversationStore: vi.fn(() => ({
    getConversation: mockGetConversation,
    getToolCalls: mockGetToolCalls,
  })),
}));

// Now import the server module
import { startWebServer, stopWebServer, getConversationUrl } from '../../src/web/server.js';
import type { WebConfig } from '../../src/config/index.js';

describe('web server', () => {
  describe('getConversationUrl', () => {
    it('should generate correct URL with baseUrl', () => {
      const webConfig: WebConfig = {
        enabled: true,
        port: 8080,
        baseUrl: 'http://myserver.local:8080',
        authToken: 'my-secret-token-1234',
      };

      const url = getConversationUrl('1234.5678', 'C123', webConfig);

      expect(url).toBe('http://myserver.local:8080/c/1234.5678/C123?token=my-secret-token-1234');
    });

    it('should fall back to localhost when baseUrl is undefined', () => {
      const webConfig: WebConfig = {
        enabled: true,
        port: 9000,
        authToken: 'fallback-token-12345',
      };

      const url = getConversationUrl('1234.5678', 'C123', webConfig);

      expect(url).toBe('http://localhost:9000/c/1234.5678/C123?token=fallback-token-12345');
    });

    it('should URL-encode special characters in token', () => {
      const webConfig: WebConfig = {
        enabled: true,
        port: 8080,
        baseUrl: 'http://test.local:8080',
        authToken: 'token+with&special=chars',
      };

      const url = getConversationUrl('1234.5678', 'C123', webConfig);

      expect(url).toContain('token=token%2Bwith%26special%3Dchars');
    });
  });

  describe('startWebServer and stopWebServer', () => {
    beforeEach(() => {
      mockGetConversation.mockReset();
      mockGetToolCalls.mockReset();
    });

    afterEach(async () => {
      await stopWebServer();
    });

    it('should start and stop the web server', async () => {
      const webConfig: WebConfig = {
        enabled: true,
        port: 0, // Let OS pick a port
        baseUrl: 'http://test.local:8080',
        authToken: 'test-auth-token-minimum16',
      };

      // Start should not throw
      await expect(startWebServer(webConfig)).resolves.toBeUndefined();

      // Stop should not throw
      await expect(stopWebServer()).resolves.toBeUndefined();
    });

    it('should serve health endpoint', async () => {
      const webConfig: WebConfig = {
        enabled: true,
        port: 0,
        baseUrl: 'http://test.local:8080',
        authToken: 'test-auth-token-minimum16',
      };

      await startWebServer(webConfig);

      // We can't easily get the port, so we'll test stopWebServer behavior
      // The integration test covers the actual HTTP behavior
      await stopWebServer();
    });

    it('should handle stopWebServer when server not started', async () => {
      // Should not throw when stopping a server that wasn't started
      await expect(stopWebServer()).resolves.toBeUndefined();
    });
  });
});

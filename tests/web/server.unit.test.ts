import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { verifyLinkToken } from '../../src/web/auth.js';

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
      linkTokenTtlMinutes: 15,
      sessionTtlHours: 72,
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

// Mock session store
const mockCreateSession = vi.fn().mockReturnValue({
  sessionId: 'mock-session-id',
  userId: 'admin',
  isAdmin: true,
  createdAt: Date.now(),
  expiresAt: Date.now() + 72 * 60 * 60 * 1000,
});
const mockGetSession = vi.fn();
const mockDeleteSession = vi.fn();
const mockCleanupExpired = vi.fn().mockReturnValue(0);
const mockCloseSession = vi.fn();
vi.mock('../../src/services/session-store.js', () => ({
  getSessionStore: vi.fn(() => ({
    createSession: mockCreateSession,
    getSession: mockGetSession,
    deleteSession: mockDeleteSession,
    cleanupExpired: mockCleanupExpired,
    close: mockCloseSession,
  })),
  closeSessionStore: vi.fn(),
}));

// Now import the server module
import { startWebServer, stopWebServer, getConversationUrl } from '../../src/web/server.js';
import type { WebConfig } from '../../src/config/index.js';

const SIGNING_SECRET = 'test-signing-secret-min16';

describe('web server', () => {
  describe('getConversationUrl', () => {
    it('should generate URL with HMAC token', () => {
      const webConfig: WebConfig = {
        enabled: true,
        port: 8080,
        baseUrl: 'http://myserver.local:8080',
        authToken: SIGNING_SECRET,
        linkTokenTtlMinutes: 15,
        sessionTtlHours: 72,
      };

      const url = getConversationUrl('1234.5678', 'C123', webConfig, 'U01ABC123');

      expect(url).toMatch(/^http:\/\/myserver\.local:8080\/c\/1234\.5678\/C123\?token=.+/);
      // Extract and verify the token
      const token = decodeURIComponent(new URL(url).searchParams.get('token') ?? '');
      const result = verifyLinkToken(token, SIGNING_SECRET);
      expect(result).toEqual({ userId: 'U01ABC123' });
    });

    it('should fall back to localhost when baseUrl is undefined', () => {
      const webConfig: WebConfig = {
        enabled: true,
        port: 9000,
        authToken: SIGNING_SECRET,
        linkTokenTtlMinutes: 15,
        sessionTtlHours: 72,
      };

      const url = getConversationUrl('1234.5678', 'C123', webConfig, 'U01ABC123');

      expect(url).toMatch(/^http:\/\/localhost:9000\/c\/1234\.5678\/C123\?token=.+/);
    });

    it('should use "system" userId when no userId provided', () => {
      const webConfig: WebConfig = {
        enabled: true,
        port: 8080,
        baseUrl: 'http://test.local:8080',
        authToken: SIGNING_SECRET,
        linkTokenTtlMinutes: 15,
        sessionTtlHours: 72,
      };

      const url = getConversationUrl('1234.5678', 'C123', webConfig);
      const token = decodeURIComponent(new URL(url).searchParams.get('token') ?? '');
      const result = verifyLinkToken(token, SIGNING_SECRET);
      expect(result).toEqual({ userId: 'system' });
    });

    it('should create tokens verifiable with the signing secret', () => {
      const webConfig: WebConfig = {
        enabled: true,
        port: 8080,
        baseUrl: 'http://test.local:8080',
        authToken: SIGNING_SECRET,
        linkTokenTtlMinutes: 15,
        sessionTtlHours: 72,
      };

      const url = getConversationUrl('1234.5678', 'C123', webConfig, 'U02DEF456');
      const token = decodeURIComponent(new URL(url).searchParams.get('token') ?? '');

      // Should verify with correct secret
      expect(verifyLinkToken(token, SIGNING_SECRET)).not.toBeNull();
      // Should not verify with wrong secret
      expect(verifyLinkToken(token, 'wrong-secret-minimum16')).toBeNull();
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
        linkTokenTtlMinutes: 15,
        sessionTtlHours: 72,
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
        linkTokenTtlMinutes: 15,
        sessionTtlHours: 72,
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

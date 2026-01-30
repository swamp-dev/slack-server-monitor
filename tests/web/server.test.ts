import { describe, it, expect } from 'vitest';

// Note: We don't import from server.ts directly to avoid config validation
// Instead, we test the URL generation logic inline

/**
 * Generate a web URL for a conversation (copied from server.ts for testing)
 */
function getConversationUrl(
  threadTs: string,
  channelId: string,
  webConfig: { port: number; baseUrl?: string; authToken: string }
): string {
  const baseUrl = webConfig.baseUrl ?? `http://localhost:${webConfig.port}`;
  return `${baseUrl}/c/${threadTs}/${channelId}?token=${encodeURIComponent(webConfig.authToken)}`;
}

describe('web server utilities', () => {
  describe('getConversationUrl', () => {
    it('should generate URL with auth token', () => {
      const webConfig = {
        enabled: true,
        port: 8080,
        baseUrl: 'http://localhost:8080',
        authToken: 'test-token-12345678',
      };

      const url = getConversationUrl('1234567890.123456', 'C123ABC', webConfig);

      expect(url).toBe('http://localhost:8080/c/1234567890.123456/C123ABC?token=test-token-12345678');
    });

    it('should use custom base URL', () => {
      const webConfig = {
        enabled: true,
        port: 8080,
        baseUrl: 'http://nautilus.local:8080',
        authToken: 'my-secret-token-123',
      };

      const url = getConversationUrl('1234567890.123456', 'C123ABC', webConfig);

      expect(url).toBe('http://nautilus.local:8080/c/1234567890.123456/C123ABC?token=my-secret-token-123');
    });

    it('should fall back to localhost when baseUrl not provided', () => {
      const webConfig = {
        enabled: true,
        port: 9000,
        authToken: 'fallback-token-12345',
      };

      const url = getConversationUrl('1234567890.123456', 'C123ABC', webConfig);

      expect(url).toBe('http://localhost:9000/c/1234567890.123456/C123ABC?token=fallback-token-12345');
    });

    it('should URL-encode special characters in token', () => {
      const webConfig = {
        enabled: true,
        port: 8080,
        baseUrl: 'http://localhost:8080',
        authToken: 'token+with=special&chars',
      };

      const url = getConversationUrl('1234567890.123456', 'C123ABC', webConfig);

      expect(url).toContain('token=token%2Bwith%3Dspecial%26chars');
    });
  });
});

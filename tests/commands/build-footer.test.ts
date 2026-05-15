import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetConversationUrl = vi.fn().mockReturnValue('http://localhost:8080/c/1234.5678/C123TEST?token=abc');
vi.mock('../../src/web/index.js', () => ({
  getConversationUrl: (...args: unknown[]) => mockGetConversationUrl(...args),
}));

import { buildFooter } from '../../src/commands/build-footer.js';

describe('buildFooter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('basic format', () => {
    it('should include tools used and token count', () => {
      const result = buildFooter({
        toolCalls: 3,
        tokens: 1234,
        threadTs: '1234.5678',
        channelId: 'C123TEST',
        userId: 'U123TEST',
      });

      expect(result).toContain('Tools used: 3');
      expect(result).toContain('Tokens: 1,234');
    });

    it('should include /ask continue with thread ts', () => {
      const result = buildFooter({
        toolCalls: 0,
        tokens: 100,
        threadTs: '9999.1111',
        channelId: 'C123TEST',
        userId: 'U123TEST',
      });

      expect(result).toContain('`/ask continue 9999.1111`');
    });

    it('should NOT include Thread: field', () => {
      const result = buildFooter({
        toolCalls: 1,
        tokens: 500,
        threadTs: '1234.5678',
        channelId: 'C123TEST',
        userId: 'U123TEST',
      });

      expect(result).not.toContain('Thread:');
    });

    it('should wrap content in italics', () => {
      const result = buildFooter({
        toolCalls: 0,
        tokens: 100,
        threadTs: '1234.5678',
        channelId: 'C123TEST',
        userId: 'U123TEST',
      });

      expect(result).toMatch(/^_.*_$/);
    });
  });

  describe('reply hint', () => {
    it('should include reply hint when showReplyHint is true', () => {
      const result = buildFooter({
        toolCalls: 0,
        tokens: 100,
        threadTs: '1234.5678',
        channelId: 'C123TEST',
        userId: 'U123TEST',
        showReplyHint: true,
      });

      expect(result).toContain('Reply in thread to continue');
    });

    it('should not include reply hint by default', () => {
      const result = buildFooter({
        toolCalls: 0,
        tokens: 100,
        threadTs: '1234.5678',
        channelId: 'C123TEST',
        userId: 'U123TEST',
      });

      expect(result).not.toContain('Reply in thread to continue');
    });
  });

  describe('history messages', () => {
    it('should include history count when provided', () => {
      const result = buildFooter({
        toolCalls: 2,
        tokens: 890,
        threadTs: '1234.5678',
        channelId: 'C123TEST',
        userId: 'U123TEST',
        historyMsgs: 5,
      });

      expect(result).toContain('History: 5 msgs');
    });

    it('should not include history when not provided', () => {
      const result = buildFooter({
        toolCalls: 0,
        tokens: 100,
        threadTs: '1234.5678',
        channelId: 'C123TEST',
        userId: 'U123TEST',
      });

      expect(result).not.toContain('History:');
    });
  });

  describe('web UI link', () => {
    const webConfig = {
      enabled: true,
      port: 8080,
      baseUrl: 'http://localhost:8080',
      authToken: 'test-token-1234567890123456',
      linkTokenTtlMinutes: 15,
      sessionTtlHours: 72,
    };

    it('should include View in UI link when web is enabled', () => {
      const result = buildFooter({
        toolCalls: 1,
        tokens: 500,
        threadTs: '1234.5678',
        channelId: 'C123TEST',
        userId: 'U123TEST',
        webConfig,
      });

      expect(result).toContain('View in UI');
      expect(result).toContain('<http://localhost:8080/c/1234.5678/C123TEST?token=abc|View in UI>');
    });

    it('should call getConversationUrl with correct args', () => {
      buildFooter({
        toolCalls: 1,
        tokens: 500,
        threadTs: '1234.5678',
        channelId: 'C123TEST',
        userId: 'U123TEST',
        webConfig,
      });

      expect(mockGetConversationUrl).toHaveBeenCalledWith(
        '1234.5678',
        'C123TEST',
        webConfig,
        'U123TEST',
      );
    });

    it('should not include View in UI when webConfig is undefined', () => {
      const result = buildFooter({
        toolCalls: 1,
        tokens: 500,
        threadTs: '1234.5678',
        channelId: 'C123TEST',
        userId: 'U123TEST',
      });

      expect(result).not.toContain('View in UI');
      expect(mockGetConversationUrl).not.toHaveBeenCalled();
    });

    it('should not include View in UI when web is disabled', () => {
      const result = buildFooter({
        toolCalls: 1,
        tokens: 500,
        threadTs: '1234.5678',
        channelId: 'C123TEST',
        userId: 'U123TEST',
        webConfig: { ...webConfig, enabled: false },
      });

      expect(result).not.toContain('View in UI');
    });

    it('should use pre-built webUrl without calling getConversationUrl', () => {
      const result = buildFooter({
        toolCalls: 1,
        tokens: 500,
        threadTs: '1234.5678',
        channelId: 'C123TEST',
        userId: 'U123TEST',
        webUrl: 'http://localhost:8080/c/1234.5678/C123TEST?token=prebuilt',
      });

      expect(result).toContain('<http://localhost:8080/c/1234.5678/C123TEST?token=prebuilt|View in UI>');
      expect(mockGetConversationUrl).not.toHaveBeenCalled();
    });

    it('should prefer webUrl over webConfig', () => {
      const result = buildFooter({
        toolCalls: 1,
        tokens: 500,
        threadTs: '1234.5678',
        channelId: 'C123TEST',
        userId: 'U123TEST',
        webUrl: 'http://prebuilt.example.com/c/test',
        webConfig,
      });

      expect(result).toContain('<http://prebuilt.example.com/c/test|View in UI>');
      expect(mockGetConversationUrl).not.toHaveBeenCalled();
    });

    it('should not include View in UI when baseUrl is missing', () => {
      const result = buildFooter({
        toolCalls: 1,
        tokens: 500,
        threadTs: '1234.5678',
        channelId: 'C123TEST',
        userId: 'U123TEST',
        webConfig: { ...webConfig, baseUrl: undefined },
      });

      expect(result).not.toContain('View in UI');
    });
  });

  describe('full format combinations', () => {
    it('should produce correct footer for initial ask with web', () => {
      const result = buildFooter({
        toolCalls: 3,
        tokens: 1234,
        threadTs: '1234.5678',
        channelId: 'C123TEST',
        userId: 'U123TEST',
        showReplyHint: true,
        webConfig: {
          enabled: true,
          port: 8080,
          baseUrl: 'http://localhost:8080',
          authToken: 'test-token-1234567890123456',
          linkTokenTtlMinutes: 15,
          sessionTtlHours: 72,
        },
      });

      // Verify pipe-separated parts in order
      const parts = result.replace(/^_/, '').replace(/_$/, '').split(' | ');
      expect(parts[0]).toBe('Tools used: 3');
      expect(parts[1]).toBe('Tokens: 1,234');
      expect(parts[2]).toBe('Reply in thread to continue');
      expect(parts[3]).toBe('`/ask continue 1234.5678`');
      expect(parts[4]).toContain('View in UI');
    });

    it('should produce correct footer for continue with history and web', () => {
      const result = buildFooter({
        toolCalls: 2,
        tokens: 890,
        threadTs: '5678.1234',
        channelId: 'C123TEST',
        userId: 'U123TEST',
        historyMsgs: 5,
        showReplyHint: true,
        webConfig: {
          enabled: true,
          port: 8080,
          baseUrl: 'http://localhost:8080',
          authToken: 'test-token-1234567890123456',
          linkTokenTtlMinutes: 15,
          sessionTtlHours: 72,
        },
      });

      const parts = result.replace(/^_/, '').replace(/_$/, '').split(' | ');
      expect(parts[0]).toBe('Tools used: 2');
      expect(parts[1]).toBe('Tokens: 890');
      expect(parts[2]).toBe('History: 5 msgs');
      expect(parts[3]).toBe('Reply in thread to continue');
      expect(parts[4]).toBe('`/ask continue 5678.1234`');
      expect(parts[5]).toContain('View in UI');
    });

    it('should produce correct footer for thread reply without web', () => {
      const result = buildFooter({
        toolCalls: 1,
        tokens: 456,
        threadTs: '1234.5678',
        channelId: 'C123TEST',
        userId: 'U123TEST',
      });

      const parts = result.replace(/^_/, '').replace(/_$/, '').split(' | ');
      expect(parts[0]).toBe('Tools used: 1');
      expect(parts[1]).toBe('Tokens: 456');
      expect(parts[2]).toBe('`/ask continue 1234.5678`');
      expect(parts).toHaveLength(3);
    });
  });
});

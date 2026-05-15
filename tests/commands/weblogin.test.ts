import { describe, it, expect, vi } from 'vitest';
import { verifyLinkToken } from '../../src/web/auth.js';

const AUTH_TOKEN = 'test-signing-secret-min16';

// Mock the config module
vi.mock('../../src/config/index.js', () => ({
  config: {
    web: {
      enabled: true,
      port: 8080,
      baseUrl: 'http://test.local:8080',
      authToken: 'test-signing-secret-min16',
      linkTokenTtlMinutes: 15,
      sessionTtlHours: 72,
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

import { registerWebLoginCommand } from '../../src/commands/weblogin.js';

describe('weblogin command', () => {
  it('should respond ephemerally with a login link containing HMAC token', async () => {
    const ack = vi.fn();
    const respond = vi.fn();

    // Simulate the command handler
    const app = {
      command: vi.fn(),
    };

    registerWebLoginCommand(app as never);

    // Get the registered handler
    const [commandName, handler] = app.command.mock.calls[0];
    expect(commandName).toBe('/weblogin');

    // Call the handler
    await handler({
      command: { user_id: 'U01ABC123' },
      ack,
      respond,
    });

    expect(ack).toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({
        response_type: 'ephemeral',
      }),
    );

    // Extract the URL from the response blocks
    const responseBlocks = respond.mock.calls[0][0].blocks;
    const blockText = JSON.stringify(responseBlocks);

    // Should contain the base URL
    expect(blockText).toContain('http://test.local:8080/c?token=');

    // Extract the token from the URL
    const urlMatch = blockText.match(/http:\/\/test\.local:8080\/c\?token=([^|]+)/);
    expect(urlMatch).toBeTruthy();

    const token = decodeURIComponent(urlMatch?.[1] ?? '');
    const result = verifyLinkToken(token, AUTH_TOKEN);
    expect(result).toEqual({ userId: 'U01ABC123' });
  });

  it('should show error when web is not enabled', async () => {
    // Re-mock config with web disabled
    const { config } = await import('../../src/config/index.js');
    const originalWeb = config.web;
    (config as Record<string, unknown>).web = undefined;

    const ack = vi.fn();
    const respond = vi.fn();

    const app = { command: vi.fn() };
    registerWebLoginCommand(app as never);
    const [, handler] = app.command.mock.calls[0];

    await handler({ command: { user_id: 'U01ABC123' }, ack, respond });

    expect(ack).toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({
        response_type: 'ephemeral',
      }),
    );

    const blockText = JSON.stringify(respond.mock.calls[0][0].blocks);
    expect(blockText).toContain('Web UI is not enabled');

    // Restore
    (config as Record<string, unknown>).web = originalWeb;
  });
});

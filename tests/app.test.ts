import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ─── hoisted mock objects ──────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
  mockStart: vi.fn().mockResolvedValue(undefined),
  mockStop: vi.fn().mockResolvedValue(undefined),
  mockUse: vi.fn(),
  mockError: vi.fn(),
  mockClientOn: vi.fn(),
  mockCloseConversationStore: vi.fn(),
  mockCloseUserStore: vi.fn(),
  mockRegisterCommands: vi.fn().mockResolvedValue(undefined),
  mockDestroyPlugins: vi.fn().mockResolvedValue(undefined),
  mockStopRateLimitCleanup: vi.fn(),
  mockStopWebServer: vi.fn().mockResolvedValue(undefined),
  mockEvaluateAuthStartup: vi.fn().mockReturnValue({ ok: true, level: 'silent' }),
  mockUserStoreBootstrap: vi.fn().mockReturnValue({ created: 0, skipped: [] }),
  mockUserStoreListAll: vi.fn().mockReturnValue([]),
  mockUserStoreClose: vi.fn(),
  mockLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ─── module mocks (hoisted by vitest above all imports) ───────────────────
vi.mock('@slack/bolt', () => ({
  // Must use function (not arrow) so it can be called as a constructor
  App: vi.fn(function () {
    return {
      use: mocks.mockUse,
      error: mocks.mockError,
      start: mocks.mockStart,
      stop: mocks.mockStop,
      receiver: { client: { on: mocks.mockClientOn } },
    };
  }),
  LogLevel: { DEBUG: 'DEBUG', INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
}));

vi.mock('../src/config/index.js', () => ({
  config: {
    slack: { botToken: 'xoxb-test', appToken: 'xapp-test' },
    logging: { level: 'info' },
    authorization: { userIds: ['U123'] },
    rateLimit: { max: 10, windowSeconds: 60 },
    claude: undefined,
    web: undefined,
  },
}));

vi.mock('../src/utils/logger.js', () => ({ logger: mocks.mockLogger }));

vi.mock('../src/middleware/index.js', () => ({
  authorizeMiddleware: vi.fn(),
  rateLimitMiddleware: vi.fn(),
  auditLogMiddleware: vi.fn(),
  stopRateLimitCleanup: mocks.mockStopRateLimitCleanup,
}));

vi.mock('../src/commands/index.js', () => ({
  registerCommands: mocks.mockRegisterCommands,
}));

vi.mock('../src/plugins/index.js', () => ({
  registerPlugins: vi.fn().mockResolvedValue(undefined),
  destroyPlugins: mocks.mockDestroyPlugins,
  getPluginTools: vi.fn().mockReturnValue([]),
  getLoadedPlugins: vi.fn().mockReturnValue([]),
  getPluginHelpData: vi.fn().mockReturnValue([]),
  getPluginWidgets: vi.fn().mockReturnValue([]),
}));

vi.mock('../src/services/user-store.js', () => ({
  getUserStore: vi.fn().mockImplementation(() => ({
    bootstrap: mocks.mockUserStoreBootstrap,
    listAll: mocks.mockUserStoreListAll,
    close: mocks.mockUserStoreClose,
  })),
  closeUserStore: mocks.mockCloseUserStore,
  resolveUserStoreDbPath: vi.fn().mockReturnValue('./data/users.db'),
}));

vi.mock('../src/services/conversation-store.js', () => ({
  getConversationStore: vi.fn().mockReturnValue({
    cleanupExpired: vi.fn().mockReturnValue(0),
    close: vi.fn(),
    getDatabase: vi.fn(),
  }),
  closeConversationStore: mocks.mockCloseConversationStore,
}));

vi.mock('../src/services/auth-startup.js', () => ({
  evaluateAuthStartup: mocks.mockEvaluateAuthStartup,
}));

vi.mock('../src/services/db-backup.js', () => ({
  startBackupSchedule: vi.fn().mockReturnValue(vi.fn()),
}));

vi.mock('../src/web/index.js', () => ({
  startWebServer: vi.fn().mockResolvedValue(undefined),
  stopWebServer: mocks.mockStopWebServer,
}));

vi.mock('../src/services/server-health.js', () => ({
  getServerHealth: vi.fn().mockResolvedValue({}),
}));

// ─── static imports resolved after mocks are registered ───────────────────
import { getUserStore } from '../src/services/user-store.js';
import { main, shutdown } from '../src/app.js';

// ─── socket-mode-status tests ─────────────────────────────────────────────

describe('socket-mode-status', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('should return disconnected state initially', async () => {
    const { getSocketModeStatus } = await import('../src/services/socket-mode-status.js');
    const status = getSocketModeStatus();
    expect(status.connected).toBe(false);
    expect(status.lastConnectedAt).toBeNull();
    expect(status.lastDisconnectedAt).toBeNull();
  });

  it('should return a copy (not a reference)', async () => {
    const { getSocketModeStatus } = await import('../src/services/socket-mode-status.js');
    const a = getSocketModeStatus();
    const b = getSocketModeStatus();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });

  it('should update state on setConnected', async () => {
    const { getSocketModeStatus, setConnected } = await import('../src/services/socket-mode-status.js');
    setConnected();
    const status = getSocketModeStatus();
    expect(status.connected).toBe(true);
    expect(status.lastConnectedAt).toBeTruthy();
  });

  it('should update state on setDisconnected', async () => {
    const { getSocketModeStatus, setConnected, setDisconnected } = await import('../src/services/socket-mode-status.js');
    setConnected();
    setDisconnected();
    const status = getSocketModeStatus();
    expect(status.connected).toBe(false);
    expect(status.lastDisconnectedAt).toBeTruthy();
    expect(status.lastConnectedAt).toBeTruthy();
  });
});

// ─── app lifecycle tests ───────────────────────────────────────────────────

describe('app lifecycle', () => {
  let mockProcessExit: { mockRestore: () => void };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockStart.mockResolvedValue(undefined);
    mocks.mockStop.mockResolvedValue(undefined);
    mocks.mockRegisterCommands.mockResolvedValue(undefined);
    mocks.mockDestroyPlugins.mockResolvedValue(undefined);
    mocks.mockEvaluateAuthStartup.mockReturnValue({ ok: true, level: 'silent' });
    mocks.mockUserStoreBootstrap.mockReturnValue({ created: 0, skipped: [] });
    mocks.mockUserStoreListAll.mockReturnValue([]);
    vi.mocked(getUserStore).mockImplementation(
      () =>
        ({
          bootstrap: mocks.mockUserStoreBootstrap,
          listAll: mocks.mockUserStoreListAll,
          close: mocks.mockUserStoreClose,
        }) as unknown as ReturnType<typeof getUserStore>,
    );
    mockProcessExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    mockProcessExit.mockRestore();
  });

  it('initializes stores before registerCommands resolves', async () => {
    const callOrder: string[] = [];
    vi.mocked(getUserStore).mockImplementationOnce(() => {
      callOrder.push('getUserStore');
      return {
        bootstrap: mocks.mockUserStoreBootstrap,
        listAll: mocks.mockUserStoreListAll,
        close: mocks.mockUserStoreClose,
      } as unknown as ReturnType<typeof getUserStore>;
    });
    mocks.mockRegisterCommands.mockImplementationOnce(async () => {
      callOrder.push('registerCommands');
    });

    await main();

    expect(callOrder).toContain('getUserStore');
    expect(callOrder).toContain('registerCommands');
    expect(callOrder.indexOf('getUserStore')).toBeLessThan(callOrder.indexOf('registerCommands'));
  });

  it('closes conversation store and user store on shutdown', async () => {
    // Verifies the two stores app.ts owns directly. Web-server-owned stores
    // (session, notification, quicklinks) are covered by stopWebServer, which
    // is asserted via the mock call count below.
    await shutdown('SIGTERM');

    expect(mocks.mockCloseConversationStore).toHaveBeenCalled();
    expect(mocks.mockCloseUserStore).toHaveBeenCalled();
    expect(mocks.mockStopWebServer).toHaveBeenCalled();
  });

  it('starts the app when registerCommands resolves after catching a plugin error internally', async () => {
    // registerPlugins catches individual plugin init errors and does NOT rethrow
    // (see src/plugins/loader.ts). Simulate that path: registerCommands resolves
    // while having logged a plugin failure, and verify app.start() is still called.
    mocks.mockRegisterCommands.mockImplementationOnce(async () => {
      mocks.mockLogger.error('Failed to initialize plugin', { name: 'bad-plugin', error: 'Init error' });
    });

    await main();

    expect(mocks.mockStart).toHaveBeenCalled();
  });

  it('exits with code 1 and does not call app.start() when startup throws', async () => {
    // Covers the main() catch block: if any startup step throws (e.g. an
    // unrecoverable plugin system failure), the error is logged and the
    // process exits — it never reaches app.start().
    mocks.mockRegisterCommands.mockRejectedValueOnce(new Error('unrecoverable plugin failure'));

    await main();

    expect(mocks.mockStart).not.toHaveBeenCalled();
    expect(mocks.mockLogger.error).toHaveBeenCalledWith(
      'Failed to start app',
      expect.objectContaining({ error: 'unrecoverable plugin failure' }),
    );
    expect(mockProcessExit).toHaveBeenCalledWith(1);
  });
});

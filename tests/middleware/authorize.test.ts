import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SlackCommandMiddlewareArgs, AllMiddlewareArgs } from '@slack/bolt';
import type { User } from '../../src/types/user.js';

// In-memory user table for the mock store. Reset in beforeEach.
const mockUsers = new Map<string, User>();

vi.mock('../../src/config/index.js', () => ({
  config: {
    authorization: {
      userIds: ['U12345678', 'UAUTHORIZED'],
      channelIds: [],
    },
    claude: { dbPath: ':memory:' },
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

let storeShouldThrow = false;

vi.mock('../../src/services/user-store.js', () => ({
  getUserStore: () => {
    if (storeShouldThrow) throw new Error('DB unavailable');
    return {
      getBySlackId: (id: string): User | null => mockUsers.get(id) ?? null,
    };
  },
  resolveUserStoreDbPath: () => ':memory:',
}));

const { authorizeMiddleware } = await import('../../src/middleware/authorize.js');
const { config } = await import('../../src/config/index.js');
const { logger } = await import('../../src/utils/logger.js');

function buildUser(slackId: string, overrides: Partial<User> = {}): User {
  return {
    id: 1,
    slackId,
    username: null,
    displayName: null,
    role: 'user',
    isActive: true,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('authorizeMiddleware', () => {
  let mockNext: ReturnType<typeof vi.fn>;
  let mockContext: Record<string, unknown>;
  let mockCommand: {
    user_id: string;
    user_name: string;
    channel_id: string;
    channel_name: string;
    command: string;
    text: string;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUsers.clear();
    storeShouldThrow = false;
    mockNext = vi.fn();
    mockContext = {};
    mockCommand = {
      user_id: 'U12345678',
      user_name: 'testuser',
      channel_id: 'C12345678',
      channel_name: 'test-channel',
      command: '/status',
      text: '',
    };
    config.authorization.channelIds = [];
    config.authorization.userIds = ['U12345678', 'UAUTHORIZED'];
  });

  function makeArgs() {
    return {
      command: mockCommand,
      context: mockContext,
      next: mockNext,
    } as unknown as SlackCommandMiddlewareArgs & AllMiddlewareArgs;
  }

  describe('users-table primary path', () => {
    it('allows users present in the users table', async () => {
      mockUsers.set('U12345678', buildUser('U12345678', { role: 'user' }));
      await authorizeMiddleware(makeArgs());
      expect(mockNext).toHaveBeenCalled();
    });

    it('attaches userRole to the Bolt context for downstream handlers', async () => {
      mockUsers.set('U12345678', buildUser('U12345678', { role: 'admin' }));
      await authorizeMiddleware(makeArgs());
      expect(mockContext.userRole).toBe('admin');
    });

    it('rejects users that exist in the table but are deactivated', async () => {
      mockUsers.set('U12345678', buildUser('U12345678', { isActive: false }));
      await authorizeMiddleware(makeArgs());
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('rejects deactivated users even if still present in env-var allowlist', async () => {
      mockUsers.set('U12345678', buildUser('U12345678', { isActive: false }));
      config.authorization.userIds = ['U12345678'];
      await authorizeMiddleware(makeArgs());
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('env-var fallback removed (#278)', () => {
    // The middleware no longer admits users solely on AUTHORIZED_USER_IDS
    // membership at request time. The env var is bootstrap-only:
    // userStore.bootstrap() in app.ts seeds the users table on first
    // startup. Once the bot is running, the users table is the sole
    // runtime source of truth.

    it('rejects a user who is in AUTHORIZED_USER_IDS but NOT in the users table', async () => {
      // mockUsers is empty; config.authorization.userIds includes U12345678.
      // Pre-#278 this would have been admitted via the env-var fallback.
      // Post-#278: rejected, since the DB has no row for them.
      await authorizeMiddleware(makeArgs());
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('logs an unauthorized-attempt warning for env-only users', async () => {
      await authorizeMiddleware(makeArgs());
      expect(logger.warn).toHaveBeenCalledWith(
        'Unauthorized user attempted command',
        expect.objectContaining({ userId: 'U12345678' }),
      );
      // No deprecation warning fires — the fallback is gone, not deprecated.
      expect(logger.warn).not.toHaveBeenCalledWith(
        expect.stringMatching(/deprecated/i),
        expect.anything(),
      );
    });

    it('does not set userRole on the Bolt context for an env-only user', async () => {
      await authorizeMiddleware(makeArgs());
      expect(mockContext.userRole).toBeUndefined();
    });

    it('rejects users absent from both the users table and the env-var allowlist', async () => {
      mockCommand.user_id = 'UUNAUTHORIZED';
      await authorizeMiddleware(makeArgs());
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('channel authorization', () => {
    it('still enforces channel restrictions for DB-authorized users', async () => {
      mockUsers.set('U12345678', buildUser('U12345678'));
      config.authorization.channelIds = ['CALLOWED'];
      mockCommand.channel_id = 'CDENIED';
      await authorizeMiddleware(makeArgs());
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('allows DB-authorized user in an authorized channel', async () => {
      mockUsers.set('U12345678', buildUser('U12345678'));
      config.authorization.channelIds = ['CALLOWED'];
      mockCommand.channel_id = 'CALLOWED';
      await authorizeMiddleware(makeArgs());
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('storage failure (fail-closed)', () => {
    it('rejects the command when the user store throws', async () => {
      storeShouldThrow = true;
      await authorizeMiddleware(makeArgs());
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('does NOT fall back to the env-var allowlist on storage failure', async () => {
      // User is in env-var allowlist — would normally be admitted via fallback,
      // but a DB error must fail closed in case they were since deactivated.
      storeShouldThrow = true;
      mockCommand.user_id = 'UAUTHORIZED';
      await authorizeMiddleware(makeArgs());
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('logs an error when storage is unavailable', async () => {
      storeShouldThrow = true;
      await authorizeMiddleware(makeArgs());
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringMatching(/UserStore unavailable/i),
        expect.objectContaining({ userId: 'U12345678' }),
      );
    });
  });

  describe('non-command events', () => {
    it('passes through non-command events without checking', async () => {
      const args = {
        event: { type: 'message' },
        next: mockNext,
      } as unknown as AllMiddlewareArgs;
      await authorizeMiddleware(args);
      expect(mockNext).toHaveBeenCalled();
    });
  });
});

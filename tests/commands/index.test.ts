import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { App } from '@slack/bolt';

// Mock all command registration modules
vi.mock('../../src/commands/status.js', () => ({
  registerServicesCommand: vi.fn(),
}));
vi.mock('../../src/commands/logs.js', () => ({
  registerLogsCommand: vi.fn(),
}));
vi.mock('../../src/commands/resources.js', () => ({
  registerResourcesCommand: vi.fn(),
  registerDiskCommand: vi.fn(),
}));
vi.mock('../../src/commands/network.js', () => ({
  registerNetworkCommand: vi.fn(),
}));
vi.mock('../../src/commands/ask.js', () => ({
  registerAskCommand: vi.fn().mockResolvedValue(undefined),
  registerThreadHandler: vi.fn(),
}));
vi.mock('../../src/commands/context.js', () => ({
  registerContextCommand: vi.fn(),
}));
vi.mock('../../src/commands/sessions.js', () => ({
  registerSessionsCommand: vi.fn(),
}));
vi.mock('../../src/commands/security.js', () => ({
  registerSecurityCommand: vi.fn(),
}));
vi.mock('../../src/commands/ssl.js', () => ({
  registerSslCommand: vi.fn(),
}));
vi.mock('../../src/commands/backups.js', () => ({
  registerBackupsCommand: vi.fn(),
}));
vi.mock('../../src/commands/pm2.js', () => ({
  registerPm2Command: vi.fn(),
}));
vi.mock('../../src/plugins/index.js', () => ({
  registerPlugins: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/services/tools/index.js', () => ({
  refreshToolMap: vi.fn(),
}));
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Import after mocks are set up
const { registerCommands } = await import('../../src/commands/index.js');
const { registerServicesCommand } = await import('../../src/commands/status.js');
const { registerLogsCommand } = await import('../../src/commands/logs.js');
const { registerResourcesCommand, registerDiskCommand } = await import(
  '../../src/commands/resources.js'
);
const { registerNetworkCommand } = await import('../../src/commands/network.js');
const { registerAskCommand, registerThreadHandler } = await import(
  '../../src/commands/ask.js'
);
const { registerContextCommand } = await import('../../src/commands/context.js');
const { registerSessionsCommand } = await import('../../src/commands/sessions.js');
const { registerSecurityCommand } = await import('../../src/commands/security.js');
const { registerSslCommand } = await import('../../src/commands/ssl.js');
const { registerBackupsCommand } = await import('../../src/commands/backups.js');
const { registerPm2Command } = await import('../../src/commands/pm2.js');
const { registerPlugins } = await import('../../src/plugins/index.js');
const { refreshToolMap } = await import('../../src/services/tools/index.js');
const { logger } = await import('../../src/utils/logger.js');

describe('registerCommands', () => {
  let mockApp: App;

  beforeEach(() => {
    vi.clearAllMocks();
    mockApp = {} as App;
  });

  describe('command registration', () => {
    it('should register all container commands', async () => {
      await registerCommands(mockApp);

      expect(registerServicesCommand).toHaveBeenCalledWith(mockApp);
      expect(registerLogsCommand).toHaveBeenCalledWith(mockApp);
      expect(registerNetworkCommand).toHaveBeenCalledWith(mockApp);
    });

    it('should register all system commands', async () => {
      await registerCommands(mockApp);

      expect(registerResourcesCommand).toHaveBeenCalledWith(mockApp);
      expect(registerDiskCommand).toHaveBeenCalledWith(mockApp);
    });

    it('should register all monitoring commands', async () => {
      await registerCommands(mockApp);

      expect(registerSecurityCommand).toHaveBeenCalledWith(mockApp);
      expect(registerSslCommand).toHaveBeenCalledWith(mockApp);
      expect(registerBackupsCommand).toHaveBeenCalledWith(mockApp);
      expect(registerPm2Command).toHaveBeenCalledWith(mockApp);
    });

    it('should register Claude AI commands', async () => {
      await registerCommands(mockApp);

      expect(registerAskCommand).toHaveBeenCalledWith(mockApp);
      expect(registerThreadHandler).toHaveBeenCalledWith(mockApp);
      expect(registerContextCommand).toHaveBeenCalledWith(mockApp);
      expect(registerSessionsCommand).toHaveBeenCalledWith(mockApp);
    });

    it('should register plugins', async () => {
      await registerCommands(mockApp);

      expect(registerPlugins).toHaveBeenCalledWith(mockApp);
    });

    it('should refresh tool map after plugin registration', async () => {
      await registerCommands(mockApp);

      expect(refreshToolMap).toHaveBeenCalled();
    });
  });

  describe('logging', () => {
    it('should log when starting registration', async () => {
      await registerCommands(mockApp);

      expect(logger.info).toHaveBeenCalledWith('Registering commands');
    });

    it('should log when registration is complete', async () => {
      await registerCommands(mockApp);

      expect(logger.info).toHaveBeenCalledWith('Commands registered successfully');
    });
  });

  describe('registration order', () => {
    it('should register commands before plugins', async () => {
      const callOrder: string[] = [];

      (registerServicesCommand as ReturnType<typeof vi.fn>).mockImplementation(() => {
        callOrder.push('services');
      });
      (registerPlugins as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callOrder.push('plugins');
      });
      (refreshToolMap as ReturnType<typeof vi.fn>).mockImplementation(() => {
        callOrder.push('refreshToolMap');
      });

      await registerCommands(mockApp);

      expect(callOrder.indexOf('services')).toBeLessThan(callOrder.indexOf('plugins'));
      expect(callOrder.indexOf('plugins')).toBeLessThan(callOrder.indexOf('refreshToolMap'));
    });
  });
});

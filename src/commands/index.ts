import type { App } from '@slack/bolt';
import { registerServicesCommand } from './status.js';
import { registerLogsCommand } from './logs.js';
import { registerResourcesCommand, registerDiskCommand } from './resources.js';
import { registerNetworkCommand } from './network.js';
import { registerAskCommand, registerThreadHandler } from './ask.js';
import { registerContextCommand } from './context.js';
import { registerSessionsCommand } from './sessions.js';
import { registerSecurityCommand } from './security.js';
import { registerSslCommand } from './ssl.js';
import { registerBackupsCommand } from './backups.js';
import { registerPm2Command } from './pm2.js';
import { registerHelpCommand } from './help.js';
import { registerPlugins } from '../plugins/index.js';
import { refreshToolMap } from '../services/tools/index.js';
import { logger } from '../utils/logger.js';

/**
 * Register all slash commands with the Bolt app
 */
export async function registerCommands(app: App): Promise<void> {
  logger.info('Registering commands');

  // Container commands
  registerServicesCommand(app);
  registerLogsCommand(app);
  registerNetworkCommand(app);

  // System commands
  registerResourcesCommand(app);
  registerDiskCommand(app);

  // Monitoring commands
  registerSecurityCommand(app);
  registerSslCommand(app);
  registerBackupsCommand(app);
  registerPm2Command(app);

  // Claude AI commands (if configured)
  await registerAskCommand(app);
  registerThreadHandler(app);
  registerContextCommand(app);
  registerSessionsCommand(app);

  // Load and register plugins
  await registerPlugins(app);

  // Help command (registered after plugins so it can list plugin commands)
  registerHelpCommand(app);

  // Refresh tool map to include plugin tools
  refreshToolMap();

  logger.info('Commands registered successfully');
}

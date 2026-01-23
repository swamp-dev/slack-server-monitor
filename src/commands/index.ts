import type { App } from '@slack/bolt';
import { registerStatusCommand } from './status.js';
import { registerLogsCommand } from './logs.js';
import { registerResourcesCommand, registerDiskCommand } from './resources.js';
import { registerNetworkCommand } from './network.js';
import { logger } from '../utils/logger.js';

/**
 * Register all slash commands with the Bolt app
 */
export function registerCommands(app: App): void {
  logger.info('Registering commands');

  // Container commands
  registerStatusCommand(app);
  registerLogsCommand(app);
  registerNetworkCommand(app);

  // System commands
  registerResourcesCommand(app);
  registerDiskCommand(app);

  // Note: Additional commands can be added here:
  // - registerSecurityCommand(app);   // fail2ban status
  // - registerSslCommand(app);        // SSL certificate checks
  // - registerBackupsCommand(app);    // Backup status
  // - registerPm2Command(app);        // PM2 process status

  logger.info('Commands registered successfully');
}

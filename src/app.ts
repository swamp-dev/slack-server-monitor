import path from 'path';
import { App, LogLevel } from '@slack/bolt';
import type { EventEmitter } from 'eventemitter3';
import { config } from './config/index.js';
import { authorizeMiddleware, rateLimitMiddleware, auditLogMiddleware, stopRateLimitCleanup } from './middleware/index.js';
import { registerCommands } from './commands/index.js';
import { destroyPlugins } from './plugins/index.js';
import { logger } from './utils/logger.js';
import { closeConversationStore, getConversationStore } from './services/conversation-store.js';
import { startBackupSchedule } from './services/db-backup.js';
import { startWebServer, stopWebServer } from './web/index.js';
import { setConnected, setDisconnected } from './services/socket-mode-status.js';

let stopBackupSchedule: (() => void) | null = null;

/**
 * Attach event listeners to the Socket Mode client to track connection lifecycle.
 * Must be called after the Bolt app is created.
 */
function setupSocketModeListeners(boltApp: App): void {
  // Access the SocketModeReceiver's client via cast — `receiver` is private on App
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any -- Bolt doesn't expose receiver publicly
  const client = (boltApp as any).receiver?.client as EventEmitter | undefined;
  if (!client) {
    logger.warn('Cannot attach Socket Mode listeners — receiver.client not available');
    return;
  }

  client.on('connected', () => {
    setConnected();
    logger.info('Socket Mode connected');
  });

  client.on('disconnected', () => {
    setDisconnected();
    logger.warn('Socket Mode disconnected');
  });

  client.on('reconnecting', () => {
    setDisconnected();
    logger.info('Socket Mode reconnecting...');
  });
}

/**
 * Slack Server Monitor
 *
 * A read-only monitoring bot that provides server diagnostics via Slack Socket Mode.
 * No exposed ports required - connects outbound to Slack via WebSocket.
 */

// Map our log level to Bolt's LogLevel
function getBoltLogLevel(): LogLevel {
  switch (config.logging.level) {
    case 'debug':
      return LogLevel.DEBUG;
    case 'info':
      return LogLevel.INFO;
    case 'warn':
      return LogLevel.WARN;
    case 'error':
      return LogLevel.ERROR;
    default:
      return LogLevel.INFO;
  }
}

// Initialize the Bolt app with Socket Mode
const app = new App({
  token: config.slack.botToken,
  appToken: config.slack.appToken,
  socketMode: true,
  logLevel: getBoltLogLevel(),
});

// Attach Socket Mode connection lifecycle listeners BEFORE app.start().
// This ensures the 'connected' event (emitted on WebSocket hello) is captured.
setupSocketModeListeners(app);

// Register global middleware (order matters!)
// 1. Authorization - reject unauthorized users first
app.use(authorizeMiddleware);

// 2. Rate limiting - prevent abuse
app.use(rateLimitMiddleware);

// 3. Audit logging - log all authorized commands
app.use(auditLogMiddleware);

// Handle errors
app.error((error): Promise<void> => {
  logger.error('Unhandled error in Bolt app', {
    error: error.message,
    stack: error.stack,
  });
  return Promise.resolve();
});

// Graceful shutdown handler
async function shutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}, shutting down gracefully...`);

  try {
    stopBackupSchedule?.();
    stopRateLimitCleanup();
    await app.stop();
    await stopWebServer();
    await destroyPlugins();
    closeConversationStore();
    logger.info('App stopped successfully');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}

// Register shutdown handlers
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

// Start the app
async function main(): Promise<void> {
  try {
    // Clean up expired conversations on startup (if Claude is configured)
    if (config.claude) {
      const store = getConversationStore(config.claude.dbPath, config.claude.conversationTtlHours);
      const cleaned = store.cleanupExpired();
      if (cleaned > 0) {
        logger.info('Cleaned up expired conversations on startup', { count: cleaned });
      }
    }

    // Start database backup schedule if enabled
    if (config.claude?.dbBackupEnabled) {
      const store = getConversationStore(config.claude.dbPath, config.claude.conversationTtlHours);
      const backupDir = config.claude.dbBackupDir ?? path.join(path.dirname(config.claude.dbPath), 'backups');
      stopBackupSchedule = startBackupSchedule(store.getDatabase(), {
        intervalHours: config.claude.dbBackupIntervalHours,
        backupDir,
        retain: config.claude.dbBackupRetain,
      });
    }

    // Start web server if enabled
    if (config.web?.enabled) {
      await startWebServer(config.web);
    }

    // Register slash commands (async to load context)
    await registerCommands(app);

    await app.start();
    logger.info('Slack Server Monitor is running!', {
      socketMode: true,
      authorizedUsers: config.authorization.userIds.length,
      rateLimit: `${String(config.rateLimit.max)} per ${String(config.rateLimit.windowSeconds)}s`,
      claudeEnabled: !!config.claude,
      webEnabled: !!config.web?.enabled,
    });
  } catch (error) {
    logger.error('Failed to start app', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}

void main();

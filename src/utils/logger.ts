import winston from 'winston';

const { combine, timestamp, printf, colorize, json } = winston.format;

/**
 * Custom format for development (human-readable)
 */
const devFormat = combine(
  colorize(),
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  printf(({ level, message, timestamp, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${String(timestamp)} [${level}]: ${String(message)}${metaStr}`;
  })
);

/**
 * Custom format for production (JSON for log aggregation)
 */
const prodFormat = combine(timestamp(), json());

/**
 * Determine log level from environment
 */
function getLogLevel(): string {
  const level = process.env.LOG_LEVEL?.toLowerCase();
  if (level && ['debug', 'info', 'warn', 'error'].includes(level)) {
    return level;
  }
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

/**
 * Create transports based on environment
 */
function getTransports(): winston.transport[] {
  const transports: winston.transport[] = [new winston.transports.Console()];

  // Add file transport for audit logging if configured
  const auditLogPath = process.env.AUDIT_LOG_PATH;
  if (auditLogPath) {
    transports.push(
      new winston.transports.File({
        filename: auditLogPath,
        level: 'info', // Only info and above for audit log
      })
    );
  }

  return transports;
}

/**
 * Main application logger
 */
export const logger = winston.createLogger({
  level: getLogLevel(),
  format: process.env.NODE_ENV === 'production' ? prodFormat : devFormat,
  transports: getTransports(),
  defaultMeta: { service: 'slack-server-monitor' },
});

/**
 * Audit-specific logging for command tracking
 * Always logs at 'info' level regardless of global settings
 */
export function auditLog(entry: {
  userId: string;
  userName: string;
  channelId: string;
  channelName: string;
  command: string;
  args: string;
}): void {
  logger.info('Command executed', {
    type: 'audit',
    ...entry,
  });
}

import { z } from 'zod';

/**
 * Slack user ID format: U followed by alphanumeric characters
 */
const SlackUserIdSchema = z.string().regex(/^U[A-Z0-9]+$/, 'Invalid Slack user ID format');

/**
 * Slack channel ID format: C followed by alphanumeric characters
 */
const SlackChannelIdSchema = z.string().regex(/^C[A-Z0-9]+$/, 'Invalid Slack channel ID format');

/**
 * Configuration schema for the Slack Server Monitor
 */
export const ConfigSchema = z.object({
  slack: z.object({
    /** Bot User OAuth Token (xoxb-...) */
    botToken: z.string().startsWith('xoxb-', 'Bot token must start with xoxb-'),
    /** App-Level Token for Socket Mode (xapp-...) */
    appToken: z.string().startsWith('xapp-', 'App token must start with xapp-'),
  }),

  authorization: z.object({
    /** Slack user IDs allowed to execute commands */
    userIds: z.array(SlackUserIdSchema).min(1, 'At least one authorized user ID is required'),
    /** Optional: Slack channel IDs where commands are allowed */
    channelIds: z.array(SlackChannelIdSchema).default([]),
  }),

  rateLimit: z.object({
    /** Maximum commands per user within the window */
    max: z.number().int().positive().default(10),
    /** Rate limit window in seconds */
    windowSeconds: z.number().int().positive().default(60),
  }),

  server: z.object({
    /** Docker socket path */
    dockerSocket: z.string().default('/var/run/docker.sock'),
    /** Container names/prefixes to monitor */
    monitoredServices: z.array(z.string()).default([]),
    /** Domains for SSL certificate checks */
    sslDomains: z.array(z.string()).default([]),
    /** Maximum log lines to return (security cap) */
    maxLogLines: z.number().int().positive().max(500).default(50),
    /** Backup directories to monitor */
    backupDirs: z.array(z.string()).default([]),
    /** S3 bucket for backup verification */
    s3BackupBucket: z.string().optional(),
  }),

  logging: z.object({
    /** Log level */
    level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    /** Path for audit log file */
    auditLogPath: z.string().optional(),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;

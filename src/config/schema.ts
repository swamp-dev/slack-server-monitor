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

  claude: z.object({
    /** Anthropic API key */
    apiKey: z.string().min(1, 'Anthropic API key is required'),
    /** Claude model to use */
    model: z.string().default('claude-sonnet-4-20250514'),
    /** Maximum tokens for response */
    maxTokens: z.number().int().positive().default(2048),
    /** Maximum tool calls per turn to prevent runaway loops */
    maxToolCalls: z.number().int().positive().max(25).default(10),
    /** Rate limit: max requests per window */
    rateLimitMax: z.number().int().positive().default(5),
    /** Rate limit: window size in seconds */
    rateLimitWindowSeconds: z.number().int().positive().default(60),
    /** Daily token budget */
    dailyTokenLimit: z.number().int().positive().default(100000),
    /** Conversation TTL in hours */
    conversationTtlHours: z.number().int().positive().default(24),
    /** SQLite database path for conversations */
    dbPath: z.string().default('./data/claude.db'),
    /** Directories Claude is allowed to read files from */
    allowedDirs: z.array(z.string()).default([]),
    /** Maximum file size to read in KB */
    maxFileSizeKb: z.number().int().positive().default(100),
    /** Maximum log lines Claude can request */
    maxLogLines: z.number().int().positive().max(100).default(50),
    /** Context directory - Claude reads CLAUDE.md and .claude/context/ from here */
    contextDir: z.string().optional(),
  }).optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

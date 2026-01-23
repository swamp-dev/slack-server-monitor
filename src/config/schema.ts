import { z } from 'zod';

/**
 * Slack user ID format: U followed by alphanumeric characters
 */
const SlackUserIdSchema = z.string().regex(/^U[A-Z0-9]+$/, 'Invalid Slack user ID format');

/**
 * SECURITY: Unsafe path prefixes for backup directories
 * These directories should never be used as backup sources
 */
const UNSAFE_BACKUP_PREFIXES = [
  '/etc',
  '/root',
  '/home',
  '/bin',
  '/sbin',
  '/usr',
  '/lib',
  '/sys',
  '/proc',
  '/dev',
  '/boot',
];

/**
 * SECURITY: Safe backup directory schema
 * Validates that backup directories are absolute paths without traversal
 * and don't point to sensitive system directories
 */
const SafeBackupDirSchema = z.string()
  .refine(
    (p) => p.startsWith('/'),
    'Backup directory must be an absolute path'
  )
  .refine(
    (p) => !p.includes('..'),
    'Backup directory cannot contain parent directory references (..)'
  )
  .refine(
    (p) => {
      const normalized = p.replace(/\/+/g, '/').replace(/\/$/, '');
      return !UNSAFE_BACKUP_PREFIXES.some(
        (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`)
      );
    },
    'Backup directory cannot be a system directory'
  );

/**
 * Slack channel ID format: C followed by alphanumeric characters
 */
const SlackChannelIdSchema = z.string().regex(/^C[A-Z0-9]+$/, 'Invalid Slack channel ID format');

/**
 * Safe CLI path pattern - only allows alphanumeric, underscores, hyphens, forward slashes, and dots
 * Prevents command injection via malicious CLI path values
 */
const SafeCliPathSchema = z.string()
  .regex(/^[a-zA-Z0-9_./-]+$/, 'CLI path contains invalid characters')
  .refine(
    (path) => !path.includes('..'),
    'CLI path cannot contain parent directory references'
  );

/**
 * Safe model name pattern - only allows alphanumeric, underscores, hyphens, and dots
 */
const SafeModelNameSchema = z.string()
  .regex(/^[a-zA-Z0-9_.-]+$/, 'Model name contains invalid characters');

/**
 * Context option schema - alias:path pair for context directory switching
 */
const ContextOptionSchema = z.object({
  /** Short alias for the context (e.g., "homelab", "infra") */
  alias: z.string().regex(/^[a-zA-Z0-9_-]+$/, 'Context alias must be alphanumeric with underscores/hyphens'),
  /** Absolute path to the context directory */
  path: z.string().min(1, 'Context path cannot be empty'),
});

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
    /** Backup directories to monitor (validated for security) */
    backupDirs: z.array(SafeBackupDirSchema).default([]),
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
    /** Backend type: api (SDK), cli (Claude Code), or auto (try api first) */
    backend: z.enum(['api', 'cli', 'auto']).default('auto'),
    /** Anthropic API key (required for 'api' backend) */
    apiKey: z.string().optional(),
    /** Claude model to use with API backend */
    model: SafeModelNameSchema.default('claude-sonnet-4-20250514'),
    /** Path to Claude CLI executable (validated to prevent command injection) */
    cliPath: SafeCliPathSchema.default('claude'),
    /** Model alias for CLI backend (e.g., 'sonnet', 'opus', 'haiku') */
    cliModel: SafeModelNameSchema.default('sonnet'),
    /** Maximum tokens for response */
    maxTokens: z.number().int().positive().default(2048),
    /** Maximum tool calls per turn to prevent runaway loops */
    maxToolCalls: z.number().int().positive().default(40),
    /** Maximum agentic loop iterations (defense in depth) */
    maxIterations: z.number().int().positive().default(50),
    /** Rate limit: max requests per window */
    rateLimitMax: z.number().int().positive().default(5),
    /** Rate limit: window size in seconds */
    rateLimitWindowSeconds: z.number().int().positive().default(60),
    /** Daily token budget (only tracked for API backend) */
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
    /** Available context directories that can be switched per-channel */
    contextOptions: z.array(ContextOptionSchema).default([]),
  }).refine(
    (data) => {
      // API backend requires an API key
      if (data.backend === 'api' && !data.apiKey) {
        return false;
      }
      // Auto backend requires at least one of api key or cli
      // (cli is always available if claude is installed)
      return true;
    },
    { message: 'API backend requires ANTHROPIC_API_KEY to be set' }
  ).optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

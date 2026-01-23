import { execSync } from 'child_process';
import { ConfigSchema, type Config } from './schema.js';

/**
 * SECURITY: Validate that the Claude CLI binary exists and is executable
 * This prevents runtime failures when the CLI backend is selected
 *
 * @throws Error if CLI is not found and backend is 'cli'
 */
function validateCliBinary(cliPath: string, backend: string): void {
  // Only validate if backend requires CLI
  if (backend !== 'cli') return;

  try {
    // Use 'which' on Unix-like systems to check if command exists
    execSync(`which "${cliPath}"`, { stdio: 'ignore', timeout: 5000 });
  } catch {
    throw new Error(
      `Claude CLI not found at '${cliPath}'. ` +
      `Install Claude CLI or set CLAUDE_BACKEND=api with an ANTHROPIC_API_KEY.`
    );
  }
}

/**
 * Parse a comma-separated string into an array, filtering empty values
 */
export function parseCommaSeparated(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Parse an integer from environment variable with a default value
 */
export function parseIntWithDefault(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Parse context options from comma-separated alias:path pairs
 * Example: "homelab:/opt/homelab,infra:/opt/infrastructure"
 */
export function parseContextOptions(value: string | undefined): { alias: string; path: string }[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((pair) => {
      const colonIndex = pair.indexOf(':');
      if (colonIndex === -1) {
        throw new Error(`Invalid context option format: "${pair}". Expected "alias:path".`);
      }
      const alias = pair.slice(0, colonIndex).trim();
      const path = pair.slice(colonIndex + 1).trim();
      if (!alias || !path) {
        throw new Error(`Invalid context option: "${pair}". Both alias and path are required.`);
      }
      return { alias, path };
    });
}

/**
 * Load and validate configuration from environment variables
 */
function loadConfig(): Config {
  const rawConfig = {
    slack: {
      botToken: process.env.SLACK_BOT_TOKEN ?? '',
      appToken: process.env.SLACK_APP_TOKEN ?? '',
    },
    authorization: {
      userIds: parseCommaSeparated(process.env.AUTHORIZED_USER_IDS),
      channelIds: parseCommaSeparated(process.env.AUTHORIZED_CHANNEL_IDS),
    },
    rateLimit: {
      max: parseIntWithDefault(process.env.RATE_LIMIT_MAX, 10),
      windowSeconds: parseIntWithDefault(process.env.RATE_LIMIT_WINDOW_SECONDS, 60),
    },
    server: {
      dockerSocket: process.env.DOCKER_SOCKET ?? '/var/run/docker.sock',
      monitoredServices: parseCommaSeparated(process.env.MONITORED_SERVICES),
      sslDomains: parseCommaSeparated(process.env.SSL_DOMAINS),
      maxLogLines: parseIntWithDefault(process.env.MAX_LOG_LINES, 50),
      backupDirs: parseCommaSeparated(process.env.BACKUP_DIRS),
      s3BackupBucket: process.env.S3_BACKUP_BUCKET ?? undefined,
    },
    logging: {
      level: (process.env.LOG_LEVEL ?? 'info') as 'debug' | 'info' | 'warn' | 'error',
      auditLogPath: process.env.AUDIT_LOG_PATH ?? undefined,
    },
    // Enable Claude if API key is set OR backend is explicitly 'cli'
    claude: (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_BACKEND === 'cli')
      ? {
          backend: (process.env.CLAUDE_BACKEND ?? 'auto') as 'api' | 'cli' | 'auto',
          apiKey: process.env.ANTHROPIC_API_KEY ?? undefined,
          model: process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-20250514',
          cliPath: process.env.CLAUDE_CLI_PATH ?? 'claude',
          cliModel: process.env.CLAUDE_CLI_MODEL ?? 'sonnet',
          maxTokens: parseIntWithDefault(process.env.CLAUDE_MAX_TOKENS, 2048),
          maxToolCalls: parseIntWithDefault(process.env.CLAUDE_MAX_TOOL_CALLS, 40),
          maxIterations: parseIntWithDefault(process.env.CLAUDE_MAX_ITERATIONS, 50),
          rateLimitMax: parseIntWithDefault(process.env.CLAUDE_RATE_LIMIT_MAX, 5),
          rateLimitWindowSeconds: parseIntWithDefault(process.env.CLAUDE_RATE_LIMIT_WINDOW_SECONDS, 60),
          dailyTokenLimit: parseIntWithDefault(process.env.CLAUDE_DAILY_TOKEN_LIMIT, 100000),
          conversationTtlHours: parseIntWithDefault(process.env.CLAUDE_CONVERSATION_TTL_HOURS, 24),
          dbPath: process.env.CLAUDE_DB_PATH ?? './data/claude.db',
          allowedDirs: parseCommaSeparated(process.env.CLAUDE_ALLOWED_DIRS),
          maxFileSizeKb: parseIntWithDefault(process.env.CLAUDE_MAX_FILE_SIZE_KB, 100),
          maxLogLines: parseIntWithDefault(process.env.CLAUDE_MAX_LOG_LINES, 50),
          contextDir: process.env.CLAUDE_CONTEXT_DIR ?? undefined,
          contextOptions: parseContextOptions(process.env.CLAUDE_CONTEXT_OPTIONS),
        }
      : undefined,
  };

  const result = ConfigSchema.safeParse(rawConfig);

  if (!result.success) {
    const errors = result.error.errors
      .map((e) => `  - ${e.path.join('.')}: ${e.message}`)
      .join('\n');
    throw new Error(`Configuration validation failed:\n${errors}`);
  }

  // Validate CLI binary exists at startup if CLI backend is selected
  if (result.data.claude) {
    validateCliBinary(result.data.claude.cliPath, result.data.claude.backend);
  }

  return result.data;
}

/**
 * Singleton configuration instance
 * Loaded once at startup and validated against schema
 */
export const config = loadConfig();

export { type Config } from './schema.js';

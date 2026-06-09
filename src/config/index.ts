import { execFileSync } from 'child_process';
import { ConfigSchema, type Config } from './schema.js';

/**
 * SECURITY: Validate that the Claude CLI binary exists and is executable
 * This prevents runtime failures when Claude is enabled
 *
 * @throws Error if CLI is not found
 */
function validateCliBinary(cliPath: string): void {
  try {
    // Use 'which' on Unix-like systems to check if command exists
    execFileSync('which', [cliPath], { stdio: 'ignore', timeout: 5000 });
  } catch {
    throw new Error(
      `Claude CLI not found at '${cliPath}'. ` +
      `Install Claude CLI or disable Claude by removing CLAUDE_ENABLED.`
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
 * Parse disk labels from comma-separated mount:label pairs
 * Example: "/mnt/storage:Storage Drive,/mnt/backupDrive:Backup Drive"
 * Malformed entries (missing colon, empty mount, empty label) are silently skipped.
 */
export function parseDiskLabels(value: string | undefined): Record<string, string> {
  if (!value) return {};
  const labels: Record<string, string> = {};
  for (const pair of value.split(',').map((s) => s.trim()).filter((s) => s.length > 0)) {
    const colonIndex = pair.indexOf(':');
    if (colonIndex === -1) continue;
    const mount = pair.slice(0, colonIndex).trim();
    const label = pair.slice(colonIndex + 1).trim();
    if (mount && label) {
      labels[mount] = label;
    }
  }
  return labels;
}

/**
 * Parse GitHub repos from comma-separated owner/repo:description pairs
 * Example: "swamp-dev/ansible:Home server playbooks,swamp-dev/bot:Slack bot"
 */
export function parseGithubRepos(value: string | undefined): { repo: string; description: string }[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((entry) => {
      const colonIndex = entry.indexOf(':');
      if (colonIndex === -1) return { repo: entry.trim(), description: '' };
      return {
        repo: entry.slice(0, colonIndex).trim(),
        description: entry.slice(colonIndex + 1).trim().replace(/\n/g, ' '),
      };
    });
}

/**
 * Parse a JSON string into a record, returning empty object on failure
 */
export function parseJsonRecord(value: string | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
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
      commands: parseJsonRecord(process.env.RATE_LIMIT_COMMANDS),
    },
    server: {
      dockerSocket: process.env.DOCKER_SOCKET ?? '/var/run/docker.sock',
      monitoredServices: parseCommaSeparated(process.env.MONITORED_SERVICES),
      sslDomains: parseCommaSeparated(process.env.SSL_DOMAINS),
      maxLogLines: parseIntWithDefault(process.env.MAX_LOG_LINES, 50),
      backupDirs: parseCommaSeparated(process.env.BACKUP_DIRS),
      s3BackupBucket: process.env.S3_BACKUP_BUCKET ?? undefined,
      diskLabels: parseDiskLabels(process.env.DISK_LABELS),
    },
    logging: {
      level: (process.env.LOG_LEVEL ?? 'info') as 'debug' | 'info' | 'warn' | 'error',
      auditLogPath: process.env.AUDIT_LOG_PATH ?? undefined,
    },
    // Enable Claude if CLAUDE_ENABLED is set to true
    claude: process.env.CLAUDE_ENABLED === 'true'
      ? {
          provider: (process.env.CLAUDE_PROVIDER ?? 'auto') as 'auto' | 'sdk' | 'cli',
          apiKey: process.env.ANTHROPIC_API_KEY ?? undefined,
          cliPath: process.env.CLAUDE_CLI_PATH ?? 'claude',
          cliModel: process.env.CLAUDE_CLI_MODEL ?? 'opus',
          sdkModel: process.env.CLAUDE_SDK_MODEL ?? 'claude-sonnet-4-20250514',
          maxTokens: parseIntWithDefault(process.env.CLAUDE_MAX_TOKENS, 2048),
          maxToolCalls: parseIntWithDefault(process.env.CLAUDE_MAX_TOOL_CALLS, 100),
          maxIterations: parseIntWithDefault(process.env.CLAUDE_MAX_ITERATIONS, 50),
          rateLimitMax: parseIntWithDefault(process.env.CLAUDE_RATE_LIMIT_MAX, 5),
          rateLimitWindowSeconds: parseIntWithDefault(process.env.CLAUDE_RATE_LIMIT_WINDOW_SECONDS, 60),
          conversationTtlHours: parseIntWithDefault(process.env.CLAUDE_CONVERSATION_TTL_HOURS, 24),
          dbPath: process.env.CLAUDE_DB_PATH ?? './data/claude.db',
          allowedDirs: parseCommaSeparated(process.env.CLAUDE_ALLOWED_DIRS),
          maxFileSizeKb: parseIntWithDefault(process.env.CLAUDE_MAX_FILE_SIZE_KB, 100),
          maxLogLines: parseIntWithDefault(process.env.CLAUDE_MAX_LOG_LINES, 50),
          contextDir: process.env.CLAUDE_CONTEXT_DIR ?? undefined,
          contextOptions: parseContextOptions(process.env.CLAUDE_CONTEXT_OPTIONS),
          cliTimeoutMs: parseIntWithDefault(process.env.CLAUDE_CLI_TIMEOUT_MS, 1_200_000),
          contextWindowTokens: parseIntWithDefault(process.env.CLAUDE_CONTEXT_WINDOW_TOKENS, 200000),
          contextTruncationThreshold: parseFloat(process.env.CLAUDE_CONTEXT_TRUNCATION_THRESHOLD ?? '0.8'),
          contextWarningThreshold: parseFloat(process.env.CLAUDE_CONTEXT_WARNING_THRESHOLD ?? '0.7'),
          dbBackupEnabled: process.env.CLAUDE_DB_BACKUP_ENABLED === 'true',
          dbBackupIntervalHours: parseIntWithDefault(process.env.CLAUDE_DB_BACKUP_INTERVAL_HOURS, 6),
          dbBackupDir: process.env.CLAUDE_DB_BACKUP_DIR ?? undefined,
          dbBackupRetain: parseIntWithDefault(process.env.CLAUDE_DB_BACKUP_RETAIN, 3),
          githubRepo: process.env.GITHUB_REPO ?? undefined,
          githubRepos: parseGithubRepos(process.env.GITHUB_REPOS),
          githubDefaultLabels: parseCommaSeparated(process.env.GITHUB_DEFAULT_LABELS),
        }
      : undefined,
    // Enable web server if WEB_ENABLED is set to true
    web: process.env.WEB_ENABLED === 'true'
      ? {
          enabled: true,
          port: parseIntWithDefault(process.env.WEB_PORT, 8080),
          baseUrl: process.env.WEB_BASE_URL ?? undefined,
          authToken: process.env.WEB_AUTH_TOKEN ?? '',
          linkTokenTtlMinutes: parseIntWithDefault(process.env.WEB_LINK_TOKEN_TTL_MINUTES, 15),
          sessionTtlHours: parseIntWithDefault(process.env.WEB_SESSION_TTL_HOURS, 72),
          registrationEnabled: process.env.WEB_REGISTRATION_ENABLED !== 'false',
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

  // Validate CLI binary exists at startup if Claude is enabled
  if (result.data.claude) {
    validateCliBinary(result.data.claude.cliPath);

    // Warn if default repo is not in the allowlist
    const { githubRepo, githubRepos } = result.data.claude;
    if (githubRepo && githubRepos.length > 0) {
      const inList = githubRepos.some((r) => r.repo === githubRepo);
      if (!inList) {
        console.warn(
          `[config] Warning: GITHUB_REPO "${githubRepo}" is not listed in GITHUB_REPOS. ` +
          `Tool calls using the default repo will be rejected by the allowlist.`
        );
      }
    }
  }

  return result.data;
}

/**
 * Singleton configuration instance
 * Loaded once at startup and validated against schema
 */
export const config = loadConfig();

export { type Config, type WebConfig } from './schema.js';

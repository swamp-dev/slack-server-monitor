import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as p from '@clack/prompts';
import { parseEnvFile, writeEnvFile, backupEnvFile, formatValue } from './env-parser.js';
import { writeFileSync } from 'fs';
import { runSlackSection } from './sections/slack.js';
import { runAuthSection } from './sections/auth.js';
import { runMonitoringSection } from './sections/monitoring.js';
import { runClaudeSection } from './sections/claude.js';
import { runWebSection } from './sections/web.js';
import { runAdvancedSection } from './sections/advanced.js';
import { runHueSection } from './sections/hue.js';

/** Convert empty string to undefined (for optional config values). */
function emptyToUndefined(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..', '..');
const ENV_PATH = resolve(PROJECT_ROOT, '.env');
const ENV_EXAMPLE_PATH = resolve(PROJECT_ROOT, '.env.example');

interface Section {
  key: string;
  label: string;
  run: (existing: Record<string, string>) => Promise<Record<string, string>>;
}

const SECTIONS: Section[] = [
  { key: 'slack', label: 'Slack App Configuration', run: runSlackSection },
  { key: 'auth', label: 'Authorization', run: runAuthSection },
  { key: 'monitoring', label: 'Server Monitoring', run: runMonitoringSection },
  { key: 'claude', label: 'Claude AI Integration', run: runClaudeSection },
  { key: 'web', label: 'Web UI', run: runWebSection },
  { key: 'hue', label: 'Philips Hue Lights', run: runHueSection },
  { key: 'advanced', label: 'Advanced Settings', run: runAdvancedSection },
];

/**
 * Mask a secret value for display, showing first 4 and last 4 characters.
 */
function maskSecret(value: string): string {
  if (value.length <= 12) return '****';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

/** Keys that contain secrets and should be masked in the summary. */
const SECRET_KEYS = new Set([
  'SLACK_BOT_TOKEN',
  'SLACK_APP_TOKEN',
  'WEB_AUTH_TOKEN',
  'HUE_API_KEY',
]);

/**
 * Format the collected vars as a summary table for review.
 */
function formatSummary(vars: Record<string, string>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(vars)) {
    if (!value) continue;
    const display = SECRET_KEYS.has(key) ? maskSecret(value) : value;
    lines.push(`  ${key}=${display}`);
  }
  return lines.join('\n');
}

/**
 * Validate the collected env vars against the Zod config schema.
 * Returns an array of error messages, or empty array if valid.
 */
async function validateConfig(
  vars: Record<string, string>
): Promise<string[]> {
  // Dynamically import to avoid pulling in all app dependencies
  // We set process.env temporarily, then use the schema to validate
  const { ConfigSchema } = await import('../config/schema.js');
  const { parseCommaSeparated, parseIntWithDefault, parseContextOptions } =
    await import('../config/index.js');

  // Build raw config object the same way loadConfig does
  const rawConfig = {
    slack: {
      botToken: vars.SLACK_BOT_TOKEN ?? '',
      appToken: vars.SLACK_APP_TOKEN ?? '',
    },
    authorization: {
      userIds: parseCommaSeparated(vars.AUTHORIZED_USER_IDS),
      channelIds: parseCommaSeparated(vars.AUTHORIZED_CHANNEL_IDS),
    },
    rateLimit: {
      max: parseIntWithDefault(vars.RATE_LIMIT_MAX, 10),
      windowSeconds: parseIntWithDefault(vars.RATE_LIMIT_WINDOW_SECONDS, 60),
    },
    server: {
      dockerSocket: vars.DOCKER_SOCKET ?? '/var/run/docker.sock',
      monitoredServices: parseCommaSeparated(vars.MONITORED_SERVICES),
      sslDomains: parseCommaSeparated(vars.SSL_DOMAINS),
      maxLogLines: parseIntWithDefault(vars.MAX_LOG_LINES, 50),
      backupDirs: parseCommaSeparated(vars.BACKUP_DIRS),
      s3BackupBucket: emptyToUndefined(vars.S3_BACKUP_BUCKET),
    },
    logging: {
      level: (vars.LOG_LEVEL ?? 'info') as 'debug' | 'info' | 'warn' | 'error',
      auditLogPath: emptyToUndefined(vars.AUDIT_LOG_PATH),
    },
    claude:
      vars.CLAUDE_ENABLED === 'true'
        ? {
            provider: (vars.CLAUDE_PROVIDER ?? 'cli') as 'cli',
            cliPath: vars.CLAUDE_CLI_PATH ?? 'claude',
            cliModel: vars.CLAUDE_CLI_MODEL ?? 'sonnet',
            maxTokens: parseIntWithDefault(vars.CLAUDE_MAX_TOKENS, 2048),
            maxToolCalls: parseIntWithDefault(vars.CLAUDE_MAX_TOOL_CALLS, 40),
            maxIterations: parseIntWithDefault(vars.CLAUDE_MAX_ITERATIONS, 50),
            rateLimitMax: parseIntWithDefault(vars.CLAUDE_RATE_LIMIT_MAX, 5),
            rateLimitWindowSeconds: parseIntWithDefault(
              vars.CLAUDE_RATE_LIMIT_WINDOW_SECONDS,
              60
            ),
            conversationTtlHours: parseIntWithDefault(
              vars.CLAUDE_CONVERSATION_TTL_HOURS,
              24
            ),
            dbPath: vars.CLAUDE_DB_PATH ?? './data/claude.db',
            allowedDirs: parseCommaSeparated(vars.CLAUDE_ALLOWED_DIRS),
            maxFileSizeKb: parseIntWithDefault(vars.CLAUDE_MAX_FILE_SIZE_KB, 100),
            maxLogLines: parseIntWithDefault(vars.CLAUDE_MAX_LOG_LINES, 50),
            contextDir: emptyToUndefined(vars.CLAUDE_CONTEXT_DIR),
            contextOptions: parseContextOptions(vars.CLAUDE_CONTEXT_OPTIONS),
          }
        : undefined,
    web:
      vars.WEB_ENABLED === 'true'
        ? {
            enabled: true,
            port: parseIntWithDefault(vars.WEB_PORT, 8080),
            baseUrl: emptyToUndefined(vars.WEB_BASE_URL),
            authToken: vars.WEB_AUTH_TOKEN ?? '',
            linkTokenTtlMinutes: parseIntWithDefault(vars.WEB_LINK_TOKEN_TTL_MINUTES, 15),
            sessionTtlHours: parseIntWithDefault(vars.WEB_SESSION_TTL_HOURS, 72),
          }
        : undefined,
  };

  const result = ConfigSchema.safeParse(rawConfig);
  if (result.success) {
    return [];
  }

  return result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`);
}

async function main(): Promise<void> {
  p.intro('slack-server-monitor setup');

  const envExists = existsSync(ENV_PATH);
  const existing = envExists ? parseEnvFile(ENV_PATH) : {};

  let sectionsToRun: Section[];

  if (envExists) {
    p.log.info('Existing .env file detected.');

    const mode = await p.select({
      message: 'What would you like to do?',
      options: [
        { value: 'reconfig', label: 'Reconfigure specific sections', hint: 'Keep existing values for unchanged sections' },
        { value: 'fresh', label: 'Fresh start', hint: 'Reconfigure everything from scratch' },
      ],
    });

    if (p.isCancel(mode)) {
      p.cancel('Setup cancelled.');
      process.exit(0);
    }

    if (mode === 'reconfig') {
      const selected = await p.multiselect({
        message: 'Which sections do you want to reconfigure?',
        options: SECTIONS.map((s) => ({
          value: s.key,
          label: s.label,
        })),
        required: true,
      });

      if (p.isCancel(selected)) {
        p.cancel('Setup cancelled.');
        process.exit(0);
      }

      sectionsToRun = SECTIONS.filter((s) => selected.includes(s.key));
    } else {
      sectionsToRun = SECTIONS;
    }
  } else {
    p.log.info('No .env file found. Starting fresh setup.');
    sectionsToRun = SECTIONS;
  }

  // Collect vars from each section
  const collectedVars: Record<string, string> = {};

  for (const section of sectionsToRun) {
    p.log.step(section.label);
    const sectionVars = await section.run(existing);
    Object.assign(collectedVars, sectionVars);
  }

  // Merge: existing values as base, collected vars on top
  const finalVars: Record<string, string> = { ...existing, ...collectedVars };

  // Show summary
  p.note(formatSummary(finalVars), 'Configuration Summary');

  const proceed = await p.confirm({
    message: 'Write this configuration to .env?',
    initialValue: true,
  });

  if (p.isCancel(proceed) || !proceed) {
    p.cancel('Setup cancelled. No files were changed.');
    process.exit(0);
  }

  // Backup existing .env if present
  if (envExists) {
    const backupPath = backupEnvFile(ENV_PATH);
    p.log.info(`Backed up existing .env to ${backupPath}`);
  }

  // Write .env using template
  if (!existsSync(ENV_EXAMPLE_PATH)) {
    p.log.warn('.env.example not found. Writing plain key=value file.');
    // Fallback: write without template, using formatValue for proper quoting
    const lines = Object.entries(finalVars)
      .map(([k, v]) => `${k}=${formatValue(v)}`)
      .join('\n');
    writeFileSync(ENV_PATH, lines + '\n');
  } else {
    writeEnvFile(ENV_PATH, finalVars, ENV_EXAMPLE_PATH);
  }

  p.log.success('.env file written.');

  // Validate against schema
  const spinner = p.spinner();
  spinner.start('Validating configuration...');

  const errors = await validateConfig(finalVars);

  if (errors.length > 0) {
    spinner.stop('Validation found issues');
    p.log.warn('Configuration validation warnings:');
    for (const err of errors) {
      p.log.warn(`  - ${err}`);
    }
    p.log.info('You can fix these by running `npm run setup` again.');
  } else {
    spinner.stop('Configuration is valid');
  }

  p.outro(
    'Setup complete! Run `npm run dev` to start in development mode.'
  );
}

main().catch((err: unknown) => {
  p.log.error(`Setup failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});

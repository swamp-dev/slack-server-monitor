import * as p from '@clack/prompts';
import { validateAbsolutePath } from '../validators.js';

/**
 * Validate a positive integer string.
 */
function validatePositiveInt(value: string | undefined): string | undefined {
  if (!value) return 'Must be a positive integer';
  const num = parseInt(value, 10);
  if (isNaN(num) || num < 1) {
    return 'Must be a positive integer';
  }
  return undefined;
}

/**
 * Advanced settings section.
 * Rate limits, logging, Docker socket path.
 */
export async function runAdvancedSection(
  existing: Record<string, string>
): Promise<Record<string, string>> {
  const rateLimitMax = await p.text({
    message: 'Max commands per user per window',
    placeholder: '10',
    initialValue: existing.RATE_LIMIT_MAX ?? '10',
    validate: validatePositiveInt,
  });

  if (p.isCancel(rateLimitMax)) {
    p.cancel('Setup cancelled.');
    process.exit(0);
  }

  const rateLimitWindow = await p.text({
    message: 'Rate limit window in seconds',
    placeholder: '60',
    initialValue: existing.RATE_LIMIT_WINDOW_SECONDS ?? '60',
    validate: validatePositiveInt,
  });

  if (p.isCancel(rateLimitWindow)) {
    p.cancel('Setup cancelled.');
    process.exit(0);
  }

  const logLevel = await p.select({
    message: 'Log level',
    initialValue: existing.LOG_LEVEL ?? 'info',
    options: [
      { value: 'debug', label: 'Debug', hint: 'Verbose output' },
      { value: 'info', label: 'Info', hint: 'Standard (recommended)' },
      { value: 'warn', label: 'Warn', hint: 'Warnings and errors only' },
      { value: 'error', label: 'Error', hint: 'Errors only' },
    ],
  });

  if (p.isCancel(logLevel)) {
    p.cancel('Setup cancelled.');
    process.exit(0);
  }

  const auditLogPath = await p.text({
    message: 'Audit log file path (optional, logs to console if empty)',
    placeholder: '/var/log/slack-monitor/audit.log',
    initialValue: existing.AUDIT_LOG_PATH ?? '',
    validate(value) {
      if (!value?.trim()) return undefined;
      return validateAbsolutePath(value);
    },
  });

  if (p.isCancel(auditLogPath)) {
    p.cancel('Setup cancelled.');
    process.exit(0);
  }

  const dockerSocket = await p.text({
    message: 'Docker socket path',
    placeholder: '/var/run/docker.sock',
    initialValue: existing.DOCKER_SOCKET ?? '/var/run/docker.sock',
    validate: validateAbsolutePath,
  });

  if (p.isCancel(dockerSocket)) {
    p.cancel('Setup cancelled.');
    process.exit(0);
  }

  return {
    RATE_LIMIT_MAX: rateLimitMax,
    RATE_LIMIT_WINDOW_SECONDS: rateLimitWindow,
    LOG_LEVEL: logLevel,
    AUDIT_LOG_PATH: auditLogPath,
    DOCKER_SOCKET: dockerSocket,
  };
}

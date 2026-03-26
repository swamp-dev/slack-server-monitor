import { randomBytes } from 'crypto';
import { spawnSync } from 'child_process';

/**
 * Validate Slack Bot Token format.
 * Returns error message or undefined if valid.
 */
export function validateSlackBotToken(value: string | undefined): string | undefined {
  if (!value?.startsWith('xoxb-')) {
    return 'Bot token must start with xoxb-';
  }
  return undefined;
}

/**
 * Validate Slack App Token format.
 * Returns error message or undefined if valid.
 */
export function validateSlackAppToken(value: string | undefined): string | undefined {
  if (!value?.startsWith('xapp-')) {
    return 'App token must start with xapp-';
  }
  return undefined;
}

/**
 * Validate comma-separated Slack user IDs.
 * Returns error message or undefined if valid.
 */
export function validateUserIds(value: string | undefined): string | undefined {
  if (!value?.trim()) {
    return 'At least one user ID is required';
  }
  const ids = value.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  const pattern = /^U[A-Z0-9]+$/;
  for (const id of ids) {
    if (!pattern.test(id)) {
      return 'Each user ID must match U[A-Z0-9]+ (e.g., U01ABC123)';
    }
  }
  return undefined;
}

/**
 * Validate comma-separated Slack channel IDs.
 * Empty string is valid (channels are optional).
 * Returns error message or undefined if valid.
 */
export function validateChannelIds(value: string | undefined): string | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  const ids = value.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  const pattern = /^C[A-Z0-9]+$/;
  for (const id of ids) {
    if (!pattern.test(id)) {
      return 'Each channel ID must match C[A-Z0-9]+ (e.g., C01ABC123)';
    }
  }
  return undefined;
}

/**
 * Validate a URL string.
 * Returns error message or undefined if valid.
 */
export function validateUrl(value: string | undefined): string | undefined {
  try {
    if (!value) throw new Error('empty');
    new URL(value);
    return undefined;
  } catch {
    return 'Must be a valid URL (e.g., http://hostname:port)';
  }
}

/**
 * Validate an absolute filesystem path.
 * Returns error message or undefined if valid.
 */
export function validateAbsolutePath(value: string | undefined): string | undefined {
  if (!value?.startsWith('/')) {
    return 'Must be an absolute path (starting with /)';
  }
  if (value.includes('..')) {
    return 'Path cannot contain ..';
  }
  return undefined;
}

/**
 * Generate a cryptographically secure 32-character hex secret.
 */
export function generateSecret(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Check if a CLI command exists on the system.
 * Uses the command itself with --version instead of relying on `which`.
 */
export function checkCliExists(cmdPath: string): boolean {
  try {
    const result = spawnSync(cmdPath, ['--version'], {
      stdio: 'ignore',
      timeout: 5000,
      shell: false,
    });
    return result.status === 0 && result.error === undefined;
  } catch {
    return false;
  }
}

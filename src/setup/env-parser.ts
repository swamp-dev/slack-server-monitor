import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'fs';

/**
 * Parse a .env file into a key-value map.
 * Handles comments, blank lines, quoted values, and values with equals signs.
 * Returns empty object if file does not exist.
 */
export function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) {
    return {};
  }

  const content = readFileSync(path, 'utf-8');
  const result: Record<string, string> = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

/**
 * Format a value for .env file output.
 * Wraps in double quotes and escapes inner quotes if value contains
 * special characters (spaces, #, $, quotes, backticks, newlines).
 */
export function formatValue(value: string): string {
  if (/[ #"'`$\\n]/.test(value)) {
    const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `"${escaped}"`;
  }
  return value;
}

/**
 * Write a .env file using a template (.env.example) for structure and comments.
 *
 * For each line in the template:
 * - Comments and blank lines are preserved as-is
 * - KEY=VALUE lines: if key is in vars, use the vars value; otherwise keep template default
 * - Commented-out KEY lines (# KEY=value): if key is in vars, uncomment and use vars value
 */
export function writeEnvFile(
  outputPath: string,
  vars: Record<string, string>,
  templatePath: string
): void {
  const template = readFileSync(templatePath, 'utf-8');
  const lines = template.split('\n');
  const outputLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Check for commented-out KEY=VALUE (e.g., "# FOO=bar")
    const commentedMatch = /^#\s*([A-Z_][A-Z0-9_]*)=(.*)$/.exec(trimmed);
    if (commentedMatch) {
      const key = commentedMatch[1] ?? '';
      if (key in vars) {
        // Uncomment and set the value
        outputLines.push(`${key}=${formatValue(vars[key] ?? '')}`);
        continue;
      }
      // Keep as-is (commented out)
      outputLines.push(line);
      continue;
    }

    // Check for active KEY=VALUE
    const activeMatch = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(trimmed);
    if (activeMatch) {
      const key = activeMatch[1] ?? '';
      if (key in vars) {
        outputLines.push(`${key}=${formatValue(vars[key] ?? '')}`);
      } else {
        // Keep template default
        outputLines.push(line);
      }
      continue;
    }

    // Comments and blank lines pass through
    outputLines.push(line);
  }

  const output = outputLines.join('\n');
  writeFileSync(outputPath, output.endsWith('\n') ? output : output + '\n');
}

/**
 * Create a timestamped backup of a .env file.
 * Returns the backup file path.
 * Throws if source file does not exist.
 */
export function backupEnvFile(path: string): string {
  if (!existsSync(path)) {
    throw new Error(`Cannot backup: file does not exist: ${path}`);
  }

  const timestamp = new Date().toISOString().replace(/[/:]/g, '-');
  const backupPath = `${path}.backup.${timestamp}`;
  copyFileSync(path, backupPath);
  return backupPath;
}

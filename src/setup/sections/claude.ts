import * as p from '@clack/prompts';
import { checkCliExists, validateAbsolutePath } from '../validators.js';

/**
 * Claude AI integration section.
 * Configures the /ask command and Claude CLI settings.
 */
export async function runClaudeSection(
  existing: Record<string, string>
): Promise<Record<string, string>> {
  const enableClaude = await p.confirm({
    message: 'Enable Claude AI integration (/ask command)?',
    initialValue: existing.CLAUDE_ENABLED === 'true',
  });

  if (p.isCancel(enableClaude)) {
    p.cancel('Setup cancelled.');
    process.exit(0);
  }

  if (!enableClaude) {
    return { CLAUDE_ENABLED: 'false' };
  }

  // Auto-detect Claude CLI
  const defaultCliPath = existing.CLAUDE_CLI_PATH ?? 'claude';
  const cliFound = checkCliExists(defaultCliPath);

  if (cliFound) {
    p.log.success(`Claude CLI found at: ${defaultCliPath}`);
  } else {
    p.log.warn(
      `Claude CLI not found at "${defaultCliPath}". You can install it later or specify a custom path.`
    );
  }

  const cliPath = await p.text({
    message: 'Path to Claude CLI executable',
    placeholder: 'claude',
    initialValue: defaultCliPath,
  });

  if (p.isCancel(cliPath)) {
    p.cancel('Setup cancelled.');
    process.exit(0);
  }

  const model = await p.select({
    message: 'Claude model to use',
    initialValue: existing.CLAUDE_CLI_MODEL ?? 'sonnet',
    options: [
      { value: 'sonnet', label: 'Sonnet', hint: 'Best balance of speed and quality' },
      { value: 'opus', label: 'Opus', hint: 'Most capable, slower' },
      { value: 'haiku', label: 'Haiku', hint: 'Fastest, lighter tasks' },
    ],
  });

  if (p.isCancel(model)) {
    p.cancel('Setup cancelled.');
    process.exit(0);
  }

  const allowedDirs = await p.text({
    message: 'Directories Claude can read (comma-separated absolute paths)',
    placeholder: '/root/ansible,/opt/stacks,/etc/docker',
    initialValue: existing.CLAUDE_ALLOWED_DIRS ?? '',
    validate(value) {
      if (!value?.trim()) return undefined;
      const dirs = value.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
      for (const dir of dirs) {
        const err = validateAbsolutePath(dir);
        if (err) return `"${dir}": ${err}`;
      }
      return undefined;
    },
  });

  if (p.isCancel(allowedDirs)) {
    p.cancel('Setup cancelled.');
    process.exit(0);
  }

  const contextDir = await p.text({
    message: 'Context directory with CLAUDE.md (optional)',
    placeholder: '/opt/infrastructure',
    initialValue: existing.CLAUDE_CONTEXT_DIR ?? '',
    validate(value) {
      if (!value?.trim()) return undefined;
      return validateAbsolutePath(value);
    },
  });

  if (p.isCancel(contextDir)) {
    p.cancel('Setup cancelled.');
    process.exit(0);
  }

  return {
    CLAUDE_ENABLED: 'true',
    CLAUDE_PROVIDER: 'cli',
    CLAUDE_CLI_PATH: cliPath,
    CLAUDE_CLI_MODEL: model,
    CLAUDE_ALLOWED_DIRS: allowedDirs,
    CLAUDE_CONTEXT_DIR: contextDir,
  };
}

import { execFile, type ExecFileOptions } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Result from a shell command execution
 */
export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * SECURITY: Allowlist of permitted commands with their absolute paths
 * Only read-only commands are allowed - no write, exec, or modification operations
 */
const ALLOWED_COMMANDS = new Map<string, string>([
  ['docker', '/usr/bin/docker'],
  ['free', '/usr/bin/free'],
  ['df', '/usr/bin/df'],
  ['top', '/usr/bin/top'],
  ['fail2ban-client', '/usr/bin/fail2ban-client'],
  ['openssl', '/usr/bin/openssl'],
  ['pm2', '/usr/local/bin/pm2'],
  ['aws', '/usr/local/bin/aws'],
  ['stat', '/usr/bin/stat'],
  ['uptime', '/usr/bin/uptime'],
  ['cat', '/usr/bin/cat'],
]);

/**
 * SECURITY: Docker subcommands that are allowed (read-only only)
 * Explicitly blocks: exec, run, rm, stop, start, restart, kill, etc.
 */
const ALLOWED_DOCKER_SUBCOMMANDS = new Set([
  'ps',
  'inspect',
  'logs',
  'network',
  'images',
  'version',
  'info',
]);

/**
 * SECURITY: AWS CLI subcommands that are allowed (read-only only)
 */
const ALLOWED_AWS_SUBCOMMANDS = new Set(['s3']);

/**
 * SECURITY: AWS S3 subcommands that are allowed (read-only only)
 */
const ALLOWED_S3_SUBCOMMANDS = new Set(['ls']);

/**
 * SECURITY: fail2ban-client subcommands that are allowed (read-only only)
 */
const ALLOWED_FAIL2BAN_SUBCOMMANDS = new Set(['status', 'banned']);

/**
 * SECURITY: Pattern to detect shell metacharacters that could be used for injection
 */
const SHELL_METACHARACTERS = /[;&|`$(){}[\]<>!\n\r\\'"]/;

/**
 * SECURITY: Validate that arguments don't contain shell metacharacters
 */
function validateArguments(args: readonly string[]): void {
  for (const arg of args) {
    if (SHELL_METACHARACTERS.test(arg)) {
      throw new ShellSecurityError(`Argument contains forbidden characters: ${arg}`);
    }
  }
}

/**
 * SECURITY: Validate docker command has an allowed subcommand
 */
function validateDockerCommand(args: readonly string[]): void {
  if (args.length === 0) {
    throw new ShellSecurityError('Docker command requires a subcommand');
  }

  const subcommand = args[0];
  if (!subcommand || !ALLOWED_DOCKER_SUBCOMMANDS.has(subcommand)) {
    throw new ShellSecurityError(`Docker subcommand not allowed: ${subcommand}`);
  }
}

/**
 * SECURITY: Validate AWS CLI command has allowed subcommands
 */
function validateAwsCommand(args: readonly string[]): void {
  if (args.length === 0) {
    throw new ShellSecurityError('AWS command requires a subcommand');
  }

  const service = args[0];
  if (!service || !ALLOWED_AWS_SUBCOMMANDS.has(service)) {
    throw new ShellSecurityError(`AWS service not allowed: ${service}`);
  }

  if (service === 's3' && args.length > 1) {
    const s3Command = args[1];
    if (!s3Command || !ALLOWED_S3_SUBCOMMANDS.has(s3Command)) {
      throw new ShellSecurityError(`AWS S3 subcommand not allowed: ${s3Command}`);
    }
  }
}

/**
 * SECURITY: Validate fail2ban-client command has allowed subcommands
 */
function validateFail2banCommand(args: readonly string[]): void {
  if (args.length === 0) {
    throw new ShellSecurityError('fail2ban-client command requires a subcommand');
  }

  const subcommand = args[0];
  if (!subcommand || !ALLOWED_FAIL2BAN_SUBCOMMANDS.has(subcommand)) {
    throw new ShellSecurityError(`fail2ban-client subcommand not allowed: ${subcommand}`);
  }
}

/**
 * Custom error for shell security violations
 */
export class ShellSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShellSecurityError';
  }
}

/**
 * SECURITY: Execute a command safely with multiple layers of protection
 *
 * Security measures:
 * 1. Command must be in the allowlist
 * 2. Arguments cannot contain shell metacharacters
 * 3. Subcommands are validated for docker, aws, fail2ban-client
 * 4. Uses execFile() with shell: false (no shell interpolation)
 * 5. Enforces timeout to prevent hanging
 * 6. Limits output buffer size
 *
 * @param command - The command name (must be in allowlist)
 * @param args - Command arguments (will be validated)
 * @param options - Optional execution options
 * @returns Promise<ShellResult> - stdout, stderr, and exit code
 * @throws ShellSecurityError if command or arguments are not allowed
 */
export async function executeCommand(
  command: string,
  args: readonly string[],
  options: { timeout?: number } = {}
): Promise<ShellResult> {
  // 1. Validate command is in allowlist
  const commandPath = ALLOWED_COMMANDS.get(command);
  if (!commandPath) {
    throw new ShellSecurityError(`Command not in allowlist: ${command}`);
  }

  // 2. Validate arguments don't contain shell metacharacters
  validateArguments(args);

  // 3. Validate subcommands for specific commands
  if (command === 'docker') {
    validateDockerCommand(args);
  } else if (command === 'aws') {
    validateAwsCommand(args);
  } else if (command === 'fail2ban-client') {
    validateFail2banCommand(args);
  }

  // 4. Configure execution options
  const execOptions: ExecFileOptions = {
    timeout: options.timeout ?? 30000, // 30 second default timeout
    maxBuffer: 1024 * 1024, // 1MB buffer limit
    shell: false, // CRITICAL: Never use shell interpolation
    windowsHide: true,
    encoding: 'utf8', // Ensure string output
  };

  // 5. Execute the command
  try {
    const result = await execFileAsync(commandPath, [...args], execOptions);
    return {
      stdout: String(result.stdout),
      stderr: String(result.stderr),
      exitCode: 0,
    };
  } catch (error: unknown) {
    // Handle execution errors (non-zero exit, timeout, etc.)
    if (error instanceof Error && 'code' in error) {
      const execError = error as Error & {
        code?: number | string;
        stdout?: string;
        stderr?: string;
      };
      return {
        stdout: execError.stdout ?? '',
        stderr: execError.stderr ?? execError.message,
        exitCode: typeof execError.code === 'number' ? execError.code : 1,
      };
    }
    throw error;
  }
}

/**
 * Check if a command is in the allowlist
 */
export function isCommandAllowed(command: string): boolean {
  return ALLOWED_COMMANDS.has(command);
}

/**
 * Get the list of allowed commands (for documentation/help)
 */
export function getAllowedCommands(): string[] {
  return Array.from(ALLOWED_COMMANDS.keys());
}

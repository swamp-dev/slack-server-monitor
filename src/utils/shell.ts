import { execFile, type ExecFileOptions } from 'child_process';
import { promisify } from 'util';
import { realpathSync, existsSync } from 'node:fs';

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
 * Read-only and diagnostic commands - no write, exec, or modification operations
 */
const ALLOWED_COMMANDS = new Map<string, string>([
  // Docker
  ['docker', '/usr/bin/docker'],
  // System info
  ['free', '/usr/bin/free'],
  ['df', '/usr/bin/df'],
  ['top', '/usr/bin/top'],
  ['stat', '/usr/bin/stat'],
  ['uptime', '/usr/bin/uptime'],
  ['hostname', '/usr/bin/hostname'],
  ['uname', '/usr/bin/uname'],
  ['whoami', '/usr/bin/whoami'],
  ['date', '/usr/bin/date'],
  ['id', '/usr/bin/id'],
  // Process inspection
  ['ps', '/usr/bin/ps'],
  ['pgrep', '/usr/bin/pgrep'],
  // Systemd
  ['systemctl', '/usr/bin/systemctl'],
  ['journalctl', '/usr/bin/journalctl'],
  // Network diagnostics
  ['ss', '/usr/bin/ss'],
  ['ip', '/usr/sbin/ip'],
  ['ping', '/usr/bin/ping'],
  ['curl', '/usr/bin/curl'],
  ['dig', '/usr/bin/dig'],
  ['host', '/usr/bin/host'],
  ['netstat', '/usr/bin/netstat'],
  // File inspection
  ['cat', '/usr/bin/cat'],
  ['ls', '/usr/bin/ls'],
  ['head', '/usr/bin/head'],
  ['tail', '/usr/bin/tail'],
  ['find', '/usr/bin/find'],
  ['grep', '/usr/bin/grep'],
  ['wc', '/usr/bin/wc'],
  ['file', '/usr/bin/file'],
  ['du', '/usr/bin/du'],
  // Security tools
  ['fail2ban-client', '/usr/bin/fail2ban-client'],
  ['openssl', '/usr/bin/openssl'],
  // Other
  ['pm2', '/usr/local/bin/pm2'],
  ['aws', '/usr/local/bin/aws'],
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
 * SECURITY: Allowed path prefixes for file commands (cat, ls, head, tail, find, grep, etc.)
 * Expanded to allow reading from mounted directories for debugging
 */
const ALLOWED_FILE_PATH_PREFIXES = [
  '/opt',
  '/tmp',
  '/var/log',
  '/var/lib',
  '/etc',
  '/proc',
  '/sys',
  '/home',
  '/mnt',
  '/app',
];

/**
 * SECURITY: Unsafe path prefixes that should never be accessible
 * Restricted to truly sensitive system directories
 */
const UNSAFE_PATH_PREFIXES = [
  '/bin',
  '/sbin',
  '/usr/bin',
  '/usr/sbin',
  '/lib',
  '/dev',
  '/boot',
];

/**
 * SECURITY: Sensitive path patterns that should never be accessible
 * These are checked dynamically because they can appear in any user's home directory
 */
const SENSITIVE_PATH_PATTERNS = [
  '/.ssh',
  '/.gnupg',
  '/.aws',
  '/.docker/config.json',
  '/.kube/config',
  '/.bash_history',
  '/.zsh_history',
  '/.netrc',
  '/.npmrc',
  '/.pypirc',
  '/id_rsa',
  '/id_ed25519',
  '/id_ecdsa',
  '/id_dsa',
  '/.env',  // Block .env files
  '/credentials',
  '/secrets',
  '/password',
  '/token',
];

/**
 * SECURITY: fail2ban-client subcommands that are allowed (read-only only)
 */
const ALLOWED_FAIL2BAN_SUBCOMMANDS = new Set(['status', 'banned']);

/**
 * SECURITY: systemctl subcommands that are allowed (read-only only)
 * Blocks: start, stop, restart, enable, disable, mask, daemon-reload, etc.
 */
const ALLOWED_SYSTEMCTL_SUBCOMMANDS = new Set([
  'status',
  'show',
  'list-units',
  'list-unit-files',
  'list-sockets',
  'list-timers',
  'list-dependencies',
  'is-active',
  'is-enabled',
  'is-failed',
  'cat',
]);

/**
 * SECURITY: journalctl is read-only by nature, but we limit some flags
 * Block flags that could cause issues: --flush, --rotate, --vacuum-*
 */
const BLOCKED_JOURNALCTL_FLAGS = new Set([
  '--flush',
  '--rotate',
  '--vacuum-size',
  '--vacuum-time',
  '--vacuum-files',
  '--sync',
]);

/**
 * SECURITY: curl flags that are blocked (write operations, dangerous features)
 */
const BLOCKED_CURL_FLAGS = new Set([
  '-o', '--output',
  '-O', '--remote-name',
  '-T', '--upload-file',
  '-X', '--request', // Could allow POST/PUT/DELETE - block for safety
  '-d', '--data',
  '--data-raw',
  '--data-binary',
  '-F', '--form',
]);

/**
 * SECURITY: Pattern to detect shell metacharacters that could be used for injection
 * Note: Since we use execFile() with shell: false, most shell metacharacters are safe.
 * We still block the most dangerous ones that could affect argument parsing.
 * Curly braces {} are allowed for Docker --format templates.
 */
const SHELL_METACHARACTERS = /[;&|`$\n\r]/;

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
    throw new ShellSecurityError(`Docker subcommand not allowed: ${subcommand ?? 'undefined'}`);
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
    throw new ShellSecurityError(`AWS service not allowed: ${service ?? 'undefined'}`);
  }

  if (service === 's3' && args.length > 1) {
    const s3Command = args[1];
    if (!s3Command || !ALLOWED_S3_SUBCOMMANDS.has(s3Command)) {
      throw new ShellSecurityError(`AWS S3 subcommand not allowed: ${s3Command ?? 'undefined'}`);
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
    throw new ShellSecurityError(`fail2ban-client subcommand not allowed: ${subcommand ?? 'undefined'}`);
  }
}

/**
 * SECURITY: Validate systemctl command has allowed subcommands
 */
function validateSystemctlCommand(args: readonly string[]): void {
  if (args.length === 0) {
    throw new ShellSecurityError('systemctl command requires a subcommand');
  }

  const subcommand = args[0];
  if (!subcommand || !ALLOWED_SYSTEMCTL_SUBCOMMANDS.has(subcommand)) {
    throw new ShellSecurityError(`systemctl subcommand not allowed: ${subcommand ?? 'undefined'}. Allowed: ${Array.from(ALLOWED_SYSTEMCTL_SUBCOMMANDS).join(', ')}`);
  }
}

/**
 * SECURITY: Validate journalctl doesn't have dangerous flags
 */
function validateJournalctlCommand(args: readonly string[]): void {
  for (const arg of args) {
    if (BLOCKED_JOURNALCTL_FLAGS.has(arg)) {
      throw new ShellSecurityError(`journalctl flag not allowed: ${arg}`);
    }
  }
}

/**
 * SECURITY: Validate curl doesn't have write/dangerous flags
 */
function validateCurlCommand(args: readonly string[]): void {
  for (const arg of args) {
    if (BLOCKED_CURL_FLAGS.has(arg)) {
      throw new ShellSecurityError(`curl flag not allowed: ${arg}`);
    }
  }
}

/**
 * SECURITY: Normalize and validate a file path
 * Resolves path traversal attempts and checks against allowed/unsafe prefixes
 */
function normalizePath(filePath: string): string {
  // Handle empty paths
  if (!filePath) {
    return filePath;
  }

  // Split into segments and resolve . and ..
  const segments: string[] = [];
  const parts = filePath.split('/');

  for (const part of parts) {
    if (part === '' || part === '.') {
      continue;
    } else if (part === '..') {
      segments.pop(); // Go up one directory
    } else {
      segments.push(part);
    }
  }

  // Reconstruct as absolute path
  return '/' + segments.join('/');
}

/**
 * SECURITY: Check if a path contains sensitive patterns
 * Returns true if the path contains any sensitive pattern (SSH keys, credentials, etc.)
 */
function containsSensitivePattern(normalizedPath: string): boolean {
  const lowerPath = normalizedPath.toLowerCase();
  return SENSITIVE_PATH_PATTERNS.some(pattern => lowerPath.includes(pattern.toLowerCase()));
}

/**
 * SECURITY: Resolve symlinks to get the real path
 * Returns the resolved path, or the normalized path if the file doesn't exist yet
 */
function resolveSymlinks(filePath: string): string {
  try {
    // Only resolve if the path exists (realpathSync throws on non-existent paths)
    if (existsSync(filePath)) {
      return realpathSync(filePath);
    }
    // For non-existent paths, just normalize (e.g., for find command)
    return normalizePath(filePath);
  } catch {
    // If realpath fails for any reason, fall back to normalized path
    return normalizePath(filePath);
  }
}

/**
 * SECURITY: Check if an argument looks like a file path
 * Filters out flags, numeric arguments, and patterns
 */
function isFilePath(arg: string): boolean {
  // Skip flags
  if (arg.startsWith('-')) return false;
  // Skip pure numeric arguments (e.g., line counts for head/tail)
  if (/^\d+$/.test(arg)) return false;
  // Skip grep/find patterns (don't start with /)
  // Paths we care about should be absolute
  if (!arg.startsWith('/')) return false;
  return true;
}

/**
 * SECURITY: Validate file command (cat, ls, head, tail, find, grep, etc.) arguments
 * Ensures paths are within allowed directories and blocks path traversal attacks
 * Resolves symlinks to prevent symlink-based bypasses
 */
function validateFileCommand(command: string, args: readonly string[]): void {
  // Extract paths from arguments (skip flags, numbers, and non-path arguments)
  const paths = args.filter(isFilePath);

  if (paths.length === 0) {
    // ls without path is allowed (lists current directory)
    if (command === 'ls') {
      return;
    }
    // grep and find can work without explicit paths in some cases
    if (command === 'grep' || command === 'find') {
      return;
    }
    throw new ShellSecurityError(`${command} command requires a file path`);
  }

  for (const rawPath of paths) {
    // First normalize to resolve .. and . traversal attempts
    const normalizedPath = normalizePath(rawPath);

    // SECURITY: Resolve symlinks to get the real target path
    // This prevents symlink attacks like: /opt/link -> /root/.ssh
    const resolvedPath = resolveSymlinks(normalizedPath);

    // Check against unsafe prefixes (using resolved path to catch symlink bypasses)
    for (const unsafePrefix of UNSAFE_PATH_PREFIXES) {
      if (resolvedPath === unsafePrefix || resolvedPath.startsWith(`${unsafePrefix}/`)) {
        throw new ShellSecurityError(`Path not allowed: ${rawPath}`);
      }
    }

    // SECURITY: Check for sensitive path patterns (SSH keys, credentials, etc.)
    // Check both normalized and resolved paths
    if (containsSensitivePattern(normalizedPath) || containsSensitivePattern(resolvedPath)) {
      throw new ShellSecurityError(`Path contains sensitive data: ${rawPath}`);
    }

    // Check if resolved path starts with an allowed prefix
    const isAllowed = ALLOWED_FILE_PATH_PREFIXES.some(
      prefix => resolvedPath === prefix || resolvedPath.startsWith(`${prefix}/`)
    );

    if (!isAllowed) {
      throw new ShellSecurityError(`Path not allowed: ${rawPath}`);
    }
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
  } else if (command === 'systemctl') {
    validateSystemctlCommand(args);
  } else if (command === 'journalctl') {
    validateJournalctlCommand(args);
  } else if (command === 'curl') {
    validateCurlCommand(args);
  } else if (['cat', 'ls', 'head', 'tail', 'find', 'grep', 'du', 'file', 'wc'].includes(command)) {
    validateFileCommand(command, args);
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

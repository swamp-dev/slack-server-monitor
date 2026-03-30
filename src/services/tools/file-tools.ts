import fs from 'fs/promises';
import path from 'path';
import type { ToolDefinition, ToolConfig } from './types.js';
import { scrubSensitiveData } from '../../formatters/scrub.js';

/**
 * SECURITY: Validate that a path is within allowed directories
 * Prevents path traversal attacks including symlink attacks
 *
 * Note: This function only checks the logical path. For full security,
 * also use validateRealPath() to check against symlink resolution.
 */
export function isPathAllowed(filePath: string, allowedDirs: string[]): boolean {
  if (allowedDirs.length === 0) {
    return false;
  }

  // Resolve to absolute path (does NOT follow symlinks)
  const normalizedPath = path.resolve(filePath);

  // Check if path starts with any allowed directory
  return allowedDirs.some(dir => {
    const normalizedDir = path.resolve(dir);
    // Ensure we match full directory components (not just prefix)
    // e.g., /home/user should not match /home/username
    return normalizedPath === normalizedDir ||
           normalizedPath.startsWith(normalizedDir + path.sep);
  });
}

/**
 * SECURITY: Validate real path after symlink resolution
 * Must be called AFTER isPathAllowed to catch symlink attacks
 */
export async function validateRealPath(filePath: string, allowedDirs: string[]): Promise<{ valid: boolean; realPath?: string; error?: string }> {
  try {
    const realPath = await fs.realpath(filePath);

    // Check if the resolved real path is still within allowed directories
    if (!isPathAllowed(realPath, allowedDirs)) {
      return {
        valid: false,
        error: 'Symlink target is outside allowed directories',
      };
    }

    return { valid: true, realPath };
  } catch {
    return { valid: false, error: 'Path does not exist' };
  }
}

/**
 * SECURITY: List of file extensions that are safe to read as text
 * Note: .env files intentionally excluded - even with scrubbing, exposing
 * actual environment files is risky. Only .env.example is allowed.
 */
const SAFE_TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf',
  '.sh', '.bash', '.zsh', '.fish',
  '.ts', '.js', '.py', '.rb', '.go', '.rs', '.java', '.c', '.cpp', '.h',
  '.html', '.css', '.xml', '.svg',
  '.env.example', // Only example env files, not actual .env
  '.gitignore', '.dockerignore', '.editorconfig',
  '.service', '.timer', // systemd
  '',  // Allow files without extension (like Dockerfile, Makefile)
]);

/**
 * Check if file extension is safe to read
 */
export function isSafeExtension(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  const basename = path.basename(filePath).toLowerCase();

  // Allow specific files without extensions
  if (ext === '' && ['dockerfile', 'makefile', 'readme', 'license', 'changelog'].includes(basename)) {
    return true;
  }

  return SAFE_TEXT_EXTENSIONS.has(ext);
}

/**
 * Tool: read_file
 * Read a file from allowed directories
 */
export const readFileTool: ToolDefinition = {
  spec: {
    name: 'read_file',
    description: 'Read a text file from allowed directories (ansible configs, docker-compose files, etc.). Only text files are supported. Sensitive data like passwords and tokens are automatically redacted. Supports line ranges and pattern searching for investigating large files.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Absolute path to the file',
        },
        max_lines: {
          type: 'number',
          description: 'Maximum number of lines to read (default: 200, max: 500)',
        },
        start_line: {
          type: 'number',
          description: 'Start reading from this line number (1-indexed). Useful for reading specific sections of large files.',
        },
        end_line: {
          type: 'number',
          description: 'Stop reading at this line number (inclusive). Used with start_line for reading specific ranges.',
        },
        search_pattern: {
          type: 'string',
          description: 'Only return lines containing this text pattern (case-insensitive). Lines are returned with their original line numbers.',
        },
      },
      required: ['path'],
    },
  },
  async execute(input: Record<string, unknown>, config: ToolConfig): Promise<string> {
    try {
      const filePath = input.path as string;
      let maxLines = input.max_lines as number | undefined;
      const startLine = input.start_line as number | undefined;
      const endLine = input.end_line as number | undefined;
      const searchPattern = input.search_pattern as string | undefined;

      if (!filePath) {
        return 'Error: path is required';
      }

      // Validate path is within allowed directories (logical path)
      if (!isPathAllowed(filePath, config.allowedDirs)) {
        return `Error: Access denied. File must be in one of the allowed directories:\n${config.allowedDirs.join('\n')}`;
      }

      // SECURITY: Validate symlink target is also within allowed directories
      const realPathResult = await validateRealPath(filePath, config.allowedDirs);
      if (!realPathResult.valid) {
        return `Error: ${realPathResult.error ?? 'Invalid path'}`;
      }
      const actualPath = realPathResult.realPath ?? filePath;

      // Check file extension for safety (on actual path)
      if (!isSafeExtension(actualPath)) {
        return `Error: Cannot read binary or unsupported file type. Only text files are supported.`;
      }

      // Check file exists and is a file (not directory)
      try {
        const stats = await fs.stat(actualPath);
        if (!stats.isFile()) {
          return `Error: Path is not a file: ${filePath}`;
        }

        // Check file size
        const fileSizeKb = stats.size / 1024;
        if (fileSizeKb > config.maxFileSizeKb) {
          return `Error: File too large (${fileSizeKb.toFixed(1)}KB). Maximum allowed: ${String(config.maxFileSizeKb)}KB`;
        }
      } catch {
        return `Error: File not found: ${filePath}`;
      }

      // Read file as buffer first to detect binary content
      const buffer = await fs.readFile(actualPath);

      // SECURITY: Detect binary content (null bytes indicate binary data)
      if (buffer.includes(0)) {
        return 'Error: File contains binary data and cannot be read as text.';
      }

      const content = buffer.toString('utf-8');
      const allLines = content.split('\n');

      // Handle search_pattern mode: return matching lines with line numbers
      if (searchPattern) {
        const pattern = searchPattern.toLowerCase();
        const matchingLines: string[] = [];
        for (let i = 0; i < allLines.length; i++) {
          const line = allLines[i] ?? '';
          if (line.toLowerCase().includes(pattern)) {
            matchingLines.push(`${String(i + 1)}: ${line}`);
          }
        }

        if (matchingLines.length === 0) {
          return `No matches found for "${searchPattern}" in ${filePath} (${String(allLines.length)} lines).`;
        }

        maxLines = Math.min(maxLines ?? 200, 500);
        const truncated = matchingLines.length > maxLines;
        const output = matchingLines.slice(0, maxLines).join('\n');
        const scrubbed = scrubSensitiveData(output);
        const header = `Found ${String(matchingLines.length)} matches for "${searchPattern}" in ${filePath}:`;
        const footer = truncated
          ? `\n\n... [showing ${String(maxLines)} of ${String(matchingLines.length)} matches]`
          : '';
        return `${header}\n\n${scrubbed}${footer}`;
      }

      // Handle line range mode
      if (startLine !== undefined || endLine !== undefined) {
        const start = Math.max((startLine ?? 1) - 1, 0); // Convert to 0-indexed
        const end = endLine !== undefined ? Math.min(endLine, allLines.length) : allLines.length;
        const rangeLines = allLines.slice(start, end);

        maxLines = Math.min(maxLines ?? 500, 500);
        const truncated = rangeLines.length > maxLines;
        const output = rangeLines.slice(0, maxLines).map((line, i) => `${String(start + i + 1)}: ${line}`).join('\n');
        const scrubbed = scrubSensitiveData(output);

        const header = `Lines ${String(start + 1)}-${String(Math.min(end, start + maxLines))} of ${String(allLines.length)} in ${filePath}:`;
        const footer = truncated
          ? `\n\n... [showing ${String(maxLines)} of ${String(rangeLines.length)} lines in range]`
          : '';
        return `${header}\n\n${scrubbed}${footer}`;
      }

      // Default mode: read from beginning with max_lines cap
      maxLines = Math.min(maxLines ?? 200, 500);
      const truncated = allLines.length > maxLines;
      const limitedContent = allLines.slice(0, maxLines).join('\n');

      // Scrub sensitive data
      const scrubbed = scrubSensitiveData(limitedContent);

      if (truncated) {
        return `${scrubbed}\n\n... [truncated, showing ${String(maxLines)} of ${String(allLines.length)} lines]`;
      }

      return scrubbed;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return `Error reading file: ${message}`;
    }
  },
};

/**
 * All file tools
 */
export const fileTools: ToolDefinition[] = [
  readFileTool,
];

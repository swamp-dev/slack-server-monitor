import fs from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger.js';

/**
 * Follow symlinks and return the real path
 */
async function followSymlinks(filePath: string): Promise<string | null> {
  try {
    return await fs.realpath(filePath);
  } catch {
    return null; // Path doesn't exist
  }
}

/**
 * Loaded context from context directory
 */
export interface LoadedContext {
  /** Content from CLAUDE.md */
  claudeMd?: string;
  /** Content from .claude/context/ files (filename -> content) */
  contextFiles: Map<string, string>;
  /** Combined context as a single string for system prompt */
  combined: string;
}

/**
 * Unsafe path prefixes that should not be used as context directories
 */
const UNSAFE_PATH_PREFIXES = [
  '/etc',
  '/var',
  '/usr',
  '/bin',
  '/sbin',
  '/lib',
  '/sys',
  '/proc',
  '/dev',
];

/**
 * Validate that a context directory path is safe
 */
async function validateContextDir(contextDir: string): Promise<string> {
  // Reject paths containing parent directory references
  if (contextDir.includes('..')) {
    throw new Error('Context directory path cannot contain ".." (parent directory references)');
  }

  // Resolve to absolute path
  const resolved = path.resolve(contextDir);

  // Follow symlinks to get the real path
  const realPath = await followSymlinks(resolved);
  const pathToCheck = realPath ?? resolved;

  // Check against unsafe prefixes
  for (const prefix of UNSAFE_PATH_PREFIXES) {
    if (pathToCheck === prefix || pathToCheck.startsWith(`${prefix}/`)) {
      throw new Error(`Context directory cannot be under system path: ${prefix}`);
    }
  }

  return pathToCheck;
}

/**
 * Load context files from a context directory
 *
 * Reads:
 * - CLAUDE.md from the root
 * - All files in .claude/context/ directory
 *
 * @param contextDir - Path to the context directory
 * @returns LoadedContext with all found context
 */
export async function loadContextFromDirectory(contextDir: string): Promise<LoadedContext> {
  const contextFiles = new Map<string, string>();
  let claudeMd: string | undefined;

  // Validate and resolve to absolute path (follows symlinks)
  const resolvedDir = await validateContextDir(contextDir);

  // Try to load CLAUDE.md
  try {
    const claudeMdPath = path.join(resolvedDir, 'CLAUDE.md');
    claudeMd = await fs.readFile(claudeMdPath, 'utf-8');
    logger.debug('Loaded CLAUDE.md from context directory', { path: claudeMdPath });
  } catch {
    // CLAUDE.md doesn't exist, that's fine
    logger.debug('No CLAUDE.md found in context directory', { contextDir: resolvedDir });
  }

  // Try to load .claude/context/ files
  const contextDirPath = path.join(resolvedDir, '.claude', 'context');
  try {
    const entries = await fs.readdir(contextDirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile()) continue;

      // Only read text files
      const ext = path.extname(entry.name).toLowerCase();
      if (!['.md', '.txt', '.yaml', '.yml', '.json', ''].includes(ext)) {
        continue;
      }

      try {
        const filePath = path.join(contextDirPath, entry.name);
        const content = await fs.readFile(filePath, 'utf-8');
        contextFiles.set(entry.name, content);
        logger.debug('Loaded context file', { file: entry.name });
      } catch (err) {
        logger.warn('Failed to read context file', {
          file: entry.name,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }
  } catch {
    // .claude/context/ doesn't exist, that's fine
    logger.debug('No .claude/context directory found', { contextDir: resolvedDir });
  }

  // Build combined context
  const combined = buildCombinedContext(claudeMd, contextFiles, resolvedDir);

  return { claudeMd, contextFiles, combined };
}

/**
 * Build a combined context string for the system prompt
 */
function buildCombinedContext(
  claudeMd: string | undefined,
  contextFiles: Map<string, string>,
  contextDir: string
): string {
  const parts: string[] = [];

  parts.push(`## Infrastructure Context\n\nContext loaded from: \`${contextDir}\``);

  if (claudeMd) {
    parts.push(`### From CLAUDE.md\n\n${claudeMd}`);
  }

  if (contextFiles.size > 0) {
    parts.push('### Additional Context Files');
    for (const [filename, content] of contextFiles) {
      parts.push(`#### ${filename}\n\n${content}`);
    }
  }

  if (!claudeMd && contextFiles.size === 0) {
    return ''; // No context found
  }

  return parts.join('\n\n');
}

/**
 * Cache for loaded context (loaded once at startup)
 */
let cachedContext: LoadedContext | null = null;

/**
 * Get or load context from directory (cached)
 */
export async function getContext(contextDir: string | undefined): Promise<LoadedContext | null> {
  if (!contextDir) {
    return null;
  }

  cachedContext ??= await loadContextFromDirectory(contextDir);
  return cachedContext;
}

/**
 * Clear the context cache (for testing or reloading)
 */
export function clearContextCache(): void {
  cachedContext = null;
}

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { z } from 'zod';
import { logger } from '../utils/logger.js';
import type { ToolConfig } from './tools/types.js';

/**
 * Schema for user's server-config.json
 */
const UserConfigFileSchema = z.object({
  allowedDirs: z.array(z.string()).optional(),
  disabledTools: z.array(z.string()).optional(),
  maxLogLines: z.number().int().positive().max(100).optional(),
}).strict();

/**
 * User configuration
 */
export interface UserConfig {
  systemPromptAddition?: string;
  contextDirContent?: string;
  disabledTools: string[];
  toolConfig: ToolConfig;
}

/**
 * Default tool config from app config
 */
export interface DefaultToolConfig {
  allowedDirs: string[];
  maxFileSizeKb: number;
  maxLogLines: number;
  contextDir?: string;
  contextDirContent?: string;
}

/**
 * Load user-specific configuration from ~/.claude/
 *
 * Files:
 * - ~/.claude/server-prompt.md - Custom system prompt additions
 * - ~/.claude/server-config.json - Tool restrictions, allowed dirs override
 */
export async function loadUserConfig(
  userId: string,
  defaults: DefaultToolConfig
): Promise<UserConfig> {
  const homeDir = os.homedir();
  const claudeDir = path.join(homeDir, '.claude');

  let systemPromptAddition: string | undefined;
  let userFileConfig: z.infer<typeof UserConfigFileSchema> | undefined;

  // Try to load custom system prompt
  try {
    const promptPath = path.join(claudeDir, 'server-prompt.md');
    systemPromptAddition = await fs.readFile(promptPath, 'utf-8');
    logger.debug('Loaded user system prompt', { userId, path: promptPath });
  } catch {
    // File doesn't exist, use default
  }

  // Try to load user config JSON
  try {
    const configPath = path.join(claudeDir, 'server-config.json');
    const configContent = await fs.readFile(configPath, 'utf-8');
    const parsed = JSON.parse(configContent) as unknown;
    userFileConfig = UserConfigFileSchema.parse(parsed);
    logger.debug('Loaded user config', { userId, path: configPath, config: userFileConfig });
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn('Invalid user config file', { userId, errors: error.errors });
    }
    // File doesn't exist or invalid, use defaults
  }

  // Build allowed directories list
  // Start with user override or defaults, then add context directory
  let allowedDirs = userFileConfig?.allowedDirs ?? defaults.allowedDirs;

  // Automatically add context directory to allowed dirs if configured
  if (defaults.contextDir) {
    const resolvedContextDir = path.resolve(defaults.contextDir);
    if (!allowedDirs.includes(resolvedContextDir)) {
      allowedDirs = [...allowedDirs, resolvedContextDir];
      logger.debug('Added context directory to allowed dirs', { contextDir: resolvedContextDir });
    }
  }

  // Merge user config with defaults
  return {
    systemPromptAddition,
    contextDirContent: defaults.contextDirContent,
    disabledTools: userFileConfig?.disabledTools ?? [],
    toolConfig: {
      allowedDirs,
      maxFileSizeKb: defaults.maxFileSizeKb,
      maxLogLines: userFileConfig?.maxLogLines ?? defaults.maxLogLines,
    },
  };
}

import { z } from 'zod';

/**
 * Environment configuration schema
 */
const ConfigSchema = z.object({
  /**
   * Comma-separated list of directories allowed for file reading
   * Required for read_file tool to work
   */
  allowedDirs: z.string().transform((val) => {
    if (!val) return [];
    return val.split(',').map((dir) => dir.trim()).filter(Boolean);
  }),

  /**
   * Maximum number of log lines to return
   * Default: 50, passed to get_container_logs
   */
  maxLogLines: z.coerce.number().positive().default(50),

  /**
   * Maximum file size in KB to read
   * Default: 100KB
   */
  maxFileSizeKb: z.coerce.number().positive().default(100),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Load and validate configuration from environment variables
 */
export function loadConfig(): Config {
  const result = ConfigSchema.safeParse({
    allowedDirs: process.env.MCP_ALLOWED_DIRS ?? '',
    maxLogLines: process.env.MCP_MAX_LOG_LINES ?? 50,
    maxFileSizeKb: process.env.MCP_MAX_FILE_SIZE_KB ?? 100,
  });

  if (!result.success) {
    console.error('Configuration error:', result.error.format());
    throw new Error('Invalid configuration');
  }

  return result.data;
}

/**
 * Get tool configuration from loaded config
 */
export function getToolConfig(config: Config) {
  return {
    allowedDirs: config.allowedDirs,
    maxFileSizeKb: config.maxFileSizeKb,
    maxLogLines: config.maxLogLines,
  };
}

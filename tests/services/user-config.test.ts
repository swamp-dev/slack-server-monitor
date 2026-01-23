import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadUserConfig, type DefaultToolConfig } from '../../src/services/user-config.js';

// Mock fs/promises
vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn(),
  },
}));

// Mock os
vi.mock('os', () => ({
  default: {
    homedir: vi.fn().mockReturnValue('/home/testuser'),
  },
}));

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('user-config', () => {
  let mockReadFile: ReturnType<typeof vi.fn>;

  const defaultToolConfig: DefaultToolConfig = {
    allowedDirs: ['/opt/default'],
    maxFileSizeKb: 100,
    maxLogLines: 50,
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const fs = (await import('fs/promises')).default;
    mockReadFile = fs.readFile as ReturnType<typeof vi.fn>;
  });

  describe('loadUserConfig', () => {
    it('should return defaults when no user files exist', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT: no such file'));

      const result = await loadUserConfig('U12345', defaultToolConfig);

      expect(result.systemPromptAddition).toBeUndefined();
      expect(result.disabledTools).toEqual([]);
      expect(result.toolConfig.allowedDirs).toEqual(['/opt/default']);
      expect(result.toolConfig.maxFileSizeKb).toBe(100);
      expect(result.toolConfig.maxLogLines).toBe(50);
    });

    it('should load custom system prompt', async () => {
      mockReadFile.mockImplementation((path: string) => {
        if (path.includes('server-prompt.md')) {
          return Promise.resolve('# Custom Prompt\nMy server context');
        }
        return Promise.reject(new Error('ENOENT'));
      });

      const result = await loadUserConfig('U12345', defaultToolConfig);

      expect(result.systemPromptAddition).toBe('# Custom Prompt\nMy server context');
    });

    it('should load and parse user config JSON', async () => {
      mockReadFile.mockImplementation((path: string) => {
        if (path.includes('server-config.json')) {
          return Promise.resolve(
            JSON.stringify({
              allowedDirs: ['/custom/path'],
              disabledTools: ['read_file'],
              maxLogLines: 25,
            })
          );
        }
        return Promise.reject(new Error('ENOENT'));
      });

      const result = await loadUserConfig('U12345', defaultToolConfig);

      expect(result.toolConfig.allowedDirs).toEqual(['/custom/path']);
      expect(result.disabledTools).toEqual(['read_file']);
      expect(result.toolConfig.maxLogLines).toBe(25);
    });

    it('should merge user config with defaults', async () => {
      mockReadFile.mockImplementation((path: string) => {
        if (path.includes('server-config.json')) {
          return Promise.resolve(
            JSON.stringify({
              maxLogLines: 30,
            })
          );
        }
        return Promise.reject(new Error('ENOENT'));
      });

      const result = await loadUserConfig('U12345', defaultToolConfig);

      // maxLogLines should be overridden
      expect(result.toolConfig.maxLogLines).toBe(30);
      // allowedDirs should use defaults since not specified in user config
      expect(result.toolConfig.allowedDirs).toEqual(['/opt/default']);
      // maxFileSizeKb should use defaults (user config doesn't support this field)
      expect(result.toolConfig.maxFileSizeKb).toBe(100);
    });

    it('should add context directory to allowed dirs', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));

      const configWithContextDir: DefaultToolConfig = {
        ...defaultToolConfig,
        contextDir: '/opt/infrastructure',
      };

      const result = await loadUserConfig('U12345', configWithContextDir);

      expect(result.toolConfig.allowedDirs).toContain('/opt/infrastructure');
    });

    it('should not duplicate context directory in allowed dirs', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));

      const configWithContextDir: DefaultToolConfig = {
        allowedDirs: ['/opt/infrastructure'], // Already includes context dir
        maxFileSizeKb: 100,
        maxLogLines: 50,
        contextDir: '/opt/infrastructure',
      };

      const result = await loadUserConfig('U12345', configWithContextDir);

      const count = result.toolConfig.allowedDirs.filter(
        (d) => d === '/opt/infrastructure'
      ).length;
      expect(count).toBe(1);
    });

    it('should include context dir content from defaults', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));

      const configWithContent: DefaultToolConfig = {
        ...defaultToolConfig,
        contextDirContent: '# Infrastructure Overview\n...',
      };

      const result = await loadUserConfig('U12345', configWithContent);

      expect(result.contextDirContent).toBe('# Infrastructure Overview\n...');
    });

    it('should handle invalid config file gracefully and log warning', async () => {
      const loggerModule = await import('../../src/utils/logger.js');

      mockReadFile.mockImplementation((path: string) => {
        if (path.includes('server-config.json')) {
          return Promise.resolve(
            JSON.stringify({
              allowedDirs: 'not-an-array', // Invalid type
              unknownField: 'value', // Not allowed by strict()
            })
          );
        }
        return Promise.reject(new Error('ENOENT'));
      });

      const result = await loadUserConfig('U12345', defaultToolConfig);

      // Should fall back to defaults
      expect(result.toolConfig.allowedDirs).toEqual(['/opt/default']);
      expect(loggerModule.logger.warn).toHaveBeenCalled();
    });

    it('should enforce maxLogLines maximum of 100', async () => {
      mockReadFile.mockImplementation((path: string) => {
        if (path.includes('server-config.json')) {
          return Promise.resolve(
            JSON.stringify({
              maxLogLines: 500, // Exceeds max of 100
            })
          );
        }
        return Promise.reject(new Error('ENOENT'));
      });

      const result = await loadUserConfig('U12345', defaultToolConfig);

      // Should fall back to defaults due to validation failure
      expect(result.toolConfig.maxLogLines).toBe(50);
    });

    it('should load both prompt and config files', async () => {
      mockReadFile.mockImplementation((path: string) => {
        if (path.includes('server-prompt.md')) {
          return Promise.resolve('Custom prompt');
        }
        if (path.includes('server-config.json')) {
          return Promise.resolve(
            JSON.stringify({
              disabledTools: ['get_disk_usage'],
            })
          );
        }
        return Promise.reject(new Error('ENOENT'));
      });

      const result = await loadUserConfig('U12345', defaultToolConfig);

      expect(result.systemPromptAddition).toBe('Custom prompt');
      expect(result.disabledTools).toEqual(['get_disk_usage']);
    });

    it('should look for config in correct home directory path', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));

      await loadUserConfig('U12345', defaultToolConfig);

      // Verify readFile was called with correct paths
      expect(mockReadFile).toHaveBeenCalledWith(
        '/home/testuser/.claude/server-prompt.md',
        'utf-8'
      );
      expect(mockReadFile).toHaveBeenCalledWith(
        '/home/testuser/.claude/server-config.json',
        'utf-8'
      );
    });
  });
});

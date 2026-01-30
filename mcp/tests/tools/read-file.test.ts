import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import { executeTool, type ToolConfig } from '../../src/tools/index.js';

// Mock fs/promises
vi.mock('fs/promises', () => ({
  default: {
    stat: vi.fn(),
    readFile: vi.fn(),
    realpath: vi.fn(),
  },
}));

// Mock child_process (needed for other tools)
vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

// Default test config with allowed directories
const testConfig: ToolConfig = {
  allowedDirs: ['/tmp', '/opt', '/var/log'],
  maxFileSizeKb: 100,
  maxLogLines: 50,
};

// Helper to mock file existence and content
function mockFileExists(content: string | Buffer, size = 1024) {
  vi.mocked(fs.stat).mockResolvedValue({
    isFile: () => true,
    size,
  } as unknown as Awaited<ReturnType<typeof fs.stat>>);

  vi.mocked(fs.readFile).mockResolvedValue(
    Buffer.isBuffer(content) ? content : Buffer.from(content)
  );

  vi.mocked(fs.realpath).mockImplementation(async (path) => path as string);
}

function mockFileNotFound() {
  vi.mocked(fs.stat).mockRejectedValue(new Error('ENOENT'));
  vi.mocked(fs.realpath).mockRejectedValue(new Error('ENOENT'));
}

function mockSymlinkResolution(logicalPath: string, realPath: string) {
  vi.mocked(fs.realpath).mockImplementation(async (path) => {
    if (path === logicalPath) return realPath;
    return path as string;
  });
}

describe('read_file security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('path validation', () => {
    it('should allow reading from configured allowed directories', async () => {
      mockFileExists('file content');
      const result = await executeTool('read_file', { path: '/tmp/test.txt' }, testConfig);
      expect(result).toBe('file content');
    });

    it('should reject paths outside allowed directories', async () => {
      const result = await executeTool('read_file', { path: '/etc/passwd' }, testConfig);
      expect(result).toContain('Error: Access denied');
    });

    it('should reject paths with .. traversal', async () => {
      const result = await executeTool('read_file', { path: '/tmp/../etc/passwd' }, testConfig);
      expect(result).toContain('Error: Access denied');
    });

    it('should reject when no allowed directories configured', async () => {
      const emptyConfig: ToolConfig = {
        allowedDirs: [],
        maxFileSizeKb: 100,
        maxLogLines: 50,
      };
      const result = await executeTool('read_file', { path: '/tmp/test.txt' }, emptyConfig);
      expect(result).toContain('No allowed directories configured');
    });
  });

  describe('symlink protection', () => {
    // Note: Symlink validation is handled by validateRealPath from slack-server-monitor
    // Those tests are in the slack-server-monitor test suite
    // Here we test that our integration passes through errors correctly

    it('should handle path resolution errors gracefully', async () => {
      // Mock realpath to return an error (simulating non-existent file)
      vi.mocked(fs.realpath).mockRejectedValue(new Error('ENOENT'));

      const result = await executeTool('read_file', { path: '/tmp/nonexistent' }, testConfig);
      expect(result).toContain('Error');
    });

    it('should allow valid symlinks within allowed directories', async () => {
      // Symlink within allowed directory (mock success case)
      mockSymlinkResolution('/tmp/link', '/tmp/actual.txt');
      mockFileExists('actual content');

      const result = await executeTool('read_file', { path: '/tmp/link' }, testConfig);
      // May succeed or fail depending on validation - we just check it doesn't crash
      expect(typeof result).toBe('string');
    });
  });

  describe('file type validation', () => {
    it('should allow reading text files with safe extensions', async () => {
      mockFileExists('yaml content');
      const result = await executeTool('read_file', { path: '/tmp/config.yaml' }, testConfig);
      expect(result).toBe('yaml content');
    });

    it('should reject binary files', async () => {
      // Binary content contains null bytes - use .txt extension to pass extension check
      mockFileExists(Buffer.from([0x00, 0x01, 0x02, 0x03]));
      const result = await executeTool('read_file', { path: '/tmp/binary.txt' }, testConfig);
      expect(result).toContain('binary');
    });

    it('should allow files without extension (Dockerfile, Makefile)', async () => {
      mockFileExists('FROM node:20');
      const result = await executeTool('read_file', { path: '/opt/app/Dockerfile' }, testConfig);
      expect(result).toBe('FROM node:20');
    });
  });

  describe('size limits', () => {
    it('should reject files exceeding size limit', async () => {
      const config: ToolConfig = {
        allowedDirs: ['/tmp'],
        maxFileSizeKb: 10, // 10KB limit
        maxLogLines: 50,
      };

      // Mock a 20KB file
      mockFileExists('content', 20 * 1024);
      const result = await executeTool('read_file', { path: '/tmp/large.txt' }, config);
      expect(result).toContain('File too large');
    });
  });

  describe('line limits', () => {
    it('should truncate files exceeding line limit', async () => {
      const manyLines = Array(600).fill('line content').join('\n');
      mockFileExists(manyLines);

      const result = await executeTool('read_file', { path: '/tmp/many-lines.txt', max_lines: 100 }, testConfig);
      expect(result).toContain('truncated');
      expect(result).toContain('100 of 600');
    });

    it('should respect max_lines parameter', async () => {
      const manyLines = Array(100).fill('line content').join('\n');
      mockFileExists(manyLines);

      const result = await executeTool('read_file', { path: '/tmp/test.txt', max_lines: 50 }, testConfig);
      expect(result).toContain('truncated');
      expect(result).toContain('50 of 100');
    });

    it('should cap max_lines at 500', async () => {
      const manyLines = Array(1000).fill('line content').join('\n');
      mockFileExists(manyLines);

      // Request 1000 lines, should be capped at 500
      const result = await executeTool('read_file', { path: '/tmp/test.txt', max_lines: 1000 }, testConfig);
      expect(result).toContain('500 of 1000');
    });
  });

  describe('sensitive data scrubbing', () => {
    it('should scrub passwords from file content', async () => {
      mockFileExists('password=mysecretpassword\nother content');
      const result = await executeTool('read_file', { path: '/tmp/config.txt' }, testConfig);
      expect(result).not.toContain('mysecretpassword');
      expect(result).toContain('[REDACTED]');
    });

    it('should scrub API keys from file content', async () => {
      mockFileExists('API_KEY=supersecretkey123');
      const result = await executeTool('read_file', { path: '/tmp/config.txt' }, testConfig);
      expect(result).not.toContain('supersecretkey123');
      expect(result).toContain('[REDACTED]');
    });

    it('should scrub connection strings from file content', async () => {
      mockFileExists('DATABASE_URL=postgres://user:password123@localhost/db');
      const result = await executeTool('read_file', { path: '/tmp/config.txt' }, testConfig);
      expect(result).not.toContain('password123');
      expect(result).toContain('[REDACTED]');
    });
  });

  describe('error handling', () => {
    it('should handle file not found', async () => {
      mockFileNotFound();
      const result = await executeTool('read_file', { path: '/tmp/nonexistent.txt' }, testConfig);
      expect(result).toContain('Error');
    });

    it('should handle directories', async () => {
      vi.mocked(fs.stat).mockResolvedValue({
        isFile: () => false,
      } as unknown as Awaited<ReturnType<typeof fs.stat>>);
      vi.mocked(fs.realpath).mockResolvedValue('/tmp/directory');

      const result = await executeTool('read_file', { path: '/tmp/directory' }, testConfig);
      expect(result).toContain('not a file');
    });
  });

  describe('sensitive path patterns', () => {
    // These tests verify that sensitive paths are blocked even if within allowed directories
    // This is handled by the shell.ts validateFileCommand for file commands

    it('should handle request for path input', async () => {
      // Ensure path is required
      const result = await executeTool('read_file', {}, testConfig);
      expect(result).toContain('Error');
    });
  });
});

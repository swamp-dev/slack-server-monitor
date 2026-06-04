import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { loadContextFromDirectory, getContext, clearContextCache, validateContextDirectories } from '../../src/services/context-loader.js';

describe('context-loader', () => {
  let testDir: string;

  beforeEach(async () => {
    // Create a temp directory for tests
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'context-loader-test-'));
  });

  afterEach(async () => {
    // Clean up temp directory
    await fs.rm(testDir, { recursive: true, force: true });
    clearContextCache();
  });

  describe('loadContextFromDirectory', () => {
    it('should load CLAUDE.md from root', async () => {
      const content = '# Test Context\n\nThis is test content.';
      await fs.writeFile(path.join(testDir, 'CLAUDE.md'), content);

      const result = await loadContextFromDirectory(testDir);

      expect(result.claudeMd).toBe(content);
      expect(result.combined).toContain(content);
    });

    it('should load files from .claude/context/', async () => {
      const contextPath = path.join(testDir, '.claude', 'context');
      await fs.mkdir(contextPath, { recursive: true });
      await fs.writeFile(path.join(contextPath, 'services.md'), '# Services\n- nginx\n- postgres');
      await fs.writeFile(path.join(contextPath, 'networking.txt'), 'Network config info');

      const result = await loadContextFromDirectory(testDir);

      expect(result.contextFiles.size).toBe(2);
      expect(result.contextFiles.get('services.md')).toContain('nginx');
      expect(result.contextFiles.get('networking.txt')).toContain('Network');
    });

    it('should handle missing CLAUDE.md gracefully', async () => {
      const result = await loadContextFromDirectory(testDir);

      expect(result.claudeMd).toBeUndefined();
      expect(result.contextFiles.size).toBe(0);
      expect(result.combined).toBe('');
    });

    it('should handle missing .claude/context directory gracefully', async () => {
      await fs.writeFile(path.join(testDir, 'CLAUDE.md'), '# Test');

      const result = await loadContextFromDirectory(testDir);

      expect(result.claudeMd).toBe('# Test');
      expect(result.contextFiles.size).toBe(0);
    });

    it('should filter out non-text files from context directory', async () => {
      const contextPath = path.join(testDir, '.claude', 'context');
      await fs.mkdir(contextPath, { recursive: true });
      await fs.writeFile(path.join(contextPath, 'valid.md'), 'Valid');
      await fs.writeFile(path.join(contextPath, 'image.png'), 'fake image data');
      await fs.writeFile(path.join(contextPath, 'script.sh'), 'echo test');

      const result = await loadContextFromDirectory(testDir);

      expect(result.contextFiles.size).toBe(1);
      expect(result.contextFiles.has('valid.md')).toBe(true);
      expect(result.contextFiles.has('image.png')).toBe(false);
      expect(result.contextFiles.has('script.sh')).toBe(false);
    });

    it('should reject paths with ".." components', async () => {
      await expect(loadContextFromDirectory('/tmp/../etc')).rejects.toThrow(
        'cannot contain ".."'
      );
    });

    it('should reject system directories', async () => {
      await expect(loadContextFromDirectory('/etc')).rejects.toThrow(
        'cannot be under system path'
      );
      await expect(loadContextFromDirectory('/etc/passwd')).rejects.toThrow(
        'cannot be under system path'
      );
      await expect(loadContextFromDirectory('/var/log')).rejects.toThrow(
        'cannot be under system path'
      );
    });

    it('should reject /root directory', async () => {
      await expect(loadContextFromDirectory('/root')).rejects.toThrow(
        'cannot be under system path'
      );
      await expect(loadContextFromDirectory('/root/.ssh')).rejects.toThrow(
        'cannot be under system path'
      );
      await expect(loadContextFromDirectory('/root/some/path')).rejects.toThrow(
        'cannot be under system path'
      );
    });

    // Note: /home is explicitly allowed for user context directories
    // The UNSAFE_PATH_PREFIXES in context-loader.ts no longer includes /home
    it('should allow /home directory for user context', async () => {
      // This should not throw - /home is allowed for context directories
      // It will return empty context since the directory doesn't exist in tests
      const result = await loadContextFromDirectory('/home/testuser/ansible');
      expect(result).toBeDefined();
    });

    it('should build combined context with sections', async () => {
      await fs.writeFile(path.join(testDir, 'CLAUDE.md'), '# Main Context');
      const contextPath = path.join(testDir, '.claude', 'context');
      await fs.mkdir(contextPath, { recursive: true });
      await fs.writeFile(path.join(contextPath, 'extra.md'), 'Extra info');

      const result = await loadContextFromDirectory(testDir);

      expect(result.combined).toContain('## Infrastructure Context');
      expect(result.combined).toContain('### From CLAUDE.md');
      expect(result.combined).toContain('# Main Context');
      expect(result.combined).toContain('### Additional Context Files');
      expect(result.combined).toContain('#### extra.md');
      expect(result.combined).toContain('Extra info');
    });
  });

  describe('getContext', () => {
    it('should return null when contextDir is undefined', async () => {
      const result = await getContext(undefined);
      expect(result).toBeNull();
    });

    it('should cache context on subsequent calls', async () => {
      await fs.writeFile(path.join(testDir, 'CLAUDE.md'), 'Original content');

      const result1 = await getContext(testDir);
      expect(result1?.claudeMd).toBe('Original content');

      // Modify the file
      await fs.writeFile(path.join(testDir, 'CLAUDE.md'), 'Modified content');

      // Should return cached version
      const result2 = await getContext(testDir);
      expect(result2?.claudeMd).toBe('Original content');
    });
  });

  describe('clearContextCache', () => {
    it('should clear the cache and reload on next call', async () => {
      await fs.writeFile(path.join(testDir, 'CLAUDE.md'), 'Original content');

      const result1 = await getContext(testDir);
      expect(result1?.claudeMd).toBe('Original content');

      // Modify the file
      await fs.writeFile(path.join(testDir, 'CLAUDE.md'), 'Modified content');

      // Clear cache
      clearContextCache();

      // Should reload from disk
      const result2 = await getContext(testDir);
      expect(result2?.claudeMd).toBe('Modified content');
    });
  });

  describe('validateContextDirectories', () => {
    it('returns empty array for a valid directory with .md files', async () => {
      await fs.writeFile(path.join(testDir, 'CLAUDE.md'), '# Context');
      const errors = await validateContextDirectories([{ alias: 'test', path: testDir }]);
      expect(errors).toHaveLength(0);
    });

    it('returns error for a nonexistent directory, including the alias and path', async () => {
      const missingPath = path.join(testDir, 'does-not-exist');
      const errors = await validateContextDirectories([{ alias: 'missing', path: missingPath }]);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('missing');
      expect(errors[0]).toContain(missingPath);
    });

    it('returns error for a directory with no .md files, including the alias', async () => {
      // testDir exists but has no CLAUDE.md and no .claude/context/ .md files
      const errors = await validateContextDirectories([{ alias: 'empty', path: testDir }]);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('empty');
    });

    it('returns errors only for bad paths when mixed with valid ones', async () => {
      await fs.writeFile(path.join(testDir, 'CLAUDE.md'), '# Valid');
      const missingPath = path.join(testDir, 'nonexistent');
      const errors = await validateContextDirectories([
        { alias: 'good', path: testDir },
        { alias: 'bad', path: missingPath },
      ]);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain(missingPath);
    });
  });
});

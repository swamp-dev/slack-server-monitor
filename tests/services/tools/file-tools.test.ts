import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { isPathAllowed, validateRealPath, isSafeExtension, readFileTool } from '../../../src/services/tools/file-tools.js';
import type { ToolConfig } from '../../../src/services/tools/types.js';

describe('file-tools', () => {
  describe('isPathAllowed', () => {
    const allowedDirs = ['/home/user/ansible', '/opt/stacks', '/etc/docker'];

    describe('with valid paths', () => {
      it('should allow files directly in allowed directory', () => {
        expect(isPathAllowed('/home/user/ansible/inventory.yml', allowedDirs)).toBe(true);
        expect(isPathAllowed('/opt/stacks/docker-compose.yml', allowedDirs)).toBe(true);
        expect(isPathAllowed('/etc/docker/daemon.json', allowedDirs)).toBe(true);
      });

      it('should allow files in subdirectories of allowed directory', () => {
        expect(isPathAllowed('/home/user/ansible/group_vars/all.yml', allowedDirs)).toBe(true);
        expect(isPathAllowed('/opt/stacks/app/config/settings.json', allowedDirs)).toBe(true);
      });

      it('should allow the directory itself', () => {
        expect(isPathAllowed('/home/user/ansible', allowedDirs)).toBe(true);
        expect(isPathAllowed('/opt/stacks', allowedDirs)).toBe(true);
      });
    });

    describe('path traversal prevention', () => {
      it('should reject paths outside allowed directories', () => {
        expect(isPathAllowed('/etc/passwd', allowedDirs)).toBe(false);
        expect(isPathAllowed('/root/.ssh/id_rsa', allowedDirs)).toBe(false);
        expect(isPathAllowed('/var/log/auth.log', allowedDirs)).toBe(false);
      });

      it('should reject path traversal attempts', () => {
        expect(isPathAllowed('/home/user/ansible/../../../etc/passwd', allowedDirs)).toBe(false);
        expect(isPathAllowed('/opt/stacks/../../etc/shadow', allowedDirs)).toBe(false);
      });

      it('should reject prefix matches that are not actual subdirectories', () => {
        expect(isPathAllowed('/home/user/ansible-extra/file.yml', allowedDirs)).toBe(false);
        expect(isPathAllowed('/opt/stacks-old/file.yml', allowedDirs)).toBe(false);
      });
    });

    describe('edge cases', () => {
      it('should return false when allowedDirs is empty', () => {
        expect(isPathAllowed('/any/path/file.txt', [])).toBe(false);
      });

      it('should handle relative path components correctly', () => {
        expect(isPathAllowed('/home/user/ansible/./inventory.yml', allowedDirs)).toBe(true);
      });

      it('should handle paths with trailing slashes', () => {
        const dirsWithTrailing = ['/home/user/ansible/', '/opt/stacks/'];
        expect(isPathAllowed('/home/user/ansible/file.yml', dirsWithTrailing)).toBe(true);
      });
    });
  });

  describe('validateRealPath', () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'file-tools-test-'));
    });

    afterEach(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('should return valid for a real file within allowed dirs', async () => {
      const filePath = path.join(tmpDir, 'test.txt');
      await fs.writeFile(filePath, 'hello');

      const result = await validateRealPath(filePath, [tmpDir]);
      expect(result.valid).toBe(true);
      expect(result.realPath).toBe(filePath);
    });

    it('should reject symlinks pointing outside allowed dirs', async () => {
      // Create a file outside allowed dirs
      const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'outside-'));
      const outsideFile = path.join(outsideDir, 'secret.txt');
      await fs.writeFile(outsideFile, 'secret data');

      // Create symlink inside allowed dir pointing to outside file
      const symlinkPath = path.join(tmpDir, 'sneaky-link');
      await fs.symlink(outsideFile, symlinkPath);

      const result = await validateRealPath(symlinkPath, [tmpDir]);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Symlink target is outside allowed directories');

      await fs.rm(outsideDir, { recursive: true, force: true });
    });

    it('should return error for non-existent paths', async () => {
      const result = await validateRealPath('/nonexistent/path/file.txt', ['/nonexistent']);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Path does not exist');
    });

    it('should allow symlinks pointing within allowed dirs', async () => {
      const realFile = path.join(tmpDir, 'real.txt');
      await fs.writeFile(realFile, 'content');
      const symlinkPath = path.join(tmpDir, 'link.txt');
      await fs.symlink(realFile, symlinkPath);

      const result = await validateRealPath(symlinkPath, [tmpDir]);
      expect(result.valid).toBe(true);
      expect(result.realPath).toBe(realFile);
    });
  });

  describe('isSafeExtension', () => {
    it('should allow common text file extensions', () => {
      expect(isSafeExtension('/path/to/file.txt')).toBe(true);
      expect(isSafeExtension('/path/to/file.md')).toBe(true);
      expect(isSafeExtension('/path/to/file.json')).toBe(true);
      expect(isSafeExtension('/path/to/file.yaml')).toBe(true);
      expect(isSafeExtension('/path/to/file.yml')).toBe(true);
      expect(isSafeExtension('/path/to/file.toml')).toBe(true);
      expect(isSafeExtension('/path/to/file.ini')).toBe(true);
      expect(isSafeExtension('/path/to/file.conf')).toBe(true);
    });

    it('should allow shell script extensions', () => {
      expect(isSafeExtension('/path/to/file.sh')).toBe(true);
      expect(isSafeExtension('/path/to/file.bash')).toBe(true);
      expect(isSafeExtension('/path/to/file.zsh')).toBe(true);
    });

    it('should allow programming language extensions', () => {
      expect(isSafeExtension('/path/to/file.ts')).toBe(true);
      expect(isSafeExtension('/path/to/file.js')).toBe(true);
      expect(isSafeExtension('/path/to/file.py')).toBe(true);
      expect(isSafeExtension('/path/to/file.go')).toBe(true);
      expect(isSafeExtension('/path/to/file.rs')).toBe(true);
    });

    it('should allow web file extensions', () => {
      expect(isSafeExtension('/path/to/file.html')).toBe(true);
      expect(isSafeExtension('/path/to/file.css')).toBe(true);
      expect(isSafeExtension('/path/to/file.xml')).toBe(true);
      expect(isSafeExtension('/path/to/file.svg')).toBe(true);
    });

    it('should reject .env.example (extname returns .example)', () => {
      // path.extname('.env.example') returns '.example', not '.env.example'
      expect(isSafeExtension('/path/to/.env.example')).toBe(false);
    });

    it('should allow systemd unit files', () => {
      expect(isSafeExtension('/path/to/app.service')).toBe(true);
      expect(isSafeExtension('/path/to/backup.timer')).toBe(true);
    });

    it('should allow specific files without extensions', () => {
      expect(isSafeExtension('/path/to/Dockerfile')).toBe(true);
      expect(isSafeExtension('/path/to/Makefile')).toBe(true);
      expect(isSafeExtension('/path/to/README')).toBe(true);
      expect(isSafeExtension('/path/to/LICENSE')).toBe(true);
      expect(isSafeExtension('/path/to/CHANGELOG')).toBe(true);
    });

    it('should be case-insensitive for known extensionless files', () => {
      expect(isSafeExtension('/path/to/dockerfile')).toBe(true);
      expect(isSafeExtension('/path/to/makefile')).toBe(true);
    });

    it('should reject binary file extensions', () => {
      expect(isSafeExtension('/path/to/file.exe')).toBe(false);
      expect(isSafeExtension('/path/to/file.bin')).toBe(false);
      expect(isSafeExtension('/path/to/file.so')).toBe(false);
      expect(isSafeExtension('/path/to/image.png')).toBe(false);
      expect(isSafeExtension('/path/to/archive.tar.gz')).toBe(false);
    });

    it('should allow unknown extensionless files via empty extension in set', () => {
      // Files without extension have ext === '', which is in SAFE_TEXT_EXTENSIONS
      // Only the basename check restricts specific known names
      // Unknown extensionless files fall through to the set check and are allowed
      expect(isSafeExtension('/path/to/randomfile')).toBe(true);
    });

    it('should allow dotfiles like .gitignore', () => {
      expect(isSafeExtension('/path/to/.gitignore')).toBe(true);
      expect(isSafeExtension('/path/to/.dockerignore')).toBe(true);
      expect(isSafeExtension('/path/to/.editorconfig')).toBe(true);
    });
  });

  describe('readFileTool', () => {
    let tmpDir: string;
    const baseConfig: ToolConfig = {
      allowedDirs: [], // Set in beforeEach
      maxFileSizeKb: 100,
      maxLogLines: 50,
    };

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'read-file-test-'));
      baseConfig.allowedDirs = [tmpDir];
    });

    afterEach(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('should have correct tool spec', () => {
      expect(readFileTool.spec.name).toBe('read_file');
      expect(readFileTool.spec.input_schema.required).toContain('path');
    });

    it('should return error when path is missing', async () => {
      const result = await readFileTool.execute({}, baseConfig);
      expect(result).toBe('Error: path is required');
    });

    it('should return error for paths outside allowed directories', async () => {
      const result = await readFileTool.execute({ path: '/etc/passwd' }, baseConfig);
      expect(result).toContain('Error: Access denied');
      expect(result).toContain('allowed directories');
    });

    it('should read a simple text file', async () => {
      const filePath = path.join(tmpDir, 'test.txt');
      await fs.writeFile(filePath, 'Hello, world!\nLine two\nLine three');

      const result = await readFileTool.execute({ path: filePath }, baseConfig);
      expect(result).toContain('Hello, world!');
      expect(result).toContain('Line two');
      expect(result).toContain('Line three');
    });

    it('should reject binary files with null bytes', async () => {
      const filePath = path.join(tmpDir, 'binary.txt');
      const binaryContent = Buffer.from([0x48, 0x65, 0x6c, 0x00, 0x6f]); // "Hel\0o"
      await fs.writeFile(filePath, binaryContent);

      const result = await readFileTool.execute({ path: filePath }, baseConfig);
      expect(result).toBe('Error: File contains binary data and cannot be read as text.');
    });

    it('should reject unsupported file extensions', async () => {
      const filePath = path.join(tmpDir, 'image.png');
      await fs.writeFile(filePath, 'not really a png');

      const result = await readFileTool.execute({ path: filePath }, baseConfig);
      expect(result).toContain('Error: Cannot read binary or unsupported file type');
    });

    it('should reject files that are too large', async () => {
      const filePath = path.join(tmpDir, 'large.txt');
      // Create a file larger than maxFileSizeKb (100KB)
      const largeContent = 'x'.repeat(101 * 1024);
      await fs.writeFile(filePath, largeContent);

      const result = await readFileTool.execute({ path: filePath }, baseConfig);
      expect(result).toContain('Error: File too large');
      expect(result).toContain('Maximum allowed: 100KB');
    });

    it('should return error for directories', async () => {
      const dirPath = path.join(tmpDir, 'subdir');
      await fs.mkdir(dirPath);
      // Need to make it look like a text file to pass extension check
      // Actually, directories don't have extensions, so they'd fail extension check first
      // Let's test with a directory that has a .txt extension-like name...
      // Actually directories fail the isFile() check. Let me create the right scenario.
      // The extension check on a dir named "subdir" would fail since "subdir" isn't in the allowlist.
      // We need a dir that passes extension check - use a known extensionless name
      const namedDir = path.join(tmpDir, 'Makefile');
      await fs.mkdir(namedDir);

      const result = await readFileTool.execute({ path: namedDir }, baseConfig);
      expect(result).toContain('Error: Path is not a file');
    });

    it('should return error for non-existent files', async () => {
      const filePath = path.join(tmpDir, 'nonexistent.txt');

      const result = await readFileTool.execute({ path: filePath }, baseConfig);
      // validateRealPath returns "Path does not exist" for non-existent paths
      expect(result).toContain('Error');
    });

    describe('search_pattern mode', () => {
      it('should return matching lines with line numbers', async () => {
        const filePath = path.join(tmpDir, 'config.yml');
        await fs.writeFile(filePath, 'name: app\nport: 8080\nhost: localhost\nport: 3000');

        const result = await readFileTool.execute(
          { path: filePath, search_pattern: 'port' },
          baseConfig
        );
        expect(result).toContain('Found 2 matches');
        expect(result).toContain('2: port: 8080');
        expect(result).toContain('4: port: 3000');
      });

      it('should be case-insensitive', async () => {
        const filePath = path.join(tmpDir, 'test.txt');
        await fs.writeFile(filePath, 'Hello World\nhello world\nHELLO WORLD');

        const result = await readFileTool.execute(
          { path: filePath, search_pattern: 'hello' },
          baseConfig
        );
        expect(result).toContain('Found 3 matches');
      });

      it('should return no matches message when pattern not found', async () => {
        const filePath = path.join(tmpDir, 'test.txt');
        await fs.writeFile(filePath, 'nothing relevant here');

        const result = await readFileTool.execute(
          { path: filePath, search_pattern: 'missing' },
          baseConfig
        );
        expect(result).toContain('No matches found');
        expect(result).toContain('1 lines');
      });

      it('should truncate results when exceeding max_lines', async () => {
        const filePath = path.join(tmpDir, 'many-matches.txt');
        const lines = Array.from({ length: 300 }, (_, i) => `match line ${String(i)}`);
        await fs.writeFile(filePath, lines.join('\n'));

        const result = await readFileTool.execute(
          { path: filePath, search_pattern: 'match', max_lines: 10 },
          baseConfig
        );
        expect(result).toContain('Found 300 matches');
        expect(result).toContain('showing 10 of 300 matches');
      });
    });

    describe('line range mode', () => {
      it('should read specific line range', async () => {
        const filePath = path.join(tmpDir, 'lines.txt');
        const lines = Array.from({ length: 20 }, (_, i) => `Line ${String(i + 1)}`);
        await fs.writeFile(filePath, lines.join('\n'));

        const result = await readFileTool.execute(
          { path: filePath, start_line: 5, end_line: 10 },
          baseConfig
        );
        expect(result).toContain('Lines 5-10 of 20');
        expect(result).toContain('5: Line 5');
        expect(result).toContain('10: Line 10');
        expect(result).not.toContain('4: Line 4');
        expect(result).not.toContain('11: Line 11');
      });

      it('should handle start_line only (read to end)', async () => {
        const filePath = path.join(tmpDir, 'lines.txt');
        const lines = Array.from({ length: 5 }, (_, i) => `Line ${String(i + 1)}`);
        await fs.writeFile(filePath, lines.join('\n'));

        const result = await readFileTool.execute(
          { path: filePath, start_line: 3 },
          baseConfig
        );
        expect(result).toContain('3: Line 3');
        expect(result).toContain('5: Line 5');
      });

      it('should handle end_line only (read from beginning)', async () => {
        const filePath = path.join(tmpDir, 'lines.txt');
        const lines = Array.from({ length: 10 }, (_, i) => `Line ${String(i + 1)}`);
        await fs.writeFile(filePath, lines.join('\n'));

        const result = await readFileTool.execute(
          { path: filePath, end_line: 3 },
          baseConfig
        );
        expect(result).toContain('1: Line 1');
        expect(result).toContain('3: Line 3');
      });

      it('should truncate range results when exceeding max_lines', async () => {
        const filePath = path.join(tmpDir, 'lines.txt');
        const lines = Array.from({ length: 100 }, (_, i) => `Line ${String(i + 1)}`);
        await fs.writeFile(filePath, lines.join('\n'));

        const result = await readFileTool.execute(
          { path: filePath, start_line: 1, end_line: 100, max_lines: 5 },
          baseConfig
        );
        expect(result).toContain('showing 5 of 100 lines in range');
      });
    });

    describe('default mode', () => {
      it('should truncate files exceeding max_lines', async () => {
        const filePath = path.join(tmpDir, 'long.txt');
        const lines = Array.from({ length: 300 }, (_, i) => `Line ${String(i + 1)}`);
        await fs.writeFile(filePath, lines.join('\n'));

        const result = await readFileTool.execute({ path: filePath }, baseConfig);
        expect(result).toContain('truncated, showing 200 of 300 lines');
      });

      it('should respect custom max_lines', async () => {
        const filePath = path.join(tmpDir, 'long.txt');
        const lines = Array.from({ length: 50 }, (_, i) => `Line ${String(i + 1)}`);
        await fs.writeFile(filePath, lines.join('\n'));

        const result = await readFileTool.execute(
          { path: filePath, max_lines: 10 },
          baseConfig
        );
        expect(result).toContain('truncated, showing 10 of 50 lines');
      });

      it('should cap max_lines at 500', async () => {
        const filePath = path.join(tmpDir, 'long.txt');
        const lines = Array.from({ length: 600 }, (_, i) => `Line ${String(i + 1)}`);
        await fs.writeFile(filePath, lines.join('\n'));

        const result = await readFileTool.execute(
          { path: filePath, max_lines: 9999 },
          baseConfig
        );
        expect(result).toContain('showing 500 of 600 lines');
      });

      it('should not show truncation message for short files', async () => {
        const filePath = path.join(tmpDir, 'short.txt');
        await fs.writeFile(filePath, 'just one line');

        const result = await readFileTool.execute({ path: filePath }, baseConfig);
        expect(result).not.toContain('truncated');
        expect(result).toContain('just one line');
      });
    });

    describe('sensitive data scrubbing', () => {
      it('should scrub sensitive data from default mode output', async () => {
        const filePath = path.join(tmpDir, 'config.yml');
        await fs.writeFile(filePath, 'password: my_secret_pass123\napi_key: sk-1234567890');

        const result = await readFileTool.execute({ path: filePath }, baseConfig);
        expect(result).not.toContain('my_secret_pass123');
      });

      it('should scrub sensitive data from search results', async () => {
        const filePath = path.join(tmpDir, 'config.yml');
        await fs.writeFile(filePath, 'password: supersecret\nname: app');

        const result = await readFileTool.execute(
          { path: filePath, search_pattern: 'password' },
          baseConfig
        );
        expect(result).not.toContain('supersecret');
      });

      it('should scrub sensitive data from line range output', async () => {
        const filePath = path.join(tmpDir, 'config.yml');
        await fs.writeFile(filePath, 'password: supersecret\nname: app');

        const result = await readFileTool.execute(
          { path: filePath, start_line: 1, end_line: 1 },
          baseConfig
        );
        expect(result).not.toContain('supersecret');
      });
    });

    describe('error handling', () => {
      it('should handle generic errors gracefully', async () => {
        // Use a path that passes isPathAllowed but validateRealPath will fail
        const result = await readFileTool.execute(
          { path: path.join(tmpDir, 'nonexistent.txt') },
          baseConfig
        );
        expect(result).toContain('Error');
      });
    });
  });
});

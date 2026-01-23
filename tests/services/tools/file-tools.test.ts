import { describe, it, expect } from 'vitest';
import { isPathAllowed } from '../../../src/services/tools/file-tools.js';

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
        // /home/user/ansible-extra should NOT match /home/user/ansible
        expect(isPathAllowed('/home/user/ansible-extra/file.yml', allowedDirs)).toBe(false);
        expect(isPathAllowed('/opt/stacks-old/file.yml', allowedDirs)).toBe(false);
      });
    });

    describe('edge cases', () => {
      it('should return false when allowedDirs is empty', () => {
        expect(isPathAllowed('/any/path/file.txt', [])).toBe(false);
      });

      it('should handle relative path components correctly', () => {
        // Path with . should resolve correctly
        expect(isPathAllowed('/home/user/ansible/./inventory.yml', allowedDirs)).toBe(true);
      });

      it('should handle paths with trailing slashes', () => {
        const dirsWithTrailing = ['/home/user/ansible/', '/opt/stacks/'];
        expect(isPathAllowed('/home/user/ansible/file.yml', dirsWithTrailing)).toBe(true);
      });
    });
  });
});

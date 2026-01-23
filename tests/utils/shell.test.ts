import { describe, it, expect } from 'vitest';
import {
  executeCommand,
  isCommandAllowed,
  getAllowedCommands,
  ShellSecurityError,
} from '../../src/utils/shell.js';

describe('shell security', () => {
  describe('command allowlist', () => {
    it('should allow commands in the allowlist', () => {
      expect(isCommandAllowed('docker')).toBe(true);
      expect(isCommandAllowed('free')).toBe(true);
      expect(isCommandAllowed('df')).toBe(true);
      expect(isCommandAllowed('top')).toBe(true);
      expect(isCommandAllowed('openssl')).toBe(true);
      expect(isCommandAllowed('pm2')).toBe(true);
      expect(isCommandAllowed('stat')).toBe(true);
    });

    it('should reject commands not in the allowlist', () => {
      expect(isCommandAllowed('rm')).toBe(false);
      expect(isCommandAllowed('curl')).toBe(false);
      expect(isCommandAllowed('wget')).toBe(false);
      expect(isCommandAllowed('bash')).toBe(false);
      expect(isCommandAllowed('sh')).toBe(false);
      expect(isCommandAllowed('eval')).toBe(false);
      expect(isCommandAllowed('exec')).toBe(false);
    });

    it('should provide list of allowed commands', () => {
      const commands = getAllowedCommands();
      expect(commands).toContain('docker');
      expect(commands).toContain('free');
      expect(commands).not.toContain('rm');
    });
  });

  describe('executeCommand', () => {
    describe('command validation', () => {
      it('should reject commands not in allowlist', async () => {
        await expect(executeCommand('rm', ['-rf', '/'])).rejects.toThrow(ShellSecurityError);
        await expect(executeCommand('rm', ['-rf', '/'])).rejects.toThrow(
          'Command not in allowlist: rm'
        );
      });

      it('should reject bash and shell commands', async () => {
        await expect(executeCommand('bash', ['-c', 'echo hello'])).rejects.toThrow(
          ShellSecurityError
        );
        await expect(executeCommand('sh', ['-c', 'echo hello'])).rejects.toThrow(
          ShellSecurityError
        );
      });

      it('should reject curl and wget', async () => {
        await expect(executeCommand('curl', ['http://evil.com'])).rejects.toThrow(
          ShellSecurityError
        );
        await expect(executeCommand('wget', ['http://evil.com'])).rejects.toThrow(
          ShellSecurityError
        );
      });
    });

    describe('argument validation - shell injection prevention', () => {
      it('should reject semicolon (command chaining)', async () => {
        await expect(executeCommand('docker', ['ps', '; rm -rf /'])).rejects.toThrow(
          ShellSecurityError
        );
        await expect(executeCommand('docker', ['ps', '; rm -rf /'])).rejects.toThrow(
          'Argument contains forbidden characters'
        );
      });

      it('should reject pipe character', async () => {
        await expect(executeCommand('docker', ['ps', '| cat /etc/passwd'])).rejects.toThrow(
          ShellSecurityError
        );
      });

      it('should reject ampersand (background/AND)', async () => {
        await expect(executeCommand('docker', ['ps', '& malicious'])).rejects.toThrow(
          ShellSecurityError
        );
        await expect(executeCommand('docker', ['ps', '&& malicious'])).rejects.toThrow(
          ShellSecurityError
        );
      });

      it('should reject backticks (command substitution)', async () => {
        await expect(executeCommand('docker', ['ps', '`cat /etc/passwd`'])).rejects.toThrow(
          ShellSecurityError
        );
      });

      it('should reject $() (command substitution)', async () => {
        await expect(executeCommand('docker', ['ps', '$(cat /etc/passwd)'])).rejects.toThrow(
          ShellSecurityError
        );
      });

      it('should reject curly braces', async () => {
        await expect(executeCommand('docker', ['ps', '{malicious}'])).rejects.toThrow(
          ShellSecurityError
        );
      });

      it('should reject redirects', async () => {
        await expect(executeCommand('docker', ['ps', '>', '/tmp/file'])).rejects.toThrow(
          ShellSecurityError
        );
        await expect(executeCommand('docker', ['ps', '<', '/etc/passwd'])).rejects.toThrow(
          ShellSecurityError
        );
      });

      it('should reject newlines (command injection)', async () => {
        await expect(executeCommand('docker', ['ps', '\nrm -rf /'])).rejects.toThrow(
          ShellSecurityError
        );
        await expect(executeCommand('docker', ['ps', '\rrm -rf /'])).rejects.toThrow(
          ShellSecurityError
        );
      });

      it('should reject quotes (escape attempts)', async () => {
        await expect(executeCommand('docker', ['ps', "'; rm -rf /"])).rejects.toThrow(
          ShellSecurityError
        );
        await expect(executeCommand('docker', ['ps', '"; rm -rf /'])).rejects.toThrow(
          ShellSecurityError
        );
      });

      it('should reject backslash (escape sequences)', async () => {
        await expect(executeCommand('docker', ['ps', '\\n'])).rejects.toThrow(ShellSecurityError);
      });

      it('should allow safe arguments', async () => {
        // These should not throw (though may fail at execution if command not found)
        await expect(executeCommand('docker', ['ps', '-a'])).resolves.toBeDefined();
        await expect(executeCommand('docker', ['ps', '--format', 'table'])).resolves.toBeDefined();
      });
    });

    describe('docker subcommand validation', () => {
      it('should allow read-only docker subcommands', async () => {
        // These should not throw security errors
        await expect(executeCommand('docker', ['ps'])).resolves.toBeDefined();
        await expect(executeCommand('docker', ['ps', '-a'])).resolves.toBeDefined();
        await expect(executeCommand('docker', ['inspect', 'container-name'])).resolves.toBeDefined();
        await expect(executeCommand('docker', ['logs', 'container-name'])).resolves.toBeDefined();
        await expect(executeCommand('docker', ['network', 'ls'])).resolves.toBeDefined();
        await expect(executeCommand('docker', ['images'])).resolves.toBeDefined();
        await expect(executeCommand('docker', ['version'])).resolves.toBeDefined();
        await expect(executeCommand('docker', ['info'])).resolves.toBeDefined();
      });

      it('should reject dangerous docker subcommands', async () => {
        await expect(executeCommand('docker', ['exec', 'container', 'bash'])).rejects.toThrow(
          'Docker subcommand not allowed: exec'
        );
        await expect(executeCommand('docker', ['run', 'image'])).rejects.toThrow(
          'Docker subcommand not allowed: run'
        );
        await expect(executeCommand('docker', ['rm', 'container'])).rejects.toThrow(
          'Docker subcommand not allowed: rm'
        );
        await expect(executeCommand('docker', ['stop', 'container'])).rejects.toThrow(
          'Docker subcommand not allowed: stop'
        );
        await expect(executeCommand('docker', ['start', 'container'])).rejects.toThrow(
          'Docker subcommand not allowed: start'
        );
        await expect(executeCommand('docker', ['restart', 'container'])).rejects.toThrow(
          'Docker subcommand not allowed: restart'
        );
        await expect(executeCommand('docker', ['kill', 'container'])).rejects.toThrow(
          'Docker subcommand not allowed: kill'
        );
        await expect(executeCommand('docker', ['pull', 'image'])).rejects.toThrow(
          'Docker subcommand not allowed: pull'
        );
        await expect(executeCommand('docker', ['push', 'image'])).rejects.toThrow(
          'Docker subcommand not allowed: push'
        );
        await expect(executeCommand('docker', ['rmi', 'image'])).rejects.toThrow(
          'Docker subcommand not allowed: rmi'
        );
      });

      it('should reject docker without subcommand', async () => {
        await expect(executeCommand('docker', [])).rejects.toThrow(
          'Docker command requires a subcommand'
        );
      });
    });

    describe('aws subcommand validation', () => {
      it('should allow read-only aws s3 commands', async () => {
        await expect(executeCommand('aws', ['s3', 'ls'])).resolves.toBeDefined();
        await expect(
          executeCommand('aws', ['s3', 'ls', 's3://bucket-name'])
        ).resolves.toBeDefined();
      });

      it('should reject dangerous aws commands', async () => {
        await expect(executeCommand('aws', ['s3', 'rm', 's3://bucket/file'])).rejects.toThrow(
          'AWS S3 subcommand not allowed: rm'
        );
        await expect(executeCommand('aws', ['s3', 'cp', 'file', 's3://bucket'])).rejects.toThrow(
          'AWS S3 subcommand not allowed: cp'
        );
        await expect(executeCommand('aws', ['s3', 'sync', '.', 's3://bucket'])).rejects.toThrow(
          'AWS S3 subcommand not allowed: sync'
        );
        await expect(executeCommand('aws', ['ec2', 'describe-instances'])).rejects.toThrow(
          'AWS service not allowed: ec2'
        );
        await expect(executeCommand('aws', ['iam', 'list-users'])).rejects.toThrow(
          'AWS service not allowed: iam'
        );
      });

      it('should reject aws without subcommand', async () => {
        await expect(executeCommand('aws', [])).rejects.toThrow(
          'AWS command requires a subcommand'
        );
      });
    });

    describe('fail2ban-client subcommand validation', () => {
      it('should allow read-only fail2ban commands', async () => {
        await expect(executeCommand('fail2ban-client', ['status'])).resolves.toBeDefined();
        await expect(executeCommand('fail2ban-client', ['status', 'sshd'])).resolves.toBeDefined();
        await expect(executeCommand('fail2ban-client', ['banned'])).resolves.toBeDefined();
      });

      it('should reject dangerous fail2ban commands', async () => {
        await expect(
          executeCommand('fail2ban-client', ['set', 'sshd', 'unbanip', '1.2.3.4'])
        ).rejects.toThrow('fail2ban-client subcommand not allowed: set');
        await expect(executeCommand('fail2ban-client', ['reload'])).rejects.toThrow(
          'fail2ban-client subcommand not allowed: reload'
        );
        await expect(executeCommand('fail2ban-client', ['stop'])).rejects.toThrow(
          'fail2ban-client subcommand not allowed: stop'
        );
        await expect(executeCommand('fail2ban-client', ['start'])).rejects.toThrow(
          'fail2ban-client subcommand not allowed: start'
        );
      });

      it('should reject fail2ban-client without subcommand', async () => {
        await expect(executeCommand('fail2ban-client', [])).rejects.toThrow(
          'fail2ban-client command requires a subcommand'
        );
      });
    });
  });

  describe('ShellSecurityError', () => {
    it('should have correct name and message', () => {
      const error = new ShellSecurityError('Test message');
      expect(error.name).toBe('ShellSecurityError');
      expect(error.message).toBe('Test message');
      expect(error).toBeInstanceOf(Error);
    });
  });
});

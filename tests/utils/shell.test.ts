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
      expect(isCommandAllowed('wget')).toBe(false);
      expect(isCommandAllowed('bash')).toBe(false);
      expect(isCommandAllowed('sh')).toBe(false);
      expect(isCommandAllowed('eval')).toBe(false);
      expect(isCommandAllowed('exec')).toBe(false);
    });

    it('should allow new diagnostic commands', () => {
      expect(isCommandAllowed('curl')).toBe(true);
      expect(isCommandAllowed('ps')).toBe(true);
      expect(isCommandAllowed('systemctl')).toBe(true);
      expect(isCommandAllowed('journalctl')).toBe(true);
      expect(isCommandAllowed('ss')).toBe(true);
      expect(isCommandAllowed('ip')).toBe(true);
      expect(isCommandAllowed('ping')).toBe(true);
      expect(isCommandAllowed('grep')).toBe(true);
      expect(isCommandAllowed('find')).toBe(true);
      expect(isCommandAllowed('head')).toBe(true);
      expect(isCommandAllowed('tail')).toBe(true);
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

      it('should reject wget (not in allowlist)', async () => {
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

      it('should reject newlines (command injection)', async () => {
        await expect(executeCommand('docker', ['ps', '\nrm -rf /'])).rejects.toThrow(
          ShellSecurityError
        );
        await expect(executeCommand('docker', ['ps', '\rrm -rf /'])).rejects.toThrow(
          ShellSecurityError
        );
      });

      // Note: curly braces, redirects, quotes, and backslashes are now allowed
      // because we use execFile() with shell: false, making them harmless.
      // This enables Docker --format templates like {{.Names}}

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
        // Note: These tests verify security validation passes, not that AWS executes successfully.
        // The command may fail (aws not installed, no credentials, network issues) but
        // should not throw ShellSecurityError.
        const result1 = await executeCommand('aws', ['s3', 'ls']);
        expect(result1).toBeDefined();
        expect(result1).toHaveProperty('stdout');
        expect(result1).toHaveProperty('stderr');
        expect(result1).toHaveProperty('exitCode');

        const result2 = await executeCommand('aws', ['s3', 'ls', 's3://bucket-name']);
        expect(result2).toBeDefined();
        expect(result2).toHaveProperty('exitCode');
      }, 10000); // Longer timeout for potential network operations

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

    describe('file command path validation', () => {
      it('should allow reading from /opt directory', async () => {
        await expect(executeCommand('cat', ['/opt/logs/app.log'])).resolves.toBeDefined();
        await expect(executeCommand('ls', ['/opt/backups'])).resolves.toBeDefined();
      });

      it('should allow reading from /tmp directory', async () => {
        await expect(executeCommand('cat', ['/tmp/test.txt'])).resolves.toBeDefined();
        await expect(executeCommand('ls', ['/tmp'])).resolves.toBeDefined();
      });

      it('should allow reading from /var/log directory', async () => {
        await expect(executeCommand('cat', ['/var/log/syslog'])).resolves.toBeDefined();
        await expect(executeCommand('ls', ['/var/log'])).resolves.toBeDefined();
      });

      it('should allow reading from /etc directory (now permitted)', async () => {
        await expect(executeCommand('cat', ['/etc/hostname'])).resolves.toBeDefined();
        await expect(executeCommand('ls', ['/etc'])).resolves.toBeDefined();
      });

      it('should allow reading from /home directory (now permitted)', async () => {
        await expect(executeCommand('ls', ['/home'])).resolves.toBeDefined();
      });

      it('should allow reading from /proc and /sys (now permitted)', async () => {
        await expect(executeCommand('cat', ['/proc/meminfo'])).resolves.toBeDefined();
        await expect(executeCommand('ls', ['/sys/class'])).resolves.toBeDefined();
      });

      it('should allow ls without path', async () => {
        await expect(executeCommand('ls', [])).resolves.toBeDefined();
        await expect(executeCommand('ls', ['-la'])).resolves.toBeDefined();
      });

      it('should reject cat without path', async () => {
        await expect(executeCommand('cat', [])).rejects.toThrow(
          'cat command requires a file path'
        );
      });

      it('should reject reading from sensitive paths (SSH keys)', async () => {
        await expect(executeCommand('ls', ['/home/user/.ssh'])).rejects.toThrow(
          'Path contains sensitive data'
        );
        await expect(executeCommand('cat', ['/home/user/.ssh/id_rsa'])).rejects.toThrow(
          'Path contains sensitive data'
        );
      });

      it('should reject reading from sensitive paths (GPG keys)', async () => {
        await expect(executeCommand('ls', ['/home/user/.gnupg'])).rejects.toThrow(
          'Path contains sensitive data'
        );
      });

      it('should reject reading from sensitive paths (credentials)', async () => {
        await expect(executeCommand('cat', ['/home/user/.aws/credentials'])).rejects.toThrow(
          'Path contains sensitive data'
        );
        await expect(executeCommand('cat', ['/home/user/.kube/config'])).rejects.toThrow(
          'Path contains sensitive data'
        );
        await expect(executeCommand('cat', ['/home/user/.bash_history'])).rejects.toThrow(
          'Path contains sensitive data'
        );
        await expect(executeCommand('cat', ['/opt/app/.env'])).rejects.toThrow(
          'Path contains sensitive data'
        );
      });

      it('should reject arbitrary paths outside allowlist', async () => {
        await expect(executeCommand('cat', ['/usr/bin/something'])).rejects.toThrow(
          'Path not allowed: /usr/bin/something'
        );
        await expect(executeCommand('ls', ['/boot'])).rejects.toThrow(
          'Path not allowed: /boot'
        );
      });

      it('should allow flags mixed with allowed paths', async () => {
        await expect(executeCommand('ls', ['-la', '/opt/backups'])).resolves.toBeDefined();
        await expect(executeCommand('cat', ['-n', '/tmp/test.txt'])).resolves.toBeDefined();
      });

      it('should work with new file commands (head, tail, find, grep)', async () => {
        await expect(executeCommand('head', ['-n', '10', '/var/log/syslog'])).resolves.toBeDefined();
        await expect(executeCommand('tail', ['-n', '10', '/var/log/syslog'])).resolves.toBeDefined();
        await expect(executeCommand('find', ['/opt', '-name', '*.log'])).resolves.toBeDefined();
        await expect(executeCommand('grep', ['error', '/var/log/syslog'])).resolves.toBeDefined();
      });
    });

    describe('systemctl subcommand validation', () => {
      it('should allow read-only systemctl subcommands', async () => {
        await expect(executeCommand('systemctl', ['status'])).resolves.toBeDefined();
        await expect(executeCommand('systemctl', ['status', 'nginx'])).resolves.toBeDefined();
        await expect(executeCommand('systemctl', ['list-units'])).resolves.toBeDefined();
        await expect(executeCommand('systemctl', ['is-active', 'docker'])).resolves.toBeDefined();
      });

      it('should reject dangerous systemctl subcommands', async () => {
        await expect(executeCommand('systemctl', ['start', 'nginx'])).rejects.toThrow(
          'systemctl subcommand not allowed: start'
        );
        await expect(executeCommand('systemctl', ['stop', 'nginx'])).rejects.toThrow(
          'systemctl subcommand not allowed: stop'
        );
        await expect(executeCommand('systemctl', ['restart', 'nginx'])).rejects.toThrow(
          'systemctl subcommand not allowed: restart'
        );
        await expect(executeCommand('systemctl', ['enable', 'nginx'])).rejects.toThrow(
          'systemctl subcommand not allowed: enable'
        );
        await expect(executeCommand('systemctl', ['disable', 'nginx'])).rejects.toThrow(
          'systemctl subcommand not allowed: disable'
        );
        await expect(executeCommand('systemctl', ['daemon-reload'])).rejects.toThrow(
          'systemctl subcommand not allowed: daemon-reload'
        );
      });

      it('should reject systemctl without subcommand', async () => {
        await expect(executeCommand('systemctl', [])).rejects.toThrow(
          'systemctl command requires a subcommand'
        );
      });
    });

    describe('journalctl validation', () => {
      it('should allow read-only journalctl commands', async () => {
        await expect(executeCommand('journalctl', ['-u', 'nginx'])).resolves.toBeDefined();
        await expect(executeCommand('journalctl', ['-n', '50'])).resolves.toBeDefined();
        await expect(executeCommand('journalctl', ['--since', 'today'])).resolves.toBeDefined();
      });

      it('should reject dangerous journalctl flags', async () => {
        await expect(executeCommand('journalctl', ['--flush'])).rejects.toThrow(
          'journalctl flag not allowed: --flush'
        );
        await expect(executeCommand('journalctl', ['--rotate'])).rejects.toThrow(
          'journalctl flag not allowed: --rotate'
        );
        await expect(executeCommand('journalctl', ['--vacuum-time', '1d'])).rejects.toThrow(
          'journalctl flag not allowed: --vacuum-time'
        );
      });
    });

    describe('curl validation', () => {
      it('should allow read-only curl commands', async () => {
        await expect(executeCommand('curl', ['https://example.com'])).resolves.toBeDefined();
        await expect(executeCommand('curl', ['-I', 'https://example.com'])).resolves.toBeDefined();
        await expect(executeCommand('curl', ['-s', 'https://example.com'])).resolves.toBeDefined();
      });

      it('should reject curl with write/upload flags', async () => {
        await expect(executeCommand('curl', ['-o', 'file.txt', 'https://example.com'])).rejects.toThrow(
          'curl flag not allowed: -o'
        );
        await expect(executeCommand('curl', ['--output', 'file.txt', 'https://example.com'])).rejects.toThrow(
          'curl flag not allowed: --output'
        );
        await expect(executeCommand('curl', ['-T', 'file.txt', 'https://example.com'])).rejects.toThrow(
          'curl flag not allowed: -T'
        );
        await expect(executeCommand('curl', ['-d', 'data', 'https://example.com'])).rejects.toThrow(
          'curl flag not allowed: -d'
        );
        await expect(executeCommand('curl', ['-X', 'POST', 'https://example.com'])).rejects.toThrow(
          'curl flag not allowed: -X'
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

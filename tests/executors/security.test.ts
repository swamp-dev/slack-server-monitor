import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getFail2banStatus,
  getJailDetails,
  isFail2banAvailable,
} from '../../src/executors/security.js';

// Mock executeCommand
vi.mock('../../src/utils/shell.js', () => ({
  executeCommand: vi.fn(),
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

describe('security executor', () => {
  let mockExecuteCommand: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const shell = await import('../../src/utils/shell.js');
    mockExecuteCommand = shell.executeCommand as ReturnType<typeof vi.fn>;
  });

  describe('getFail2banStatus', () => {
    it('should parse fail2ban-client status output', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: `Status
|- Number of jail:	3
\`- Jail list:	sshd, nginx-http-auth, nginx-botsearch`,
        stderr: '',
      });

      const result = await getFail2banStatus();

      expect(result.jailCount).toBe(3);
      expect(result.jails).toEqual(['sshd', 'nginx-http-auth', 'nginx-botsearch']);
    });

    it('should handle single jail', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: `Status
|- Number of jail:	1
\`- Jail list:	sshd`,
        stderr: '',
      });

      const result = await getFail2banStatus();

      expect(result.jailCount).toBe(1);
      expect(result.jails).toEqual(['sshd']);
    });

    it('should handle zero jails', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: `Status
|- Number of jail:	0
\`- Jail list:	`,
        stderr: '',
      });

      const result = await getFail2banStatus();

      expect(result.jailCount).toBe(0);
      expect(result.jails).toEqual([]);
    });

    it('should throw when fail2ban not running', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 255,
        stdout: '',
        stderr: 'ERROR Unable to contact server. Is it running?',
      });

      await expect(getFail2banStatus()).rejects.toThrow('fail2ban is not running');
    });

    it('should throw on unexpected errors', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'Permission denied',
      });

      await expect(getFail2banStatus()).rejects.toThrow('Failed to get fail2ban status');
    });
  });

  describe('getJailDetails', () => {
    it('should parse jail status with banned IPs', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: `Status for the jail: sshd
|- Filter
|  |- Currently failed:	5
|  |- Total failed:	127
|  \`- File list:	/var/log/auth.log
\`- Actions
   |- Currently banned:	3
   |- Total banned:	45
   \`- Banned IP list:	192.168.1.100 10.0.0.50 172.16.0.25`,
        stderr: '',
      });

      const result = await getJailDetails('sshd');

      expect(result.name).toBe('sshd');
      expect(result.currentlyFailed).toBe(5);
      expect(result.totalFailed).toBe(127);
      expect(result.currentlyBanned).toBe(3);
      expect(result.totalBanned).toBe(45);
      expect(result.bannedIps).toEqual(['192.168.1.100', '10.0.0.50', '172.16.0.25']);
      expect(result.fileList).toEqual(['/var/log/auth.log']);
    });

    it('should handle jail with no banned IPs', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: `Status for the jail: nginx-http-auth
|- Filter
|  |- Currently failed:	0
|  |- Total failed:	10
|  \`- File list:	/var/log/nginx/error.log
\`- Actions
   |- Currently banned:	0
   |- Total banned:	5
   \`- Banned IP list:	`,
        stderr: '',
      });

      const result = await getJailDetails('nginx-http-auth');

      expect(result.name).toBe('nginx-http-auth');
      expect(result.currentlyBanned).toBe(0);
      expect(result.bannedIps).toEqual([]);
    });

    it('should handle multiple log files', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: `Status for the jail: sshd
|- Filter
|  |- Currently failed:	0
|  |- Total failed:	0
|  \`- File list:	/var/log/auth.log /var/log/secure
\`- Actions
   |- Currently banned:	0
   |- Total banned:	0
   \`- Banned IP list:	`,
        stderr: '',
      });

      const result = await getJailDetails('sshd');

      expect(result.fileList).toEqual(['/var/log/auth.log', '/var/log/secure']);
    });

    it('should throw on jail not found', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: "Sorry but the jail 'nonexistent' does not exist",
      });

      await expect(getJailDetails('nonexistent')).rejects.toThrow('Jail not found');
    });

    it('should throw when fail2ban not running', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 255,
        stdout: '',
        stderr: 'ERROR Unable to contact server. Is it running?',
      });

      await expect(getJailDetails('sshd')).rejects.toThrow('fail2ban is not running');
    });
  });

  describe('isFail2banAvailable', () => {
    it('should return true when fail2ban is running', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Status\n|- Number of jail: 1',
        stderr: '',
      });

      const result = await isFail2banAvailable();

      expect(result).toBe(true);
    });

    it('should return false when fail2ban is not running', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 255,
        stdout: '',
        stderr: 'ERROR Unable to contact server',
      });

      const result = await isFail2banAvailable();

      expect(result).toBe(false);
    });

    it('should return false when command throws', async () => {
      mockExecuteCommand.mockRejectedValueOnce(new Error('Command not found'));

      const result = await isFail2banAvailable();

      expect(result).toBe(false);
    });
  });
});

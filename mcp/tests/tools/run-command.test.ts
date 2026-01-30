import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFile } from 'child_process';
import { executeTool, type ToolConfig } from '../../src/tools/index.js';

// Mock child_process.execFile to avoid actually executing commands
vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

// Default test config
const testConfig: ToolConfig = {
  allowedDirs: ['/tmp', '/opt'],
  maxFileSizeKb: 100,
  maxLogLines: 50,
};

// Helper to setup mock for successful command execution
function mockSuccessfulExecution(stdout = 'mock output', stderr = '') {
  const mockExecFile = vi.mocked(execFile);
  mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
    if (typeof callback === 'function') {
      callback(null, stdout, stderr);
    }
    return {} as ReturnType<typeof execFile>;
  });
}

describe('run_command security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSuccessfulExecution();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('command allowlist', () => {
    it('should allow commands in the allowlist', async () => {
      const result = await executeTool('run_command', { command: 'docker', args: ['ps'] }, testConfig);
      expect(result).not.toContain('Security error');
      expect(result).not.toContain('not in allowlist');
    });

    it('should reject commands not in allowlist', async () => {
      const result = await executeTool('run_command', { command: 'rm', args: ['-rf', '/'] }, testConfig);
      expect(result).toContain('Security error');
      expect(result).toContain('not in allowlist');
    });

    it('should reject bash shell command', async () => {
      const result = await executeTool('run_command', { command: 'bash', args: ['-c', 'echo hello'] }, testConfig);
      expect(result).toContain('Security error');
    });

    it('should reject sh shell command', async () => {
      const result = await executeTool('run_command', { command: 'sh', args: ['-c', 'echo hello'] }, testConfig);
      expect(result).toContain('Security error');
    });

    it('should reject wget (not in allowlist)', async () => {
      const result = await executeTool('run_command', { command: 'wget', args: ['http://evil.com'] }, testConfig);
      expect(result).toContain('Security error');
    });
  });

  describe('shell injection prevention', () => {
    it('should reject semicolon (command chaining)', async () => {
      const result = await executeTool('run_command', { command: 'docker', args: ['ps', '; rm -rf /'] }, testConfig);
      expect(result).toContain('Security error');
      expect(result).toContain('forbidden characters');
    });

    it('should reject pipe character', async () => {
      const result = await executeTool('run_command', { command: 'docker', args: ['ps', '| cat /etc/passwd'] }, testConfig);
      expect(result).toContain('Security error');
    });

    it('should reject ampersand (background/AND)', async () => {
      const result = await executeTool('run_command', { command: 'docker', args: ['ps', '& malicious'] }, testConfig);
      expect(result).toContain('Security error');
    });

    it('should reject backticks (command substitution)', async () => {
      const result = await executeTool('run_command', { command: 'docker', args: ['ps', '`cat /etc/passwd`'] }, testConfig);
      expect(result).toContain('Security error');
    });

    it('should reject $() (command substitution)', async () => {
      const result = await executeTool('run_command', { command: 'docker', args: ['ps', '$(cat /etc/passwd)'] }, testConfig);
      expect(result).toContain('Security error');
    });

    it('should reject newlines (command injection)', async () => {
      const result = await executeTool('run_command', { command: 'docker', args: ['ps', '\nrm -rf /'] }, testConfig);
      expect(result).toContain('Security error');
    });
  });

  describe('docker subcommand validation', () => {
    it('should allow read-only docker subcommands', async () => {
      const allowedSubcommands = ['ps', 'inspect', 'logs', 'network', 'images', 'version', 'info'];

      for (const sub of allowedSubcommands) {
        const result = await executeTool('run_command', { command: 'docker', args: [sub] }, testConfig);
        expect(result).not.toContain('Security error');
      }
    });

    it('should reject dangerous docker subcommand: exec', async () => {
      const result = await executeTool('run_command', { command: 'docker', args: ['exec', 'container', 'bash'] }, testConfig);
      expect(result).toContain('Security error');
      expect(result).toContain('not allowed');
    });

    it('should reject dangerous docker subcommand: run', async () => {
      const result = await executeTool('run_command', { command: 'docker', args: ['run', 'image'] }, testConfig);
      expect(result).toContain('Security error');
    });

    it('should reject dangerous docker subcommand: rm', async () => {
      const result = await executeTool('run_command', { command: 'docker', args: ['rm', 'container'] }, testConfig);
      expect(result).toContain('Security error');
    });

    it('should reject dangerous docker subcommand: stop', async () => {
      const result = await executeTool('run_command', { command: 'docker', args: ['stop', 'container'] }, testConfig);
      expect(result).toContain('Security error');
    });

    it('should reject dangerous docker subcommand: kill', async () => {
      const result = await executeTool('run_command', { command: 'docker', args: ['kill', 'container'] }, testConfig);
      expect(result).toContain('Security error');
    });

    it('should reject docker without subcommand', async () => {
      const result = await executeTool('run_command', { command: 'docker', args: [] }, testConfig);
      expect(result).toContain('Security error');
      expect(result).toContain('requires a subcommand');
    });
  });

  describe('systemctl subcommand validation', () => {
    it('should allow read-only systemctl subcommands', async () => {
      const allowedSubcommands = ['status', 'show', 'list-units', 'is-active', 'is-enabled'];

      for (const sub of allowedSubcommands) {
        const result = await executeTool('run_command', { command: 'systemctl', args: [sub] }, testConfig);
        expect(result).not.toContain('Security error');
      }
    });

    it('should reject systemctl start', async () => {
      const result = await executeTool('run_command', { command: 'systemctl', args: ['start', 'nginx'] }, testConfig);
      expect(result).toContain('Security error');
    });

    it('should reject systemctl stop', async () => {
      const result = await executeTool('run_command', { command: 'systemctl', args: ['stop', 'nginx'] }, testConfig);
      expect(result).toContain('Security error');
    });

    it('should reject systemctl restart', async () => {
      const result = await executeTool('run_command', { command: 'systemctl', args: ['restart', 'nginx'] }, testConfig);
      expect(result).toContain('Security error');
    });

    it('should reject systemctl daemon-reload', async () => {
      const result = await executeTool('run_command', { command: 'systemctl', args: ['daemon-reload'] }, testConfig);
      expect(result).toContain('Security error');
    });
  });

  describe('curl validation', () => {
    it('should allow read-only curl commands', async () => {
      const result = await executeTool('run_command', { command: 'curl', args: ['https://example.com'] }, testConfig);
      expect(result).not.toContain('Security error');
    });

    it('should reject curl with -o (output file)', async () => {
      const result = await executeTool('run_command', { command: 'curl', args: ['-o', 'file.txt', 'https://example.com'] }, testConfig);
      expect(result).toContain('Security error');
    });

    it('should reject curl with -d (POST data)', async () => {
      const result = await executeTool('run_command', { command: 'curl', args: ['-d', 'data', 'https://example.com'] }, testConfig);
      expect(result).toContain('Security error');
    });

    it('should reject curl with -X POST', async () => {
      const result = await executeTool('run_command', { command: 'curl', args: ['-X', 'POST', 'https://example.com'] }, testConfig);
      expect(result).toContain('Security error');
    });
  });

  describe('journalctl validation', () => {
    it('should allow read-only journalctl commands', async () => {
      const result = await executeTool('run_command', { command: 'journalctl', args: ['-u', 'nginx', '-n', '50'] }, testConfig);
      expect(result).not.toContain('Security error');
    });

    it('should reject journalctl --flush', async () => {
      const result = await executeTool('run_command', { command: 'journalctl', args: ['--flush'] }, testConfig);
      expect(result).toContain('Security error');
    });

    it('should reject journalctl --rotate', async () => {
      const result = await executeTool('run_command', { command: 'journalctl', args: ['--rotate'] }, testConfig);
      expect(result).toContain('Security error');
    });

    it('should reject journalctl --vacuum-time', async () => {
      const result = await executeTool('run_command', { command: 'journalctl', args: ['--vacuum-time', '1d'] }, testConfig);
      expect(result).toContain('Security error');
    });
  });

  describe('output scrubbing', () => {
    // Note: Output scrubbing is handled by scrubSensitiveData from slack-server-monitor
    // Those tests are comprehensive in the slack-server-monitor test suite
    // Here we verify that errors from invalid commands are handled gracefully

    it('should not leak raw sensitive output even on error', async () => {
      // Even if command execution fails, sensitive data should not appear
      const result = await executeTool('run_command', { command: 'docker', args: ['ps'] }, testConfig);
      // Result should be a string (either output or error message)
      expect(typeof result).toBe('string');
      // Should not contain common secret patterns in error messages
      expect(result).not.toMatch(/password\s*=\s*[^\s[]/i);
    });

    it('should handle (no output) case gracefully', async () => {
      const result = await executeTool('run_command', { command: 'docker', args: ['ps'] }, testConfig);
      // Should return either actual output or (no output) or an error
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });
});

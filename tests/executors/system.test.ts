import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getMemoryInfo,
  getSwapInfo,
  getDiskUsage,
  getUptimeInfo,
  getSystemResources,
  getCpuInfo,
  getProcessInfo,
} from '../../src/executors/system.js';

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

describe('system executor', () => {
  let mockExecuteCommand: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const shell = await import('../../src/utils/shell.js');
    mockExecuteCommand = shell.executeCommand as ReturnType<typeof vi.fn>;
  });

  describe('getMemoryInfo', () => {
    it('should parse free -m output correctly', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout:
          '              total        used        free      shared  buff/cache   available\n' +
          'Mem:          16384        8192        2048         512        6144       12288\n' +
          'Swap:          4096        1024        3072\n',
        stderr: '',
      });

      const result = await getMemoryInfo();

      expect(result.total).toBe(16384);
      expect(result.used).toBe(8192);
      expect(result.free).toBe(2048);
      expect(result.available).toBe(12288);
      expect(result.percentUsed).toBe(50);
    });

    it('should throw on command failure with error message', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'free: command not found',
      });

      await expect(getMemoryInfo()).rejects.toThrow('Failed to get memory info');
    });

    it('should throw on command failure with empty stderr', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 127,
        stdout: '',
        stderr: '', // Empty - simulates binary not found on some systems
      });

      await expect(getMemoryInfo()).rejects.toThrow('Failed to get memory info');
    });

    it('should throw when Mem line is missing', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'invalid output without Mem line\n',
        stderr: '',
      });

      await expect(getMemoryInfo()).rejects.toThrow('Failed to parse memory info');
    });

    it('should handle zero total memory gracefully', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout:
          '              total        used        free      shared  buff/cache   available\n' +
          'Mem:              0           0           0           0            0           0\n',
        stderr: '',
      });

      const result = await getMemoryInfo();

      expect(result.percentUsed).toBe(0);
    });
  });

  describe('getSwapInfo', () => {
    it('should parse swap info correctly', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout:
          '              total        used        free      shared  buff/cache   available\n' +
          'Mem:          16384        8192        2048         512        6144       12288\n' +
          'Swap:          4096        1024        3072\n',
        stderr: '',
      });

      const result = await getSwapInfo();

      expect(result.total).toBe(4096);
      expect(result.used).toBe(1024);
      expect(result.free).toBe(3072);
      expect(result.percentUsed).toBe(25);
    });

    it('should return zeros when no Swap line present', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout:
          '              total        used        free      shared  buff/cache   available\n' +
          'Mem:          16384        8192        2048         512        6144       12288\n',
        stderr: '',
      });

      const result = await getSwapInfo();

      expect(result.total).toBe(0);
      expect(result.used).toBe(0);
      expect(result.free).toBe(0);
      expect(result.percentUsed).toBe(0);
    });

    it('should throw on command failure with error message', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'free: command not found',
      });

      await expect(getSwapInfo()).rejects.toThrow('Failed to get swap info');
    });

    it('should throw on command failure with empty stderr', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: '', // Empty - simulates binary not found
      });

      await expect(getSwapInfo()).rejects.toThrow('Failed to get swap info');
    });

    it('should handle zero total swap gracefully', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout:
          '              total        used        free      shared  buff/cache   available\n' +
          'Mem:          16384        8192        2048         512        6144       12288\n' +
          'Swap:             0           0           0\n',
        stderr: '',
      });

      const result = await getSwapInfo();

      expect(result.percentUsed).toBe(0);
    });
  });

  describe('getDiskUsage', () => {
    it('should parse df output correctly', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout:
          'Filesystem     Size  Used Avail Use% Mounted on\n' +
          '/dev/sda1      100G   50G   50G  50% /\n' +
          '/dev/sdb1      500G  250G  250G  50% /data\n',
        stderr: '',
      });

      const result = await getDiskUsage();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        filesystem: '/dev/sda1',
        size: '100G',
        used: '50G',
        available: '50G',
        percentUsed: 50,
        mountPoint: '/',
      });
    });

    it('should skip special filesystems', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout:
          'Filesystem     Size  Used Avail Use% Mounted on\n' +
          'tmpfs          1G    100M  900M  10% /tmp\n' +
          'devtmpfs       1G    0M    1G    0% /dev\n' +
          'overlay        10G   5G    5G   50% /var/lib/docker\n' +
          'shm            64M   0M    64M   0% /dev/shm\n' +
          '/dev/sda1      100G  50G   50G  50% /\n',
        stderr: '',
      });

      const result = await getDiskUsage();

      expect(result).toHaveLength(1);
      expect(result[0]?.filesystem).toBe('/dev/sda1');
    });

    it('should throw on command failure with error message', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'df: command not found',
      });

      await expect(getDiskUsage()).rejects.toThrow('Failed to get disk info');
    });

    it('should throw on command failure with empty stderr', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: '', // Empty - simulates binary not found
      });

      await expect(getDiskUsage()).rejects.toThrow('Failed to get disk info');
    });

    it('should handle empty output', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Filesystem     Size  Used Avail Use% Mounted on\n',
        stderr: '',
      });

      const result = await getDiskUsage();

      expect(result).toEqual([]);
    });

    it('should skip malformed lines', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout:
          'Filesystem     Size  Used Avail Use% Mounted on\n' +
          'invalid line\n' +
          '/dev/sda1      100G  50G   50G  50% /\n',
        stderr: '',
      });

      const result = await getDiskUsage();

      expect(result).toHaveLength(1);
    });
  });

  describe('getUptimeInfo', () => {
    it('should parse uptime output correctly', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: ' 10:30:00 up 5 days, 3:21, 2 users, load average: 0.15, 0.10, 0.05\n',
        stderr: '',
      });

      const result = await getUptimeInfo();

      expect(result.uptime).toBe('5 days, 3:21');
      expect(result.loadAverage).toEqual([0.15, 0.1, 0.05]);
    });

    it('should parse uptime with hours only', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: ' 14:22:01 up  3:45,  1 user,  load average: 0.00, 0.01, 0.05\n',
        stderr: '',
      });

      const result = await getUptimeInfo();

      expect(result.uptime).toBe('3:45');
      expect(result.loadAverage).toEqual([0.0, 0.01, 0.05]);
    });

    it('should throw on command failure with error message', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'uptime: command not found',
      });

      await expect(getUptimeInfo()).rejects.toThrow('Failed to get uptime');
    });

    it('should throw on command failure with empty stderr', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 127,
        stdout: '',
        stderr: '', // Empty - simulates binary not found
      });

      await expect(getUptimeInfo()).rejects.toThrow('Failed to get uptime');
    });

    it('should handle missing uptime pattern gracefully', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'malformed output that lacks the expected pattern',
        stderr: '',
      });

      const result = await getUptimeInfo();

      expect(result.uptime).toBe('unknown');
    });

    it('should handle missing load average gracefully', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: ' 10:30:00 up 5 days, 3:21, 2 users\n',
        stderr: '',
      });

      const result = await getUptimeInfo();

      expect(result.loadAverage).toEqual([0, 0, 0]);
    });
  });

  describe('getCpuInfo', () => {
    it('should parse CPU info correctly', async () => {
      // Mock for /proc/cpuinfo
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout:
          'processor	: 0\n' +
          'model name	: Intel(R) Core(TM) i7-8700 CPU @ 3.20GHz\n' +
          'processor	: 1\n' +
          'model name	: Intel(R) Core(TM) i7-8700 CPU @ 3.20GHz\n' +
          'processor	: 2\n' +
          'model name	: Intel(R) Core(TM) i7-8700 CPU @ 3.20GHz\n' +
          'processor	: 3\n' +
          'model name	: Intel(R) Core(TM) i7-8700 CPU @ 3.20GHz\n',
        stderr: '',
      });

      // Mock for /proc/stat
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'cpu  1000 100 200 5000 50 10 5 0 0 0\n',
        stderr: '',
      });

      const result = await getCpuInfo();

      expect(result.cores).toBe(4);
      expect(result.model).toContain('Intel');
      expect(result.usagePercent).toBeGreaterThanOrEqual(0);
      expect(result.usagePercent).toBeLessThanOrEqual(100);
    });

    it('should handle missing cpuinfo gracefully', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'file not found',
      });

      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'cpu  1000 100 200 5000 50 10 5 0 0 0\n',
        stderr: '',
      });

      const result = await getCpuInfo();

      expect(result.cores).toBe(1); // Default
      expect(result.model).toBe('Unknown');
    });
  });

  describe('getProcessInfo', () => {
    it('should parse process info correctly', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout:
          'STAT\n' +
          'Ss\n' +
          'R+\n' +
          'S\n' +
          'S\n' +
          'Z\n' +
          'I<\n',
        stderr: '',
      });

      const result = await getProcessInfo();

      expect(result.total).toBe(6);
      expect(result.running).toBe(1);
      expect(result.sleeping).toBe(4); // Ss, S, S, I<
      expect(result.zombie).toBe(1);
    });

    it('should handle command failure gracefully', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'ps: command not found',
      });

      const result = await getProcessInfo();

      expect(result.total).toBe(0);
      expect(result.running).toBe(0);
    });
  });

  describe('getSystemResources', () => {
    it('should combine all system info', async () => {
      // Use mockImplementation to handle parallel calls based on arguments
      mockExecuteCommand.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'cat' && args[0] === '/proc/cpuinfo') {
          return Promise.resolve({
            exitCode: 0,
            stdout:
              'processor	: 0\n' +
              'model name	: Intel(R) Core(TM) i7-8700 CPU @ 3.20GHz\n' +
              'processor	: 1\n' +
              'model name	: Intel(R) Core(TM) i7-8700 CPU @ 3.20GHz\n',
            stderr: '',
          });
        }
        if (cmd === 'cat' && args[0] === '/proc/stat') {
          return Promise.resolve({
            exitCode: 0,
            stdout: 'cpu  1000 100 200 5000 50 10 5 0 0 0\n',
            stderr: '',
          });
        }
        if (cmd === 'free') {
          return Promise.resolve({
            exitCode: 0,
            stdout:
              '              total        used        free      shared  buff/cache   available\n' +
              'Mem:          16384        8192        2048         512        6144       12288\n' +
              'Swap:          4096        1024        3072\n',
            stderr: '',
          });
        }
        if (cmd === 'ps') {
          return Promise.resolve({
            exitCode: 0,
            stdout: 'STAT\nSs\nR+\nS\n',
            stderr: '',
          });
        }
        if (cmd === 'uptime') {
          return Promise.resolve({
            exitCode: 0,
            stdout: ' 10:30:00 up 5 days, 3:21, 2 users, load average: 0.15, 0.10, 0.05\n',
            stderr: '',
          });
        }
        return Promise.resolve({ exitCode: 1, stdout: '', stderr: 'unknown command' });
      });

      const result = await getSystemResources();

      expect(result.cpu.cores).toBe(2);
      expect(result.memory.total).toBe(16384);
      expect(result.memory.bufferCache).toBe(6144);
      expect(result.swap.total).toBe(4096);
      expect(result.processes.total).toBe(3);
      expect(result.uptime).toBe('5 days, 3:21');
      expect(result.uptimeSeconds).toBe(444060); // 5 days + 3 hours + 21 min
      expect(result.loadAverage).toEqual([0.15, 0.1, 0.05]);
    });
  });
});

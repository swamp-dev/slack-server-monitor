import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getMemoryInfo,
  getSwapInfo,
  getDiskUsage,
  getUptimeInfo,
  getSystemResources,
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

  describe('getSystemResources', () => {
    it('should combine memory, swap, and uptime info', async () => {
      // Mock for getMemoryInfo (free -m)
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout:
          '              total        used        free      shared  buff/cache   available\n' +
          'Mem:          16384        8192        2048         512        6144       12288\n' +
          'Swap:          4096        1024        3072\n',
        stderr: '',
      });

      // Mock for getSwapInfo (free -m)
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout:
          '              total        used        free      shared  buff/cache   available\n' +
          'Mem:          16384        8192        2048         512        6144       12288\n' +
          'Swap:          4096        1024        3072\n',
        stderr: '',
      });

      // Mock for getUptimeInfo
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: ' 10:30:00 up 5 days, 3:21, 2 users, load average: 0.15, 0.10, 0.05\n',
        stderr: '',
      });

      const result = await getSystemResources();

      expect(result.memory.total).toBe(16384);
      expect(result.swap.total).toBe(4096);
      expect(result.uptime).toBe('5 days, 3:21');
      expect(result.loadAverage).toEqual([0.15, 0.1, 0.05]);
    });

    it('should propagate memory command failure', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: '',
      });

      await expect(getSystemResources()).rejects.toThrow('Failed to get memory info');
    });

    it('should propagate uptime command failure', async () => {
      // Mock for getMemoryInfo (success)
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout:
          '              total        used        free      shared  buff/cache   available\n' +
          'Mem:          16384        8192        2048         512        6144       12288\n' +
          'Swap:          4096        1024        3072\n',
        stderr: '',
      });

      // Mock for getSwapInfo (success)
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout:
          '              total        used        free      shared  buff/cache   available\n' +
          'Mem:          16384        8192        2048         512        6144       12288\n' +
          'Swap:          4096        1024        3072\n',
        stderr: '',
      });

      // Mock for getUptimeInfo (failure)
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: '',
      });

      await expect(getSystemResources()).rejects.toThrow('Failed to get uptime');
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getMemoryInfo,
  getSwapInfo,
  getDiskUsage,
  getUptimeInfo,
  getSystemResources,
  getCpuInfo,
  getProcessInfo,
  formatUptimeString,
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
    it('should parse uptime and load average correctly', async () => {
      // First call: cat /proc/uptime
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: '444060.50 123456.78\n', // 5 days + 3 hours + 21 min
        stderr: '',
      });
      // Second call: uptime (for load average)
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: ' 10:30:00 up 5 days, 3:21, 2 users, load average: 0.15, 0.10, 0.05\n',
        stderr: '',
      });

      const result = await getUptimeInfo();

      expect(result.uptime).toBe('5d 3h 21m');
      expect(result.uptimeSeconds).toBe(444060);
      expect(result.loadAverage).toEqual([0.15, 0.1, 0.05]);
    });

    it('should format short uptime correctly', async () => {
      // 3 hours + 45 minutes = 13500 seconds
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: '13500.00 5000.00\n',
        stderr: '',
      });
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: ' 14:22:01 up  3:45,  1 user,  load average: 0.00, 0.01, 0.05\n',
        stderr: '',
      });

      const result = await getUptimeInfo();

      expect(result.uptime).toBe('3h 45m');
      expect(result.uptimeSeconds).toBe(13500);
      expect(result.loadAverage).toEqual([0.0, 0.01, 0.05]);
    });

    it('should throw when uptime command fails', async () => {
      // /proc/uptime succeeds
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: '444060.50 123456.78\n',
        stderr: '',
      });
      // uptime command fails
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'uptime: command not found',
      });

      await expect(getUptimeInfo()).rejects.toThrow('Failed to get uptime');
    });

    it('should throw on uptime command failure with empty stderr', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: '444060.50 123456.78\n',
        stderr: '',
      });
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 127,
        stdout: '',
        stderr: '', // Empty - simulates binary not found
      });

      await expect(getUptimeInfo()).rejects.toThrow('Failed to get uptime');
    });

    it('should handle /proc/uptime failure gracefully', async () => {
      // /proc/uptime fails
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'No such file',
      });
      // uptime command succeeds with load average
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: ' 10:30:00 up 5 days, 3:21, 2 users, load average: 0.15, 0.10, 0.05\n',
        stderr: '',
      });

      const result = await getUptimeInfo();

      expect(result.uptime).toBe('unknown'); // formatUptimeString(0)
      expect(result.uptimeSeconds).toBe(0);
      expect(result.loadAverage).toEqual([0.15, 0.1, 0.05]);
    });

    it('should handle missing load average gracefully', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: '444060.50 123456.78\n',
        stderr: '',
      });
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: ' 10:30:00 up 5 days, 3:21, 2 users\n', // No load average
        stderr: '',
      });

      const result = await getUptimeInfo();

      expect(result.loadAverage).toEqual([0, 0, 0]);
    });
  });

  describe('getCpuInfo', () => {
    it('should parse CPU info correctly', async () => {
      // Mock for /proc/cpuinfo (only file read by getCpuInfo)
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout:
          'processor\t: 0\n' +
          'model name\t: Intel(R) Core(TM) i7-8700 CPU @ 3.20GHz\n' +
          'processor\t: 1\n' +
          'model name\t: Intel(R) Core(TM) i7-8700 CPU @ 3.20GHz\n' +
          'processor\t: 2\n' +
          'model name\t: Intel(R) Core(TM) i7-8700 CPU @ 3.20GHz\n' +
          'processor\t: 3\n' +
          'model name\t: Intel(R) Core(TM) i7-8700 CPU @ 3.20GHz\n',
        stderr: '',
      });

      const result = await getCpuInfo();

      expect(result.cores).toBe(4);
      expect(result.model).toContain('Intel');
    });

    it('should handle missing cpuinfo gracefully', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'file not found',
      });

      const result = await getCpuInfo();

      expect(result.cores).toBe(1); // Default
      expect(result.model).toBe('Unknown');
    });
  });

  describe('getProcessInfo', () => {
    it('should use /proc/loadavg for host-level process counts', async () => {
      // /proc/loadavg format: "load1 load5 load15 running/total lastPid"
      mockExecuteCommand.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'cat' && args[0] === '/proc/loadavg') {
          return Promise.resolve({
            exitCode: 0,
            stdout: '1.50 1.20 1.00 5/350 12345\n',
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
        return Promise.resolve({ exitCode: 1, stdout: '', stderr: '' });
      });

      const result = await getProcessInfo();

      expect(result.total).toBe(350);
      expect(result.running).toBe(5);
    });

    it('should detect zombies from ps even when using /proc/loadavg', async () => {
      mockExecuteCommand.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'cat' && args[0] === '/proc/loadavg') {
          return Promise.resolve({
            exitCode: 0,
            stdout: '0.50 0.40 0.30 2/150 9999\n',
            stderr: '',
          });
        }
        if (cmd === 'ps') {
          return Promise.resolve({
            exitCode: 0,
            stdout: 'STAT\nSs\nR+\nS\nZ\nZ+\n',
            stderr: '',
          });
        }
        return Promise.resolve({ exitCode: 1, stdout: '', stderr: '' });
      });

      const result = await getProcessInfo();

      expect(result.total).toBe(150);
      expect(result.running).toBe(2);
      expect(result.zombie).toBe(2);
    });

    it('should fall back to ps when /proc/loadavg fails', async () => {
      mockExecuteCommand.mockImplementation((cmd: string) => {
        if (cmd === 'cat') {
          return Promise.resolve({
            exitCode: 1,
            stdout: '',
            stderr: 'No such file',
          });
        }
        if (cmd === 'ps') {
          return Promise.resolve({
            exitCode: 0,
            stdout: 'STAT\nSs\nR+\nS\nS\nZ\nI<\n',
            stderr: '',
          });
        }
        return Promise.resolve({ exitCode: 1, stdout: '', stderr: '' });
      });

      const result = await getProcessInfo();

      expect(result.total).toBe(6);
      expect(result.running).toBe(1);
      expect(result.sleeping).toBe(4);
      expect(result.zombie).toBe(1);
    });

    it('should handle both commands failing gracefully', async () => {
      mockExecuteCommand.mockResolvedValue({
        exitCode: 1,
        stdout: '',
        stderr: 'command not found',
      });

      const result = await getProcessInfo();

      expect(result.total).toBe(0);
      expect(result.running).toBe(0);
      expect(result.zombie).toBe(0);
    });

    it('should handle malformed /proc/loadavg output', async () => {
      mockExecuteCommand.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'cat' && args[0] === '/proc/loadavg') {
          return Promise.resolve({
            exitCode: 0,
            stdout: 'garbage data\n',
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
        return Promise.resolve({ exitCode: 1, stdout: '', stderr: '' });
      });

      const result = await getProcessInfo();

      // Should fall back to ps
      expect(result.total).toBe(3);
      expect(result.running).toBe(1);
    });
  });

  describe('formatUptimeString', () => {
    it('should format days, hours, and minutes', () => {
      // 5 days, 3 hours, 21 minutes = 444060 seconds
      expect(formatUptimeString(444060)).toBe('5d 3h 21m');
    });

    it('should format hours and minutes only', () => {
      // 3 hours, 45 minutes = 13500 seconds
      expect(formatUptimeString(13500)).toBe('3h 45m');
    });

    it('should format minutes only', () => {
      // 25 minutes = 1500 seconds
      expect(formatUptimeString(1500)).toBe('25m');
    });

    it('should format seconds when less than a minute', () => {
      expect(formatUptimeString(45)).toBe('45s');
    });

    it('should return unknown for zero seconds', () => {
      expect(formatUptimeString(0)).toBe('unknown');
    });

    it('should return unknown for negative seconds', () => {
      expect(formatUptimeString(-100)).toBe('unknown');
    });

    it('should handle exactly one day', () => {
      expect(formatUptimeString(86400)).toBe('1d');
    });

    it('should handle exactly one hour', () => {
      expect(formatUptimeString(3600)).toBe('1h');
    });

    it('should handle days and minutes without hours', () => {
      // 2 days, 0 hours, 30 minutes = 172800 + 1800 = 174600
      expect(formatUptimeString(174600)).toBe('2d 30m');
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
        if (cmd === 'cat' && args[0] === '/proc/uptime') {
          // Format: "uptime_seconds.centiseconds idle_seconds"
          // 444060 = 5 days + 3 hours + 21 minutes
          return Promise.resolve({
            exitCode: 0,
            stdout: '444060.50 123456.78\n',
            stderr: '',
          });
        }
        if (cmd === 'cat' && args[0] === '/proc/loadavg') {
          return Promise.resolve({
            exitCode: 0,
            stdout: '0.15 0.10 0.05 3/250 54321\n',
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
      expect(result.processes.total).toBe(250); // From /proc/loadavg (host-level)
      expect(result.processes.running).toBe(3); // From /proc/loadavg
      expect(result.uptime).toBe('5d 3h 21m'); // Now formatted by formatUptimeString
      expect(result.uptimeSeconds).toBe(444060); // 5 days + 3 hours + 21 min
      expect(result.loadAverage).toEqual([0.15, 0.1, 0.05]);
    });
  });
});

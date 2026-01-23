import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getPm2ProcessList,
  isPm2Available,
} from '../../src/executors/pm2.js';

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

describe('pm2 executor', () => {
  let mockExecuteCommand: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const shell = await import('../../src/utils/shell.js');
    mockExecuteCommand = shell.executeCommand as ReturnType<typeof vi.fn>;
  });

  describe('getPm2ProcessList', () => {
    const mockPm2Output = [
      {
        name: 'api-server',
        pm_id: 0,
        monit: {
          memory: 52428800, // 50MB
          cpu: 2.5,
        },
        pm2_env: {
          status: 'online',
          pm_uptime: 1718409600000, // Jun 15 2024 00:00:00 UTC
          restart_time: 3,
          exec_mode: 'cluster',
          instances: 4,
          node_version: '20.10.0',
        },
      },
      {
        name: 'worker',
        pm_id: 1,
        monit: {
          memory: 104857600, // 100MB
          cpu: 15.3,
        },
        pm2_env: {
          status: 'online',
          pm_uptime: 1718323200000, // Jun 14 2024 00:00:00 UTC
          restart_time: 0,
          exec_mode: 'fork',
          instances: 1,
          node_version: '20.10.0',
        },
      },
      {
        name: 'cron-job',
        pm_id: 2,
        monit: {
          memory: 0,
          cpu: 0,
        },
        pm2_env: {
          status: 'stopped',
          pm_uptime: 0,
          restart_time: 12,
          exec_mode: 'fork',
          instances: 1,
          node_version: '20.10.0',
        },
      },
    ];

    it('should parse pm2 jlist output', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify(mockPm2Output),
        stderr: '',
      });

      const result = await getPm2ProcessList();

      expect(result).toHaveLength(3);

      expect(result[0]).toEqual({
        name: 'api-server',
        pmId: 0,
        status: 'online',
        memory: 52428800,
        cpu: 2.5,
        uptime: 1718409600000,
        restarts: 3,
        mode: 'cluster',
        instances: 4,
      });

      expect(result[1]).toEqual({
        name: 'worker',
        pmId: 1,
        status: 'online',
        memory: 104857600,
        cpu: 15.3,
        uptime: 1718323200000,
        restarts: 0,
        mode: 'fork',
        instances: 1,
      });

      expect(result[2].status).toBe('stopped');
      expect(result[2].memory).toBe(0);
    });

    it('should handle empty process list', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: '[]',
        stderr: '',
      });

      const result = await getPm2ProcessList();

      expect(result).toEqual([]);
    });

    it('should handle pm2 not running (no daemon)', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: '[]',
        stderr: '[PM2] Spawning PM2 daemon with pm2_home=/root/.pm2',
      });

      const result = await getPm2ProcessList();

      expect(result).toEqual([]);
    });

    it('should throw on invalid JSON', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'not valid json',
        stderr: '',
      });

      await expect(getPm2ProcessList()).rejects.toThrow('Failed to parse PM2 output');
    });

    it('should throw on pm2 error', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: '[PM2][ERROR] Process not found',
      });

      await expect(getPm2ProcessList()).rejects.toThrow('Failed to get PM2 process list');
    });

    it('should handle missing optional fields gracefully', async () => {
      const minimalOutput = [
        {
          name: 'minimal-app',
          pm_id: 0,
          monit: {},
          pm2_env: {
            status: 'online',
          },
        },
      ];

      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify(minimalOutput),
        stderr: '',
      });

      const result = await getPm2ProcessList();

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('minimal-app');
      expect(result[0].memory).toBe(0);
      expect(result[0].cpu).toBe(0);
      expect(result[0].uptime).toBe(0);
      expect(result[0].restarts).toBe(0);
      expect(result[0].mode).toBe('fork');
      expect(result[0].instances).toBe(1);
    });

    it('should handle errored status', async () => {
      const erroredOutput = [
        {
          name: 'crashed-app',
          pm_id: 0,
          monit: {
            memory: 0,
            cpu: 0,
          },
          pm2_env: {
            status: 'errored',
            pm_uptime: 0,
            restart_time: 100,
            exec_mode: 'fork',
            instances: 1,
          },
        },
      ];

      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify(erroredOutput),
        stderr: '',
      });

      const result = await getPm2ProcessList();

      expect(result[0].status).toBe('errored');
      expect(result[0].restarts).toBe(100);
    });

    it('should fall back to stopped for unknown status values', async () => {
      const unknownStatusOutput = [
        {
          name: 'weird-app',
          pm_id: 0,
          monit: {
            memory: 1000,
            cpu: 1.0,
          },
          pm2_env: {
            status: 'unknown_status', // Invalid status
            pm_uptime: 1000,
            restart_time: 0,
            exec_mode: 'fork',
            instances: 1,
          },
        },
      ];

      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify(unknownStatusOutput),
        stderr: '',
      });

      const result = await getPm2ProcessList();

      expect(result[0].status).toBe('stopped');
    });

    it('should fall back to stopped for null/undefined status', async () => {
      const nullStatusOutput = [
        {
          name: 'null-status-app',
          pm_id: 0,
          monit: {},
          pm2_env: {
            status: null,
          },
        },
      ];

      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify(nullStatusOutput),
        stderr: '',
      });

      const result = await getPm2ProcessList();

      expect(result[0].status).toBe('stopped');
    });

    it('should fall back to stopped for missing pm2_env', async () => {
      const noEnvOutput = [
        {
          name: 'no-env-app',
          pm_id: 0,
          monit: {},
        },
      ];

      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify(noEnvOutput),
        stderr: '',
      });

      const result = await getPm2ProcessList();

      expect(result[0].status).toBe('stopped');
    });

    it('should handle all valid PM2 status values', async () => {
      const validStatuses = ['online', 'stopped', 'errored', 'stopping', 'launching', 'one-launch-status'];

      for (const status of validStatuses) {
        const output = [
          {
            name: `app-${status}`,
            pm_id: 0,
            monit: {},
            pm2_env: { status },
          },
        ];

        mockExecuteCommand.mockResolvedValueOnce({
          exitCode: 0,
          stdout: JSON.stringify(output),
          stderr: '',
        });

        const result = await getPm2ProcessList();
        expect(result[0].status).toBe(status);
      }
    });
  });

  describe('isPm2Available', () => {
    it('should return true when pm2 works', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: '[]',
        stderr: '',
      });

      const result = await isPm2Available();

      expect(result).toBe(true);
    });

    it('should return false when pm2 command fails', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'pm2: command not found',
      });

      const result = await isPm2Available();

      expect(result).toBe(false);
    });

    it('should return false when command throws', async () => {
      mockExecuteCommand.mockRejectedValueOnce(new Error('Command not found'));

      const result = await isPm2Available();

      expect(result).toBe(false);
    });
  });
});

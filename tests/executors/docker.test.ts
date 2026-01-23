import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getContainerStatus,
  getContainerDetails,
  getContainerLogs,
  getNetworkList,
  getDockerVersion,
  isDockerAvailable,
} from '../../src/executors/docker.js';

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

describe('docker executor', () => {
  let mockExecuteCommand: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const shell = await import('../../src/utils/shell.js');
    mockExecuteCommand = shell.executeCommand as ReturnType<typeof vi.fn>;
  });

  describe('getContainerStatus', () => {
    it('should parse docker ps output', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'abc123\tnginx\tnginx:latest\tUp 2 hours\trunning\t80/tcp\t2024-01-01 10:00:00\n' +
                'def456\tredis\tredis:7\tExited (0) 1 hour ago\texited\t\t2024-01-01 09:00:00\n',
        stderr: '',
      });

      const result = await getContainerStatus();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 'abc123',
        name: 'nginx',
        image: 'nginx:latest',
        status: 'Up 2 hours',
        state: 'running',
        ports: '80/tcp',
        created: '2024-01-01 10:00:00',
      });
      expect(result[1]).toEqual({
        id: 'def456',
        name: 'redis',
        image: 'redis:7',
        status: 'Exited (0) 1 hour ago',
        state: 'exited',
        ports: '',
        created: '2024-01-01 09:00:00',
      });
    });

    it('should filter by prefix', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'abc123\tapp-nginx\tnginx:latest\tUp\trunning\t80/tcp\t2024-01-01\n' +
                'def456\tdb-redis\tredis:7\tUp\trunning\t\t2024-01-01\n' +
                'ghi789\tapp-backend\tnode:18\tUp\trunning\t3000/tcp\t2024-01-01\n',
        stderr: '',
      });

      const result = await getContainerStatus('app');

      expect(result).toHaveLength(2);
      expect(result.map((c) => c.name)).toEqual(['app-nginx', 'app-backend']);
    });

    it('should filter by prefix case-insensitively', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'abc123\tAPP-nginx\tnginx:latest\tUp\trunning\t80/tcp\t2024-01-01\n',
        stderr: '',
      });

      const result = await getContainerStatus('app');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('APP-nginx');
    });

    it('should handle empty output', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: '',
        stderr: '',
      });

      const result = await getContainerStatus();

      expect(result).toEqual([]);
    });

    it('should throw on docker error', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'Cannot connect to Docker daemon',
      });

      await expect(getContainerStatus()).rejects.toThrow('Failed to get container status');
    });

    it('should skip malformed lines', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'abc123\tnginx\tnginx:latest\tUp\trunning\t80/tcp\t2024-01-01\n' +
                'invalid line without tabs\n' +
                'def456\tredis\tredis:7\tUp\trunning\t\t2024-01-01\n',
        stderr: '',
      });

      const result = await getContainerStatus();

      expect(result).toHaveLength(2);
    });
  });

  describe('getContainerDetails', () => {
    const mockInspectOutput = [
      {
        Id: 'abc123456789',
        Name: '/nginx',
        Config: {
          Image: 'nginx:latest',
        },
        State: {
          Status: 'running',
          Running: true,
          StartedAt: '2024-01-01T10:00:00.000Z',
          FinishedAt: '0001-01-01T00:00:00Z',
          RestartCount: 0,
        },
        Platform: 'linux',
        Mounts: [
          {
            Source: '/var/www',
            Destination: '/usr/share/nginx/html',
            Mode: 'ro',
          },
        ],
        NetworkSettings: {
          Networks: {
            bridge: {},
            custom_network: {},
          },
        },
        HostConfig: {
          PortBindings: {
            '80/tcp': [{ HostPort: '8080' }],
            '443/tcp': [{ HostPort: '8443' }],
          },
        },
      },
    ];

    it('should parse docker inspect JSON', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify(mockInspectOutput),
        stderr: '',
      });

      const result = await getContainerDetails('nginx');

      expect(result.id).toBe('abc123456789');
      expect(result.name).toBe('nginx');
      expect(result.image).toBe('nginx:latest');
      expect(result.state.status).toBe('running');
      expect(result.state.running).toBe(true);
    });

    it('should extract ports', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify(mockInspectOutput),
        stderr: '',
      });

      const result = await getContainerDetails('nginx');

      expect(result.ports).toEqual({
        '80/tcp': '8080',
        '443/tcp': '8443',
      });
    });

    it('should extract mounts', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify(mockInspectOutput),
        stderr: '',
      });

      const result = await getContainerDetails('nginx');

      expect(result.mounts).toEqual([
        {
          source: '/var/www',
          destination: '/usr/share/nginx/html',
          mode: 'ro',
        },
      ]);
    });

    it('should extract networks', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify(mockInspectOutput),
        stderr: '',
      });

      const result = await getContainerDetails('nginx');

      expect(result.networks).toEqual(['bridge', 'custom_network']);
    });

    it('should throw on container not found', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'Error: No such object: nonexistent',
      });

      await expect(getContainerDetails('nonexistent')).rejects.toThrow('Container not found');
    });

    it('should throw on invalid JSON', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'not valid json',
        stderr: '',
      });

      await expect(getContainerDetails('nginx')).rejects.toThrow('Failed to parse container details');
    });

    it('should throw on empty array response', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: '[]',
        stderr: '',
      });

      await expect(getContainerDetails('nginx')).rejects.toThrow('Invalid inspect response');
    });

    it('should handle missing optional fields', async () => {
      const minimalInspect = [
        {
          Id: 'abc123',
          Name: '/test',
          State: {},
          Config: {},
          HostConfig: {},
          NetworkSettings: {},
        },
      ];

      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify(minimalInspect),
        stderr: '',
      });

      const result = await getContainerDetails('test');

      expect(result.id).toBe('abc123');
      expect(result.name).toBe('test');
      expect(result.ports).toEqual({});
      expect(result.mounts).toEqual([]);
      expect(result.networks).toEqual([]);
    });
  });

  describe('getContainerLogs', () => {
    it('should return combined stdout and stderr', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: '2024-01-01T10:00:00.000Z Log line 1\n',
        stderr: '2024-01-01T10:00:01.000Z Error line\n',
      });

      const result = await getContainerLogs('nginx', 50);

      expect(result).toContain('Log line 1');
      expect(result).toContain('Error line');
    });

    it('should pass correct arguments', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'logs',
        stderr: '',
      });

      await getContainerLogs('mycontainer', 100);

      expect(mockExecuteCommand).toHaveBeenCalledWith('docker', [
        'logs',
        '--tail',
        '100',
        '--timestamps',
        'mycontainer',
      ]);
    });

    it('should throw when no output and exit code non-zero', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: '',
      });

      await expect(getContainerLogs('nonexistent', 50)).rejects.toThrow('Failed to get logs');
    });

    it('should return stderr as output when exit code is non-zero', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'No such container',
      });

      const result = await getContainerLogs('nonexistent', 50);
      expect(result).toBe('No such container');
    });

    it('should return output even with non-zero exit code if output exists', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 1,
        stdout: 'partial logs',
        stderr: 'some warning',
      });

      const result = await getContainerLogs('container', 50);

      expect(result).toContain('partial logs');
    });
  });

  describe('getNetworkList', () => {
    it('should parse network ls output', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'abc123\tbridge\tbridge\tlocal\n' +
                'def456\thost\thost\tlocal\n' +
                'ghi789\tcustom_net\toverlay\tswarm\n',
        stderr: '',
      });

      const result = await getNetworkList();

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({
        id: 'abc123',
        name: 'bridge',
        driver: 'bridge',
        scope: 'local',
      });
      expect(result[2]).toEqual({
        id: 'ghi789',
        name: 'custom_net',
        driver: 'overlay',
        scope: 'swarm',
      });
    });

    it('should throw on error', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'Permission denied',
      });

      await expect(getNetworkList()).rejects.toThrow('Failed to list networks');
    });
  });

  describe('getDockerVersion', () => {
    it('should return version string', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: '24.0.7\n',
        stderr: '',
      });

      const result = await getDockerVersion();

      expect(result).toBe('24.0.7');
    });
  });

  describe('isDockerAvailable', () => {
    it('should return true when docker info succeeds', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Docker info output',
        stderr: '',
      });

      const result = await isDockerAvailable();

      expect(result).toBe(true);
    });

    it('should return false when docker info fails', async () => {
      mockExecuteCommand.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'Cannot connect to Docker daemon',
      });

      const result = await isDockerAvailable();

      expect(result).toBe(false);
    });

    it('should return false when command throws', async () => {
      mockExecuteCommand.mockRejectedValueOnce(new Error('Command not found'));

      const result = await isDockerAvailable();

      expect(result).toBe(false);
    });
  });
});

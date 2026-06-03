import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ToolConfig } from '../../../src/services/tools/types.js';

// Default test config
const defaultConfig: ToolConfig = {
  maxLogLines: 500,
  maxFileSizeKb: 1024,
  allowedDirs: [],
};

// Mock dependencies
vi.mock('../../../src/executors/docker.js', () => ({
  getContainerStatus: vi.fn(),
  getContainerDetails: vi.fn(),
  getContainerLogs: vi.fn(),
  getNetworkList: vi.fn(),
}));

vi.mock('../../../src/executors/system.js', () => ({
  getSystemResources: vi.fn(),
  getDiskUsage: vi.fn(),
}));

vi.mock('../../../src/formatters/scrub.js', () => ({
  scrubSensitiveData: vi.fn((data: string) => data),
}));

vi.mock('../../../src/utils/shell.js', () => ({
  executeCommand: vi.fn(),
  getAllowedCommands: vi.fn(() => ['docker', 'ps', 'systemctl', 'journalctl']),
}));

// Import after mocks
const {
  containerStatusTool,
  containerLogsTool,
  searchContainerLogsTool,
  systemResourcesTool,
  diskUsageTool,
  networkInfoTool,
  dockerImagesTool,
  runCommandTool,
  serverTools,
} = await import('../../../src/services/tools/server-tools.js');
const { getContainerStatus, getContainerDetails, getContainerLogs, getNetworkList } =
  await import('../../../src/executors/docker.js');
const { getSystemResources, getDiskUsage } = await import('../../../src/executors/system.js');
const { scrubSensitiveData } = await import('../../../src/formatters/scrub.js');
const { executeCommand } = await import('../../../src/utils/shell.js');

describe('serverTools', () => {
  it('should export all tools', () => {
    expect(serverTools).toHaveLength(8);
    expect(serverTools).toContain(containerStatusTool);
    expect(serverTools).toContain(containerLogsTool);
    expect(serverTools).toContain(searchContainerLogsTool);
    expect(serverTools).toContain(systemResourcesTool);
    expect(serverTools).toContain(diskUsageTool);
    expect(serverTools).toContain(networkInfoTool);
    expect(serverTools).toContain(dockerImagesTool);
    expect(serverTools).toContain(runCommandTool);
  });
});

describe('containerStatusTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('spec', () => {
    it('should have correct name and description', () => {
      expect(containerStatusTool.spec.name).toBe('get_container_status');
      expect(containerStatusTool.spec.description).toContain('Docker containers');
    });

    it('should have optional container_name property', () => {
      expect(containerStatusTool.spec.input_schema.properties).toHaveProperty('container_name');
      expect(containerStatusTool.spec.input_schema.required).toBeUndefined();
    });
  });

  describe('execute', () => {
    it('should list all containers when no container_name provided', async () => {
      const mockContainers = [
        { name: 'nginx', image: 'nginx:latest', state: 'running', status: 'Up 2 hours', ports: '80/tcp' },
        { name: 'redis', image: 'redis:7', state: 'exited', status: 'Exited (0)', ports: '' },
      ];

      (getContainerStatus as ReturnType<typeof vi.fn>).mockResolvedValue(mockContainers);

      const result = await containerStatusTool.execute({}, defaultConfig);

      expect(getContainerStatus).toHaveBeenCalled();
      expect(getContainerDetails).not.toHaveBeenCalled();

      const parsed = JSON.parse(result);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].name).toBe('nginx');
    });

    it('should get details for specific container', async () => {
      const mockDetails = {
        name: 'nginx',
        image: 'nginx:latest',
        state: { status: 'running', running: true },
        restartCount: 0,
        networks: ['bridge'],
        ports: { '80/tcp': '8080' },
        mounts: [{ source: '/host', destination: '/container', mode: 'ro' }],
      };

      (getContainerDetails as ReturnType<typeof vi.fn>).mockResolvedValue(mockDetails);

      const result = await containerStatusTool.execute({ container_name: 'nginx' }, defaultConfig);

      expect(getContainerDetails).toHaveBeenCalledWith('nginx');
      expect(getContainerStatus).not.toHaveBeenCalled();

      const parsed = JSON.parse(result);
      expect(parsed.name).toBe('nginx');
      expect(parsed.mounts).toHaveLength(1);
    });

    it('should handle errors gracefully', async () => {
      (getContainerStatus as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Docker not running')
      );

      const result = await containerStatusTool.execute({}, defaultConfig);

      expect(result).toContain('Error');
      expect(result).toContain('Docker not running');
    });
  });
});

describe('containerLogsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('spec', () => {
    it('should have correct name and description', () => {
      expect(containerLogsTool.spec.name).toBe('get_container_logs');
      expect(containerLogsTool.spec.description).toContain('logs');
      expect(containerLogsTool.spec.description).toContain('scrubbed');
    });

    it('should require container_name', () => {
      expect(containerLogsTool.spec.input_schema.required).toContain('container_name');
    });
  });

  describe('execute', () => {
    it('should get logs and scrub sensitive data', async () => {
      (getContainerLogs as ReturnType<typeof vi.fn>).mockResolvedValue(
        '2024-01-01 Log output'
      );
      (scrubSensitiveData as ReturnType<typeof vi.fn>).mockReturnValue(
        '2024-01-01 Log output'
      );

      const result = await containerLogsTool.execute(
        { container_name: 'nginx', lines: 100 },
        defaultConfig
      );

      expect(getContainerLogs).toHaveBeenCalledWith('nginx', 100);
      expect(scrubSensitiveData).toHaveBeenCalled();
      expect(result).toContain('Log output');
    });

    it('should use default of 50 lines if not specified', async () => {
      (getContainerLogs as ReturnType<typeof vi.fn>).mockResolvedValue('logs');

      await containerLogsTool.execute({ container_name: 'nginx' }, defaultConfig);

      expect(getContainerLogs).toHaveBeenCalledWith('nginx', 50);
    });

    it('should cap lines to maxLogLines', async () => {
      (getContainerLogs as ReturnType<typeof vi.fn>).mockResolvedValue('logs');

      await containerLogsTool.execute({ container_name: 'nginx', lines: 1000 }, defaultConfig);

      expect(getContainerLogs).toHaveBeenCalledWith('nginx', 500); // Capped to maxLogLines
    });

    it('should return error if container_name is missing', async () => {
      const result = await containerLogsTool.execute({}, defaultConfig);

      expect(result).toContain('Error');
      expect(result).toContain('container_name is required');
    });

    it('should handle errors gracefully', async () => {
      (getContainerLogs as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Container not found')
      );

      const result = await containerLogsTool.execute({ container_name: 'nonexistent' }, defaultConfig);

      expect(result).toContain('Error');
      expect(result).toContain('Container not found');
    });
  });
});

describe('systemResourcesTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('spec', () => {
    it('should have correct name and description', () => {
      expect(systemResourcesTool.spec.name).toBe('get_system_resources');
      expect(systemResourcesTool.spec.description).toContain('CPU');
      expect(systemResourcesTool.spec.description).toContain('memory');
    });

    it('should have no required properties', () => {
      expect(systemResourcesTool.spec.input_schema.properties).toEqual({});
    });
  });

  describe('execute', () => {
    it('should return system resources', async () => {
      const mockResources = {
        memory: { total: 16384, used: 8192, available: 8192, percentUsed: 50, bufferCache: 2048 },
        swap: { total: 8192, used: 1024, percentUsed: 12.5 },
        loadAverage: [1.5, 1.2, 1.0],
        uptime: '5 days',
        uptimeSeconds: 432000,
        cpu: { model: 'Intel', cores: 4 },
        processes: { total: 100, running: 5, zombie: 0 },
      };

      (getSystemResources as ReturnType<typeof vi.fn>).mockResolvedValue(mockResources);

      const result = await systemResourcesTool.execute({}, defaultConfig);

      expect(getSystemResources).toHaveBeenCalled();

      const parsed = JSON.parse(result);
      expect(parsed.memory.totalMB).toBe(16384);
      expect(parsed.loadAverage['1min']).toBe(1.5);
      expect(parsed.uptime).toBe('5 days');
    });

    it('should handle errors gracefully', async () => {
      (getSystemResources as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Permission denied')
      );

      const result = await systemResourcesTool.execute({}, defaultConfig);

      expect(result).toContain('Error');
      expect(result).toContain('Permission denied');
    });
  });
});

describe('diskUsageTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('spec', () => {
    it('should have correct name and description', () => {
      expect(diskUsageTool.spec.name).toBe('get_disk_usage');
      expect(diskUsageTool.spec.description).toContain('disk usage');
    });
  });

  describe('execute', () => {
    it('should return disk usage', async () => {
      const mockMounts = [
        { mountPoint: '/', filesystem: '/dev/sda1', size: '100G', used: '50G', available: '50G', percentUsed: 50 },
        { mountPoint: '/home', filesystem: '/dev/sda2', size: '500G', used: '250G', available: '250G', percentUsed: 50 },
      ];

      (getDiskUsage as ReturnType<typeof vi.fn>).mockResolvedValue(mockMounts);

      const result = await diskUsageTool.execute({}, defaultConfig);

      expect(getDiskUsage).toHaveBeenCalled();

      const parsed = JSON.parse(result);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].mountPoint).toBe('/');
    });

    it('should handle errors gracefully', async () => {
      (getDiskUsage as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Failed to get disk usage')
      );

      const result = await diskUsageTool.execute({}, defaultConfig);

      expect(result).toContain('Error');
      expect(result).toContain('Failed to get disk usage');
    });
  });
});

describe('networkInfoTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('spec', () => {
    it('should have correct name and description', () => {
      expect(networkInfoTool.spec.name).toBe('get_network_info');
      expect(networkInfoTool.spec.description).toContain('Docker networks');
    });
  });

  describe('execute', () => {
    it('should return network list', async () => {
      const mockNetworks = [
        { id: 'abc123', name: 'bridge', driver: 'bridge', scope: 'local' },
        { id: 'def456', name: 'custom_net', driver: 'overlay', scope: 'swarm' },
      ];

      (getNetworkList as ReturnType<typeof vi.fn>).mockResolvedValue(mockNetworks);

      const result = await networkInfoTool.execute({}, defaultConfig);

      expect(getNetworkList).toHaveBeenCalled();

      const parsed = JSON.parse(result);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].name).toBe('bridge');
    });

    it('should handle errors gracefully', async () => {
      (getNetworkList as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Docker not running')
      );

      const result = await networkInfoTool.execute({}, defaultConfig);

      expect(result).toContain('Error');
      expect(result).toContain('Docker not running');
    });
  });
});

describe('runCommandTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('spec', () => {
    it('should have correct name and description', () => {
      expect(runCommandTool.spec.name).toBe('run_command');
      expect(runCommandTool.spec.description).toContain('read-only');
    });

    it('should require command', () => {
      expect(runCommandTool.spec.input_schema.required).toContain('command');
    });
  });

  describe('execute', () => {
    it('should execute command and return scrubbed output', async () => {
      (executeCommand as ReturnType<typeof vi.fn>).mockResolvedValue({
        exitCode: 0,
        stdout: 'command output',
        stderr: '',
      });
      (scrubSensitiveData as ReturnType<typeof vi.fn>).mockReturnValue('command output');

      const result = await runCommandTool.execute({ command: 'ps', args: ['aux'] }, defaultConfig);

      expect(executeCommand).toHaveBeenCalledWith('ps', ['aux']);
      expect(scrubSensitiveData).toHaveBeenCalledWith('command output');
      expect(result).toBe('command output');
    });

    it('should handle empty args', async () => {
      (executeCommand as ReturnType<typeof vi.fn>).mockResolvedValue({
        exitCode: 0,
        stdout: 'output',
        stderr: '',
      });

      await runCommandTool.execute({ command: 'uptime' }, defaultConfig);

      expect(executeCommand).toHaveBeenCalledWith('uptime', []);
    });

    it('should return error if command is missing', async () => {
      const result = await runCommandTool.execute({}, defaultConfig);

      expect(result).toContain('Error');
      expect(result).toContain('command is required');
    });

    it('should include exit code and stderr on non-zero exit', async () => {
      (executeCommand as ReturnType<typeof vi.fn>).mockResolvedValue({
        exitCode: 1,
        stdout: 'partial output',
        stderr: 'error message',
      });
      (scrubSensitiveData as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce('partial output')
        .mockReturnValueOnce('error message');

      const result = await runCommandTool.execute({ command: 'failing-command' }, defaultConfig);

      expect(result).toContain('exited with code 1');
      expect(result).toContain('STDOUT');
      expect(result).toContain('STDERR');
      expect(result).toContain('partial output');
      expect(result).toContain('error message');
    });

    it('should return "(no output)" for empty stdout', async () => {
      (executeCommand as ReturnType<typeof vi.fn>).mockResolvedValue({
        exitCode: 0,
        stdout: '',
        stderr: '',
      });
      (scrubSensitiveData as ReturnType<typeof vi.fn>).mockReturnValue('');

      const result = await runCommandTool.execute({ command: 'quiet-command' }, defaultConfig);

      expect(result).toBe('(no output)');
    });

    it('should handle command not allowed error', async () => {
      (executeCommand as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Command not allowed: rm')
      );

      const result = await runCommandTool.execute({ command: 'rm', args: ['-rf', '/'] }, defaultConfig);

      expect(result).toContain('Error');
      expect(result).toContain('Command not allowed');
    });

    it('should handle sensitive path error', async () => {
      (executeCommand as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Access to sensitive path denied: /etc/shadow')
      );

      const result = await runCommandTool.execute({ command: 'cat', args: ['/etc/shadow'] }, defaultConfig);

      expect(result).toContain('Error');
      expect(result).toContain('sensitive path');
    });
  });
});

describe('searchContainerLogsTool', () => {
  beforeEach(() => {
    vi.mocked(executeCommand).mockReset();
    vi.mocked(scrubSensitiveData).mockImplementation((data: string) => data);
  });

    it('should have correct spec', () => {
      expect(searchContainerLogsTool.spec.name).toBe('search_container_logs');
      expect(searchContainerLogsTool.spec.input_schema.required).toContain('container_name');
      expect(searchContainerLogsTool.spec.input_schema.required).toContain('search_pattern');
    });

    it('should search logs and return matching lines', async () => {
      (executeCommand as ReturnType<typeof vi.fn>).mockResolvedValue({
        stdout: 'line 1: normal\nline 2: ERROR something failed\nline 3: normal\nline 4: ERROR another issue',
        stderr: '',
        exitCode: 0,
      });

      const result = await searchContainerLogsTool.execute(
        { container_name: 'nginx', search_pattern: 'ERROR' },
        defaultConfig
      );

      expect(result).toContain('Found 2 matches');
      expect(result).toContain('ERROR something failed');
      expect(result).toContain('ERROR another issue');
    });

    it('should handle case-insensitive search', async () => {
      (executeCommand as ReturnType<typeof vi.fn>).mockResolvedValue({
        stdout: 'Error: something\nerror: another\nERROR: third',
        stderr: '',
        exitCode: 0,
      });

      const result = await searchContainerLogsTool.execute(
        { container_name: 'nginx', search_pattern: 'error', case_insensitive: true },
        defaultConfig
      );

      expect(result).toContain('Found 3 matches');
    });

    it('should return no matches message when pattern not found', async () => {
      (executeCommand as ReturnType<typeof vi.fn>).mockResolvedValue({
        stdout: 'normal line 1\nnormal line 2',
        stderr: '',
        exitCode: 0,
      });

      const result = await searchContainerLogsTool.execute(
        { container_name: 'nginx', search_pattern: 'FATAL' },
        defaultConfig
      );

      expect(result).toContain('No matches found');
    });

    it('should require container_name', async () => {
      const result = await searchContainerLogsTool.execute(
        { search_pattern: 'error' },
        defaultConfig
      );
      expect(result).toContain('Error: container_name is required');
    });

    it('should require search_pattern', async () => {
      const result = await searchContainerLogsTool.execute(
        { container_name: 'nginx' },
        defaultConfig
      );
      expect(result).toContain('Error: search_pattern is required');
    });

    it('returns no-matches message when stdout and stderr are empty', async () => {
      (executeCommand as ReturnType<typeof vi.fn>).mockResolvedValue({
        stdout: '', stderr: '', exitCode: 0,
      });
      const result = await searchContainerLogsTool.execute(
        { container_name: 'nginx', search_pattern: 'ERROR' },
        defaultConfig
      );
      expect(result).toContain('No logs found');
    });

    it('performs case-sensitive search when case_insensitive is false', async () => {
      (executeCommand as ReturnType<typeof vi.fn>).mockResolvedValue({
        stdout: 'Error: uppercase\nerror: lowercase',
        stderr: '', exitCode: 0,
      });
      const result = await searchContainerLogsTool.execute(
        { container_name: 'nginx', search_pattern: 'Error', case_insensitive: false },
        defaultConfig
      );
      expect(result).toContain('Found 1 matches');
      expect(result).toContain('Error: uppercase');
      expect(result).not.toContain('error: lowercase');
    });

    it('returns error string when executeCommand throws', async () => {
      (executeCommand as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('docker daemon not running'));
      const result = await searchContainerLogsTool.execute(
        { container_name: 'nginx', search_pattern: 'ERROR' },
        defaultConfig
      );
      expect(result).toContain('Error searching logs:');
      expect(result).toContain('docker daemon not running');
    });
});

describe('dockerImagesTool', () => {
  beforeEach(() => {
    vi.mocked(executeCommand).mockReset();
  });

  it('should have correct spec', () => {
    expect(dockerImagesTool.spec.name).toBe('get_docker_images');
  });

  it('should list docker images', async () => {
    (executeCommand as ReturnType<typeof vi.fn>).mockResolvedValue({
      stdout: 'nginx\tlatest\t150MB\t2024-01-01 00:00:00\tabc123\nredis\t7-alpine\t30MB\t2024-01-02 00:00:00\tdef456',
      stderr: '',
      exitCode: 0,
    });

    const result = await dockerImagesTool.execute({}, defaultConfig);
    const parsed = JSON.parse(result);

    expect(parsed).toHaveLength(2);
    expect(parsed[0].repository).toBe('nginx');
    expect(parsed[0].tag).toBe('latest');
    expect(parsed[1].repository).toBe('redis');
  });

  it('should handle no images', async () => {
    (executeCommand as ReturnType<typeof vi.fn>).mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
    });

    const result = await dockerImagesTool.execute({}, defaultConfig);
    expect(result).toContain('No Docker images found');
  });

  it('returns error string when exitCode is non-zero', async () => {
    (executeCommand as ReturnType<typeof vi.fn>).mockResolvedValue({
      stdout: '', stderr: 'permission denied', exitCode: 1,
    });
    const result = await dockerImagesTool.execute({}, defaultConfig);
    expect(result).toContain('Error listing images:');
    expect(result).toContain('permission denied');
  });

  it('returns error string when executeCommand throws', async () => {
    (executeCommand as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('socket timeout'));
    const result = await dockerImagesTool.execute({}, defaultConfig);
    expect(result).toContain('Error listing Docker images:');
    expect(result).toContain('socket timeout');
  });
});

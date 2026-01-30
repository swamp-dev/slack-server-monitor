import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the parent package executors BEFORE importing our tools
vi.mock('../../../dist/executors/docker.js', () => ({
  getContainerStatus: vi.fn().mockResolvedValue([
    { name: 'test-container', image: 'nginx', state: 'running', status: 'Up 1 hour', ports: '80/tcp' }
  ]),
  getContainerDetails: vi.fn().mockResolvedValue({
    name: 'test-container',
    image: 'nginx',
    state: { status: 'running', running: true, startedAt: '2024-01-01', finishedAt: '' },
    restartCount: 0,
    networks: ['bridge'],
    ports: { '80/tcp': '8080' },
    mounts: [],
  }),
  getContainerLogs: vi.fn().mockResolvedValue('2024-01-01 Container started\n2024-01-01 Ready'),
  getNetworkList: vi.fn().mockResolvedValue([
    { name: 'bridge', driver: 'bridge', scope: 'local' }
  ]),
}));

vi.mock('../../../dist/executors/system.js', () => ({
  getSystemResources: vi.fn().mockResolvedValue({
    memory: { total: 8000, used: 4000, available: 4000, percentUsed: 50 },
    swap: { total: 2000, used: 100, percentUsed: 5 },
    loadAverage: [0.5, 0.6, 0.7],
    uptime: '5d 3h',
  }),
  getDiskUsage: vi.fn().mockResolvedValue([
    { mountPoint: '/', filesystem: '/dev/sda1', size: '100G', used: '50G', available: '50G', percentUsed: 50 }
  ]),
}));

vi.mock('../../../dist/utils/shell.js', () => ({
  executeCommand: vi.fn().mockResolvedValue({ stdout: 'mock output', stderr: '', exitCode: 0 }),
  getAllowedCommands: vi.fn().mockReturnValue(['docker', 'free', 'df', 'ps']),
  ShellSecurityError: class ShellSecurityError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'ShellSecurityError';
    }
  },
}));

vi.mock('../../../dist/formatters/scrub.js', () => ({
  scrubSensitiveData: vi.fn().mockImplementation((text: string) => text),
}));

vi.mock('../../../dist/services/tools/file-tools.js', () => ({
  isPathAllowed: vi.fn().mockReturnValue(true),
  validateRealPath: vi.fn().mockResolvedValue({ valid: true, realPath: '/tmp/test.txt' }),
}));

// Mock fs/promises for read_file
vi.mock('fs/promises', () => ({
  default: {
    stat: vi.fn().mockResolvedValue({ isFile: () => true, size: 100 }),
    readFile: vi.fn().mockResolvedValue(Buffer.from('file content')),
    realpath: vi.fn().mockImplementation(async (path: string) => path),
  },
}));

// Now import after mocks are set up
import { TOOLS, executeTool, type ToolConfig } from '../src/tools/index.js';

const testConfig: ToolConfig = {
  allowedDirs: ['/tmp', '/opt'],
  maxFileSizeKb: 100,
  maxLogLines: 50,
};

describe('MCP Server Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('tool definitions', () => {
    it('should expose exactly 7 tools', () => {
      expect(TOOLS).toHaveLength(7);
    });

    it('should have all required tools', () => {
      const toolNames = TOOLS.map(t => t.name);
      expect(toolNames).toContain('get_container_status');
      expect(toolNames).toContain('get_container_logs');
      expect(toolNames).toContain('get_system_resources');
      expect(toolNames).toContain('get_disk_usage');
      expect(toolNames).toContain('get_network_info');
      expect(toolNames).toContain('run_command');
      expect(toolNames).toContain('read_file');
    });

    it('should have valid tool schemas', () => {
      for (const tool of TOOLS) {
        expect(tool.name).toBeTruthy();
        expect(tool.description).toBeTruthy();
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe('object');
        expect(tool.inputSchema.properties).toBeDefined();
      }
    });

    it('should have required fields defined for tools that need them', () => {
      const containerLogsTool = TOOLS.find(t => t.name === 'get_container_logs');
      expect(containerLogsTool?.inputSchema.required).toContain('container_name');

      const runCommandTool = TOOLS.find(t => t.name === 'run_command');
      expect(runCommandTool?.inputSchema.required).toContain('command');

      const readFileTool = TOOLS.find(t => t.name === 'read_file');
      expect(readFileTool?.inputSchema.required).toContain('path');
    });
  });

  describe('executeTool', () => {
    it('should throw error for unknown tool', async () => {
      await expect(executeTool('unknown_tool', {}, testConfig)).rejects.toThrow('Unknown tool');
    });

    // These tests verify tool handlers exist and handle errors gracefully
    // They may return real output or error messages depending on system availability
    // The important thing is they return strings and don't throw exceptions

    it('should execute get_system_resources and return string', async () => {
      const result = await executeTool('get_system_resources', {}, testConfig);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
      // Should be either JSON output or error message, never "Unknown tool"
      expect(result).not.toContain('Unknown tool');
    });

    it('should execute get_disk_usage and return string', async () => {
      const result = await executeTool('get_disk_usage', {}, testConfig);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
      expect(result).not.toContain('Unknown tool');
    });

    it('should execute get_network_info and return string', async () => {
      const result = await executeTool('get_network_info', {}, testConfig);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
      expect(result).not.toContain('Unknown tool');
    });

    it('should execute get_container_status and return string', async () => {
      const result = await executeTool('get_container_status', {}, testConfig);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
      expect(result).not.toContain('Unknown tool');
    });

    it('should execute run_command and return result or error', async () => {
      // This test may return real output or a security error
      // We verify it doesn't throw and returns a string
      const result = await executeTool('run_command', { command: 'echo', args: ['test'] }, testConfig);
      expect(typeof result).toBe('string');
      // Should be either output or security error (echo not in allowlist)
      expect(result.length).toBeGreaterThan(0);
    });

    it('should execute read_file and handle missing file', async () => {
      const result = await executeTool('read_file', { path: '/tmp/nonexistent-test-file.txt' }, testConfig);
      expect(typeof result).toBe('string');
      // Should return an error message about file not found
      expect(result.toLowerCase()).toContain('error');
    });
  });

  describe('tool result format', () => {
    it('should return string results for security errors', async () => {
      // Use a command that will definitely fail security validation
      const result = await executeTool('run_command', { command: 'rm', args: ['-rf', '/'] }, testConfig);
      expect(typeof result).toBe('string');
    });

    it('should handle errors gracefully', async () => {
      // Invalid command should return error string, not throw
      const result = await executeTool('run_command', { command: 'invalid_command' }, testConfig);
      expect(typeof result).toBe('string');
      expect(result.toLowerCase()).toMatch(/error|security/);
    });
  });
});

describe('Tool descriptions', () => {
  it('should have meaningful descriptions for Claude', () => {
    for (const tool of TOOLS) {
      // Description should be at least 20 characters
      expect(tool.description.length).toBeGreaterThan(20);

      // Description should not be generic
      expect(tool.description).not.toBe('A tool');
      expect(tool.description).not.toBe('Execute tool');
    }
  });

  it('should document security restrictions for run_command', () => {
    const runCommandTool = TOOLS.find(t => t.name === 'run_command');
    expect(runCommandTool?.description).toContain('docker');
    expect(runCommandTool?.description).toContain('systemctl');
    expect(runCommandTool?.description).toContain('restricted');
  });

  it('should document scrubbing for sensitive tools', () => {
    const logsTool = TOOLS.find(t => t.name === 'get_container_logs');
    expect(logsTool?.description.toLowerCase()).toContain('scrub');

    const readFileTool = TOOLS.find(t => t.name === 'read_file');
    expect(readFileTool?.description.toLowerCase()).toContain('redact');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('../../../src/utils/shell.js', () => ({
  executeCommand: vi.fn(),
}));

vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../src/formatters/scrub.js', () => ({
  scrubSensitiveData: vi.fn((data: string) => data),
}));

// Import after mocks
const {
  createGithubIssueTool,
  listGithubIssuesTool,
  viewGithubIssueTool,
  githubTools,
} = await import('../../../src/services/tools/github-tools.js');
const { executeCommand } = await import('../../../src/utils/shell.js');

const defaultConfig = {
  maxLogLines: 500,
  maxFileSizeKb: 1024,
  allowedDirs: [],
  githubRepo: 'default-owner/default-repo',
  githubDefaultLabels: ['bot-created'],
};

describe('githubTools', () => {
  it('should export all tools', () => {
    expect(githubTools).toHaveLength(3);
    expect(githubTools).toContain(createGithubIssueTool);
    expect(githubTools).toContain(listGithubIssuesTool);
    expect(githubTools).toContain(viewGithubIssueTool);
  });
});

describe('createGithubIssueTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should have correct spec', () => {
    expect(createGithubIssueTool.spec.name).toBe('create_github_issue');
    expect(createGithubIssueTool.spec.input_schema.required).toContain('title');
    expect(createGithubIssueTool.spec.input_schema.required).toContain('body');
  });

  it('should create an issue and return the URL', async () => {
    (executeCommand as ReturnType<typeof vi.fn>).mockResolvedValue({
      stdout: 'https://github.com/owner/repo/issues/42\n',
      stderr: '',
      exitCode: 0,
    });

    const result = await createGithubIssueTool.execute({
      repo: 'owner/repo',
      title: 'Bug: something broke',
      body: '## Summary\nSomething is broken.',
    }, defaultConfig);

    expect(result).toContain('Issue created successfully');
    expect(result).toContain('https://github.com/owner/repo/issues/42');

    // Verify gh was called with correct args
    const mockCall = (executeCommand as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(mockCall[0]).toBe('gh');
    expect(mockCall[1]).toContain('issue');
    expect(mockCall[1]).toContain('create');
    expect(mockCall[1]).toContain('--repo');
    expect(mockCall[1]).toContain('owner/repo');
    expect(mockCall[1]).toContain('--title');
    expect(mockCall[1]).toContain('Bug: something broke');
    // Body should be passed via stdin (--body-stdin flag), not --body
    expect(mockCall[1]).toContain('--body-stdin');
    expect(mockCall[1]).not.toContain('--body');
    expect(mockCall[2].stdin).toBe('## Summary\nSomething is broken.');
  });

  it('should fall back to configured default repo', async () => {
    (executeCommand as ReturnType<typeof vi.fn>).mockResolvedValue({
      stdout: 'https://github.com/default-owner/default-repo/issues/1\n',
      stderr: '',
      exitCode: 0,
    });

    const result = await createGithubIssueTool.execute({
      title: 'Test issue',
      body: 'Test body',
    }, defaultConfig);

    expect(result).toContain('Issue created successfully');
    const mockCall = (executeCommand as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(mockCall[1]).toContain('default-owner/default-repo');
  });

  it('should include default labels from config', async () => {
    (executeCommand as ReturnType<typeof vi.fn>).mockResolvedValue({
      stdout: 'https://github.com/owner/repo/issues/1\n',
      stderr: '',
      exitCode: 0,
    });

    await createGithubIssueTool.execute({
      repo: 'owner/repo',
      title: 'Test',
      body: 'Body',
      labels: ['bug'],
    }, defaultConfig);

    const mockCall = (executeCommand as ReturnType<typeof vi.fn>).mock.calls[0];
    const args = mockCall[1] as string[];
    // Should have both default and custom labels
    const labelIndices = args.reduce((acc: number[], arg: string, i: number) => {
      if (arg === '--label') acc.push(i);
      return acc;
    }, []);
    const labels = labelIndices.map((i: number) => args[i + 1]);
    expect(labels).toContain('bot-created');
    expect(labels).toContain('bug');
  });

  it('should deduplicate labels', async () => {
    (executeCommand as ReturnType<typeof vi.fn>).mockResolvedValue({
      stdout: 'https://github.com/owner/repo/issues/1\n',
      stderr: '',
      exitCode: 0,
    });

    await createGithubIssueTool.execute({
      repo: 'owner/repo',
      title: 'Test',
      body: 'Body',
      labels: ['bot-created', 'bug'], // bot-created is also in defaults
    }, defaultConfig);

    const mockCall = (executeCommand as ReturnType<typeof vi.fn>).mock.calls[0];
    const args = mockCall[1] as string[];
    const labelCount = args.filter((a: string) => a === '--label').length;
    expect(labelCount).toBe(2); // bot-created + bug, not 3
  });

  it('should require title', async () => {
    const result = await createGithubIssueTool.execute({ body: 'test' }, defaultConfig);
    expect(result).toContain('Error: title is required');
  });

  it('should require body', async () => {
    const result = await createGithubIssueTool.execute({ title: 'test' }, defaultConfig);
    expect(result).toContain('Error: body is required');
  });

  it('should handle gh failure', async () => {
    (executeCommand as ReturnType<typeof vi.fn>).mockResolvedValue({
      stdout: '',
      stderr: 'HTTP 422: Validation Failed',
      exitCode: 1,
    });

    const result = await createGithubIssueTool.execute({
      repo: 'owner/repo',
      title: 'Test',
      body: 'Body',
    }, defaultConfig);

    expect(result).toContain('Error creating issue');
    expect(result).toContain('422');
  });

  it('should include milestone and assignees when provided', async () => {
    (executeCommand as ReturnType<typeof vi.fn>).mockResolvedValue({
      stdout: 'https://github.com/owner/repo/issues/1\n',
      stderr: '',
      exitCode: 0,
    });

    await createGithubIssueTool.execute({
      repo: 'owner/repo',
      title: 'Test',
      body: 'Body',
      milestone: 'v1.0',
      assignees: ['user1', 'user2'],
    }, defaultConfig);

    const mockCall = (executeCommand as ReturnType<typeof vi.fn>).mock.calls[0];
    const args = mockCall[1] as string[];
    expect(args).toContain('--milestone');
    expect(args).toContain('v1.0');
    expect(args).toContain('--assignee');
    expect(args).toContain('user1');
    expect(args).toContain('user2');
  });
});

describe('listGithubIssuesTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should have correct spec', () => {
    expect(listGithubIssuesTool.spec.name).toBe('list_github_issues');
  });

  it('should list issues with default params', async () => {
    const mockIssues = JSON.stringify([
      { number: 1, title: 'Bug 1', state: 'open', labels: [] },
      { number: 2, title: 'Feature 2', state: 'open', labels: [{ name: 'enhancement' }] },
    ]);
    (executeCommand as ReturnType<typeof vi.fn>).mockResolvedValue({
      stdout: mockIssues,
      stderr: '',
      exitCode: 0,
    });

    const result = await listGithubIssuesTool.execute({}, defaultConfig);
    expect(result).toBe(mockIssues);

    const mockCall = (executeCommand as ReturnType<typeof vi.fn>).mock.calls[0];
    const args = mockCall[1] as string[];
    expect(args).toContain('--state');
    expect(args).toContain('open');
    expect(args).toContain('--limit');
    expect(args).toContain('20');
  });

  it('should pass search query when provided', async () => {
    (executeCommand as ReturnType<typeof vi.fn>).mockResolvedValue({
      stdout: '[]',
      stderr: '',
      exitCode: 0,
    });

    await listGithubIssuesTool.execute({ search: 'authentication bug' }, defaultConfig);

    const mockCall = (executeCommand as ReturnType<typeof vi.fn>).mock.calls[0];
    const args = mockCall[1] as string[];
    expect(args).toContain('--search');
    expect(args).toContain('authentication bug');
  });

  it('should cap limit at 50', async () => {
    (executeCommand as ReturnType<typeof vi.fn>).mockResolvedValue({
      stdout: '[]',
      stderr: '',
      exitCode: 0,
    });

    await listGithubIssuesTool.execute({ limit: 100 }, defaultConfig);

    const mockCall = (executeCommand as ReturnType<typeof vi.fn>).mock.calls[0];
    const args = mockCall[1] as string[];
    expect(args).toContain('50');
  });
});

describe('viewGithubIssueTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should have correct spec', () => {
    expect(viewGithubIssueTool.spec.name).toBe('view_github_issue');
    expect(viewGithubIssueTool.spec.input_schema.required).toContain('issue_number');
  });

  it('should view an issue by number', async () => {
    const mockIssue = JSON.stringify({
      number: 42,
      title: 'Test issue',
      body: 'Issue body',
      state: 'open',
    });
    (executeCommand as ReturnType<typeof vi.fn>).mockResolvedValue({
      stdout: mockIssue,
      stderr: '',
      exitCode: 0,
    });

    const result = await viewGithubIssueTool.execute({ issue_number: 42 }, defaultConfig);
    expect(result).toBe(mockIssue);

    const mockCall = (executeCommand as ReturnType<typeof vi.fn>).mock.calls[0];
    const args = mockCall[1] as string[];
    expect(args).toContain('42');
    expect(args).toContain('--repo');
    expect(args).toContain('default-owner/default-repo');
  });

  it('should require issue_number', async () => {
    const result = await viewGithubIssueTool.execute({}, defaultConfig);
    expect(result).toContain('Error: issue_number is required');
  });

  it('should use explicit repo over default', async () => {
    (executeCommand as ReturnType<typeof vi.fn>).mockResolvedValue({
      stdout: '{}',
      stderr: '',
      exitCode: 0,
    });

    await viewGithubIssueTool.execute({ issue_number: 1, repo: 'other/repo' }, defaultConfig);

    const mockCall = (executeCommand as ReturnType<typeof vi.fn>).mock.calls[0];
    const args = mockCall[1] as string[];
    expect(args).toContain('other/repo');
  });
});

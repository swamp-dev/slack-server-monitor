import type { ToolDefinition, ToolConfig } from './types.js';
import { executeCommand } from '../../utils/shell.js';
import { scrubSensitiveData } from '../../formatters/scrub.js';
import { logger } from '../../utils/logger.js';

/**
 * Get the GitHub repo from tool input or fall back to config default.
 * When githubRepos is configured, validates the repo is in the allowlist.
 * Returns { repo } on success or { error } on validation failure.
 */
function resolveRepo(input: Record<string, unknown>, config: ToolConfig): { repo: string } | { error: string } {
  const inputRepo = input.repo as string | undefined;
  const repo = inputRepo ?? config.githubRepo;

  if (!repo) {
    return { error: 'No repository specified and no default configured. Set GITHUB_REPO or pass repo parameter.' };
  }

  // Validate against allowlist when configured
  if (config.githubRepos && config.githubRepos.length > 0) {
    const allowed = config.githubRepos.some((r) => r.repo === repo);
    if (!allowed) {
      const validRepos = config.githubRepos.map((r) => r.repo).join(', ');
      return { error: `Repository "${repo}" is not in the configured allowlist. Valid repos: ${validRepos}` };
    }
  }

  return { repo };
}

/**
 * Tool: create_github_issue
 * Create a GitHub issue with investigation findings
 */
export const createGithubIssueTool: ToolDefinition = {
  spec: {
    name: 'create_github_issue',
    description: `Create a GitHub issue with investigation findings. Issues should be formatted for compatibility with automated coding agents (agentbox PRD format).

Before creating issues, always:
1. Confirm with the user that you should create the issue
2. Present a summary of what the issue will contain
3. For large features, propose breaking into an epic with sub-tickets first

Issue body should follow this structure:
- **Summary**: 1-2 sentence description
- **Context**: Current behavior, relevant code paths, investigation findings
- **Acceptance Criteria**: Checkbox list of specific, testable criteria
- **Files**: Paths to relevant source files
- **Dependencies**: References to related/blocking issues

Requires gh CLI to be installed and authenticated.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        repo: {
          type: 'string',
          description: 'GitHub repo in owner/repo format. Must be one of the repos listed in the system prompt. Falls back to configured default if omitted.',
        },
        title: {
          type: 'string',
          description: 'Issue title (concise, under 80 chars)',
        },
        body: {
          type: 'string',
          description: 'Issue body in markdown with Summary, Context, Acceptance Criteria, Files, and Dependencies sections',
        },
        labels: {
          type: 'array',
          items: { type: 'string' },
          description: 'Labels to apply (e.g., bug, enhancement, epic)',
        },
        milestone: {
          type: 'string',
          description: 'Optional milestone name',
        },
        assignees: {
          type: 'array',
          items: { type: 'string' },
          description: 'GitHub usernames to assign',
        },
      },
      required: ['title', 'body'],
    },
  },
  async execute(input: Record<string, unknown>, config: ToolConfig): Promise<string> {
    try {
      const resolved = resolveRepo(input, config);
      if ('error' in resolved) return `Error: ${resolved.error}`;
      const { repo } = resolved;

      const title = input.title as string;
      const body = input.body as string;
      const labels = input.labels as string[] | undefined;
      const milestone = input.milestone as string | undefined;
      const assignees = input.assignees as string[] | undefined;

      if (!title) return 'Error: title is required';
      if (!body) return 'Error: body is required';

      // Build gh issue create args
      // Body is passed via stdin to avoid shell metacharacter issues
      // (issue bodies commonly contain backticks, $variables, pipes, etc.)
      const args: string[] = ['issue', 'create', '--repo', repo, '--title', title, '--body-file', '-'];

      // Add configured default labels + any extra labels
      const defaultLabels = config.githubDefaultLabels ?? [];
      const allLabels = [...new Set([...defaultLabels, ...(labels ?? [])])];
      for (const label of allLabels) {
        args.push('--label', label);
      }

      if (milestone) {
        args.push('--milestone', milestone);
      }

      if (assignees) {
        for (const assignee of assignees) {
          args.push('--assignee', assignee);
        }
      }

      const result = await executeCommand('gh', args, { timeout: 30000, stdin: body });

      if (result.exitCode !== 0) {
        logger.error('gh issue create failed', { stderr: result.stderr, exitCode: result.exitCode });
        return `Error creating issue: ${result.stderr || 'Unknown error'}`;
      }

      // gh issue create outputs the issue URL
      const issueUrl = result.stdout.trim();
      return `Issue created successfully: ${issueUrl}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return `Error creating GitHub issue: ${message}`;
    }
  },
};

/**
 * Tool: list_github_issues
 * Search/list GitHub issues
 */
export const listGithubIssuesTool: ToolDefinition = {
  spec: {
    name: 'list_github_issues',
    description: 'List or search GitHub issues. Use this to check for existing issues before creating duplicates, or to find related tickets for an epic.',
    input_schema: {
      type: 'object' as const,
      properties: {
        repo: {
          type: 'string',
          description: 'GitHub repo in owner/repo format. Must be one of the repos listed in the system prompt. Falls back to configured default if omitted.',
        },
        search: {
          type: 'string',
          description: 'Search query to filter issues',
        },
        labels: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by labels',
        },
        state: {
          type: 'string',
          description: 'Filter by state: open, closed, all (default: open)',
        },
        limit: {
          type: 'number',
          description: 'Maximum results to return (default: 20, max: 50)',
        },
      },
    },
  },
  async execute(input: Record<string, unknown>, config: ToolConfig): Promise<string> {
    try {
      const resolved = resolveRepo(input, config);
      if ('error' in resolved) return `Error: ${resolved.error}`;
      const { repo } = resolved;

      const search = input.search as string | undefined;
      const labels = input.labels as string[] | undefined;
      const state = typeof input.state === 'string' ? input.state : 'open';
      const limit = Math.min(typeof input.limit === 'number' ? input.limit : 20, 50);

      const args: string[] = [
        'issue', 'list',
        '--repo', repo,
        '--state', state,
        '--limit', String(limit),
        '--json', 'number,title,state,labels,assignees,createdAt',
      ];

      if (search) {
        args.push('--search', search);
      }

      if (labels) {
        for (const label of labels) {
          args.push('--label', label);
        }
      }

      const result = await executeCommand('gh', args, { timeout: 30000 });

      if (result.exitCode !== 0) {
        return `Error listing issues: ${result.stderr || 'Unknown error'}`;
      }

      return scrubSensitiveData(result.stdout.trim() || '[]');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return `Error listing GitHub issues: ${message}`;
    }
  },
};

/**
 * Tool: view_github_issue
 * View detailed info about a specific GitHub issue
 */
export const viewGithubIssueTool: ToolDefinition = {
  spec: {
    name: 'view_github_issue',
    description: 'View detailed information about a specific GitHub issue including its body, comments, labels, and current state.',
    input_schema: {
      type: 'object' as const,
      properties: {
        repo: {
          type: 'string',
          description: 'GitHub repo in owner/repo format. Must be one of the repos listed in the system prompt. Falls back to configured default if omitted.',
        },
        issue_number: {
          type: 'number',
          description: 'Issue number to view',
        },
      },
      required: ['issue_number'],
    },
  },
  async execute(input: Record<string, unknown>, config: ToolConfig): Promise<string> {
    try {
      const resolved = resolveRepo(input, config);
      if ('error' in resolved) return `Error: ${resolved.error}`;
      const { repo } = resolved;

      const issueNumber = input.issue_number as number;

      if (!issueNumber) return 'Error: issue_number is required';

      const args: string[] = [
        'issue', 'view',
        String(issueNumber),
        '--repo', repo,
        '--json', 'number,title,body,state,labels,assignees,comments,createdAt,updatedAt',
      ];

      const result = await executeCommand('gh', args, { timeout: 30000 });

      if (result.exitCode !== 0) {
        return `Error viewing issue: ${result.stderr || 'Unknown error'}`;
      }

      return scrubSensitiveData(result.stdout.trim());
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return `Error viewing GitHub issue: ${message}`;
    }
  },
};

/**
 * All GitHub tools
 */
export const githubTools: ToolDefinition[] = [
  createGithubIssueTool,
  listGithubIssuesTool,
  viewGithubIssueTool,
];

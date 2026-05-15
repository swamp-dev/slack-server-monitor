import { describe, it, expect } from 'vitest';
import { SYSTEM_PROMPT, buildSystemPrompt } from '../../src/config/prompts.js';

describe('prompts', () => {
  describe('SYSTEM_PROMPT', () => {
    it('should contain key sections', () => {
      expect(SYSTEM_PROMPT).toContain('Guidelines');
      expect(SYSTEM_PROMPT).toContain('Limitations');
    });

    it('should NOT duplicate tool descriptions that are provided via tool specs', () => {
      // Tool specs are injected separately by buildToolSystemPrompt in cli-provider.ts
      // The base system prompt should NOT list individual tools to avoid confusion
      // when Claude sees tools listed in the prompt but can't use them via normal tool-use
      expect(SYSTEM_PROMPT).not.toContain('get_container_status');
      expect(SYSTEM_PROMPT).not.toContain('get_container_logs');
      expect(SYSTEM_PROMPT).not.toContain('get_system_resources');
      expect(SYSTEM_PROMPT).not.toContain('get_disk_usage');
      expect(SYSTEM_PROMPT).not.toContain('get_network_info');
    });

    it('should clarify that read-only means no modifications, not no tool access', () => {
      // Claude should understand it CAN use tools but CANNOT modify the server
      expect(SYSTEM_PROMPT).toContain('read-only');
      expect(SYSTEM_PROMPT).not.toContain('cannot execute commands');
    });

    it('should instruct Claude to use the tool_call protocol', () => {
      expect(SYSTEM_PROMPT).toContain('tool_call');
    });
  });

  describe('buildSystemPrompt', () => {
    it('should return base prompt when no options provided', () => {
      const result = buildSystemPrompt();
      expect(result).toBe(SYSTEM_PROMPT);
    });

    it('should return base prompt when options is empty object', () => {
      const result = buildSystemPrompt({});
      expect(result).toBe(SYSTEM_PROMPT);
    });

    it('should append user addition to prompt', () => {
      const addition = 'My server runs nginx and postgres.';
      const result = buildSystemPrompt({ userAddition: addition });

      expect(result).toContain(SYSTEM_PROMPT);
      expect(result).toContain('Additional Context from User Configuration');
      expect(result).toContain(addition);
    });

    it('should include context directory content', () => {
      const contextContent = '## Infrastructure Context\n\nMy infrastructure details.';
      const result = buildSystemPrompt({ contextDirContent: contextContent });

      expect(result).toContain(SYSTEM_PROMPT);
      expect(result).toContain(contextContent);
    });

    it('should include both context and user addition', () => {
      const contextContent = '## Infrastructure Context\n\nInfra details.';
      const userAddition = 'User-specific context.';
      const result = buildSystemPrompt({
        contextDirContent: contextContent,
        userAddition: userAddition,
      });

      expect(result).toContain(SYSTEM_PROMPT);
      expect(result).toContain(contextContent);
      expect(result).toContain('Additional Context from User Configuration');
      expect(result).toContain(userAddition);
      // Context should come before user addition
      expect(result.indexOf(contextContent)).toBeLessThan(result.indexOf(userAddition));
    });

    it('should include GitHub repos section when repos are provided', () => {
      const result = buildSystemPrompt({
        githubRepos: [
          { repo: 'swamp-dev/ansible', description: 'Home server Ansible playbooks' },
          { repo: 'swamp-dev/slack-server-monitor', description: 'Slack monitoring bot' },
        ],
      });

      expect(result).toContain('## GitHub Repositories');
      expect(result).toContain('`swamp-dev/ansible`');
      expect(result).toContain('Home server Ansible playbooks');
      expect(result).toContain('`swamp-dev/slack-server-monitor`');
      expect(result).toContain('Slack monitoring bot');
      expect(result).toContain('use ONLY these repositories');
    });

    it('should include default repo when provided with repos', () => {
      const result = buildSystemPrompt({
        githubRepos: [
          { repo: 'org/repo-a', description: 'Repo A' },
        ],
        githubDefaultRepo: 'org/repo-a',
      });

      expect(result).toContain('Default repository');
      expect(result).toContain('`org/repo-a`');
    });

    it('should not include default repo line when not provided', () => {
      const result = buildSystemPrompt({
        githubRepos: [
          { repo: 'org/repo-a', description: 'Repo A' },
        ],
      });

      expect(result).not.toContain('Default repository');
    });

    it('should not include GitHub repos section when array is empty', () => {
      const result = buildSystemPrompt({ githubRepos: [] });
      expect(result).not.toContain('## GitHub Repositories');
    });

    it('should handle repos without descriptions', () => {
      const result = buildSystemPrompt({
        githubRepos: [
          { repo: 'org/repo', description: '' },
        ],
      });

      // The repo line should not have a description suffix
      expect(result).toMatch(/- `org\/repo`(?!\s*—)/);
    });

    it('should place GitHub repos before user addition', () => {
      const result = buildSystemPrompt({
        githubRepos: [{ repo: 'org/repo', description: 'Test' }],
        userAddition: 'Custom context',
      });

      expect(result.indexOf('GitHub Repositories')).toBeLessThan(
        result.indexOf('Additional Context from User Configuration')
      );
    });
  });
});

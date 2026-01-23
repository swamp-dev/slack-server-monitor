import { describe, it, expect } from 'vitest';
import { SYSTEM_PROMPT, buildSystemPrompt } from '../../src/config/prompts.js';

describe('prompts', () => {
  describe('SYSTEM_PROMPT', () => {
    it('should contain key sections', () => {
      expect(SYSTEM_PROMPT).toContain('Available Tools');
      expect(SYSTEM_PROMPT).toContain('Guidelines');
      expect(SYSTEM_PROMPT).toContain('Limitations');
    });

    it('should mention all server tools', () => {
      expect(SYSTEM_PROMPT).toContain('get_container_status');
      expect(SYSTEM_PROMPT).toContain('get_container_logs');
      expect(SYSTEM_PROMPT).toContain('get_system_resources');
      expect(SYSTEM_PROMPT).toContain('get_disk_usage');
      expect(SYSTEM_PROMPT).toContain('get_network_info');
      expect(SYSTEM_PROMPT).toContain('read_file');
    });

    it('should emphasize read-only nature', () => {
      expect(SYSTEM_PROMPT).toContain('cannot execute commands');
      expect(SYSTEM_PROMPT).toContain('cannot');
      expect(SYSTEM_PROMPT).toContain('read-only');
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
  });
});

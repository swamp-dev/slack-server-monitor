import { describe, it, expect } from 'vitest';
import { getToolSpecs, getToolNames } from '../../../src/services/tools/index.js';

describe('tools/index', () => {
  describe('getToolSpecs', () => {
    it('should return all tool specifications', () => {
      const specs = getToolSpecs();

      expect(specs.length).toBeGreaterThan(0);

      // Check that each spec has required properties
      for (const spec of specs) {
        expect(spec.name).toBeDefined();
        expect(spec.description).toBeDefined();
        expect(spec.input_schema).toBeDefined();
      }
    });

    it('should include server monitoring tools', () => {
      const specs = getToolSpecs();
      const names = specs.map(s => s.name);

      expect(names).toContain('get_container_status');
      expect(names).toContain('get_container_logs');
      expect(names).toContain('search_container_logs');
      expect(names).toContain('get_system_resources');
      expect(names).toContain('get_disk_usage');
      expect(names).toContain('get_network_info');
      expect(names).toContain('get_docker_images');
    });

    it('should include file tools', () => {
      const specs = getToolSpecs();
      const names = specs.map(s => s.name);

      expect(names).toContain('read_file');
    });

    it('should include github tools', () => {
      const specs = getToolSpecs();
      const names = specs.map(s => s.name);

      expect(names).toContain('create_github_issue');
      expect(names).toContain('list_github_issues');
      expect(names).toContain('view_github_issue');
    });

    it('should exclude disabled tools', () => {
      const specs = getToolSpecs(['read_file', 'get_container_logs']);
      const names = specs.map(s => s.name);

      expect(names).not.toContain('read_file');
      expect(names).not.toContain('get_container_logs');
      expect(names).toContain('get_container_status');
    });
  });

  describe('getToolNames', () => {
    it('should return all tool names', () => {
      const names = getToolNames();

      expect(names).toContain('get_container_status');
      expect(names).toContain('get_container_logs');
      expect(names).toContain('search_container_logs');
      expect(names).toContain('get_system_resources');
      expect(names).toContain('get_disk_usage');
      expect(names).toContain('get_network_info');
      expect(names).toContain('get_docker_images');
      expect(names).toContain('read_file');
      expect(names).toContain('create_github_issue');
      expect(names).toContain('list_github_issues');
      expect(names).toContain('view_github_issue');
    });
  });
});

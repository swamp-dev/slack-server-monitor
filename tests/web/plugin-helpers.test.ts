import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Mock plugin-router to avoid import chain issues
vi.mock('../../src/web/plugin-router.js', () => ({
  getPluginNavEntries: vi.fn(() => []),
}));

import {
  renderPluginPage,
  pluginStyles,
  pluginCard,
  pluginTable,
  pluginChart,
  escapeHtml,
  icon,
  formatTimestamp,
  sanitizeUrl,
} from '../../src/web/plugin-helpers.js';

describe('plugin template helpers', () => {
  describe('renderPluginPage', () => {
    it('should render a complete HTML page with shell', () => {
      const html = renderPluginPage({
        title: 'My Plugin',
        pluginName: 'my-plugin',
        body: '<p>Hello world</p>',
      });

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<title>My Plugin</title>');
      expect(html).toContain('<p>Hello world</p>');
    });

    it('should include nav bar by default', () => {
      const html = renderPluginPage({
        title: 'Test',
        pluginName: 'test',
        body: '<p>Content</p>',
      });

      expect(html).toContain('nav-bar');
    });

    it('should include custom scripts when provided', () => {
      const html = renderPluginPage({
        title: 'Test',
        pluginName: 'test',
        body: '<p>Content</p>',
        scripts: '<script>console.log("hello")</script>',
      });

      expect(html).toContain('console.log("hello")');
    });

    it('should scope styles to the plugin', () => {
      const html = renderPluginPage({
        title: 'Test',
        pluginName: 'my-plugin',
        body: '<p>Content</p>',
        styles: '.custom { color: red; }',
      });

      expect(html).toContain('.plugin-my-plugin');
    });

    it('should wrap body in plugin-scoped container', () => {
      const html = renderPluginPage({
        title: 'Test',
        pluginName: 'my-plugin',
        body: '<p>Content</p>',
      });

      expect(html).toContain('class="plugin-my-plugin"');
    });
  });

  describe('pluginStyles', () => {
    it('should scope CSS rules under plugin class', () => {
      const css = pluginStyles('test-plugin', '.card { color: red; }');
      expect(css).toContain('.plugin-test-plugin .card');
    });

    it('should handle multiple rules', () => {
      const css = pluginStyles('test', '.a { color: red; } .b { color: blue; }');
      expect(css).toContain('.plugin-test');
    });
  });

  describe('pluginCard', () => {
    it('should render a themed card', () => {
      const html = pluginCard('My Card', '<p>Content</p>');
      expect(html).toContain('plugin-card');
      expect(html).toContain('My Card');
      expect(html).toContain('<p>Content</p>');
    });

    it('should escape the title', () => {
      const html = pluginCard('<script>xss</script>', '<p>safe</p>');
      expect(html).not.toContain('<script>xss');
      expect(html).toContain('&lt;script&gt;');
    });

    it('should render with link when provided', () => {
      const html = pluginCard('Title', '<p>Body</p>', { link: '/p/test/details' });
      expect(html).toContain('href="/p/test/details"');
    });
  });

  describe('pluginTable', () => {
    it('should render a themed table', () => {
      const html = pluginTable(['Name', 'Value'], [['CPU', '42%'], ['Mem', '8GB']]);
      expect(html).toContain('plugin-table');
      expect(html).toContain('<th>Name</th>');
      expect(html).toContain('<th>Value</th>');
      expect(html).toContain('<td>CPU</td>');
      expect(html).toContain('<td>42%</td>');
    });

    it('should escape cell content', () => {
      const html = pluginTable(['H'], [['<img src=x onerror=alert(1)>']]);
      expect(html).not.toContain('<img');
      expect(html).toContain('&lt;img');
    });

    it('should handle empty rows', () => {
      const html = pluginTable(['A', 'B'], []);
      expect(html).toContain('plugin-table');
      expect(html).toContain('<th>A</th>');
    });
  });

  describe('pluginChart', () => {
    it('should render a horizontal bar chart', () => {
      const html = pluginChart([
        { label: 'GET', value: 100 },
        { label: 'POST', value: 50 },
      ]);
      expect(html).toContain('plugin-chart');
      expect(html).toContain('GET');
      expect(html).toContain('POST');
      expect(html).toContain('100');
      expect(html).toContain('50');
    });

    it('should handle empty data', () => {
      const html = pluginChart([]);
      expect(html).toContain('plugin-chart');
    });

    it('should escape labels', () => {
      const html = pluginChart([{ label: '<b>Bold</b>', value: 10 }]);
      expect(html).not.toContain('<b>Bold');
      expect(html).toContain('&lt;b&gt;');
    });
  });

  describe('re-exports', () => {
    it('should export escapeHtml', () => {
      expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
    });

    it('should export icon', () => {
      const svg = icon('robot', 16);
      expect(svg).toContain('<svg');
    });

    it('should export formatTimestamp', () => {
      const result = formatTimestamp(Date.now());
      expect(typeof result).toBe('string');
    });

    it('should export sanitizeUrl', () => {
      expect(sanitizeUrl('javascript:alert(1)')).toBeNull();
      expect(sanitizeUrl('https://example.com')).toBe('https://example.com');
    });
  });
});

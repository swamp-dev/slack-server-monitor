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
  pluginBadge,
  pluginButton,
  pluginAlert,
  pluginStat,
  pluginProgress,
  pluginTimeline,
  pluginTabs,
  pluginEmpty,
  pluginCode,
  pluginDivider,
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

  describe('pluginBadge', () => {
    it('should render a neutral badge by default', () => {
      const html = pluginBadge('Running');
      expect(html).toContain('plugin-badge-neutral');
      expect(html).toContain('Running');
    });

    it('should render variant badges', () => {
      expect(pluginBadge('OK', 'success')).toContain('plugin-badge-success');
      expect(pluginBadge('Fail', 'error')).toContain('plugin-badge-error');
      expect(pluginBadge('Warn', 'warning')).toContain('plugin-badge-warning');
      expect(pluginBadge('Info', 'info')).toContain('plugin-badge-info');
    });

    it('should escape text', () => {
      const html = pluginBadge('<b>xss</b>');
      expect(html).not.toContain('<b>');
      expect(html).toContain('&lt;b&gt;');
    });
  });

  describe('pluginButton', () => {
    it('should render a button element without href', () => {
      const html = pluginButton('Click me');
      expect(html).toContain('<button');
      expect(html).toContain('Click me');
      expect(html).toContain('btn-ghost');
    });

    it('should render an anchor with href', () => {
      const html = pluginButton('Go', '/p/test/');
      expect(html).toContain('<a');
      expect(html).toContain('href="/p/test/"');
    });

    it('should reject javascript: URLs', () => {
      const html = pluginButton('Evil', 'javascript:alert(1)');
      expect(html).not.toContain('javascript:');
    });

    it('should apply primary variant', () => {
      const html = pluginButton('Save', undefined, { variant: 'primary' });
      expect(html).toContain('btn-primary');
    });

    it('should open in new tab when target is _blank', () => {
      const html = pluginButton('External', 'https://example.com', { target: '_blank' });
      expect(html).toContain('noopener noreferrer');
    });
  });

  describe('pluginAlert', () => {
    it('should render an info alert by default', () => {
      const html = pluginAlert('Something happened');
      expect(html).toContain('plugin-alert-info');
      expect(html).toContain('Something happened');
      expect(html).toContain('role="alert"');
    });

    it('should render variant alerts', () => {
      expect(pluginAlert('ok', { level: 'success' })).toContain('plugin-alert-success');
      expect(pluginAlert('warn', { level: 'warning' })).toContain('plugin-alert-warning');
      expect(pluginAlert('err', { level: 'error' })).toContain('plugin-alert-error');
    });

    it('should include dismiss button when dismissible', () => {
      const html = pluginAlert('Close me', { dismissible: true });
      expect(html).toContain('onclick');
      expect(html).toContain('plugin-alert');
    });

    it('should escape the message', () => {
      const html = pluginAlert('<script>xss</script>');
      expect(html).not.toContain('<script>xss');
      expect(html).toContain('&lt;script&gt;');
    });
  });

  describe('pluginStat', () => {
    it('should render label and value', () => {
      const html = pluginStat('Uptime', '99.9%');
      expect(html).toContain('plugin-stat-value');
      expect(html).toContain('99.9%');
      expect(html).toContain('Uptime');
    });

    it('should render trend indicator', () => {
      const html = pluginStat('Load', 42, { trend: { value: 5, direction: 'up' } });
      expect(html).toContain('plugin-stat-trend');
      expect(html).toContain('5%');
    });

    it('should escape label and value', () => {
      const html = pluginStat('<b>label</b>', '<b>val</b>');
      expect(html).not.toContain('<b>');
    });
  });

  describe('pluginProgress', () => {
    it('should render a progress bar', () => {
      const html = pluginProgress(75);
      expect(html).toContain('plugin-progress-track');
      expect(html).toContain('plugin-progress-fill');
      expect(html).toContain('width:75%');
    });

    it('should clamp value between 0 and max', () => {
      expect(pluginProgress(150)).toContain('width:100%');
      expect(pluginProgress(-10)).toContain('width:0%');
    });

    it('should emit exactly one style attribute on the fill element', () => {
      const html = pluginProgress(50, { color: '#ff0000' });
      const fillMatch = html.match(/<div class="plugin-progress-fill[^"]*"([^>]*)>/);
      expect(fillMatch).not.toBeNull();
      const attrs = fillMatch?.[1] ?? '';
      // Count style= occurrences — must be exactly one (no duplicate)
      const styleCount = (attrs.match(/style=/g) ?? []).length;
      expect(styleCount).toBe(1);
      expect(attrs).toContain('#ff0000');
      expect(attrs).toContain('width:50%');
    });

    it('should show label when provided', () => {
      const html = pluginProgress(30, { label: 'CPU Usage' });
      expect(html).toContain('CPU Usage');
      expect(html).toContain('30%');
    });
  });

  describe('pluginTimeline', () => {
    it('should render timeline entries', () => {
      const html = pluginTimeline([
        { time: '2m ago', title: 'Build started', status: 'ok' },
        { time: '1m ago', title: 'Tests passed' },
      ]);
      expect(html).toContain('plugin-timeline');
      expect(html).toContain('Build started');
      expect(html).toContain('Tests passed');
      expect(html).toContain('2m ago');
    });

    it('should apply status class to dot', () => {
      const html = pluginTimeline([{ time: 'now', title: 'Failed', status: 'error' }]);
      expect(html).toContain('plugin-timeline-dot error');
    });

    it('should escape entry content', () => {
      const html = pluginTimeline([{ time: '<b>', title: '<script>xss</script>' }]);
      expect(html).not.toContain('<script>xss');
    });
  });

  describe('pluginTabs', () => {
    it('should render tabs and panels', () => {
      const html = pluginTabs([
        { id: 'a', label: 'Tab A', content: '<p>Panel A</p>' },
        { id: 'b', label: 'Tab B', content: '<p>Panel B</p>' },
      ]);
      expect(html).toContain('Tab A');
      expect(html).toContain('Tab B');
      expect(html).toContain('<p>Panel A</p>');
      expect(html).toContain('<p>Panel B</p>');
    });

    it('should mark first tab active by default', () => {
      const html = pluginTabs([
        { id: 'first', label: 'First', content: 'content' },
        { id: 'second', label: 'Second', content: 'content2' },
      ]);
      expect(html).toContain('plugin-tab-btn active');
    });

    it('should return empty string for empty tabs', () => {
      expect(pluginTabs([])).toBe('');
    });

    it('should include inline script for switching', () => {
      const html = pluginTabs([{ id: 'a', label: 'A', content: 'c' }]);
      expect(html).toContain('<script>');
      expect(html).toContain('classList');
    });
  });

  describe('pluginEmpty', () => {
    it('should render default empty state', () => {
      const html = pluginEmpty();
      expect(html).toContain('plugin-empty');
      expect(html).toContain('Nothing here yet');
    });

    it('should render custom title and text', () => {
      const html = pluginEmpty({ title: 'No results', text: 'Try a different filter' });
      expect(html).toContain('No results');
      expect(html).toContain('Try a different filter');
    });

    it('should render action button when provided', () => {
      const html = pluginEmpty({ action: { label: 'Create one', href: '/p/test/new' } });
      expect(html).toContain('Create one');
      expect(html).toContain('href="/p/test/new"');
    });
  });

  describe('pluginCode', () => {
    it('should render a code block', () => {
      const html = pluginCode('const x = 1;', 'typescript');
      expect(html).toContain('plugin-code-block');
      expect(html).toContain('typescript');
      expect(html).toContain('const x = 1;');
    });

    it('should escape code content', () => {
      const html = pluginCode('<script>alert(1)</script>');
      expect(html).not.toContain('<script>alert');
      expect(html).toContain('&lt;script&gt;');
    });

    it('should omit header when no language provided', () => {
      const html = pluginCode('x = 1');
      expect(html).not.toContain('plugin-code-header');
    });
  });

  describe('pluginDivider', () => {
    it('should render a plain hr without label', () => {
      const html = pluginDivider();
      expect(html).toContain('<hr');
    });

    it('should render a labeled divider', () => {
      const html = pluginDivider('Section');
      expect(html).toContain('plugin-divider');
      expect(html).toContain('Section');
    });

    it('should escape the label', () => {
      const html = pluginDivider('<b>xss</b>');
      expect(html).not.toContain('<b>');
    });
  });

  describe('pluginCard variant and animationDelay', () => {
    it('should apply glass variant class', () => {
      const html = pluginCard('Title', 'body', { variant: 'glass' });
      expect(html).toContain('card-glass');
    });

    it('should apply gradient variant class', () => {
      const html = pluginCard('Title', 'body', { variant: 'gradient' });
      expect(html).toContain('card-gradient');
    });

    it('should apply animation delay style', () => {
      const html = pluginCard('Title', 'body', { animationDelay: 120 });
      expect(html).toContain('animation-delay:120ms');
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

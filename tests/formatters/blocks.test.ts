import { describe, it, expect } from 'vitest';
import {
  header,
  section,
  sectionWithFields,
  divider,
  context,
  codeBlock,
  warning,
  error,
  success,
  progressBar,
  statusEmoji,
  formatBytes,
  formatUptime,
  buildResponse,
  buildChannelResponse,
  // Enhanced output helpers
  compactList,
  statsBar,
  helpTip,
  link,
  expandableHeader,
  compactStatusRow,
  collapsibleList,
  metricsRow,
  sectionWithHint,
  docLinks,
  showMoreHint,
  timestampFooter,
} from '../../src/formatters/blocks.js';

describe('block utilities', () => {
  describe('header', () => {
    it('should create a header block', () => {
      const result = header('Test Header');
      expect(result.type).toBe('header');
      expect(result.text.type).toBe('plain_text');
      expect(result.text.text).toBe('Test Header');
    });
  });

  describe('section', () => {
    it('should create a section block with markdown', () => {
      const result = section('*Bold* text');
      expect(result.type).toBe('section');
      expect(result.text?.type).toBe('mrkdwn');
      expect(result.text?.text).toBe('*Bold* text');
    });
  });

  describe('sectionWithFields', () => {
    it('should create a section with multiple fields', () => {
      const result = sectionWithFields(['Field 1', 'Field 2']);
      expect(result.type).toBe('section');
      expect(result.fields).toHaveLength(2);
      expect(result.fields?.[0].text).toBe('Field 1');
      expect(result.fields?.[1].text).toBe('Field 2');
    });
  });

  describe('divider', () => {
    it('should create a divider block', () => {
      const result = divider();
      expect(result.type).toBe('divider');
    });
  });

  describe('context', () => {
    it('should create a context block', () => {
      const result = context('Small text');
      expect(result.type).toBe('context');
      expect(result.elements).toHaveLength(1);
      expect(result.elements[0]).toMatchObject({
        type: 'mrkdwn',
        text: 'Small text',
      });
    });
  });

  describe('codeBlock', () => {
    it('should wrap code in triple backticks', () => {
      const result = codeBlock('const x = 1');
      expect(result.text?.text).toContain('```');
      expect(result.text?.text).toContain('const x = 1');
    });

    it('should include language specifier', () => {
      const result = codeBlock('const x = 1', 'javascript');
      expect(result.text?.text).toContain('```javascript');
    });
  });

  describe('warning', () => {
    it('should create a warning context block', () => {
      const result = warning('Be careful');
      expect(result.type).toBe('context');
      expect(result.elements[0]).toMatchObject({
        type: 'mrkdwn',
        text: expect.stringContaining(':warning:'),
      });
    });
  });

  describe('error', () => {
    it('should create an error section', () => {
      const result = error('Something went wrong');
      expect(result.type).toBe('section');
      expect(result.text?.text).toContain(':x:');
      expect(result.text?.text).toContain('Something went wrong');
    });
  });

  describe('success', () => {
    it('should create a success section', () => {
      const result = success('Operation completed');
      expect(result.type).toBe('section');
      expect(result.text?.text).toContain(':white_check_mark:');
    });
  });

  describe('progressBar', () => {
    it('should show full bar at 100%', () => {
      const result = progressBar(100, 100);
      expect(result).toContain('100%');
      expect(result).not.toContain('\u2591'); // No empty blocks
    });

    it('should show empty bar at 0%', () => {
      const result = progressBar(0, 100);
      expect(result).toContain('0%');
      expect(result).not.toContain('\u2588'); // No filled blocks
    });

    it('should show mixed bar at 50%', () => {
      const result = progressBar(50, 100);
      expect(result).toContain('50%');
      expect(result).toContain('\u2588'); // Has filled blocks
      expect(result).toContain('\u2591'); // Has empty blocks
    });

    it('should respect custom width', () => {
      const result = progressBar(50, 100, 20);
      // Count filled blocks
      const filledCount = (result.match(/\u2588/g) || []).length;
      expect(filledCount).toBe(10); // 50% of 20
    });

    it('should clamp to 100%', () => {
      const result = progressBar(150, 100);
      expect(result).toContain('100%');
    });
  });

  describe('statusEmoji', () => {
    it('should return green circle for ok', () => {
      expect(statusEmoji('ok')).toBe(':large_green_circle:');
    });

    it('should return yellow circle for warn', () => {
      expect(statusEmoji('warn')).toBe(':large_yellow_circle:');
    });

    it('should return red circle for error', () => {
      expect(statusEmoji('error')).toBe(':red_circle:');
    });

    it('should return white circle for unknown', () => {
      expect(statusEmoji('unknown')).toBe(':white_circle:');
    });
  });

  describe('formatBytes', () => {
    it('should format bytes', () => {
      expect(formatBytes(0)).toBe('0 B');
      expect(formatBytes(500)).toBe('500.0 B');
    });

    it('should format kilobytes', () => {
      expect(formatBytes(1024)).toBe('1.0 KB');
      expect(formatBytes(1536)).toBe('1.5 KB');
    });

    it('should format megabytes', () => {
      expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    });

    it('should format gigabytes', () => {
      expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB');
    });

    it('should format terabytes', () => {
      expect(formatBytes(1024 * 1024 * 1024 * 1024)).toBe('1.0 TB');
    });
  });

  describe('formatUptime', () => {
    it('should format minutes only', () => {
      expect(formatUptime(60)).toBe('1m');
      expect(formatUptime(120)).toBe('2m');
    });

    it('should format hours and minutes', () => {
      expect(formatUptime(3660)).toBe('1h 1m');
    });

    it('should format days, hours, and minutes', () => {
      expect(formatUptime(90061)).toBe('1d 1h 1m');
    });

    it('should handle zero seconds', () => {
      expect(formatUptime(0)).toBe('0m');
    });
  });

  describe('buildResponse', () => {
    it('should create ephemeral response', () => {
      const blocks = [section('test')];
      const result = buildResponse(blocks);
      expect(result.response_type).toBe('ephemeral');
      expect(result.blocks).toBe(blocks);
    });
  });

  describe('buildChannelResponse', () => {
    it('should create in_channel response', () => {
      const blocks = [section('test')];
      const result = buildChannelResponse(blocks);
      expect(result.response_type).toBe('in_channel');
      expect(result.blocks).toBe(blocks);
    });
  });
});

// =============================================================================
// Enhanced Output Helpers Tests
// =============================================================================

describe('enhanced output helpers', () => {
  describe('compactList', () => {
    it('should return _None_ for empty array', () => {
      expect(compactList([])).toBe('_None_');
    });

    it('should format items with backticks by default', () => {
      const result = compactList(['item1', 'item2']);
      expect(result).toBe('`item1`, `item2`');
    });

    it('should format items without backticks when codeFormat is false', () => {
      const result = compactList(['item1', 'item2'], 10, false);
      expect(result).toBe('item1, item2');
    });

    it('should truncate list and show overflow indicator', () => {
      const items = ['a', 'b', 'c', 'd', 'e'];
      const result = compactList(items, 3);
      expect(result).toBe('`a`, `b`, `c` _...and 2 more_');
    });

    it('should not show overflow for exact count', () => {
      const items = ['a', 'b', 'c'];
      const result = compactList(items, 3);
      expect(result).toBe('`a`, `b`, `c`');
      expect(result).not.toContain('more');
    });

    it('should escape backticks in items to prevent markdown breaking', () => {
      const result = compactList(['item`with`backticks', 'normal']);
      expect(result).toBe("`item'with'backticks`, `normal`");
      expect(result).not.toContain('``');
    });
  });

  describe('statsBar', () => {
    it('should format stats with emojis and counts', () => {
      const result = statsBar([
        { count: 5, label: 'running', status: 'ok' },
        { count: 2, label: 'stopped', status: 'warn' },
        { count: 1, label: 'failed', status: 'error' },
      ]);
      expect(result).toContain(':large_green_circle:');
      expect(result).toContain('5 running');
      expect(result).toContain(':large_yellow_circle:');
      expect(result).toContain('2 stopped');
      expect(result).toContain(':red_circle:');
      expect(result).toContain('1 failed');
      expect(result).toContain('·'); // Separator
    });

    it('should handle empty stats', () => {
      const result = statsBar([]);
      expect(result).toBe('');
    });

    it('should handle single stat', () => {
      const result = statsBar([{ count: 10, label: 'items', status: 'ok' }]);
      expect(result).toBe(':large_green_circle: 10 items');
    });
  });

  describe('helpTip', () => {
    it('should create context block with bulb emoji', () => {
      const result = helpTip(['Use /help for more info']);
      expect(result.type).toBe('context');
      expect(result.elements[0]).toMatchObject({
        type: 'mrkdwn',
        text: ':bulb: Use /help for more info',
      });
    });

    it('should handle multiple tips', () => {
      const result = helpTip(['Tip 1', 'Tip 2']);
      const text = (result.elements[0] as { text: string }).text;
      expect(text).toContain(':bulb: Tip 1');
      expect(text).toContain(':bulb: Tip 2');
    });
  });

  describe('link', () => {
    it('should create Slack markdown link', () => {
      const result = link('https://example.com', 'Example');
      expect(result).toBe('<https://example.com|Example>');
    });

    it('should include description when provided', () => {
      const result = link('https://example.com', 'Example', 'Visit our site');
      expect(result).toBe('<https://example.com|Example> - Visit our site');
    });
  });

  describe('expandableHeader', () => {
    it('should show collapsed arrow by default', () => {
      const result = expandableHeader('Services', 10);
      expect(result).toBe('▸ *Services* (10)');
    });

    it('should show expanded arrow when expanded', () => {
      const result = expandableHeader('Services', 10, true);
      expect(result).toBe('▾ *Services* (10)');
    });
  });

  describe('compactStatusRow', () => {
    it('should format items with status emojis', () => {
      const items = [
        { name: 'nginx', status: 'ok' as const },
        { name: 'redis', status: 'error' as const },
      ];
      const rows = compactStatusRow(items);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toContain(':large_green_circle: nginx');
      expect(rows[0]).toContain(':red_circle: redis');
      expect(rows[0]).toContain('·');
    });

    it('should split into multiple rows based on maxItems', () => {
      const items = [
        { name: 'a', status: 'ok' as const },
        { name: 'b', status: 'ok' as const },
        { name: 'c', status: 'ok' as const },
        { name: 'd', status: 'ok' as const },
      ];
      const rows = compactStatusRow(items, 2);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toContain('a');
      expect(rows[0]).toContain('b');
      expect(rows[1]).toContain('c');
      expect(rows[1]).toContain('d');
    });

    it('should handle empty array', () => {
      const rows = compactStatusRow([]);
      expect(rows).toHaveLength(0);
    });

    it('should cap items to prevent Slack block overflow', () => {
      const items = Array(500)
        .fill(null)
        .map((_, i) => ({ name: `item${String(i)}`, status: 'ok' as const }));
      const rows = compactStatusRow(items, 5);
      // Should cap at 200 items = 40 rows (200/5)
      expect(rows.length).toBeLessThanOrEqual(40);
    });
  });

  describe('collapsibleList', () => {
    it('should show empty message for empty array', () => {
      const blocks = collapsibleList('Items', []);
      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toMatchObject({
        type: 'section',
        text: { text: '*Items:* _None_' },
      });
    });

    it('should show items with count', () => {
      const blocks = collapsibleList('Items', ['item1', 'item2']);
      expect(blocks).toHaveLength(2);
      expect(blocks[0]).toMatchObject({
        type: 'section',
        text: { text: '*Items (2):*' },
      });
      const contextText = (blocks[1] as { elements: { text: string }[] }).elements[0].text;
      expect(contextText).toContain('• item1');
      expect(contextText).toContain('• item2');
    });

    it('should truncate and show overflow with detail command', () => {
      const items = ['a', 'b', 'c', 'd', 'e', 'f'];
      const blocks = collapsibleList('Items', items, {
        maxPreview: 3,
        detailCommand: '/items all',
      });
      expect(blocks).toHaveLength(3);
      // Check overflow message
      const overflowBlock = blocks[2] as { elements: { text: string }[] };
      expect(overflowBlock.elements[0].text).toContain('3 more');
      expect(overflowBlock.elements[0].text).toContain('/items all');
    });

    it('should hide count when showCount is false', () => {
      const blocks = collapsibleList('Items', ['item1'], { showCount: false });
      expect(blocks[0]).toMatchObject({
        type: 'section',
        text: { text: '*Items:*' },
      });
    });

    it('should use custom empty message', () => {
      const blocks = collapsibleList('Items', [], { emptyMessage: 'No items found' });
      expect(blocks[0]).toMatchObject({
        type: 'section',
        text: { text: '*Items:* No items found' },
      });
    });
  });

  describe('metricsRow', () => {
    it('should format metrics with labels', () => {
      const result = metricsRow([
        { label: 'CPU', value: 45 },
        { label: 'Memory', value: 78 },
      ]);
      expect(result).toBe('*CPU:* 45  |  *Memory:* 78');
    });

    it('should show max value when provided', () => {
      const result = metricsRow([{ label: 'Memory', value: 512, max: 1024 }]);
      expect(result).toBe('*Memory:* 512/1024');
    });

    it('should append unit when provided', () => {
      const result = metricsRow([{ label: 'CPU', value: 45, unit: '%' }]);
      expect(result).toBe('*CPU:* 45%');
    });
  });

  describe('sectionWithHint', () => {
    it('should create section and context blocks', () => {
      const blocks = sectionWithHint('Main content', 'Try this next');
      expect(blocks).toHaveLength(2);
      expect(blocks[0]).toMatchObject({
        type: 'section',
        text: { text: 'Main content' },
      });
      expect(blocks[1]).toMatchObject({
        type: 'context',
      });
      const hintText = (blocks[1] as { elements: { text: string }[] }).elements[0].text;
      expect(hintText).toContain(':point_right:');
      expect(hintText).toContain('Try this next');
    });
  });

  describe('docLinks', () => {
    it('should create context block with links', () => {
      const result = docLinks([
        { url: 'https://docs.example.com', text: 'Docs' },
        { url: 'https://api.example.com', text: 'API', description: 'API reference' },
      ]);
      expect(result.type).toBe('context');
      const text = (result.elements[0] as { text: string }).text;
      expect(text).toContain(':books:');
      expect(text).toContain('<https://docs.example.com|Docs>');
      expect(text).toContain('<https://api.example.com|API> - API reference');
    });
  });

  describe('showMoreHint', () => {
    it('should show remaining count and command', () => {
      const result = showMoreHint(15, '/services all');
      expect(result.type).toBe('context');
      const text = (result.elements[0] as { text: string }).text;
      expect(text).toContain(':arrow_down:');
      expect(text).toContain('15 more items');
      expect(text).toContain('/services all');
    });
  });

  describe('timestampFooter', () => {
    it('should create context block with timestamp', () => {
      const date = new Date('2024-01-15T10:30:00Z');
      const result = timestampFooter(date);
      expect(result.type).toBe('context');
      const text = (result.elements[0] as { text: string }).text;
      expect(text).toContain(':clock1:');
      expect(text).toContain('Last updated:');
      // The exact format depends on locale, just verify it includes date info
      expect(text).toMatch(/Jan.*15/);
    });

    it('should use current date when not specified', () => {
      const result = timestampFooter();
      expect(result.type).toBe('context');
      const text = (result.elements[0] as { text: string }).text;
      expect(text).toContain('Last updated:');
    });
  });
});

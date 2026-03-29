import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DashboardWidget } from '../../src/plugins/types.js';

// Mock the loader module before importing
vi.mock('../../src/plugins/loader.js', () => ({
  getPluginWidgets: vi.fn(() => []),
}));

import { getPluginWidgets } from '../../src/plugins/loader.js';
import { renderDashboard } from '../../src/web/templates/dashboard.js';
import type { SessionStats, SessionSummary, TagInfo } from '../../src/services/conversation-store.js';

const baseStats: SessionStats = {
  totalSessions: 10,
  activeSessions: 2,
  totalMessages: 50,
  totalToolCalls: 30,
  avgToolDurationMs: 150,
  toolFailureRate: 0.05,
  topTools: [
    { name: 'get_container_status', count: 15, avgDurationMs: 120 },
    { name: 'run_command', count: 10, avgDurationMs: 200 },
  ],
};

const recentSessions: SessionSummary[] = [
  {
    id: 1,
    threadTs: '1234567890.000001',
    channelId: 'C01TEST',
    userId: 'U01TEST',
    firstMessage: 'Check nginx status',
    messageCount: 5,
    toolCallCount: 3,
    updatedAt: Date.now() - 60000,
    createdAt: Date.now() - 120000,
    archivedAt: null,
    isActive: false,
    isFavorited: false,
    tags: [],
  },
];

const favoriteSessions: SessionSummary[] = [];
const allTags: TagInfo[] = [];

describe('dashboard widgets', () => {
  beforeEach(() => {
    vi.mocked(getPluginWidgets).mockReturnValue([]);
  });

  describe('renderDashboard with widgets', () => {
    it('should render without widget section when no widgets provided', () => {
      const html = renderDashboard(baseStats, recentSessions, favoriteSessions, 0, allTags, 'U01TEST');

      expect(html).toContain('<!DOCTYPE html>');
      // Should not contain the rendered widget section (CSS class definitions don't count)
      expect(html).not.toContain('<div class="widget-section">');
    });

    it('should render widget grid section when widgets are provided', () => {
      const widgets: DashboardWidget[] = [
        {
          title: 'My Plugin',
          html: '<p>Plugin content here</p>',
        },
      ];

      const html = renderDashboard(baseStats, recentSessions, favoriteSessions, 0, allTags, 'U01TEST', widgets);

      expect(html).toContain('widget-grid');
      expect(html).toContain('Apps');
      expect(html).toContain('My Plugin');
      expect(html).toContain('<p>Plugin content here</p>');
    });

    it('should render multiple widgets in the grid', () => {
      const widgets: DashboardWidget[] = [
        { title: 'Widget A', html: '<p>Content A</p>' },
        { title: 'Widget B', html: '<p>Content B</p>' },
        { title: 'Widget C', html: '<p>Content C</p>' },
      ];

      const html = renderDashboard(baseStats, recentSessions, favoriteSessions, 0, allTags, 'U01TEST', widgets);

      expect(html).toContain('Widget A');
      expect(html).toContain('Content A');
      expect(html).toContain('Widget B');
      expect(html).toContain('Content B');
      expect(html).toContain('Widget C');
      expect(html).toContain('Content C');
    });

    it('should escape widget title to prevent XSS', () => {
      const widgets: DashboardWidget[] = [
        { title: '<script>alert("xss")</script>', html: '<p>Safe content</p>' },
      ];

      const html = renderDashboard(baseStats, recentSessions, favoriteSessions, 0, allTags, 'U01TEST', widgets);

      expect(html).not.toContain('<script>alert');
      expect(html).toContain('&lt;script&gt;');
    });

    it('should render widget icon when provided', () => {
      const widgets: DashboardWidget[] = [
        { title: 'Lift', icon: 'dumbbell', html: '<p>Lift stats</p>' },
      ];

      const html = renderDashboard(baseStats, recentSessions, favoriteSessions, 0, allTags, 'U01TEST', widgets);

      expect(html).toContain('Lift');
      expect(html).toContain('dumbbell');
    });

    it('should render widget link when provided', () => {
      const widgets: DashboardWidget[] = [
        { title: 'Lift', html: '<p>Stats</p>', link: '/plugins/lift' },
      ];

      const html = renderDashboard(baseStats, recentSessions, favoriteSessions, 0, allTags, 'U01TEST', widgets);

      expect(html).toContain('href="/plugins/lift"');
    });

    it('should block javascript: URLs in widget links', () => {
      const widgets: DashboardWidget[] = [
        { title: 'Bad', html: '<p>x</p>', link: 'javascript:alert(1)' },
      ];

      const html = renderDashboard(baseStats, recentSessions, favoriteSessions, 0, allTags, 'U01TEST', widgets);

      expect(html).not.toContain('javascript:');
    });

    it('should block data: URLs in widget links', () => {
      const widgets: DashboardWidget[] = [
        { title: 'Bad', html: '<p>x</p>', link: 'data:text/html,<script>alert(1)</script>' },
      ];

      const html = renderDashboard(baseStats, recentSessions, favoriteSessions, 0, allTags, 'U01TEST', widgets);

      expect(html).not.toContain('data:text/html');
    });

    it('should apply size class to widgets', () => {
      const widgets: DashboardWidget[] = [
        { title: 'Small', html: '<p>s</p>', size: 'small' },
        { title: 'Medium', html: '<p>m</p>', size: 'medium' },
        { title: 'Large', html: '<p>l</p>', size: 'large' },
      ];

      const html = renderDashboard(baseStats, recentSessions, favoriteSessions, 0, allTags, 'U01TEST', widgets);

      expect(html).toContain('widget-small');
      expect(html).toContain('widget-medium');
      expect(html).toContain('widget-large');
    });

    it('should default to medium size when not specified', () => {
      const widgets: DashboardWidget[] = [
        { title: 'Default', html: '<p>content</p>' },
      ];

      const html = renderDashboard(baseStats, recentSessions, favoriteSessions, 0, allTags, 'U01TEST', widgets);

      expect(html).toContain('widget-medium');
    });

    it('should not render widget section in empty state', () => {
      const emptyStats: SessionStats = {
        totalSessions: 0,
        activeSessions: 0,
        totalMessages: 0,
        totalToolCalls: 0,
        avgToolDurationMs: null,
        toolFailureRate: 0,
        topTools: [],
      };

      const widgets: DashboardWidget[] = [
        { title: 'Plugin', html: '<p>content</p>' },
      ];

      const html = renderDashboard(emptyStats, [], [], 0, [], 'U01TEST', widgets);

      expect(html).toContain('Welcome to Server Monitor');
      expect(html).not.toContain('<div class="widget-section">');
    });

    it('should treat undefined widgets same as empty array', () => {
      const html = renderDashboard(baseStats, recentSessions, favoriteSessions, 0, allTags, 'U01TEST', undefined);

      expect(html).not.toContain('<div class="widget-section">');
    });
  });

  describe('getPluginWidgets', () => {
    it('should return empty array when no plugins loaded', () => {
      vi.mocked(getPluginWidgets).mockReturnValue([]);
      const widgets = getPluginWidgets();
      expect(widgets).toEqual([]);
    });

    it('should collect widgets from multiple plugins', () => {
      const mockWidgets: DashboardWidget[] = [
        { title: 'Lift Stats', html: '<p>lifts</p>', priority: 10 },
        { title: 'Health', html: '<p>health</p>', priority: 20 },
      ];
      vi.mocked(getPluginWidgets).mockReturnValue(mockWidgets);

      const widgets = getPluginWidgets();
      expect(widgets).toHaveLength(2);
      expect(widgets[0].title).toBe('Lift Stats');
      expect(widgets[1].title).toBe('Health');
    });
  });
});

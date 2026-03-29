import { describe, it, expect } from 'vitest';
import { renderNotificationBell, renderNotificationDropdown, renderNotificationPage } from '../../src/web/templates/notifications.js';
import type { Notification } from '../../src/services/notification-store.js';

const sampleNotifications: Notification[] = [
  {
    id: 1,
    source: 'system',
    level: 'info',
    title: 'Server started',
    body: 'All services are running',
    link: '/c/123/C01',
    createdAt: Date.now() - 60000,
    readAt: null,
  },
  {
    id: 2,
    source: 'backup',
    level: 'warn',
    title: 'Backup delayed',
    body: null,
    link: null,
    createdAt: Date.now() - 120000,
    readAt: null,
  },
  {
    id: 3,
    source: 'system',
    level: 'error',
    title: 'Disk usage critical',
    body: '/dev/sda1 at 95%',
    link: null,
    createdAt: Date.now() - 300000,
    readAt: Date.now() - 200000,
  },
];

describe('notification templates', () => {
  describe('renderNotificationBell', () => {
    it('should render bell icon with unread badge when count > 0', () => {
      const html = renderNotificationBell(5);
      expect(html).toContain('notification-bell');
      expect(html).toContain('notif-badge');
      expect(html).toContain('5');
    });

    it('should hide badge when count is 0', () => {
      const html = renderNotificationBell(0);
      expect(html).toContain('notification-bell');
      expect(html).not.toContain('notif-badge');
    });

    it('should show 99+ for counts over 99', () => {
      const html = renderNotificationBell(150);
      expect(html).toContain('99+');
    });
  });

  describe('renderNotificationDropdown', () => {
    it('should render recent notifications', () => {
      const html = renderNotificationDropdown(sampleNotifications.slice(0, 2));
      expect(html).toContain('Server started');
      expect(html).toContain('Backup delayed');
    });

    it('should show empty state when no notifications', () => {
      const html = renderNotificationDropdown([]);
      expect(html).toContain('No notifications');
    });

    it('should include View all link', () => {
      const html = renderNotificationDropdown(sampleNotifications.slice(0, 2));
      expect(html).toContain('/notifications');
      expect(html).toContain('View all');
    });

    it('should include Mark all read button', () => {
      const html = renderNotificationDropdown(sampleNotifications.slice(0, 2));
      expect(html).toContain('Mark all read');
    });

    it('should escape notification title to prevent XSS', () => {
      const xssNotif: Notification[] = [
        {
          id: 99,
          source: 'test',
          level: 'info',
          title: '<script>alert("xss")</script>',
          body: null,
          link: null,
          createdAt: Date.now(),
          readAt: null,
        },
      ];
      const html = renderNotificationDropdown(xssNotif);
      expect(html).not.toContain('<script>alert');
      expect(html).toContain('&lt;script&gt;');
    });

    it('should render link when notification has one', () => {
      const html = renderNotificationDropdown(sampleNotifications.slice(0, 1));
      expect(html).toContain('href="/c/123/C01"');
    });

    it('should apply level-based styling', () => {
      const html = renderNotificationDropdown(sampleNotifications);
      expect(html).toContain('notif-info');
      expect(html).toContain('notif-warn');
      expect(html).toContain('notif-error');
    });
  });

  describe('renderNotificationPage', () => {
    it('should render full page with notifications', () => {
      const html = renderNotificationPage(sampleNotifications, 3);
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('Notifications');
      expect(html).toContain('Server started');
      expect(html).toContain('Backup delayed');
      expect(html).toContain('Disk usage critical');
    });

    it('should show read status for read notifications', () => {
      const html = renderNotificationPage(sampleNotifications, 3);
      // Notification 3 is read
      expect(html).toContain('notif-read');
    });

    it('should show empty state when no notifications', () => {
      const html = renderNotificationPage([], 0);
      expect(html).toContain('No notifications yet');
    });

    it('should include Mark all read button when unread exist', () => {
      const html = renderNotificationPage(sampleNotifications, 2);
      expect(html).toContain('Mark all read');
    });

    it('should render notification body when present', () => {
      const html = renderNotificationPage(sampleNotifications, 3);
      expect(html).toContain('All services are running');
      expect(html).toContain('/dev/sda1 at 95%');
    });

    it('should escape body content to prevent XSS', () => {
      const xssNotifs: Notification[] = [
        {
          id: 1,
          source: 'test',
          level: 'info',
          title: 'Safe title',
          body: '<img src=x onerror=alert(1)>',
          link: null,
          createdAt: Date.now(),
          readAt: null,
        },
      ];
      const html = renderNotificationPage(xssNotifs, 1);
      expect(html).not.toContain('<img src=x');
      expect(html).toContain('&lt;img');
    });

    it('should include notification source', () => {
      const html = renderNotificationPage(sampleNotifications, 3);
      expect(html).toContain('system');
      expect(html).toContain('backup');
    });
  });
});

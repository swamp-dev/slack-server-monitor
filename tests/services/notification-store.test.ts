import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NotificationStore } from '../../src/services/notification-store.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('NotificationStore', () => {
  let store: NotificationStore;
  let testDbPath: string;

  beforeEach(() => {
    testDbPath = path.join(os.tmpdir(), `test-notifications-${Date.now()}.db`);
    store = new NotificationStore(testDbPath);
  });

  afterEach(() => {
    store.close();
    try {
      fs.unlinkSync(testDbPath);
      fs.unlinkSync(testDbPath + '-wal');
      fs.unlinkSync(testDbPath + '-shm');
    } catch {
      // Files may not exist
    }
  });

  describe('createNotification', () => {
    it('should create a notification and return it', () => {
      const notif = store.createNotification('plugin:backup', 'info', 'Backup complete', 'Backup finished successfully');

      expect(notif.id).toBeDefined();
      expect(notif.source).toBe('plugin:backup');
      expect(notif.level).toBe('info');
      expect(notif.title).toBe('Backup complete');
      expect(notif.body).toBe('Backup finished successfully');
      expect(notif.readAt).toBeNull();
      expect(notif.createdAt).toBeGreaterThan(0);
    });

    it('should create a notification with optional link', () => {
      const notif = store.createNotification('core', 'warn', 'Disk full', 'Disk at 95%', '/resources');

      expect(notif.link).toBe('/resources');
    });

    it('should create a notification without body', () => {
      const notif = store.createNotification('core', 'info', 'Server started');

      expect(notif.body).toBeNull();
    });
  });

  describe('getUnread', () => {
    it('should return unread notifications for all users', () => {
      store.createNotification('core', 'info', 'Notif 1');
      store.createNotification('core', 'warn', 'Notif 2');

      const unread = store.getUnread();

      expect(unread).toHaveLength(2);
    });

    it('should not include read notifications', () => {
      const n1 = store.createNotification('core', 'info', 'Notif 1');
      store.createNotification('core', 'warn', 'Notif 2');
      store.markRead(n1.id);

      const unread = store.getUnread();

      expect(unread).toHaveLength(1);
      expect(unread[0]?.title).toBe('Notif 2');
    });

    it('should respect limit parameter', () => {
      store.createNotification('core', 'info', 'Notif 1');
      store.createNotification('core', 'info', 'Notif 2');
      store.createNotification('core', 'info', 'Notif 3');

      const unread = store.getUnread(2);

      expect(unread).toHaveLength(2);
    });

    it('should return most recent first', () => {
      store.createNotification('core', 'info', 'Older');
      store.createNotification('core', 'info', 'Newer');

      const unread = store.getUnread();

      expect(unread[0]?.title).toBe('Newer');
    });
  });

  describe('getRecent', () => {
    it('should return both read and unread notifications', () => {
      const n1 = store.createNotification('core', 'info', 'Notif 1');
      store.createNotification('core', 'warn', 'Notif 2');
      store.markRead(n1.id);

      const recent = store.getRecent();

      expect(recent).toHaveLength(2);
    });
  });

  describe('markRead', () => {
    it('should mark a notification as read', () => {
      const notif = store.createNotification('core', 'info', 'Test');

      const result = store.markRead(notif.id);

      expect(result).toBe(true);
      expect(store.getUnread()).toHaveLength(0);
    });

    it('should return false for non-existent notification', () => {
      const result = store.markRead(9999);
      expect(result).toBe(false);
    });
  });

  describe('markAllRead', () => {
    it('should mark all notifications as read', () => {
      store.createNotification('core', 'info', 'Notif 1');
      store.createNotification('core', 'warn', 'Notif 2');
      store.createNotification('plugin:x', 'error', 'Notif 3');

      const count = store.markAllRead();

      expect(count).toBe(3);
      expect(store.getUnread()).toHaveLength(0);
    });

    it('should return 0 when nothing to mark', () => {
      const count = store.markAllRead();
      expect(count).toBe(0);
    });
  });

  describe('countUnread', () => {
    it('should return count of unread notifications', () => {
      store.createNotification('core', 'info', 'Notif 1');
      store.createNotification('core', 'warn', 'Notif 2');

      expect(store.countUnread()).toBe(2);
    });

    it('should not count read notifications', () => {
      const n = store.createNotification('core', 'info', 'Notif 1');
      store.createNotification('core', 'warn', 'Notif 2');
      store.markRead(n.id);

      expect(store.countUnread()).toBe(1);
    });
  });

  describe('cleanup', () => {
    it('should delete old read notifications', () => {
      const n = store.createNotification('core', 'info', 'Old');
      store.markRead(n.id);

      // Manually backdate the created_at to simulate old notification
      store.getDatabase().prepare('UPDATE notifications SET created_at = ? WHERE id = ?')
        .run(Date.now() - 8 * 24 * 60 * 60 * 1000, n.id);

      const deleted = store.cleanup(7);

      expect(deleted).toBe(1);
      expect(store.getRecent()).toHaveLength(0);
    });

    it('should not delete unread notifications', () => {
      store.createNotification('core', 'info', 'Unread old');

      // Backdate
      store.getDatabase().prepare('UPDATE notifications SET created_at = ?')
        .run(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const deleted = store.cleanup(7);

      expect(deleted).toBe(0);
      expect(store.getRecent()).toHaveLength(1);
    });
  });
});

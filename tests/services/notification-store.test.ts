import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { NotificationStore } from '../../src/services/notification-store.js';

describe('NotificationStore', () => {
  let store: NotificationStore;
  let testDbPath: string;

  beforeEach(() => {
    testDbPath = path.join(os.tmpdir(), `test-notif-${Date.now()}.db`);
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
      const notif = store.createNotification('system', 'info', 'Server started');

      expect(notif.id).toBeDefined();
      expect(notif.source).toBe('system');
      expect(notif.level).toBe('info');
      expect(notif.title).toBe('Server started');
      expect(notif.body).toBeNull();
      expect(notif.link).toBeNull();
      expect(notif.readAt).toBeNull();
      expect(notif.createdAt).toBeGreaterThan(0);
    });

    it('should create a notification with body and link', () => {
      const notif = store.createNotification(
        'backup',
        'warn',
        'Backup failed',
        'S3 upload timed out after 300s',
        '/c/1234/C01',
      );

      expect(notif.source).toBe('backup');
      expect(notif.level).toBe('warn');
      expect(notif.title).toBe('Backup failed');
      expect(notif.body).toBe('S3 upload timed out after 300s');
      expect(notif.link).toBe('/c/1234/C01');
    });

    it('should create notifications with error level', () => {
      const notif = store.createNotification('system', 'error', 'Disk full');
      expect(notif.level).toBe('error');
    });
  });

  describe('countUnread', () => {
    it('should return 0 when no notifications exist', () => {
      expect(store.countUnread()).toBe(0);
    });

    it('should count unread notifications', () => {
      store.createNotification('a', 'info', 'One');
      store.createNotification('b', 'info', 'Two');
      store.createNotification('c', 'warn', 'Three');

      expect(store.countUnread()).toBe(3);
    });

    it('should not count read notifications', () => {
      const n1 = store.createNotification('a', 'info', 'One');
      store.createNotification('b', 'info', 'Two');
      store.markRead(n1.id);

      expect(store.countUnread()).toBe(1);
    });
  });

  describe('getUnread', () => {
    it('should return empty array when no unread', () => {
      expect(store.getUnread()).toEqual([]);
    });

    it('should return unread notifications most recent first', () => {
      store.createNotification('a', 'info', 'First');
      store.createNotification('b', 'info', 'Second');
      store.createNotification('c', 'info', 'Third');

      const unread = store.getUnread();
      expect(unread).toHaveLength(3);
      expect(unread[0].title).toBe('Third');
      expect(unread[1].title).toBe('Second');
      expect(unread[2].title).toBe('First');
    });

    it('should exclude read notifications', () => {
      const n1 = store.createNotification('a', 'info', 'Read me');
      store.createNotification('b', 'info', 'Unread');
      store.markRead(n1.id);

      const unread = store.getUnread();
      expect(unread).toHaveLength(1);
      expect(unread[0].title).toBe('Unread');
    });

    it('should respect limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        store.createNotification('a', 'info', `Notif ${String(i)}`);
      }

      const unread = store.getUnread(3);
      expect(unread).toHaveLength(3);
    });
  });

  describe('getRecent', () => {
    it('should return both read and unread notifications', () => {
      const n1 = store.createNotification('a', 'info', 'Read');
      store.createNotification('b', 'info', 'Unread');
      store.markRead(n1.id);

      const recent = store.getRecent(50);
      expect(recent).toHaveLength(2);
    });

    it('should return most recent first', () => {
      store.createNotification('a', 'info', 'First');
      store.createNotification('b', 'info', 'Second');

      const recent = store.getRecent(50);
      expect(recent[0].title).toBe('Second');
      expect(recent[1].title).toBe('First');
    });

    it('should respect limit and offset', () => {
      for (let i = 0; i < 10; i++) {
        store.createNotification('a', 'info', `Notif ${String(i)}`);
      }

      const page1 = store.getRecent(3, 0);
      expect(page1).toHaveLength(3);
      expect(page1[0].title).toBe('Notif 9');

      const page2 = store.getRecent(3, 3);
      expect(page2).toHaveLength(3);
      expect(page2[0].title).toBe('Notif 6');
    });
  });

  describe('markRead', () => {
    it('should mark a notification as read', () => {
      const notif = store.createNotification('a', 'info', 'Read me');
      expect(store.countUnread()).toBe(1);

      const result = store.markRead(notif.id);
      expect(result).toBe(true);
      expect(store.countUnread()).toBe(0);
    });

    it('should return false for non-existent notification', () => {
      expect(store.markRead(9999)).toBe(false);
    });

    it('should be idempotent', () => {
      const notif = store.createNotification('a', 'info', 'Read me');
      store.markRead(notif.id);
      const result = store.markRead(notif.id);
      // Already read, no rows changed
      expect(result).toBe(false);
    });
  });

  describe('markAllRead', () => {
    it('should mark all unread notifications as read', () => {
      store.createNotification('a', 'info', 'One');
      store.createNotification('b', 'info', 'Two');
      store.createNotification('c', 'info', 'Three');

      const count = store.markAllRead();
      expect(count).toBe(3);
      expect(store.countUnread()).toBe(0);
    });

    it('should return 0 when no unread notifications', () => {
      expect(store.markAllRead()).toBe(0);
    });

    it('should not affect already-read notifications', () => {
      const n1 = store.createNotification('a', 'info', 'One');
      store.createNotification('b', 'info', 'Two');
      store.markRead(n1.id);

      const count = store.markAllRead();
      expect(count).toBe(1); // Only the unread one
    });
  });

  describe('cleanup', () => {
    it('should delete read notifications older than specified days', () => {
      const notif = store.createNotification('a', 'info', 'Old read');
      store.markRead(notif.id);

      // Manually backdate the notification
      const db = store.getDatabase();
      const oldTime = Date.now() - (31 * 24 * 60 * 60 * 1000); // 31 days ago
      db.prepare('UPDATE notifications SET created_at = ? WHERE id = ?')
        .run(oldTime, notif.id);

      const deleted = store.cleanup(30);
      expect(deleted).toBe(1);
    });

    it('should not delete unread notifications', () => {
      store.createNotification('a', 'info', 'Old unread');

      // Backdate
      const db = store.getDatabase();
      const oldTime = Date.now() - (31 * 24 * 60 * 60 * 1000);
      db.prepare('UPDATE notifications SET created_at = ? WHERE id = 1')
        .run(oldTime);

      const deleted = store.cleanup(30);
      expect(deleted).toBe(0);
    });

    it('should not delete recent read notifications', () => {
      const notif = store.createNotification('a', 'info', 'Recent read');
      store.markRead(notif.id);

      const deleted = store.cleanup(30);
      expect(deleted).toBe(0);
    });
  });
});

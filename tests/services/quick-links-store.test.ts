import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { QuickLinksStore } from '../../src/services/quick-links-store.js';

describe('QuickLinksStore', () => {
  let store: QuickLinksStore;
  let testDbPath: string;

  beforeEach(() => {
    testDbPath = path.join(os.tmpdir(), `test-links-${Date.now()}.db`);
    store = new QuickLinksStore(testDbPath);
  });

  afterEach(() => {
    store.close();
    try {
      fs.unlinkSync(testDbPath);
      fs.unlinkSync(testDbPath + '-wal');
      fs.unlinkSync(testDbPath + '-shm');
    } catch {
      // ok
    }
  });

  describe('addLink', () => {
    it('should add a quick link and return it', () => {
      const link = store.addLink('U01', 'Google', 'https://google.com');

      expect(link.id).toBeDefined();
      expect(link.userId).toBe('U01');
      expect(link.title).toBe('Google');
      expect(link.url).toBe('https://google.com');
      expect(link.icon).toBeNull();
      expect(link.position).toBe(0);
    });

    it('should auto-increment position for same user', () => {
      const l1 = store.addLink('U01', 'A', 'https://a.com');
      const l2 = store.addLink('U01', 'B', 'https://b.com');
      const l3 = store.addLink('U01', 'C', 'https://c.com');

      expect(l1.position).toBe(0);
      expect(l2.position).toBe(1);
      expect(l3.position).toBe(2);
    });

    it('should track position independently per user', () => {
      store.addLink('U01', 'A', 'https://a.com');
      const l2 = store.addLink('U02', 'B', 'https://b.com');

      expect(l2.position).toBe(0); // First link for U02
    });

    it('should store icon when provided', () => {
      const link = store.addLink('U01', 'Grafana', 'https://grafana.local', 'chart');

      expect(link.icon).toBe('chart');
    });
  });

  describe('getLinks', () => {
    it('should return empty array for user with no links', () => {
      expect(store.getLinks('U01')).toEqual([]);
    });

    it('should return links ordered by position', () => {
      store.addLink('U01', 'C', 'https://c.com');
      store.addLink('U01', 'A', 'https://a.com');
      store.addLink('U01', 'B', 'https://b.com');

      const links = store.getLinks('U01');
      expect(links).toHaveLength(3);
      expect(links[0].title).toBe('C'); // position 0
      expect(links[1].title).toBe('A'); // position 1
      expect(links[2].title).toBe('B'); // position 2
    });

    it('should only return links for the specified user', () => {
      store.addLink('U01', 'Mine', 'https://mine.com');
      store.addLink('U02', 'Theirs', 'https://theirs.com');

      const links = store.getLinks('U01');
      expect(links).toHaveLength(1);
      expect(links[0].title).toBe('Mine');
    });
  });

  describe('removeLink', () => {
    it('should remove a link belonging to the user', () => {
      const link = store.addLink('U01', 'A', 'https://a.com');

      const result = store.removeLink('U01', link.id);
      expect(result).toBe(true);
      expect(store.getLinks('U01')).toHaveLength(0);
    });

    it('should not remove a link belonging to another user', () => {
      const link = store.addLink('U01', 'A', 'https://a.com');

      const result = store.removeLink('U02', link.id);
      expect(result).toBe(false);
      expect(store.getLinks('U01')).toHaveLength(1);
    });

    it('should return false for non-existent link', () => {
      expect(store.removeLink('U01', 9999)).toBe(false);
    });
  });

  describe('reorderLinks', () => {
    it('should reorder links by provided ID order', () => {
      const l1 = store.addLink('U01', 'A', 'https://a.com');
      const l2 = store.addLink('U01', 'B', 'https://b.com');
      const l3 = store.addLink('U01', 'C', 'https://c.com');

      store.reorderLinks('U01', [l3.id, l1.id, l2.id]);

      const links = store.getLinks('U01');
      expect(links[0].title).toBe('C');
      expect(links[1].title).toBe('A');
      expect(links[2].title).toBe('B');
    });

    it('should not reorder links belonging to another user', () => {
      const l1 = store.addLink('U01', 'A', 'https://a.com');
      const l2 = store.addLink('U02', 'B', 'https://b.com');

      const updated = store.reorderLinks('U01', [l2.id, l1.id]);
      expect(updated).toBe(1); // Only l1 was updated (belongs to U01)
    });

    it('should return 0 for empty array', () => {
      expect(store.reorderLinks('U01', [])).toBe(0);
    });
  });
});

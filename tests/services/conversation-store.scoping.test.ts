/**
 * Tests for per-user scoping on ConversationStore (#279).
 *
 * Every list/count/search/stats method accepts an optional
 * `userId?: string | string[]` parameter:
 *   - undefined → no filter (admin behavior)
 *   - string    → filter to one user
 *   - string[]  → filter to any user in the set (linked Slack+web identities)
 *   - []        → matches no rows (defensive — never produced by resolveIdentities)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ConversationStore } from '../../src/services/conversation-store.js';

describe('ConversationStore — per-user scoping (#279)', () => {
  let store: ConversationStore;
  let testDbPath: string;

  beforeEach(() => {
    testDbPath = path.join(
      os.tmpdir(),
      `test-scoping-${String(Date.now())}-${String(process.pid)}-${String(Math.random()).slice(2, 8)}.db`,
    );
    store = new ConversationStore(testDbPath, 24);
  });

  afterEach(() => {
    store.close();
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(testDbPath + suffix); } catch { /* ok */ }
    }
  });

  function seedConversations(): {
    aliceSlackId: string;
    aliceWebId: string;
    bobSlackId: string;
  } {
    const aliceSlackId = 'U01ABC';
    const aliceWebId = 'web:alice';
    const bobSlackId = 'U02DEF';

    const aliceSlackConv = store.createConversation('1.1', 'C001', aliceSlackId, [{ role: 'user', content: 'alice via slack about nginx' }]);
    const aliceWebConv = store.createConversation('1.2', 'C001', aliceWebId, [{ role: 'user', content: 'alice via web about postgres' }]);
    const bobConv = store.createConversation('1.3', 'C001', bobSlackId, [{ role: 'user', content: 'bob via slack about redis' }]);

    // Tags + favorites for filter tests
    store.addTag(aliceSlackConv.id, 'urgent');
    store.addTag(aliceWebConv.id, 'urgent');
    store.addTag(bobConv.id, 'urgent');
    store.addTag(bobConv.id, 'bobs-tag');
    store.toggleFavorite(aliceSlackConv.id);
    store.toggleFavorite(bobConv.id);

    return { aliceSlackId, aliceWebId, bobSlackId };
  }

  describe('listRecentSessions', () => {
    it('returns all rows when no userId is provided (admin behavior)', () => {
      seedConversations();
      expect(store.listRecentSessions().length).toBe(3);
    });

    it('filters by a single user id', () => {
      const { bobSlackId } = seedConversations();
      const sessions = store.listRecentSessions(20, 0, bobSlackId);
      expect(sessions.map((s) => s.userId)).toEqual([bobSlackId]);
    });

    it('filters by an array of identities (merged Slack + web)', () => {
      const { aliceSlackId, aliceWebId } = seedConversations();
      const sessions = store.listRecentSessions(20, 0, [aliceSlackId, aliceWebId]);
      const ids = sessions.map((s) => s.userId).sort();
      expect(ids).toEqual([aliceSlackId, aliceWebId].sort());
    });

    it('returns no rows for an empty array (defensive)', () => {
      seedConversations();
      expect(store.listRecentSessions(20, 0, [])).toEqual([]);
    });
  });

  describe('countSessions', () => {
    it('counts everything with no filter', () => {
      seedConversations();
      expect(store.countSessions()).toBe(3);
    });

    it('counts a single-user filter', () => {
      const { aliceSlackId } = seedConversations();
      expect(store.countSessions(aliceSlackId)).toBe(1);
    });

    it('counts a merged-identity filter', () => {
      const { aliceSlackId, aliceWebId } = seedConversations();
      expect(store.countSessions([aliceSlackId, aliceWebId])).toBe(2);
    });

    it('returns 0 for an empty array', () => {
      seedConversations();
      expect(store.countSessions([])).toBe(0);
    });
  });

  describe('searchConversations / countSearchResults', () => {
    it('search filters by user', () => {
      const { aliceSlackId, aliceWebId } = seedConversations();
      const merged = store.searchConversations('alice', 20, 0, [aliceSlackId, aliceWebId]);
      expect(merged).toHaveLength(2);

      const onlyBob = store.searchConversations('alice', 20, 0, ['U02DEF']);
      expect(onlyBob).toHaveLength(0);
    });

    it('countSearchResults filters by user', () => {
      const { aliceSlackId, aliceWebId } = seedConversations();
      expect(store.countSearchResults('alice', [aliceSlackId, aliceWebId])).toBe(2);
      expect(store.countSearchResults('alice', 'U02DEF')).toBe(0);
    });
  });

  describe('listFavoriteSessions / countFavoriteSessions', () => {
    it('lists favorites scoped to user', () => {
      const { aliceSlackId } = seedConversations();
      // Alice favorited her Slack conversation; Bob favorited his.
      const aliceFavs = store.listFavoriteSessions(20, 0, aliceSlackId);
      expect(aliceFavs.map((s) => s.userId)).toEqual([aliceSlackId]);
    });

    it('counts favorites scoped to user', () => {
      const { aliceSlackId, aliceWebId } = seedConversations();
      expect(store.countFavoriteSessions([aliceSlackId, aliceWebId])).toBe(1);
      expect(store.countFavoriteSessions()).toBe(2); // admin sees all
    });
  });

  describe('listSessionsByTag / countSessionsByTag', () => {
    it('lists tag-tagged sessions scoped to user', () => {
      const { aliceSlackId, aliceWebId } = seedConversations();
      const sessions = store.listSessionsByTag('urgent', 20, 0, [aliceSlackId, aliceWebId]);
      expect(sessions).toHaveLength(2);
    });

    it('counts tag sessions scoped to user', () => {
      const { aliceSlackId, aliceWebId } = seedConversations();
      expect(store.countSessionsByTag('urgent', [aliceSlackId, aliceWebId])).toBe(2);
      expect(store.countSessionsByTag('urgent')).toBe(3);
    });

    it('returns zero when the user has no rows for that tag', () => {
      const { aliceSlackId } = seedConversations();
      expect(store.listSessionsByTag('bobs-tag', 20, 0, aliceSlackId)).toEqual([]);
      expect(store.countSessionsByTag('bobs-tag', aliceSlackId)).toBe(0);
    });
  });

  describe('listArchivedSessions / countArchivedSessions', () => {
    it('scopes archived listings to the user', () => {
      const { aliceSlackId, bobSlackId } = seedConversations();
      const aliceConv = store.getConversation('1.1', 'C001');
      const bobConv = store.getConversation('1.3', 'C001');
      if (aliceConv) store.archiveConversation(aliceConv.id);
      if (bobConv) store.archiveConversation(bobConv.id);

      expect(store.listArchivedSessions(20, 0, aliceSlackId)).toHaveLength(1);
      expect(store.listArchivedSessions(20, 0, bobSlackId)).toHaveLength(1);
      expect(store.listArchivedSessions()).toHaveLength(2);
      expect(store.countArchivedSessions(aliceSlackId)).toBe(1);
      expect(store.countArchivedSessions()).toBe(2);
    });
  });

  describe('listAllTags', () => {
    it('only includes tags from the user’s conversations', () => {
      const { aliceSlackId, aliceWebId, bobSlackId } = seedConversations();
      const aliceTags = store.listAllTags([aliceSlackId, aliceWebId]).map((t) => t.name);
      expect(aliceTags).toContain('urgent');
      expect(aliceTags).not.toContain('bobs-tag');

      const bobTags = store.listAllTags(bobSlackId).map((t) => t.name);
      expect(bobTags).toContain('bobs-tag');

      expect(store.listAllTags().map((t) => t.name).sort()).toEqual(['bobs-tag', 'urgent']);
    });

    it('counts only the user’s tagged conversations', () => {
      const { aliceSlackId, aliceWebId } = seedConversations();
      const tags = store.listAllTags([aliceSlackId, aliceWebId]);
      const urgent = tags.find((t) => t.name === 'urgent');
      expect(urgent?.count).toBe(2);
    });
  });

  describe('getSessionStats', () => {
    it('produces user-scoped totals', () => {
      const { aliceSlackId, aliceWebId } = seedConversations();
      const aliceStats = store.getSessionStats(24, [aliceSlackId, aliceWebId]);
      expect(aliceStats.totalSessions).toBe(2);

      const bobStats = store.getSessionStats(24, 'U02DEF');
      expect(bobStats.totalSessions).toBe(1);

      const allStats = store.getSessionStats(24);
      expect(allStats.totalSessions).toBe(3);
    });

    it('does not collide caches between scoped and unscoped calls', () => {
      const { aliceSlackId } = seedConversations();
      const before = store.getSessionStats(24, aliceSlackId).totalSessions;
      const all = store.getSessionStats(24).totalSessions;
      expect(before).toBe(1);
      expect(all).toBe(3);
    });
  });
});

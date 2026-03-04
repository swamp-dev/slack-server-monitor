import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';

// Mock the logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { SessionStore, getSessionStore, closeSessionStore } from '../../src/services/session-store.js';

describe('SessionStore', () => {
  let store: SessionStore;
  let dbPath: string;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-store-test-'));
    dbPath = path.join(tmpDir, 'test.db');
    store = new SessionStore(dbPath, 72);
  });

  afterEach(() => {
    store.close();
    closeSessionStore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('createSession', () => {
    it('should create a session with a 64-char hex ID', () => {
      const session = store.createSession('UTESTUSER', false);
      expect(session.sessionId).toMatch(/^[a-f0-9]{64}$/);
      expect(session.userId).toBe('UTESTUSER');
      expect(session.isAdmin).toBe(false);
    });

    it('should create an admin session', () => {
      const session = store.createSession('UADMIN', true);
      expect(session.isAdmin).toBe(true);
    });

    it('should set expiry based on TTL hours', () => {
      const before = Date.now();
      const session = store.createSession('UTESTUSER', false);
      const after = Date.now();

      const expectedMinExpiry = before + 72 * 60 * 60 * 1000;
      const expectedMaxExpiry = after + 72 * 60 * 60 * 1000;

      expect(session.expiresAt).toBeGreaterThanOrEqual(expectedMinExpiry);
      expect(session.expiresAt).toBeLessThanOrEqual(expectedMaxExpiry);
    });
  });

  describe('getSession', () => {
    it('should retrieve a valid session', () => {
      const created = store.createSession('UTESTUSER', false);
      const retrieved = store.getSession(created.sessionId);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.userId).toBe('UTESTUSER');
      expect(retrieved?.isAdmin).toBe(false);
    });

    it('should return null for non-existent session', () => {
      const result = store.getSession('nonexistentsessionid'.padEnd(64, '0'));
      expect(result).toBeNull();
    });

    it('should return null for expired session', () => {
      // Create a store with 0-hour TTL (immediately expires)
      const shortStore = new SessionStore(dbPath, 0);
      const session = shortStore.createSession('UTESTUSER', false);

      // The session expires at creation time (ttl=0), so it should be expired
      const result = shortStore.getSession(session.sessionId);
      expect(result).toBeNull();
      shortStore.close();
    });
  });

  describe('deleteSession', () => {
    it('should delete an existing session', () => {
      const session = store.createSession('UTESTUSER', false);
      store.deleteSession(session.sessionId);

      const result = store.getSession(session.sessionId);
      expect(result).toBeNull();
    });

    it('should not throw for non-existent session', () => {
      expect(() => store.deleteSession('nonexistent'.padEnd(64, '0'))).not.toThrow();
    });
  });

  describe('deleteSessionsForUser', () => {
    it('should delete all sessions for a specific user', () => {
      store.createSession('UTARGET', false);
      store.createSession('UTARGET', false);
      const otherSession = store.createSession('UOTHER', false);

      store.deleteSessionsForUser('UTARGET');

      // Other user's session should remain
      const other = store.getSession(otherSession.sessionId);
      expect(other).not.toBeNull();
    });

    it('should not throw for user with no sessions', () => {
      expect(() => store.deleteSessionsForUser('UNOSESSIONS')).not.toThrow();
    });
  });

  describe('cleanupExpired', () => {
    it('should remove expired sessions', () => {
      // Create a store with 0-hour TTL
      const shortStore = new SessionStore(dbPath, 0);
      shortStore.createSession('USER1', false);
      shortStore.createSession('USER2', false);

      const cleaned = shortStore.cleanupExpired();
      expect(cleaned).toBe(2);
      shortStore.close();
    });

    it('should not remove valid sessions', () => {
      store.createSession('USER1', false);
      store.createSession('USER2', false);

      const cleaned = store.cleanupExpired();
      expect(cleaned).toBe(0);
    });
  });

  describe('admin vs user sessions', () => {
    it('should distinguish admin from user sessions', () => {
      const adminSession = store.createSession('UADMIN', true);
      const userSession = store.createSession('UUSER', false);

      const admin = store.getSession(adminSession.sessionId);
      const user = store.getSession(userSession.sessionId);

      expect(admin?.isAdmin).toBe(true);
      expect(user?.isAdmin).toBe(false);
    });
  });

  describe('singleton', () => {
    it('should return same instance for getSessionStore', () => {
      closeSessionStore();
      const s1 = getSessionStore(dbPath, 72);
      const s2 = getSessionStore(dbPath, 72);
      expect(s1).toBe(s2);
      closeSessionStore();
    });
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { PluginDatabase } from '../../src/services/plugin-database.js';
import { linkIssueToThread, getLinkForIssue, getLinksForThread } from './linking.js';

let db: Database.Database;
let pluginDb: PluginDatabase;

function setupTestDb(): void {
  db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  pluginDb = new PluginDatabase(db, 'agentbox');
  pluginDb.exec(`
    CREATE TABLE IF NOT EXISTS plugin_agentbox_issue_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      issue_number INTEGER NOT NULL,
      repo TEXT NOT NULL,
      thread_ts TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(issue_number, repo)
    )
  `);
}

function teardownTestDb(): void { db.close(); }

describe('linkIssueToThread', () => {
  beforeEach(() => setupTestDb());
  afterEach(() => teardownTestDb());

  it('inserts a new link', () => {
    linkIssueToThread(pluginDb, {
      issueNumber: 42, repo: 'swamp-dev/slack-server-monitor',
      threadTs: '1234.5678', channelId: 'C0123ABC', createdBy: 'U0123DEF', createdAt: Date.now(),
    });
    const link = getLinkForIssue(pluginDb, 42, 'swamp-dev/slack-server-monitor');
    expect(link).not.toBeNull();
    expect(link!.issueNumber).toBe(42);
    expect(link!.threadTs).toBe('1234.5678');
  });

  it('upserts on duplicate (same issue_number + repo)', () => {
    linkIssueToThread(pluginDb, { issueNumber: 42, repo: 'org/repo', threadTs: '1111.1111', channelId: 'C111', createdBy: 'U111', createdAt: 1000 });
    linkIssueToThread(pluginDb, { issueNumber: 42, repo: 'org/repo', threadTs: '2222.2222', channelId: 'C222', createdBy: 'U222', createdAt: 2000 });
    const link = getLinkForIssue(pluginDb, 42, 'org/repo');
    expect(link!.threadTs).toBe('2222.2222');
  });

  it('allows same issue number in different repos', () => {
    linkIssueToThread(pluginDb, { issueNumber: 1, repo: 'org/repo-a', threadTs: '1111.0000', channelId: 'C1', createdBy: 'U1', createdAt: Date.now() });
    linkIssueToThread(pluginDb, { issueNumber: 1, repo: 'org/repo-b', threadTs: '2222.0000', channelId: 'C2', createdBy: 'U2', createdAt: Date.now() });
    expect(getLinkForIssue(pluginDb, 1, 'org/repo-a')!.threadTs).toBe('1111.0000');
    expect(getLinkForIssue(pluginDb, 1, 'org/repo-b')!.threadTs).toBe('2222.0000');
  });
});

describe('getLinkForIssue', () => {
  beforeEach(() => setupTestDb());
  afterEach(() => teardownTestDb());

  it('returns null when no link exists', () => {
    expect(getLinkForIssue(pluginDb, 999, 'org/nonexistent')).toBeNull();
  });
});

describe('getLinksForThread', () => {
  beforeEach(() => setupTestDb());
  afterEach(() => teardownTestDb());

  it('returns all issues linked to a thread', () => {
    const threadTs = '1234.5678';
    linkIssueToThread(pluginDb, { issueNumber: 10, repo: 'org/repo', threadTs, channelId: 'C1', createdBy: 'U1', createdAt: Date.now() });
    linkIssueToThread(pluginDb, { issueNumber: 11, repo: 'org/repo', threadTs, channelId: 'C1', createdBy: 'U1', createdAt: Date.now() });
    const links = getLinksForThread(pluginDb, threadTs);
    expect(links).toHaveLength(2);
    expect(links.map((l) => l.issueNumber).sort()).toEqual([10, 11]);
  });

  it('returns empty array when no links exist', () => {
    expect(getLinksForThread(pluginDb, '9999.9999')).toEqual([]);
  });
});

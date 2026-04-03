/**
 * AgentBox Plugin Skeleton Tests
 *
 * Tests for: plugin shape, database schema creation, config loading,
 * /agentbox status command, and destroy cleanup.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { PluginDatabase } from '../../../src/services/plugin-database.js';

// Import the plugin
import agentboxPlugin from '../../../plugins.example/agentbox.js';
import { loadAgentboxConfig } from '../../../plugins.example/agentbox/config.js';
import {
  createSchema,
  insertRun,
  getRecentRuns,
  insertIssueLink,
  getIssueLinkByIssue,
  getIssueLinksForThread,
  type AgentboxRun,
} from '../../../plugins.example/agentbox/schema.js';

// =============================================================================
// Plugin Shape
// =============================================================================

describe('agentbox plugin shape', () => {
  it('should export a valid Plugin object', () => {
    expect(agentboxPlugin.name).toBe('agentbox');
    expect(agentboxPlugin.version).toBeDefined();
    expect(typeof agentboxPlugin.version).toBe('string');
  });

  it('should have init and destroy hooks', () => {
    expect(typeof agentboxPlugin.init).toBe('function');
    expect(typeof agentboxPlugin.destroy).toBe('function');
  });

  it('should have registerCommands', () => {
    expect(typeof agentboxPlugin.registerCommands).toBe('function');
  });

  it('should have helpEntries', () => {
    expect(agentboxPlugin.helpEntries).toBeDefined();
    expect(agentboxPlugin.helpEntries?.length).toBeGreaterThan(0);
    expect(agentboxPlugin.helpEntries?.[0].command).toContain('/agentbox');
  });
});

// =============================================================================
// Config Loading
// =============================================================================

describe('loadAgentboxConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore env
    process.env = { ...originalEnv };
  });

  it('should load defaults when no env vars are set', () => {
    delete process.env.AGENTBOX_ENABLED;
    delete process.env.AGENTBOX_BINARY_PATH;
    delete process.env.AGENTBOX_WORK_DIR;
    delete process.env.AGENTBOX_DEFAULT_REPO;

    const config = loadAgentboxConfig();
    expect(config.enabled).toBe(false);
    expect(config.binaryPath).toBe('/root/agentbox/agentbox');
    expect(config.workDir).toBe('./data/agentbox-runs');
    expect(config.defaultRepo).toBe('');
  });

  it('should read env vars when set', () => {
    process.env.AGENTBOX_ENABLED = 'true';
    process.env.AGENTBOX_BINARY_PATH = '/usr/local/bin/agentbox';
    process.env.AGENTBOX_WORK_DIR = '/tmp/agentbox';
    process.env.AGENTBOX_DEFAULT_REPO = 'swamp-dev/slack-server-monitor';

    const config = loadAgentboxConfig();
    expect(config.enabled).toBe(true);
    expect(config.binaryPath).toBe('/usr/local/bin/agentbox');
    expect(config.workDir).toBe('/tmp/agentbox');
    expect(config.defaultRepo).toBe('swamp-dev/slack-server-monitor');
  });

  it('should treat AGENTBOX_ENABLED as false for any non-true value', () => {
    process.env.AGENTBOX_ENABLED = 'yes';
    expect(loadAgentboxConfig().enabled).toBe(false);

    process.env.AGENTBOX_ENABLED = '1';
    expect(loadAgentboxConfig().enabled).toBe(false);

    process.env.AGENTBOX_ENABLED = 'TRUE';
    expect(loadAgentboxConfig().enabled).toBe(false);

    process.env.AGENTBOX_ENABLED = 'true';
    expect(loadAgentboxConfig().enabled).toBe(true);
  });
});

// =============================================================================
// Database Schema
// =============================================================================

describe('database schema', () => {
  let rawDb: Database.Database;
  let db: PluginDatabase;

  beforeEach(() => {
    rawDb = new Database(':memory:');
    db = new PluginDatabase(rawDb, 'agentbox');
  });

  afterEach(() => {
    rawDb.close();
  });

  it('should create plugin_agentbox_runs table', () => {
    createSchema(db);

    const tableInfo = rawDb
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
      )
      .get(`${db.prefix}runs`);
    expect(tableInfo).toBeDefined();
  });

  it('should create plugin_agentbox_issue_links table', () => {
    createSchema(db);

    const tableInfo = rawDb
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
      )
      .get(`${db.prefix}issue_links`);
    expect(tableInfo).toBeDefined();
  });

  it('should create runs table with correct columns', () => {
    createSchema(db);

    const columns = rawDb
      .prepare(`PRAGMA table_info(${db.prefix}runs)`)
      .all() as { name: string; type: string; notnull: number }[];
    const colNames = columns.map((c) => c.name);

    expect(colNames).toContain('id');
    expect(colNames).toContain('issue_number');
    expect(colNames).toContain('repo');
    expect(colNames).toContain('status');
    expect(colNames).toContain('branch');
    expect(colNames).toContain('pr_url');
    expect(colNames).toContain('started_at');
    expect(colNames).toContain('finished_at');
    expect(colNames).toContain('output_path');
    expect(colNames).toContain('error');
    expect(colNames).toContain('created_at');
  });

  it('should create issue_links table with correct columns', () => {
    createSchema(db);

    const columns = rawDb
      .prepare(`PRAGMA table_info(${db.prefix}issue_links)`)
      .all() as { name: string }[];
    const colNames = columns.map((c) => c.name);

    expect(colNames).toContain('id');
    expect(colNames).toContain('issue_number');
    expect(colNames).toContain('repo');
    expect(colNames).toContain('thread_ts');
    expect(colNames).toContain('channel_id');
    expect(colNames).toContain('created_by');
    expect(colNames).toContain('created_at');
  });

  it('should be idempotent (can run createSchema twice)', () => {
    createSchema(db);
    expect(() => createSchema(db)).not.toThrow();
  });
});

// =============================================================================
// Runs CRUD
// =============================================================================

describe('runs operations', () => {
  let rawDb: Database.Database;
  let db: PluginDatabase;

  beforeEach(() => {
    rawDb = new Database(':memory:');
    db = new PluginDatabase(rawDb, 'agentbox');
    createSchema(db);
  });

  afterEach(() => {
    rawDb.close();
  });

  it('should insert a run and retrieve it', () => {
    const id = insertRun(db, {
      issueNumber: 155,
      repo: 'swamp-dev/slack-server-monitor',
      status: 'pending',
    });

    expect(id).toBeGreaterThan(0);

    const runs = getRecentRuns(db, 5);
    expect(runs).toHaveLength(1);
    expect(runs[0].issueNumber).toBe(155);
    expect(runs[0].repo).toBe('swamp-dev/slack-server-monitor');
    expect(runs[0].status).toBe('pending');
  });

  it('should return recent runs in descending order by id', () => {
    insertRun(db, { issueNumber: 1, repo: 'r', status: 'success' });
    insertRun(db, { issueNumber: 2, repo: 'r', status: 'running' });
    insertRun(db, { issueNumber: 3, repo: 'r', status: 'pending' });

    const runs = getRecentRuns(db, 5);
    expect(runs).toHaveLength(3);
    // Auto-increment IDs ensure ordering even when timestamps are identical
    expect(runs[0].issueNumber).toBe(3); // Highest ID first
    expect(runs[2].issueNumber).toBe(1);
  });

  it('should respect the limit parameter', () => {
    for (let i = 1; i <= 10; i++) {
      insertRun(db, { issueNumber: i, repo: 'r', status: 'success' });
    }

    const runs = getRecentRuns(db, 3);
    expect(runs).toHaveLength(3);
  });

  it('should return empty array when no runs exist', () => {
    const runs = getRecentRuns(db, 5);
    expect(runs).toEqual([]);
  });

  it('should enforce valid status values', () => {
    expect(() =>
      insertRun(db, { issueNumber: 1, repo: 'r', status: 'invalid' as AgentboxRun['status'] }),
    ).toThrow();
  });

  it('should reject NaN issue number', () => {
    expect(() =>
      insertRun(db, { issueNumber: NaN, repo: 'r', status: 'pending' }),
    ).toThrow('Invalid issue number');
  });

  it('should reject negative issue number', () => {
    expect(() =>
      insertRun(db, { issueNumber: -1, repo: 'r', status: 'pending' }),
    ).toThrow('Invalid issue number');
  });

  it('should reject zero issue number', () => {
    expect(() =>
      insertRun(db, { issueNumber: 0, repo: 'r', status: 'pending' }),
    ).toThrow('Invalid issue number');
  });
});

// =============================================================================
// Issue Links CRUD
// =============================================================================

describe('issue links operations', () => {
  let rawDb: Database.Database;
  let db: PluginDatabase;

  beforeEach(() => {
    rawDb = new Database(':memory:');
    db = new PluginDatabase(rawDb, 'agentbox');
    createSchema(db);
  });

  afterEach(() => {
    rawDb.close();
  });

  it('should insert and retrieve a link by issue', () => {
    insertIssueLink(db, {
      issueNumber: 155,
      repo: 'swamp-dev/slack-server-monitor',
      threadTs: '1234567890.123456',
      channelId: 'C01ABC123',
      createdBy: 'U01DEF456',
    });

    const link = getIssueLinkByIssue(db, 155, 'swamp-dev/slack-server-monitor');
    expect(link).toBeDefined();
    expect(link?.threadTs).toBe('1234567890.123456');
    expect(link?.channelId).toBe('C01ABC123');
    expect(link?.createdBy).toBe('U01DEF456');
  });

  it('should return null for non-existent issue link', () => {
    const link = getIssueLinkByIssue(db, 999, 'no/repo');
    expect(link).toBeNull();
  });

  it('should retrieve links by thread', () => {
    const threadTs = '1234567890.123456';
    insertIssueLink(db, {
      issueNumber: 155,
      repo: 'swamp-dev/slack-server-monitor',
      threadTs,
      channelId: 'C01ABC123',
      createdBy: 'U01DEF456',
    });
    insertIssueLink(db, {
      issueNumber: 156,
      repo: 'swamp-dev/slack-server-monitor',
      threadTs,
      channelId: 'C01ABC123',
      createdBy: 'U01DEF456',
    });

    const links = getIssueLinksForThread(db, threadTs);
    expect(links).toHaveLength(2);
  });

  it('should upsert on duplicate issue_number + repo', () => {
    insertIssueLink(db, {
      issueNumber: 155,
      repo: 'swamp-dev/slack-server-monitor',
      threadTs: 'thread-1',
      channelId: 'C01',
      createdBy: 'U01',
    });
    insertIssueLink(db, {
      issueNumber: 155,
      repo: 'swamp-dev/slack-server-monitor',
      threadTs: 'thread-2',
      channelId: 'C02',
      createdBy: 'U02',
    });

    const link = getIssueLinkByIssue(db, 155, 'swamp-dev/slack-server-monitor');
    expect(link?.threadTs).toBe('thread-2'); // Updated
    expect(link?.channelId).toBe('C02');
  });

  it('should return empty array for thread with no links', () => {
    const links = getIssueLinksForThread(db, 'no-such-thread');
    expect(links).toEqual([]);
  });
});

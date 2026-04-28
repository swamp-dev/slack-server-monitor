import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { PluginDatabase } from '../../src/services/plugin-database.js';

let db: Database.Database;
let pluginDb: PluginDatabase;

function setupTestDb(): void {
  db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  pluginDb = new PluginDatabase(db, 'agentbox');
}

function teardownTestDb(): void { db.close(); }

function createMockContext() {
  return {
    db: pluginDb, name: 'agentbox', version: '1.0.0',
    notify: vi.fn(),
    sse: { broadcast: vi.fn(), clientCount: () => 0 },
  };
}

describe('agentbox plugin', () => {
  it('exports a valid Plugin shape', async () => {
    const { default: plugin } = await import('../agentbox.js');
    expect(plugin.name).toBe('agentbox');
    expect(plugin.version).toBeDefined();
    expect(typeof plugin.init).toBe('function');
    expect(typeof plugin.destroy).toBe('function');
    expect(typeof plugin.registerCommands).toBe('function');
    expect(Array.isArray(plugin.helpEntries)).toBe(true);
    expect(Array.isArray(plugin.tools)).toBe(true);
    expect(plugin.tools!.length).toBe(5);
  });
});

describe('agentbox init()', () => {
  beforeEach(() => setupTestDb());
  afterEach(() => teardownTestDb());

  it('creates plugin_agentbox_runs table with correct columns', async () => {
    const { default: plugin } = await import('../agentbox.js');
    await plugin.init!(createMockContext());

    const columns = db.prepare('PRAGMA table_info(plugin_agentbox_runs)').all() as Array<{ name: string; type: string; notnull: number; pk: number }>;
    const colNames = columns.map((c) => c.name);
    expect(colNames).toEqual([
      'id', 'issue_number', 'repo', 'status', 'branch', 'pr_url',
      'started_at', 'finished_at', 'output_path', 'error', 'created_at',
      'session_id', 'progress_pct', 'tasks_total', 'tasks_completed',
      'prd_path', 'cancelled_by', 'paused_at',
    ]);
    expect(columns.find((c) => c.name === 'id')!.pk).toBe(1);
    expect(columns.find((c) => c.name === 'created_at')!.notnull).toBe(1);

    expect(() => {
      pluginDb.prepare(`INSERT INTO plugin_agentbox_runs (issue_number, repo, status, created_at) VALUES (?, ?, ?, ?)`).run(1, 'org/repo', 'invalid_status', Date.now());
    }).toThrow();

    pluginDb.prepare(`INSERT INTO plugin_agentbox_runs (issue_number, repo, status, created_at) VALUES (?, ?, ?, ?)`).run(1, 'org/repo', 'pending', Date.now());
  });

  it('creates plugin_agentbox_issue_links table with correct constraints', async () => {
    const { default: plugin } = await import('../agentbox.js');
    await plugin.init!(createMockContext());

    const columns = db.prepare('PRAGMA table_info(plugin_agentbox_issue_links)').all() as Array<{ name: string; notnull: number }>;
    const colNames = columns.map((c) => c.name);
    expect(colNames).toEqual(['id', 'issue_number', 'repo', 'thread_ts', 'channel_id', 'created_by', 'created_at']);

    for (const col of ['issue_number', 'repo', 'thread_ts', 'channel_id', 'created_by', 'created_at']) {
      expect(columns.find((c) => c.name === col)!.notnull).toBe(1);
    }

    const insert = `INSERT INTO plugin_agentbox_issue_links (issue_number, repo, thread_ts, channel_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)`;
    pluginDb.prepare(insert).run(1, 'org/repo', '1234.5678', 'C123', 'U123', Date.now());
    expect(() => { pluginDb.prepare(insert).run(1, 'org/repo', '9999.0000', 'C456', 'U456', Date.now()); }).toThrow();
  });

  it('is idempotent', async () => {
    const { default: plugin } = await import('../agentbox.js');
    const ctx = createMockContext();
    await plugin.init!(ctx);
    await plugin.init!(ctx);
    pluginDb.prepare(`INSERT INTO plugin_agentbox_runs (issue_number, repo, status, created_at) VALUES (?, ?, ?, ?)`).run(1, 'org/repo', 'pending', Date.now());
  });
});

describe('/agentbox status', () => {
  beforeEach(() => setupTestDb());
  afterEach(() => teardownTestDb());

  it('returns "No AgentBox runs yet" when empty', async () => {
    const { default: plugin, handleStatus } = await import('../agentbox.js');
    await plugin.init!(createMockContext());
    expect(handleStatus(pluginDb)).toMatch(/no.*runs yet/i);
  });

  it('returns formatted runs when data exists', async () => {
    const { default: plugin, handleStatus } = await import('../agentbox.js');
    await plugin.init!(createMockContext());
    pluginDb.prepare(`INSERT INTO plugin_agentbox_runs (issue_number, repo, status, created_at) VALUES (?, ?, ?, ?)`).run(42, 'swamp-dev/slack-server-monitor', 'success', Date.now());
    const result = handleStatus(pluginDb);
    expect(result).toContain('#42');
    expect(result).toContain('SUCCESS');
  });
});

describe('agentbox destroy()', () => {
  beforeEach(() => setupTestDb());
  afterEach(() => teardownTestDb());

  it('sets pluginDb to null', async () => {
    const { default: plugin, getPluginDb } = await import('../agentbox.js');
    const ctx = createMockContext();
    await plugin.init!(ctx);
    expect(getPluginDb()).not.toBeNull();
    await plugin.destroy!(ctx);
    expect(getPluginDb()).toBeNull();
  });
});

describe('migrateRunsTable()', () => {
  beforeEach(() => setupTestDb());
  afterEach(() => teardownTestDb());

  it('adds new columns to an existing runs table without them', async () => {
    // Create legacy table (without new columns)
    pluginDb.exec(`
      CREATE TABLE IF NOT EXISTS ${pluginDb.prefix}runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        issue_number INTEGER,
        repo TEXT,
        status TEXT CHECK(status IN ('pending','running','success','failed','cancelled')),
        branch TEXT,
        pr_url TEXT,
        started_at INTEGER,
        finished_at INTEGER,
        output_path TEXT,
        error TEXT,
        created_at INTEGER NOT NULL
      )
    `);

    // Insert a legacy row
    pluginDb.prepare(
      `INSERT INTO ${pluginDb.prefix}runs (issue_number, repo, status, created_at) VALUES (?, ?, ?, ?)`
    ).run(1, 'org/repo', 'pending', Date.now());

    // Run migration
    const { migrateRunsTable } = await import('../agentbox.js');
    migrateRunsTable(pluginDb);

    // Verify new columns exist
    const columns = db.prepare(`PRAGMA table_info(${pluginDb.prefix}runs)`).all() as Array<{ name: string }>;
    const colNames = new Set(columns.map((c) => c.name));
    expect(colNames.has('session_id')).toBe(true);
    expect(colNames.has('progress_pct')).toBe(true);
    expect(colNames.has('tasks_total')).toBe(true);
    expect(colNames.has('tasks_completed')).toBe(true);
    expect(colNames.has('prd_path')).toBe(true);
    expect(colNames.has('cancelled_by')).toBe(true);
    expect(colNames.has('paused_at')).toBe(true);

    // Verify existing data is preserved
    const row = pluginDb.prepare(`SELECT * FROM ${pluginDb.prefix}runs WHERE issue_number = 1`).get() as Record<string, unknown>;
    expect(row.repo).toBe('org/repo');
    expect(row.status).toBe('pending');
    expect(row.session_id).toBeNull();
    expect(row.progress_pct).toBe(0);
  });

  it('is idempotent — running twice does not error', async () => {
    const { default: plugin, migrateRunsTable } = await import('../agentbox.js');
    await plugin.init!(createMockContext());

    // Run migration again on already-migrated table
    migrateRunsTable(pluginDb);

    const columns = db.prepare(`PRAGMA table_info(${pluginDb.prefix}runs)`).all() as Array<{ name: string }>;
    const colNames = columns.map((c) => c.name);
    // Should still have exactly the expected columns (no duplicates)
    const uniqueNames = [...new Set(colNames)];
    expect(colNames).toEqual(uniqueNames);
    expect(colNames.length).toBe(18);
  });

  it('sets progress_pct default to 0 for new rows', async () => {
    const { default: plugin } = await import('../agentbox.js');
    await plugin.init!(createMockContext());

    pluginDb.prepare(
      `INSERT INTO ${pluginDb.prefix}runs (issue_number, repo, status, created_at) VALUES (?, ?, ?, ?)`
    ).run(99, 'org/repo', 'pending', Date.now());

    const row = pluginDb.prepare(
      `SELECT progress_pct FROM ${pluginDb.prefix}runs WHERE issue_number = 99`
    ).get() as { progress_pct: number };
    expect(row.progress_pct).toBe(0);
  });

  it('allows writing and reading all new columns', async () => {
    const { default: plugin } = await import('../agentbox.js');
    await plugin.init!(createMockContext());

    pluginDb.prepare(`
      INSERT INTO ${pluginDb.prefix}runs
        (issue_number, repo, status, created_at, session_id, progress_pct, tasks_total, tasks_completed, prd_path, cancelled_by, paused_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(42, 'org/repo', 'running', Date.now(), 'sess-abc-123', 75, 10, 7, '/work/prd.json', null, null);

    const row = pluginDb.prepare(
      `SELECT session_id, progress_pct, tasks_total, tasks_completed, prd_path, cancelled_by, paused_at
       FROM ${pluginDb.prefix}runs WHERE issue_number = 42`
    ).get() as Record<string, unknown>;

    expect(row.session_id).toBe('sess-abc-123');
    expect(row.progress_pct).toBe(75);
    expect(row.tasks_total).toBe(10);
    expect(row.tasks_completed).toBe(7);
    expect(row.prd_path).toBe('/work/prd.json');
    expect(row.cancelled_by).toBeNull();
    expect(row.paused_at).toBeNull();
  });
});

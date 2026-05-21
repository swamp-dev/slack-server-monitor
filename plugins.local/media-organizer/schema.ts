import type { PluginDatabase } from '../../src/services/plugin-database.js';

export function createSchema(db: PluginDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${db.prefix}runs (
      id TEXT PRIMARY KEY NOT NULL,
      started_at INT,
      completed_at INT,
      dry_run INT,
      total_files INT,
      pictures INT,
      videos INT,
      audio INT,
      documents INT,
      dedup_skipped INT,
      errors INT,
      duration_secs INT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS ${db.prefix}events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      event_type TEXT,
      inbox_name TEXT,
      user TEXT,
      media_type TEXT,
      src_path TEXT,
      dst_path TEXT,
      size_bytes INT,
      hash TEXT,
      reason TEXT,
      detected_mime TEXT,
      ts INT NOT NULL
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS ${db.prefix}events_ts ON ${db.prefix}events (ts)
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS ${db.prefix}events_run_id ON ${db.prefix}events (run_id)
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS ${db.prefix}events_inbox_name ON ${db.prefix}events (inbox_name)
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS ${db.prefix}events_event_type ON ${db.prefix}events (event_type)
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS ${db.prefix}inboxes (
      name TEXT PRIMARY KEY NOT NULL,
      user TEXT NOT NULL,
      last_file_organized_at INT,
      files_last_24h INT DEFAULT 0,
      files_last_7d INT DEFAULT 0,
      quarantine_count INT DEFAULT 0,
      health TEXT DEFAULT 'unknown'
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS ${db.prefix}cursor (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    )
  `);
}

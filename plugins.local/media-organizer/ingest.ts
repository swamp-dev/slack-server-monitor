import fs from 'fs';
import { logger } from '../../src/utils/logger.js';
import type { PluginDatabase } from '../../src/services/plugin-database.js';
import type { PluginSSE, PluginContext } from '../../src/plugins/types.js';
import { recomputeInboxHealth } from './health.js';

const CURSOR_KEY = 'events_jsonl_offset';

function getCursor(db: PluginDatabase): number {
  const row = db
    .prepare<[string], { value: string }>(
      `SELECT value FROM ${db.prefix}cursor WHERE key = ?`
    )
    .get([CURSOR_KEY]) as { value: string } | undefined;
  return row ? parseInt(row.value, 10) : 0;
}

function setCursor(db: PluginDatabase, offset: number): void {
  db.prepare<[string, string]>(
    `INSERT OR REPLACE INTO ${db.prefix}cursor (key, value) VALUES (?, ?)`
  ).run([CURSOR_KEY, String(offset)]);
}

interface EventPayload {
  type: string;
  ts?: number;
  data?: Record<string, unknown>;
}

export function processNewEvents(
  db: PluginDatabase,
  eventsPath: string,
  sse: PluginSSE
): number {
  if (!fs.existsSync(eventsPath)) {
    return 0;
  }

  const stat = fs.statSync(eventsPath);
  let cursor = getCursor(db);

  // Copytruncate: file shrank below cursor — re-read from byte 0.
  // Don't persist the reset here; the transaction writes the final position
  // atomically, so on crash the old cursor is still in DB and copytruncate
  // is re-detected on restart.
  if (stat.size < cursor) {
    cursor = 0;
  }

  if (stat.size === cursor) {
    return 0;
  }

  const bytesToRead = stat.size - cursor;
  const buffer = Buffer.alloc(bytesToRead);
  const fd = fs.openSync(eventsPath, 'r');
  try {
    fs.readSync(fd, buffer, 0, bytesToRead, cursor);
  } finally {
    fs.closeSync(fd);
  }

  const lines = buffer.toString('utf8').split('\n').filter((l) => l.trim() !== '');

  let newRows = 0;
  const affectedInboxes = new Set<string>();

  db.transaction(() => {
    for (const line of lines) {
      let event: EventPayload;
      try {
        event = JSON.parse(line) as EventPayload;
      } catch {
        logger.warn('media-organizer ingestor: skipping malformed JSON line', {
          preview: line.slice(0, 80),
        });
        continue;
      }

      const { type: eventType, ts = Math.floor(Date.now() / 1000), data = {} } = event;

      if (eventType === 'run_start') {
        db.prepare(
          `INSERT OR IGNORE INTO ${db.prefix}runs (id, started_at, dry_run) VALUES (?, ?, ?)`
        ).run([data['run_id'] ?? null, ts, data['dry_run'] ? 1 : 0]);
      } else if (eventType === 'run_complete') {
        db.prepare(`
          UPDATE ${db.prefix}runs SET
            completed_at = ?, duration_secs = ?, total_files = ?,
            pictures = ?, videos = ?, audio = ?, documents = ?,
            dedup_skipped = ?, errors = ?
          WHERE id = ?
        `).run([
          ts,
          data['duration_secs'] ?? null,
          data['total_files'] ?? null,
          data['pictures'] ?? null,
          data['videos'] ?? null,
          data['audio'] ?? null,
          data['documents'] ?? null,
          data['dedup_skipped'] ?? null,
          data['errors'] ?? null,
          data['run_id'] ?? null,
        ]);
      } else {
        const inboxName = (data['inbox_name'] as string) ?? null;
        db.prepare(`
          INSERT INTO ${db.prefix}events
            (run_id, event_type, inbox_name, user, media_type, src_path, dst_path,
             size_bytes, hash, reason, detected_mime, ts)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run([
          data['run_id'] ?? null,
          eventType,
          inboxName,
          (data['user'] as string) ?? null,
          (data['media_type'] as string) ?? null,
          (data['src_path'] as string) ?? null,
          (data['dst_path'] as string) ?? null,
          data['size_bytes'] ?? null,
          (data['hash'] as string) ?? null,
          (data['reason'] as string) ?? null,
          (data['detected_mime'] as string) ?? null,
          ts,
        ]);
        newRows++;

        if (eventType === 'file_organized' && inboxName) {
          const user = (data['user'] as string) ?? '';
          // Two-step: INSERT OR IGNORE to create the row, then UPDATE timestamp
          db.prepare(
            `INSERT OR IGNORE INTO ${db.prefix}inboxes (name, user, last_file_organized_at) VALUES (?, ?, ?)`
          ).run([inboxName, user, ts]);
          db.prepare(
            `UPDATE ${db.prefix}inboxes SET last_file_organized_at = ? WHERE name = ?`
          ).run([ts, inboxName]);
          affectedInboxes.add(inboxName);
        }

        if (eventType === 'file_quarantined' && inboxName) {
          const user = (data['user'] as string) ?? '';
          db.prepare(
            `INSERT OR IGNORE INTO ${db.prefix}inboxes (name, user) VALUES (?, ?)`
          ).run([inboxName, user]);
          db.prepare(
            `UPDATE ${db.prefix}inboxes SET quarantine_count = quarantine_count + 1 WHERE name = ?`
          ).run([inboxName]);
          affectedInboxes.add(inboxName);
        }
      }
    }
    setCursor(db, stat.size);
  });

  if (affectedInboxes.size > 0) {
    recomputeInboxHealth(db, [...affectedInboxes]);
  }

  if (newRows > 0) {
    sse.broadcast('events', { count: newRows });
  }

  return newRows;
}

export function startIngestor(ctx: PluginContext, eventsPath: string): () => void {
  let stopped = false;
  let watcher: fs.FSWatcher | null = null;

  const poll = () => {
    if (stopped) return;
    try {
      processNewEvents(ctx.db, eventsPath, ctx.sse);
    } catch (err) {
      logger.error('media-organizer ingestor poll error', { err });
    }
  };

  poll();

  try {
    watcher = fs.watch(eventsPath, { persistent: false }, (eventType) => {
      if (eventType === 'change') poll();
    });
  } catch {
    // File may not exist yet; 5-min polling fallback handles it
  }

  const interval = setInterval(poll, 5 * 60 * 1000);

  return () => {
    stopped = true;
    watcher?.close();
    clearInterval(interval);
  };
}

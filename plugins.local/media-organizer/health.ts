import type { PluginDatabase } from '../../src/services/plugin-database.js';

const HOUR = 3600;
const DAY = 24 * HOUR;

interface InboxRow {
  name: string;
  last_file_organized_at: number | null;
  quarantine_count: number;
}

function computeHealth(row: InboxRow, now: number): string {
  if (row.quarantine_count > 0) return 'quarantine';
  if (row.last_file_organized_at == null) return 'unknown';
  const age = now - row.last_file_organized_at;
  if (age < 48 * HOUR) return 'healthy';
  if (age < 14 * DAY) return 'idle';
  return 'stalled';
}

export function recomputeInboxHealth(db: PluginDatabase, inboxNames?: string[]): void {
  const now = Math.floor(Date.now() / 1000);

  let rows: InboxRow[];
  if (inboxNames && inboxNames.length > 0) {
    const placeholders = inboxNames.map(() => '?').join(',');
    rows = db
      .prepare<unknown[], InboxRow>(
        `SELECT name, last_file_organized_at, quarantine_count FROM ${db.prefix}inboxes WHERE name IN (${placeholders})`
      )
      .all(inboxNames) as InboxRow[];
  } else {
    rows = db
      .prepare<[], InboxRow>(
        `SELECT name, last_file_organized_at, quarantine_count FROM ${db.prefix}inboxes`
      )
      .all([]) as InboxRow[];
  }

  const update = db.prepare<[string, string]>(
    `UPDATE ${db.prefix}inboxes SET health = ? WHERE name = ?`
  );
  for (const row of rows) {
    update.run([computeHealth(row, now), row.name]);
  }
}

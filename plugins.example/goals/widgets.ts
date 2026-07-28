/**
 * Dashboard widget.
 *
 * getWidgets() receives no context and runs on every dashboard render, so the
 * database arrives by setter from init() and the queries stay cheap — the same
 * arrangement agentbox uses.
 */
import type { PluginDatabase } from '../../src/services/plugin-database.js';
import type { DashboardWidget } from '../../src/plugins/types.js';
import { escapeHtml } from '../../src/web/plugin-helpers.js';
import { todayIso } from './queries.js';

let db: PluginDatabase | null = null;

export function setWidgetDb(next: PluginDatabase | null): void {
  db = next;
}

interface Totals {
  open: number;
  overdue: number;
  dueToday: number;
  boards: number;
}

/**
 * The dashboard renders one widget for everyone and getWidgets() has no
 * request context, so there is no actor to filter by. Counting only shared
 * boards keeps a private board's contents — including how many are overdue —
 * out of a tile other people can see.
 */
const SHARED_BOARDS = (prefix: string) =>
  `SELECT id FROM ${prefix}boards WHERE archived = 0 AND visibility = 'shared'`;

function readTotals(database: PluginDatabase, today: string): Totals {
  const shared = SHARED_BOARDS(database.prefix);

  const open = database
    .prepare(
      `SELECT COUNT(*) AS c FROM ${database.prefix}cards
       WHERE archived = 0 AND completed_at IS NULL AND board_id IN (${shared})`
    )
    .get() as { c: number };

  const overdue = database
    .prepare(
      `SELECT COUNT(*) AS c FROM ${database.prefix}cards
       WHERE archived = 0 AND completed_at IS NULL AND due_date IS NOT NULL AND due_date < ?
         AND board_id IN (${shared})`
    )
    .get(today) as { c: number };

  const dueToday = database
    .prepare(
      `SELECT COUNT(*) AS c FROM ${database.prefix}cards
       WHERE archived = 0 AND completed_at IS NULL AND due_date = ?
         AND board_id IN (${shared})`
    )
    .get(today) as { c: number };

  const boards = database
    .prepare(
      `SELECT COUNT(*) AS c FROM ${database.prefix}boards
       WHERE archived = 0 AND visibility = 'shared'`
    )
    .get() as { c: number };

  return { open: open.c, overdue: overdue.c, dueToday: dueToday.c, boards: boards.c };
}

export function getGoalsWidgets(today = todayIso()): DashboardWidget[] {
  if (!db) return [];

  let totals: Totals;
  try {
    totals = readTotals(db, today);
  } catch {
    return [];
  }

  if (totals.boards === 0) {
    return [
      {
        title: 'Goals',
        icon: 'layers',
        html: '<p style="color:var(--text-muted)">No boards yet — create one to start planning.</p>',
        link: '/p/goals/',
        priority: 60,
        size: 'small',
      },
    ];
  }

  const detail: string[] = [];
  if (totals.overdue > 0) {
    detail.push(`<span style="color:var(--red)">${escapeHtml(String(totals.overdue))} overdue</span>`);
  }
  if (totals.dueToday > 0) {
    detail.push(
      `<span style="color:var(--yellow)">${escapeHtml(String(totals.dueToday))} due today</span>`
    );
  }
  if (detail.length === 0) detail.push('<span style="color:var(--text-muted)">nothing overdue</span>');

  return [
    {
      title: 'Goals',
      icon: 'layers',
      html:
        `<p style="font-size:var(--text-2xl);font-weight:600;margin:0">` +
        `${escapeHtml(String(totals.open))}</p>` +
        `<p style="color:var(--text-muted);margin:0 0 var(--space-2)">open across ` +
        `${escapeHtml(String(totals.boards))} board(s)</p>` +
        `<p style="font-size:var(--text-xs);margin:0">${detail.join(' · ')}</p>`,
      link: '/p/goals/',
      priority: 60,
      size: 'small',
    },
  ];
}

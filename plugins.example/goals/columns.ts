/**
 * Columns are the board's statuses. Their order is the board's left-to-right
 * layout, held as dense integer positions (see cards.ts for why).
 */
import type { PluginDatabase } from '../../src/services/plugin-database.js';
import { GoalsError, type Column } from './types.js';
import { LIMITS } from './validation.js';

interface ColumnRow {
  id: number;
  board_id: number;
  name: string;
  color: string;
  is_done: number;
  wip_limit: number | null;
  position: number;
  created_at: number;
}

function mapColumn(row: ColumnRow): Column {
  return {
    id: row.id,
    boardId: row.board_id,
    name: row.name,
    color: row.color,
    isDone: row.is_done === 1,
    wipLimit: row.wip_limit,
    position: row.position,
    createdAt: row.created_at,
  };
}

export function listColumns(db: PluginDatabase, boardId: number): Column[] {
  const rows = db
    .prepare(`SELECT * FROM ${db.prefix}columns WHERE board_id = ? ORDER BY position, id`, [`${db.prefix}columns`])
    .all(boardId) as ColumnRow[];
  return rows.map(mapColumn);
}

export function getColumn(db: PluginDatabase, id: number): Column | null {
  const row = db.prepare(`SELECT * FROM ${db.prefix}columns WHERE id = ?`, [`${db.prefix}columns`]).get(id) as
    | ColumnRow
    | undefined;
  return row ? mapColumn(row) : null;
}

/**
 * Cards a viewer can actually see in this column.
 *
 * Archived cards are excluded deliberately: this count is compared against the
 * client's `expectedCardCount` when deleting a column, and the client counts
 * the cards it rendered — which never include archived ones. Counting them here
 * would make every delete fail with COUNT_MISMATCH, and reloading would not
 * help, because the mismatch is permanent.
 */
export function countCardsInColumn(db: PluginDatabase, columnId: number): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM ${db.prefix}cards WHERE column_id = ? AND archived = 0`,
      [`${db.prefix}cards`]
    )
    .get(columnId) as { c: number };
  return row.c;
}

export interface CreateColumnInput {
  boardId: number;
  name: string;
  color?: string;
  isDone?: boolean;
  wipLimit?: number | null;
}

export function createColumn(db: PluginDatabase, input: CreateColumnInput): Column {
  return db.transaction(() => {
    const existing = listColumns(db, input.boardId);
    if (existing.length >= LIMITS.maxColumnsPerBoard) {
      throw new GoalsError(
        'LIMIT_REACHED',
        `A board can have at most ${String(LIMITS.maxColumnsPerBoard)} columns.`
      );
    }

    const result = db
      .prepare(
        `INSERT INTO ${db.prefix}columns (board_id, name, color, is_done, wip_limit, position, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      , [`${db.prefix}columns`])
      .run(
        input.boardId,
        input.name,
        input.color ?? '#7c3aed',
        input.isDone === true ? 1 : 0,
        input.wipLimit ?? null,
        existing.length,
        Date.now()
      );

    const column = getColumn(db, Number(result.lastInsertRowid));
    if (!column) throw new GoalsError('NOT_FOUND', 'Column vanished after insert');
    return column;
  });
}

export interface UpdateColumnInput {
  name?: string;
  color?: string;
  isDone?: boolean;
  wipLimit?: number | null;
}

export function updateColumn(db: PluginDatabase, id: number, input: UpdateColumnInput): Column {
  return db.transaction(() => {
    const existing = getColumn(db, id);
    if (!existing) throw new GoalsError('NOT_FOUND', 'That column no longer exists');

    const isDone = input.isDone ?? existing.isDone;

    db.prepare(
      `UPDATE ${db.prefix}columns SET name = ?, color = ?, is_done = ?, wip_limit = ? WHERE id = ?`
    , [`${db.prefix}columns`]).run(
      input.name ?? existing.name,
      input.color ?? existing.color,
      isDone ? 1 : 0,
      input.wipLimit === undefined ? existing.wipLimit : input.wipLimit,
      id
    );

    // Flipping the done flag retimes every card sitting in the column, so a
    // board's completion stats stay consistent with where its cards actually are.
    if (isDone !== existing.isDone) {
      if (isDone) {
        db.prepare(
          `UPDATE ${db.prefix}cards SET completed_at = ? WHERE column_id = ? AND completed_at IS NULL`
        , [`${db.prefix}cards`]).run(Date.now(), id);
      } else {
        db.prepare(`UPDATE ${db.prefix}cards SET completed_at = NULL WHERE column_id = ?`, [`${db.prefix}cards`]).run(id);
      }
    }

    const updated = getColumn(db, id);
    if (!updated) throw new GoalsError('NOT_FOUND', 'That column no longer exists');
    return updated;
  });
}

/**
 * Reorder a board's columns.
 *
 * The list must be the board's exact column set — a partial list, a duplicate,
 * or an id from another board is a stale or hostile client, not a reorder.
 */
export function reorderColumns(db: PluginDatabase, boardId: number, orderedIds: number[]): void {
  db.transaction(() => {
    const known = new Set(listColumns(db, boardId).map((c) => c.id));

    if (orderedIds.length !== known.size || orderedIds.some((id) => !known.has(id))) {
      throw new GoalsError(
        'COUNT_MISMATCH',
        'This board changed while you were reordering. Reload and try again.'
      );
    }

    const update = db.prepare(`UPDATE ${db.prefix}columns SET position = ? WHERE id = ?`, [`${db.prefix}columns`]);
    orderedIds.forEach((id, index) => update.run(index, id));
  });
}

export type DeleteColumnMode = 'move' | 'delete';

export interface DeleteColumnInput {
  columnId: number;
  mode: DeleteColumnMode;
  /** Required when mode is 'move' — must be another column on the same board. */
  targetColumnId?: number;
  /** The card count the caller believes the column holds. Guards against a stale tab. */
  expectedCardCount: number;
}

export interface DeleteColumnResult {
  boardId: number;
  moved: number;
  deleted: number;
}

/**
 * Delete a column, explicitly choosing what happens to its cards.
 *
 * Never silently destructive: `mode` is required, the caller's card count must
 * match the live one, and a board's last column cannot be removed — cards need
 * somewhere to live.
 */
export function deleteColumn(db: PluginDatabase, input: DeleteColumnInput): DeleteColumnResult {
  return db.transaction(() => {
    const column = getColumn(db, input.columnId);
    if (!column) throw new GoalsError('NOT_FOUND', 'That column no longer exists');

    const siblings = listColumns(db, column.boardId);
    if (siblings.length <= 1) {
      throw new GoalsError(
        'LAST_COLUMN',
        'A board needs at least one column. Add another before deleting this one.'
      );
    }

    const liveCount = countCardsInColumn(db, column.id);
    if (liveCount !== input.expectedCardCount) {
      throw new GoalsError(
        'COUNT_MISMATCH',
        `This column now holds ${String(liveCount)} card(s), not ${String(input.expectedCardCount)}. Reload and try again.`
      );
    }

    let moved = 0;
    let deleted = 0;

    if (input.mode === 'move') {
      const target =
        input.targetColumnId === undefined ? null : getColumn(db, input.targetColumnId);
      if (!target) throw new GoalsError('NOT_FOUND', 'Pick a column to move the cards into');
      if (target.boardId !== column.boardId) {
        throw new GoalsError('CROSS_BOARD', 'Cards can only move to a column on the same board');
      }
      if (target.id === column.id) {
        throw new GoalsError('INVALID', 'Pick a different column to move the cards into');
      }

      // Append to the target's tail, preserving the cards' relative order.
      const movingIds = (
        db
          .prepare(
            `SELECT id FROM ${db.prefix}cards WHERE column_id = ? ORDER BY position, id`
          , [`${db.prefix}cards`])
          .all(column.id) as { id: number }[]
      ).map((r) => r.id);

      const tail = db
        .prepare(`SELECT MAX(position) AS m FROM ${db.prefix}cards WHERE column_id = ?`, [`${db.prefix}cards`])
        .get(target.id) as { m: number | null };

      const update = db.prepare(
        `UPDATE ${db.prefix}cards SET column_id = ?, position = ?, updated_at = ? WHERE id = ?`
      , [`${db.prefix}cards`]);
      const now = Date.now();
      let next = (tail.m ?? -1) + 1;
      for (const id of movingIds) {
        update.run(target.id, next, now, id);
        next++;
      }
      moved = movingIds.length;

      if (target.isDone !== column.isDone) {
        if (target.isDone) {
          db.prepare(
            `UPDATE ${db.prefix}cards SET completed_at = ? WHERE column_id = ? AND completed_at IS NULL`
          , [`${db.prefix}cards`]).run(now, target.id);
        } else {
          db.prepare(
            `UPDATE ${db.prefix}cards SET completed_at = NULL WHERE column_id = ?`
          , [`${db.prefix}cards`]).run(target.id);
        }
      }
    } else {
      db.prepare(
        `DELETE FROM ${db.prefix}comments
         WHERE card_id IN (SELECT id FROM ${db.prefix}cards WHERE column_id = ?)`
      , [`${db.prefix}comments`, `${db.prefix}cards`]).run(column.id);
      const result = db.prepare(`DELETE FROM ${db.prefix}cards WHERE column_id = ?`, [`${db.prefix}cards`]).run(column.id);
      deleted = result.changes;
    }

    db.prepare(`DELETE FROM ${db.prefix}columns WHERE id = ?`, [`${db.prefix}columns`]).run(column.id);

    // Close the gap the removed column left.
    const remaining = listColumns(db, column.boardId);
    const update = db.prepare(`UPDATE ${db.prefix}columns SET position = ? WHERE id = ?`, [`${db.prefix}columns`]);
    remaining.forEach((c, index) => update.run(index, c.id));

    return { boardId: column.boardId, moved, deleted };
  });
}

/**
 * Cards, and the ordering logic the whole board rests on.
 *
 * Positions are dense integers (0..n-1 within a column), renumbered inside the
 * same transaction as the move. The alternative — fractional midpoint keys —
 * only defers the renumber until precision runs out, and makes concurrency
 * worse: two clients dropping into the same gap compute identical midpoints
 * from the same stale neighbours and tie with nothing to break it. Recomputing
 * server-side from live state cannot tie.
 *
 * There is deliberately no UNIQUE(column_id, position) constraint: SQLite
 * cannot defer it and every shuffle passes through transient duplicates.
 * Instead every read orders by (position, id), so a duplicate left by an
 * interrupted process degrades to a stable order and the next move compacts it.
 */
import type { PluginDatabase } from '../../src/services/plugin-database.js';
import { GoalsError, type Card, type MoveResult } from './types.js';
import { LIMITS } from './validation.js';
import { getColumn } from './columns.js';

interface CardRow {
  id: number;
  board_id: number;
  column_id: number;
  title: string;
  description: string;
  assignee_id: number | null;
  due_date: string | null;
  position: number;
  archived: number;
  created_by: string;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

function mapCard(row: CardRow): Card {
  return {
    id: row.id,
    boardId: row.board_id,
    columnId: row.column_id,
    title: row.title,
    description: row.description,
    assigneeId: row.assignee_id,
    dueDate: row.due_date,
    position: row.position,
    archived: row.archived === 1,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export function getCard(db: PluginDatabase, id: number): Card | null {
  const row = db.prepare(`SELECT * FROM ${db.prefix}cards WHERE id = ?`).get(id) as
    | CardRow
    | undefined;
  return row ? mapCard(row) : null;
}

export function listCardsInColumn(db: PluginDatabase, columnId: number): Card[] {
  const rows = db
    .prepare(
      `SELECT * FROM ${db.prefix}cards WHERE column_id = ? AND archived = 0 ORDER BY position, id`
    )
    .all(columnId) as CardRow[];
  return rows.map(mapCard);
}

/**
 * Rewrite a column's positions to a dense 0..n-1 sequence.
 * Must be called inside a transaction.
 */
export function renumberColumn(db: PluginDatabase, columnId: number): void {
  const ids = (
    db
      .prepare(`SELECT id FROM ${db.prefix}cards WHERE column_id = ? ORDER BY position, id`)
      .all(columnId) as { id: number }[]
  ).map((r) => r.id);

  const update = db.prepare(`UPDATE ${db.prefix}cards SET position = ? WHERE id = ?`);
  ids.forEach((id, index) => update.run(index, id));
}

export interface CreateCardInput {
  columnId: number;
  title: string;
  description?: string;
  assigneeId?: number | null;
  dueDate?: string | null;
  createdBy: string;
}

export function createCard(db: PluginDatabase, input: CreateCardInput): Card {
  return db.transaction(() => {
    const column = getColumn(db, input.columnId);
    if (!column) throw new GoalsError('NOT_FOUND', 'That column no longer exists');

    // Archived cards do not occupy a slot — otherwise a column that has
    // accumulated 500 archived cards becomes permanently un-addable-to while
    // displaying as empty.
    const count = db
      .prepare(`SELECT COUNT(*) AS c FROM ${db.prefix}cards WHERE column_id = ? AND archived = 0`)
      .get(column.id) as { c: number };
    if (count.c >= LIMITS.maxCardsPerColumn) {
      throw new GoalsError(
        'LIMIT_REACHED',
        `A column can hold at most ${String(LIMITS.maxCardsPerColumn)} cards.`
      );
    }

    const tail = db
      .prepare(`SELECT MAX(position) AS m FROM ${db.prefix}cards WHERE column_id = ?`)
      .get(column.id) as { m: number | null };

    const now = Date.now();
    const result = db
      .prepare(
        `INSERT INTO ${db.prefix}cards
         (board_id, column_id, title, description, assignee_id, due_date, position,
          archived, created_by, created_at, updated_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`
      )
      .run(
        column.boardId,
        column.id,
        input.title,
        input.description ?? '',
        input.assigneeId ?? null,
        input.dueDate ?? null,
        (tail.m ?? -1) + 1,
        input.createdBy,
        now,
        now,
        column.isDone ? now : null
      );

    const card = getCard(db, Number(result.lastInsertRowid));
    if (!card) throw new GoalsError('NOT_FOUND', 'Card vanished after insert');
    return card;
  });
}

export interface UpdateCardInput {
  title?: string;
  description?: string;
  /** null clears the assignee; undefined leaves it alone. */
  assigneeId?: number | null;
  /** null clears the due date; undefined leaves it alone. */
  dueDate?: string | null;
}

export function updateCard(db: PluginDatabase, id: number, input: UpdateCardInput): Card {
  const existing = getCard(db, id);
  if (!existing) throw new GoalsError('NOT_FOUND', 'That card no longer exists');

  db.prepare(
    `UPDATE ${db.prefix}cards
     SET title = ?, description = ?, assignee_id = ?, due_date = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    input.title ?? existing.title,
    input.description ?? existing.description,
    input.assigneeId === undefined ? existing.assigneeId : input.assigneeId,
    input.dueDate === undefined ? existing.dueDate : input.dueDate,
    Date.now(),
    id
  );

  const updated = getCard(db, id);
  if (!updated) throw new GoalsError('NOT_FOUND', 'That card no longer exists');
  return updated;
}

export function setCardArchived(db: PluginDatabase, id: number, archived: boolean): Card {
  return db.transaction(() => {
    const existing = getCard(db, id);
    if (!existing) throw new GoalsError('NOT_FOUND', 'That card no longer exists');

    db.prepare(`UPDATE ${db.prefix}cards SET archived = ?, updated_at = ? WHERE id = ?`).run(
      archived ? 1 : 0,
      Date.now(),
      id
    );
    renumberColumn(db, existing.columnId);

    const updated = getCard(db, id);
    if (!updated) throw new GoalsError('NOT_FOUND', 'That card no longer exists');
    return updated;
  });
}

export function deleteCard(db: PluginDatabase, id: number): void {
  db.transaction(() => {
    const existing = getCard(db, id);
    if (!existing) throw new GoalsError('NOT_FOUND', 'That card no longer exists');

    db.prepare(`DELETE FROM ${db.prefix}comments WHERE card_id = ?`).run(id);
    db.prepare(`DELETE FROM ${db.prefix}cards WHERE id = ?`).run(id);
    renumberColumn(db, existing.columnId);
  });
}

export interface MoveCardInput {
  cardId: number;
  toColumnId: number;
  /**
   * Target index among the destination column's cards *after* the moved card
   * has been removed from the list. Clamped against live state.
   */
  toIndex: number;
}

export function moveCard(db: PluginDatabase, input: MoveCardInput): MoveResult {
  return db.transaction(() => {
    const card = getCard(db, input.cardId);
    if (!card) throw new GoalsError('NOT_FOUND', 'That card no longer exists');
    if (card.archived) throw new GoalsError('INVALID', 'Restore this card before moving it');

    const target = getColumn(db, input.toColumnId);
    if (!target) throw new GoalsError('NOT_FOUND', 'That column no longer exists');
    if (target.boardId !== card.boardId) {
      throw new GoalsError('CROSS_BOARD', 'Cards can only move within their own board');
    }

    const fromColumnId = card.columnId;

    if (fromColumnId !== target.id) {
      const count = db
        .prepare(
          `SELECT COUNT(*) AS c FROM ${db.prefix}cards WHERE column_id = ? AND archived = 0`
        )
        .get(target.id) as { c: number };
      if (count.c >= LIMITS.maxCardsPerColumn) {
        throw new GoalsError(
          'LIMIT_REACHED',
          `${target.name} already holds ${String(LIMITS.maxCardsPerColumn)} cards.`
        );
      }
    }

    // Rebuild the destination order from live state, so a stale client index
    // can misplace a card by a slot but can never corrupt the sequence.
    const destination = (
      db
        .prepare(
          `SELECT id FROM ${db.prefix}cards WHERE column_id = ? AND archived = 0 ORDER BY position, id`
        )
        .all(target.id) as { id: number }[]
    )
      .map((r) => r.id)
      .filter((id) => id !== card.id);

    const toIndex = Math.max(0, Math.min(input.toIndex, destination.length));
    destination.splice(toIndex, 0, card.id);

    const now = Date.now();
    const update = db.prepare(
      `UPDATE ${db.prefix}cards SET column_id = ?, position = ?, updated_at = ? WHERE id = ?`
    );
    destination.forEach((id, index) => update.run(target.id, index, now, id));

    if (fromColumnId !== target.id) {
      renumberColumn(db, fromColumnId);

      const wasDone = card.completedAt !== null;
      if (target.isDone && !wasDone) {
        db.prepare(`UPDATE ${db.prefix}cards SET completed_at = ? WHERE id = ?`).run(now, card.id);
      } else if (!target.isDone && wasDone) {
        db.prepare(`UPDATE ${db.prefix}cards SET completed_at = NULL WHERE id = ?`).run(card.id);
      }
    }

    return {
      boardId: card.boardId,
      cardId: card.id,
      fromColumnId,
      toColumnId: target.id,
      toIndex,
    };
  });
}

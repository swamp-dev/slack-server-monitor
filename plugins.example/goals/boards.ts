/**
 * Boards — the top-level container. A board is either `shared` (the family
 * board, visible to everyone signed in) or `private` (visible to its owner and
 * app admins only).
 */
import type { PluginDatabase } from '../../src/services/plugin-database.js';
import { GoalsError, type Actor, type Board, type BoardVisibility } from './types.js';
import { LIMITS } from './validation.js';
import { canViewBoard } from './access.js';
import { DEFAULT_COLUMNS } from './schema.js';

interface BoardRow {
  id: number;
  title: string;
  description: string;
  owner_id: string;
  visibility: BoardVisibility;
  is_default: number;
  archived: number;
  position: number;
  created_at: number;
  updated_at: number;
}

function mapBoard(row: BoardRow): Board {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    ownerId: row.owner_id,
    visibility: row.visibility,
    isDefault: row.is_default === 1,
    archived: row.archived === 1,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getBoard(db: PluginDatabase, id: number): Board | null {
  const row = db.prepare(`SELECT * FROM ${db.prefix}boards WHERE id = ?`).get(id) as
    | BoardRow
    | undefined;
  return row ? mapBoard(row) : null;
}

/** Every board, in display order. Filter with `listBoardsFor` for a given actor. */
export function listBoards(db: PluginDatabase): Board[] {
  const rows = db
    .prepare(`SELECT * FROM ${db.prefix}boards WHERE archived = 0 ORDER BY position, id`)
    .all() as BoardRow[];
  return rows.map(mapBoard);
}

export function listBoardsFor(db: PluginDatabase, actor: Actor): Board[] {
  return listBoards(db).filter((board) => canViewBoard(board, actor));
}

export interface CreateBoardInput {
  title: string;
  description?: string;
  ownerId: string;
  visibility?: BoardVisibility;
  withDefaultColumns?: boolean;
}

export function createBoard(db: PluginDatabase, input: CreateBoardInput): Board {
  return db.transaction(() => {
    const owned = db
      .prepare(`SELECT COUNT(*) AS c FROM ${db.prefix}boards WHERE owner_id = ? AND archived = 0`)
      .get(input.ownerId) as { c: number };
    if (owned.c >= LIMITS.maxBoardsPerOwner) {
      throw new GoalsError(
        'LIMIT_REACHED',
        `You already have ${String(LIMITS.maxBoardsPerOwner)} boards. Delete one before adding another.`
      );
    }

    const next = db.prepare(`SELECT MAX(position) AS m FROM ${db.prefix}boards`).get() as {
      m: number | null;
    };
    const now = Date.now();

    const result = db
      .prepare(
        `INSERT INTO ${db.prefix}boards
         (title, description, owner_id, visibility, is_default, archived, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?)`
      )
      .run(
        input.title,
        input.description ?? '',
        input.ownerId,
        input.visibility ?? 'shared',
        (next.m ?? -1) + 1,
        now,
        now
      );

    const boardId = Number(result.lastInsertRowid);

    if (input.withDefaultColumns !== false) {
      const insertColumn = db.prepare(
        `INSERT INTO ${db.prefix}columns (board_id, name, color, is_done, wip_limit, position, created_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?)`
      );
      DEFAULT_COLUMNS.forEach((column, index) => {
        insertColumn.run(boardId, column.name, column.color, column.isDone ? 1 : 0, index, now);
      });
    }

    const board = getBoard(db, boardId);
    if (!board) throw new GoalsError('NOT_FOUND', 'Board vanished after insert');
    return board;
  });
}

export interface UpdateBoardInput {
  title?: string;
  description?: string;
  visibility?: BoardVisibility;
}

export function updateBoard(db: PluginDatabase, id: number, input: UpdateBoardInput): Board {
  const existing = getBoard(db, id);
  if (!existing) throw new GoalsError('NOT_FOUND', 'That board no longer exists');

  db.prepare(
    `UPDATE ${db.prefix}boards SET title = ?, description = ?, visibility = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    input.title ?? existing.title,
    input.description ?? existing.description,
    input.visibility ?? existing.visibility,
    Date.now(),
    id
  );

  const updated = getBoard(db, id);
  if (!updated) throw new GoalsError('NOT_FOUND', 'That board no longer exists');
  return updated;
}

/**
 * Delete a board and everything on it.
 *
 * Foreign keys are not enforced (see schema.ts), so the cascade is explicit and
 * ordered: comments, then cards, then columns, then the board itself.
 */
export function deleteBoard(db: PluginDatabase, id: number): void {
  db.transaction(() => {
    const existing = getBoard(db, id);
    if (!existing) throw new GoalsError('NOT_FOUND', 'That board no longer exists');

    db.prepare(
      `DELETE FROM ${db.prefix}comments
       WHERE card_id IN (SELECT id FROM ${db.prefix}cards WHERE board_id = ?)`
    ).run(id);
    db.prepare(`DELETE FROM ${db.prefix}cards WHERE board_id = ?`).run(id);
    db.prepare(`DELETE FROM ${db.prefix}columns WHERE board_id = ?`).run(id);
    db.prepare(`DELETE FROM ${db.prefix}boards WHERE id = ?`).run(id);
  });
}

/** The board `/goals add` writes to: the default board, else the lowest id. */
export function getDefaultBoard(db: PluginDatabase): Board | null {
  const row = db
    .prepare(
      `SELECT * FROM ${db.prefix}boards WHERE archived = 0
       ORDER BY is_default DESC, position, id LIMIT 1`
    )
    .get() as BoardRow | undefined;
  return row ? mapBoard(row) : null;
}

export function reorderBoards(db: PluginDatabase, orderedIds: number[]): void {
  db.transaction(() => {
    const known = new Set(listBoards(db).map((b) => b.id));
    if (orderedIds.length !== known.size || orderedIds.some((id) => !known.has(id))) {
      throw new GoalsError('COUNT_MISMATCH', 'That board list is out of date. Reload and retry.');
    }

    const update = db.prepare(`UPDATE ${db.prefix}boards SET position = ? WHERE id = ?`);
    orderedIds.forEach((id, index) => update.run(index, id));
  });
}

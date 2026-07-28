/**
 * Composite read models — the shapes the views actually render.
 *
 * Kept separate from the per-entity stores so a page is one call, and so the
 * joins live in one place. Every prepare() declares the tables it reads —
 * including the ones only reached through CARD_SELECT's join and subquery.
 */
import type { PluginDatabase } from '../../src/services/plugin-database.js';
import type {
  Actor,
  Board,
  BoardStats,
  BoardSummary,
  BoardView,
  CardDetail,
  CardView,
  ColumnView,
  CommentView,
  Member,
} from './types.js';
import { getBoard, listBoardsFor } from './boards.js';
import { listColumns, getColumn } from './columns.js';
import { listMembers, getMember } from './members.js';
import { listComments } from './comments.js';

interface CardJoinRow {
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
  member_id: number | null;
  member_name: string | null;
  member_color: string | null;
  member_identity: string | null;
  member_archived: number | null;
  comment_count: number;
}

function mapCardView(row: CardJoinRow): CardView {
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
    assignee:
      row.member_id === null
        ? null
        : {
            id: row.member_id,
            displayName: row.member_name ?? '',
            color: row.member_color ?? '#64748b',
            identity: row.member_identity,
            archived: row.member_archived === 1,
            createdAt: 0,
          },
    commentCount: row.comment_count,
  };
}

/**
 * The card projection every read model shares.
 * `extraColumns` is appended to the select list (e.g. a joined column name);
 * `extraJoins` is appended after the assignee join.
 */
/** Tables CARD_SELECT touches, for PluginDatabase's table declaration. */
const CARD_SELECT_TABLES = (prefix: string): string[] => [
  `${prefix}cards`,
  `${prefix}members`,
  `${prefix}comments`,
];

const CARD_SELECT = (prefix: string, extraColumns = '', extraJoins = '') => `
  SELECT c.*,
         m.id AS member_id,
         m.display_name AS member_name,
         m.color AS member_color,
         m.identity AS member_identity,
         m.archived AS member_archived,
         (SELECT COUNT(*) FROM ${prefix}comments cm WHERE cm.card_id = c.id) AS comment_count
         ${extraColumns}
  FROM ${prefix}cards c
  LEFT JOIN ${prefix}members m ON m.id = c.assignee_id
  ${extraJoins}
`;

/** Today as a YYYY-MM-DD calendar date, matching how due dates are stored. */
export function todayIso(now: Date = new Date()): string {
  const year = String(now.getFullYear()).padStart(4, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function boardStats(db: PluginDatabase, boardId: number, today = todayIso()): BoardStats {
  const total = db
    .prepare(`SELECT COUNT(*) AS c FROM ${db.prefix}cards WHERE board_id = ? AND archived = 0`, [`${db.prefix}cards`])
    .get(boardId) as { c: number };

  const done = db
    .prepare(
      `SELECT COUNT(*) AS c FROM ${db.prefix}cards
       WHERE board_id = ? AND archived = 0 AND completed_at IS NOT NULL`
    , [`${db.prefix}cards`])
    .get(boardId) as { c: number };

  const overdue = db
    .prepare(
      `SELECT COUNT(*) AS c FROM ${db.prefix}cards
       WHERE board_id = ? AND archived = 0 AND completed_at IS NULL
         AND due_date IS NOT NULL AND due_date < ?`
    , [`${db.prefix}cards`])
    .get(boardId, today) as { c: number };

  return { total: total.c, done: done.c, overdue: overdue.c };
}

/** The board index: every board this actor may see, with its progress. */
export function loadIndexView(db: PluginDatabase, actor: Actor, today = todayIso()): BoardSummary[] {
  return listBoardsFor(db, actor).map((board) => {
    const columns = db
      .prepare(`SELECT COUNT(*) AS c FROM ${db.prefix}columns WHERE board_id = ?`, [`${db.prefix}columns`])
      .get(board.id) as { c: number };

    return {
      board,
      stats: boardStats(db, board.id, today),
      columnCount: columns.c,
    };
  });
}

/** Everything one kanban page needs. */
export function loadBoardView(
  db: PluginDatabase,
  boardId: number,
  today = todayIso()
): BoardView | null {
  const board = getBoard(db, boardId);
  if (!board) return null;

  const rows = db
    .prepare(
      `${CARD_SELECT(db.prefix)} WHERE c.board_id = ? AND c.archived = 0
       ORDER BY c.position, c.id`,
      CARD_SELECT_TABLES(db.prefix)
    )
    .all(boardId) as CardJoinRow[];

  const byColumn = new Map<number, CardView[]>();
  for (const row of rows) {
    const card = mapCardView(row);
    const bucket = byColumn.get(card.columnId);
    if (bucket) {
      bucket.push(card);
    } else {
      byColumn.set(card.columnId, [card]);
    }
  }

  const columns: ColumnView[] = listColumns(db, boardId).map((column) => ({
    ...column,
    cards: byColumn.get(column.id) ?? [],
  }));

  return {
    board,
    columns,
    members: listMembers(db, { includeArchived: false }),
    stats: boardStats(db, boardId, today),
  };
}

/** One card, with its comments and the pickers the editor needs. */
export function loadCardDetail(db: PluginDatabase, cardId: number): CardDetail | null {
  const row = db
    .prepare(`${CARD_SELECT(db.prefix)} WHERE c.id = ?`, CARD_SELECT_TABLES(db.prefix))
    .get(cardId) as CardJoinRow | undefined;
  if (!row) return null;

  const card = mapCardView(row);
  const board = getBoard(db, card.boardId);
  const column = getColumn(db, card.columnId);
  if (!board || !column) return null;

  const members = listMembers(db, { includeArchived: false });

  const comments: CommentView[] = listComments(db, cardId).map((comment) => ({
    ...comment,
    authorMember: comment.authorMemberId === null ? null : getMember(db, comment.authorMemberId),
  }));

  return { card, board, column, columns: listColumns(db, card.boardId), comments, members };
}

export interface OpenCard {
  card: CardView;
  board: Board;
  columnName: string;
}

/**
 * Open cards across every board the actor may see, most urgent first.
 * Backs the `/goals` slash command and the dashboard widget.
 */
export function listOpenCards(db: PluginDatabase, actor: Actor, limit = 25): OpenCard[] {
  const boards = new Map(listBoardsFor(db, actor).map((b) => [b.id, b]));
  if (boards.size === 0) return [];

  const rows = db
    .prepare(
      `${CARD_SELECT(
        db.prefix,
        ', col.name AS column_name',
        `JOIN ${db.prefix}columns col ON col.id = c.column_id`
      )}
       WHERE c.archived = 0 AND col.is_done = 0
       ORDER BY c.position, c.id`,
      [...CARD_SELECT_TABLES(db.prefix), `${db.prefix}columns`]
    )
    .all() as (CardJoinRow & { column_name: string })[];

  const open: OpenCard[] = [];
  for (const row of rows) {
    const board = boards.get(row.board_id);
    if (!board) continue;
    open.push({ card: mapCardView(row), board, columnName: row.column_name });
  }

  // Overdue first, then soonest due, then undated — the order someone
  // scanning a backlog actually wants.
  open.sort((a, b) => {
    const dueA = a.card.dueDate;
    const dueB = b.card.dueDate;
    if (dueA && dueB) return dueA < dueB ? -1 : dueA > dueB ? 1 : a.card.id - b.card.id;
    if (dueA) return -1;
    if (dueB) return 1;
    return a.card.id - b.card.id;
  });

  return open.slice(0, limit);
}

/** Cards assigned to the roster members linked to this identity. */
export function listCardsForIdentity(
  db: PluginDatabase,
  identity: string,
  actor: Actor,
  limit = 25
): OpenCard[] {
  return listOpenCards(db, actor, Number.MAX_SAFE_INTEGER)
    .filter((entry) => entry.card.assignee?.identity === identity)
    .slice(0, limit);
}

export function memberById(members: Member[], id: number | null): Member | null {
  if (id === null) return null;
  return members.find((m) => m.id === id) ?? null;
}

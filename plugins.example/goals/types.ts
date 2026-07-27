/**
 * Shared types for the goals plugin.
 *
 * Rows are returned with camelCase fields; the SQL columns are snake_case and
 * mapped at the store boundary, matching the core stores in src/services/.
 */

export type BoardVisibility = 'shared' | 'private';

export interface Board {
  id: number;
  title: string;
  description: string;
  ownerId: string;
  visibility: BoardVisibility;
  isDefault: boolean;
  archived: boolean;
  position: number;
  createdAt: number;
  updatedAt: number;
}

export interface Member {
  id: number;
  displayName: string;
  color: string;
  /** Linked app identity ('U123' | 'web:andy' | 'admin'), or null for someone with no login. */
  identity: string | null;
  archived: boolean;
  createdAt: number;
}

export interface Column {
  id: number;
  boardId: number;
  name: string;
  color: string;
  /** Cards in this column count as complete. */
  isDone: boolean;
  wipLimit: number | null;
  position: number;
  createdAt: number;
}

export interface Card {
  id: number;
  boardId: number;
  columnId: number;
  title: string;
  description: string;
  assigneeId: number | null;
  /** Calendar date 'YYYY-MM-DD', not a timestamp — a due date is a wall-clock day. */
  dueDate: string | null;
  position: number;
  archived: boolean;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

export interface Comment {
  id: number;
  cardId: number;
  authorId: string;
  authorMemberId: number | null;
  body: string;
  createdAt: number;
}

/** Who is making a request, derived from res.locals. */
export interface Actor {
  userId: string;
  isAdmin: boolean;
}

// --- Read models ---

export interface CardView extends Card {
  assignee: Member | null;
  commentCount: number;
}

export interface ColumnView extends Column {
  cards: CardView[];
}

export interface BoardView {
  board: Board;
  columns: ColumnView[];
  members: Member[];
  stats: BoardStats;
}

export interface BoardStats {
  total: number;
  done: number;
  overdue: number;
}

export interface BoardSummary {
  board: Board;
  stats: BoardStats;
  columnCount: number;
}

export interface CardDetail {
  card: CardView;
  board: Board;
  column: Column;
  columns: Column[];
  comments: CommentView[];
  members: Member[];
}

export interface CommentView extends Comment {
  authorMember: Member | null;
}

export interface MoveResult {
  boardId: number;
  cardId: number;
  fromColumnId: number;
  toColumnId: number;
  toIndex: number;
}

// --- Errors ---

/**
 * Machine-readable failure codes. Routes map these to HTTP status; the client
 * maps them to messages. Never surface a raw SQL error to either.
 */
export type GoalsErrorCode =
  | 'NOT_FOUND'
  | 'CROSS_BOARD'
  | 'LAST_COLUMN'
  | 'COUNT_MISMATCH'
  | 'IN_USE'
  | 'IDENTITY_TAKEN'
  | 'LIMIT_REACHED'
  | 'INVALID';

export class GoalsError extends Error {
  constructor(
    public readonly code: GoalsErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'GoalsError';
  }
}

export function isGoalsError(err: unknown): err is GoalsError {
  return err instanceof GoalsError;
}

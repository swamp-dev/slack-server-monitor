/**
 * The members roster.
 *
 * Members are owned by the plugin rather than read from the core `users` table,
 * so a family member with no login can still be assigned a goal. `identity`
 * optionally links a member to an app identity ('U123' / 'web:andy'), which is
 * what lets `/goals add` auto-assign and what "my goals" filters on.
 */
import type { PluginDatabase } from '../../src/services/plugin-database.js';
import { GoalsError, type Member } from './types.js';

interface MemberRow {
  id: number;
  display_name: string;
  color: string;
  identity: string | null;
  archived: number;
  created_at: number;
}

function mapMember(row: MemberRow): Member {
  return {
    id: row.id,
    displayName: row.display_name,
    color: row.color,
    identity: row.identity,
    archived: row.archived === 1,
    createdAt: row.created_at,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed/i.test(err.message);
}

export interface CreateMemberInput {
  displayName: string;
  color: string;
  identity: string | null;
}

export function createMember(db: PluginDatabase, input: CreateMemberInput): Member {
  try {
    const result = db
      .prepare(
        `INSERT INTO ${db.prefix}members (display_name, color, identity, archived, created_at)
         VALUES (?, ?, ?, 0, ?)`
      )
      .run(input.displayName, input.color, input.identity, Date.now());

    const member = getMember(db, Number(result.lastInsertRowid));
    if (!member) throw new GoalsError('NOT_FOUND', 'Member vanished after insert');
    return member;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new GoalsError('IDENTITY_TAKEN', 'Another member is already linked to that identity');
    }
    throw err;
  }
}

export interface ListMembersOptions {
  includeArchived?: boolean;
}

export function listMembers(db: PluginDatabase, options: ListMembersOptions = {}): Member[] {
  const includeArchived = options.includeArchived !== false;

  const rows = includeArchived
    ? (db
        .prepare(
          `SELECT * FROM ${db.prefix}members ORDER BY archived, display_name COLLATE NOCASE, id`
        )
        .all() as MemberRow[])
    : (db
        .prepare(
          `SELECT * FROM ${db.prefix}members WHERE archived = 0
           ORDER BY display_name COLLATE NOCASE, id`
        )
        .all() as MemberRow[]);

  return rows.map(mapMember);
}

export function getMember(db: PluginDatabase, id: number): Member | null {
  const row = db.prepare(`SELECT * FROM ${db.prefix}members WHERE id = ?`).get(id) as
    | MemberRow
    | undefined;
  return row ? mapMember(row) : null;
}

/** Resolve an app identity to an active roster member. */
export function findMemberByIdentity(db: PluginDatabase, identity: string): Member | null {
  if (identity === '') return null;

  const row = db
    .prepare(`SELECT * FROM ${db.prefix}members WHERE identity = ? AND archived = 0`)
    .get(identity) as MemberRow | undefined;
  return row ? mapMember(row) : null;
}

export interface UpdateMemberInput {
  displayName?: string;
  color?: string;
  identity?: string | null;
}

export function updateMember(
  db: PluginDatabase,
  id: number,
  input: UpdateMemberInput
): Member {
  const existing = getMember(db, id);
  if (!existing) throw new GoalsError('NOT_FOUND', 'That member no longer exists');

  const displayName = input.displayName ?? existing.displayName;
  const color = input.color ?? existing.color;
  const identity = input.identity === undefined ? existing.identity : input.identity;

  try {
    db.prepare(
      `UPDATE ${db.prefix}members SET display_name = ?, color = ?, identity = ? WHERE id = ?`
    ).run(displayName, color, identity, id);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new GoalsError('IDENTITY_TAKEN', 'Another member is already linked to that identity');
    }
    throw err;
  }

  const updated = getMember(db, id);
  if (!updated) throw new GoalsError('NOT_FOUND', 'That member no longer exists');
  return updated;
}

export function setMemberArchived(db: PluginDatabase, id: number, archived: boolean): Member {
  const existing = getMember(db, id);
  if (!existing) throw new GoalsError('NOT_FOUND', 'That member no longer exists');

  db.prepare(`UPDATE ${db.prefix}members SET archived = ? WHERE id = ?`).run(archived ? 1 : 0, id);

  const updated = getMember(db, id);
  if (!updated) throw new GoalsError('NOT_FOUND', 'That member no longer exists');
  return updated;
}

export interface MemberReferences {
  cards: number;
  comments: number;
}

export function countMemberReferences(db: PluginDatabase, id: number): MemberReferences {
  const cards = db
    .prepare(`SELECT COUNT(*) AS c FROM ${db.prefix}cards WHERE assignee_id = ?`)
    .get(id) as { c: number };
  const comments = db
    .prepare(`SELECT COUNT(*) AS c FROM ${db.prefix}comments WHERE author_member_id = ?`)
    .get(id) as { c: number };

  return { cards: cards.c, comments: comments.c };
}

/**
 * Remove a member outright. Refuses while anything references them — archiving
 * is the reversible option that keeps historical attribution readable.
 */
export function hardDeleteMember(db: PluginDatabase, id: number): void {
  db.transaction(() => {
    const existing = getMember(db, id);
    if (!existing) throw new GoalsError('NOT_FOUND', 'That member no longer exists');

    const refs = countMemberReferences(db, id);
    if (refs.cards > 0 || refs.comments > 0) {
      throw new GoalsError(
        'IN_USE',
        `${existing.displayName} is still on ${refs.cards} card(s) and ${refs.comments} comment(s). Archive them instead.`
      );
    }

    db.prepare(`DELETE FROM ${db.prefix}members WHERE id = ?`).run(id);
  });
}

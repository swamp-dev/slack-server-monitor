/**
 * The /goals slash command.
 *
 * Pure and synchronous: takes the database and the raw command text, returns
 * the reply string. That keeps it fully testable without a Slack client.
 */
import type { PluginDatabase } from '../../src/services/plugin-database.js';
import { isGoalsError, type Actor } from './types.js';
import { LIMITS, parseText } from './validation.js';
import { getDefaultBoard } from './boards.js';
import { listColumns } from './columns.js';
import { createCard } from './cards.js';
import { findMemberByIdentity } from './members.js';
import { listOpenCards, todayIso } from './queries.js';

const USAGE = [
  '*Goals*',
  '`/goals` — what is still open',
  '`/goals add <title>` — add a goal to the default board',
  '`/goals help` — this message',
].join('\n');

/** Slack mrkdwn escaping — only these three are special. */
function escapeMrkdwn(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function dueSuffix(dueDate: string | null, today: string): string {
  if (!dueDate) return '';
  if (dueDate < today) return ` · :warning: overdue ${dueDate}`;
  if (dueDate === today) return ' · due today';
  return ` · due ${dueDate}`;
}

function listReply(db: PluginDatabase, actor: Actor, baseUrl: string, today: string): string {
  const open = listOpenCards(db, actor, 15);
  if (open.length === 0) {
    return 'Nothing open. Add one with `/goals add <title>`.';
  }

  const byBoard = new Map<string, string[]>();
  for (const entry of open) {
    const line =
      `• ${escapeMrkdwn(entry.card.title)} _(${escapeMrkdwn(entry.columnName)})_` +
      (entry.card.assignee ? ` — ${escapeMrkdwn(entry.card.assignee.displayName)}` : '') +
      dueSuffix(entry.card.dueDate, today);

    const bucket = byBoard.get(entry.board.title);
    if (bucket) bucket.push(line);
    else byBoard.set(entry.board.title, [line]);
  }

  const sections = [...byBoard.entries()].map(
    ([title, lines]) => `*${escapeMrkdwn(title)}*\n${lines.join('\n')}`
  );

  return `${sections.join('\n\n')}\n\n<${baseUrl}/p/goals/|Open the board>`;
}

function addReply(
  db: PluginDatabase,
  actor: Actor,
  rest: string,
  baseUrl: string
): string {
  const title = parseText(rest, LIMITS.cardTitle);
  if (title === null) {
    return rest.trim() === ''
      ? 'What is the goal? Try `/goals add Book the ferry`.'
      : `Keep the title under ${String(LIMITS.cardTitle)} characters.`;
  }

  const board = getDefaultBoard(db);
  if (!board) return 'There are no boards yet. Create one in the web app first.';

  const columns = listColumns(db, board.id);
  const target = columns.find((column) => !column.isDone) ?? columns[0];
  if (!target) return `*${escapeMrkdwn(board.title)}* has no columns yet. Add one in the web app.`;

  // Assign to the person this Slack account is linked to, when there is one.
  const member = findMemberByIdentity(db, actor.userId);

  try {
    const card = createCard(db, {
      columnId: target.id,
      title,
      createdBy: actor.userId,
      assigneeId: member?.id ?? null,
    });

    const assigned = member ? ` and assigned to ${escapeMrkdwn(member.displayName)}` : '';
    return (
      `Added *${escapeMrkdwn(title)}* to ${escapeMrkdwn(board.title)} · ` +
      `${escapeMrkdwn(target.name)}${assigned}.\n` +
      `<${baseUrl}/p/goals/card/${String(card.id)}|Open it>`
    );
  } catch (err) {
    if (isGoalsError(err)) return err.message;
    throw err;
  }
}

export interface CommandOptions {
  baseUrl?: string;
  today?: string;
}

export function handleGoalsCommand(
  db: PluginDatabase,
  text: string,
  actor: Actor,
  options: CommandOptions = {}
): string {
  const baseUrl = (options.baseUrl ?? '').replace(/\/+$/, '');
  const today = options.today ?? todayIso();

  const trimmed = text.trim();
  const [first, ...rest] = trimmed.split(/\s+/);
  const subcommand = (first ?? '').toLowerCase();

  if (trimmed === '' || subcommand === 'list') {
    return listReply(db, actor, baseUrl, today);
  }
  if (subcommand === 'help') return USAGE;
  if (subcommand === 'add') return addReply(db, actor, rest.join(' '), baseUrl);

  return `Unknown option \`${escapeMrkdwn(subcommand)}\`.\n\n${USAGE}`;
}

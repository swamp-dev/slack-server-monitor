/**
 * Fixture data for the screenshot pipeline.
 *
 * screenshotSetup runs against a throwaway in-memory database before init(),
 * so this seeds a board that shows every visual state at once: an assignee
 * chip, each due-date temperature, a comment count, a WIP limit, and a done
 * column.
 */
import type { PluginDatabase } from '../../src/services/plugin-database.js';
import { createSchema, migrateSchema } from './schema.js';
import { createBoard } from './boards.js';
import { createColumn } from './columns.js';
import { createCard } from './cards.js';
import { createComment } from './comments.js';
import { createMember } from './members.js';
import { todayIso } from './queries.js';

/** Fixed offsets from a caller-supplied "today" keep screenshots reproducible. */
function shift(today: string, days: number): string {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * `today` defaults to the real current date so the due-date states stay
 * correct whenever the screenshots are taken — a hardcoded date silently
 * turns the "due today" card into an overdue one as soon as it passes.
 */
export function seedScreenshotData(db: PluginDatabase, today = todayIso()): void {
  createSchema(db);
  migrateSchema(db);

  const ada = createMember(db, { displayName: 'Ada Chen', color: '#ec4899', identity: 'web:ada' });
  const rob = createMember(db, { displayName: 'Rob', color: '#06b6d4', identity: null });
  createMember(db, { displayName: 'Priya', color: '#10b981', identity: null });

  const family = createBoard(db, {
    title: 'Family goals',
    description: 'What we want to do together this year',
    ownerId: 'admin',
    withDefaultColumns: false,
  });

  const someday = createColumn(db, { boardId: family.id, name: 'Someday', color: '#64748b' });
  const thisMonth = createColumn(db, {
    boardId: family.id,
    name: 'This month',
    color: '#7c3aed',
    wipLimit: 3,
  });
  const doing = createColumn(db, { boardId: family.id, name: 'In progress', color: '#06b6d4' });
  const done = createColumn(db, {
    boardId: family.id,
    name: 'Done',
    color: '#10b981',
    isDone: true,
  });

  createCard(db, { columnId: someday.id, title: 'Walk the coast path', createdBy: 'admin' });
  createCard(db, {
    columnId: someday.id,
    title: 'Learn to make proper ramen',
    createdBy: 'admin',
    assigneeId: rob.id,
  });
  createCard(db, {
    columnId: someday.id,
    title: 'Build the treehouse',
    createdBy: 'admin',
    dueDate: shift(today, 120),
  });

  const overdue = createCard(db, {
    columnId: thisMonth.id,
    title: 'Book the ferry tickets',
    description: 'Prices go up at the end of the month.',
    createdBy: 'admin',
    assigneeId: ada.id,
    dueDate: shift(today, -3),
  });
  createComment(db, { cardId: overdue.id, authorId: 'web:ada', body: 'Found a crossing on the 14th' });
  createComment(db, { cardId: overdue.id, authorId: 'admin', body: 'Book it before Friday' });

  createCard(db, {
    columnId: thisMonth.id,
    title: 'Plant the autumn bulbs',
    createdBy: 'admin',
    assigneeId: rob.id,
    dueDate: today,
  });
  createCard(db, {
    columnId: thisMonth.id,
    title: 'Sort out the loft',
    createdBy: 'admin',
    dueDate: shift(today, 4),
  });
  createCard(db, { columnId: thisMonth.id, title: 'Renew the passports', createdBy: 'admin' });

  const sailing = createCard(db, {
    columnId: doing.id,
    title: 'Learn to sail',
    description: 'Six lessons at the sailing club, then a day out on our own.',
    createdBy: 'admin',
    assigneeId: ada.id,
    dueDate: shift(today, 9),
  });
  createComment(db, { cardId: sailing.id, authorId: 'web:ada', body: 'Three lessons down' });

  createCard(db, {
    columnId: done.id,
    title: 'Fix the shed roof',
    createdBy: 'admin',
    assigneeId: rob.id,
  });
  createCard(db, { columnId: done.id, title: 'Get the bikes serviced', createdBy: 'admin' });

  const personal = createBoard(db, {
    title: 'Ada · personal',
    description: 'Just for me',
    ownerId: 'admin',
    visibility: 'private',
    withDefaultColumns: false,
  });
  const reading = createColumn(db, { boardId: personal.id, name: 'Reading', color: '#a855f7' });
  createColumn(db, { boardId: personal.id, name: 'Finished', color: '#10b981', isDone: true });
  createCard(db, {
    columnId: reading.id,
    title: 'Finish the Le Guin collection',
    createdBy: 'admin',
    assigneeId: ada.id,
  });
}

/**
 * Goals — family and individual goal planning.
 *
 * A Trello-shaped board: multiple boards, user-created columns, cards with an
 * optional assignee and due date, comments, and drag-and-drop between columns.
 *
 * The plugin name must stay `goals`: getPluginDatabase rejects hyphens even
 * though isValidPlugin allows them, so a hyphenated name fails to load at all.
 *
 * Everything of substance lives in ./goals/ — this file is wiring.
 */
import type { Plugin, PluginContext } from '../src/plugins/index.js';
import type { PluginRouter } from '../src/web/plugin-router.js';
import type { App } from '@slack/bolt';
import type { PluginApp } from '../src/plugins/plugin-app.js';
import type { PluginDatabase } from '../src/services/plugin-database.js';
import { logger } from '../src/utils/logger.js';

import { createSchema, migrateSchema, seedDefaultBoard } from './goals/schema.js';
import { registerGoalsWebRoutes } from './goals/web.js';
import { handleGoalsCommand } from './goals/commands.js';
import { setWidgetDb, getGoalsWidgets } from './goals/widgets.js';
import { seedScreenshotData } from './goals/screenshot-fixtures.js';
import { actorFrom } from './goals/access.js';
import type { Actor } from './goals/types.js';

let db: PluginDatabase | null = null;

const goalsPlugin: Plugin = {
  name: 'goals',
  version: '1.0.0',
  description: 'Plan family and personal goals on a kanban board',

  helpEntries: [
    { command: '/goals', description: 'List everything still open', group: 'Goals' },
    { command: '/goals add <title>', description: 'Add a goal to the default board', group: 'Goals' },
  ],

  webNavEntry: { label: 'Goals', icon: 'layers' },
  webPages: [
    { name: 'Boards', path: '/' },
    { name: 'People', path: '/members' },
  ],

  init: (ctx: PluginContext) => {
    db = ctx.db;
    createSchema(ctx.db);
    migrateSchema(ctx.db);
    setWidgetDb(ctx.db);

    // First run gets a starter board so the page is never a dead end.
    const boardId = seedDefaultBoard(ctx.db, 'admin');

    logger.info('goals plugin initialized', { prefix: ctx.db.prefix, defaultBoardId: boardId });
    return Promise.resolve();
  },

  destroy: () => {
    db = null;
    setWidgetDb(null);
    return Promise.resolve();
  },

  getWidgets: () => getGoalsWidgets(),

  registerWebRoutes: (router: PluginRouter) => {
    registerGoalsWebRoutes(router);
  },

  registerCommands: (app: App | PluginApp) => {
    (app as PluginApp).command('/goals', async ({ command, ack, respond }) => {
      await ack();

      if (!db) {
        await respond('Goals is still starting up. Try again in a moment.');
        return;
      }

      // Slack users are their own identity here; board visibility is applied
      // by the query layer exactly as it is on the web.
      const actor: Actor = { userId: command.user_id, isAdmin: false };
      const baseUrl = process.env.WEB_BASE_URL ?? '';

      await respond(handleGoalsCommand(db, command.text ?? '', actor, { baseUrl }));
    });
  },

  screenshotPages: [
    { name: 'boards', path: '/', fullPage: true },
    { name: 'board', path: '/b/1', fullPage: true },
    { name: 'people', path: '/members', fullPage: true },
  ],

  screenshotSetup: (ctx: PluginContext) => {
    seedScreenshotData(ctx.db);
    setWidgetDb(ctx.db);
    db = ctx.db;
    return Promise.resolve();
  },
};

export default goalsPlugin;
export { actorFrom };

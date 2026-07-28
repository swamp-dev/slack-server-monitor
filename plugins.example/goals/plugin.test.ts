import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { PluginApp } from '../../src/plugins/plugin-app.js';
import { isValidPlugin } from '../../src/plugins/types.js';
import { makeTestDb, makeMockContext, type TestDb } from './test-support.js';
import { captureRoutes } from './route-support.js';
import { todayIso } from './queries.js';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { default: plugin } = await import('../goals.js');

describe('goals plugin manifest', () => {
  let t: TestDb;

  beforeEach(() => {
    t = makeTestDb();
  });

  afterEach(async () => {
    await plugin.destroy?.(makeMockContext(t.db));
    t.close();
  });

  it('passes the loader validation', () => {
    expect(isValidPlugin(plugin)).toBe(true);
  });

  it('uses a name the plugin database accepts', () => {
    // getPluginDatabase rejects hyphens even though isValidPlugin allows them,
    // so a hyphenated name would fail to load at all.
    expect(plugin.name).toBe('goals');
    expect(/^[a-z][a-z0-9_]*$/i.test(plugin.name)).toBe(true);
  });

  it('declares nav, pages and help entries', () => {
    expect(plugin.webNavEntry).toEqual({ label: 'Goals', icon: 'layers' });
    expect(plugin.webPages?.map((page) => page.path)).toEqual(['/', '/members']);
    expect(plugin.helpEntries?.map((entry) => entry.command)).toEqual([
      '/goals',
      '/goals add <title>',
    ]);
  });

  it('is not public — every route needs a session', () => {
    expect(plugin.public).not.toBe(true);
  });

  it('declares screenshot pages that all start with a slash', () => {
    expect(plugin.screenshotPages?.length).toBeGreaterThan(0);
    expect(plugin.screenshotPages?.every((page) => page.path.startsWith('/'))).toBe(true);
  });

  describe('init', () => {
    it('creates the schema and a starter board', async () => {
      const ctx = makeMockContext(t.db);
      await plugin.init?.(ctx);

      const tables = (
        t.raw
          .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
          .all() as { name: string }[]
      ).map((row) => row.name);
      expect(tables).toEqual(expect.arrayContaining(['plugin_goals_boards', 'plugin_goals_cards']));

      const boards = t.raw
        .prepare(`SELECT COUNT(*) AS c FROM ${t.db.prefix}boards WHERE is_default = 1`)
        .get() as { c: number };
      expect(boards.c).toBe(1);
    });

    it('is safe to run twice', async () => {
      const ctx = makeMockContext(t.db);
      await plugin.init?.(ctx);
      await expect(plugin.init?.(ctx)).resolves.not.toThrow();

      const boards = t.raw.prepare(`SELECT COUNT(*) AS c FROM ${t.db.prefix}boards`).get() as {
        c: number;
      };
      expect(boards.c).toBe(1);
    });

    it('starts no timers or intervals', async () => {
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
      await plugin.init?.(makeMockContext(t.db));

      expect(setIntervalSpy).not.toHaveBeenCalled();
      setIntervalSpy.mockRestore();
    });
  });

  describe('widgets', () => {
    it('reports open work once initialised', async () => {
      await plugin.init?.(makeMockContext(t.db));

      const widgets = plugin.getWidgets?.() ?? [];
      expect(widgets[0]?.title).toBe('Goals');
      expect(widgets[0]?.link).toBe('/p/goals/');
    });

    it('goes quiet after destroy', async () => {
      await plugin.init?.(makeMockContext(t.db));
      await plugin.destroy?.(makeMockContext(t.db));

      expect(plugin.getWidgets?.()).toEqual([]);
    });
  });

  describe('commands', () => {
    it('registers exactly one slash command', () => {
      const registered: string[] = [];
      const app = {
        pluginName: 'goals',
        command: (name: string) => {
          registered.push(name);
        },
      } as unknown as PluginApp;

      plugin.registerCommands?.(app);

      expect(registered).toEqual(['/goals']);
    });

    it('replies rather than throwing when called before init', async () => {
      await plugin.destroy?.(makeMockContext(t.db));

      let handler: ((args: unknown) => Promise<void>) | null = null;
      const app = {
        pluginName: 'goals',
        command: (_name: string, fn: (args: unknown) => Promise<void>) => {
          handler = fn;
        },
      } as unknown as PluginApp;
      plugin.registerCommands?.(app);

      const ack = vi.fn().mockResolvedValue(undefined);
      const respond = vi.fn().mockResolvedValue(undefined);
      await handler!({ command: { text: '', user_id: 'U1' }, ack, respond });

      expect(ack).toHaveBeenCalled();
      expect(respond).toHaveBeenCalledWith(expect.stringContaining('still starting up'));
    });

    it('answers a real command once initialised', async () => {
      await plugin.init?.(makeMockContext(t.db));

      let handler: ((args: unknown) => Promise<void>) | null = null;
      const app = {
        pluginName: 'goals',
        command: (_name: string, fn: (args: unknown) => Promise<void>) => {
          handler = fn;
        },
      } as unknown as PluginApp;
      plugin.registerCommands?.(app);

      const respond = vi.fn().mockResolvedValue(undefined);
      await handler!({
        command: { text: 'add Book the ferry', user_id: 'U012ABC' },
        ack: vi.fn().mockResolvedValue(undefined),
        respond,
      });

      expect(respond).toHaveBeenCalledWith(expect.stringContaining('Book the ferry'));
    });
  });

  describe('web routes', () => {
    it('registers the pages the nav and screenshots point at', () => {
      const paths = captureRoutes()
        .filter((route) => route.method === 'GET')
        .map((route) => route.path);

      expect(paths).toEqual(expect.arrayContaining(['/', '/members', '/b/:boardId']));
    });
  });

  describe('screenshotSetup', () => {
    it('seeds a board rich enough to show every visual state', async () => {
      await plugin.screenshotSetup?.(makeMockContext(t.db));

      const boards = t.raw.prepare(`SELECT COUNT(*) AS c FROM ${t.db.prefix}boards`).get() as {
        c: number;
      };
      const cards = t.raw.prepare(`SELECT COUNT(*) AS c FROM ${t.db.prefix}cards`).get() as {
        c: number;
      };
      // The fixture dates are relative to the real today, so that the "due
      // today" card never silently ages into an overdue one.
      const overdue = t.raw
        .prepare(
          `SELECT COUNT(*) AS c FROM ${t.db.prefix}cards WHERE due_date IS NOT NULL AND due_date < ?`
        )
        .get(todayIso()) as { c: number };

      const dueToday = t.raw
        .prepare(`SELECT COUNT(*) AS c FROM ${t.db.prefix}cards WHERE due_date = ?`)
        .get(todayIso()) as { c: number };
      expect(dueToday.c).toBeGreaterThan(0);

      expect(boards.c).toBeGreaterThanOrEqual(2);
      expect(cards.c).toBeGreaterThan(5);
      expect(overdue.c).toBeGreaterThan(0);
    });

    it('seeds board 1, which the screenshot path points at', async () => {
      await plugin.screenshotSetup?.(makeMockContext(t.db));

      const first = t.raw.prepare(`SELECT id FROM ${t.db.prefix}boards ORDER BY id LIMIT 1`).get() as {
        id: number;
      };
      expect(plugin.screenshotPages?.some((page) => page.path === `/b/${String(first.id)}`)).toBe(true);
    });
  });
});

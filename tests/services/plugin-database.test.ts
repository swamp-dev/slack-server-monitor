import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { PluginDatabase } from '../../src/services/plugin-database.js';
import {
  getPluginDatabase,
  closePluginDatabases,
  _resetPluginDatabases,
} from '../../src/services/plugin-database.js';

// Mock the logger to avoid console noise
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('PluginDatabase', () => {
  let testDbPath: string;

  beforeEach(() => {
    // Create a unique temp path for each test
    testDbPath = path.join(os.tmpdir(), `test-plugin-db-${Date.now()}.db`);
    _resetPluginDatabases();
  });

  afterEach(() => {
    closePluginDatabases();
    // Clean up test database files
    try {
      fs.unlinkSync(testDbPath);
    } catch {
      // File may not exist
    }
    try {
      fs.unlinkSync(testDbPath + '-wal');
    } catch {
      // WAL file may not exist
    }
    try {
      fs.unlinkSync(testDbPath + '-shm');
    } catch {
      // SHM file may not exist
    }
  });

  describe('getPluginDatabase', () => {
    it('should create a database accessor with correct prefix', () => {
      const db = getPluginDatabase('testplugin', testDbPath);
      expect(db.prefix).toBe('plugin_testplugin_');
    });

    it('should return cached instance for same plugin', () => {
      const db1 = getPluginDatabase('testplugin', testDbPath);
      const db2 = getPluginDatabase('testplugin', testDbPath);
      expect(db1).toBe(db2);
    });

    it('should create separate instances for different plugins', () => {
      const db1 = getPluginDatabase('plugin1', testDbPath);
      const db2 = getPluginDatabase('plugin2', testDbPath);
      expect(db1).not.toBe(db2);
      expect(db1.prefix).toBe('plugin_plugin1_');
      expect(db2.prefix).toBe('plugin_plugin2_');
    });

    it('should reject invalid plugin names', () => {
      expect(() => getPluginDatabase('123invalid', testDbPath)).toThrow(/Invalid plugin name/);
      expect(() => getPluginDatabase('my-plugin', testDbPath)).toThrow(/Invalid plugin name/);
      expect(() => getPluginDatabase('', testDbPath)).toThrow(/Invalid plugin name/);
    });

    it('should accept valid plugin names with underscores', () => {
      const db = getPluginDatabase('my_plugin', testDbPath);
      expect(db.prefix).toBe('plugin_my_plugin_');
    });

    it('should throw on database path conflict', () => {
      getPluginDatabase('plugin1', testDbPath);
      expect(() => getPluginDatabase('plugin2', '/different/path.db')).toThrow(/Database path conflict/);
    });
  });

  describe('table access validation', () => {
    let db: PluginDatabase;

    beforeEach(() => {
      db = getPluginDatabase('testplugin', testDbPath);
    });

    describe('allowed operations', () => {
      it('should allow CREATE TABLE with plugin prefix', () => {
        expect(() => {
          db.exec(`
            CREATE TABLE IF NOT EXISTS plugin_testplugin_data (
              id INTEGER PRIMARY KEY,
              value TEXT
            )
          `);
        }).not.toThrow();
      });

      it('should allow INSERT into prefixed table', () => {
        db.exec(`
          CREATE TABLE IF NOT EXISTS plugin_testplugin_data (
            id INTEGER PRIMARY KEY,
            value TEXT
          )
        `);

        expect(() => {
          db.prepare('INSERT INTO plugin_testplugin_data (value) VALUES (?)').run('test');
        }).not.toThrow();
      });

      it('should allow SELECT from prefixed table', () => {
        db.exec(`
          CREATE TABLE IF NOT EXISTS plugin_testplugin_data (
            id INTEGER PRIMARY KEY,
            value TEXT
          )
        `);
        db.prepare('INSERT INTO plugin_testplugin_data (value) VALUES (?)').run('test');

        const result = db.prepare('SELECT value FROM plugin_testplugin_data').get() as { value: string };
        expect(result.value).toBe('test');
      });

      it('should allow UPDATE on prefixed table', () => {
        db.exec(`
          CREATE TABLE IF NOT EXISTS plugin_testplugin_data (
            id INTEGER PRIMARY KEY,
            value TEXT
          )
        `);
        db.prepare('INSERT INTO plugin_testplugin_data (value) VALUES (?)').run('old');

        expect(() => {
          db.prepare('UPDATE plugin_testplugin_data SET value = ? WHERE id = ?').run('new', 1);
        }).not.toThrow();
      });

      it('should allow DELETE from prefixed table', () => {
        db.exec(`
          CREATE TABLE IF NOT EXISTS plugin_testplugin_data (
            id INTEGER PRIMARY KEY,
            value TEXT
          )
        `);
        db.prepare('INSERT INTO plugin_testplugin_data (value) VALUES (?)').run('test');

        expect(() => {
          db.prepare('DELETE FROM plugin_testplugin_data WHERE id = ?').run(1);
        }).not.toThrow();
      });

      it('should allow DROP TABLE with plugin prefix', () => {
        db.exec(`
          CREATE TABLE IF NOT EXISTS plugin_testplugin_temp (
            id INTEGER PRIMARY KEY
          )
        `);

        expect(() => {
          db.exec('DROP TABLE IF EXISTS plugin_testplugin_temp');
        }).not.toThrow();
      });

      it('should allow CREATE INDEX on prefixed table', () => {
        db.exec(`
          CREATE TABLE IF NOT EXISTS plugin_testplugin_data (
            id INTEGER PRIMARY KEY,
            value TEXT
          )
        `);

        expect(() => {
          db.exec('CREATE INDEX IF NOT EXISTS idx_plugin_testplugin_data_value ON plugin_testplugin_data(value)');
        }).not.toThrow();
      });

      it('should allow PRAGMA statements', () => {
        expect(() => {
          db.prepare('PRAGMA table_info(plugin_testplugin_data)').all();
        }).not.toThrow();
      });

      it('should allow sqlite_master queries', () => {
        db.exec(`
          CREATE TABLE IF NOT EXISTS plugin_testplugin_data (
            id INTEGER PRIMARY KEY
          )
        `);

        expect(() => {
          db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
        }).not.toThrow();
      });
    });

    // Regex-based blocked-operations tests removed — the SQL parser was replaced
    // with explicit table declaration in prepare(). See 'prepare table declaration
    // validation' below for the new enforcement model.

    describe('transaction support', () => {
      it('should support transactions', () => {
        db.exec(`
          CREATE TABLE IF NOT EXISTS plugin_testplugin_data (
            id INTEGER PRIMARY KEY,
            value TEXT
          )
        `);

        const insertStmt = db.prepare('INSERT INTO plugin_testplugin_data (value) VALUES (?)');

        db.transaction(() => {
          insertStmt.run('value1');
          insertStmt.run('value2');
        });

        const rows = db.prepare('SELECT * FROM plugin_testplugin_data').all() as { value: string }[];
        expect(rows).toHaveLength(2);
      });
    });
  });

  describe('closePluginDatabases', () => {
    it('should close database and clear cache', () => {
      const db1 = getPluginDatabase('testplugin', testDbPath);

      // Create a table to verify the database is working
      db1.exec('CREATE TABLE plugin_testplugin_test (id INTEGER PRIMARY KEY)');

      closePluginDatabases();

      // After close, getting the database again should work (creates new connection)
      const db2 = getPluginDatabase('testplugin', testDbPath);
      expect(db2).not.toBe(db1);

      // The table should still exist (persisted)
      const tables = db2.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
      expect(tables.some((t) => t.name === 'plugin_testplugin_test')).toBe(true);
    });

    it('should not throw when called multiple times', () => {
      getPluginDatabase('testplugin', testDbPath);
      closePluginDatabases();
      expect(() => closePluginDatabases()).not.toThrow();
    });
  });

  describe('SQL pattern edge cases', () => {
    let db: PluginDatabase;

    beforeEach(() => {
      db = getPluginDatabase('testplugin', testDbPath);
    });

    it('should handle INSERT OR REPLACE', () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS plugin_testplugin_data (
          id INTEGER PRIMARY KEY,
          value TEXT
        )
      `);

      expect(() => {
        db.prepare('INSERT OR REPLACE INTO plugin_testplugin_data (id, value) VALUES (?, ?)').run(1, 'test');
      }).not.toThrow();
    });

    it('should handle UPDATE OR IGNORE', () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS plugin_testplugin_data (
          id INTEGER PRIMARY KEY,
          value TEXT UNIQUE
        )
      `);
      db.prepare('INSERT INTO plugin_testplugin_data (value) VALUES (?)').run('existing');

      expect(() => {
        db.prepare('UPDATE OR IGNORE plugin_testplugin_data SET value = ? WHERE id = ?').run('existing', 1);
      }).not.toThrow();
    });

    it('should handle subqueries', () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS plugin_testplugin_data (
          id INTEGER PRIMARY KEY,
          value TEXT
        )
      `);
      db.exec(`
        CREATE TABLE IF NOT EXISTS plugin_testplugin_refs (
          id INTEGER PRIMARY KEY,
          data_id INTEGER
        )
      `);

      expect(() => {
        db.prepare(`
          SELECT * FROM plugin_testplugin_data
          WHERE id IN (SELECT data_id FROM plugin_testplugin_refs)
        `).all();
      }).not.toThrow();
    });

    it('should handle LEFT JOIN with plugin tables', () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS plugin_testplugin_data (
          id INTEGER PRIMARY KEY,
          value TEXT
        )
      `);
      db.exec(`
        CREATE TABLE IF NOT EXISTS plugin_testplugin_refs (
          id INTEGER PRIMARY KEY,
          data_id INTEGER
        )
      `);

      expect(() => {
        db.prepare(`
          SELECT * FROM plugin_testplugin_data d
          LEFT JOIN plugin_testplugin_refs r ON r.data_id = d.id
        `).all();
      }).not.toThrow();
    });
  });

  describe('prepare table declaration validation', () => {
    let db: PluginDatabase;

    beforeEach(() => {
      db = getPluginDatabase('myplugin', testDbPath);
    });

    it('succeeds when the declared table uses the correct plugin prefix', () => {
      expect(() => db.prepare('SELECT 1', ['plugin_myplugin_t'])).not.toThrow();
    });

    it('throws when a foreign plugin table name is declared', () => {
      expect(() => db.prepare('SELECT 1', ['plugin_other_t'])).toThrow(
        /plugin_other_t/,
      );
    });

    it('includes the foreign table name in the error message', () => {
      expect(() => db.prepare('SELECT 1', ['plugin_other_t'])).toThrow(
        expect.objectContaining({ message: expect.stringContaining('plugin_other_t') }),
      );
    });

    it('succeeds with an empty tables array (for statements like SELECT 1)', () => {
      expect(() => db.prepare('SELECT 1', [])).not.toThrow();
    });

    it('throws when any table in the list is a foreign plugin table', () => {
      expect(() =>
        db.prepare('SELECT 1', ['plugin_myplugin_t', 'plugin_other_t']),
      ).toThrow(/plugin_other_t/);
    });

    it('allows sqlite_ system tables to be declared', () => {
      expect(() => db.prepare('SELECT 1', ['sqlite_master'])).not.toThrow();
    });
  });
});

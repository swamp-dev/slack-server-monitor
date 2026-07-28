/**
 * PluginDatabase isolates plugins by validating the tables each statement
 * declares as `prepare()`'s second argument. The argument defaults to `[]`, so
 * a query that forgets it silently opts out of that check — the failure mode is
 * invisible. This suite reads the source and refuses to let that happen.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { PluginDatabase } from '../../src/services/plugin-database.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const SOURCE_FILES = fs
  .readdirSync(here)
  .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
  .filter((name) => name !== 'test-support.ts' && name !== 'route-support.ts');

/** Every `.prepare(` call in a file, with its full argument list. */
function prepareCalls(source: string): string[] {
  const calls: string[] = [];
  let i = 0;

  while (i < source.length) {
    const at = source.indexOf('.prepare(', i);
    if (at === -1) break;

    let depth = 1;
    let j = at + '.prepare('.length;
    const start = j;
    let inTick = false;

    while (j < source.length && depth > 0) {
      const ch = source[j];
      if (ch === '\\') {
        j += 2;
        continue;
      }
      if (ch === '`') inTick = !inTick;
      else if (!inTick && ch === '(') depth++;
      else if (!inTick && ch === ')') depth--;
      if (depth === 0) break;
      j++;
    }

    calls.push(source.slice(start, j));
    i = j + 1;
  }

  return calls;
}

describe('plugin table declarations', () => {
  it('finds the prepare calls it is meant to be checking', () => {
    const total = SOURCE_FILES.reduce(
      (sum, name) => sum + prepareCalls(fs.readFileSync(path.join(here, name), 'utf8')).length,
      0
    );

    // A parser bug that matched nothing would make this suite vacuously green.
    expect(total).toBeGreaterThan(50);
  });

  it.each(SOURCE_FILES)('%s declares the tables every statement touches', (name) => {
    const source = fs.readFileSync(path.join(here, name), 'utf8');

    const undeclared = prepareCalls(source).filter((call) => {
      // PRAGMA statements touch no plugin table by name.
      if (/PRAGMA/i.test(call)) return false;
      // A declaration is either a literal array or a helper returning one.
      return !/,\s*(\[|\.{3}|[A-Z_]+\()/.test(call) && !/,\s*CARD_SELECT_TABLES/.test(call);
    });

    expect(undeclared).toEqual([]);
  });

  it('rejects a table outside the plugin prefix', () => {
    const raw = new Database(':memory:');
    const db = new PluginDatabase(raw, 'goals');

    expect(() => db.prepare('SELECT 1 FROM users', ['users'])).toThrow(/prefix/i);
    expect(() => db.prepare('SELECT 1 FROM plugin_lift_sets', ['plugin_lift_sets'])).toThrow();

    raw.close();
  });
});

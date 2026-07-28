/**
 * PluginDatabase isolates plugins by validating the tables each statement
 * declares as `prepare()`'s second argument. The argument defaults to `[]`, so
 * a query that forgets it silently opts out of that check — the failure mode is
 * invisible. This suite reads the source and refuses to let that happen.
 *
 * Everything here works on a "code skeleton": the source with the *contents* of
 * strings and comments blanked out, character for character, so positions still
 * line up with the original. Scanning raw text is not good enough — a comma in
 * `SELECT a, COUNT(b)`, or a bracket inside `// note: an array like [`, would
 * otherwise be read as code and defeat the guard in either direction.
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

/**
 * Blank the contents of comments and string literals, preserving length and
 * line structure so offsets remain valid against the original source.
 */
export function codeSkeleton(source: string): string {
  const blank = (ch: string): string => (ch === '\n' ? '\n' : ' ');
  let out = '';
  let i = 0;

  while (i < source.length) {
    const ch = source[i]!;
    const next = source[i + 1];

    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') {
        out += ' ';
        i++;
      }
      continue;
    }

    if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      while (i < stop) {
        out += blank(source[i]!);
        i++;
      }
      continue;
    }

    if (ch === "'" || ch === '"') {
      const quote = ch;
      out += ' ';
      i++;
      while (i < source.length) {
        if (source[i] === '\\') {
          out += '  ';
          i += 2;
          continue;
        }
        const c = source[i]!;
        out += blank(c);
        i++;
        if (c === quote) break;
      }
      continue;
    }

    if (ch === '`') {
      out += ' ';
      i++;
      while (i < source.length) {
        if (source[i] === '\\') {
          out += '  ';
          i += 2;
          continue;
        }
        if (source[i] === '$' && source[i + 1] === '{') {
          // Blank the whole interpolation; its commas and brackets are not ours.
          let depth = 1;
          out += '  ';
          i += 2;
          while (i < source.length && depth > 0) {
            if (source[i] === '{') depth++;
            else if (source[i] === '}') depth--;
            out += blank(source[i]!);
            i++;
          }
          continue;
        }
        const c = source[i]!;
        out += blank(c);
        i++;
        if (c === '`') break;
      }
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

/** Does this argument list have a second top-level argument? */
export function hasSecondArgument(args: string): boolean {
  const skeleton = codeSkeleton(args);
  let depth = 0;

  for (const ch of skeleton) {
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) return true;
  }

  return false;
}

/** Every `.prepare(` call in a file, with its full argument list. */
export function prepareCalls(source: string): string[] {
  const skeleton = codeSkeleton(source);
  const calls: string[] = [];
  let i = 0;

  while (i < skeleton.length) {
    const at = skeleton.indexOf('.prepare(', i);
    if (at === -1) break;

    const start = at + '.prepare('.length;
    let depth = 1;
    let j = start;

    while (j < skeleton.length && depth > 0) {
      const ch = skeleton[j];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      if (depth === 0) break;
      j++;
    }

    // Offsets are valid against the original because the skeleton is
    // length-preserving.
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
      return !hasSecondArgument(call);
    });

    expect(undeclared).toEqual([]);
  });

  describe('hasSecondArgument', () => {
    it('does not mistake a comma inside the SQL for a declaration', () => {
      expect(hasSecondArgument('`SELECT a, COUNT(b) FROM t WHERE x = ?`')).toBe(false);
      expect(hasSecondArgument("`SELECT * FROM t WHERE v IN ('a', 'b')`")).toBe(false);
      expect(hasSecondArgument('`SELECT ${prefix}a, ${x ? "y, z" : "w"} FROM t`')).toBe(false);
      expect(hasSecondArgument("'SELECT a, b FROM t'")).toBe(false);
      expect(hasSecondArgument('"SELECT a, b FROM t"')).toBe(false);
    });

    it('does not mistake a comma inside a comment for a declaration', () => {
      // The natural thing to write at exactly the spot where someone is
      // explaining why they left the tables argument off.
      expect(hasSecondArgument('sql // no tables, single row')).toBe(false);
      expect(hasSecondArgument('\n  sql\n  // none needed, single-row insert\n')).toBe(false);
      expect(hasSecondArgument('sql /* none needed, really */')).toBe(false);
    });

    it('is not thrown off by an unbalanced bracket inside a comment', () => {
      expect(hasSecondArgument('sql /* an array like [ */, [`t`]')).toBe(true);
      expect(hasSecondArgument('sql /* note: fixed bug ) */, [`t`]')).toBe(true);
      expect(hasSecondArgument('sql // trailing ( note\n, [`t`]')).toBe(true);
    });

    it('is not thrown off by an escaped quote inside the SQL', () => {
      expect(hasSecondArgument("`it\\`s a test, really`")).toBe(false);
      expect(hasSecondArgument("'don\\'t, really'")).toBe(false);
      expect(hasSecondArgument("`it\\`s a test`, [`t`]")).toBe(true);
    });

    it('recognises every declaration form used in this plugin', () => {
      expect(hasSecondArgument('`SELECT a, b FROM t`, [`${db.prefix}t`]')).toBe(true);
      expect(hasSecondArgument('`SELECT 1`, CARD_SELECT_TABLES(db.prefix)')).toBe(true);
      expect(hasSecondArgument('`SELECT 1`, [...TABLES(p), `${p}x`]')).toBe(true);
    });

    it('sees a declaration that follows nested brackets', () => {
      // Depth must return to zero across a nested call before the comma counts.
      expect(hasSecondArgument('fn(a, [b, {c: 1}]), [`t`]')).toBe(true);
      expect(hasSecondArgument('fn(a, [b, {c: 1}])')).toBe(false);
    });
  });

  describe('codeSkeleton', () => {
    it('preserves length so offsets stay valid', () => {
      const samples = [
        'const a = `SELECT 1`;',
        "// a comment, with a comma\nconst b = 'x';",
        '/* block\nspanning lines */ const c = `${x}`;',
        "const d = 'esc\\'aped';",
      ];

      for (const sample of samples) {
        expect(codeSkeleton(sample)).toHaveLength(sample.length);
      }
    });

    it('keeps code structure while blanking contents', () => {
      expect(codeSkeleton('f(`a, b`)')).toBe(`f(${' '.repeat(6)})`);
      expect(codeSkeleton('f() // x, y')).toBe(`f()${' '.repeat(8)}`);
    });
  });

  describe('prepareCalls', () => {
    it('ignores a .prepare( that appears inside a string or comment', () => {
      const source = [
        "const doc = '.prepare(fake)';",
        '// .prepare(alsoFake)',
        'db.prepare(`SELECT 1`, [`p_t`]);',
      ].join('\n');

      expect(prepareCalls(source)).toEqual(['`SELECT 1`, [`p_t`]']);
    });

    it('returns the original text, not the blanked skeleton', () => {
      expect(prepareCalls('db.prepare(`SELECT 1`, [`p_t`]);')[0]).toContain('SELECT 1');
    });
  });

  it('rejects a table outside the plugin prefix', () => {
    const raw = new Database(':memory:');
    const db = new PluginDatabase(raw, 'goals');

    expect(() => db.prepare('SELECT 1 FROM users', ['users'])).toThrow(/prefix/i);
    expect(() => db.prepare('SELECT 1 FROM plugin_lift_sets', ['plugin_lift_sets'])).toThrow();

    raw.close();
  });
});

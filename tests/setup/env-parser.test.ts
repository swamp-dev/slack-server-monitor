import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import {
  parseEnvFile,
  writeEnvFile,
  backupEnvFile,
} from '../../src/setup/env-parser.js';

const TEST_DIR = join(import.meta.dirname, '..', '..', '.test-env-parser');

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('parseEnvFile', () => {
  it('should parse key=value pairs', () => {
    const envPath = join(TEST_DIR, '.env');
    writeFileSync(envPath, 'FOO=bar\nBAZ=qux\n');

    const result = parseEnvFile(envPath);
    expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' });
  });

  it('should ignore comment lines', () => {
    const envPath = join(TEST_DIR, '.env');
    writeFileSync(envPath, '# This is a comment\nFOO=bar\n# Another comment\n');

    const result = parseEnvFile(envPath);
    expect(result).toEqual({ FOO: 'bar' });
  });

  it('should ignore blank lines', () => {
    const envPath = join(TEST_DIR, '.env');
    writeFileSync(envPath, 'FOO=bar\n\n\nBAZ=qux\n');

    const result = parseEnvFile(envPath);
    expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' });
  });

  it('should handle double-quoted values', () => {
    const envPath = join(TEST_DIR, '.env');
    writeFileSync(envPath, 'FOO="hello world"\n');

    const result = parseEnvFile(envPath);
    expect(result).toEqual({ FOO: 'hello world' });
  });

  it('should handle single-quoted values', () => {
    const envPath = join(TEST_DIR, '.env');
    writeFileSync(envPath, "FOO='hello world'\n");

    const result = parseEnvFile(envPath);
    expect(result).toEqual({ FOO: 'hello world' });
  });

  it('should handle empty values', () => {
    const envPath = join(TEST_DIR, '.env');
    writeFileSync(envPath, 'FOO=\nBAR=value\n');

    const result = parseEnvFile(envPath);
    expect(result).toEqual({ FOO: '', BAR: 'value' });
  });

  it('should handle values with equals signs', () => {
    const envPath = join(TEST_DIR, '.env');
    writeFileSync(envPath, 'FOO=bar=baz\n');

    const result = parseEnvFile(envPath);
    expect(result).toEqual({ FOO: 'bar=baz' });
  });

  it('should return empty object for nonexistent file', () => {
    const result = parseEnvFile(join(TEST_DIR, 'nonexistent'));
    expect(result).toEqual({});
  });
});

describe('writeEnvFile', () => {
  it('should write key=value pairs using template structure', () => {
    const templatePath = join(TEST_DIR, '.env.example');
    const outputPath = join(TEST_DIR, '.env');

    writeFileSync(
      templatePath,
      [
        '# Config file',
        'FOO=default-foo',
        'BAR=default-bar',
        '',
      ].join('\n')
    );

    writeEnvFile(outputPath, { FOO: 'custom-foo', BAR: 'custom-bar' }, templatePath);

    const content = readFileSync(outputPath, 'utf-8');
    expect(content).toContain('FOO=custom-foo');
    expect(content).toContain('BAR=custom-bar');
  });

  it('should preserve comments from template', () => {
    const templatePath = join(TEST_DIR, '.env.example');
    const outputPath = join(TEST_DIR, '.env');

    writeFileSync(
      templatePath,
      [
        '# =============',
        '# Section Header',
        '# =============',
        '',
        '# Description of FOO',
        'FOO=default',
        '',
      ].join('\n')
    );

    writeEnvFile(outputPath, { FOO: 'value' }, templatePath);

    const content = readFileSync(outputPath, 'utf-8');
    expect(content).toContain('# =============');
    expect(content).toContain('# Section Header');
    expect(content).toContain('# Description of FOO');
    expect(content).toContain('FOO=value');
  });

  it('should uncomment template lines when key is in vars', () => {
    const templatePath = join(TEST_DIR, '.env.example');
    const outputPath = join(TEST_DIR, '.env');

    writeFileSync(
      templatePath,
      [
        '# Optional setting',
        '# OPTIONAL_KEY=default',
        '',
      ].join('\n')
    );

    writeEnvFile(outputPath, { OPTIONAL_KEY: 'my-value' }, templatePath);

    const content = readFileSync(outputPath, 'utf-8');
    expect(content).toContain('OPTIONAL_KEY=my-value');
    // The descriptive comment should still be there
    expect(content).toContain('# Optional setting');
  });

  it('should keep template defaults for keys not in vars', () => {
    const templatePath = join(TEST_DIR, '.env.example');
    const outputPath = join(TEST_DIR, '.env');

    writeFileSync(
      templatePath,
      [
        'FOO=default-foo',
        'BAR=default-bar',
        '',
      ].join('\n')
    );

    writeEnvFile(outputPath, { FOO: 'custom' }, templatePath);

    const content = readFileSync(outputPath, 'utf-8');
    expect(content).toContain('FOO=custom');
    expect(content).toContain('BAR=default-bar');
  });

  it('should quote values containing spaces', () => {
    const templatePath = join(TEST_DIR, '.env.example');
    const outputPath = join(TEST_DIR, '.env');

    writeFileSync(templatePath, 'FOO=default\n');

    writeEnvFile(outputPath, { FOO: 'hello world' }, templatePath);

    const content = readFileSync(outputPath, 'utf-8');
    expect(content).toContain('FOO="hello world"');
  });
});

describe('backupEnvFile', () => {
  it('should create a timestamped backup copy', () => {
    const envPath = join(TEST_DIR, '.env');
    writeFileSync(envPath, 'FOO=bar\n');

    const backupPath = backupEnvFile(envPath);

    expect(existsSync(backupPath)).toBe(true);
    expect(backupPath).toMatch(/\.env\.backup\.\d{4}-\d{2}-\d{2}T/);
    expect(readFileSync(backupPath, 'utf-8')).toBe('FOO=bar\n');
  });

  it('should throw if source file does not exist', () => {
    expect(() => backupEnvFile(join(TEST_DIR, 'nonexistent'))).toThrow();
  });
});

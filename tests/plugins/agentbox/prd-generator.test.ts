/**
 * PRD Generator Tests
 *
 * TDD test suite for converting GitHub issue markdown into AgentBox prd.json.
 * Tests cover: parsing, generation, validation, edge cases, and golden fixtures.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  generatePRD,
  parseAcceptanceCriteria,
  parseFiles,
  parseDependencies,
  parseSummary,
  validatePRD,
  PRDGenerationError,
  type PRD,
  type IssueInput,
} from '../../../plugins.example/agentbox/prd-generator.js';

// =============================================================================
// Helpers
// =============================================================================

const FIXTURES_DIR = join(process.cwd(), 'tests/fixtures/agentbox');

function loadFixture(name: string): { input: IssueInput; expected: PRD } {
  const inputRaw = readFileSync(join(FIXTURES_DIR, `${name}.input.md`), 'utf-8');

  // Parse frontmatter for title and issue_number
  const frontmatterMatch = inputRaw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  let title = name;
  let body = inputRaw;

  if (frontmatterMatch) {
    const frontmatter = frontmatterMatch[1];
    body = frontmatterMatch[2].trim();
    const titleMatch = frontmatter.match(/title:\s*"(.+)"/);
    if (titleMatch) title = titleMatch[1];
  }

  const expected = JSON.parse(
    readFileSync(join(FIXTURES_DIR, `${name}.expected.json`), 'utf-8'),
  );

  return { input: { title, body }, expected };
}

function listGoldenFixtures(): string[] {
  const files = readdirSync(FIXTURES_DIR);
  return files
    .filter((f) => f.endsWith('.input.md'))
    .map((f) => f.replace('.input.md', ''));
}

// =============================================================================
// parseAcceptanceCriteria
// =============================================================================

describe('parseAcceptanceCriteria', () => {
  it('should extract unchecked checkbox items', () => {
    const body = `## Acceptance Criteria

- [ ] First criterion
- [ ] Second criterion
- [ ] Third criterion`;

    const result = parseAcceptanceCriteria(body);
    expect(result).toHaveLength(3);
    expect(result[0].text).toBe('First criterion');
    expect(result[0].checked).toBe(false);
    expect(result[1].text).toBe('Second criterion');
    expect(result[2].text).toBe('Third criterion');
  });

  it('should handle checked items', () => {
    const body = `## Acceptance Criteria

- [x] Already done
- [ ] Still pending`;

    const result = parseAcceptanceCriteria(body);
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('Already done');
    expect(result[0].checked).toBe(true);
    expect(result[1].text).toBe('Still pending');
    expect(result[1].checked).toBe(false);
  });

  it('should return empty array when no acceptance criteria section', () => {
    const body = `## Summary\n\nJust a summary, no criteria.`;
    const result = parseAcceptanceCriteria(body);
    expect(result).toEqual([]);
  });

  it('should return empty array when section has no checkboxes', () => {
    const body = `## Acceptance Criteria

Just some prose without checkboxes.`;

    const result = parseAcceptanceCriteria(body);
    expect(result).toEqual([]);
  });

  it('should handle mixed checkbox and non-checkbox lines', () => {
    const body = `## Acceptance Criteria

- [ ] Task A
Some additional context about task A
- [ ] Task B`;

    const result = parseAcceptanceCriteria(body);
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('Task A');
    expect(result[0].children).toContain('Some additional context about task A');
    expect(result[1].text).toBe('Task B');
  });

  it('should detect nested checkboxes via indentation', () => {
    const body = `## Acceptance Criteria

- [ ] Parent task
  - [ ] Child task 1
  - [ ] Child task 2
- [ ] Another top-level task`;

    const result = parseAcceptanceCriteria(body);
    expect(result).toHaveLength(4);
    expect(result[0].text).toBe('Parent task');
    expect(result[0].indent).toBe(0);
    expect(result[1].text).toBe('Child task 1');
    expect(result[1].indent).toBeGreaterThan(0);
    expect(result[2].text).toBe('Child task 2');
    expect(result[2].indent).toBeGreaterThan(0);
    expect(result[3].text).toBe('Another top-level task');
    expect(result[3].indent).toBe(0);
  });

  it('should handle checkbox items with sub-list descriptions', () => {
    const body = `## Acceptance Criteria

- [ ] Database tables created on init:
  - \`plugin_agentbox_runs\` — tracks each execution
  - \`plugin_agentbox_issue_links\` — maps issue to thread`;

    const result = parseAcceptanceCriteria(body);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('Database tables created on init');
    expect(result[0].children.length).toBeGreaterThan(0);
  });

  it('should preserve special characters in task text', () => {
    const body = `## Acceptance Criteria

- [ ] Handle \`null\` values in \`user.email\`
- [ ] Support "quoted strings" and <angle brackets>`;

    const result = parseAcceptanceCriteria(body);
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('Handle `null` values in `user.email`');
    expect(result[1].text).toBe('Support "quoted strings" and <angle brackets>');
  });

  it('should stop parsing at the next ## section', () => {
    const body = `## Acceptance Criteria

- [ ] First criterion
- [ ] Second criterion

## Files

- \`src/foo.ts\``;

    const result = parseAcceptanceCriteria(body);
    expect(result).toHaveLength(2);
  });

  it('should handle uppercase [X] as checked', () => {
    const body = `## Acceptance Criteria

- [X] Done with uppercase X
- [ ] Still pending`;

    const result = parseAcceptanceCriteria(body);
    expect(result[0].checked).toBe(true);
    expect(result[1].checked).toBe(false);
  });
});

// =============================================================================
// parseFiles
// =============================================================================

describe('parseFiles', () => {
  it('should extract file paths with descriptions', () => {
    const body = `## Files

- \`src/foo.ts\` — service logic
- \`tests/foo.test.ts\` — tests`;

    const result = parseFiles(body);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ path: 'src/foo.ts', role: 'service logic' });
    expect(result[1]).toEqual({ path: 'tests/foo.test.ts', role: 'tests' });
  });

  it('should handle paths without descriptions', () => {
    const body = `## Files

- \`src/foo.ts\``;

    const result = parseFiles(body);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ path: 'src/foo.ts', role: '' });
  });

  it('should return empty array when no files section', () => {
    const body = `## Summary\n\nNo files here.`;
    const result = parseFiles(body);
    expect(result).toEqual([]);
  });

  it('should handle various separator styles (em dash, dash, colon)', () => {
    const body = `## Files

- \`src/a.ts\` — em dash role
- \`src/b.ts\` - regular dash role
- \`src/c.ts\`: colon role`;

    const result = parseFiles(body);
    expect(result).toHaveLength(3);
    expect(result[0].role).toBe('em dash role');
    expect(result[1].role).toBe('regular dash role');
    expect(result[2].role).toBe('colon role');
  });

  it('should stop parsing at the next ## section', () => {
    const body = `## Files

- \`src/foo.ts\` — logic

## Dependencies

Part of #100.`;

    const result = parseFiles(body);
    expect(result).toHaveLength(1);
  });
});

// =============================================================================
// parseDependencies
// =============================================================================

describe('parseDependencies', () => {
  it('should extract depends_on issue numbers', () => {
    const body = `## Dependencies

Depends on #155, #156.`;

    const result = parseDependencies(body);
    expect(result.depends_on).toEqual([155, 156]);
  });

  it('should extract epic reference separately', () => {
    const body = `## Dependencies

Part of #154. Depends on #155.`;

    const result = parseDependencies(body);
    expect(result.epic).toBe(154);
    expect(result.depends_on).toEqual([155]);
  });

  it('should return null epic and empty deps when no section', () => {
    const body = `## Summary\n\nNo dependencies.`;
    const result = parseDependencies(body);
    expect(result.epic).toBeNull();
    expect(result.depends_on).toEqual([]);
  });

  it('should handle "No blocking dependencies" text', () => {
    const body = `## Dependencies

Part of #154. No blocking dependencies — this is the first ticket.`;

    const result = parseDependencies(body);
    expect(result.epic).toBe(154);
    expect(result.depends_on).toEqual([]);
  });

  it('should deduplicate depends_on entries', () => {
    const body = `## Dependencies

Depends on #155, #155, #156.`;

    const result = parseDependencies(body);
    expect(result.depends_on).toEqual([155, 156]);
  });

  it('should handle "Depends on" with single issue', () => {
    const body = `## Dependencies

Part of #154. Depends on #155 (plugin skeleton).`;

    const result = parseDependencies(body);
    expect(result.depends_on).toEqual([155]);
  });
});

// =============================================================================
// parseSummary
// =============================================================================

describe('parseSummary', () => {
  it('should extract text from Summary section', () => {
    const body = `## Summary

Create the agentbox plugin with init/destroy lifecycle.

## Context

Some context here.`;

    const result = parseSummary(body);
    expect(result).toBe('Create the agentbox plugin with init/destroy lifecycle.');
  });

  it('should return full body when no Summary section', () => {
    const body = 'Fix the login bug on mobile Safari.';
    const result = parseSummary(body);
    expect(result).toBe('Fix the login bug on mobile Safari.');
  });

  it('should handle multi-line summaries', () => {
    const body = `## Summary

First line of summary.
Second line of summary.

## Acceptance Criteria`;

    const result = parseSummary(body);
    expect(result).toBe('First line of summary.\nSecond line of summary.');
  });
});

// =============================================================================
// generatePRD
// =============================================================================

describe('generatePRD', () => {
  it('should produce a valid PRD from a structured issue', () => {
    const input: IssueInput = {
      title: 'feat: add email validation',
      body: `## Summary

Add email validation to the registration form.

## Acceptance Criteria

- [ ] Validate email format on input
- [ ] Show error message for invalid emails
- [ ] Prevent form submission with invalid email

## Files

- \`src/components/register.ts\` — registration form`,
    };

    const prd = generatePRD(input);
    expect(prd.name).toBe('feat: add email validation');
    expect(prd.description).toBe('Add email validation to the registration form.');
    expect(prd.tasks).toHaveLength(3);
    expect(prd.tasks[0].id).toBe('task-1');
    expect(prd.tasks[0].title).toBe('Validate email format on input');
    expect(prd.tasks[0].status).toBe('pending');
    expect(prd.tasks[0].priority).toBe(1);
    expect(prd.tasks[1].depends_on).toEqual(['task-1']);
    expect(prd.tasks[2].depends_on).toEqual(['task-2']);
  });

  it('should set PRD name from issue title', () => {
    const prd = generatePRD({
      title: 'fix(shell): escape container names',
      body: '## Acceptance Criteria\n\n- [ ] Escape names',
    });
    expect(prd.name).toBe('fix(shell): escape container names');
  });

  it('should create single-task PRD when no acceptance criteria', () => {
    const input: IssueInput = {
      title: 'fix: login page CSS issue',
      body: 'The login page fails to render on mobile Safari.',
    };

    const prd = generatePRD(input);
    expect(prd.tasks).toHaveLength(1);
    expect(prd.tasks[0].title).toBe('fix: login page CSS issue');
    expect(prd.tasks[0].description).toBe(
      'The login page fails to render on mobile Safari.',
    );
  });

  it('should include file context in task descriptions', () => {
    const input: IssueInput = {
      title: 'feat: add validation',
      body: `## Acceptance Criteria

- [ ] Add email validation

## Files

- \`src/utils/validate.ts\` — validation helpers
- \`tests/utils/validate.test.ts\` — tests`,
    };

    const prd = generatePRD(input);
    expect(prd.tasks[0].description).toContain('src/utils/validate.ts');
    expect(prd.tasks[0].description).toContain('tests/utils/validate.test.ts');
  });

  it('should set task priorities from list order', () => {
    const input: IssueInput = {
      title: 'feat: multi-task',
      body: `## Acceptance Criteria

- [ ] First
- [ ] Second
- [ ] Third`,
    };

    const prd = generatePRD(input);
    expect(prd.tasks[0].priority).toBe(1);
    expect(prd.tasks[1].priority).toBe(2);
    expect(prd.tasks[2].priority).toBe(3);
  });

  it('should set sequential dependencies by default', () => {
    const input: IssueInput = {
      title: 'feat: sequential',
      body: `## Acceptance Criteria

- [ ] Step A
- [ ] Step B
- [ ] Step C`,
    };

    const prd = generatePRD(input);
    expect(prd.tasks[0].depends_on).toBeUndefined();
    expect(prd.tasks[1].depends_on).toEqual(['task-1']);
    expect(prd.tasks[2].depends_on).toEqual(['task-2']);
  });

  it('should handle already-checked items as completed tasks', () => {
    const input: IssueInput = {
      title: 'feat: partial progress',
      body: `## Acceptance Criteria

- [x] Already done
- [ ] Still pending`,
    };

    const prd = generatePRD(input);
    expect(prd.tasks[0].status).toBe('completed');
    expect(prd.tasks[1].status).toBe('pending');
    expect(prd.metadata.completed).toBe(1);
    expect(prd.metadata.pending).toBe(1);
  });

  it('should throw PRDGenerationError on empty issue body', () => {
    expect(() => generatePRD({ title: 'empty', body: '' })).toThrow(
      PRDGenerationError,
    );
  });

  it('should throw PRDGenerationError on whitespace-only body', () => {
    expect(() => generatePRD({ title: 'blank', body: '   \n\n  ' })).toThrow(
      PRDGenerationError,
    );
  });

  it('should throw PRDGenerationError on empty title', () => {
    expect(() => generatePRD({ title: '', body: 'some content' })).toThrow(
      PRDGenerationError,
    );
  });

  it('should throw PRDGenerationError on whitespace-only title', () => {
    expect(() => generatePRD({ title: '   ', body: 'some content' })).toThrow(
      PRDGenerationError,
    );
  });

  it('should handle issue body with only a title (no sections)', () => {
    const prd = generatePRD({
      title: 'Fix the login bug on mobile',
      body: 'Fix the login bug on mobile',
    });
    expect(prd.tasks).toHaveLength(1);
    expect(prd.tasks[0].title).toBe('Fix the login bug on mobile');
  });

  it('should handle markdown with extra whitespace and blank lines', () => {
    const input: IssueInput = {
      title: 'feat: whitespace test',
      body: `## Acceptance Criteria


- [ ]   First with spaces

- [ ] Second


## Files

`,
    };

    const prd = generatePRD(input);
    expect(prd.tasks).toHaveLength(2);
    expect(prd.tasks[0].title).toBe('First with spaces');
    expect(prd.tasks[1].title).toBe('Second');
  });

  it('should handle very long acceptance criteria lists (>10 items)', () => {
    const criteria = Array.from(
      { length: 15 },
      (_, i) => `- [ ] Task number ${i + 1}`,
    ).join('\n');
    const input: IssueInput = {
      title: 'feat: many tasks',
      body: `## Acceptance Criteria\n\n${criteria}`,
    };

    const prd = generatePRD(input);
    expect(prd.tasks).toHaveLength(15);
    expect(prd.tasks[14].id).toBe('task-15');
    expect(prd.tasks[14].depends_on).toEqual(['task-14']);
    expect(prd.metadata.total_tasks).toBe(15);
  });

  it('should handle nested checkboxes as subtasks', () => {
    const input: IssueInput = {
      title: 'feat: nested tasks',
      body: `## Acceptance Criteria

- [ ] Parent task
  - [ ] Child task 1
  - [ ] Child task 2
- [ ] Another top-level task`,
    };

    const prd = generatePRD(input);
    // Parent task should have subtasks
    const parentTask = prd.tasks.find((t) => t.title === 'Parent task');
    expect(parentTask).toBeDefined();
    expect(parentTask?.subtasks).toHaveLength(2);
    expect(parentTask?.subtasks?.[0].title).toBe('Child task 1');
    expect(parentTask?.subtasks?.[1].title).toBe('Child task 2');

    // Metadata should count all tasks including subtasks
    expect(prd.metadata.total_tasks).toBe(4);
  });

  it('should include metadata with correct task counts', () => {
    const input: IssueInput = {
      title: 'feat: metadata test',
      body: `## Acceptance Criteria

- [x] Done task
- [ ] Pending task 1
- [ ] Pending task 2`,
    };

    const prd = generatePRD(input);
    expect(prd.metadata).toEqual({
      total_tasks: 3,
      completed: 1,
      in_progress: 0,
      pending: 2,
    });
  });

  it('should strip trailing colon from task title when followed by sub-items', () => {
    const input: IssueInput = {
      title: 'feat: colon stripping',
      body: `## Acceptance Criteria

- [ ] Database tables created on init:
  - table_a
  - table_b`,
    };

    const prd = generatePRD(input);
    expect(prd.tasks[0].title).toBe('Database tables created on init');
  });
});

// =============================================================================
// validatePRD
// =============================================================================

describe('validatePRD', () => {
  it('should pass for a valid PRD', () => {
    const prd: PRD = {
      name: 'test',
      description: 'test desc',
      tasks: [
        {
          id: 'task-1',
          title: 'Do thing',
          description: 'Do the thing',
          status: 'pending',
          priority: 1,
        },
      ],
      metadata: { total_tasks: 1, completed: 0, in_progress: 0, pending: 1 },
    };

    const result = validatePRD(prd);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should fail when tasks array is empty', () => {
    const prd: PRD = {
      name: 'test',
      description: 'test desc',
      tasks: [],
      metadata: { total_tasks: 0, completed: 0, in_progress: 0, pending: 0 },
    };

    const result = validatePRD(prd);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('PRD must have at least one task');
  });

  it('should fail when task is missing required fields', () => {
    const prd: PRD = {
      name: 'test',
      description: 'test desc',
      tasks: [
        { id: '', title: '', description: '', status: 'pending', priority: 1 },
      ],
      metadata: { total_tasks: 1, completed: 0, in_progress: 0, pending: 1 },
    };

    const result = validatePRD(prd);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('id'))).toBe(true);
    expect(result.errors.some((e) => e.includes('title'))).toBe(true);
  });

  it('should fail when depends_on references non-existent task', () => {
    const prd: PRD = {
      name: 'test',
      description: 'test desc',
      tasks: [
        {
          id: 'task-1',
          title: 'A',
          description: 'A',
          status: 'pending',
          priority: 1,
          depends_on: ['task-999'],
        },
      ],
      metadata: { total_tasks: 1, completed: 0, in_progress: 0, pending: 1 },
    };

    const result = validatePRD(prd);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('task-999'))).toBe(true);
  });

  it('should fail when task has invalid status', () => {
    const prd: PRD = {
      name: 'test',
      description: 'test desc',
      tasks: [
        {
          id: 'task-1',
          title: 'A',
          description: 'A',
          status: 'invalid' as PRD['tasks'][0]['status'],
          priority: 1,
        },
      ],
      metadata: { total_tasks: 1, completed: 0, in_progress: 0, pending: 1 },
    };

    const result = validatePRD(prd);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('status'))).toBe(true);
  });

  it('should detect circular dependencies', () => {
    const prd: PRD = {
      name: 'test',
      description: 'test desc',
      tasks: [
        {
          id: 'task-1',
          title: 'A',
          description: 'A',
          status: 'pending',
          priority: 1,
          depends_on: ['task-2'],
        },
        {
          id: 'task-2',
          title: 'B',
          description: 'B',
          status: 'pending',
          priority: 2,
          depends_on: ['task-1'],
        },
      ],
      metadata: { total_tasks: 2, completed: 0, in_progress: 0, pending: 2 },
    };

    const result = validatePRD(prd);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('circular'))).toBe(true);
  });

  it('should detect parent depending on its own subtask', () => {
    const prd: PRD = {
      name: 'test',
      description: 'test desc',
      tasks: [
        {
          id: 'task-1',
          title: 'A',
          description: 'A',
          status: 'pending',
          priority: 1,
          depends_on: ['task-1-1'],
          subtasks: [
            {
              id: 'task-1-1',
              title: 'Sub A',
              description: 'Sub A',
              status: 'pending',
              priority: 1,
            },
          ],
        },
      ],
      metadata: { total_tasks: 2, completed: 0, in_progress: 0, pending: 2 },
    };

    const result = validatePRD(prd);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('own subtask'))).toBe(true);
  });

  it('should detect cross-level circular dependencies', () => {
    const prd: PRD = {
      name: 'test',
      description: 'test desc',
      tasks: [
        {
          id: 'task-1',
          title: 'A',
          description: 'A',
          status: 'pending',
          priority: 1,
          depends_on: ['task-2'],
          subtasks: [
            {
              id: 'task-1-1',
              title: 'Sub A',
              description: 'Sub A',
              status: 'pending',
              priority: 1,
              depends_on: ['task-2'],
            },
          ],
        },
        {
          id: 'task-2',
          title: 'B',
          description: 'B',
          status: 'pending',
          priority: 2,
          depends_on: ['task-1-1'],
        },
      ],
      metadata: { total_tasks: 3, completed: 0, in_progress: 0, pending: 3 },
    };

    const result = validatePRD(prd);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('circular'))).toBe(true);
  });

  it('should detect duplicate task IDs', () => {
    const prd: PRD = {
      name: 'test',
      description: 'test desc',
      tasks: [
        {
          id: 'task-1',
          title: 'A',
          description: 'A',
          status: 'pending',
          priority: 1,
        },
        {
          id: 'task-1',
          title: 'B',
          description: 'B',
          status: 'pending',
          priority: 2,
        },
      ],
      metadata: { total_tasks: 2, completed: 0, in_progress: 0, pending: 2 },
    };

    const result = validatePRD(prd);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('duplicate'))).toBe(true);
  });
});

// =============================================================================
// Golden Fixtures
// =============================================================================

describe('golden fixtures', () => {
  const fixtures = listGoldenFixtures();

  it.each(fixtures)('should match expected output for %s', (fixtureName) => {
    const { input, expected } = loadFixture(fixtureName);
    const result = generatePRD(input);
    expect(result).toEqual(expected);
  });
});

// =============================================================================
// End-to-end: generated PRD passes validation
// =============================================================================

describe('end-to-end: generatePRD output is valid', () => {
  it('should produce a valid PRD for a structured issue', () => {
    const prd = generatePRD({
      title: 'feat: test feature',
      body: `## Summary

A feature.

## Acceptance Criteria

- [ ] Do first thing
- [ ] Do second thing

## Files

- \`src/foo.ts\` — logic`,
    });

    const validation = validatePRD(prd);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });

  it('should produce a valid PRD for a freeform issue', () => {
    const prd = generatePRD({
      title: 'fix: broken thing',
      body: 'The thing is broken. Please fix it.',
    });

    const validation = validatePRD(prd);
    expect(validation.valid).toBe(true);
  });
});

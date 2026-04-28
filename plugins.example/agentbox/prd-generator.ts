/**
 * PRD Generator — converts GitHub issue markdown into AgentBox prd.json format.
 *
 * Input: structured issue body with optional sections:
 *   ## Summary, ## Context, ## Acceptance Criteria, ## Files, ## Dependencies
 *
 * Output: AgentBox-compatible PRD JSON with tasks, dependencies, and metadata.
 */

// --- Types ---

export interface PRDTask {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
  priority: number;
  depends_on?: string[];
  subtasks?: PRDTask[];
}

export interface PRDMetadata {
  total_tasks: number;
  completed: number;
  in_progress: number;
  pending: number;
  blocked: number;
}

export interface PRD {
  name: string;
  description: string;
  tasks: PRDTask[];
  metadata: PRDMetadata;
}

export interface IssueFile {
  path: string;
  role: string;
}

export interface IssueDependencies {
  epic: number | null;
  depends_on: number[];
}

export interface IssueInput {
  title: string;
  body: string;
}

export class PRDGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PRDGenerationError';
  }
}

// --- Section extraction helpers ---

function extractSection(body: string, heading: string): string | null {
  // Find the heading line. Case-insensitive (#192) so authors can write
  // `## Acceptance Criteria`, `## acceptance criteria`, or
  // `## ACCEPTANCE CRITERIA` and still get the section parsed.
  const headingPattern = new RegExp(`^##\\s+${escapeRegex(heading)}\\s*$`, 'mi');
  const headingMatch = headingPattern.exec(body);
  if (!headingMatch) return null;

  // Get content after the heading until next ## heading or end of string
  const startIdx = headingMatch.index + headingMatch[0].length;
  const rest = body.slice(startIdx);
  const nextHeading = rest.match(/^##\s+/m);
  const content = nextHeading ? rest.slice(0, nextHeading.index) : rest;

  return content.trim() || null;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// --- Parsers ---

interface ParsedCriterion {
  text: string;
  checked: boolean;
  indent: number;
  children: string[];
}

export function parseAcceptanceCriteria(body: string): ParsedCriterion[] {
  const section = extractSection(body, 'Acceptance Criteria');
  if (!section) return [];

  const lines = section.split('\n');
  const result: ParsedCriterion[] = [];
  let currentItem: ParsedCriterion | null = null;

  for (const line of lines) {
    // Match checkbox lines: "- [ ] text" or "  - [ ] text"
    const checkboxMatch = line.match(/^(\s*)- \[([ xX])\]\s+(.+)/);
    if (checkboxMatch) {
      // Save previous item
      if (currentItem) result.push(currentItem);

      const indent = checkboxMatch[1].length;
      const checked = checkboxMatch[2].toLowerCase() === 'x';
      const text = checkboxMatch[3].trim();

      currentItem = { text, checked, indent, children: [] };
      continue;
    }

    // Non-checkbox lines become children of the current item
    if (currentItem && line.trim()) {
      // Indented list items (non-checkbox) are descriptions
      const indentedItem = line.match(/^\s+-\s+(.+)/);
      if (indentedItem) {
        currentItem.children.push(indentedItem[1].trim());
      } else {
        currentItem.children.push(line.trim());
      }
    }
  }

  // Push the last item
  if (currentItem) result.push(currentItem);

  // Strip trailing colons from items that have children
  for (const item of result) {
    if (item.children.length > 0) {
      item.text = item.text.replace(/:$/, '').trim();
    }
  }

  // Normalize nesting to max 2 levels (top-level = 0, subtask = any > 0).
  // Items with indent > first-seen indent level are flattened to level 1.
  // This prevents silent data loss from 3+ level nesting.
  const minIndent = result.filter((r) => r.indent > 0).reduce((min, r) => Math.min(min, r.indent), Infinity);
  for (const item of result) {
    if (item.indent > 0) {
      item.indent = minIndent; // Normalize all sub-items to same level
    }
  }

  return result;
}

/**
 * Reject paths that would let downstream tooling escape the repo root
 * if it ever uses these as filesystem inputs (#193). Issue bodies are
 * untrusted markdown, so unsafe shapes are dropped with a warning
 * rather than passed through.
 *
 * Trims first so leading whitespace can't bypass the `/` check.
 * Rejects:
 *   - empty / whitespace-only
 *   - absolute POSIX paths (`/etc/passwd`)
 *   - home-relative paths (`~/.ssh/id_rsa`) — shells expand these
 *   - any segment equal to `..` (POSIX or Windows separator)
 *   - URL-encoded `..` (`%2e%2e`, case-insensitive) anywhere in the path
 */
function isSafeFilePath(path: string): boolean {
  const trimmed = path.trim();
  if (trimmed === '') return false;
  if (trimmed.startsWith('/')) return false;
  if (trimmed.startsWith('~')) return false;
  if (/%2e%2e/i.test(trimmed)) return false;
  // Split on both POSIX and Windows separators so `src\..\..\etc` is
  // caught even though we don't target Windows — defense in depth.
  const segments = trimmed.split(/[/\\]/);
  if (segments.includes('..')) return false;
  return true;
}

export function parseFiles(body: string): IssueFile[] {
  const section = extractSection(body, 'Files');
  if (!section) return [];

  const result: IssueFile[] = [];
  const lines = section.split('\n');

  for (const line of lines) {
    // Match: - `path` — description  or  - `path` - description  or  - `path`: description  or  - `path`
    const match = line.match(/^-\s+`([^`]+)`(?:\s*[—\-:]\s*(.+))?/);
    if (match) {
      const path = match[1];
      if (!isSafeFilePath(path)) {
        console.warn(`agentbox: rejected unsafe file path "${path}" from issue body`);
        continue;
      }
      result.push({
        path,
        role: match[2]?.trim() ?? '',
      });
    }
  }

  return result;
}

export function parseDependencies(body: string): IssueDependencies {
  const section = extractSection(body, 'Dependencies');
  if (!section) return { epic: null, depends_on: [] };

  let epic: number | null = null;
  const dependsSet = new Set<number>();

  // Extract "Part of #NNN"
  const epicMatch = section.match(/[Pp]art of #(\d+)/);
  if (epicMatch) {
    epic = parseInt(epicMatch[1], 10);
  }

  // Extract "Depends on #NNN, #MMM" — but not the epic number
  const dependsMatch = section.match(/[Dd]epends on\s+([^.]+)/);
  if (dependsMatch) {
    const refs = dependsMatch[1].matchAll(/#(\d+)/g);
    for (const ref of refs) {
      const num = parseInt(ref[1], 10);
      if (num !== epic) {
        dependsSet.add(num);
      }
    }
  }

  return { epic, depends_on: [...dependsSet] };
}

export function parseSummary(body: string): string {
  const section = extractSection(body, 'Summary');
  if (!section) {
    // No Summary section — use the full body, trimmed
    return body.trim();
  }
  return section.trim();
}

// --- Generator ---

export function generatePRD(input: IssueInput): PRD {
  if (!input.title || !input.title.trim()) {
    throw new PRDGenerationError('Issue title is empty');
  }
  if (!input.body || !input.body.trim()) {
    throw new PRDGenerationError('Issue body is empty');
  }

  const description = parseSummary(input.body);
  const criteria = parseAcceptanceCriteria(input.body);
  const files = parseFiles(input.body);

  // Build file context string for task descriptions
  const fileContext =
    files.length > 0
      ? '\n\nRelevant files:\n' +
        files.map((f) => `- \`${f.path}\`${f.role ? ` — ${f.role}` : ''}`).join('\n')
      : '';

  let tasks: PRDTask[];

  if (criteria.length === 0) {
    // Fallback: single-task PRD
    tasks = [
      {
        id: 'task-1',
        title: input.title,
        description: input.body.trim(),
        status: 'pending',
        priority: 1,
      },
    ];
  } else {
    tasks = buildTasksFromCriteria(criteria, fileContext);
  }

  const metadata = computeMetadata(tasks);

  return {
    name: input.title,
    description,
    tasks,
    metadata,
  };
}

function buildTasksFromCriteria(
  criteria: ParsedCriterion[],
  fileContext: string,
): PRDTask[] {
  const tasks: PRDTask[] = [];
  let taskCounter = 0;
  let lastTopLevelId: string | null = null;

  // Group criteria by indent level — top-level (indent 0) become tasks,
  // indented items become subtasks of the preceding top-level task
  let i = 0;
  while (i < criteria.length) {
    const item = criteria[i];

    if (item.indent === 0) {
      taskCounter++;
      const taskId = `task-${taskCounter}`;

      // Collect subtasks (items with indent > 0 following this one)
      const subtasks: PRDTask[] = [];
      let j = i + 1;
      let subtaskCounter = 0;
      while (j < criteria.length && criteria[j].indent > 0) {
        subtaskCounter++;
        const sub = criteria[j];
        subtasks.push({
          id: `${taskId}-${subtaskCounter}`,
          title: cleanTitle(sub.text),
          description: buildDescription(sub, fileContext),
          status: sub.checked ? 'completed' : 'pending',
          priority: subtaskCounter,
        });
        j++;
      }

      const task: PRDTask = {
        id: taskId,
        title: cleanTitle(item.text),
        description: buildDescription(item, fileContext),
        status: item.checked ? 'completed' : 'pending',
        priority: taskCounter,
      };

      // Add sequential dependency on previous top-level task
      if (lastTopLevelId) {
        task.depends_on = [lastTopLevelId];
      }

      if (subtasks.length > 0) {
        task.subtasks = subtasks;
      }

      tasks.push(task);
      lastTopLevelId = taskId;
      i = j;
    } else {
      // Orphan indented item (no preceding top-level) — treat as top-level
      taskCounter++;
      const taskId = `task-${taskCounter}`;
      const task: PRDTask = {
        id: taskId,
        title: cleanTitle(item.text),
        description: buildDescription(item, fileContext),
        status: item.checked ? 'completed' : 'pending',
        priority: taskCounter,
      };
      if (lastTopLevelId) {
        task.depends_on = [lastTopLevelId];
      }
      tasks.push(task);
      lastTopLevelId = taskId;
      i++;
    }
  }

  return tasks;
}

function cleanTitle(text: string): string {
  // Strip trailing colon (used when item has sub-list descriptions)
  return text.replace(/:$/, '').trim();
}

function buildDescription(item: ParsedCriterion, fileContext: string): string {
  let desc = item.text;

  // Append children as sub-items if present
  if (item.children.length > 0) {
    desc = cleanTitle(desc) + ':\n' + item.children.map((c) => `  - ${c}`).join('\n');
  }

  return desc + fileContext;
}

export function computeMetadata(tasks: PRDTask[]): PRDMetadata {
  let total = 0;
  let completed = 0;
  let inProgress = 0;
  let pending = 0;
  let blocked = 0;

  function count(taskList: PRDTask[]): void {
    for (const t of taskList) {
      total++;
      switch (t.status) {
        case 'completed':
          completed++;
          break;
        case 'in_progress':
          inProgress++;
          break;
        case 'blocked':
          blocked++;
          break;
        default:
          pending++;
      }
      if (t.subtasks) count(t.subtasks);
    }
  }

  count(tasks);

  return {
    total_tasks: total,
    completed,
    in_progress: inProgress,
    pending,
    blocked,
  };
}

// --- Validator ---

const VALID_STATUSES = new Set(['pending', 'in_progress', 'completed', 'blocked']);

export function validatePRD(prd: PRD): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!prd.tasks || prd.tasks.length === 0) {
    errors.push('PRD must have at least one task');
    return { valid: false, errors };
  }

  // Collect all task IDs (including subtasks)
  const allIds = new Set<string>();
  const duplicates = new Set<string>();

  function collectIds(tasks: PRDTask[]): void {
    for (const t of tasks) {
      if (allIds.has(t.id)) {
        duplicates.add(t.id);
      }
      allIds.add(t.id);
      if (t.subtasks) collectIds(t.subtasks);
    }
  }
  collectIds(prd.tasks);

  for (const dup of duplicates) {
    errors.push(`duplicate task id: ${dup}`);
  }

  // Validate each task
  function validateTasks(tasks: PRDTask[]): void {
    for (const t of tasks) {
      if (!t.id) errors.push('task missing id');
      if (!t.title) errors.push(`task ${t.id || '?'} missing title`);
      if (!VALID_STATUSES.has(t.status)) {
        errors.push(`task ${t.id} has invalid status: ${t.status}`);
      }
      if (t.depends_on) {
        for (const dep of t.depends_on) {
          if (!allIds.has(dep)) {
            errors.push(`task ${t.id} depends on non-existent task: ${dep}`);
          }
        }
      }
      if (t.subtasks) validateTasks(t.subtasks);
    }
  }
  validateTasks(prd.tasks);

  // Check for structural issues: parent depending on own subtask
  function checkParentSubtaskDeps(tasks: PRDTask[]): void {
    for (const t of tasks) {
      if (t.subtasks && t.depends_on) {
        const subtaskIds = new Set(t.subtasks.map((s) => s.id));
        for (const dep of t.depends_on) {
          if (subtaskIds.has(dep)) {
            errors.push(
              `task ${t.id} depends on its own subtask ${dep}`,
            );
          }
        }
      }
      if (t.subtasks) checkParentSubtaskDeps(t.subtasks);
    }
  }
  checkParentSubtaskDeps(prd.tasks);

  // Check for circular dependencies (all tasks including subtasks)
  const graph = new Map<string, string[]>();
  function buildGraph(tasks: PRDTask[]): void {
    for (const t of tasks) {
      graph.set(t.id, t.depends_on ?? []);
      if (t.subtasks) buildGraph(t.subtasks);
    }
  }
  buildGraph(prd.tasks);

  // DFS cycle detection
  const visited = new Set<string>();
  const inStack = new Set<string>();

  function hasCycle(id: string): boolean {
    if (inStack.has(id)) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    inStack.add(id);
    for (const dep of graph.get(id) ?? []) {
      if (hasCycle(dep)) return true;
    }
    inStack.delete(id);
    return false;
  }

  for (const id of graph.keys()) {
    if (hasCycle(id)) {
      errors.push(`circular dependency detected involving task: ${id}`);
      break;
    }
  }

  return { valid: errors.length === 0, errors };
}

# Development Guide

## Quick Reference

```bash
npm run setup           # Interactive setup wizard
npm run dev             # Hot reload development server
npm test                # Run tests (Vitest)
npm run test:watch      # Watch mode
npm run test:coverage   # Coverage report
npm run test:smoke      # Smoke tests
npm run test:e2e        # End-to-end tests
npm run typecheck       # TypeScript type checking
npm run lint            # ESLint
npm run lint:fix        # ESLint with auto-fix
npm run build           # Production build
npm run deploy:check    # Deployment validation
```

## Testing

- **Framework:** Vitest with `describe/it/expect`
- **Core tests:** `tests/` directory, mirroring `src/` structure
- **Plugin tests:** Colocated alongside plugins (`plugins.example/*.test.ts`, `plugins.local/*.test.ts`)
- **Plugin infrastructure tests:** `tests/plugins/` (loader, types, plugin-app)
- **Security tests are critical** -- see `tests/utils/shell.test.ts`
- **100% of tests must pass** -- no skipped, pending, or failing tests allowed
- No coverage thresholds enforced -- focus on critical path coverage, not percentages

Run `npm test` before committing.

## CI/CD

### CI Pipeline (`.github/workflows/ci.yml`)

Runs on push to `main` and PRs:
1. Lint
2. Type check
3. Build
4. Test
5. Security audit

### Parent Submodule Update (`.github/workflows/update-parent-submodule.yml`)

This repo is a git submodule of `swamp-dev/ansible`. When code merges to `main`, a workflow automatically:

1. Checks out the parent repo
2. Updates the submodule pointer to the new commit
3. Creates a PR in the parent repo

**Required secret:** `PARENT_REPO_TOKEN` -- a GitHub PAT with `repo` scope for `swamp-dev/ansible`. Add it in Settings > Secrets and variables > Actions.

The workflow skips runs triggered by `github-actions[bot]` to prevent loops.

## AgentBox Integration

[AgentBox](https://github.com/swamp-dev/agentbox) runs AI agents in isolated Docker containers for implementing features via PRD-driven ralph loops. The binary is at `/root/agentbox/agentbox`.

### Prerequisites

Before running agentbox on a project directory:

1. **Install dependencies first** -- agentbox containers have restricted network access:
   ```bash
   cd /path/to/project-or-worktree
   npm install
   ```

2. **Fix permissions** -- containers run as uid 1000 (`agent` user):
   ```bash
   chmod -R a+w /path/to/project-or-worktree/
   ```

3. **Clean up stale Docker resources** from failed runs:
   ```bash
   docker rm -f $(docker ps -aq --filter "name=agentbox") 2>/dev/null
   docker network rm $(docker network ls --filter "name=agentbox" -q) 2>/dev/null
   ```

### Agent Selection

| Agent | Auth Method | Best For |
|-------|------------|----------|
| `claude-cli` | Host OAuth credentials (~/.claude/) | Default -- no API key needed |
| `claude` | `ANTHROPIC_API_KEY` env var | When API key is available |
| `amp` | Amp CLI auth | Amp users |
| `aider` | Aider CLI auth | Aider users |

### Running Ralph Loops (PRD-Driven)

```bash
agentbox ralph --agent claude-cli --project /path/to/worktree --prd prd.json --max-iterations 10 -v
```

**Ralph behavior:**
- Each iteration: spawn container -> agent works on next pending task -> quality checks -> auto-commit -> update prd.json
- Exits on first iteration failure (does not auto-retry)
- Files persist on the host mount even if iteration fails
- `progress.txt` tracks task start/completion/failure

### Running Single Tasks

```bash
agentbox run --agent claude-cli --project /path/to/worktree --prompt "Implement feature X"
```

### PRD Format

```json
{
  "name": "feature-name",
  "description": "What this PRD implements",
  "tasks": [
    {
      "id": "task-1",
      "title": "Short title",
      "description": "Detailed instructions for the agent",
      "status": "pending",
      "priority": 1
    },
    {
      "id": "task-2",
      "title": "Depends on task-1",
      "status": "pending",
      "priority": 2,
      "depends_on": ["task-1"]
    }
  ]
}
```

Task status values: `pending`, `in_progress`, `completed`, `blocked`

### Gitignore Warning

`plugins.local/` is in `.gitignore`. Ralph's auto-commit will NOT include gitignored files. Before running ralph on plugin development:

```bash
# Temporarily remove the gitignore entry
sed -i '/^plugins\.local\//d' .gitignore

# After ralph completes, restore it
echo 'plugins.local/' >> .gitignore
```

### AgentBox Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| "container exited with code 1" | Root-owned dirs | `chmod -R a+w /path/to/project/` |
| npm install takes forever | Restricted network | Pre-install deps on host |
| "container name already in use" | Stale container | `docker rm -f $(docker ps -aq --filter "name=agentbox")` |
| "network already exists" | Stale network | `docker network rm $(docker network ls --filter "name=agentbox" -q)` |
| Ralph exits after 1 failure | By design | Fix the issue, clean up, restart ralph |

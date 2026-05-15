# Plan: Extended Debugging, General-Purpose Prompt, and Agentbox Integration

## Context

The slack-server-monitor bot currently serves as a read-only home server monitoring tool with Claude AI integration. We need to evolve it in three directions:

1. **Deeper debugging capabilities** for Docker and file investigation
2. **General-purpose assistant identity** instead of being server-admin-only
3. **GitHub ticket creation** with smart planning, formatted for agentbox (a Docker-sandboxed AI coding agent that works from PRD-formatted tasks)

The user is preparing for integration with agentbox (`/root/agentbox/`), which consumes GitHub issues as work items. Claude should be able to investigate problems thoroughly, then create well-structured tickets that agentbox can pick up and execute autonomously.

---

## Phase 1: Foundations

### 1.1 Raise Default Timeout

**File:** `src/config/schema.ts`

Change `cliTimeoutMs` default from `300000` (5 min) to `1_200_000` (20 min). Max stays at 1 hour.

### 1.2 Shell Security: Add `gh` CLI and `docker compose`

**File:** `src/utils/shell.ts`

- Add `['gh', '/usr/bin/gh']` to `ALLOWED_COMMANDS`
- Add `compose` and `stats` to `ALLOWED_DOCKER_SUBCOMMANDS`
- Add `ALLOWED_GH_SUBCOMMANDS`: `issue`, `pr`, `repo`
- Add `ALLOWED_GH_ISSUE_SUBCOMMANDS`: `create`, `list`, `view`
- Add `ALLOWED_GH_PR_SUBCOMMANDS`: `list`, `view`
- Add `ALLOWED_GH_REPO_SUBCOMMANDS`: `view`
- Add `ALLOWED_DOCKER_COMPOSE_SUBCOMMANDS`: `ps`, `config`, `ls`, `images`, `logs`, `top`
- Add `validateGhCommand()` function (same pattern as `validateDockerCommand`)
- Add `validateDockerComposeCommand()` function

### 1.3 Config: GitHub Settings

**File:** `src/config/schema.ts`

Add to the `claude` config section:
- `githubRepo` — default repo in `owner/repo` format
- `githubDefaultLabels` — labels auto-applied to created issues

---

## Phase 2: New Tools

### 2.1 GitHub Tools (new file: `src/services/tools/github-tools.ts`)

- **`create_github_issue`** — create issues with agentbox-compatible format
- **`list_github_issues`** — search existing issues (prevent duplicates)
- **`view_github_issue`** — read issue details

### 2.2 Enhanced Server Debugging Tools (`src/services/tools/server-tools.ts`)

- **`search_container_logs`** — docker logs with in-process grep filtering
- **`get_docker_images`** — list images with size/age info

### 2.3 Enhanced File Reading (`src/services/tools/file-tools.ts`)

Add `start_line`, `end_line`, `search_pattern` params to `read_file`.

### 2.4 Register New Tools (`src/services/tools/index.ts`)

---

## Phase 3: System Prompt Rewrite (`src/config/prompts.ts`)

- General-purpose assistant identity (not server-admin-only)
- Planning/epic guidance for large feature requests
- Agentbox-compatible issue template format
- Conversational ticket creation flow (ask questions, propose breakdown, confirm before creating)

---

## Phase 4: Tests

- Shell security tests for `gh` and `docker compose`
- GitHub tools unit tests
- Enhanced server/file tool tests

---

## Agentbox Issue Format

Each sub-ticket follows this structure for agentbox compatibility:

```markdown
## Summary
One-line description.

## Context
Current behavior, relevant code paths, investigation findings.

## Acceptance Criteria
- [ ] Specific, testable criteria

## Files
- `path/to/file.ts` — role

## Dependencies
Part of #<epic>. Depends on #<ticket> (if any).
```

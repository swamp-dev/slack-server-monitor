# AgentBox Integration Epic — Ticket Plan

## Vision

A closed-loop system where conversations in Slack produce GitHub issues, a scheduler picks them up and hands them to AgentBox for sandboxed execution, and results flow back to the original Slack thread.

```
User in Slack → /ask "we need X"
       ↓
Claude investigates, proposes breakdown
       ↓
User approves → GitHub issues created (labeled agentbox-ready)
       ↓
Scheduler polls for agentbox-ready issues
       ↓
Picks one → sets up environment → invokes agentbox run/ralph
       ↓
AgentBox works in Docker sandbox → produces branch/diff
       ↓
Result saved → link posted to original Slack thread
       ↓
User reviews → merges or iterates
```

## Three Pillars

### Pillar 1: Smart Ticket Creation
Claude creates well-structured issues through conversation, knowing when to make one ticket, several, or an epic. It also knows to search for existing issues to avoid duplicates or to add context to open ones.

### Pillar 2: Automated Pickup
A scheduled job polls GitHub for `agentbox-ready` issues, prepares the execution environment (repo clone, context files, CLAUDE.md), and invokes `agentbox run` or `agentbox ralph` with the issue content as the prompt.

### Pillar 3: Result Delivery
AgentBox output (branch, diff, PR) is captured, stored, and a link posted back to the Slack thread where the work was originally requested.

---

## Existing Infrastructure

| Component | Status | Location |
|-----------|--------|----------|
| AgentBox binary | Installed | `/root/agentbox/agentbox` |
| GitHub CLI (`gh`) | Whitelisted in shell.ts | `/usr/bin/gh` |
| GitHub tools (create/list/view issues) | Built | `src/services/tools/github-tools.ts` |
| Plugin system | Mature | `src/plugins/` |
| Plugin database (SQLite, scoped) | Built | `src/services/plugin-database.ts` |
| Plugin SSE (real-time push) | Built | `src/web/sse.ts` |
| Plugin notifications | Built | `src/services/notification-store.ts` |
| Plugin web routes | Built | `src/web/plugin-router.ts` |
| Scheduling pattern (setInterval) | Established | `src/services/db-backup.ts` |
| Event bus | Built | `src/services/event-bus.ts` |
| System prompt with issue creation guidance | Built | `src/config/prompts.ts` |

---

## Ticket Breakdown

### Ticket 1: Plugin skeleton and database schema

**Summary:** Create the `agentbox` plugin with init/destroy lifecycle, database tables, and slash command stub.

**Why first:** Everything else builds on this. The database tracks the full lifecycle: which Slack thread created which issue, which agentbox run picked it up, what the result was.

**Scope:**
- `plugins.local/agentbox.ts` with `init()`, `destroy()`, empty `registerCommands()`
- Database schema:
  - `plugin_agentbox_runs` — tracks each agentbox execution (issue_number, repo, status, branch, pr_url, started_at, finished_at, output_path, error)
  - `plugin_agentbox_issue_links` — maps GitHub issue → Slack thread (issue_number, repo, thread_ts, channel_id, created_by, created_at)
- `/agentbox status` command stub (returns "no runs yet")
- Plugin config via env vars: `AGENTBOX_BINARY_PATH`, `AGENTBOX_WORK_DIR`, `AGENTBOX_DEFAULT_REPO`

**Acceptance Criteria:**
- [ ] Plugin loads without errors
- [ ] Database tables created on init
- [ ] `/agentbox status` responds in Slack
- [ ] Unit tests for schema creation

---

### Ticket 2: Enhanced ticket creation — issue-thread linking

**Summary:** When Claude creates a GitHub issue via the `create_github_issue` tool, automatically record which Slack thread triggered it so results can be posted back later.

**Why:** This is the glue that connects Pillar 1 (creation) to Pillar 3 (delivery). Without this link, we can't post results back.

**Scope:**
- Hook into the existing `create_github_issue` tool's execution to capture the Slack context (thread_ts, channel_id, user_id)
- Store the mapping in `plugin_agentbox_issue_links`
- When an issue is created, add a comment or label (`agentbox-ready`) if the user confirms the issue should be picked up by agentbox
- New Claude tool: `agentbox:mark_for_automation` — adds the `agentbox-ready` label to an existing issue

**Challenge:** The existing `create_github_issue` tool doesn't know about Slack context (thread_ts, channel_id). Options:
- A. Wrap the tool at the plugin level with a post-hook that records the link
- B. Add an `agentbox:create_issue` tool that delegates to `create_github_issue` and records the link
- C. Use the conversation store to look up the thread_ts for the current conversation

Option C is cleanest — the conversation processor already has thread_ts and channel_id. The plugin can query the conversation store after issue creation.

**Acceptance Criteria:**
- [ ] Every issue created during a conversation gets linked to the Slack thread
- [ ] `agentbox:mark_for_automation` tool adds label and records in DB
- [ ] Links queryable from the plugin database
- [ ] Unit tests for link storage/retrieval

---

### Ticket 3: Smart ticket intelligence — search, dedup, append

**Summary:** Teach Claude to search existing issues before creating new ones, and to add context to open issues instead of duplicating.

**Why:** Without this, the system will create duplicate tickets for related problems. The intelligence here is what separates a useful assistant from a ticket factory.

**Scope:**
- New Claude tool: `agentbox:search_related_issues` — searches issues by keyword, label, and state with structured output indicating relevance
- Update system prompt with decision framework:
  - If exact duplicate exists → comment on existing issue instead
  - If related issue exists → reference it as dependency or add as subtask
  - If issue is part of a larger pattern → suggest creating an epic
  - If truly new → create standalone or multi-ticket breakdown
- New Claude tool: `agentbox:add_to_issue` — adds a comment to an existing issue with investigation findings, proposed subtasks, or additional context
- Prompt guidance for scope assessment:
  - Single file change → one ticket
  - Multi-file, single concern → one ticket with file list
  - Multiple concerns → multiple tickets
  - Cross-cutting or >5 tickets → epic with sub-tickets

**Acceptance Criteria:**
- [ ] Claude searches for related issues before creating new ones
- [ ] Claude can append context to existing issues
- [ ] System prompt includes decision framework
- [ ] Unit tests for search and comment tools

---

### Ticket 4: Environment preparation service

**Summary:** Build the service that prepares a working directory for agentbox: clones the repo, copies context files, generates a PRD from the GitHub issue, and writes an `agentbox.yaml` config.

**Why:** AgentBox works in isolated Docker containers. It needs a prepared project directory with the repo, context, and a clear task definition. This service bridges the gap between "GitHub issue" and "agentbox-ready workspace."

**Scope:**
- New service: `plugins.local/agentbox/environment.ts`
- `prepareEnvironment(issue, repo, workDir)`:
  1. Create work directory: `{AGENTBOX_WORK_DIR}/{repo}/{issue_number}/`
  2. Clone repo (shallow, specific branch or main): `git clone --depth=1`
  3. Copy relevant CLAUDE.md and `.claude/context/` into the workspace
  4. Generate `prd.json` from issue body:
     - Parse acceptance criteria as tasks
     - Include file list from issue
     - Set dependencies
  5. Write `agentbox.yaml` with agent config, network settings
  6. Return workspace path
- `cleanupEnvironment(workDir)` — remove after completion (configurable retention)
- PRD generation: parse the structured issue format (Summary, Context, Acceptance Criteria, Files, Dependencies) into agentbox's PRD JSON format

**Acceptance Criteria:**
- [ ] Clones repo into isolated work directory
- [ ] Generates valid prd.json from issue body
- [ ] Writes agentbox.yaml with correct config
- [ ] Copies context files (CLAUDE.md, .claude/context/)
- [ ] Cleanup removes work directory
- [ ] Unit tests with mock filesystem and git

---

### Ticket 5: AgentBox executor service

**Summary:** Build the service that invokes `agentbox run` or `agentbox ralph` as a subprocess and captures output, status, and results.

**Why:** This is the core execution engine. It wraps the agentbox CLI with proper timeout handling, output capture, status tracking, and error recovery.

**Scope:**
- New service: `plugins.local/agentbox/executor.ts`
- `executeRun(workDir, options)`:
  - Spawns `agentbox run` or `agentbox ralph` via `child_process.spawn`
  - Streams stdout/stderr to a log file in the work directory
  - Tracks status in `plugin_agentbox_runs` table (pending → running → success/failed)
  - Respects timeout (configurable, default 30 minutes)
  - On completion: captures branch name, diff stat, any PR URL from output
  - On failure: captures error, marks run as failed
- Status polling: `getRunStatus(runId)` returns current state + log tail
- Concurrency: Only one agentbox run at a time (mutex/queue). Home server has limited resources.
- Shell security: Add `agentbox` to ALLOWED_COMMANDS in `shell.ts` with restricted subcommands (`run`, `ralph`, `status`)

**Acceptance Criteria:**
- [ ] Can invoke `agentbox run` with prompt and project directory
- [ ] Can invoke `agentbox ralph` with PRD file
- [ ] Output streamed to log file and available via status query
- [ ] Run tracked in database with status transitions
- [ ] Timeout kills the process gracefully
- [ ] Only one run at a time (queue subsequent)
- [ ] Shell security: agentbox in allowlist with subcommand validation
- [ ] Unit tests with mock child_process

---

### Ticket 6: Issue picker scheduler

**Summary:** Build the scheduled job that polls GitHub for `agentbox-ready` issues, picks the highest-priority one, and triggers the environment + executor pipeline.

**Why:** This closes the loop between ticket creation and execution. Without it, someone would have to manually trigger agentbox for each issue.

**Scope:**
- New service: `plugins.local/agentbox/scheduler.ts`
- `startScheduler(config)` — returns cleanup function (follows db-backup pattern)
- Poll interval: configurable (default: 15 minutes)
- Issue selection logic:
  1. `gh issue list --label agentbox-ready --state open --json number,title,labels,createdAt`
  2. Skip issues already in `plugin_agentbox_runs` with status running/success
  3. Priority: issues with `priority: high` label first, then oldest first
  4. Pick one issue per cycle (single concurrency)
- Pipeline per issue:
  1. Update issue: remove `agentbox-ready`, add `agentbox-running` label
  2. Record run in database with status `pending`
  3. Call `prepareEnvironment()` (Ticket 4)
  4. Call `executeRun()` (Ticket 5)
  5. On completion: call result delivery (Ticket 7)
  6. On failure: add `agentbox-failed` label, comment on issue with error
- Config env vars:
  - `AGENTBOX_SCHEDULER_ENABLED` (default: false)
  - `AGENTBOX_SCHEDULER_INTERVAL_MINUTES` (default: 15)
  - `AGENTBOX_MAX_CONCURRENT_RUNS` (default: 1)

**Acceptance Criteria:**
- [ ] Polls for agentbox-ready issues on configurable interval
- [ ] Skips already-processed issues
- [ ] Respects priority ordering
- [ ] Updates issue labels through lifecycle (ready → running → done/failed)
- [ ] Graceful shutdown stops polling and waits for active run
- [ ] Unit tests with mocked gh CLI output

---

### Ticket 7: Result delivery — save output and notify Slack

**Summary:** When an agentbox run completes, save the results (diff, branch, PR) and post a summary with link back to the Slack thread where the issue was created.

**Why:** This is what makes the loop visible to the user. Without delivery, they'd have to go check GitHub manually.

**Scope:**
- New service: `plugins.local/agentbox/delivery.ts`
- `deliverResults(run, issueLink)`:
  1. Read the agentbox output from the work directory (branch name, diff stat, log tail)
  2. If agentbox created a branch: push it and create a PR via `gh pr create`
  3. Save result summary to `plugin_agentbox_runs` (pr_url, branch, diff_stat)
  4. Comment on the GitHub issue with result summary + PR link
  5. Update issue labels: remove `agentbox-running`, add `agentbox-complete`
  6. Look up the Slack thread from `plugin_agentbox_issue_links`
  7. Post a message to that thread with:
     - Status (success/failure)
     - PR link (if created)
     - Link to web UI page with full output
     - Brief diff summary
  8. Send notification via `ctx.notify()` for the web UI bell
- Web route: `GET /p/agentbox/runs/:id` — full output page with logs, diff, PR link
- SSE: broadcast `run-complete` event for real-time dashboard updates

**Acceptance Criteria:**
- [ ] Creates PR from agentbox branch
- [ ] Comments on GitHub issue with results
- [ ] Posts summary to original Slack thread
- [ ] Web page shows full run output
- [ ] Notification appears in web UI
- [ ] Handles failure case (error posted to thread)
- [ ] Unit tests for result formatting and delivery

---

### Ticket 8: Slash commands and dashboard

**Summary:** Build the `/agentbox` Slack command and web dashboard for monitoring runs.

**Why:** Users need visibility into what's running, what's queued, and what completed.

**Scope:**
- Slash commands:
  - `/agentbox status` — show current/recent runs (running, queued, last 5 completed)
  - `/agentbox runs` — list all runs with pagination
  - `/agentbox run <issue#>` — manually trigger a specific issue (bypass scheduler)
  - `/agentbox queue` — show pending agentbox-ready issues
  - `/agentbox cancel` — cancel the currently running agentbox job
  - `/agentbox help` — plugin help
- Claude tools:
  - `agentbox:get_run_status` — check status of a specific or current run
  - `agentbox:list_runs` — list recent runs with status
  - `agentbox:trigger_run` — manually trigger an issue for agentbox
- Web dashboard (`/p/agentbox/`):
  - Current run with live log streaming (SSE)
  - Run history table (status, issue, duration, PR link)
  - Queue view (agentbox-ready issues)
- Dashboard widget:
  - Shows current run status or "idle"
  - Links to full dashboard

**Acceptance Criteria:**
- [ ] All slash commands work and return formatted Slack blocks
- [ ] Claude tools registered and functional
- [ ] Web dashboard renders with run history
- [ ] Live log streaming for active runs via SSE
- [ ] Dashboard widget shows status on home page
- [ ] Unit tests for command handlers and tool execution

---

### Ticket 9: Context packaging for isolated environments

**Summary:** Build the intelligence that packages project context (CLAUDE.md, examples, patterns, dependencies) so agentbox can work effectively in its isolated Docker container.

**Why:** AgentBox runs in an isolated container. It can't browse the codebase the way Claude can in Slack. The context package must be self-sufficient — everything the agent needs to understand the codebase, the conventions, and the specific task.

**Scope:**
- `plugins.local/agentbox/context.ts`
- `packageContext(repo, issue)`:
  1. Include the repo's CLAUDE.md and `.claude/context/` files
  2. Parse the issue's "Files" section → read those files and include them as reference
  3. If issue references other issues (dependencies), fetch their content
  4. Include relevant test files as examples of patterns
  5. Include the repo's package.json/go.mod for dependency context
  6. Write a `CONTEXT.md` file in the workspace summarizing everything
  7. Generate an enhanced prompt that includes:
     - The issue body (task definition)
     - Relevant file contents (current state)
     - Test patterns from the repo
     - Dependency/build commands
- Size management: truncate context if it exceeds a threshold (configurable, default 100KB)
- Repository-specific hooks: allow repos to define `.agentbox/context-hook.sh` that generates additional context

**Acceptance Criteria:**
- [ ] Packages CLAUDE.md and context files
- [ ] Includes referenced source files from issue
- [ ] Includes related test patterns
- [ ] Generates CONTEXT.md summary
- [ ] Respects size limits
- [ ] Unit tests for context assembly

---

## Dependency Graph

```
Ticket 1 (skeleton)
   ↓
Ticket 2 (issue-thread linking)  ←  Ticket 3 (smart dedup)
   ↓
Ticket 4 (environment prep)  ←  Ticket 9 (context packaging)
   ↓
Ticket 5 (executor)
   ↓
Ticket 6 (scheduler)  →  Ticket 7 (result delivery)
   ↓
Ticket 8 (commands + dashboard)
```

**Critical path:** 1 → 2 → 4 → 5 → 6 → 7
**Parallel work:** Ticket 3 can start after Ticket 1. Ticket 9 can start after Ticket 4. Ticket 8 can start after Ticket 5.

---

## Implementation Order (Recommended)

| Phase | Tickets | Goal |
|-------|---------|------|
| **Phase A** | 1, 2 | Plugin exists, issues linked to Slack threads |
| **Phase B** | 4, 5 | Can manually trigger agentbox on a prepared issue |
| **Phase C** | 6, 7 | Automated loop: poll → execute → deliver |
| **Phase D** | 3, 8, 9 | Polish: smart creation, dashboard, rich context |

Phase A + B gets you a working manual flow. Phase C automates it. Phase D makes it smart.

---

## Configuration Summary

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENTBOX_ENABLED` | false | Master switch for plugin |
| `AGENTBOX_BINARY_PATH` | /root/agentbox/agentbox | Path to agentbox binary |
| `AGENTBOX_WORK_DIR` | ./data/agentbox-runs | Base directory for run workspaces |
| `AGENTBOX_DEFAULT_REPO` | — | Default repo for issue operations |
| `AGENTBOX_DEFAULT_AGENT` | claude | Agent to use (claude, aider, amp) |
| `AGENTBOX_SCHEDULER_ENABLED` | false | Enable automatic issue pickup |
| `AGENTBOX_SCHEDULER_INTERVAL_MINUTES` | 15 | Poll interval |
| `AGENTBOX_MAX_RUN_MINUTES` | 30 | Timeout per run |
| `AGENTBOX_ALLOW_NETWORK` | false | Allow network in containers |
| `AGENTBOX_MAX_CONCURRENT_RUNS` | 1 | Max parallel runs |

---

## Security Considerations

- AgentBox runs in Docker with network isolation by default — safe
- Shell allowlist: add `agentbox` with restricted subcommands (run, ralph, status — no interactive)
- Only authorized Slack users can trigger manual runs
- Scheduler only picks up issues with explicit `agentbox-ready` label
- Work directories cleaned up after configurable retention
- PR creation requires gh CLI auth (already configured)
- No secrets passed to agentbox containers unless explicitly configured

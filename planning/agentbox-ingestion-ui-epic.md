# AgentBox Ingestion Layer + Workflows UI — Epic

> **GitHub Issues:** #236 (T10), #237 (T4), #238 (T5), #239 (T6), #240 (T7), #241 (T11), #242 (T12), #243 (T13), #244 (T14)

## Vision

Extend the agentbox plugin with an **ingestion layer** that automatically picks up GitHub issues, converts them to PRDs, executes them via agentbox, and delivers results — plus a **Workflows web UI** that provides full visibility into the pipeline: queue, active runs with live progress, run history, and interactive controls.

```
GitHub issue (agentbox-ready label)
       |
Scheduler polls every N minutes
       |
Validate format --> reject if missing sections
       |
Clone repo, generate PRD, prepare workspace
       |
Spawn agentbox sprint/ralph
       |
Poll status every 10s --> SSE to web UI
       |
On completion: create PR, comment on issue, notify Slack thread
       |
Workflows UI: dashboard, queue, run detail with journal timeline
```

## Relationship to Original Epic

This epic **refines and extends** `planning/agentbox-integration-epic.md`:
- **T1, T2** — Complete (plugin skeleton, issue-thread linking)
- **T4-T7** — Refined here with agentbox MCP/CLI knowledge
- **T8** — Replaced by T11-T13 (much richer UI + controls)
- **T3, T9** — Deferred (smart dedup, context packaging)
- **T10-T14** — New tickets added by this epic

## Design Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Scheduler location | Inside plugin (`agentbox/scheduler.ts`) | Follows db-backup and hue SSE polling patterns |
| Status polling | `agentbox` CLI (`status`, `journal`) | Public API; avoids coupling to agentbox's internal SQLite |
| SSE events | `run-status`, `run-started`, `run-complete`, `queue-update`, `journal-entry` | Matches hue plugin pattern |
| Cancel mechanism | Kill child process (SIGTERM then SIGKILL) | Agentbox has no cancel API |
| Pause/resume | Schema ready (`paused_at`), UI placeholder, implement later | Future ticket T14 |
| Web UI nav name | "Workflows" | Broader than "AgentBox", room for future automation types |

## Architecture

```
plugins.local/
  agentbox.ts                    # Main plugin (extend with scheduler + web routes)
  agentbox/
    types.ts                     # Extend with new fields
    linking.ts                   # Existing (no changes)
    scheduler.ts                 # NEW: GitHub poll + orchestration + status poller
    executor.ts                  # NEW: Spawn agentbox, track process
    environment.ts               # NEW: Clone repo, generate PRD, prepare workspace
    prd-generator.ts             # NEW: Copy from plugins.example, adapt imports
    delivery.ts                  # NEW: PR creation, GitHub comments, Slack notify
    web.ts                       # NEW: Routes, SSE polling, page rendering
    web-templates.ts             # NEW: HTML templates for dashboard/detail pages
    web-scripts.ts               # NEW: Client-side JS for SSE + interactivity
```

---

## Tickets

### T10: Schema evolution for ingestion layer (#236)

**Summary:** Add columns to `plugin_agentbox_runs` to support the ingestion pipeline: session tracking, progress metrics, and cancel/pause state.

**Scope:**
- Add columns via idempotent `ALTER TABLE ADD COLUMN` in `init()` (check via `PRAGMA table_info`):
  - `session_id TEXT` — agentbox session ID from sprint_start/ralph_start
  - `progress_pct INTEGER DEFAULT 0` — 0-100 from agentbox_status
  - `tasks_total INTEGER` — task count from agentbox
  - `tasks_completed INTEGER` — completed count
  - `prd_path TEXT` — path to generated PRD file
  - `cancelled_by TEXT` — who cancelled (user ID or 'system')
  - `paused_at TEXT` — timestamp (future: pause/resume support)
- Update `AgentboxRun` interface in `types.ts`
- Add row mapper helpers for the new fields

**Files:**
- `plugins.local/agentbox.ts` — schema migration in `init()`
- `plugins.local/agentbox/types.ts` — extended interfaces

**Acceptance Criteria:**
- [ ] New columns added idempotently (safe to run multiple times)
- [ ] `AgentboxRun` type includes all new fields
- [ ] Existing data preserved (no destructive migration)
- [ ] Unit tests for schema migration idempotency

**Dependencies:** T1 (done)

---

### T4: Environment preparation service (#237)

**Summary:** Build the service that prepares a working directory for agentbox: clones the repo, copies context files, generates a PRD from the GitHub issue, and writes config.

**Scope:**
- `plugins.local/agentbox/environment.ts`:
  - `prepareEnvironment(issue, repo, workDir)` → `EnvironmentResult`
    1. Create work directory: `{AGENTBOX_WORK_DIR}/{repo}/{issue_number}_{timestamp}/`
    2. Clone repo: `git clone --depth=1 https://github.com/{repo}.git project`
    3. Copy CLAUDE.md and `.claude/context/` if present
    4. Generate `prd.json` from issue body via prd-generator
    5. Validate PRD (no circular deps, all deps exist)
    6. Write `prd.json` to workspace
    7. Return `{ workDir, projectDir, prdPath }`
  - `cleanupEnvironment(workDir)` — remove workspace (configurable retention)
- `plugins.local/agentbox/prd-generator.ts`:
  - Copy from `plugins.example/agentbox/prd-generator.ts`
  - Adapt imports for plugins.local context
  - No functional changes needed — it's already production-ready

**Files:**
- `plugins.local/agentbox/environment.ts` (new)
- `plugins.local/agentbox/prd-generator.ts` (new, copied from plugins.example)
- `plugins.local/agentbox/environment.test.ts` (new)

**Acceptance Criteria:**
- [ ] Clones repo into isolated work directory
- [ ] Generates valid `prd.json` from structured issue markdown
- [ ] Copies context files (CLAUDE.md, .claude/context/)
- [ ] Cleanup removes work directory
- [ ] Handles missing sections gracefully (Summary required, others optional)
- [ ] Unit tests with mock filesystem and git

**Dependencies:** T10

---

### T5: AgentBox executor service (#238)

**Summary:** Build the service that invokes `agentbox ralph` or `agentbox sprint` as a subprocess and captures output, status, and results.

**Scope:**
- `plugins.local/agentbox/executor.ts`:
  - `executeRun(opts: ExecutorOptions, db, runId)` → `Promise<ExecutorResult>`
    - Spawn via `child_process.spawn` (not shell — use execFile pattern)
    - Stream stdout/stderr to `{workDir}/run.log`
    - Update DB: `session_id`, `status=running`, `started_at`
    - Set timeout watchdog (`AGENTBOX_MAX_RUN_MINUTES`, default 30)
    - On exit: parse exit code, extract branch name from output
    - On timeout: SIGTERM then SIGKILL after 5s
  - Module-level `activeProcess: ChildProcess | null` for cancellation access
  - `getActiveProcess()` — returns current process (for scheduler's cancel)
  - Only one run at a time (check before spawning)
- Add `agentbox` to shell allowlist with restricted subcommands: `ralph`, `sprint`, `status`, `journal`, `task-list`

**Files:**
- `plugins.local/agentbox/executor.ts` (new)
- `plugins.local/agentbox/executor.test.ts` (new)
- `src/utils/shell.ts` — add `agentbox` to ALLOWED_COMMANDS

**Acceptance Criteria:**
- [ ] Can invoke `agentbox ralph` with PRD file and project directory
- [ ] Can invoke `agentbox sprint` with project directory
- [ ] Output streamed to log file
- [ ] Run tracked in DB with status transitions (pending -> running -> success/failed)
- [ ] Timeout kills process gracefully (SIGTERM then SIGKILL)
- [ ] Only one run at a time (rejects if already running)
- [ ] Shell security: `agentbox` in allowlist with subcommand validation
- [ ] Unit tests with mock child_process

**Dependencies:** T4

---

### T6: Issue picker scheduler (#239)

**Summary:** Build the scheduled job that polls GitHub for `agentbox-ready` issues, orchestrates the environment → executor → delivery pipeline, and provides real-time status updates via SSE.

**Scope:**
- `plugins.local/agentbox/scheduler.ts`:
  - **Issue picker loop** (`startIssuePicker(ctx, config) → cleanup fn`):
    1. `gh issue list --label agentbox-ready --state open --json number,title,body,labels,createdAt --repo {repo}`
    2. Filter out issues already in `plugin_agentbox_runs` with status `running` or `success`
    3. Priority: `priority:high` label first, then oldest-first
    4. If a run is active, skip
    5. Pick top issue → trigger pipeline:
       - `gh issue edit {n} --remove-label agentbox-ready --add-label agentbox-running`
       - Insert run record (status=pending)
       - Validate issue format (require Summary + Acceptance Criteria sections)
       - `prepareEnvironment()` → `executeRun()` → `deliverResults()`
    6. Broadcast `queue-update` SSE event
  - **Status poller loop** (`startStatusPoller(ctx) → cleanup fn`):
    - Every 10s while `activeRunId` is set:
    1. Run `agentbox status <session_id>` CLI → parse JSON
    2. Update DB: `progress_pct`, `tasks_total`, `tasks_completed`
    3. Run `agentbox journal <project_dir>` → diff against last known entries
    4. Broadcast `run-status` SSE event
    5. Broadcast `journal-entry` for new entries
    6. If status is terminal → stop polling, trigger delivery
  - **Cancellation** (`cancelRun(runId, cancelledBy) → boolean`):
    1. Get active child process from executor
    2. `process.kill(pid, 'SIGTERM')`, SIGKILL after 5s
    3. Update DB: `status=cancelled`, `cancelled_by`, `finished_at`
    4. `gh issue edit --remove-label agentbox-running --add-label agentbox-failed`
    5. Comment on issue: "Run cancelled by {user}"
    6. Broadcast `run-complete` SSE event
  - Wire `startIssuePicker` and `startStatusPoller` into plugin `init()` / `destroy()`
  - Config: `AGENTBOX_SCHEDULER_ENABLED` (default false), `AGENTBOX_SCHEDULER_INTERVAL_MINUTES` (default 15)

**Files:**
- `plugins.local/agentbox/scheduler.ts` (new)
- `plugins.local/agentbox/scheduler.test.ts` (new)

**Acceptance Criteria:**
- [ ] Polls for `agentbox-ready` issues on configurable interval
- [ ] Skips already-processed issues
- [ ] Respects priority ordering
- [ ] Updates issue labels through lifecycle (ready -> running -> done/failed)
- [ ] Status poller broadcasts progress via SSE every 10s
- [ ] Journal entries detected and broadcast incrementally
- [ ] `cancelRun()` kills process, updates labels, comments on issue
- [ ] Graceful shutdown stops polling and waits for active run
- [ ] Unit tests with mocked `gh` CLI output

**Dependencies:** T4, T5

---

### T7: Result delivery (#240)

**Summary:** When an agentbox run completes, create a PR, comment on the GitHub issue, and post a summary to the original Slack thread.

**Scope:**
- `plugins.local/agentbox/delivery.ts`:
  - `deliverResults(run, ctx, config)`:
    1. If run succeeded and has a branch:
       - `gh pr create --repo {repo} --head {branch} --title "..." --body "..."`
       - Update run record with `pr_url`
    2. Comment on GitHub issue with result summary (status, PR link, duration, task completion)
    3. Update labels: remove `agentbox-running`, add `agentbox-done` or `agentbox-failed`
    4. Look up Slack thread from `plugin_agentbox_issue_links`
    5. If linked thread: post message via Slack Web API with status, PR link, web UI link
    6. `ctx.notify()` for web UI notification bell
    7. `ctx.sse.broadcast('run-complete', { ... })`
  - Challenge: plugin needs Slack `app.client` reference. Store from `registerCommands(app)` callback in module-level state.

**Files:**
- `plugins.local/agentbox/delivery.ts` (new)
- `plugins.local/agentbox/delivery.test.ts` (new)

**Acceptance Criteria:**
- [ ] Creates PR from agentbox branch via `gh pr create`
- [ ] Comments on GitHub issue with results
- [ ] Posts summary to original Slack thread (if linked)
- [ ] Notification appears in web UI bell
- [ ] Handles failure case (error posted to thread and issue)
- [ ] Unit tests for result formatting and delivery

**Dependencies:** T5, T6

---

### T11: Web UI — Workflows dashboard (#241)

**Summary:** Build the agentbox plugin web pages at `/p/agentbox/` with a "Workflows" nav entry, providing visibility into queue, active runs, and history.

**Scope:**
- `plugins.local/agentbox/web.ts` — route registration and handlers
- `plugins.local/agentbox/web-templates.ts` — HTML template functions
- `plugins.local/agentbox/web-scripts.ts` — client-side JavaScript
- Register via `registerWebRoutes` with nav entry `{ label: 'Workflows', icon: 'cpu' }`
- Follow `plugins.example/hue/web.ts` patterns exactly

**Routes:**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/p/agentbox/` | Dashboard home |
| GET | `/p/agentbox/queue` | Full queue view |
| GET | `/p/agentbox/runs` | Run history with pagination |
| GET | `/p/agentbox/runs/:id` | Run detail page |

**Dashboard (`/p/agentbox/`):**
- Status banner: "Running: repo#123 (45%)" or "Idle — last run 2h ago"
- Stats row: 3 cards — Active Runs (0/1), Queue Depth, Success Rate (30d)
- Active run card (if running): progress bar, task count, elapsed time
- Recent completions table: Issue, Repo, Status, Duration, PR, Completed At
- Queue preview: top 5 `agentbox-ready` issues with GitHub links

**Run detail (`/p/agentbox/runs/:id`):**
- Header with issue link and status badge
- Progress section: progress bar, tasks completed/total
- Journal timeline: dev diary entries with confidence/difficulty/momentum ratings
- Task list table: id, title, status from PRD
- Links: GitHub issue, PR (if created), log file

**Dashboard widget** for main home page: status summary + link

**SSE events consumed by client JS:**

| Event | UI Update |
|-------|-----------|
| `run-status` | Progress bar, task counts, elapsed time |
| `run-started` | Status banner, queue count |
| `run-complete` | Toast notification, refresh tables |
| `queue-update` | Queue count badge |
| `journal-entry` | Append to journal timeline |

**Files:**
- `plugins.local/agentbox/web.ts` (new)
- `plugins.local/agentbox/web-templates.ts` (new)
- `plugins.local/agentbox/web-scripts.ts` (new)

**Acceptance Criteria:**
- [ ] Dashboard renders with stats cards and recent runs
- [ ] Queue page shows `agentbox-ready` issues with GitHub links
- [ ] Run history page with pagination
- [ ] Run detail shows progress, journal, task list
- [ ] Both Dracula and Light themes work correctly
- [ ] Dashboard widget appears on main home page
- [ ] `npm run screenshots` captures all pages
- [ ] Unit tests for template rendering

**Dependencies:** T10

---

### T12: Cancel and interactive controls (#242)

**Summary:** Add cancel functionality and real-time interactivity to the Workflows UI.

**Scope:**
- `POST /p/agentbox/runs/:id/cancel` — cancel running workflow
  - Calls `scheduler.cancelRun(runId, req.session.userId)`
  - Returns redirect to run detail page
- Cancel button on dashboard active run card and run detail page
- Client-side JavaScript enhancements:
  - SSE connection to `/p/agentbox/stream` with auto-reconnect
  - Live progress bar updates on `run-status` events
  - Journal entry append on `journal-entry` events
  - Toast notification on `run-complete` events
  - Confirmation dialog before cancel
- **Pause/resume placeholder:** button visible but disabled, tooltip "Coming soon", `paused_at` column in schema ready for T14

**Files:**
- `plugins.local/agentbox/web.ts` (extend with POST route)
- `plugins.local/agentbox/web-scripts.ts` (extend with SSE + interactivity)
- `plugins.local/agentbox/web-templates.ts` (extend with cancel button)

**Acceptance Criteria:**
- [ ] Cancel button visible on running workflows
- [ ] Cancel requires confirmation dialog
- [ ] SSE connection updates UI in real-time
- [ ] Progress bar animates on status updates
- [ ] Journal entries appear without page refresh
- [ ] Toast notification on run completion
- [ ] Pause button visible but disabled with "Coming soon" tooltip
- [ ] Unit tests for cancel route

**Dependencies:** T11, T6

---

### T13: Extended slash commands and Claude tools (#243)

**Summary:** Add Slack slash commands and Claude tools for interacting with the ingestion pipeline from chat.

**Scope:**
- Slash commands (in `plugins.local/agentbox.ts` `registerCommands`):
  - `/agentbox queue` — show pending `agentbox-ready` issues
  - `/agentbox run <issue#>` — manually trigger a specific issue (bypass scheduler)
  - `/agentbox cancel` — cancel the active run
  - `/agentbox runs` — recent run history (last 10)
- Claude tools (in plugin `tools` array):
  - `get_run_status` — check status of current or specific run
  - `trigger_run` — manually trigger an issue for agentbox execution
  - `cancel_run` — cancel the active run

**Files:**
- `plugins.local/agentbox.ts` (extend commands and tools)

**Acceptance Criteria:**
- [ ] All slash commands work and return formatted Slack blocks
- [ ] Claude tools registered and functional
- [ ] Manual trigger validates issue exists and has correct format
- [ ] Cancel reports success/failure
- [ ] Unit tests for command handlers and tool execution

**Dependencies:** T6, T11

---

### T14: Pause and resume workflows (#244) (FUTURE)

**Summary:** Add the ability to pause a running agentbox workflow and resume it later.

**Scope:**
- Pause: checkpoint agentbox state, SIGSTOP the process (or save session)
- Resume: restore checkpoint, continue execution
- UI: pause/resume buttons replace cancel when supported
- DB: use `paused_at` column (already added in T10)
- Agentbox support: may require `agentbox sprint --resume` capability

**Note:** This ticket is opened for tracking but not scheduled for implementation. Depends on agentbox adding resume/checkpoint support.

**Dependencies:** T12

---

### T3: Smart ticket intelligence — search, dedup, append (DEFERRED)

**Summary:** Teach Claude to search existing issues before creating new ones, and to add context to open issues instead of duplicating.

**Scope:** (from original epic, unchanged)
- `agentbox:search_related_issues` tool
- `agentbox:add_to_issue` tool
- System prompt decision framework for when to create vs. append

**Dependencies:** T1 (done)

---

### T9: Context packaging for isolated environments (DEFERRED)

**Summary:** Build rich context assembly for agentbox Docker containers.

**Scope:** (from original epic, unchanged)
- Parse issue "Files" section, include referenced files
- Include test patterns, dependency files
- Generate CONTEXT.md summary
- Size limits and truncation

**Dependencies:** T4

---

## Dependency Graph

```
T10 (schema) ─────> T4 (environment) ──> T5 (executor) ──> T6 (scheduler) ──> T7 (delivery)
     |                                          |
     +──> T11 (web dashboard) ────────> T12 (cancel/interactive) ──> T14 (pause/resume) [FUTURE]
                                                |
                                       T13 (commands/tools)

Independent:
  T3 (smart dedup) — can start anytime after T1
  T9 (context packaging) — can start after T4
```

## Implementation Phases

| Phase | Tickets | Outcome |
|-------|---------|---------|
| **B** | T10, T4, T5 | Environment + executor pipeline (manual trigger) |
| **C** | T6, T7 | Automated loop: poll -> execute -> deliver |
| **D** | T11, T12, T13 | Workflows UI, cancel, slash commands |
| **Future** | T3, T9, T14 | Smart dedup, rich context, pause/resume |

**Parallelization:** T10 + T11 can start in parallel with T4/T5 (schema and static UI are independent of backend services).

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENTBOX_ENABLED` | false | Master switch |
| `AGENTBOX_BINARY_PATH` | /root/agentbox/agentbox | Path to binary |
| `AGENTBOX_WORK_DIR` | ./data/agentbox-runs | Workspace base directory |
| `AGENTBOX_DEFAULT_REPO` | — | Default repo for operations |
| `AGENTBOX_DEFAULT_AGENT` | claude | Agent to use (claude, aider, amp) |
| `AGENTBOX_SCHEDULER_ENABLED` | false | Enable automatic pickup |
| `AGENTBOX_SCHEDULER_INTERVAL_MINUTES` | 15 | Poll interval |
| `AGENTBOX_MAX_RUN_MINUTES` | 30 | Timeout per run |
| `AGENTBOX_ALLOW_NETWORK` | false | Network in containers |
| `AGENTBOX_MAX_CONCURRENT_RUNS` | 1 | Max parallel runs |

## SSE Event Reference

| Event | Payload | Trigger |
|-------|---------|---------|
| `run-status` | `{ runId, status, progress_pct, tasks: {total, completed}, sessionId }` | Status poll (10s) |
| `run-started` | `{ runId, issueNumber, repo }` | New run begins |
| `run-complete` | `{ runId, status, prUrl, duration }` | Run finishes |
| `queue-update` | `{ queuedIssues: [{number, title, repo}] }` | Scheduler poll |
| `journal-entry` | `{ runId, entry: {kind, summary, confidence, difficulty, momentum} }` | New journal entry |

## Label State Machine

```
                          ┌─────────────────────┐
                          |                     |
[new issue] ──> agentbox-ready ──> agentbox-running ──> agentbox-done
                                        |
                                        +──> agentbox-failed
                                        |
                                        +──> (cancelled → agentbox-failed)
```

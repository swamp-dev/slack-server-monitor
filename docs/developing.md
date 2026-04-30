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
npm run screenshots     # Capture web UI screenshots
npm run deploy:check    # Deployment validation
npm run ci              # Run every CI check locally
npm run ci:fast         # Inner-loop subset (skips e2e + audit)
```

The repo pins Node 20 in `.nvmrc` -- run `nvm use` in the repo root to match CI.

## Local CI Parity

`npm run ci` runs the full set of checks `.github/workflows/ci.yml` runs:

```
lint -> typecheck -> build -> test:coverage -> test:smoke -> test:e2e -> npm audit
```

Run it before opening any PR. If every step exits 0 locally and hosted CI still fails, that's an infrastructure issue, not your diff.

`npm run ci:fast` skips `test:e2e` and the audit -- useful for tight inner-loop work where you want a fast confidence check between commits.

If `test:e2e` fails with a missing browser error, run `npx playwright install chromium` once -- the local `ci` script doesn't auto-install browsers (CI does, with `--with-deps`).

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

## Screenshot Server

A standalone screenshot server captures the web UI in all theme/viewport combinations using Playwright and seed data. No Slack connection, database, or external services needed -- everything runs locally with mock data.

### Quick Start

```bash
npm run screenshots                                    # Capture all pages (core + plugins)
npx tsx scripts/take-screenshots.ts dashboard          # Capture one page by name
npx tsx scripts/take-screenshots.ts hue-dashboard      # Capture a plugin page
```

### How It Works

```
npm run screenshots
  |
  +--> scripts/screenshot-server.ts     Express app on port 18970
  |      |- Renders core pages (dashboard, sessions, conversation, etc.)
  |      |- Discovers plugins from plugins.example/
  |      |- Calls screenshotSetup() to seed mock data
  |      |- Mounts plugin routes at /p/{name}/
  |      `- Serves API stubs (/api/notifications, /api/health/server, etc.)
  |
  +--> scripts/screenshot-fixtures.ts   Typed seed data for core pages
  |
  +--> scripts/take-screenshots.ts      Playwright browser automation
         |- Launches headless Chromium
         |- For each page x theme x viewport:
         |    Create fresh context -> set localStorage theme -> navigate -> capture PNG
         `- Saves to screenshots/
```

The server uses **in-memory SQLite** databases for plugins, so nothing touches disk. Each plugin gets an isolated `PluginContext` with a scoped `PluginDatabase`.

### UI Development Workflow

When modifying web templates (`src/web/templates/`):

1. Make your template changes
2. Run screenshots (target the page you changed):
   ```bash
   npx tsx scripts/take-screenshots.ts dashboard
   ```
3. View the PNGs in `screenshots/` to verify both themes and viewports
4. Iterate until it looks right

This is especially useful for:
- Verifying Dracula and light theme consistency
- Checking mobile layout doesn't break
- Reviewing empty/error/degraded states
- Catching CSS regressions after template refactors

### Pages and Variants

Each page has a default state plus variants that exercise edge cases (data states) and setup hooks that exercise interactive states (modals, dropdowns, toasts):

| Page | Data variants | Interactive setup hooks |
|------|---------------|--------------------------|
| Dashboard | `empty`, `degraded` | `notification-bell-open`, `command-palette`, `mobile-hamburger-open` (mobile only) |
| Sessions | `empty`, `search-no-results`, `search-results`, `search-results-many`, `favorites`, `archived`, `tagged` | `kb-overlay` (`?` keypress) |
| Conversation | `branched`, `long-with-code`, `truncated`, `tool-error` | `copy-toast` |
| Notifications | `empty`, `all-unread`, `many` | -- |
| Login / Register | `error`, `prefilled` (register) | -- |
| Admin users | `empty`, `with-flash`, `deactivated` | `admin-users-reset-pw-open` |
| Error pages | -- | `401`, `403`, `404`, `500` |

Data variants are triggered via query params (e.g., `?variant=empty`); the screenshot server renders different fixture data based on the variant. Interactive states use `setup` hooks on `PageDef` that run after navigation but before the screenshot — clicking a button, pressing a key, etc. A setup hook can restrict itself to specific viewports via the `viewports` field on `PageDef` (e.g. `mobile-hamburger-open` only runs at `mobile`).

If a setup hook fails (timing, layout drift), the harness logs a `[skip]` line and continues with the rest of the run rather than aborting — so a flaky hook still leaves a usable manifest.

### Themes and Viewports

Every page/variant combination is captured in:

| Theme | Viewport | Resolution |
|-------|----------|------------|
| `dracula` | `desktop` | 1280x720 |
| `dracula` | `tablet` | 768x1024 |
| `dracula` | `mobile` | 375x812 |
| `light` | `desktop` | 1280x720 |
| `light` | `tablet` | 768x1024 |
| `light` | `mobile` | 375x812 |

Theme is set via `localStorage('ssm-theme')` on each browser context, matching how the real UI works.

### Output

Screenshots are saved to `screenshots/` (gitignored):

```
screenshots/
  manifest.json                            # index of every PNG with metadata
  dashboard-dracula-desktop.png            # default state
  dashboard-degraded-light-mobile.png      # variant state
  hue-dashboard-dracula-desktop.png        # plugin page
```

Naming: `{page}-{variant?}-{theme}-{viewport}.png`

A current run produces ~318 PNGs (54 page combinations × themes × viewports, with some interactive states viewport-restricted). The harness writes `screenshots/manifest.json` listing every entry as `{ page, variant, theme, viewport, url, file, hasSetup }` so downstream tooling (visual analysis, perceptual diffing, regression checks) can walk the captured set without parsing filenames.

### Adding Plugin Screenshots

Plugins opt into the screenshot system by exporting `screenshotPages` and `screenshotSetup`:

```typescript
const myPlugin: Plugin = {
  name: 'my-plugin',
  // ...

  // Pages to capture (path relative to /p/my-plugin/)
  screenshotPages: [
    { name: 'dashboard', path: '/' },
    { name: 'details', path: '/details' },
  ],

  // Seed mock data before screenshots
  screenshotSetup: async (ctx) => {
    ctx.db.exec(`
      CREATE TABLE IF NOT EXISTS ${ctx.db.prefix}items (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL
      )
    `);
    ctx.db.prepare(`INSERT INTO ${ctx.db.prefix}items (name) VALUES (?)`).run('Sample');
  },
};
```

The screenshot server:
1. Creates an in-memory `PluginContext` for each plugin
2. Calls `screenshotSetup(ctx)` to populate mock data
3. Calls `init(ctx)` if present (for runtime state)
4. Registers web routes, then captures each `screenshotPages` entry

Plugin screenshots are named `{pluginName}-{pageName}-{theme}-{viewport}.png`.

**Fixture patterns from existing plugins:**

| Plugin | Strategy | File |
|--------|----------|------|
| **health** | Creates tables and inserts seed rows | `plugins.example/health/screenshot-fixtures.ts` |
| **lift** | Creates tables with 14 days of workout data | `plugins.example/lift/screenshot-fixtures.ts` |
| **hue** | Populates response cache (no DB) | `plugins.example/hue/screenshot-fixtures.ts` |

For complex plugins, extract fixtures into a separate file and import from `screenshotSetup`.

### Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `SCREENSHOT_PORT` | `18970` | Port for the mock server |

### Troubleshooting

| Problem | Fix |
|---------|-----|
| `Error: browserType.launch: Executable doesn't exist` | Run `npx playwright install chromium` |
| Screenshots look wrong | Check that `screenshotSetup` creates realistic seed data |
| Plugin pages missing | Verify plugin is in `plugins.example/` (not `plugins.local/`) and exports `screenshotPages` |
| Theme not applied | The server sets `localStorage('ssm-theme')` -- check your template reads from it |
| Setup hook timed out (`[skip] page theme/viewport: setup failed`) | Check the selector in the hook still matches the rendered DOM. The hook's wait timeout is 2s — bump it for slow assertions. Mobile-only elements (e.g. the hamburger menu) need `viewports: ['mobile']` on the `PageDef` |
| `copy-toast` hook always times out | The browser context grants `clipboard-read`/`clipboard-write`; if you change the context creation, preserve those permissions or `navigator.clipboard.writeText` won't resolve and the toast never fires |

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

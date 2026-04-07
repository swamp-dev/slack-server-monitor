# Epic: Web UI Screenshot Capture for Self-Review

## Context

GitHub Issue: #198 — "epic: automated web UI screenshots for documentation"

The web UI has a dashboard, conversation pages, notifications, login, and plugin pages — all server-rendered HTML with Dracula/light themes and responsive layouts. Currently there's no way for Claude to see what the UI looks like after making template changes. The primary use case is **Claude reviewing its own UI/UX during development** — take screenshots, view them via the multimodal Read tool, and iterate. Secondary benefit: keeping `docs/web-ui.md` current with screenshots.

Playwright is already a dev dependency. E2E tests exist with a mock server pattern. Templates are pure functions that accept typed data and return HTML strings — perfect for rendering with seed data.

## Plan

### Ticket 1: Seed Data Fixtures — `scripts/screenshot-fixtures.ts`

Typed mock data matching each render function's signature. Produces realistic, visually rich pages.

**Fixtures to create:**
- `seedStats: SessionStats` — 47 sessions, 5 active, 312 messages, 89 tool calls
- `seedRecent: SessionSummary[]` — 5 conversations with varied content, tags, timestamps
- `seedFavorites: SessionSummary[]` — 2 items; `seedFavCount = 8`
- `seedAllTags: TagInfo[]` — docker(12), nginx(8), ssl(3), monitoring(15), disk(6), backup(4)
- `seedQuickLinks: QuickLink[]` — 4 items (Grafana, Portainer, Pi-hole, Uptime Kuma)
- `seedHealth: ServerHealth` — uptime "12d 4h", load [0.42, 0.38, 0.31], 50% memory, 2 disk mounts
- `seedNotifications: Notification[]` — 5 items across types (info, warn, error), 2 unread
- `seedMessages: ConversationMessage[]` — 4-message multi-turn with markdown in assistant replies
- `seedToolCalls: ToolCallLog[]` — 3 calls (docker_ps, disk_usage, container_logs) with durations and output
- `seedConversationMeta` — matches `renderConversation` metadata parameter shape
- `seedPagination: PaginationInfo` — page 1 of 3, 47 total items
- `seedWidgets: DashboardWidget[]` — 1 sample widget

**Types imported from:** `src/types/index.ts`, `src/web/templates/*.ts`

~200 lines. No dependencies.

### Ticket 2: Standalone Screenshot Server — `scripts/screenshot-server.ts`

Minimal Express app that imports real templates + seed data. No auth middleware, no Slack connection.

**Routes:**
| Route | Template |
|-------|----------|
| `GET /` | `renderDashboard(seedStats, seedRecent, seedFavorites, seedFavCount, seedAllTags, 'admin', seedWidgets, 2, seedQuickLinks, seedHealth)` |
| `GET /c` | `renderSessionList(seedSessions, seedPagination, { allTags, currentUserId })` |
| `GET /c/:threadTs/:channelId` | `renderConversation(seedMessages, seedToolCalls, seedConversationMeta)` |
| `GET /notifications` | `renderNotificationPage(seedNotifications, 2)` |
| `GET /login` | `renderLogin()` |
| `GET /api/notifications` | JSON `{ notifications, unreadCount: 2 }` (for shell notification bell) |
| `GET /api/health/server` | JSON seed health (for dashboard auto-refresh) |
| `GET /api/links` | JSON `{ links: seedQuickLinks }` (for dashboard) |
| `GET /api/search` | JSON `{ results: [] }` (for command palette) |
| `*` | `render404()` |

Exports `startScreenshotServer()` / `stopScreenshotServer()` for programmatic use.

Port: `18970` (env `SCREENSHOT_PORT`).

~120 lines. Depends on Ticket 1.

### Ticket 3: Playwright Screenshot Harness — `scripts/take-screenshots.ts`

Orchestrates server startup, browser launch, and capture.

**Flow:**
1. Start screenshot server
2. Launch Playwright Chromium (headless)
3. For each page (`dashboard`, `sessions`, `conversation`, `notifications`, `login`):
   - For each theme (`dracula`, `light`):
     - Set theme via `localStorage.setItem('theme', theme)` + reload
     - For each viewport (`desktop: 1280x720`, `mobile: 375x812`):
       - Set viewport, wait for network idle
       - Save screenshot to `screenshots/{page}-{theme}-{viewport}.png`
4. Close browser, stop server
5. Print summary

**Output:** 5 pages x 2 themes x 2 viewports = **20 screenshots** in `screenshots/`

~130 lines. Depends on Ticket 2.

### Ticket 4: npm Script + .gitignore

- Add `"screenshots": "tsx scripts/take-screenshots.ts"` to `package.json` scripts
- Add `screenshots/` to `.gitignore`

2 lines. Depends on Ticket 3.

### Ticket 5: Documentation Updates

- `docs/web-ui.md`: Add "Screenshots" section with generation instructions
- `CLAUDE.md`: Add `npm run screenshots` to Development commands and a "UI Development Workflow" note explaining the screenshot-review-iterate loop

~30 lines of docs. Depends on Ticket 4.

## Key Files to Modify/Create

| Action | File |
|--------|------|
| **Create** | `scripts/screenshot-fixtures.ts` |
| **Create** | `scripts/screenshot-server.ts` |
| **Create** | `scripts/take-screenshots.ts` |
| **Edit** | `package.json` (add script) |
| **Edit** | `.gitignore` (add screenshots/) |
| **Edit** | `docs/web-ui.md` (add section) |
| **Edit** | `CLAUDE.md` (add commands) |

## Verification

1. **Ticket 1**: `npx tsx -e "import './scripts/screenshot-fixtures.ts'"` + `npm run typecheck`
2. **Ticket 2**: `npx tsx scripts/screenshot-server.ts` → visit http://localhost:18970 in browser, check all routes render
3. **Ticket 3**: `npx tsx scripts/take-screenshots.ts` → verify 20 PNGs in `screenshots/`
4. **Ticket 4**: `npm run screenshots` → same result
5. **Ticket 5**: Read updated docs
6. **End-to-end**: Make a trivial template change → `npm run screenshots` → read a screenshot with Claude's Read tool → verify the change is visible

## CI (Stretch Goal — Not in This PR)

A future ticket could add a CI step that regenerates screenshots on template changes and commits them, or validates they're not stale. Excluded from this PR to keep scope focused.

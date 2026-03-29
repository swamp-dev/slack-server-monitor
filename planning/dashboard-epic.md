# Epic: Home Server Dashboard

## Context

The web UI currently serves as a Claude conversation viewer. This epic transforms it into a full home server dashboard with server health monitoring, a notification center, quick links, and the infrastructure for plugins to extend the UI with their own web pages and dashboard widgets (enabling future Hue, Lifting, Health dashboards).

**Non-goals:**
- Actual plugin dashboard implementations (Hue/Lift/Health pages) -- follow-on tickets using the API from this epic
- User accounts (separate epic)
- Platform-agnostic messaging (separate epic)
- Real-time push notifications (polling is sufficient; can add SSE later)

**Key decisions:**
- D1 (template split) ships as its own PR before any feature work
- Plugin web pages: provide template helpers (D8) as optional utilities, but plugins can also render raw HTML for full control
- Notifications use polling (page load + periodic refresh), no SSE/WebSocket
- No example plugin web pages in this epic -- infrastructure only

## Status

> Last updated: 2026-03-29

| Ticket | Title | Issue | Status | Branch |
|--------|-------|-------|--------|--------|
| D1 | Split templates.ts | [#96](https://github.com/swamp-dev/slack-server-monitor/issues/96) | **In progress** | `refactor/96-split-templates` |
| D2 | Plugin web route registration API | [#97](https://github.com/swamp-dev/slack-server-monitor/issues/97) | Not started | — |
| D3 | Notification store and API | [#98](https://github.com/swamp-dev/slack-server-monitor/issues/98) | Not started | — |
| D4 | Dashboard widget system | [#99](https://github.com/swamp-dev/slack-server-monitor/issues/99) | Not started | — |
| D5 | Notification center UI | [#100](https://github.com/swamp-dev/slack-server-monitor/issues/100) | Not started | — |
| D6 | Quick links / bookmarks | [#101](https://github.com/swamp-dev/slack-server-monitor/issues/101) | Not started | — |
| D7 | Enhanced main dashboard | [#102](https://github.com/swamp-dev/slack-server-monitor/issues/102) | Not started | — |
| D8 | Plugin web page template helpers | [#103](https://github.com/swamp-dev/slack-server-monitor/issues/103) | Not started | — |

### Current progress

**D1 (Split templates.ts)** is in progress on `refactor/96-split-templates`. The monolithic `src/web/templates.ts` (2,716 lines) has been split into 12 files under `src/web/templates/` per the template split map below. Import updates to `server.ts`, `index.ts`, and tests are done. Needs: verify tests pass, lint, typecheck, then PR.

### Next steps

1. **Finish D1** — run tests, fix any issues, open PR
2. **Wave 2 (parallel):** D2 + D3 + D6 can start once D1 merges (no file conflicts between them)
3. **Wave 3 (parallel):** D4 + D5 + D8 after their respective dependencies
4. **D7 last** — integrates everything

## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Template split | `src/web/templates/` directory, one file per page/concern | templates.ts is 2,716 lines; every ticket touches it; split prevents conflicts |
| Plugin web routes | `registerWebRoutes?(router: PluginRouter)` on Plugin interface | Mirrors existing `registerCommands?(app: PluginApp)` pattern |
| Widget system | `getWidgets?(): DashboardWidget[]` on Plugin interface | Synchronous, returns pre-rendered HTML snippets for main dashboard |
| Notifications | Core `notifications` SQLite table + `PluginContext.notify()` | Cross-cutting concern, not plugin-scoped |
| Plugin data access | Same `PluginDatabase` in route handlers via closure | No new data pattern needed |
| Navigation | Dynamic "Apps" dropdown from plugin nav registrations | Collected during startup from loaded plugins |
| Quick links | Core `quick_links` SQLite table, per-user | Simple bookmarks with CRUD API |

## Template Split Map

Current `templates.ts` sections -> new files under `src/web/templates/`:

| New file | Content |
|----------|---------|
| `index.ts` | Barrel re-exports (preserves existing imports) |
| `utils.ts` | `escapeHtml`, `escapeMarkdown`, `formatMarkdown`, `formatTimestamp` |
| `icons.ts` | `ICON_PATHS`, `icon()` |
| `theme.ts` | `getThemeStyles()` |
| `styles.ts` | `getBaseStyles()`, `getAnimationStyles()` |
| `keyboard.ts` | `getKeyboardShortcutScript()`, `getKeyboardHelpOverlay()` |
| `shell.ts` | `wrapInShell()`, `ShellOptions` |
| `dashboard.ts` | `renderDashboard()`, dashboard-specific styles |
| `session-list.ts` | `renderSessionList()` |
| `conversation.ts` | `renderConversation()` |
| `export.ts` | `renderMarkdownExport()` |
| `errors.ts` | `render404()`, `render401()`, `renderLogin()`, `renderError()` |

## Ticket Breakdown

### D1: Split templates.ts into template modules
**Priority:** P0 (foundational) | **Branch:** `refactor/split-templates` | **Size:** Medium

Pure refactor. Move code sections into `src/web/templates/` directory per the map above. Barrel re-export preserves all existing imports. All existing tests must pass unchanged.

**Files:** Create `src/web/templates/*.ts`, delete `src/web/templates.ts`, update imports in `src/web/server.ts`
**Dependencies:** None (merge first)

---

### D2: Plugin web route registration API
**Priority:** P0 (foundational) | **Branch:** `feat/plugin-web-routes` | **Size:** Large

Core API enabling plugins to have web pages.

- `PluginRouter` interface in `src/plugins/types.ts` (constrained Express Router scoped to `/p/{pluginName}/`)
- `registerWebRoutes?(router: PluginRouter)` + `webNavEntry?: { label, icon? }` on Plugin interface
- Create `src/web/plugin-router.ts` implementing PluginRouter
- Mount under `/p/` with auth middleware in `src/web/server.ts`
- Dynamic nav entries from plugins rendered in shell template

**Key interface:**
```typescript
interface PluginRouter {
  readonly pluginName: string;
  get(path: string, handler: PluginRouteHandler): void;
  post(path: string, handler: PluginRouteHandler): void;
}
```

**Files:** New `src/web/plugin-router.ts`, `src/web/plugin-nav.ts`; modify `src/plugins/types.ts`, `src/plugins/loader.ts`, `src/web/server.ts`, `src/web/templates/shell.ts`
**Dependencies:** D1

---

### D3: Notification store and API
**Priority:** P1 | **Branch:** `feat/notification-store` | **Size:** Medium

Data layer for notifications. Usable by both core and plugins.

- `src/services/notification-store.ts` with SQLite `notifications` table (id, source, level, title, body, link, created_at, read_at)
- CRUD: `createNotification()`, `getUnread()`, `getRecent()`, `markRead()`, `markAllRead()`, `countUnread()`, `cleanup()`
- `PluginContext.notify(title, body, opts?)` method -- source auto-set to plugin name
- REST: `GET /api/notifications`, `POST /api/notifications/:id/read`, `POST /api/notifications/read-all`

**Files:** New `src/services/notification-store.ts`; modify `src/plugins/types.ts`, `src/plugins/loader.ts`, `src/web/server.ts`
**Dependencies:** D1

---

### D4: Dashboard widget system
**Priority:** P1 | **Branch:** `feat/dashboard-widgets` | **Size:** Medium

Plugins contribute summary cards to the main dashboard.

- `DashboardWidget` interface: `{ title, icon?, html, link?, priority?, size? }`
- `getWidgets?(): DashboardWidget[]` on Plugin interface
- `getPluginWidgets()` in loader collects from all plugins, catches errors per-plugin
- Dashboard renders widgets in an "Apps" grid section

**Files:** Modify `src/plugins/types.ts`, `src/plugins/loader.ts`, `src/web/templates/dashboard.ts`, `src/web/server.ts`
**Dependencies:** D1, D2

---

### D5: Notification center UI
**Priority:** P1 | **Branch:** `feat/notification-center-ui` | **Size:** Medium

Bell icon in nav with unread badge, dropdown with recent notifications, full `/notifications` page.

- New `src/web/templates/notifications.ts`
- Bell + badge in shell nav bar
- JavaScript: toggle dropdown, mark-read via fetch, "View all" link
- Unread count injected into all authenticated page renders

**Files:** New `src/web/templates/notifications.ts`; modify `src/web/templates/shell.ts`, `src/web/server.ts`
**Dependencies:** D1, D3

---

### D6: Quick links / bookmarks
**Priority:** P2 | **Branch:** `feat/quick-links` | **Size:** Small

Per-user bookmarks on the dashboard. Plugins can programmatically add default quick links during init (e.g., Hue plugin adds a link to its dashboard).

- `src/services/quick-links-store.ts` with SQLite `quick_links` table
- CRUD API: `GET/POST/DELETE /api/links`
- `PluginContext.addQuickLink?(title, url, icon?)` for plugins to suggest default links
- Dashboard section with add/remove UI

**Files:** New `src/services/quick-links-store.ts`; modify `src/web/templates/dashboard.ts`, `src/web/server.ts`
**Dependencies:** D1

---

### D7: Enhanced main dashboard
**Priority:** P2 | **Branch:** `feat/enhanced-dashboard` | **Size:** Medium

Integration ticket. Redesign dashboard layout into a cohesive grid:
1. Quick links bar (D6)
2. Server health cards (uptime, load, memory, disk) -- new `src/services/server-health.ts`
3. Stats cards (existing)
4. Plugin widgets (D4)
5. Notification summary + recent conversations (existing)

Auto-refresh health cards every 60s via fetch. `GET /api/health/server` endpoint.

**Files:** New `src/services/server-health.ts`; modify `src/web/templates/dashboard.ts`, `src/web/server.ts`
**Dependencies:** D1, D4, D5, D6

---

### D8: Plugin web page template helpers
**Priority:** P2 | **Branch:** `feat/plugin-template-helpers` | **Size:** Small

Shared template utilities so plugin authors can render themed pages without copy-paste.

- `src/web/plugin-helpers.ts`: `renderPluginPage()`, `pluginCard()`, `pluginTable()`, `pluginChart()`
- Re-exports `icon()`, `escapeHtml()`, `formatTimestamp()`
- CSS scoped per-plugin via class wrapper

**Files:** New `src/web/plugin-helpers.ts`; modify `src/plugins/index.ts`
**Dependencies:** D1, D2

## Dependency Graph & Merge Order

```
D1 (split templates) ─────────────────────────────────────────
     │
     ├──> D2 (plugin routes) ──> D4 (widgets) ──> D7 (enhanced dashboard)
     │         │                                       ^
     │         └──> D8 (template helpers)              |
     │                                                 |
     ├──> D3 (notification store) ──> D5 (notif UI) ──┘
     │                                                 |
     └──> D6 (quick links) ───────────────────────────>┘
```

**Merge waves:**
1. **D1** alone (everything depends on it)
2. **D2 + D3 + D6** in parallel (no file conflicts)
3. **D4 + D5 + D8** in parallel (no conflicts between them)
4. **D7** last (integrates everything)

## Conflict Analysis with Other Epics

- **User Accounts:** Adds `web_users` table and login changes. This epic adds `notifications` + `quick_links` tables and plugin routes. Only shared file is `server.ts` and `shell.ts` -- D1 split minimizes conflicts. Can work in parallel safely.
- **Platform-Agnostic:** Touches Slack commands/formatters/middleware. This epic touches web server and templates. Near-zero overlap.

## Verification

After each ticket:
- `npm test` -- all tests pass
- `npm run build` -- builds cleanly
- `npm run typecheck` -- no type errors
- `npm run lint` -- clean

After D7 (full integration):
- Start dev server, verify dashboard renders all sections
- Test with at least one plugin providing widgets + web routes
- Verify mobile responsiveness
- Test notification create/read/mark-read flow
- Test quick links CRUD
- Verify plugin pages get auth, theme, and nav bar

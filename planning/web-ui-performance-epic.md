# Web UI Performance Investigation & Optimization Plan

## Context

The Slack Server Monitor web UI exhibits noticeable slowness when switching between tabs, with the Hue plugin "Scenes" page and Conversations pages being the worst offenders. Investigation reveals multiple root causes: uncached Hue bridge API calls on every page load, expensive SQLite queries (especially `json_array_length` over full message blobs), 1,378 lines of inline CSS on every page, and several memory leak vectors from unbounded in-memory maps and uncleared intervals.

## Findings Summary

### Hue Scenes Page (Slowest)
- **`plugins.example/hue/web.ts:559-580`** -- `renderScenes()` makes 2 fresh HTTPS calls to the Hue bridge on every page load (scenes + rooms). No caching whatsoever.
- **`plugins.example/hue/client.ts:149-169`** -- `hueRequest()` has retry logic but zero response caching for GET requests.
- **`plugins.example/hue/web.ts:62-126`** -- SSE polling makes 6 API calls every 10 seconds. When a user then navigates to `/p/hue/scenes`, the same data is fetched again independently.
- Bridge requests have a 5s timeout (`client.ts:86`) -- if the bridge is slow, page load blocks for up to 5s.

### Dashboard Page (Second Slowest)
- **`src/web/server.ts:990-1014`** -- Dashboard route loads: `getSessionStats(24)` (5 separate SQL queries), recent sessions, favorites, all tags, plugin widgets, notifications, quick links, and server health -- all synchronously before rendering.
- **`src/services/conversation-store.ts:851-858`** -- `json_array_length(messages)` scans every non-archived conversation's full JSON blob to count messages. This gets slower as conversations accumulate.
- **`src/plugins/loader.ts:453-473`** -- `getPluginWidgets()` calls each plugin synchronously with no timeout. A slow plugin blocks the entire dashboard.

### Conversations Pages
- **`src/web/server.ts:509-569`** -- Conversation detail makes 4 sequential DB queries (conversation, tool calls, tags, branches) instead of batching.
- **`src/web/server.ts:237-252`** -- `attachTags()` is a batch query (good), but called on every list route.

### Cross-Cutting Issues
- **`src/web/templates/styles.ts`** -- 1,378 lines of CSS inlined in every page. Browser cannot cache it separately.
- **`src/web/templates/keyboard.ts`** -- `querySelectorAll()` called on every keypress with no debouncing.
- **`src/commands/ask.ts:28-59`** -- `claudeRateLimits` Map grows unboundedly per user (timestamps never purged, entries never removed).
- **`src/middleware/rate-limit.ts:30`** -- `bucketStore` Map accumulates entries for every user+command pair.

---

## Proposed Tickets

### Ticket 1: Add TTL Cache to Hue Bridge Client (HIGH -- biggest user-facing impact)

**Problem:** Every Hue page load makes fresh HTTPS requests to the bridge.

**Solution:** Add a simple in-memory TTL cache to `hueRequest()` for GET requests.
- Cache key: request path
- Default TTL: 30s for lights/rooms/scenes, 10s for sensors
- Invalidate on any PUT/POST/DELETE to the bridge
- SSE polling should populate the same cache, so page loads get instant hits

**Files:**
- `plugins.example/hue/client.ts` -- add cache layer
- `plugins.example/hue/web.ts` -- SSE polling writes to cache; `renderScenes()` reads from cache

### Ticket 2: Add `message_count` Column to Conversations Table (HIGH)

**Problem:** `json_array_length(messages)` on every conversation is expensive -- it forces SQLite to parse potentially large JSON blobs.

**Solution:** Add a denormalized `message_count INTEGER DEFAULT 0` column. Update it whenever messages are appended. Replace `SUM(json_array_length(messages))` in `getSessionStats()` with `SUM(message_count)`.

**Files:**
- `src/services/conversation-store.ts` -- migration, update on message append, update `getSessionStats()`

### Ticket 3: Cache Dashboard Stats (MEDIUM)

**Problem:** Dashboard makes 5+ DB queries and multiple service calls on every load.

**Solution:** Cache `getSessionStats()` result for 30-60 seconds (similar to server health cache pattern). Stats don't need real-time accuracy.

**Files:**
- `src/services/conversation-store.ts` -- add stats cache with TTL
- `src/web/server.ts` -- use cached stats

### Ticket 4: Extract CSS to Static Cacheable File (MEDIUM)

**Problem:** 1,378 lines of CSS embedded inline in every page response. Browser parses it fresh on every navigation.

**Solution:** Serve base styles as `/static/styles.css` with `Cache-Control: public, max-age=86400`. Only inline page-specific styles.

**Files:**
- `src/web/templates/styles.ts` -- export as string for static route
- `src/web/templates/shell.ts` -- `<link>` tag instead of `<style>` for base CSS
- `src/web/server.ts` -- add `/static/styles.css` route with cache headers

### Ticket 5: Fix Unbounded Rate Limiter Maps (MEDIUM -- memory leak)

**Problem:** `claudeRateLimits` in `ask.ts` and `bucketStore` in `rate-limit.ts` grow without bound.

**Solution:**
- `ask.ts`: Delete user entry from map when all timestamps have expired
- `rate-limit.ts`: Ensure cleanup runs and actually removes stale entries; call `stopRateLimitCleanup()` in app shutdown

**Files:**
- `src/commands/ask.ts` -- cleanup logic in `checkAndRecordClaudeRequest()`
- `src/middleware/rate-limit.ts` -- verify cleanup effectiveness
- `src/app.ts` -- ensure cleanup called on shutdown

### Ticket 6: Add Timeout to Plugin Widget Loading (LOW)

**Problem:** `getPluginWidgets()` calls plugins synchronously -- a slow plugin blocks the dashboard.

**Solution:** Make `getPluginWidgets()` async with a per-plugin timeout (e.g., 200ms). Return skeleton/fallback HTML for plugins that timeout.

**Files:**
- `src/plugins/loader.ts` -- async with `Promise.race` timeout
- `src/web/server.ts` -- await widget loading

### Ticket 7: Debounce Keyboard Event Handlers (LOW)

**Problem:** `querySelectorAll()` runs on every keypress.

**Solution:** Cache DOM query results and/or debounce the handler.

**Files:**
- `src/web/templates/keyboard.ts`

---

## Verification

After implementing each ticket:
1. Run `npm test` -- all tests pass
2. Run `npm run typecheck` -- no errors
3. Manual testing: load dashboard, navigate between tabs, check Hue scenes page load time
4. For memory leaks: run app for extended period, monitor `process.memoryUsage()` via `/api/health/server`

## Implementation Order

1. Ticket 1 (Hue cache) -- biggest perceived improvement
2. Ticket 2 (message_count) -- biggest DB performance improvement
3. Ticket 3 (dashboard stats cache) -- compounds with ticket 2
4. Ticket 5 (memory leaks) -- prevents long-term degradation
5. Ticket 4 (CSS extraction) -- improves every page load
6. Ticket 6 (plugin timeout) -- defensive
7. Ticket 7 (keyboard debounce) -- minor polish

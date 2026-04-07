# UI/UX Epic — Make It Delightful

## UX Audit: Current State

### What Works Well
- **Dracula theme** is gorgeous and on-brand for a server tool
- **Keyboard shortcuts** are comprehensive and well-documented
- **Real-time SSE** keeps conversations alive during Claude responses
- **Tool call collapsibles** with duration/success stats are genuinely useful
- **Mobile hamburger menu** exists and works at 640px
- **Toast notifications** have nice slide-in animation
- **Favorite star pop animation** is a good micro-interaction

### What Feels Flat
- **Full page reloads everywhere** — clicking a conversation, switching tabs, searching — every action is a blank screen flash. Feels like 2010.
- **No loading states** — between click and render, nothing happens. No skeletons, no spinners, no indication that anything is happening.
- **Streaming is undercooked** — when Claude is working, you see tool call status cards but no actual text streaming. The response appears all at once after "done". The most magical moment (watching Claude think) is hidden.
- **Dashboard is a wall of text** — stat cards, health, links, conversations, tags — all the same visual weight. Nothing guides the eye.
- **Conversation list is a flat stack** — every card looks identical. No visual distinction between active/completed, short/long, recent/old conversations.
- **Empty states are afterthoughts** — generic messages with no personality or guidance.
- **Login page is bare** — functional but forgettable. First impression of the app.
- **No search-as-you-type** — search requires form submission and full page reload.
- **No command palette** — power users (who already use keyboard shortcuts) would love Cmd+K.
- **Context bar is invisible** — the new context window status bar exists but users won't notice it unless they're already in trouble.

### What's Missing
- **No streamed text** — Claude's response should appear word-by-word, not all at once
- **No page transitions** — navigation feels jarring
- **No skeleton loading screens** — standard modern expectation
- **No sound/haptic for notifications** — optional but adds life
- **No favicon badge** — unread count in the browser tab
- **No conversation preview on hover** — have to click into each one
- **No "Claude is thinking" personality** — the spinner is generic
- **No relative timestamps that update** ("2 minutes ago" stays frozen)
- **No command palette** (Cmd+K / Ctrl+K)
- **No scroll-to-top/bottom** in long conversations
- **No visual diff for branched conversations** — the fork feature needs a way to see what diverged

---

## Ticket Plan

### Ticket 1: Streamed text rendering — watch Claude think

**The single highest-impact UX improvement.**

Right now, the SSE stream sends `tool_call_start`, `tool_call_end`, `text`, and `done` events. The `text` event contains Claude's response, but the UI just shows "Finalizing response..." and reloads the page on `done`. The actual text is never streamed to the user.

**What it should do:**
- Stream Claude's response text character-by-character (or chunk-by-chunk) into the page
- Show a blinking cursor at the insertion point
- Render markdown incrementally (paragraphs complete, code blocks accumulate)
- Tool calls appear inline between text chunks (already partially works)
- On `done`, persist the response without a full page reload — just update the DOM

**Why it matters:** This is the core interaction. Watching an AI think in real-time is inherently engaging. Hiding it behind a spinner and reload is like watching a movie with your eyes closed and reading the plot summary after.

**Scope:**
- Update CLI provider to stream text chunks via `onProgress` callback
- Update SSE to send incremental text events
- Update conversation.ts to render incoming markdown chunks into a stream area
- Remove the page-reload-on-done pattern — append the final response to the DOM
- Add typing cursor animation

---

### Ticket 2: Skeleton loading screens and page transitions

**What it should do:**
- When navigating to a new page, show content-shaped skeleton placeholders (gray pulsing rectangles) instead of a blank screen
- Fade old content out (150ms) and new content in (200ms)
- Conversation list: show 5 skeleton cards while loading
- Dashboard: show skeleton stat cards, health widgets, conversation rows
- Conversation detail: show skeleton message bubbles

**Implementation approach:**
- Inline skeleton HTML in the shell template that's immediately visible
- Replace with real content on load (the server renders it, so it's fast — but the browser paint is not)
- Alternative: use `View Transitions API` (Chrome 111+) for cross-page animations with graceful fallback
- For non-supporting browsers: simple CSS fade

**Why it matters:** Perceived performance. The app is actually fast (server-rendered), but the full-page flash makes it feel slow.

---

### Ticket 3: Command palette (Cmd+K)

**What it should do:**
- `Cmd+K` (Mac) / `Ctrl+K` (other) opens a floating search/command palette
- Fuzzy search across: conversations, keyboard shortcuts, navigation, quick links
- Type "new" → "New Conversation" action
- Type a conversation snippet → jump to that conversation
- Type "dark" / "light" → switch theme
- Type "notif" → jump to notifications
- Arrow keys to navigate, Enter to select, Esc to close

**Implementation:** Vanilla JS overlay (no framework needed). Fetch conversation titles from a lightweight API endpoint (`GET /api/search?q=...&limit=5`). Static commands hardcoded.

**Why it matters:** Power users already use keyboard shortcuts. A command palette is the next natural step and makes the app feel like a real tool, not a web page.

---

### Ticket 4: Conversation list visual hierarchy and previews

**What it should do:**
- **Active indicator:** Green dot + subtle glow on conversations updated in the last 5 minutes
- **Message count badges:** Visual weight proportional to conversation length (thin for 2 messages, bold for 20+)
- **Preview on hover:** Show first 2 lines of the last Claude response in a tooltip/popover (desktop only)
- **Relative timestamps that tick:** "2 minutes ago" should update every 30 seconds without page reload
- **Visual grouping:** "Today", "Yesterday", "This Week", "Older" section headers
- **Unread indicator:** If a conversation had an async continuation (from scheduler/agentbox), show a blue dot until the user views it

**Why it matters:** The conversation list is the main navigation hub. Right now every card looks identical — there's no way to scan for what's new or important without reading every title.

---

### Ticket 5: Dashboard personality and data viz

**What it should do:**
- **Animated counters:** Stats count up from 0 on page load (300ms ease-out)
- **Sparkline charts:** Tiny inline line charts next to stat numbers showing 7-day trend
- **Health cards with personality:**
  - Memory at 90%? Card turns orange with a "Getting tight" subtitle
  - Disk at 95%? Red card, pulsing border, "Critical" badge
  - All green? A subtle checkmark animation plays
- **Activity heatmap:** Small GitHub-style grid showing conversation activity by day (last 30 days)
- **Claude avatar with expressions:** The robot icon in the greeting changes based on system health:
  - All healthy: Happy robot
  - Warning: Concerned robot
  - Error: Worried robot
- **Time-of-day greeting:** Already exists ("Good morning") but add a weather-like status: "All 12 services healthy" or "2 issues need attention"

**Why it matters:** The dashboard is the landing page. It should tell a story at a glance, not present a spreadsheet.

---

### Ticket 6: "Claude is thinking" personality

**What it should do:**
- Replace the generic "Processing..." spinner with contextual status messages:
  - "Checking container status..." (when get_container_status tool fires)
  - "Reading log files..." (when get_container_logs fires)
  - "Analyzing the situation..." (between tool calls)
  - "Writing response..." (when text starts streaming)
- Show a subtle animation: three dots bouncing, or a small robot icon with a thinking bubble
- Tool call cards during streaming should have a mini progress indicator (elapsed time counting up live)

**Why it matters:** The AI interaction is the core product. Making the waiting feel purposeful and transparent builds trust and engagement.

---

### Ticket 7: Notification system polish

**What it should do:**
- **Favicon badge:** Show unread count in the browser tab favicon (draw a red circle with number on the SVG)
- **Browser notifications:** Optional opt-in for desktop push notifications when important events happen (errors, agentbox completion)
- **Sound effect:** Optional subtle chime on new notification (muted by default, toggle in settings)
- **Notification grouping:** Group related notifications (e.g., 3 backup notifications → "3 backup events")
- **Swipe to dismiss** on mobile (touch events)

---

### Ticket 8: Login and onboarding experience

**What it should do:**
- **Login page animation:** The robot icon has a subtle idle animation (breathing/floating effect)
- **Background pattern:** Subtle grid or circuit-board pattern in Dracula colors behind the login card
- **Token input UX:** Show a checkmark animation when a valid token is detected (client-side length check)
- **First-visit onboarding:** After first login, show a 3-step overlay:
  1. "This is your dashboard" (highlight dashboard)
  2. "Start conversations from Slack with /ask" (highlight nav)
  3. "Use keyboard shortcuts for speed" (highlight ? key)
- **PWA manifest:** Add `manifest.json` so the app can be installed as a home screen shortcut on mobile with a proper icon

---

### Ticket 9: Conversation detail polish

**What it should do:**
- **Scroll-to-bottom button:** Floating button that appears when scrolled up in a long conversation (like chat apps)
- **Message timestamps on hover:** Show exact timestamp when hovering a message (currently only in header)
- **Copy individual messages:** Button on hover for any message (not just the full export)
- **Expand/collapse long messages:** Messages over ~500 words show first 200 with "Show more"
- **Branch tree indicator:** If a conversation has branches, show a small tree icon with count that expands to show branch list
- **Smooth scroll to new content:** After continuing a conversation, smooth-scroll to the new message instead of hard-scrolling

---

### Ticket 10: Mobile-first responsive overhaul

**What it should do:**
- **Bottom navigation bar** on mobile (instead of hamburger) — Dashboard, Conversations, Notifications as thumb-reachable tabs
- **Swipe gestures:**
  - Swipe right on a conversation card → favorite
  - Swipe left → archive
  - Swipe between tabs on conversation list
- **Touch-optimized hit targets:** Minimum 44px for all interactive elements
- **Pull-to-refresh** on conversation list and dashboard
- **Full-screen conversation view:** Hide nav on scroll down, show on scroll up (like mobile Safari)
- **Responsive typography:** Fluid font sizes using `clamp()`

---

## Dependency Graph

```
Ticket 1 (streamed text) — standalone, highest impact
Ticket 2 (skeletons + transitions) — standalone
Ticket 3 (command palette) — standalone
Ticket 4 (conversation list) — standalone
Ticket 5 (dashboard) — standalone
Ticket 6 (thinking personality) — depends on Ticket 1 (streaming)
Ticket 7 (notifications) — standalone
Ticket 8 (login + onboarding) — standalone
Ticket 9 (conversation detail) — partially depends on Ticket 1
Ticket 10 (mobile) — standalone, but benefits from all others
```

Most tickets are independent — can be worked in any order.

## Priority Order

| Priority | Ticket | Impact | Effort |
|----------|--------|--------|--------|
| 1 | Streamed text rendering | Transformative | Large |
| 2 | Skeleton loading + transitions | High | Medium |
| 3 | Dashboard personality + data viz | High | Medium |
| 4 | Conversation list visual hierarchy | High | Medium |
| 5 | "Claude is thinking" personality | Medium | Small |
| 6 | Command palette | Medium | Medium |
| 7 | Conversation detail polish | Medium | Medium |
| 8 | Mobile responsive overhaul | Medium | Large |
| 9 | Login + onboarding | Low-Medium | Medium |
| 10 | Notification polish | Low | Small |

Tickets 1-4 are the high-impact changes that transform how the app feels. Ticket 1 alone would be a night-and-day difference.

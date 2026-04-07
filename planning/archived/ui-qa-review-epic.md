# Epic: UI/UX Quality Review — Screenshot-Based Audit

## Context

Used `npm run screenshots` to capture and review all 60 screenshots (6 pages x multiple states x 2 themes x 2 viewports). This document catalogs every finding from a visual QA pass across the entire web UI.

## Overall Assessment

The UI is **solid** — consistent theming, good responsive behavior, clear information hierarchy. Both Dracula and light themes render well. The findings below are polish-level improvements, not fundamental issues.

## Findings by Page

### 1. Dashboard

**Good:**
- Health cards are clear with color-coded severity (green/yellow/red)
- "All systems healthy" vs "Issues detected" badge works well
- Quick links, stats cards, and recent conversations all render cleanly
- Mobile bottom nav (Dashboard/Chats/Alerts) is clear

**Issues:**
- [ ] **Empty dashboard has a large blank gap below the welcome card** — the footer ("Powered by Claude") floats at the bottom with a huge empty space between it and the CTA. On desktop this looks unfinished. Consider centering the welcome vertically or adding a subtle background pattern.
- [ ] **"Pull to refresh" text visible on mobile** — shows as static text at the top of the mobile viewport. It should probably be hidden until the pull gesture actually starts, or removed if not implemented as a real pull-to-refresh.
- [ ] **Health card progress bars are very thin** — the small colored bars under each metric (memory, disk, load) are easy to miss. Consider making them slightly taller (4px → 6-8px) for better visibility, especially on the degraded state where severity matters most.
- [ ] **Stats cards (47 SESSIONS / 312 MESSAGES / 89 TOOL CALLS) lack context** — the numbers are prominent but there's no sparkline, trend, or comparison to give them meaning. A simple "↑12% from last week" or mini chart would make them more useful. (Stretch — may be too complex for now.)

### 2. Sessions (Conversation List)

**Good:**
- Tabs (Mine/All/Favorites/Archived) are clear with proper active styling
- Tag sidebar works well as a filter
- Active conversations get a green dot indicator
- Favorite star is visible
- Search results and no-results states are clean
- Archived view clearly labeled

**Issues:**
- [ ] **Conversation cards in dark theme have very low contrast on metadata** — timestamps ("2m ago"), message/tool counts ("8 msgs / 3 tools") are quite hard to read in Dracula theme. The muted text is too faint against the card background.
- [ ] **Mobile sessions page has no visible search input** — on mobile, the search bar is visible but the Search button is cramped next to it. The pink gradient button competes visually with the conversation list.
- [ ] **Tag sidebar takes significant horizontal space on desktop** — on the populated sessions view, tags occupy ~20% of the width even when there are only 6 tags. When many conversations are listed, the sidebar could collapse behind a toggle.

### 3. Conversation Detail

**Good:**
- User/Claude message bubbles are visually distinct (yellow "A" avatar vs robot icon)
- Markdown table renders beautifully with proper alignment
- Code blocks are styled with syntax highlighting
- Tags are interactive with "+ Add" input
- Action buttons (download, fork, branch) are clean
- "2 branches" indicator on branched variant is subtle but visible

**Issues:**
- [ ] **"Back to conversations" link + "Claude Conversation" title is redundant** — the title "Claude Conversation" is generic and not useful. It should show the first message preview or a generated title instead.
- [ ] **Scroll-to-bottom FAB (pink circle with ↓) is visually heavy** — the floating action button in the bottom-right is large and uses the accent gradient. It draws more attention than the conversation content. Consider making it smaller, more subtle (solid color, no gradient), or appearing only when scrolled up from the bottom.
- [ ] **Mobile conversation header is cramped** — "Back to conversations" wraps to 2 lines, action buttons are on a separate row, tags and "Add tag" are all stacked. This burns a lot of vertical space before the first message appears. Consider collapsing the header on mobile (hide tags behind a toggle, move actions to a menu).
- [ ] **Table overflow on mobile** — the markdown table in the conversation extends to the edge but could overflow horizontally on very narrow screens. Should verify with longer column data.

### 4. Notifications

**Good:**
- Level indicators (colored dots) are clear — red for error, yellow for warn, muted for info
- Read vs unread state distinction works (bold title + unread marker)
- "Mark all read" button is well-placed
- Source labels (system, backup, ssl, health, hue) provide context
- Empty state is friendly with bell icon and helpful text

**Issues:**
- [ ] **Unread notifications lack a clear visual distinction in dark theme** — in light theme, unread cards have a slightly different background. In Dracula, the difference between read and unread cards is very subtle. The checkmark icon (✓) on unread items is the main signal but it's small and low-contrast.
- [ ] **No notification level icons** — the colored dot is the only indicator of severity. An icon (warning triangle for warn, X-circle for error) next to the title would make scanning faster.
- [ ] **"Mark all read" button style is inconsistent** — it uses an outlined style that looks like a secondary action, but it's the primary action on this page. Should either get the accent color or at least a stronger visual presence.

### 5. Login

**Good:**
- Clean centered card design
- Error state clearly shows the validation message in red
- Gradient login button is distinctive
- "AI-powered server diagnostics" subtitle sets expectations

**Issues:**
- [ ] **Login card is very small on desktop** — the card takes about 30% of the screen width and 25% of the height. This leaves a lot of dead space. Consider making the card slightly larger or adding a hero illustration/description.
- [ ] **"Access Token" label and eye icon are quite small** — the label is in a small muted font. The show/hide password toggle icon is tiny.
- [ ] **No "forgot token" or help link** — users who don't know their token have no guidance. A small help text like "Find your token in your .env file" would reduce confusion.

### 6. 404 Page

**Good:**
- Clean, centered design
- "Back to conversations" CTA is clear

**Issues:**
- [ ] **404 page has no nav bar** — unlike all other pages, the 404 doesn't show the top navigation bar. This makes it feel disconnected from the app. Users can't navigate back via the nav, only via the CTA button.
- [ ] **"Conversation not found or has expired" is too specific** — this 404 serves as the catch-all for any unknown route, not just conversations. The copy should be more generic: "Page not found" with a "Back to dashboard" button.

### 7. Cross-Cutting Issues

- [ ] **Footer "Powered by Claude" appears on some pages but not others** — visible on dashboard (empty), sessions (empty), favorites, 404. Not visible on populated dashboard, conversation detail, notifications. Should be consistent.
- [ ] **Light theme notification bell badge** — the red "2" badge on the notification bell is harder to see in light theme vs dark theme. The contrast is fine but worth verifying.
- [ ] **No loading states visible** — the harness captures static renders, but real pages have loading states (skeleton screens, spinners). These should be visually reviewed in a live environment.

## Priority Matrix

### High Impact, Low Effort
1. Fix 404 nav bar + generic copy
2. Improve notification read/unread contrast in dark theme
3. Fix "Pull to refresh" visibility on mobile dashboard
4. Improve conversation card metadata contrast in sessions (dark theme)

### High Impact, Medium Effort
5. Improve mobile conversation header (collapse tags/actions)
6. Replace generic "Claude Conversation" title with first message preview
7. Add help text to login page
8. Make scroll-to-bottom FAB less visually heavy

### Medium Impact, Low Effort
9. Increase health card progress bar height
10. Improve "Mark all read" button visibility
11. Fix 404 copy to be generic

### Lower Priority / Stretch
12. Add notification level icons (warn/error)
13. Dashboard stats cards with trend indicators
14. Collapsible tag sidebar on sessions page
15. Enlarge login card for desktop
16. Consistent footer across all pages

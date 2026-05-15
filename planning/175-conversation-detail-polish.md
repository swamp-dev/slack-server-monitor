# Plan: Conversation Detail Polish (#175)

## Epic Status

| # | Ticket | Status |
|---|--------|--------|
| #167 | Streamed text rendering | Merged (PR #177) |
| #168 | Skeleton loading + transitions | PR #185 open |
| #169 | Command palette (Cmd+K) | Merged (PR #183) |
| #170 | Conversation list visual hierarchy | Merged (PR #180) |
| #171 | Dashboard personality + data viz | Merged (PR #182) |
| #172 | Claude thinking personality | Merged (PR #177) |
| **#175** | **Conversation detail polish** | **Next** |
| #173 | Notification system polish | Backlog |
| #174 | Login + onboarding | Backlog |
| #176 | Mobile responsive overhaul | Backlog |

6 of 10 tickets complete. #175 is next in priority.

---

## Context

The conversation detail page (`/c/:threadTs/:channelId`) renders messages, tool calls, and a continuation form with SSE streaming. It works well functionally but lacks polish — no scroll-to-bottom, no per-message copy, no message collapsing, limited branch visibility.

## Scope — 6 Features

### 1. Scroll-to-bottom floating button
**Effort: Small | Files: conversation.ts, styles.ts**

Add a floating button (bottom-right) that appears when the user scrolls up more than 300px from the bottom. Clicking scrolls smoothly to the bottom.

- Render a fixed-position button with a down-arrow icon, hidden by default
- JS `scroll` event listener on `window` toggles visibility
- `scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })`
- Hide when within 300px of bottom

### 2. Message timestamps on hover
**Effort: Medium | Files: conversation-store.ts, conversation.ts, styles.ts, server.ts**

Messages currently have no individual timestamps — only `createdAt`/`updatedAt` on the conversation. Tool calls have timestamps though.

**Approach: Estimate message timestamps from available data.**
- First user message → `createdAt`
- Subsequent messages → interpolate from tool call timestamps and `updatedAt`
- Alternatively (simpler): show conversation-level "Created" and "Updated" timestamps, plus tool call timestamps for messages that have tool calls adjacent

**Recommended approach**: Add a `timestamp` field to `ConversationMessage` interface and populate it when messages are appended to the store. This requires:
- Schema: Add `message_timestamps` column (JSON array of numbers) to conversations table, or store timestamps inline in the messages JSON
- Store: Update `appendMessage()` to include `Date.now()` timestamp
- Template: Render `data-ts="..."` attribute, show on hover via CSS tooltip
- Migration: Existing messages without timestamps show "—"

### 3. Copy individual messages
**Effort: Small | Files: conversation.ts, styles.ts**

Add a copy button in each message header (next to the fork button). On click, copy the message's plain text content to clipboard.

- Button with clipboard icon, hidden by default, visible on `.message:hover`
- `navigator.clipboard.writeText()` with the message content
- Brief "Copied!" toast or button state change (checkmark icon for 1.5s)
- Use `data-content` attribute or read from `.message-content` innerHTML → strip HTML

### 4. Expand/collapse long messages
**Effort: Medium | Files: conversation.ts, styles.ts**

Messages over 500 words show first ~200 words with a "Show more" button.

- In `renderMessage()`: count words in `message.content`, if >500 words, wrap content in a container with `max-height` + overflow hidden + gradient fade
- "Show more" button below the gradient
- On click: remove max-height, hide button, show "Show less"
- Word count: `content.split(/\s+/).length`
- The truncation should be CSS-based (max-height on the rendered HTML), not content truncation, to preserve markdown rendering

### 5. Branch tree indicator
**Effort: Medium | Files: conversation.ts, server.ts, conversation-store.ts**

If a conversation has branches (forks), show a tree icon with count in the header, expandable to list branches.

- Server: call `store.listBranches(conversationId)` in the route handler, pass to template
- Template: if branches exist, render a badge `{icon('git-branch')} {count} branches` in the conversation header
- On click: expand a dropdown listing branch conversations with links
- Also: at the message where a branch point exists, show a subtle indicator (small branch icon in the message gutter)

### 6. Smooth scroll to new content after continuation
**Effort: Small | Files: conversation.ts**

Currently `scrollIntoView()` fires only on the first `text` SSE event. After continuation completes, the new response should be smoothly visible.

- On `done` event: after appending the final response, `scrollIntoView({ behavior: 'smooth', block: 'end' })` on the new message element
- During streaming: keep viewport following if user is already at/near bottom (within 200px), don't force-scroll if user scrolled up to read earlier messages

---

## Implementation Order

1. **Scroll-to-bottom button** — standalone, quick win
2. **Copy individual messages** — standalone, quick win
3. **Smooth scroll after continuation** — standalone, quick fix to existing code
4. **Expand/collapse long messages** — standalone, CSS + template change
5. **Branch tree indicator** — needs server.ts + store changes
6. **Message timestamps on hover** — needs schema migration, most complex

Items 1-4 are pure frontend (template + CSS). Items 5-6 touch the data layer.

## Key Files

- `src/web/templates/conversation.ts` — main template (966 lines), message rendering, SSE script
- `src/web/templates/styles.ts` — message CSS, hover states, animations
- `src/web/server.ts` — route handler at `/c/:threadTs/:channelId`
- `src/services/conversation-store.ts` — `ConversationMessage` interface, `listBranches()`, `appendMessage()`
- `tests/web/templates.test.ts` — template tests
- `tests/services/conversation-store.test.ts` — store tests

## Testing

- Template tests: verify scroll-to-bottom button HTML, copy button, expand/collapse markup, branch indicator
- Store tests: verify `listBranches()` returns correct data, message timestamp population
- Manual: test scroll behavior in browser, copy functionality, expand/collapse interaction
- Run: `npm test && npm run typecheck && npm run lint && npm run build`

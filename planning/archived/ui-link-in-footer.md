# Plan: Add Web UI Link to Response Footer

## Goal

Add a link to the web UI conversation page in the response footer, and remove the redundant `Thread: <ts>` since the thread_ts is already embedded in `/ask continue <ts>`.

## Current Footer Format

Three variations in `src/commands/ask.ts`:

1. **Initial response** (line 275-280):
   ```
   Tools used: 3 | Tokens: 1,234 | Thread: 1774666073.783769 | Reply in thread to continue | /ask continue 1774666073.783769
   ```

2. **Continue response** (line 507-513):
   ```
   Tools used: 2 | Tokens: 890 | History: 5 msgs | Thread: 1774666073.783769 | Reply in thread to continue | /ask continue 1774666073.783769
   ```

3. **Thread reply** (line 689-691):
   ```
   Tools used: 1 | Tokens: 456 | Thread: 1774666073.783769 | /ask continue 1774666073.783769
   ```

## Proposed Footer Format

When web is enabled (`WEB_ENABLED=true` + `WEB_BASE_URL` set):

1. **Initial response**:
   ```
   Tools used: 3 | Tokens: 1,234 | Reply in thread to continue | /ask continue 1774666073.783769 | View in UI
   ```

2. **Continue response**:
   ```
   Tools used: 2 | Tokens: 890 | History: 5 msgs | Reply in thread to continue | /ask continue 1774666073.783769 | View in UI
   ```

3. **Thread reply**:
   ```
   Tools used: 1 | Tokens: 456 | /ask continue 1774666073.783769 | View in UI
   ```

When web is **not** enabled, same as above but without the `View in UI` link.

## Changes Required

### File: `src/commands/ask.ts`

**Single change pattern applied 3 times:**

1. Remove `Thread: \`${threadTs}\` | ` from all three footer locations
2. Conditionally append a `View in UI` Slack link when `webEnabled`
3. Use `getConversationUrl()` (already imported) to generate the HMAC-signed URL

**Implementation approach:** Build the footer string with a helper or inline conditional. Since the footer is already computed near `webEnabled` checks, we can just conditionally append the link.

Rough shape:

```typescript
const footerParts = [
  `Tools used: ${String(result.toolCalls.length)}`,
  `Tokens: ${totalTokens.toLocaleString()}`,
  // (only for continue) `History: ${msgs} msgs`,
  // (only for initial/continue) `Reply in thread to continue`,
];

const askContinue = `/ask continue ${threadTs}`;
// Always show /ask continue
footerParts.push(`\`${askContinue}\``);

// Conditionally add web UI link
if (webEnabled) {
  const webUrl = getConversationUrl(threadTs, channelId, webConfig, userId);
  footerParts.push(`<${webUrl}|View in UI>`);
}

contextBlock(`_${footerParts.join(' | ')}_`);
```

### Locations to modify

| Line | Context | Notes |
|------|---------|-------|
| 275-280 | Initial `/ask` response | Remove Thread, add UI link |
| 507-513 | `/ask continue` response | Remove Thread, add UI link, keep History |
| 689-691 | Thread reply response | Remove Thread, add UI link |

### Consider: Extract a helper

Since the footer logic is repeated 3 times with minor variations, consider extracting a `buildFooterContext()` helper to reduce duplication:

```typescript
function buildFooter(opts: {
  toolCalls: number;
  tokens: number;
  threadTs: string;
  channelId: string;
  userId: string;
  historyMsgs?: number;
  showReplyHint?: boolean;
  webConfig?: WebConfig;
}): string
```

**Pros:** DRY, single place to maintain footer format
**Cons:** Adds abstraction for only 3 call sites — may be premature

**Recommendation:** Extract the helper. The footer is already repeated 3 times with copy-paste drift risk, and we're adding conditional logic (web link). A helper keeps it consistent.

## Testing

- Existing tests should still pass (footer format changes are cosmetic)
- If there are tests that assert on the footer context block text, they'll need updating
- Verify with `npm test` after changes

## Files Touched

- `src/commands/ask.ts` — footer construction (3 locations → 1 helper + 3 call sites)
- `tests/commands/ask.test.ts` — update footer assertions if any exist

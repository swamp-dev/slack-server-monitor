---
title: "perf(query): index conversation lookups by thread_ts"
issue_number: 188
---

## Context

The conversation store does a full table scan to find conversations by `thread_ts`. With ~50K rows in the demo dataset, this is ~80ms per lookup and shows up in the slow-query log. An index on `thread_ts` plus a covering index for the thread+channel lookup would drop it to <2ms.

## Acceptance Criteria

- [ ] Migration adds `idx_conversations_thread_ts` index
- [ ] Combined `(thread_ts, channel_id)` covering index for the dual-key lookup
- [ ] EXPLAIN QUERY PLAN shows index usage in tests

## Files

- `src/services/conversation-store.ts` — schema (modify)
- `tests/services/conversation-store.test.ts` — index assertions (modify)

## Dependencies

Part of #150.

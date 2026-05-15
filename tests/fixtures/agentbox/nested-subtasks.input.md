---
title: "feat(web): add notification preferences page"
issue_number: 200
---

## Summary

Add a user-facing page for controlling notification preferences.

## Context

Currently notifications are all-or-nothing. Users want granular control over what triggers a notification.

## Acceptance Criteria

- [ ] Create notification preferences data model
  - [ ] Database table for per-user notification preferences
  - [ ] Default preferences for new users
- [ ] Build preferences API endpoint
  - [ ] GET /api/notifications/preferences returns current settings
  - [ ] PUT /api/notifications/preferences updates settings
- [ ] Add preferences UI page at /notifications/settings

## Files

- `src/services/notification-store.ts` — notification storage (modify)
- `src/web/templates/notifications.ts` — notification pages (modify)
- `tests/services/notification-store.test.ts` — tests (modify)

## Dependencies

Part of #190. Depends on #195.

---
title: "feat(auth): add session management"
issue_number: 75
---

## Summary

Add session management with login/logout support.

## Acceptance Criteria

- [x] Session table created in SQLite
- [x] Login endpoint creates session
- [ ] Logout endpoint destroys session
- [ ] Session expiry cleanup job

## Files

- `src/web/server.ts` — web server (modify)

## Dependencies

Part of #70.

---
title: "fix(shell): handle spaces in docker container names"
issue_number: 99
---

## Summary

Docker container names with spaces cause shell command failures in the container status tool.

## Context

When a user names a container with spaces (e.g., "my app"), the `docker inspect` call fails because the name isn't quoted properly.

## Acceptance Criteria

- [ ] Container names with spaces are properly escaped in shell commands
- [ ] Add test case for container names with special characters

## Files

- `src/utils/shell.ts` — shell execution (modify)
- `tests/utils/shell.test.ts` — tests (modify)

## Dependencies

Part of #90.

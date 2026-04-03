---
title: "feat(agentbox): plugin skeleton and database schema"
issue_number: 155
---

## Summary

Create the `agentbox` plugin with init/destroy lifecycle, database tables, and slash command stub.

## Context

Everything else in the AgentBox epic builds on this. The database tracks the full lifecycle: which Slack thread created which issue, which agentbox run picked it up, what the result was.

## Acceptance Criteria

- [ ] `plugins.local/agentbox.ts` loads without errors
- [ ] Database tables created on init:
  - `plugin_agentbox_runs` — tracks each agentbox execution (issue_number, repo, status, branch, pr_url, started_at, finished_at, output_path, error)
  - `plugin_agentbox_issue_links` — maps GitHub issue → Slack thread (issue_number, repo, thread_ts, channel_id, created_by, created_at)
- [ ] `/agentbox status` responds in Slack with "no runs yet" placeholder
- [ ] Plugin config reads env vars: `AGENTBOX_BINARY_PATH`, `AGENTBOX_WORK_DIR`, `AGENTBOX_DEFAULT_REPO`
- [ ] Unit tests for schema creation and config loading

## Files

- `plugins.local/agentbox.ts` — plugin entry point (new)
- `plugins.local/agentbox/schema.ts` — database schema setup (new)
- `plugins.local/agentbox/config.ts` — env var config (new)
- `tests/plugins/agentbox/skeleton.test.ts` — tests (new)

## Dependencies

Part of #154. No blocking dependencies — this is the first ticket.

# Slack Server Monitor

A TypeScript Slack bot using Socket Mode for **read-only** home server monitoring and diagnostics.

## Architecture

```
Home Server ──(outbound WebSocket)──> Slack API
     │
     └── No exposed ports, no public URL needed
```

Socket Mode connects **outbound** to Slack via WebSocket. No ports exposed, no public URL required. Safe for home servers behind NAT/firewalls.

## Key Principle: Read-Only

This bot provides **read-only observability**. It cannot:
- Restart, stop, or start services
- Execute commands inside containers
- Modify files or configurations
- Delete anything

See `src/utils/shell.ts` for the security implementation.

## Project Structure

```
src/
├── app.ts                    # Entry point, Socket Mode init
├── config/
│   ├── index.ts              # Config loader from env vars
│   ├── schema.ts             # Zod validation schemas
│   └── prompts.ts            # Claude system prompt
├── middleware/
│   ├── authorize.ts          # User/channel authorization
│   ├── rate-limit.ts         # Rate limiting
│   └── audit-log.ts          # Command audit logging
├── commands/
│   ├── index.ts              # Command registration
│   ├── ask.ts                # Claude AI /ask command + thread handler
│   └── *.ts                  # Individual command handlers
├── services/
│   ├── claude.ts             # Claude service wrapper (backward compatible)
│   ├── conversation-store.ts # SQLite storage for conversations
│   ├── conversation-processor.ts # Message processing pipeline
│   ├── context-store.ts      # SQLite storage for channel context
│   ├── context-loader.ts     # Load CLAUDE.md and .claude/context/ from context dir
│   ├── db-backup.ts          # Automatic SQLite backup scheduler
│   ├── event-bus.ts          # Internal event emitter
│   ├── notification-store.ts # SQLite notification center
│   ├── plugin-claude.ts      # Plugin Claude API bridge
│   ├── plugin-database.ts    # Scoped plugin database access
│   ├── quick-links-store.ts  # Per-user dashboard bookmarks
│   ├── server-health.ts      # Cached server health metrics
│   ├── session-store.ts      # Web session management
│   ├── user-config.ts        # Per-user config from ~/.claude/
│   ├── providers/
│   │   ├── index.ts          # Provider factory
│   │   ├── types.ts          # Provider type definitions
│   │   └── cli-provider.ts   # Claude CLI backend
│   └── tools/
│       ├── index.ts          # Tool router
│       ├── types.ts          # Tool type definitions
│       ├── validation.ts     # Tool input validation
│       ├── server-tools.ts   # Container, system, network tools
│       ├── github-tools.ts   # GitHub issue tools
│       └── file-tools.ts     # File reading with path validation
├── executors/
│   └── *.ts                  # Shell command wrappers
├── formatters/
│   ├── blocks.ts             # Slack Block Kit builders
│   └── scrub.ts              # Sensitive data scrubber
├── web/
│   ├── index.ts              # Web module exports
│   ├── server.ts             # Express HTTP server for long responses
│   ├── plugin-router.ts      # Plugin web route registration (/p/{name}/)
│   ├── plugin-helpers.ts     # Template helpers for plugin pages
│   └── templates/
│       ├── index.ts          # Template barrel exports
│       ├── shell.ts          # HTML shell with nav, theme, notifications
│       ├── dashboard.ts      # Dashboard with health, widgets, quick links
│       ├── notifications.ts  # Notification bell, dropdown, page
│       ├── session-list.ts   # Conversation list page
│       ├── conversation.ts   # Single conversation page
│       ├── icons.ts          # Inline SVG icon system
│       ├── theme.ts          # Theme CSS variables
│       ├── styles.ts         # Base CSS styles
│       ├── keyboard.ts       # Keyboard shortcut system
│       ├── utils.ts          # escapeHtml, sanitizeUrl, formatTimestamp
│       ├── errors.ts         # 404, 401, error pages
│       └── export.ts         # Markdown export
├── utils/
│   ├── shell.ts              # SECURE shell execution
│   ├── sanitize.ts           # Input sanitization
│   └── logger.ts             # Winston logger
├── plugins/
│   ├── index.ts              # Plugin exports (Plugin, PluginContext types)
│   ├── loader.ts             # Plugin discovery and loading
│   └── plugin-app.ts         # PluginApp wrapper with validation
└── types/
    └── index.ts              # TypeScript interfaces

plugins.example/             # Bundled plugins (ship in the repo, loaded by default)
├── agentbox.ts              # AgentBox plugin entrypoint
└── agentbox/                # AgentBox plugin internals + tests

plugins.local/                # Local plugin overrides (gitignored)
                              # Same-name files here win over plugins.example/

vendor/
└── agentbox/                 # swamp-dev/agentbox Go source (git submodule);
                              # built into dist/bin/agentbox by Dockerfile +
                              # `npm run agentbox:build`
```

## Key Files

Quick reference for navigating the codebase:

| Area | Files |
|------|-------|
| **Security** | `src/utils/shell.ts`, `src/utils/sanitize.ts`, `src/formatters/scrub.ts` |
| **Config** | `src/config/schema.ts`, `src/config/index.ts`, `.env.example` |
| **Claude tools** | `src/services/tools/server-tools.ts`, `src/services/tools/file-tools.ts`, `src/services/tools/github-tools.ts` |
| **Plugin system** | `src/plugins/index.ts`, `src/plugins/loader.ts`, `src/plugins/plugin-app.ts` |
| **Web UI** | `src/web/server.ts`, `src/web/templates/` |
| **Commands** | `src/commands/` (one file per slash command) |
| **Tests** | `tests/` (mirrors `src/` structure) |

## Security Architecture

### Command Allowlist (`src/utils/shell.ts`)
- Only specific commands can be executed
- Subcommands validated (docker, systemctl, curl, etc.)
- Sensitive paths blocked (/.ssh, /.gnupg, /.aws, .env, etc.)
- No shell interpolation -- uses `execFile()` with `shell: false`

### Input Sanitization (`src/utils/sanitize.ts`)
- All user input validated with Zod schemas
- Shell metacharacters rejected (`;`, `|`, `&`, `` ` ``, `$()`, etc.)

### Log Scrubbing (`src/formatters/scrub.ts`)
- Passwords, tokens, API keys redacted before sending to Slack
- WARNING: Cannot catch all sensitive data

### Access Control
- User ID allowlist in `AUTHORIZED_USER_IDS`
- Optional channel restrictions in `AUTHORIZED_CHANNEL_IDS`
- Silent rejection for unauthorized users
- Rate limiting (default: 10 cmd/min/user)

Full details: [docs/security.md](docs/security.md)

## Development

```bash
npm run setup           # Interactive setup wizard (creates/updates .env)
npm install             # Install dependencies (also initializes vendor/agentbox submodule and builds the Go binary if Go is installed)
npm run dev             # Hot reload development server
npm test                # Run tests
npm run typecheck       # Type checking
npm run lint            # Linting
npm run build           # Production build
npm run screenshots     # Capture web UI screenshots (Playwright)
npm run ci              # Run every CI check locally (lint, typecheck, build, coverage, smoke, e2e, audit)
npm run ci:fast         # Inner-loop subset of ci (skips e2e + audit)
npm run test:mutation   # Stryker mutation testing on the security perimeter
```

Use `nvm use` in the repo root to pick the same Node version CI runs (pinned in `.nvmrc`).

### UI Development Workflow

When modifying web templates (`src/web/templates/`), use screenshots to verify changes:

1. Make template changes
2. Run `npm run screenshots` (or target a single page: `npx tsx scripts/take-screenshots.ts dashboard`)
3. View the screenshots in `screenshots/` to verify both themes and viewports look correct
4. Iterate as needed

## Testing Conventions

- Core tests in `tests/` directory, mirroring `src/` structure
- Plugin tests colocated alongside their plugins (`plugins.example/**/*.test.ts`, `plugins.local/**/*.test.ts`)
- Plugin infrastructure tests in `tests/plugins/`
- Use Vitest with `describe/it/expect`
- Security tests are critical -- see `tests/utils/shell.test.ts`
- **100% of tests must pass** -- no skipped, pending, or failing tests allowed
- No coverage thresholds enforced -- focus on critical path coverage
- Run `npm test` before committing

## CI/CD

### CI Pipeline (`.github/workflows/ci.yml`)

Runs on push to `main` and PRs: lint, typecheck, build, test, and security audit.

### Parent Submodule Update (`.github/workflows/update-parent-submodule.yml`)

This repo is a git submodule of `swamp-dev/ansible`. When code merges to `main`, a workflow automatically updates the submodule pointer and creates a PR in the parent repo.

Required secret: `PARENT_REPO_TOKEN` (GitHub PAT with `repo` scope for `swamp-dev/ansible`).

## Security Warnings

1. **Log data may contain secrets** -- automatic scrubbing is not foolproof
2. **Slack stores messages** -- don't use in channels with untrusted members
3. **Audit log regularly** -- check who's running what commands
4. **Keep user list minimal** -- only add trusted team members
5. **Claude tools are read-only** -- same security model as direct commands
6. **File reading is restricted** -- only paths in `CLAUDE_ALLOWED_DIRS` (symlink-safe)
7. **Tool outputs are scrubbed** -- but scrubbing isn't perfect
8. **Conversations stored in SQLite** -- auto-cleaned after `CLAUDE_CONVERSATION_TTL_HOURS`
9. **Tool call limits** -- prevents infinite loops (default: max 100 tools per turn, max 50 iterations)
10. **Tool call analytics** -- duration (ms) and success/failure tracked per tool call for diagnostics

## Extended Documentation

| Topic | Location |
|-------|----------|
| All commands | [docs/commands.md](docs/commands.md) |
| Configuration reference | [docs/configuration.md](docs/configuration.md) |
| Claude AI tools & context | [docs/claude-ai.md](docs/claude-ai.md) |
| Web UI features | [docs/web-ui.md](docs/web-ui.md) |
| Plugin development | [docs/plugins.md](docs/plugins.md) |
| Security model | [docs/security.md](docs/security.md) |
| Deployment options | [docs/deployment.md](docs/deployment.md) |
| Troubleshooting | [docs/troubleshooting.md](docs/troubleshooting.md) |
| Developer guide | [docs/developing.md](docs/developing.md) |
| Testing & coverage | [docs/testing.md](docs/testing.md) |
| MCP server | [mcp/README.md](mcp/README.md) |

## Important: Always Execute, Never Narrate
When creating GitHub issues, PRs, or running any shell command, **always use the Bash tool** to execute the actual command. Never generate fake command output or pretend a command was run. If a command fails, report the real error.

# Configuration Reference

All configuration is via environment variables in `.env`. Run `npm run setup` for an interactive wizard, or copy `.env.example` and edit manually.

## Core Slack

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SLACK_BOT_TOKEN` | Yes | - | Bot User OAuth Token (`xoxb-...`) |
| `SLACK_APP_TOKEN` | Yes | - | App-Level Token (`xapp-...`) |

## Authorization

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AUTHORIZED_USER_IDS` | First-run only | - | Comma-separated Slack user IDs. **Bootstrap-only** — used once on first startup to seed the `users` table; ignored at runtime thereafter. See "User accounts migration" below. |
| `AUTHORIZED_CHANNEL_IDS` | No | - | Restrict commands to specific channel IDs |

### User accounts migration

As of #278, the `users` SQLite table is the sole runtime source of truth for who can run commands. `AUTHORIZED_USER_IDS` is now **bootstrap-only**:

1. **First startup** — if the users table is empty and `AUTHORIZED_USER_IDS` is set, the bot seeds the table from the env var. The first ID becomes admin; the rest are regular users.
2. **Subsequent runs** — the env var is ignored at request time. Add or remove users via:
   - **Slack:** `/user-admin add U01ABC` / `/user-admin remove U01ABC` / `/user-admin promote U01ABC`
   - **Web UI:** the `/admin/users` page (admin-only)
   - **CLI:** `npm run manage-users add` (and friends)
3. **After bootstrap** — the env var can safely be removed. The bot logs an INFO at startup when both are populated, telling you exactly that.
4. **Failure modes** — if both the users table is empty AND `AUTHORIZED_USER_IDS` is unset, the bot **refuses to start** (logs an ERROR explaining how to recover).

There is no longer a runtime fallback path: a user listed in `AUTHORIZED_USER_IDS` but not in the `users` table will be rejected. This was deliberately closed in #278 — the table reflects activation state (deactivation, role changes, deletions) and the env var doesn't.

## Rate Limiting

| Variable | Default | Description |
|----------|---------|-------------|
| `RATE_LIMIT_MAX` | 10 | Max commands per user per window |
| `RATE_LIMIT_WINDOW_SECONDS` | 60 | Rate limit window in seconds |
| `RATE_LIMIT_COMMANDS` | `{}` | Per-command overrides as JSON (e.g., `{"ask": {"max": 3, "windowSeconds": 120}}`) |

## Server Monitoring

| Variable | Default | Description |
|----------|---------|-------------|
| `MONITORED_SERVICES` | - | Comma-separated container names/prefixes to monitor |
| `SSL_DOMAINS` | - | Comma-separated domains for SSL certificate checks |
| `MAX_LOG_LINES` | 50 | Default log lines returned (hard cap: 500) |
| `BACKUP_DIRS` | - | Comma-separated backup directories to monitor |
| `S3_BACKUP_BUCKET` | - | S3 bucket name for backup verification |

## Logging

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | info | Log level: `debug`, `info`, `warn`, `error` |
| `AUDIT_LOG_PATH` | - | File path for audit logs (logs to console if not set) |

## Claude AI

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUDE_ENABLED` | false | Set to `true` to enable `/ask` command |
| `CLAUDE_PROVIDER` | cli | Provider: `cli` (legacy values `auto`/`sdk` accepted for compat) |
| `CLAUDE_CLI_PATH` | claude | Path to Claude CLI executable |
| `CLAUDE_CLI_MODEL` | opus | Model alias: `sonnet`, `opus`, `haiku` |
| `CLAUDE_SDK_MODEL` | claude-sonnet-4-5 | Model ID when using SDK provider (`CLAUDE_PROVIDER=sdk`). Not needed for CLI. Set to the current model release. |
| `CLAUDE_ALLOWED_DIRS` | - | Comma-separated paths Claude can read files from |
| `CLAUDE_MAX_TOKENS` | 2048 | Max tokens per response |
| `CLAUDE_MAX_TOOL_CALLS` | 100 | Max tool calls per turn (prevents loops) |
| `CLAUDE_MAX_ITERATIONS` | 50 | Max agentic loop iterations (defense in depth) |
| `CLAUDE_RATE_LIMIT_MAX` | 5 | Claude requests per user per window |
| `CLAUDE_RATE_LIMIT_WINDOW_SECONDS` | 60 | Claude rate limit window |
| `CLAUDE_CONVERSATION_TTL_HOURS` | 24 | Hours to keep conversation history |
| `CLAUDE_MAX_FILE_SIZE_KB` | 100 | Max file size Claude can read (KB) |
| `CLAUDE_MAX_LOG_LINES` | 50 | Max log lines Claude can request (max: 100) |
| `CLAUDE_CLI_TIMEOUT_MS` | 1200000 | CLI process timeout in ms (default 20 min, max 1 hour) |

### Context Directories

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUDE_CONTEXT_DIR` | - | Directory with `CLAUDE.md` and `.claude/context/` for infrastructure context |
| `CLAUDE_CONTEXT_OPTIONS` | - | Comma-separated `alias:path` pairs for per-channel context switching |

The context directory is automatically added to `CLAUDE_ALLOWED_DIRS`. See [Claude AI](claude-ai.md#context-directories) for details.

### Context Window

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUDE_CONTEXT_WINDOW_TOKENS` | 200000 | Token context window size |
| `CLAUDE_CONTEXT_TRUNCATION_THRESHOLD` | 0.8 | Fraction of window before truncating context |
| `CLAUDE_CONTEXT_WARNING_THRESHOLD` | 0.7 | Fraction of window before warning about context size |

### Database

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUDE_DB_PATH` | ./data/claude.db | SQLite database for conversations |
| `CLAUDE_DB_BACKUP_ENABLED` | false | Enable automatic database backups |
| `CLAUDE_DB_BACKUP_INTERVAL_HOURS` | 6 | Hours between backups |
| `CLAUDE_DB_BACKUP_DIR` | ./data/backups | Backup directory (required when backup is enabled) |
| `CLAUDE_DB_BACKUP_RETAIN` | 3 | Number of backup files to retain |

## GitHub Integration

| Variable | Default | Description |
|----------|---------|-------------|
| `GITHUB_REPO` | - | Default repo for issue creation (`owner/repo` format) |
| `GITHUB_REPOS` | - | Available repos with descriptions (`repo:description` pairs, comma-separated) |
| `GITHUB_DEFAULT_LABELS` | - | Labels always applied to created issues (comma-separated) |

Requires `gh` CLI installed and authenticated. See [Claude AI](claude-ai.md#github-tools) for tool details.

## Web Server

| Variable | Default | Description |
|----------|---------|-------------|
| `WEB_ENABLED` | false | Set to `true` to enable web UI |
| `WEB_PORT` | 8080 | HTTP port to listen on |
| `WEB_BASE_URL` | - | Base URL for links (e.g., `http://nautilus.local:8080`) |
| `WEB_AUTH_TOKEN` | - | HMAC signing secret + emergency admin login (min 16 chars) |
| `WEB_LINK_TOKEN_TTL_MINUTES` | 15 | How long HMAC link tokens are valid |
| `WEB_SESSION_TTL_HOURS` | 72 | Session lifetime in hours |

Generate the signing secret: `openssl rand -hex 16`

See [Web UI](web-ui.md) for features and authentication details.

## System

| Variable | Default | Description |
|----------|---------|-------------|
| `DOCKER_SOCKET` | /var/run/docker.sock | Docker socket path |

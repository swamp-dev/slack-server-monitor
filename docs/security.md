# Security Architecture

This bot is **read-only by design**. It cannot restart services, execute commands inside containers, modify files, or delete anything.

## Read-Only Enforcement

Security is enforced at multiple layers:

### 1. Command Allowlist (`src/utils/shell.ts`)

- Only specific binaries can be executed
- Subcommands are validated (e.g., `docker` only allows `ps`, `inspect`, `logs`, `network`, `images`, `version`, `info`)
- Sensitive paths are blocked (`/.ssh`, `/.gnupg`, `/.aws`, `.env`, etc.)
- No shell interpolation -- uses `execFile()` with `shell: false`

### 2. Input Sanitization (`src/utils/sanitize.ts`)

- All user input validated with Zod schemas
- Shell metacharacters rejected (`;`, `|`, `&`, `` ` ``, `$()`, etc.)
- Service names: alphanumeric, hyphens, underscores only
- Line counts: positive integers, max 500

### 3. Log Scrubbing (`src/formatters/scrub.ts`)

Sensitive data is automatically redacted before sending to Slack:
- Passwords and secrets
- API keys and tokens
- Private keys
- Database connection strings
- Credit card numbers

**Warning:** Automatic scrubbing cannot catch everything. Review what your services log.

### 4. Access Control

- **User allowlist** -- only Slack user IDs in `AUTHORIZED_USER_IDS` can run commands
- **Channel restrictions** -- optionally limit to specific channels via `AUTHORIZED_CHANNEL_IDS`
- **Rate limiting** -- default 10 commands per minute per user
- **Silent rejection** -- unauthorized users get no response (no information leakage)

### 5. Audit Logging

All commands logged with user, channel, and timestamp. Configure `AUDIT_LOG_PATH` for file logging.

## Claude AI Security

The `/ask` command tools follow the same read-only model:

- **Tools are read-only** -- same allowlist as direct commands
- **File reading restricted** -- only paths in `CLAUDE_ALLOWED_DIRS` (symlinks resolved before validation)
- **Tool outputs scrubbed** -- all results pass through the same scrubbing as direct commands
- **Context directory isolation** -- cannot be under system paths (`/etc`, `/var`, `/usr`, etc.)
- **Tool call limits** -- max 100 tool calls per turn, max 50 agentic iterations (prevents infinite loops)
- **Conversation storage** -- stored in SQLite, auto-cleaned after `CLAUDE_CONVERSATION_TTL_HOURS`
- **Tool call analytics** -- duration and success/failure tracked per call for diagnostics

## Web UI Security

- **HMAC-signed link tokens** -- short-lived (default: 15 minutes), leaked URLs expire quickly
- **No static per-user tokens** -- the bot signs tokens using the user's Slack identity
- **Session cookies** -- HttpOnly + SameSite=Lax (+ Secure flag for HTTPS base URLs)
- **Timing-safe comparison** -- HMAC signatures verified with constant-time comparison
- **Session management** -- stored in SQLite, cleaned up hourly, re-login invalidates prior sessions
- **`WEB_AUTH_TOKEN`** -- serves as both signing key and emergency admin credential. Keep it secret.

## Plugin Security

Plugins run with **full process privileges**. Only install plugins from trusted sources.

**What plugins can do:**
- Access all environment variables
- Execute arbitrary code
- Make network requests
- Access the filesystem
- Store data in the shared SQLite database

**Defense-in-depth measures:**
- **Table isolation** -- plugins can only access `plugin_{name}_*` tables
- **Tool namespacing** -- plugin tools are prefixed (`pluginname:toolname`) to prevent collisions
- **Tool validation** -- names, schemas, and execute functions checked at load time
- **Atomic loading** -- if any step fails, the entire plugin is skipped
- **Lifecycle timeouts** -- `init()` has 10s timeout, `destroy()` has 5s timeout

See [Plugins](plugins.md#security) for writing secure plugins.

## Operational Warnings

1. **Log data may contain secrets** -- automatic scrubbing is not foolproof
2. **Slack stores messages** -- don't use in channels with untrusted members
3. **Audit log regularly** -- check who's running what commands
4. **Keep user list minimal** -- only add trusted team members
5. **Claude tools are read-only** -- but tool output scrubbing isn't perfect
6. **File reading is restricted** -- but the restriction is only as good as `CLAUDE_ALLOWED_DIRS`
7. **Conversations stored in SQLite** -- auto-cleaned, but accessible until TTL expires
8. **Container logs are particularly risky** -- application logs often contain passwords, tokens, and PII

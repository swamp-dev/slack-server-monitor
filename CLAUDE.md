# Slack Server Monitor

A TypeScript Slack bot using Socket Mode for **read-only** home server monitoring and diagnostics.

## Architecture

```
Home Server ──(outbound WebSocket)──> Slack API
     │
     └── No exposed ports, no public URL needed
```

This bot uses Slack's Socket Mode, meaning it connects **outbound** to Slack via WebSocket. No ports need to be exposed, no public URL required. Safe for home servers behind NAT/firewalls.

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
│   ├── context-store.ts      # SQLite storage for channel context
│   ├── user-config.ts        # Per-user config from ~/.claude/
│   ├── context-loader.ts     # Load CLAUDE.md and .claude/context/ from context dir
│   ├── providers/
│   │   ├── index.ts          # Provider factory
│   │   ├── types.ts          # Provider type definitions
│   │   ├── api-provider.ts   # Anthropic SDK backend
│   │   └── cli-provider.ts   # Claude CLI backend
│   └── tools/
│       ├── index.ts          # Tool router
│       ├── types.ts          # Tool type definitions
│       ├── server-tools.ts   # Container, system, network tools
│       └── file-tools.ts     # File reading with path validation
├── executors/
│   └── *.ts                  # Shell command wrappers
├── formatters/
│   ├── blocks.ts             # Slack Block Kit builders
│   └── scrub.ts              # Sensitive data scrubber
├── utils/
│   ├── shell.ts              # SECURE shell execution
│   ├── sanitize.ts           # Input sanitization
│   └── logger.ts             # Winston logger
└── types/
    └── index.ts              # TypeScript interfaces
```

## Commands

| Command | Description |
|---------|-------------|
| `/services` | All container states |
| `/services <svc>` | Detailed container info |
| `/logs <svc> [n]` | Last n lines of logs (max 500) |
| `/resources` | CPU, memory, disk, swap |
| `/disk` | Per-mount disk usage |
| `/network` | Docker networks |
| `/security` | fail2ban jail status and ban counts |
| `/security <jail>` | Detailed jail info with banned IPs |
| `/ssl` | Check SSL certificates for configured domains |
| `/ssl <domain>` | Check specific domain SSL certificate |
| `/backups` | Local and S3 backup status |
| `/pm2` | PM2 process list with status and resource usage |
| `/ask <question>` | Ask Claude AI about your server (requires `ANTHROPIC_API_KEY` or Claude CLI) |
| `/context` | View/switch Claude context directory for this channel |

### Claude AI Integration

The `/ask` command provides AI-powered server diagnostics. Claude has access to tools that query server state on-demand:

- **get_container_status** - Check container states and details
- **get_container_logs** - View recent logs (auto-scrubbed)
- **get_system_resources** - CPU, memory, swap, load average
- **get_disk_usage** - Disk space per mount point
- **get_network_info** - Docker networks
- **read_file** - Read config files from allowed directories
- **run_command** - Execute read-only shell commands (see below)

Thread replies continue the conversation with context preserved.

**Security:** All tool outputs are scrubbed for secrets. File reading validates paths against `CLAUDE_ALLOWED_DIRS` and follows symlinks to prevent directory traversal.

### run_command Tool

The `run_command` tool allows Claude to execute read-only diagnostic commands:

| Category | Commands |
|----------|----------|
| **Docker** | docker (ps, inspect, logs, network, images, version, info) |
| **System** | free, df, top, stat, uptime, hostname, uname, date, id |
| **Process** | ps, pgrep |
| **Systemd** | systemctl (status, show, list-units, is-active), journalctl |
| **Network** | ss, ip, ping, curl (GET only), dig, host, netstat |
| **Files** | cat, ls, head, tail, find, grep, wc, file, du |
| **Security** | fail2ban-client (status), openssl |

**Restrictions:**
- Systemctl: Only read-only subcommands (no start/stop/restart)
- Curl: No POST/PUT/upload flags
- File commands: Restricted to allowed directories, blocks sensitive paths (SSH keys, credentials, .env files)

## Security Architecture

### 1. Command Allowlist (`src/utils/shell.ts`)
- Only specific commands can be executed
- Subcommands are validated (docker, systemctl, curl, etc.)
- Sensitive paths are blocked (/.ssh, /.gnupg, /.aws, .env, etc.)
- No shell interpolation - uses `execFile()` with `shell: false`

### 2. Input Sanitization (`src/utils/sanitize.ts`)
- All user input validated with Zod schemas
- Shell metacharacters rejected (`;`, `|`, `&`, `` ` ``, `$()`, etc.)

### 3. Log Scrubbing (`src/formatters/scrub.ts`)
- Passwords, tokens, API keys automatically redacted before sending to Slack
- WARNING: Cannot catch all sensitive data - use with caution

### 4. Access Control
- User ID allowlist in `AUTHORIZED_USER_IDS`
- Optional channel restrictions in `AUTHORIZED_CHANNEL_IDS`
- Silent rejection for unauthorized users
- Rate limiting (default: 10 cmd/min/user)

### 5. Audit Logging
- All commands logged with user, channel, timestamp
- Configure `AUDIT_LOG_PATH` for file logging

## Development

```bash
# Install dependencies
npm install

# Run in development (with hot reload)
npm run dev

# Run tests
npm test

# Type check
npm run typecheck

# Lint
npm run lint

# Build for production
npm run build
```

## Configuration

Copy `.env.example` to `.env` and configure:

```bash
# Required
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
AUTHORIZED_USER_IDS=U01ABC123,U02DEF456

# Optional
AUTHORIZED_CHANNEL_IDS=C01ABC123
MONITORED_SERVICES=wordpress,nginx,n8n
SSL_DOMAINS=example.com,app.example.com

# Claude AI (optional - enables /ask command)
# Option 1: Use Anthropic API
ANTHROPIC_API_KEY=sk-ant-...

# Option 2: Use Claude CLI (no API key needed)
CLAUDE_BACKEND=cli

CLAUDE_ALLOWED_DIRS=/root/ansible,/opt/stacks,/etc/docker
CLAUDE_DAILY_TOKEN_LIMIT=100000
```

### Claude Configuration Details

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUDE_BACKEND` | auto | Backend: `api` (SDK), `cli` (Claude Code), `auto` (prefer API) |
| `ANTHROPIC_API_KEY` | - | API key for `api` backend |
| `CLAUDE_MODEL` | claude-sonnet-4-20250514 | Claude model for API backend |
| `CLAUDE_CLI_PATH` | claude | Path to Claude CLI executable |
| `CLAUDE_CLI_MODEL` | sonnet | Model alias for CLI backend (sonnet/opus/haiku) |
| `CLAUDE_ALLOWED_DIRS` | - | Comma-separated paths Claude can read files from |
| `CLAUDE_MAX_TOKENS` | 2048 | Max tokens per response |
| `CLAUDE_MAX_TOOL_CALLS` | 40 | Max tool calls per turn (prevents loops) |
| `CLAUDE_MAX_ITERATIONS` | 50 | Max agentic loop iterations (defense in depth) |
| `CLAUDE_RATE_LIMIT_MAX` | 5 | Requests per window per user |
| `CLAUDE_DAILY_TOKEN_LIMIT` | 100000 | Daily token budget (API backend only) |
| `CLAUDE_DB_PATH` | ./data/claude.db | SQLite database for conversations |
| `CLAUDE_CONTEXT_DIR` | - | Directory containing infrastructure context (see below) |
| `CLAUDE_CONTEXT_OPTIONS` | - | Comma-separated alias:path pairs for context switching |

### Backend Options

**API Backend (`CLAUDE_BACKEND=api`)**
- Uses Anthropic SDK with direct API calls
- Requires `ANTHROPIC_API_KEY`
- Tracks token usage for daily budgets
- Recommended for production use

**CLI Backend (`CLAUDE_BACKEND=cli`)**
- Uses Claude Code CLI (`claude -p --print`)
- Requires Claude CLI installed and authenticated
- Does NOT track token usage (daily budgets don't apply)
- Useful when you have Claude Code subscription but no API key
- May be slower (subprocess spawning overhead)

**Auto Backend (`CLAUDE_BACKEND=auto`, default)**
- Uses API if `ANTHROPIC_API_KEY` is set
- Falls back to CLI if no API key

### Context Directory

Set `CLAUDE_CONTEXT_DIR` to a directory containing infrastructure documentation. Claude will automatically read and include:

- **`CLAUDE.md`** in the root - Main context about your infrastructure
- **`.claude/context/`** - Additional context files (.md, .txt, .yaml, .yml, .json)

This directory is automatically added to `CLAUDE_ALLOWED_DIRS` so Claude can read and reference files there.

**Security:** Context directory cannot be under system paths (`/etc`, `/var`, `/usr`, etc.) and symlinks are resolved before validation. Use a dedicated directory - Claude gains read access to ALL files within it.

**Example structure:**
```
/opt/infrastructure/
├── CLAUDE.md                    # Main infrastructure overview
└── .claude/
    └── context/
        ├── services.yaml        # Service configurations
        ├── networking.md        # Network topology
        └── runbooks.md          # Common procedures
```

**Example CLAUDE.md:**
```markdown
## Home Server Infrastructure

### Services
- nginx: reverse proxy on port 80/443
- n8n: workflow automation on port 5678
- wordpress: blog at /opt/stacks/wordpress

### Key Files
- Ansible inventory: /root/ansible/inventory.yml
- Docker stacks: /opt/stacks/
```

### Per-Channel Context Switching

If you manage multiple environments (e.g., homelab and production), you can configure multiple context directories and switch between them per-channel using the `/context` command.

**Configuration:**

Set `CLAUDE_CONTEXT_OPTIONS` with alias:path pairs:
```bash
CLAUDE_CONTEXT_OPTIONS=homelab:/opt/homelab,infra:/opt/infrastructure,ansible:/root/ansible
```

**Usage:**

| Command | Description |
|---------|-------------|
| `/context` | Show current context and available options |
| `/context set <alias>` | Set context for this channel |
| `/context clear` | Clear context (use default) |

Context is stored per-channel in the SQLite database. Each channel can have a different context, allowing you to organize conversations by environment.

### Per-User Configuration

Users can customize Claude behavior via `~/.claude/`:

**`~/.claude/server-prompt.md`** - Additional context added to system prompt:
```markdown
## My Server Context
- Main server: homelab running Docker
- Key services: nginx, n8n, wordpress
- Ansible inventory at ~/ansible/inventory.yml
```

**`~/.claude/server-config.json`** - Tool restrictions:
```json
{
  "allowedDirs": ["/home/user/ansible"],
  "disabledTools": ["read_file"],
  "maxLogLines": 100
}
```

## Testing Conventions

- Tests in `tests/` directory, mirroring `src/` structure
- Use Vitest with `describe/it/expect`
- Security tests are critical - see `tests/utils/shell.test.ts`
- Run `npm test` before committing

## Deployment

### PM2 (Recommended)
```bash
npm run build
pm2 start ecosystem.config.cjs
pm2 save
```

### Docker
```bash
docker build -t slack-monitor .
docker run -d --env-file .env -v /var/run/docker.sock:/var/run/docker.sock:ro slack-monitor
```

## Security Warnings

1. **Log data may contain secrets** - automatic scrubbing is not foolproof
2. **Slack stores messages** - don't use in channels with untrusted members
3. **Audit log regularly** - check who's running what commands
4. **Keep user list minimal** - only add trusted team members

### Claude AI Security

5. **Claude tools are read-only** - same security model as direct commands
6. **File reading is restricted** - only paths in `CLAUDE_ALLOWED_DIRS` (symlink-safe)
7. **Tool outputs are scrubbed** - but scrubbing isn't perfect
8. **Conversations stored in SQLite** - auto-cleaned after `CLAUDE_CONVERSATION_TTL_HOURS`
9. **Daily token limits** - prevents runaway API costs (API backend only)
10. **Tool call limits** - prevents infinite loops (default: max 40 tools per turn, max 50 iterations)
11. **CLI backend limitations** - no token tracking, daily budgets don't apply

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
│   ├── claude.ts             # Claude API client with tool handling
│   ├── conversation-store.ts # SQLite storage for conversations
│   ├── user-config.ts        # Per-user config from ~/.claude/
│   ├── context-loader.ts     # Load CLAUDE.md and .claude/context/ from context dir
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
| `/status` | All container states |
| `/status <svc>` | Detailed container info |
| `/logs <svc> [n]` | Last n lines of logs (max 500) |
| `/resources` | CPU, memory, disk, swap |
| `/disk` | Per-mount disk usage |
| `/security` | fail2ban status |
| `/ssl` | Certificate expiration |
| `/backups` | Backup status |
| `/pm2` | PM2 process list |
| `/network` | Docker networks |
| `/ask <question>` | Ask Claude AI about your server (requires `ANTHROPIC_API_KEY`) |

### Claude AI Integration

The `/ask` command provides AI-powered server diagnostics. Claude has access to tools that query server state on-demand:

- **get_container_status** - Check container states and details
- **get_container_logs** - View recent logs (auto-scrubbed)
- **get_system_resources** - CPU, memory, swap, load average
- **get_disk_usage** - Disk space per mount point
- **get_network_info** - Docker networks
- **read_file** - Read config files from allowed directories

Thread replies continue the conversation with context preserved.

**Security:** All tool outputs are scrubbed for secrets. File reading validates paths against `CLAUDE_ALLOWED_DIRS` and follows symlinks to prevent directory traversal.

## Security Architecture

### 1. Command Allowlist (`src/utils/shell.ts`)
- Only specific commands can be executed (docker, free, df, etc.)
- Docker subcommands are restricted to read-only (ps, inspect, logs)
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
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_ALLOWED_DIRS=/root/ansible,/opt/stacks,/etc/docker
CLAUDE_DAILY_TOKEN_LIMIT=100000
```

### Claude Configuration Details

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | - | Required to enable `/ask` command |
| `CLAUDE_MODEL` | claude-sonnet-4-20250514 | Claude model to use |
| `CLAUDE_ALLOWED_DIRS` | - | Comma-separated paths Claude can read files from |
| `CLAUDE_MAX_TOKENS` | 2048 | Max tokens per response |
| `CLAUDE_MAX_TOOL_CALLS` | 10 | Max tool calls per turn (prevents loops) |
| `CLAUDE_RATE_LIMIT_MAX` | 5 | Requests per window per user |
| `CLAUDE_DAILY_TOKEN_LIMIT` | 100000 | Daily token budget (cost control) |
| `CLAUDE_DB_PATH` | ./data/claude.db | SQLite database for conversations |
| `CLAUDE_CONTEXT_DIR` | - | Directory containing infrastructure context (see below) |

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
9. **Daily token limits** - prevents runaway API costs
10. **Tool call limits** - prevents infinite loops (max 10 tools per turn, max 20 iterations)

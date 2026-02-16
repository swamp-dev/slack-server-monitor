# Slack Server Monitor

A **read-only** Slack bot for home server monitoring and diagnostics using Socket Mode.

## Features

- **Socket Mode** - No exposed ports, no public URL needed. Connects outbound via WebSocket.
- **Read-Only** - Cannot modify, restart, or execute commands. Only observes.
- **Secure by Design** - Command allowlists, input sanitization, log scrubbing.
- **Docker Integration** - Monitor containers, logs, networks.
- **System Monitoring** - CPU, memory, disk, swap usage.
- **Claude AI Integration** - Optional AI-powered diagnostics with `/ask` command.

## Security Notice

> **This bot provides read-only access to server diagnostics. However:**
>
> 1. **Log data may contain sensitive information** - While automatic scrubbing is applied, it cannot catch all secrets. Review what services log before exposing via Slack.
>
> 2. **Slack messages are stored** - Commands and responses are retained in Slack's servers. Do not use in channels with untrusted members.
>
> 3. **Audit your authorized users** - Only add trusted team members to `AUTHORIZED_USER_IDS`.
>
> 4. **Container logs are particularly risky** - Application logs often contain passwords, tokens, and PII. Use `/logs` with caution.

## Commands

| Command | Description |
|---------|-------------|
| `/help` | Show all available commands |
| `/services` | List all Docker containers and their status |
| `/services <service>` | Detailed info for a specific container |
| `/logs <service> [lines]` | View container logs (default: 50, max: 500) |
| `/resources` | CPU, memory, swap overview |
| `/disk` | Disk usage per mount point |
| `/network` | Docker networks and port mappings |
| `/security` | fail2ban jail status and ban counts |
| `/security <jail>` | Detailed jail info with banned IPs |
| `/ssl` | Check SSL certificates for configured domains |
| `/ssl <domain>` | Check specific domain SSL certificate |
| `/backups` | Local and S3 backup status |
| `/pm2` | PM2 process list with status and resource usage |
| `/ask <question>` | Ask Claude AI about your server (requires Claude CLI) |
| `/context` | View/switch Claude context directory for this channel |
| `/sessions` | List recent Claude AI sessions (last 24h) |
| `/sessions <thread_ts>` | Detailed view of specific session |
| `/sessions mine` | Sessions initiated by current user |
| `/sessions stats` | Aggregate statistics |

## Quick Start

### 1. Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and create a new app
2. Enable **Socket Mode** in Settings > Socket Mode
3. Create an **App-Level Token** with `connections:write` scope
4. Add **Bot Token Scopes** under OAuth & Permissions:
   - `commands`
   - `chat:write`
5. **Enable Event Subscriptions** (required for `/ask` thread replies):
   - Go to **Event Subscriptions** in the left sidebar
   - Toggle **Enable Events** to ON
   - Under **Subscribe to bot events**, add:
     - `message.channels` - Messages in public channels
     - `message.groups` - Messages in private channels
     - `message.im` - Direct messages
   - Click **Save Changes**
6. Install the app to your workspace (reinstall if already installed)
7. Copy the **Bot User OAuth Token** (xoxb-...) and **App-Level Token** (xapp-...)

### 2. Register Slash Commands

In your Slack App settings, go to Slash Commands and add:

- `/help` - Show all available commands
- `/services` - Get server status
- `/logs` - View container logs
- `/resources` - System resources
- `/disk` - Disk usage
- `/network` - Network info
- `/security` - fail2ban status (optional)
- `/ssl` - SSL certificate status (optional)
- `/backups` - Backup status (optional)
- `/pm2` - PM2 process status (optional)
- `/ask` - Ask Claude AI (optional, requires API key or CLI)
- `/context` - Switch Claude context directory (optional)
- `/sessions` - Claude AI session history (optional)

### 3. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your values:

```bash
# Required
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token
AUTHORIZED_USER_IDS=U01ABC123,U02DEF456

# Optional
MONITORED_SERVICES=wordpress,nginx,n8n
SSL_DOMAINS=example.com,app.example.com
```

### 4. Install and Run

```bash
# Install dependencies
npm install

# Build
npm run build

# Run
npm start
```

## Development

```bash
# Run with hot reload
npm run dev

# Run tests
npm test

# Type check
npm run typecheck

# Lint
npm run lint
```

## Deployment

### PM2 (Recommended)

```bash
npm run build
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup  # Enable auto-start on boot
```

### Docker

```bash
docker build -t slack-monitor .
docker run -d \
  --name slack-monitor \
  --env-file .env \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  slack-monitor
```

### Systemd

Create `/etc/systemd/system/slack-monitor.service`:

```ini
[Unit]
Description=Slack Server Monitor
After=network.target docker.service

[Service]
Type=simple
User=slack-monitor
Group=docker
WorkingDirectory=/opt/slack-monitor
EnvironmentFile=/opt/slack-monitor/.env
ExecStart=/usr/bin/node dist/app.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable slack-monitor
sudo systemctl start slack-monitor
```

## Configuration Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SLACK_BOT_TOKEN` | Yes | - | Bot User OAuth Token (xoxb-...) |
| `SLACK_APP_TOKEN` | Yes | - | App-Level Token (xapp-...) |
| `AUTHORIZED_USER_IDS` | Yes | - | Comma-separated Slack user IDs |
| `AUTHORIZED_CHANNEL_IDS` | No | - | Restrict to specific channels |
| `RATE_LIMIT_MAX` | No | 10 | Max commands per window |
| `RATE_LIMIT_WINDOW_SECONDS` | No | 60 | Rate limit window |
| `MAX_LOG_LINES` | No | 50 | Default log lines (max 500) |
| `MONITORED_SERVICES` | No | - | Container prefixes to monitor |
| `SSL_DOMAINS` | No | - | Domains for SSL checks |
| `BACKUP_DIRS` | No | - | Local backup directories to check |
| `S3_BACKUP_BUCKET` | No | - | S3 bucket for backup status |
| `LOG_LEVEL` | No | info | debug/info/warn/error |
| `AUDIT_LOG_PATH` | No | - | File path for audit logs |

### Claude AI Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CLAUDE_ENABLED` | No | false | Set to "true" to enable Claude AI features |
| `CLAUDE_CLI_PATH` | No | claude | Path to Claude CLI executable |
| `CLAUDE_CLI_MODEL` | No | sonnet | Model alias for CLI (sonnet/opus/haiku) |
| `CLAUDE_ALLOWED_DIRS` | No | - | Directories Claude can read files from |
| `CLAUDE_CONTEXT_DIR` | No | - | Infrastructure context directory |
| `CLAUDE_CONTEXT_OPTIONS` | No | - | Comma-separated alias:path pairs for context switching |
| `CLAUDE_MAX_TOKENS` | No | 2048 | Max tokens per response |
| `CLAUDE_MAX_TOOL_CALLS` | No | 40 | Max tool calls per turn |
| `CLAUDE_MAX_ITERATIONS` | No | 50 | Max agentic loop iterations |
| `CLAUDE_RATE_LIMIT_MAX` | No | 5 | Claude requests per user per window |
| `CLAUDE_CONVERSATION_TTL_HOURS` | No | 24 | Conversation history retention |
| `CLAUDE_DB_PATH` | No | ./data/claude.db | SQLite database path |

Requires Claude CLI to be installed and authenticated.

## Security Architecture

### Read-Only Enforcement

All commands are **read-only**. The bot cannot:
- Restart, stop, or start containers
- Execute commands inside containers
- Modify files or configurations
- Delete anything

This is enforced at multiple levels:
1. **Command allowlist** - Only specific binaries can be executed
2. **Subcommand validation** - Docker only allows `ps`, `inspect`, `logs`, `network`
3. **No shell interpolation** - Uses `execFile()` with `shell: false`

See `src/utils/shell.ts` for the security implementation.

### Input Sanitization

All user input is validated before use:
- Service names: alphanumeric, hyphens, underscores only
- Line counts: positive integers, max 500
- Shell metacharacters are rejected

### Log Scrubbing

Before logs are sent to Slack, sensitive data is automatically redacted:
- Passwords and secrets
- API keys and tokens
- Private keys
- Database connection strings
- Credit card numbers

**Warning:** Automatic scrubbing cannot catch everything. Review what your services log.

### Access Control

- **User allowlist** - Only specified Slack user IDs can run commands
- **Channel restrictions** - Optionally limit to specific channels
- **Rate limiting** - Default 10 commands per minute per user
- **Audit logging** - All commands are logged with user and timestamp

## Claude AI Integration

The optional `/ask` command provides AI-powered server diagnostics. Claude has access to tools that query server state on-demand, enabling intelligent troubleshooting.

### Available Tools

| Tool | Description |
|------|-------------|
| `get_container_status` | Check container states and details |
| `get_container_logs` | View recent logs (auto-scrubbed) |
| `get_system_resources` | CPU, memory, swap, load average |
| `get_disk_usage` | Disk space per mount point |
| `get_network_info` | Docker networks |
| `read_file` | Read config files from allowed directories |

### Example Usage

```
/ask Why is nginx restarting frequently?
/ask What's using the most disk space?
/ask Check if the database container is healthy
```

Thread replies continue the conversation with context preserved.

### Context Directory

Set `CLAUDE_CONTEXT_DIR` to provide Claude with infrastructure documentation:

```
/opt/infrastructure/
├── CLAUDE.md              # Main context about your infrastructure
└── .claude/
    └── context/
        ├── services.md    # Service configurations
        └── runbooks.md    # Common procedures
```

### Security

- **Read-only tools** - Same security model as direct commands
- **Path validation** - File reading restricted to `CLAUDE_ALLOWED_DIRS` (symlink-safe)
- **System path blocking** - Context directory cannot be under `/etc`, `/var`, etc.
- **Output scrubbing** - All tool outputs scrubbed for secrets
- **Tool call limits** - Prevents infinite loops (max 40 per turn)

## Troubleshooting

### Thread Replies Not Working

If the bot responds to `/ask` commands but ignores thread replies, check the Slack App event subscriptions:

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Select your Slack Server Monitor app
3. Navigate to **Event Subscriptions** in the left sidebar
4. Ensure **Enable Events** is ON
5. Under **Subscribe to bot events**, add these events if missing:
   - `message.channels` - Messages in public channels
   - `message.groups` - Messages in private channels
   - `message.im` - Direct messages
6. Click **Save Changes**
7. **Reinstall the app** if prompted (required for scope changes)

To diagnose, set `LOG_LEVEL=debug` and check logs for "Message event received" entries.

### `/context` Command Shows "dispatch_failed"

This error occurs when the `/context` slash command is registered in Slack but the bot doesn't register a handler for it. The bot only registers the `/context` handler when `CLAUDE_CONTEXT_OPTIONS` is configured.

**Fix:** Add context options to your `.env`:

```bash
CLAUDE_CONTEXT_OPTIONS=homelab:/opt/homelab,gdrive:/mnt/storage/shares/family/GoogleDrive-Business
CLAUDE_ALLOWED_DIRS=/root/ansible,/opt/stacks,/mnt/storage/shares/family/GoogleDrive-Business
```

Then restart the bot:

```bash
pm2 restart slack-server-monitor
# or
docker restart slack-server-monitor
```

### Bot Not Responding to Commands

1. **Check authorization** - Ensure your Slack user ID is in `AUTHORIZED_USER_IDS`
2. **Check channel restrictions** - If `AUTHORIZED_CHANNEL_IDS` is set, commands only work in those channels
3. **Check rate limiting** - Default is 10 commands per minute per user
4. **Check logs** - Set `LOG_LEVEL=debug` for verbose output

## License

MIT

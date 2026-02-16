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
├── web/
│   ├── index.ts              # Web module exports
│   ├── server.ts             # Express HTTP server for long responses
│   └── templates.ts          # HTML templates for conversation pages
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
| `/help` | Show all available commands |
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
| `/ask <question>` | Ask Claude AI about your server (requires Claude CLI) |
| `/context` | View/switch Claude context directory for this channel |
| `/sessions` | List recent Claude AI sessions (last 24h) |
| `/sessions <thread_ts>` | Detailed view of specific session |
| `/sessions mine` | Sessions initiated by current user |
| `/sessions stats` | Aggregate statistics |

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
# Requires Claude CLI installed and authenticated
CLAUDE_ENABLED=true
CLAUDE_ALLOWED_DIRS=/root/ansible,/opt/stacks,/etc/docker
```

### Claude Configuration Details

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUDE_ENABLED` | false | Set to "true" to enable Claude AI features |
| `CLAUDE_CLI_PATH` | claude | Path to Claude CLI executable |
| `CLAUDE_CLI_MODEL` | sonnet | Model alias for CLI (sonnet/opus/haiku) |
| `CLAUDE_ALLOWED_DIRS` | - | Comma-separated paths Claude can read files from |
| `CLAUDE_MAX_TOKENS` | 2048 | Max tokens per response |
| `CLAUDE_MAX_TOOL_CALLS` | 40 | Max tool calls per turn (prevents loops) |
| `CLAUDE_MAX_ITERATIONS` | 50 | Max agentic loop iterations (defense in depth) |
| `CLAUDE_RATE_LIMIT_MAX` | 5 | Requests per window per user |
| `CLAUDE_DB_PATH` | ./data/claude.db | SQLite database for conversations |
| `CLAUDE_CONTEXT_DIR` | - | Directory containing infrastructure context (see below) |
| `CLAUDE_CONTEXT_OPTIONS` | - | Comma-separated alias:path pairs for context switching |

### Web Server for Long Responses

When Claude responses exceed Slack's text limit (3000 characters), the bot can host them on a local web server instead of truncating.

| Variable | Default | Description |
|----------|---------|-------------|
| `WEB_ENABLED` | false | Set to "true" to enable web server |
| `WEB_PORT` | 8080 | HTTP port to listen on |
| `WEB_BASE_URL` | - | Base URL for links (e.g., `http://nautilus.local:8080`) |
| `WEB_AUTH_TOKEN` | - | Required authentication token (min 16 characters) |

**How it works:**
1. When a Claude response exceeds 2900 characters, the bot posts a link instead
2. Users click the link to view the full response in their browser
3. The token is included in the URL for authentication

**Generate a token:**
```bash
openssl rand -hex 16
```

**Security:** The web server listens on `0.0.0.0` for local network access. The auth token is required to view any conversation. Keep the token secret.

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

## Plugin System

Extend the bot with custom slash commands and Claude AI tools via plugins.

### Creating a Plugin

1. Create `plugins.local/` directory (gitignored)
2. Add a `.ts` or `.js` file with a default export implementing the `Plugin` interface

```typescript
import type { Plugin, PluginContext } from '../src/plugins/index.js';

const myPlugin: Plugin = {
  name: 'my-plugin',
  version: '1.0.0',
  description: 'My custom plugin',

  // Register slash commands
  registerCommands(app) {
    app.command('/mycommand', async ({ ack, respond }) => {
      await ack();
      await respond('Hello from my plugin!');
    });
  },

  // Optional: Provide Claude AI tools
  tools: [
    {
      spec: {
        name: 'my_tool',
        description: 'Does something useful',
        input_schema: { type: 'object', properties: {} },
      },
      execute: async (input) => 'Tool result',
    },
  ],

  // Optional: Async initialization with database access
  init: async (ctx: PluginContext) => {
    // Create plugin tables using ctx.db (scoped to plugin_myname_*)
    ctx.db.exec(`
      CREATE TABLE IF NOT EXISTS ${ctx.db.prefix}data (
        id INTEGER PRIMARY KEY,
        value TEXT
      )
    `);
  },

  // Optional: Cleanup on shutdown
  destroy: async (ctx: PluginContext) => {
    // Cleanup resources
  },
};

export default myPlugin;
```

### Plugin Interface

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique identifier |
| `version` | Yes | Semver version |
| `description` | No | Help text |
| `registerCommands` | No | Function to register Slack commands |
| `tools` | No | Array of Claude AI tool definitions |
| `init` | No | Async setup hook with `PluginContext` (10s timeout) |
| `destroy` | No | Cleanup hook with `PluginContext` (5s timeout) |

### Plugin Database Access

Plugins can store persistent data via `PluginContext.db`. Tables are isolated per-plugin.

```typescript
init: async (ctx: PluginContext) => {
  // Create tables (prefix required - e.g., "plugin_myplugin_")
  ctx.db.exec(`
    CREATE TABLE IF NOT EXISTS ${ctx.db.prefix}entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      data TEXT,
      created_at INTEGER NOT NULL
    )
  `);
},
```

**In commands/tools:**
```typescript
// Insert
ctx.db.prepare(`INSERT INTO ${ctx.db.prefix}entries (user_id, data, created_at) VALUES (?, ?, ?)`)
  .run(userId, JSON.stringify(data), Date.now());

// Query
const rows = ctx.db.prepare(`SELECT * FROM ${ctx.db.prefix}entries WHERE user_id = ?`)
  .all(userId);

// Transaction (atomic)
ctx.db.transaction(() => {
  stmt1.run(...);
  stmt2.run(...);
});
```

**Notes:**
- Database: `./data/claude.db` (auto-created, shared with core)
- Isolation: Plugins can only access `plugin_{name}_*` tables
- Uses [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) - see docs for full API

### Plugin Security

**IMPORTANT:** Plugins run with full process privileges. Only install plugins from trusted sources.

#### Trust Model

Plugins can:
- Access all environment variables
- Execute arbitrary code
- Make network requests
- Access the filesystem
- Store persistent data in the shared SQLite database

The `PluginApp` wrapper and `PluginDatabase` provide defense-in-depth (validation, logging, table isolation) but **not true sandboxing**.

#### Tool Namespacing

Plugin tools are automatically namespaced to prevent collision with built-in tools:

| Plugin Name | Tool Name | Final Tool Name |
|-------------|-----------|-----------------|
| `lift` | `calculate_powerlifting_score` | `lift:calculate_powerlifting_score` |
| `weather` | `get_forecast` | `weather:get_forecast` |

This means Claude will see and call tools with the `pluginname:toolname` format.

#### Lifecycle Timeouts

| Hook | Timeout | Behavior on Timeout |
|------|---------|---------------------|
| `init()` | 10 seconds | Plugin not loaded |
| `destroy()` | 5 seconds | Warning logged, continues |

#### Atomic Loading

Plugin loading is atomic: if any step fails (validation, init, command registration), the entire plugin is skipped. This prevents partial registration issues.

#### Tool Validation

Before a plugin loads, its tools are validated:
- Tool names must be lowercase, start with a letter, 3-50 characters
- Tool names can only contain letters, numbers, and underscores
- Must have `description` and `input_schema.properties`
- Must have an `execute` function

Invalid tools cause the entire plugin to be rejected.

#### Writing Secure Plugins

1. **Validate all input** - Use Zod schemas for tool inputs
2. **Respect allowed directories** - Use `config.allowedDirs` for file access
3. **Don't store secrets** - Use environment variables
4. **Log appropriately** - Use `logger` from `../src/utils/logger.js`
5. **Handle errors gracefully** - Don't leak stack traces
6. **Test your plugin** - Write tests in `tests/plugins/`

### Example Plugin

See `plugins.example/lift.ts` for a complete example with:
- Slash command (`/lift`) with subcommands
- Claude AI tool integration
- Using Block Kit formatters

```bash
# To test the example plugin:
mkdir plugins.local
cp plugins.example/lift.ts plugins.local/
npm run dev
```

### Docker Deployment

When running in Docker, the `plugins.local/` directory must be mounted as a volume. The plugin loader looks for `/app/plugins.local/` inside the container.

**Manual Docker deployment:**
```bash
docker run -d \
  --env-file .env \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -v /path/to/plugins.local:/app/plugins.local:ro \
  slack-monitor
```

**Ansible deployment:**

If deploying via the `slack_monitor` Ansible role (in the parent `home-server-ansible` repo), plugins are automatically mounted when `slack_monitor_plugins_enabled: true` (the default). The role mounts:

```
{{ slack_monitor_source_path }}/plugins.local -> /app/plugins.local:ro
```

To add a plugin to an Ansible-managed deployment:
1. Add your plugin to `plugins.local/` in the source repo on the target server
2. Re-run the Ansible playbook or restart the container

**How it works:**

The plugin loader uses [jiti](https://github.com/unjs/jiti) to dynamically import TypeScript files at runtime without pre-compilation. This means:
- Plugins can be `.ts` or `.js` files
- No build step required for plugins
- Changes require a container restart to take effect

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
docker run -d \
  --env-file .env \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -v ./plugins.local:/app/plugins.local:ro \
  slack-monitor
```

**Note:** The `plugins.local` volume mount is required for plugins to work. See [Docker Deployment](#docker-deployment) in the Plugin System section for details.

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
9. **Tool call limits** - prevents infinite loops (default: max 40 tools per turn, max 50 iterations)

# Claude AI Integration

The `/ask` command provides AI-powered server diagnostics. Claude uses tools to query server state on-demand, enabling intelligent troubleshooting without manual command chaining.

## Requirements

- `CLAUDE_ENABLED=true` in `.env`
- Claude CLI installed and authenticated (`claude` in `$PATH`)
- See [Configuration](configuration.md#claude-ai) for all options

## How It Works

1. User sends `/ask why is nginx restarting?`
2. Claude receives the question with access to server monitoring tools
3. Claude calls tools as needed (check container status, read logs, etc.)
4. Claude synthesizes findings into a response posted to Slack
5. Thread replies continue the conversation with full context

If the response exceeds Slack's 3000-character limit and the [web server](web-ui.md) is enabled, the bot posts a link to the full response instead of truncating.

## Available Tools

### Server Monitoring

| Tool | Description |
|------|-------------|
| `get_container_status` | Check container states and details |
| `get_container_logs` | View recent logs (auto-scrubbed for secrets) |
| `search_container_logs` | Search container logs for a pattern with line numbers |
| `get_docker_images` | List Docker images with size and creation date |
| `get_system_resources` | CPU, memory, swap, load average |
| `get_disk_usage` | Disk space per mount point |
| `get_network_info` | Docker networks |
| `read_file` | Read config files from allowed directories |
| `run_command` | Execute read-only diagnostic commands (allowlisted) |

### GitHub Tools

Requires `gh` CLI installed and `GITHUB_REPO` or `GITHUB_REPOS` configured.

| Tool | Description |
|------|-------------|
| `create_github_issue` | Create an issue with investigation findings |
| `list_github_issues` | Search and list issues in a repository |
| `view_github_issue` | View details of a specific issue |

Claude will only create issues in repos listed in `GITHUB_REPOS`. See [Configuration](configuration.md#github-integration).

### `run_command` Allowlist

The `run_command` tool can execute these read-only commands:

| Category | Commands |
|----------|----------|
| **Docker** | docker (ps, inspect, logs, network, images, version, info) |
| **System** | free, df, top, stat, uptime, hostname, uname, whoami, date, id |
| **Process** | ps, pgrep |
| **Systemd** | systemctl (status, show, list-units, list-unit-files, list-sockets, list-timers, list-dependencies, is-active, is-enabled, is-failed, cat), journalctl |
| **Network** | ss, ip, ping, curl (GET only), dig, host, netstat |
| **Files** | cat, ls, head, tail, find, grep, wc, file, du |
| **Security** | fail2ban-client (status, banned), openssl |
| **Cloud** | aws (s3 ls) |
| **Process Managers** | pm2 |

**Restrictions:**
- Systemctl: Only read-only subcommands (no start/stop/restart/enable/disable)
- Curl: GET only -- blocks `-X`, `-d`, `-F`, `-o`, `-T` and other write/upload flags
- File commands: Restricted to allowed directories, blocks sensitive paths (SSH keys, credentials, .env files)
- AWS: Only `s3 ls` (read-only bucket listing)

## Context Directories

Provide Claude with infrastructure knowledge by pointing to a directory with documentation.

### Default Context

Set `CLAUDE_CONTEXT_DIR` to a directory containing:

- **`CLAUDE.md`** in the root -- main context about your infrastructure
- **`.claude/context/`** -- additional context files (`.md`, `.txt`, `.yaml`, `.yml`, `.json`)

```
/opt/infrastructure/
├── CLAUDE.md                    # Main infrastructure overview
└── .claude/
    └── context/
        ├── services.yaml        # Service configurations
        ├── networking.md        # Network topology
        └── runbooks.md          # Common procedures
```

The context directory is automatically added to `CLAUDE_ALLOWED_DIRS`.

**Security:** Context directory cannot be under system paths (`/etc`, `/var`, `/usr`, etc.) and symlinks are resolved before validation. Claude gains read access to ALL files in this directory.

### Per-Channel Context Switching

For multiple environments, configure `CLAUDE_CONTEXT_OPTIONS` with `alias:path` pairs:

```bash
CLAUDE_CONTEXT_OPTIONS=homelab:/opt/homelab,infra:/opt/infrastructure,ansible:/root/ansible
```

Then use the `/context` command in Slack:

| Command | Description |
|---------|-------------|
| `/context` | Show current context and available options |
| `/context set <alias>` | Set context for this channel |
| `/context clear` | Clear context (use default) |

Context is stored per-channel in SQLite, so each channel can have a different context.

## Per-User Configuration

Users can customize Claude behavior by creating files in `~/.claude/` on the server:

**`~/.claude/server-prompt.md`** -- additional context added to the system prompt:

```markdown
## My Server Context
- Main server: homelab running Docker
- Key services: nginx, n8n, wordpress
- Ansible inventory at ~/ansible/inventory.yml
```

**`~/.claude/server-config.json`** -- tool restrictions:

```json
{
  "allowedDirs": ["/home/user/ansible"],
  "disabledTools": ["read_file"],
  "maxLogLines": 100
}
```

## Sessions

Conversations are stored in SQLite and retained for `CLAUDE_CONVERSATION_TTL_HOURS` (default: 24h).

| Command | Description |
|---------|-------------|
| `/sessions` | List recent sessions (last 24h) |
| `/sessions <thread_ts>` | Detailed view of a specific session |
| `/sessions mine` | Your sessions only |
| `/sessions stats` | Aggregate statistics |

Sessions are also viewable in the [web UI](web-ui.md) with full tool call details.

## Image Support

Attach an image URL with the `--image` flag:

```
/ask What food is this? --image https://files.slack.com/files-pri/T.../image.jpg
```

## Security

- All tools are **read-only** -- same security model as direct slash commands
- File reading restricted to `CLAUDE_ALLOWED_DIRS` (symlink-safe)
- All tool outputs are scrubbed for secrets before returning to Claude
- Tool call limits prevent infinite loops (default: max 100 per turn, max 50 iterations)
- Tool call duration and success/failure tracked for diagnostics

See [Security](security.md#claude-ai-security) for the full model.

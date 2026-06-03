# Command Reference

All commands require the user's Slack ID to be in `AUTHORIZED_USER_IDS`. If `AUTHORIZED_CHANNEL_IDS` is set, commands only work in those channels.

## Monitoring Commands

| Command | Description |
|---------|-------------|
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
| `/stats` | Usage statistics and system health summary |

## Claude AI Commands

These require `CLAUDE_ENABLED=true` and the Claude CLI installed.

| Command | Description |
|---------|-------------|
| `/ask <question> [--image <url>]` | Ask Claude AI about your server (attach an image with `--image`) |
| `/ask continue <thread_ts> [question]` | Resume a session in a new thread |
| `/context` | Show current context and available options |
| `/context set <alias>` | Set context directory for this channel |
| `/context clear` | Clear context (use default) |
| `/sessions` | List recent Claude AI sessions (last 24h) |
| `/sessions <thread_ts>` | Detailed view of specific session |
| `/sessions mine` | Sessions initiated by current user |
| `/sessions stats` | Aggregate statistics |

Thread replies to `/ask` responses continue the conversation with full context preserved.

### `/ask` Examples

```
/ask Why is nginx restarting frequently?
/ask What's using the most disk space?
/ask Check if the database container is healthy
/ask What food is this? --image https://files.slack.com/files-pri/T.../image.jpg
```

See [Claude AI Integration](claude-ai.md) for available tools and configuration.

## Web UI Commands

These require `WEB_ENABLED=true`.

| Command | Description |
|---------|-------------|
| `/weblogin` | Get a magic login link for the web UI |

## Administration Commands

| Command | Description |
|---------|-------------|
| `/user-admin list` | List all users |
| `/user-admin whoami` | Show your user record |
| `/user-admin add <SlackID> [admin]` | Add a user (admin only) |
| `/user-admin remove <SlackID>` | Deactivate a user — soft delete (admin only) |
| `/user-admin promote <SlackID>` | Promote to admin role (admin only) |
| `/user-admin demote <SlackID>` | Demote to regular user (admin only) |
| `/user-admin invite [admin] [ttl=72h]` | Create a web UI registration link (admin only) |

`list` and `whoami` are available to any authenticated user. All mutation subcommands require admin role.

## Utility Commands

| Command | Description |
|---------|-------------|
| `/help` | Show all available commands |

## Plugin Commands

Plugins in `plugins.local/` can register additional slash commands. Example plugins:

| Command | Description | Plugin |
|---------|-------------|--------|
| `/lift` | Powerlifting calculator and training tracker | lift |
| `/hue` | Philips Hue light control | hue |
| `/health` | Family health tracker | health |

See [Plugins](plugins.md) for creating custom commands.

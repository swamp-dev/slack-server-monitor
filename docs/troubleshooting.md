# Troubleshooting

Set `LOG_LEVEL=debug` in `.env` for verbose output. All issues below use the **Problem / Cause / Fix** format.

## Bot Not Responding to Commands

**Cause:** Authorization or configuration issue.

1. Check that your Slack user ID is in `AUTHORIZED_USER_IDS`
2. If `AUTHORIZED_CHANNEL_IDS` is set, commands only work in those channels
3. Check rate limiting -- default is 10 commands per minute per user
4. Check logs for errors: `LOG_LEVEL=debug`
5. Verify the bot is running and connected: look for `[Bolt] Connected to Slack` in logs

## Thread Replies Not Working

**Cause:** Missing event subscriptions in the Slack App.

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Select your app > **Event Subscriptions**
3. Ensure **Enable Events** is ON
4. Under **Subscribe to bot events**, add:
   - `message.channels`
   - `message.groups`
   - `message.im`
5. Click **Save Changes**
6. **Reinstall the app** if prompted (required for scope changes)

Look for `Message event received` in debug logs to confirm events are flowing.

## `/context` Shows "dispatch_failed"

**Cause:** The `/context` handler is only registered when `CLAUDE_CONTEXT_OPTIONS` is configured, but the slash command exists in Slack.

**Fix:** Add context options to `.env`:

```bash
CLAUDE_CONTEXT_OPTIONS=homelab:/opt/homelab,ansible:/root/ansible
CLAUDE_ALLOWED_DIRS=/root/ansible,/opt/homelab
```

Then restart the bot.

## Slash Command Shows "dispatch_failed"

**Cause:** The command is registered in Slack but the bot doesn't have a handler for it. This happens when a feature isn't enabled (e.g., `/weblogin` without `WEB_ENABLED=true`) or a plugin isn't loaded.

**Fix:** Either enable the feature in `.env`, load the plugin, or remove the slash command from Slack App settings.

## Claude AI: CLI Not Found

**Cause:** The `claude` binary is not in `$PATH` or not installed.

**Fix:** Install Claude CLI and verify:

```bash
which claude
claude --version
```

Or set the full path in `.env`:

```bash
CLAUDE_CLI_PATH=/usr/local/bin/claude
```

## Claude AI: Timeout Errors (Exit Code 143)

**Cause:** Complex queries with long conversation history exceed the CLI timeout.

The default is 20 minutes (1,200,000 ms). Increase if needed:

```bash
CLAUDE_CLI_TIMEOUT_MS=1800000  # 30 minutes (max: 3600000 = 1 hour)
```

## Claude AI: Rate Limited

**Cause:** Too many `/ask` requests in the rate limit window.

Default: 5 requests per 60 seconds per user. Check and adjust:

```bash
CLAUDE_RATE_LIMIT_MAX=10
CLAUDE_RATE_LIMIT_WINDOW_SECONDS=120
```

## Plugin Not Loading

**Cause:** Validation failure, init timeout, or code error.

Check logs for specific errors:

| Log message | Cause | Fix |
|-------------|-------|-----|
| "Plugin validation failed" | Invalid name, version, or tool spec | Check plugin `name` and `tools` definitions |
| "Plugin init timeout" | `init()` took > 10 seconds | Optimize init or check for blocking calls |
| "Tool name conflicts with built-in" | Tool name matches a core tool | Rename the tool |
| "Invalid tool name" | Name doesn't match `[a-z][a-z0-9_]{2,49}` | Fix the tool name |

Remember: loading is atomic -- if any step fails, the entire plugin is skipped.

## Web UI: Can't Log In

**Cause:** Token expired or `WEB_AUTH_TOKEN` misconfigured.

1. **Link expired** -- HMAC link tokens expire after `WEB_LINK_TOKEN_TTL_MINUTES` (default: 15). Run `/weblogin` for a fresh link.
2. **Token too short** -- `WEB_AUTH_TOKEN` must be at least 16 characters. Generate one: `openssl rand -hex 16`
3. **Emergency login** -- go to `/login` and enter `WEB_AUTH_TOKEN` directly.

## Web UI: Port Already in Use

**Cause:** Another process is using the configured port.

```bash
# Find what's using the port
ss -tlnp | grep :8080

# Change the port in .env
WEB_PORT=8081
```

## Database: SQLite Locked

**Cause:** Multiple processes accessing the same database file, or a crashed process holding a lock.

1. Check for duplicate bot instances: `ps aux | grep slack-monitor`
2. Kill stale processes
3. If using PM2: `pm2 list` to check for multiple instances

## Database: Backup Failures

**Cause:** Backup directory doesn't exist or permissions issue.

```bash
# Create backup directory
mkdir -p ./data/backups

# Check permissions
ls -la ./data/
```

Ensure `CLAUDE_DB_BACKUP_DIR` points to a writable directory.

## Docker: Permission Denied on Socket

**Cause:** The container user can't access `/var/run/docker.sock`.

**Fix:** Mount the socket as read-only (already in examples) and ensure the user is in the `docker` group:

```bash
# For systemd deployment
sudo usermod -aG docker slack-monitor
```

## Docker: Plugins Not Loading

**Cause:** `plugins.local/` not mounted as a volume.

The container expects plugins at `/app/plugins.local/`. Add the volume mount:

```bash
-v /path/to/plugins.local:/app/plugins.local:ro
```

## Services Command Shows No Containers

**Cause:** Docker socket not accessible or no containers running.

1. Verify Docker is running and has containers: `docker ps` on the host
2. Check Docker socket is accessible at the configured path (default: `/var/run/docker.sock`)
3. If using Docker deployment, ensure the socket is mounted as a volume

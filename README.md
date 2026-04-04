# Slack Server Monitor

A **read-only** Slack bot for home server monitoring and diagnostics using Socket Mode.

## Features

- **Socket Mode** -- Connects outbound via WebSocket. No exposed ports, no public URL needed.
- **Read-Only** -- Cannot modify, restart, or delete anything. Only observes.
- **Secure by Design** -- Command allowlists, input sanitization, log scrubbing.
- **Docker Monitoring** -- Container status, logs, networks, images.
- **System Monitoring** -- CPU, memory, disk, swap, SSL certificates, fail2ban.
- **Claude AI** -- Optional AI-powered diagnostics via `/ask` with tool-based investigation.
- **Web UI** -- Dashboard with server health, conversation history, notifications, themes.
- **Plugin System** -- Extend with custom commands, AI tools, web pages, and widgets.

## Security Notice

> **This bot provides read-only access to server diagnostics. However:**
>
> 1. **Log data may contain sensitive information** -- automatic scrubbing cannot catch all secrets.
> 2. **Slack stores messages** -- do not use in channels with untrusted members.
> 3. **Container logs are particularly risky** -- application logs often contain passwords, tokens, and PII.
> 4. **Keep your authorized user list minimal** -- only add trusted team members.

## Quick Start

### 1. Create a Slack App

Create an app at [api.slack.com/apps](https://api.slack.com/apps) with Socket Mode, `commands` + `chat:write` bot scopes, and event subscriptions. See the full [Setup Guide](docs/setup.md) for step-by-step instructions.

### 2. Configure

```bash
cp .env.example .env
npm run setup          # Interactive wizard (recommended)
```

Or edit `.env` manually -- see [Configuration Reference](docs/configuration.md).

### 3. Install and Run

```bash
npm install
npm run build
npm start
```

### 4. Verify

Type `/help` in Slack. You should see a list of available commands.

## Documentation

| Guide | Description |
|-------|-------------|
| **[Setup](docs/setup.md)** | Slack app creation, slash commands, first run verification |
| **[Configuration](docs/configuration.md)** | All environment variables |
| **[Commands](docs/commands.md)** | Full command reference with examples |
| **[Claude AI](docs/claude-ai.md)** | AI diagnostics, tools, context directories, sessions |
| **[Web UI](docs/web-ui.md)** | Dashboard, authentication, keyboard shortcuts, REST API |
| **[Plugins](docs/plugins.md)** | Extend with custom commands, tools, and web pages |
| **[Security](docs/security.md)** | Read-only enforcement, access control, scrubbing |
| **[Deployment](docs/deployment.md)** | PM2, Docker, systemd, Ansible |
| **[Troubleshooting](docs/troubleshooting.md)** | Common issues and fixes |
| **[Development](docs/developing.md)** | Dev workflow, testing, CI/CD, AgentBox |
| **[MCP Server](mcp/README.md)** | Claude Code integration via Model Context Protocol |

## Development

```bash
npm run dev             # Hot reload
npm test                # Run tests
npm run typecheck       # Type checking
npm run lint            # Linting
```

See [Development Guide](docs/developing.md) for testing conventions and CI/CD.

## License

MIT

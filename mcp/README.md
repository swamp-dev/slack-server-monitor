# Slack Server Monitor MCP Server

An MCP (Model Context Protocol) server that exposes the slack-server-monitor's read-only server monitoring tools to Claude Code.

## Overview

This MCP server provides Claude Code with 7 tools for monitoring a home server:

| Tool | Description |
|------|-------------|
| `get_container_status` | Docker container states and details |
| `get_container_logs` | Container logs (auto-scrubbed) |
| `get_system_resources` | CPU load, memory, swap, uptime |
| `get_disk_usage` | Filesystem usage per mount |
| `get_network_info` | Docker networks |
| `run_command` | Execute allowlisted read-only commands |
| `read_file` | Read files from allowed directories |

## Security Model

All security from the slack-server-monitor is preserved:

- **Command allowlist**: Only 30+ read-only diagnostic commands allowed
- **Subcommand validation**: Docker, systemctl, curl restricted to safe operations
- **Path validation**: File access restricted to configured directories
- **Symlink resolution**: Prevents symlink-based directory traversal
- **Output scrubbing**: Passwords, tokens, API keys automatically redacted

## Installation

```bash
# Navigate to the MCP server directory
cd home-server-ansible/slack-server-monitor-mcp

# Install dependencies (also installs slack-server-monitor deps)
npm install

# Build
npm run build
```

## Configuration

Set environment variables before starting:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MCP_ALLOWED_DIRS` | Yes | - | Comma-separated paths for `read_file` |
| `MCP_MAX_LOG_LINES` | No | 50 | Max lines for `get_container_logs` |
| `MCP_MAX_FILE_SIZE_KB` | No | 100 | Max file size for `read_file` |

Example:
```bash
export MCP_ALLOWED_DIRS=/root/ansible,/opt/stacks,/etc/docker
export MCP_MAX_LOG_LINES=100
```

## Usage with Claude Code

### Manual Configuration

Add to `~/.claude/mcp_servers.json`:

```json
{
  "mcpServers": {
    "server-monitor": {
      "command": "node",
      "args": ["/path/to/slack-server-monitor-mcp/build/index.js"],
      "env": {
        "MCP_ALLOWED_DIRS": "/root/ansible,/opt/stacks"
      }
    }
  }
}
```

### Testing with MCP Inspector

```bash
# Build first
npm run build

# Run inspector
MCP_ALLOWED_DIRS=/tmp npm run inspect
```

## Development

```bash
# Install dependencies
npm install

# Run in development mode (hot reload)
npm run dev

# Run tests
npm test

# Type check
npm run typecheck

# Lint
npm run lint
```

## Project Structure

```
slack-server-monitor-mcp/
├── src/
│   ├── index.ts           # MCP server entry point
│   ├── config.ts          # Environment config with Zod
│   └── tools/
│       └── index.ts       # Tool definitions + handlers
├── tests/
│   ├── tools/
│   │   ├── run-command.test.ts   # Security tests
│   │   └── read-file.test.ts     # Path validation tests
│   └── index.test.ts             # MCP protocol tests
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## Code Reuse

This MCP server imports directly from the sibling `slack-server-monitor` directory:

- **Executors**: Docker and system info functions
- **Security**: Command allowlist, path validation, shell execution
- **Scrubbing**: Sensitive data redaction

Both packages share the same security implementation to ensure consistency.

## Tools Reference

### get_container_status

Get status of all Docker containers or detailed info for a specific one.

```json
{
  "container_name": "optional-container-name"
}
```

### get_container_logs

Get recent logs from a container. Logs are automatically scrubbed.

```json
{
  "container_name": "nginx",
  "lines": 50
}
```

### get_system_resources

Get system resource usage (no parameters).

Returns: CPU load average, memory usage, swap usage, uptime.

### get_disk_usage

Get disk usage for all mounted filesystems (no parameters).

### get_network_info

List Docker networks (no parameters).

### run_command

Execute a read-only shell command.

```json
{
  "command": "systemctl",
  "args": ["status", "docker"]
}
```

**Allowed commands include**: docker, free, df, ps, systemctl, journalctl, ss, ip, ping, curl, grep, find, head, tail, cat, ls, and more.

**Restrictions**:
- Docker: only ps, inspect, logs, network, images, version, info
- Systemctl: only status, show, list-units, is-active, is-enabled
- Curl: GET only (no POST/PUT/upload)
- File commands: restricted to allowed directories

### read_file

Read a text file from allowed directories.

```json
{
  "path": "/opt/stacks/docker-compose.yml",
  "max_lines": 200
}
```

## License

MIT

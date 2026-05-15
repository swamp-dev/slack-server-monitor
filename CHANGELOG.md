# Changelog

All notable changes to this project will be documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.0.0] - 2026-04-04

### Added

#### Core Bot
- Slack Socket Mode connection (outbound WebSocket, no exposed ports)
- Read-only server monitoring: containers, logs, resources, disk, network
- fail2ban jail status and SSL certificate checks
- S3 and local backup monitoring
- PM2 process status
- Usage statistics and system health summary
- Command allowlist with subcommand validation (`src/utils/shell.ts`)
- Input sanitization with Zod schemas
- Automatic log scrubbing for secrets, tokens, and credentials
- User and channel authorization with rate limiting
- Audit logging

#### Claude AI Integration
- `/ask` command with tool-based investigation
- Thread conversation continuity with context preservation
- Server monitoring tools: container status, logs, log search, images, resources, disk, network
- File reading with path validation and symlink safety
- `run_command` tool with read-only command allowlist
- GitHub issue tools: create, list, view
- Context directory loading (`CLAUDE.md` + `.claude/context/`)
- Per-channel context switching via `/context` command
- Per-user configuration (`~/.claude/server-prompt.md`, `server-config.json`)
- Image support via `--image` flag
- Session history and statistics
- Tool call limits and analytics

#### Web UI
- Dashboard with server health cards (auto-refresh 60s)
- Conversation list with search, tabs, ownership filter
- Conversation detail with collapsible tool calls
- Star, tag, archive, copy, and Markdown export
- New conversation creation from web
- Notification center with bell icon and unread badges
- Dracula (default) and light themes with persistence
- Keyboard shortcut system (press `?` for list)
- Mobile responsive layout with hamburger menu
- HMAC-signed authentication with session cookies
- Emergency admin login at `/login`
- `/weblogin` Slack command for magic login links
- REST API for health, notifications, and quick links
- Per-user quick links / bookmarks on dashboard

#### Plugin System
- TypeScript/JavaScript plugin loading via jiti (no build step)
- Slash command registration
- Claude AI tool integration with automatic namespacing
- Scoped SQLite database access per plugin
- Claude API access for plugins
- Notification center integration
- Server-Sent Events (SSE) for real-time push
- Dashboard widget contributions
- Web route registration under `/p/{pluginName}/`
- Template helpers for themed plugin pages
- Atomic loading with validation and timeouts
- Example plugins: lift, health, hue, web-assistant, agentbox

#### MCP Server
- Model Context Protocol server for Claude Code integration
- Exposes read-only monitoring tools with same security model
- Standalone package in `mcp/`

#### Infrastructure
- CI pipeline: lint, typecheck, build, test, security audit
- Parent submodule auto-update workflow
- Interactive setup wizard (`npm run setup`)
- Docker and PM2 deployment support
- Ansible role in parent repo

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
│   └── schema.ts             # Zod validation schemas
├── middleware/
│   ├── authorize.ts          # User/channel authorization
│   ├── rate-limit.ts         # Rate limiting
│   └── audit-log.ts          # Command audit logging
├── commands/
│   ├── index.ts              # Command registration
│   └── *.ts                  # Individual command handlers
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

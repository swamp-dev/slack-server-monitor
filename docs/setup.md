# Setup Guide

## Prerequisites

- Node.js 20+
- A Slack workspace where you can install apps
- Docker (for monitoring containers)

## 1. Create a Slack App

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
7. Copy the **Bot User OAuth Token** (`xoxb-...`) and **App-Level Token** (`xapp-...`)

## 2. Register Slash Commands

In your Slack App settings, go to **Slash Commands** and add each command you want to use:

**Core commands:**

| Command | Description |
|---------|-------------|
| `/help` | Show all available commands |
| `/services` | Get server status |
| `/logs` | View container logs |
| `/resources` | System resources |
| `/disk` | Disk usage |
| `/network` | Network info |

**Optional commands** (only register if you use the feature):

| Command | Description | Requires |
|---------|-------------|----------|
| `/security` | fail2ban status | fail2ban installed |
| `/ssl` | SSL certificate status | `SSL_DOMAINS` configured |
| `/backups` | Backup status | `BACKUP_DIRS` configured |
| `/pm2` | PM2 process status | PM2 installed |
| `/stats` | Usage statistics | - |
| `/ask` | Ask Claude AI | `CLAUDE_ENABLED=true` |
| `/context` | Switch Claude context | `CLAUDE_CONTEXT_OPTIONS` configured |
| `/sessions` | Claude AI session history | `CLAUDE_ENABLED=true` |
| `/weblogin` | Web UI login link | `WEB_ENABLED=true` |

**Plugin commands** (only if using plugins):

| Command | Description | Plugin |
|---------|-------------|--------|
| `/lift` | Powerlifting calculator | lift |
| `/hue` | Philips Hue light control | hue |
| `/health` | Family health tracker | health |

## 3. Configure Environment

**Option A: Interactive Setup Wizard (recommended)**

```bash
npm run setup
```

The wizard walks through all configuration sections interactively and creates/updates your `.env` file.

**Option B: Manual configuration**

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

See [Configuration Reference](configuration.md) for all available variables.

### Finding Your Slack User ID

1. Open Slack
2. Click your profile picture
3. Click **Profile**
4. Click the **more** (three dots) menu
5. Select **Copy member ID**

## 4. Install and Run

```bash
npm install
npm run build
npm start
```

## 5. Verify It Works

After starting the bot, you should see in the logs:

```
[Bolt] Connected to Slack
```

Then in Slack:

1. Type `/help` in any channel the bot has access to
2. You should see a list of available commands
3. Try `/resources` to confirm the bot can read system metrics
4. If using Claude AI, try `/ask what containers are running?`

### If Something Goes Wrong

- **No response to commands** - Check that your user ID is in `AUTHORIZED_USER_IDS`
- **`dispatch_failed` error** - The slash command is registered in Slack but the bot doesn't handle it. Check your `.env` configuration for that feature.
- **Thread replies not working** - Verify event subscriptions are enabled (see step 1.5)

See [Troubleshooting](troubleshooting.md) for more.

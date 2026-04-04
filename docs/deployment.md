# Deployment

Three deployment options, plus Ansible automation.

## PM2 (Recommended)

PM2 provides process management with auto-restart and log rotation.

```bash
npm run build
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup  # Enable auto-start on boot
```

## Docker

```bash
docker build -t slack-monitor .
docker run -d \
  --name slack-monitor \
  --env-file .env \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  slack-monitor
```

**With plugins:**

```bash
docker run -d \
  --name slack-monitor \
  --env-file .env \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -v /path/to/plugins.local:/app/plugins.local:ro \
  slack-monitor
```

The `plugins.local` volume mount is required for plugins to work inside Docker. The plugin loader looks for `/app/plugins.local/` inside the container.

## Systemd

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

## Ansible

The parent `home-server-ansible` repo includes a `slack_monitor` role that automates:

- Submodule initialization and sync
- Claude CLI credential handling
- Docker image building
- Plugin installation (lift, health, hue, web-assistant)
- MCP server configuration
- Database backup configuration

The role is at `roles/slack_monitor/` in the parent repo with full configuration in `defaults/main.yml`.

Key role variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `slack_monitor_plugins_enabled` | true | Mount plugins.local/ volume |
| `slack_monitor_pull_latest` | false | Pull latest source on deploy |
| `slack_monitor_rebuild_on_change` | true | Rebuild Docker image on source changes |

To add a plugin to an Ansible-managed deployment:
1. Add the plugin file to `plugins.local/` on the target server
2. Re-run the Ansible playbook or restart the container

## Post-Deployment Verification

```bash
# Check deployment readiness
npm run deploy:check
```

This validates the build, environment, and dependencies are ready for production.

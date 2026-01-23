/**
 * PM2 Ecosystem Configuration
 *
 * Start: pm2 start ecosystem.config.cjs
 * Save: pm2 save
 * Reload: pm2 reload slack-monitor
 */
module.exports = {
  apps: [
    {
      name: 'slack-monitor',
      script: 'dist/app.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '200M',
      env: {
        NODE_ENV: 'production',
      },
      // Log configuration
      error_file: '/var/log/slack-monitor/error.log',
      out_file: '/var/log/slack-monitor/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      // Graceful shutdown
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 10000,
    },
  ],
};

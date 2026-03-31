// ecosystem.config.cjs — PM2 process definitions.
// A crash in one process never affects the others. The dashboard (4th app) is added later.

module.exports = {
  apps: [
    {
      // Cron-driven: run one cycle every 2 hours, then exit. PM2 restarts it on the schedule.
      name: 'orchestrator',
      script: 'src/core/run-once.js',
      cron_restart: '0 */2 * * *',
      autorestart: false,
      max_memory_restart: '500M',
      time: true,
    },
    {
      // Always-on Gmail reply watcher.
      name: 'imap-watcher',
      script: 'src/email/imap-watcher-run.js',
      autorestart: true,
      restart_delay: 5000,
      max_memory_restart: '300M',
      time: true,
    },
    {
      // Always-on daily digest scheduler.
      name: 'digest',
      script: 'src/notify/digest-run.js',
      autorestart: true,
      restart_delay: 5000,
      max_memory_restart: '200M',
      time: true,
    },
    {
      // Read-only monitoring dashboard (Next.js) on PORT 3000.
      name: 'dashboard',
      cwd: './ui',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3000',
      autorestart: true,
      restart_delay: 5000,
      max_memory_restart: '400M',
      env: { PORT: '3000' },
      time: true,
    },
  ],
};

// src/email/imap-watcher-run.js — PM2 entry for the always-on reply watcher.
import { startWatcher } from './imap-watcher.js';

startWatcher().catch((err) => {
  console.error('imap-watcher fatal:', err);
  process.exit(1);
});

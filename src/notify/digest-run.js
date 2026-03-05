// src/notify/digest-run.js — PM2 entry: start the digest scheduler and keep the process alive.
import { startDigestScheduler } from './digest.js';

startDigestScheduler();

// Keep-alive: node-cron holds a timer, but this makes the intent explicit for PM2.
setInterval(() => {}, 1 << 30);

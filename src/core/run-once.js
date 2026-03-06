// src/core/run-once.js — run exactly one cycle then exit (used by the PM2 cron process).
import logger from '../utils/logger.js';
import { runCycle } from './orchestrator.js';

runCycle()
  .then((res) => {
    logger.info('run-once finished', res.counts || {});
    process.exit(0);
  })
  .catch((err) => {
    logger.error('run-once failed', { error: err.message });
    process.exit(1);
  });

// src/utils/logger.js — winston logger.
// JSON daily-rotating file transport + colorized console. Default level: info.

import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

const LOG_DIR = join(process.cwd(), 'logs');
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

const level = process.env.LOG_LEVEL || 'info';

const fileTransport = new DailyRotateFile({
  dirname: LOG_DIR,
  filename: 'agent-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m',
  maxFiles: '14d',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
});

const consoleTransport = new winston.transports.Console({
  format: winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({ format: 'HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      const extra = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
      return `${timestamp} ${level}: ${message}${extra}`;
    })
  ),
});

const logger = winston.createLogger({
  level,
  transports: [fileTransport, consoleTransport],
});

export default logger;

/**
 * logger.ts — Structured logger (Pino)
 *
 * Single logger instance for the agent package.
 * In development: JSON to stdout (readable enough, no pino-pretty dep needed)
 * In production: JSON lines to stdout (structured, parseable by CasaOS/Docker)
 *
 * Usage:
 *   import { logger } from './logger.ts';
 *   logger.info({ channel: 'cli' }, 'Agent started');
 *   logger.error({ err }, 'Something failed');
 */

import pino from 'pino';

export const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  base: { service: 'makilab-agent' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

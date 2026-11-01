import type { Request, Response } from 'express';
import { logger } from '../lib/logger';
import { isDev } from '../config/env';

/** Minimal structured request logger (dev-friendly, no extra dependency). */
export function requestLogger(req: Request, res: Response, next: () => void): void {
  if (!isDev) {
    next();
    return;
  }
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
    logger.info('http', {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      ms: Math.round(ms),
      user: req.user?.username,
    });
  });
  next();
}

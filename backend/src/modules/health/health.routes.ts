import { Router } from 'express';
import { db } from '../../config/db';
import { toJalaliDateString } from '../../lib/jalali';

export const healthRouter = Router();

/** Liveness + database connectivity probe (public). */
healthRouter.get('/', async (_req, res) => {
  const startedAt = Date.now();
  let database: 'up' | 'down' = 'up';
  try {
    await db.$queryRaw`SELECT 1`;
  } catch {
    database = 'down';
  }
  res.status(database === 'up' ? 200 : 503).json({
    status: database === 'up' ? 'ok' : 'degraded',
    service: 'kpims-api',
    version: '0.1.0',
    database,
    dbLatencyMs: Date.now() - startedAt,
    jalaliToday: toJalaliDateString(new Date()),
    timestamp: new Date().toISOString(),
  });
});

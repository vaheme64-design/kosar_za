import { createApp } from './app';
import { env } from './config/env';
import { db } from './config/db';
import { logger } from './lib/logger';
import { startMrpScheduler } from './modules/mrp/mrp.service';

const app = createApp();
const server = app.listen(env.PORT, () => {
  logger.info(`KPIMS API listening on port ${env.PORT}`, { env: env.NODE_ENV });
  // phase 8 — in-process MRP scheduler: hourly tick, snapshot at most every
  // 24h; failures are logged and never affect request handling
  startMrpScheduler();
});

async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal} received — shutting down KPIMS API`);
  server.close(() => logger.info('HTTP server closed'));
  try {
    await db.$disconnect();
  } catch (err) {
    logger.error('error while disconnecting Prisma', { error: String(err) });
  }
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

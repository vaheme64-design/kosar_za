import { createApp } from './app';
import { env } from './config/env';
import { db } from './config/db';
import { logger } from './lib/logger';

const app = createApp();
const server = app.listen(env.PORT, () => {
  logger.info(`KPIMS API listening on port ${env.PORT}`, { env: env.NODE_ENV });
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

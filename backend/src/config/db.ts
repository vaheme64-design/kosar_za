import { PrismaClient } from '@prisma/client';
import { isDev } from './env';

/**
 * Single PrismaClient instance for the whole backend process.
 * The official balances and every production/inventory transaction are
 * processed through this client (server-side only — never in the frontend).
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: isDev ? ['warn', 'error'] : ['error'],
  });

if (isDev) globalForPrisma.prisma = db;

import type { PrismaClient, Prisma } from '@prisma/client';
import { db } from '../config/db';

type Client = PrismaClient | Prisma.TransactionClient;

export interface AuditEntry {
  userId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  changes?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Write an audit trail row. Audit logs are append-only; they never block the
 * main business flow (failures are logged, not thrown).
 */
export async function recordAudit(client: Client | null, entry: AuditEntry): Promise<void> {
  try {
    await (client ?? db).auditLog.create({
      data: {
        userId: entry.userId ?? undefined,
        action: entry.action,
        entityType: entry.entityType ?? undefined,
        entityId: entry.entityId ?? undefined,
        changes: entry.changes === undefined ? undefined : (entry.changes as object),
        ipAddress: entry.ipAddress ?? undefined,
        userAgent: entry.userAgent ?? undefined,
      },
    });
  } catch (err) {
    // audit must never break the request, but it must be visible in logs
    console.error('[audit] failed to write audit log', err);
  }
}

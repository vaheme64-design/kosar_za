import { Router } from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { db } from '../../config/db';
import { authenticate, requirePermission } from '../../middleware/auth';
import { ApiError } from '../../lib/http';
import { recordAudit } from '../../lib/audit';
import { decimalField, optionalTrimmed } from '../masterdata/masterdata.resources';

export const machinesRouter = Router();

machinesRouter.use(authenticate, requirePermission('capacity.view'));

const h =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next: NextFunction) => {
    fn(req, res).catch(next);
  };

/** Machine status change (operational lever — planning engine respects it). */
const statusSchema = z.object({
  status: z.enum(['ACTIVE', 'MAINTENANCE', 'BREAKDOWN', 'RETIRED']),
  notes: z.string().trim().max(2000).optional(),
});

machinesRouter.get(
  '/overview',
  h(async (_req, res) => {
    const [byStatus, byType, totalCapabilities, activeAssignments] = await Promise.all([
      db.machine.groupBy({ by: ['status'], _count: { _all: true } }),
      db.machine.groupBy({ by: ['machineType'], _count: { _all: true } }),
      db.machineCapability.count(),
      db.machineAssignment.count({ where: { status: { in: ['PLANNED', 'ACTIVE'] } } }),
    ]);
    res.json({
      byStatus: byStatus.map((s) => ({ status: s.status, count: s._count._all })),
      byType: byType.map((t) => ({ machineType: t.machineType, count: t._count._all })),
      totalCapabilities,
      activeAssignments,
    });
  }),
);

/**
 * Capacity overview per machine — honest computation:
 * - capacity hours/day come from the ACTIVE shift calendar (computed value);
 * - workload hours are ESTIMATED from remaining operation quantities ÷
 *   standard rate per hour (machine capability);
 * - when a standard rate is missing the estimate is reported as unknown —
 *   never silently assumed (rule from Phase 4/5).
 */
machinesRouter.get(
  '/capacity',
  h(async (_req, res) => {
    const [machines, shifts, openAssignments] = await Promise.all([
      db.machine.findMany({
        include: {
          capabilities: { include: { operation: { select: { code: true, nameFa: true } } } },
          _count: { select: { capabilities: true, dieCompatibilities: true } },
        },
        orderBy: { code: 'asc' },
      }),
      db.shift.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } }),
      db.machineAssignment.findMany({
        where: { status: { in: ['PLANNED', 'ACTIVE'] } },
        include: {
          machine: { select: { id: true, code: true } },
          operation: {
            select: {
              id: true,
              operationId: true,
              status: true,
              plannedQuantity: true,
              producedQuantity: true,
              operation: { select: { code: true, nameFa: true } },
              manufacturingOrder: { select: { moNumber: true } },
            },
          },
        },
      }),
    ]);

    // active shift calendar → hours per day (computed)
    const shiftHours = shifts.map((s) => {
      const [sh, sm] = s.startTime.split(':').map(Number);
      const [eh, em] = s.endTime.split(':').map(Number);
      let minutes = eh! * 60 + em! - (sh! * 60 + sm!);
      if (minutes <= 0) minutes += 24 * 60; // overnight shift
      return { id: s.id, code: s.code, nameFa: s.nameFa, hours: minutes / 60 };
    });
    const capacityHoursPerDay = shiftHours.reduce((sum, s) => sum + s.hours, 0);

    // remaining workload per machine (estimate)
    const assignmentsByMachine = new Map<string, typeof openAssignments>();
    for (const a of openAssignments) {
      const list = assignmentsByMachine.get(a.machineId) ?? [];
      list.push(a);
      assignmentsByMachine.set(a.machineId, list);
    }

    const rows = machines.map((m) => {
      const rateByOperation = new Map<string, number | null>();
      for (const cap of m.capabilities) {
        rateByOperation.set(cap.operationId, cap.standardRatePerHour ? Number(cap.standardRatePerHour) : null);
      }

      const assignments = (assignmentsByMachine.get(m.id) ?? []).map((a) => {
        const op = a.operation;
        const remaining = Math.max(0, Number(op.plannedQuantity) - Number(op.producedQuantity));
        const rate = rateByOperation.get(op.operationId) ?? null;
        const estimatedHours = rate && rate > 0 && op.status !== 'COMPLETED' ? remaining / rate : null;
        return {
          assignmentId: a.id,
          moNumber: op.manufacturingOrder.moNumber,
          operationCode: op.operation.code,
          operationNameFa: op.operation.nameFa,
          opStatus: op.status,
          remainingQuantity: remaining,
          standardRatePerHour: rate, // null → unknown (no capability rate)
          estimatedHours,
        };
      });

      const knownHours = assignments.reduce((sum, a) => sum + (a.estimatedHours ?? 0), 0);
      const unknownCount = assignments.filter((a) => a.estimatedHours === null).length;
      // utilization is only reported when there is something to measure AND
      // every open assignment has a reliable standard rate (no silent assumption)
      const utilizationPct =
        assignments.length > 0 && unknownCount === 0 && capacityHoursPerDay > 0 ? (knownHours / capacityHoursPerDay) * 100 : null;

      return {
        id: m.id,
        code: m.code,
        nameFa: m.nameFa,
        machineType: m.machineType,
        tonnage: m.tonnage,
        status: m.status,
        location: m.location,
        capabilityCount: m._count.capabilities,
        dieCount: m._count.dieCompatibilities,
        openAssignmentCount: assignments.length,
        estimatedWorkloadHours: knownHours,
        unknownRateCount: unknownCount,
        utilizationPct, // null → not reliable (missing standard rates)
        assignments,
      };
    });

    res.json({
      shifts: shiftHours,
      capacityHoursPerDay,
      capacityBasis: 'تقویم شیفت‌های فعال — ظرفیت اسمی، بدون احتساب توقفات برنامه‌ای',
      machines: rows,
    });
  }),
);

/** Machine detail: capabilities, compatible dies, recent assignments. */
machinesRouter.get(
  '/:id',
  h(async (req, res) => {
    const machine = await db.machine.findUnique({
      where: { id: String(req.params.id) },
      include: {
        capabilities: { include: { operation: { select: { code: true, nameFa: true } } } },
        dieCompatibilities: { include: { die: { select: { code: true, nameFa: true, status: true } } } },
      },
    });
    if (!machine) throw new ApiError(404, 'not found', 'ماشین یافت نشد');

    const recentAssignments = await db.machineAssignment.findMany({
      where: { machineId: machine.id },
      orderBy: { plannedStart: 'desc' },
      take: 20,
      include: {
        operation: {
          select: {
            status: true,
            plannedQuantity: true,
            producedQuantity: true,
            operation: { select: { code: true, nameFa: true } },
            manufacturingOrder: { select: { id: true, moNumber: true } },
          },
        },
        die: { select: { code: true, nameFa: true } },
        shift: { select: { code: true, nameFa: true } },
      },
    });

    res.json({ machine, recentAssignments });
  }),
);

/** Replace the full capability set of a machine (operation + standard rate). */
machinesRouter.put(
  '/:id/capabilities',
  requirePermission('capacity.manage'),
  h(async (req, res) => {
    const body = z
      .object({
        capabilities: z
          .array(
            z.object({
              operationId: z.string().uuid(),
              standardRatePerHour: decimalField,
              notes: optionalTrimmed(500),
            }),
          )
          .max(50),
      })
      .parse(req.body ?? {});

    const machine = await db.machine.findUnique({ where: { id: String(req.params.id) }, select: { id: true } });
    if (!machine) throw new ApiError(404, 'not found', 'ماشین یافت نشد');

    const operationIds = new Set<string>();
    for (const cap of body.capabilities) {
      if (operationIds.has(cap.operationId)) {
        throw new ApiError(400, 'duplicate operation', 'هر عملیات فقط یک‌بار در توانمندی‌های ماشین می‌تواند ثبت شود');
      }
      operationIds.add(cap.operationId);
    }
    const validOps = await db.operation.findMany({ where: { id: { in: [...operationIds] } }, select: { id: true } });
    if (validOps.length !== operationIds.size) {
      throw new ApiError(400, 'unknown operation', 'یک یا چند عملیات نامعتبر است');
    }

    const result = await db.$transaction(async (tx) => {
      await tx.machineCapability.deleteMany({ where: { machineId: machine.id } });
      if (body.capabilities.length > 0) {
        await tx.machineCapability.createMany({
          data: body.capabilities.map((c) => ({
            machineId: machine.id,
            operationId: c.operationId,
            standardRatePerHour: c.standardRatePerHour ?? null,
            notes: c.notes ?? null,
          })),
        });
      }
      return tx.machineCapability.findMany({
        where: { machineId: machine.id },
        include: { operation: { select: { code: true, nameFa: true } } },
        orderBy: { operation: { code: 'asc' } },
      });
    });

    await recordAudit(null, {
      userId: req.user?.id ?? null,
      action: 'UPDATE',
      entityType: 'machine_capabilities',
      entityId: machine.id,
      changes: { capabilities: body.capabilities } as object,
      ipAddress: req.ip ?? null,
    });

    res.json({ capabilities: result });
  }),
);

/** Replace the compatible-die set of a machine. */
machinesRouter.put(
  '/:id/dies',
  requirePermission('capacity.manage'),
  h(async (req, res) => {
    const body = z.object({ dieIds: z.array(z.string().uuid()).max(200) }).parse(req.body ?? {});

    const machine = await db.machine.findUnique({ where: { id: String(req.params.id) }, select: { id: true } });
    if (!machine) throw new ApiError(404, 'not found', 'ماشین یافت نشد');

    const result = await db.$transaction(async (tx) => {
      await tx.machineDieCompatibility.deleteMany({ where: { machineId: machine.id } });
      if (body.dieIds.length > 0) {
        await tx.machineDieCompatibility.createMany({
          data: [...new Set(body.dieIds)].map((dieId) => ({ machineId: machine.id, dieId })),
        });
      }
      return tx.machineDieCompatibility.findMany({
        where: { machineId: machine.id },
        include: { die: { select: { code: true, nameFa: true, status: true } } },
        orderBy: { die: { code: 'asc' } },
      });
    });

    await recordAudit(null, {
      userId: req.user?.id ?? null,
      action: 'UPDATE',
      entityType: 'machine_die_compatibility',
      entityId: machine.id,
      changes: { dieIds: body.dieIds } as object,
      ipAddress: req.ip ?? null,
    });

    res.json({ dies: result });
  }),
);

/** Direct machine status change (با ثبت در لاگ حسابرسی). */
machinesRouter.post(
  '/:id/status',
  requirePermission('capacity.manage'),
  h(async (req, res) => {
    const body = statusSchema.parse(req.body ?? {});
    const before = await db.machine.findUnique({ where: { id: String(req.params.id) }, select: { id: true, status: true } });
    if (!before) throw new ApiError(404, 'not found', 'ماشین یافت نشد');
    const machine = await db.machine.update({
      where: { id: before.id },
      data: { status: body.status, notes: body.notes },
    });
    await recordAudit(null, {
      userId: req.user?.id ?? null,
      action: 'STATUS_CHANGE',
      entityType: 'machine',
      entityId: before.id,
      changes: { before: before.status, after: body.status } as object,
      ipAddress: req.ip ?? null,
    });
    res.json({ machine });
  }),
);

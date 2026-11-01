import { Prisma, type OperationStatus } from '@prisma/client';
import { db } from '../../config/db';
import { ApiError } from '../../lib/http';
import { recordAudit } from '../../lib/audit';
import { generateDocumentNumber } from '../../services/documentNumber.service';
import {
  createMoSchema,
  createReportSchema,
  createTransferSchema,
} from './production.schemas';

const D = Prisma.Decimal;
type Tx = Prisma.TransactionClient;
type Dec = Prisma.Decimal;

const Q = (v: Prisma.Decimal | string | number | null | undefined): Dec => new D(v ?? 0);

// ---------------------------------------------------------------------------
// Manufacturing orders
// ---------------------------------------------------------------------------

/**
 * Create an MO and generate its production operations from the approved
 * (ACTIVE) part route. Planned quantity per step accounts for the scrap
 * factor of all downstream steps:  qty_i = Q / Π_{j>=i} (1 − sf_j).
 */
export async function createManufacturingOrder(input: unknown, userId: string, meta: { ip?: string; ua?: string }) {
  const parsed = createMoSchema.parse(input);
  const qty = new D(parsed.quantity);
  if (!qty.isPositive()) {
    throw new ApiError(422, 'quantity must be positive', 'مقدار باید مثبت باشد', 'bad_quantity');
  }

  return db.$transaction(async (tx) => {
    const part = await tx.part.findUnique({ where: { id: parsed.partId } });
    if (!part) throw new ApiError(404, 'Part not found', 'قطعه یافت نشد', 'part_not_found');
    if (part.status !== 'ACTIVE') {
      throw new ApiError(422, 'Part is not active', 'قطعه فعال نیست', 'part_inactive');
    }

    const route = parsed.routeId
      ? await tx.partRoute.findUnique({ where: { id: parsed.routeId }, include: { steps: { orderBy: { sequence: 'asc' } } } })
      : await tx.partRoute.findFirst({
          where: { partId: part.id, status: 'ACTIVE' },
          orderBy: { version: 'desc' },
          include: { steps: { orderBy: { sequence: 'asc' } } },
        });

    if (!route) {
      throw new ApiError(
        422,
        parsed.routeId
          ? 'Route not found'
          : 'Part has no ACTIVE route version — approve a route first',
        parsed.routeId ? 'مسیر تولید یافت نشد' : 'برای این قطعه مسیر تولید تأییدشده (ACTIVE) وجود ندارد',
        'route_not_found',
      );
    }
    if (route.partId !== part.id) {
      throw new ApiError(422, 'Route belongs to a different part', 'مسیر تولید متعلق به قطعه دیگری است', 'route_part_mismatch');
    }
    if (route.status !== 'ACTIVE') {
      throw new ApiError(422, 'Route version is not ACTIVE', 'نسخه مسیر تولید تأیید نشده است', 'route_not_active');
    }
    if (route.steps.length === 0) {
      throw new ApiError(422, 'Route has no steps', 'مسیر تولید مرحله‌ای ندارد', 'route_empty');
    }

    const moNumber = await generateDocumentNumber(tx, 'MO');

    // planned quantity per step (backward with scrap factors)
    const steps = route.steps;
    const planned: Dec[] = new Array<Dec>(steps.length);
    let acc = qty;
    for (let i = steps.length - 1; i >= 0; i--) {
      const step = steps[i]!;
      planned[i] = acc;
      const sf = Q(step.scrapFactorPct).div(100);
      acc = acc.div(new D(1).minus(sf));
    }

    const mo = await tx.manufacturingOrder.create({
      data: {
        moNumber,
        partId: part.id,
        routeId: route.id,
        planLineId: parsed.planLineId ?? null,
        quantity: qty,
        dueDate: parsed.dueDate ? new Date(`${parsed.dueDate}T00:00:00Z`) : null,
        priority: parsed.priority,
        status: 'PLANNED',
        notes: parsed.notes ?? null,
        operations: {
          create: steps.map((step, i) => ({
            sequence: step.sequence,
            operationId: step.operationId,
            routeStepId: step.id,
            machineId: step.machineId,
            status: 'PENDING' as OperationStatus,
            plannedQuantity: planned[i]!,
          })),
        },
      },
      include: { operations: { orderBy: { sequence: 'asc' }, include: { operation: true } } },
    });

    await recordAudit(tx, {
      userId,
      action: 'CREATE',
      entityType: 'ManufacturingOrder',
      entityId: mo.id,
      changes: { moNumber, partNumber: part.partNumber, quantity: qty.toFixed(4), routeVersion: route.version },
      ipAddress: meta.ip,
      userAgent: meta.ua,
    });

    return mo;
  });
}

export async function listManufacturingOrders(filters: { status?: string; partId?: string; take?: number }) {
  const mos = await db.manufacturingOrder.findMany({
    where: { status: filters.status as never, partId: filters.partId },
    orderBy: { createdAt: 'desc' },
    take: filters.take ?? 100,
    include: {
      part: { select: { partNumber: true, nameFa: true, baseUnit: { select: { code: true } } } },
      route: { select: { version: true, status: true, name: true } },
      operations: {
        orderBy: { sequence: 'asc' },
        include: { operation: { select: { code: true, nameFa: true } } },
      },
    },
  });
  // roll up progress: produced at the last operation vs MO quantity
  return mos.map((mo) => {
    const ops = mo.operations;
    const finalOp = ops[ops.length - 1];
    const producedFinal = finalOp ? Q(finalOp.producedQuantity) : new D(0);
    const wipTotal = ops.reduce(
      (acc, op) =>
        acc
          .plus(Q(op.receivedQuantity))
          .minus(Q(op.transferredOutQuantity))
          .minus(Q(op.scrappedQuantity))
          .minus(Q(op.rejectedQuantity)),
      new D(0),
    );
    return {
      id: mo.id,
      moNumber: mo.moNumber,
      part: mo.part,
      route: mo.route,
      quantity: Q(mo.quantity).toFixed(4),
      dueDate: mo.dueDate,
      priority: mo.priority,
      status: mo.status,
      releasedAt: mo.releasedAt,
      completedAt: mo.completedAt,
      notes: mo.notes,
      createdAt: mo.createdAt,
      progressPercent: Q(mo.quantity).comparedTo(0) === 0 ? 0 : producedFinal.div(Q(mo.quantity)).mul(100).toNumber(),
      producedFinal: producedFinal.toFixed(4),
      wipTotal: wipTotal.toFixed(4),
      operations: ops.map((op) => ({
        id: op.id,
        sequence: op.sequence,
        operation: op.operation,
        status: op.status,
        plannedQuantity: Q(op.plannedQuantity).toFixed(4),
        producedQuantity: Q(op.producedQuantity).toFixed(4),
      })),
    };
  });
}

export async function getManufacturingOrder(id: string) {
  const mo = await db.manufacturingOrder.findUnique({
    where: { id },
    include: {
      part: { select: { partNumber: true, nameFa: true, baseUnit: { select: { code: true } }, standardWeightKg: true } },
      route: { include: { steps: { orderBy: { sequence: 'asc' }, include: { operation: true, machine: true } } } },
      operations: {
        orderBy: { sequence: 'asc' },
        include: {
          operation: true,
          machine: true,
          reports: { orderBy: { createdAt: 'desc' } },
          outgoingTransfers: { include: { part: true } },
          incomingTransfers: true,
        },
      },
    },
  });
  if (!mo) throw new ApiError(404, 'Manufacturing order not found', 'دستور کار یافت نشد', 'mo_not_found');
  return mo;
}

async function loadMoWithOps(tx: Tx, id: string) {
  const mo = await tx.manufacturingOrder.findUnique({
    where: { id },
    include: { operations: { orderBy: { sequence: 'asc' } }, part: true },
  });
  if (!mo) throw new ApiError(404, 'Manufacturing order not found', 'دستور کار یافت نشد', 'mo_not_found');
  return mo;
}

export async function releaseManufacturingOrder(id: string, userId: string, meta: { ip?: string; ua?: string }) {
  return db.$transaction(async (tx) => {
    const mo = await loadMoWithOps(tx, id);
    if (mo.status !== 'PLANNED') {
      throw new ApiError(409, 'Only PLANNED orders can be released', 'فقط دستور کارهای در وضعیت برنامه‌ریزی قابل آزادسازی هستند', 'mo_status');
    }
    const updated = await tx.manufacturingOrder.update({
      where: { id },
      data: { status: 'RELEASED', releasedAt: new Date() },
    });
    await tx.productionOperation.updateMany({ where: { manufacturingOrderId: id, status: 'PENDING' }, data: { status: 'QUEUED' } });
    await recordAudit(tx, { userId, action: 'RELEASE', entityType: 'ManufacturingOrder', entityId: id, ipAddress: meta.ip, userAgent: meta.ua });
    return updated;
  });
}

export async function cancelManufacturingOrder(id: string, userId: string, meta: { ip?: string; ua?: string }) {
  return db.$transaction(async (tx) => {
    const mo = await loadMoWithOps(tx, id);
    if (['COMPLETED', 'CLOSED', 'CANCELLED'].includes(mo.status)) {
      throw new ApiError(409, 'Order already finished', 'دستور کار قبلاً بسته شده است', 'mo_status');
    }
    const [reports, transfers] = await Promise.all([
      tx.productionReport.count({ where: { operation: { manufacturingOrderId: id }, postingStatus: 'POSTED' } }),
      tx.productionTransfer.count({ where: { partId: mo.partId, fromOperationId: { in: mo.operations.map((o) => o.id) }, postingStatus: 'POSTED' } }),
    ]);
    if (reports > 0 || transfers > 0) {
      throw new ApiError(409, 'Order has posted activity and cannot be cancelled', 'دستور کار دارای فعالیت قطع‌بوش‌شده است و قابل ابطال نیست', 'mo_has_activity');
    }
    const updated = await tx.manufacturingOrder.update({ where: { id }, data: { status: 'CANCELLED' } });
    await tx.productionOperation.updateMany({ where: { manufacturingOrderId: id }, data: { status: 'CANCELLED' } });
    await recordAudit(tx, { userId, action: 'CANCEL', entityType: 'ManufacturingOrder', entityId: id, ipAddress: meta.ip, userAgent: meta.ua });
    return updated;
  });
}

export async function completeManufacturingOrder(id: string, userId: string, meta: { ip?: string; ua?: string }) {
  return db.$transaction(async (tx) => {
    const mo = await loadMoWithOps(tx, id);
    if (!['IN_PROGRESS', 'RELEASED'].includes(mo.status)) {
      throw new ApiError(409, 'Order is not active', 'دستور کار در جریان نیست', 'mo_status');
    }
    const ops = mo.operations;
    const finalOp = ops[ops.length - 1];
    if (!finalOp) throw new ApiError(422, 'Order has no operations', 'دستور کار عملیاتی ندارد', 'mo_no_ops');
    if (Q(finalOp.producedQuantity).comparedTo(Q(mo.quantity)) < 0) {
      throw new ApiError(
        422,
        `Final operation produced ${Q(finalOp.producedQuantity).toFixed(0)} of ${Q(mo.quantity).toFixed(0)}`,
        'تولید عملیات آخر هنوز به مقدار دستور کار نرسیده است',
        'mo_not_complete',
      );
    }
    const updated = await tx.manufacturingOrder.update({
      where: { id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    await tx.productionOperation.updateMany({
      where: { manufacturingOrderId: id, status: { in: ['PENDING', 'QUEUED', 'IN_PROGRESS', 'PAUSED'] } },
      data: { status: 'COMPLETED' },
    });
    await recordAudit(tx, { userId, action: 'COMPLETE', entityType: 'ManufacturingOrder', entityId: id, ipAddress: meta.ip, userAgent: meta.ua });
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Production reports (input / produced / scrap / rejected / rework)
// ---------------------------------------------------------------------------

export async function createProductionReport(input: unknown, userId: string, meta: { ip?: string; ua?: string }) {
  const parsed = createReportSchema.parse(input);
  const input_ = new D(parsed.inputQuantity);
  const produced = new D(parsed.producedQuantity);
  const rejected = new D(parsed.rejectedQuantity);
  const rework = new D(parsed.reworkQuantity);
  const scrapTotal = parsed.scraps.reduce((acc, s) => acc.plus(new D(s.quantity)), new D(0));

  for (const [name, v] of [['input', input_], ['produced', produced], ['rejected', rejected], ['rework', rework]] as const) {
    if (v.isNegative()) {
      throw new ApiError(422, `${name} quantity cannot be negative`, `مقدار ${name} نمی‌تواند منفی باشد`, 'bad_quantity');
    }
  }
  for (const s of parsed.scraps) {
    if (s.weightKg != null && new D(s.weightKg).isNegative()) {
      throw new ApiError(422, 'scrap weight cannot be negative', 'وزن ضایعات نمی‌تواند منفی باشد', 'bad_quantity');
    }
  }

  // conservation of processing: input = produced + rejected + rework + scrap
  const outputSum = produced.plus(rejected).plus(rework).plus(scrapTotal);
  if (!outputSum.equals(input_)) {
    throw new ApiError(
      422,
      `Conservation violated: input ${input_.toFixed(4)} ≠ produced + rejected + rework + scrap = ${outputSum.toFixed(4)}`,
      'جمع خروجی‌ها (تولید + مردود + بازکار + ضایعات) باید برابر ورودی باشد',
      'report_not_balanced',
      { input: input_.toFixed(4), output: outputSum.toFixed(4) },
    );
  }

  return db.$transaction(async (tx) => {
    const op = await tx.productionOperation.findUnique({
      where: { id: parsed.operationId },
      include: { manufacturingOrder: true, operation: true },
    });
    if (!op) throw new ApiError(404, 'Operation not found', 'عملیات یافت نشد', 'operation_not_found');
    if (!['RELEASED', 'IN_PROGRESS'].includes(op.manufacturingOrder.status)) {
      throw new ApiError(409, 'Manufacturing order is not active', 'دستور کار فعال نیست', 'mo_not_active');
    }
    if (parsed.machineId) {
      const machine = await tx.machine.findUnique({ where: { id: parsed.machineId } });
      if (!machine) throw new ApiError(404, 'Machine not found', 'ماشین یافت نشد', 'machine_not_found');
    }
    if (parsed.shiftId) {
      const shift = await tx.shift.findUnique({ where: { id: parsed.shiftId } });
      if (!shift) throw new ApiError(404, 'Shift not found', 'شیفت یافت نشد', 'shift_not_found');
    }

    const reportNumber = await generateDocumentNumber(tx, 'PR');
    const report = await tx.productionReport.create({
      data: {
        reportNumber,
        operationId: op.id,
        machineId: parsed.machineId ?? null,
        dieId: parsed.dieId ?? null,
        shiftId: parsed.shiftId ?? null,
        reportDate: new Date(`${parsed.reportDate}T00:00:00Z`),
        inputQuantity: input_,
        producedQuantity: produced,
        rejectedQuantity: rejected,
        reworkQuantity: rework,
        status: 'DRAFT',
        postingStatus: 'UNPOSTED',
        notes: parsed.notes ?? null,
        scraps: {
          create: parsed.scraps.map((s) => ({
            operationId: op.id,
            partId: op.manufacturingOrder.partId,
            reason: s.reason,
            quantity: new D(s.quantity),
            weightKg: s.weightKg != null ? new D(s.weightKg) : null,
            description: s.description ?? null,
            scrapDate: new Date(`${parsed.reportDate}T00:00:00Z`),
          })),
        },
      },
      include: { scraps: true, operation: { include: { operation: true } } },
    });

    await recordAudit(tx, {
      userId,
      action: 'CREATE',
      entityType: 'ProductionReport',
      entityId: report.id,
      changes: { reportNumber, operationId: op.id, input: input_.toFixed(4), produced: produced.toFixed(4) },
      ipAddress: meta.ip,
      userAgent: meta.ua,
    });

    return report;
  });
}

/**
 * Confirm (post) a production report: updates operation aggregates and the
 * MO state atomically. Quantities NEVER leave the operation here — only the
 * explicit transfer documents move quantity between operations.
 */
export async function confirmProductionReport(id: string, userId: string, meta: { ip?: string; ua?: string }) {
  return db.$transaction(
    async (tx) => {
      const report = await tx.productionReport.findUnique({
        where: { id },
        include: { scraps: true, operation: { include: { manufacturingOrder: true } } },
      });
      if (!report) throw new ApiError(404, 'Report not found', 'گزارش یافت نشد', 'report_not_found');
      if (report.status === 'CANCELLED') {
        throw new ApiError(409, 'Cancelled reports cannot be confirmed', 'گزارش ابطال‌شده قابل تأیید نیست', 'report_cancelled');
      }

      // duplicate-posting guard
      const guarded = await tx.productionReport.updateMany({
        where: { id, postingStatus: 'UNPOSTED' },
        data: { status: 'CONFIRMED', postingStatus: 'POSTED', postedAt: new Date() },
      });
      if (guarded.count === 0) {
        throw new ApiError(409, 'Report is already confirmed', 'این گزارش قبلاً تأیید شده است', 'duplicate_posting');
      }

      const op = report.operation;
      const input = Q(report.inputQuantity);
      const produced = Q(report.producedQuantity);
      const rejected = Q(report.rejectedQuantity);
      const rework = Q(report.reworkQuantity);
      const scrapTotal = report.scraps.reduce((acc, s) => acc.plus(Q(s.quantity)), new D(0));

      // re-validate conservation inside the tx
      const outputSum = produced.plus(rejected).plus(rework).plus(scrapTotal);
      if (!outputSum.equals(input)) {
        throw new ApiError(422, 'Report is not balanced', 'جمع خروجی‌ها با ورودی برابر نیست', 'report_not_balanced');
      }

      // feed availability: cumulative input ≤ cumulative received + cumulative rework (re-feed)
      const inputAfter = Q(op.inputQuantity).plus(input);
      const feedAvailable = Q(op.receivedQuantity).plus(Q(op.reworkQuantity));
      if (inputAfter.comparedTo(feedAvailable) > 0) {
        throw new ApiError(
          422,
          `Not enough WIP at operation: feeding ${input.toFixed(4)} but only ${feedAvailable.minus(Q(op.inputQuantity)).toFixed(4)} available`,
          'موجودی WIP این عملیات برای این میزان تغذیه کافی نیست',
          'not_enough_wip',
          { feedAvailable: feedAvailable.minus(Q(op.inputQuantity)).toFixed(4), requested: input.toFixed(4) },
        );
      }

      await tx.productionOperation.update({
        where: { id: op.id },
        data: {
          inputQuantity: inputAfter,
          producedQuantity: Q(op.producedQuantity).plus(produced),
          rejectedQuantity: Q(op.rejectedQuantity).plus(rejected),
          reworkQuantity: Q(op.reworkQuantity).plus(rework),
          scrappedQuantity: Q(op.scrappedQuantity).plus(scrapTotal),
          status: op.status === 'PENDING' || op.status === 'QUEUED' ? 'IN_PROGRESS' : op.status,
          wipSinceAt: op.wipSinceAt ?? new Date(),
        },
      });

      if (op.manufacturingOrder.status === 'RELEASED') {
        await tx.manufacturingOrder.update({
          where: { id: op.manufacturingOrderId },
          data: { status: 'IN_PROGRESS' },
        });
      }

      await recordAudit(tx, {
        userId,
        action: 'POST',
        entityType: 'ProductionReport',
        entityId: report.id,
        changes: {
          reportNumber: report.reportNumber,
          operationId: op.id,
          input: input.toFixed(4),
          produced: produced.toFixed(4),
          scrap: scrapTotal.toFixed(4),
          rejected: rejected.toFixed(4),
          rework: rework.toFixed(4),
        },
        ipAddress: meta.ip,
        userAgent: meta.ua,
      });

      return tx.productionReport.findUnique({ where: { id }, include: { scraps: true } });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20_000 },
  );
}

export async function cancelProductionReport(id: string, userId: string, meta: { ip?: string; ua?: string }) {
  return db.$transaction(async (tx) => {
    const report = await tx.productionReport.findUnique({ where: { id } });
    if (!report) throw new ApiError(404, 'Report not found', 'گزارش یافت نشد', 'report_not_found');
    if (report.postingStatus !== 'UNPOSTED') {
      throw new ApiError(
        409,
        'Confirmed reports cannot be cancelled — post a correcting report instead',
        'گزارش تأییدشده قابل ابطال نیست؛ گزارش اصلاحی ثبت کنید',
        'report_already_posted',
      );
    }
    const updated = await tx.productionReport.update({ where: { id }, data: { status: 'CANCELLED' } });
    await recordAudit(tx, { userId, action: 'CANCEL', entityType: 'ProductionReport', entityId: id, ipAddress: meta.ip, userAgent: meta.ua });
    return updated;
  });
}

export async function listProductionReports(filters: { operationId?: string; moId?: string; take?: number }) {
  return db.productionReport.findMany({
    where: {
      operationId: filters.operationId,
      ...(filters.moId ? { operation: { manufacturingOrderId: filters.moId } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: filters.take ?? 100,
    include: {
      operation: { include: { operation: true, manufacturingOrder: { include: { part: true } } } },
      machine: { select: { code: true, nameFa: true } },
      shift: { select: { code: true, nameFa: true } },
      scraps: true,
    },
  });
}

// ---------------------------------------------------------------------------
// Production transfers — the ONLY way quantity moves between operations
// ---------------------------------------------------------------------------

export async function createProductionTransfer(input: unknown, userId: string, meta: { ip?: string; ua?: string }) {
  const parsed = createTransferSchema.parse(input);
  const qty = new D(parsed.quantity);
  if (!qty.isPositive()) {
    throw new ApiError(422, 'quantity must be positive', 'مقدار باید مثبت باشد', 'bad_quantity');
  }

  return db.$transaction(async (tx) => {
    const part = await tx.part.findUnique({ where: { id: parsed.partId } });
    if (!part) throw new ApiError(404, 'Part not found', 'قطعه یافت نشد', 'part_not_found');

    let fromOp = null;
    let toOp = null;
    if (parsed.fromOperationId) {
      fromOp = await tx.productionOperation.findUnique({ where: { id: parsed.fromOperationId }, include: { manufacturingOrder: true } });
      if (!fromOp) throw new ApiError(404, 'Source operation not found', 'عملیات مبدأ یافت نشد', 'operation_not_found');
      if (fromOp.manufacturingOrder.partId !== part.id) {
        throw new ApiError(422, 'Source operation belongs to a different part', 'عملیات مبدأ متعلق به قطعه دیگری است', 'op_part_mismatch');
      }
    }
    if (parsed.toOperationId) {
      toOp = await tx.productionOperation.findUnique({ where: { id: parsed.toOperationId }, include: { manufacturingOrder: true } });
      if (!toOp) throw new ApiError(404, 'Destination operation not found', 'عملیات مقصد یافت نشد', 'operation_not_found');
      if (toOp.manufacturingOrder.partId !== part.id) {
        throw new ApiError(422, 'Destination operation belongs to a different part', 'عملیات مقصد متعلق به قطعه دیگری است', 'op_part_mismatch');
      }
      if (fromOp && toOp.manufacturingOrderId !== fromOp.manufacturingOrderId) {
        throw new ApiError(422, 'Operations must belong to the same manufacturing order', 'مبدأ و مقصد باید در یک دستور کار باشند', 'op_mo_mismatch');
      }
      if (fromOp && toOp.sequence <= fromOp.sequence) {
        throw new ApiError(422, 'Destination must be a later operation', 'عملیات مقصد باید بعد از مبدأ باشد', 'op_sequence');
      }
    }
    if (parsed.toWarehouseId) {
      const wh = await tx.warehouse.findUnique({ where: { id: parsed.toWarehouseId } });
      if (!wh) throw new ApiError(404, 'Warehouse not found', 'انبار یافت نشد', 'warehouse_not_found');
      if (wh.warehouseType !== 'FINISHED_GOODS') {
        throw new ApiError(422, 'Output transfers must target a FINISHED_GOODS warehouse', 'انتقال خروجی باید به انبار محصول تکمیلی باشد', 'warehouse_type');
      }
    }

    const transferNumber = await generateDocumentNumber(tx, 'TRF');
    const transfer = await tx.productionTransfer.create({
      data: {
        transferNumber,
        partId: part.id,
        fromOperationId: parsed.fromOperationId ?? null,
        toOperationId: parsed.toOperationId ?? null,
        fromWarehouseId: parsed.fromWarehouseId ?? null,
        toWarehouseId: parsed.toWarehouseId ?? null,
        quantity: qty,
        weightKg: part.standardWeightKg ? qty.mul(new D(part.standardWeightKg)) : null,
        transferDate: new Date(`${parsed.transferDate}T00:00:00Z`),
        status: 'DRAFT',
        postingStatus: 'UNPOSTED',
        notes: parsed.notes ?? null,
      },
    });

    await recordAudit(tx, {
      userId,
      action: 'CREATE',
      entityType: 'ProductionTransfer',
      entityId: transfer.id,
      changes: { transferNumber, quantity: qty.toFixed(4) },
      ipAddress: meta.ip,
      userAgent: meta.ua,
    });

    return transfer;
  });
}

/**
 * Post a production transfer atomically:
 *  − op → op: source.transferredOut += q, destination.received += q
 *  − warehouse feed (fromOp = null): destination.received += q (no stock change —
 *    the raw material was already issued via an inventory document)
 *  − op → FG warehouse: source.transferredOut += q and a posted
 *    PRODUCTION_RECEIPT inventory document updates finished-goods stock.
 */
export async function postProductionTransfer(id: string, userId: string, meta: { ip?: string; ua?: string }) {
  return db.$transaction(
    async (tx) => {
      const transfer = await tx.productionTransfer.findUnique({ where: { id } });
      if (!transfer) throw new ApiError(404, 'Transfer not found', 'انتقال یافت نشد', 'transfer_not_found');
      if (transfer.status === 'CANCELLED') {
        throw new ApiError(409, 'Cancelled transfers cannot be posted', 'انتقال ابطال‌شده قابل قطع‌بوش نیست', 'transfer_cancelled');
      }

      const guarded = await tx.productionTransfer.updateMany({
        where: { id, postingStatus: 'UNPOSTED' },
        data: { status: 'CONFIRMED', postingStatus: 'POSTED' },
      });
      if (guarded.count === 0) {
        throw new ApiError(409, 'Transfer is already posted', 'این انتقال قبلاً قطع‌بوش شده است', 'duplicate_posting');
      }

      const qty = Q(transfer.quantity);
      const occurredAt = new Date();

      if (transfer.fromOperationId) {
        const fromOp = await tx.productionOperation.findUnique({ where: { id: transfer.fromOperationId } });
        if (!fromOp) throw new ApiError(404, 'Source operation not found', 'عملیات مبدأ یافت نشد', 'operation_not_found');
        const ready = Q(fromOp.producedQuantity).minus(Q(fromOp.transferredOutQuantity));
        if (qty.comparedTo(ready) > 0) {
          throw new ApiError(
            422,
            `Only ${ready.toFixed(4)} pcs are ready for transfer at the source operation`,
            'مقدار آماده انتقال در عملیات مبدأ کافی نیست',
            'not_ready_for_transfer',
            { ready: ready.toFixed(4), requested: qty.toFixed(4) },
          );
        }
        await tx.productionOperation.update({
          where: { id: fromOp.id },
          data: { transferredOutQuantity: Q(fromOp.transferredOutQuantity).plus(qty) },
        });
      }

      if (transfer.toOperationId) {
        const toOp = await tx.productionOperation.findUnique({ where: { id: transfer.toOperationId } });
        if (!toOp) throw new ApiError(404, 'Destination operation not found', 'عملیات مقصد یافت نشد', 'operation_not_found');
        await tx.productionOperation.update({
          where: { id: toOp.id },
          data: {
            receivedQuantity: Q(toOp.receivedQuantity).plus(qty),
            status: toOp.status === 'PENDING' ? 'QUEUED' : toOp.status,
            wipSinceAt: toOp.wipSinceAt ?? occurredAt,
          },
        });
        const toMo = await tx.manufacturingOrder.findUnique({ where: { id: toOp.manufacturingOrderId } });
        if (toMo && toMo.status === 'RELEASED') {
          await tx.manufacturingOrder.update({ where: { id: toMo.id }, data: { status: 'IN_PROGRESS' } });
        }
      }

      if (transfer.toWarehouseId) {
        // finished-goods receipt — posted inventory document inside the same tx
        const documentNumber = await generateDocumentNumber(tx, 'INV');
        const part = await tx.part.findUnique({ where: { id: transfer.partId } });
        if (!part) throw new ApiError(404, 'Part not found', 'قطعه یافت نشد', 'part_not_found');
        const unitId = part.baseUnitId;
        const weightKg = transfer.weightKg;

        const invDoc = await tx.inventoryDocument.create({
          data: {
            documentNumber,
            documentType: 'PRODUCTION_RECEIPT',
            status: 'CONFIRMED',
            postingStatus: 'UNPOSTED',
            documentDate: transfer.transferDate,
            warehouseId: transfer.toWarehouseId,
            referenceType: 'PRODUCTION_TRANSFER',
            referenceId: transfer.id,
            description: `رسید تولید — انتقال ${transfer.transferNumber}`,
            createdById: userId,
            lines: {
              create: {
                lineNo: 1,
                partId: transfer.partId,
                quantity: qty,
                unitId,
                weightKg,
                toLocationId: null,
                notes: `انتقال تولید ${transfer.transferNumber}`,
              },
            },
          },
          include: { lines: true },
        });

        await tx.inventoryTransaction.create({
          data: {
            transactionNumber: await generateDocumentNumber(tx, 'TX'),
            documentId: invDoc.id,
            documentLineId: invDoc.lines[0]!.id,
            type: 'RECEIPT',
            partId: transfer.partId,
            warehouseId: transfer.toWarehouseId,
            locationId: invDoc.lines[0]!.toLocationId,
            ownership: 'OWNED',
            qualityStatus: 'APPROVED',
            quantity: qty,
            unitId,
            weightKg,
            createdById: userId,
          },
        });

        // balance upsert (FG receipts are always positive)
        const balanceKey = [
          transfer.partId, '-', transfer.toWarehouseId, invDoc.lines[0]!.toLocationId ?? '-', '-', unitId, 'OWNED', 'APPROVED',
        ].join(':');
        const existing = await tx.stockBalance.findUnique({ where: { balanceKey } });
        if (existing) {
          await tx.stockBalance.update({
            where: { id: existing.id },
            data: {
              quantity: Q(existing.quantity).plus(qty),
              weightKg: Q(existing.weightKg).plus(weightKg ?? 0),
              lastTransactionAt: occurredAt,
            },
          });
        } else {
          await tx.stockBalance.create({
            data: {
              partId: transfer.partId,
              materialId: null,
              warehouseId: transfer.toWarehouseId,
              locationId: invDoc.lines[0]!.toLocationId,
              lotId: null,
              unitId,
              ownership: 'OWNED',
              qualityStatus: 'APPROVED',
              balanceKey,
              quantity: qty,
              weightKg: weightKg ?? new D(0),
              lastTransactionAt: occurredAt,
            },
          });
        }

        await tx.inventoryDocument.update({
          where: { id: invDoc.id },
          data: { postingStatus: 'POSTED', postedById: userId, postedAt: occurredAt },
        });
        await recordAudit(tx, {
          userId,
          action: 'POST',
          entityType: 'InventoryDocument',
          entityId: invDoc.id,
          changes: { via: 'PRODUCTION_TRANSFER', transferNumber: transfer.transferNumber },
          ipAddress: meta.ip,
          userAgent: meta.ua,
        });
      }

      // keep the MO in progress
      if (transfer.fromOperationId) {
        const fromOp = await tx.productionOperation.findUnique({ where: { id: transfer.fromOperationId } });
        if (fromOp) {
          const mo = await tx.manufacturingOrder.findUnique({ where: { id: fromOp.manufacturingOrderId } });
          if (mo && mo.status === 'RELEASED') {
            await tx.manufacturingOrder.update({ where: { id: mo.id }, data: { status: 'IN_PROGRESS' } });
          }
        }
      }

      await recordAudit(tx, {
        userId,
        action: 'POST',
        entityType: 'ProductionTransfer',
        entityId: transfer.id,
        changes: { transferNumber: transfer.transferNumber, quantity: qty.toFixed(4) },
        ipAddress: meta.ip,
        userAgent: meta.ua,
      });

      return tx.productionTransfer.findUnique({ where: { id }, include: { fromOperation: true, toOperation: true } });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 },
  );
}

export async function reverseProductionTransfer(id: string, userId: string, meta: { ip?: string; ua?: string }) {
  return db.$transaction(
    async (tx) => {
      const transfer = await tx.productionTransfer.findUnique({ where: { id } });
      if (!transfer) throw new ApiError(404, 'Transfer not found', 'انتقال یافت نشد', 'transfer_not_found');
      if (transfer.postingStatus === 'UNPOSTED') {
        throw new ApiError(409, 'Draft transfers are cancelled, not reversed', 'انتقال پیش‌نویس ابطال می‌شود', 'transfer_not_posted');
      }
      if (transfer.postingStatus === 'REVERSED') {
        throw new ApiError(409, 'Transfer is already reversed', 'این انتقال قبلاً ابطال شده است', 'already_reversed');
      }
      const guarded = await tx.productionTransfer.updateMany({
        where: { id, postingStatus: 'POSTED' },
        data: { postingStatus: 'REVERSED' },
      });
      if (guarded.count === 0) {
        throw new ApiError(409, 'Transfer state changed concurrently', 'وضعیت انتقال هم‌زمان تغییر کرده است', 'conflict');
      }

      const qty = Q(transfer.quantity);

      if (transfer.fromOperationId) {
        const fromOp = await tx.productionOperation.findUnique({ where: { id: transfer.fromOperationId } });
        if (fromOp) {
          await tx.productionOperation.update({
            where: { id: fromOp.id },
            data: { transferredOutQuantity: Q(fromOp.transferredOutQuantity).minus(qty) },
          });
        }
      }
      if (transfer.toOperationId) {
        const toOp = await tx.productionOperation.findUnique({ where: { id: transfer.toOperationId } });
        if (toOp) {
          await tx.productionOperation.update({
            where: { id: toOp.id },
            data: { receivedQuantity: Q(toOp.receivedQuantity).minus(qty) },
          });
        }
      }

      if (transfer.toWarehouseId) {
        // reverse the linked FG receipt: find the posted PRODUCTION_RECEIPT doc
        const receiptDoc = await tx.inventoryDocument.findFirst({
          where: { documentType: 'PRODUCTION_RECEIPT', referenceType: 'PRODUCTION_TRANSFER', referenceId: transfer.id, postingStatus: 'POSTED' },
        });
        if (receiptDoc) {
          await tx.inventoryDocument.update({ where: { id: receiptDoc.id }, data: { postingStatus: 'REVERSED' } });
          const originalTxs = await tx.inventoryTransaction.findMany({ where: { documentId: receiptDoc.id } });
          for (const t of originalTxs) {
            await tx.inventoryTransaction.create({
              data: {
                transactionNumber: await generateDocumentNumber(tx, 'TX'),
                documentId: receiptDoc.id,
                documentLineId: t.documentLineId,
                type: 'ISSUE',
                partId: t.partId,
                materialId: t.materialId,
                warehouseId: t.warehouseId,
                locationId: t.locationId,
                lotId: t.lotId,
                ownership: t.ownership,
                qualityStatus: t.qualityStatus,
                quantity: new D(t.quantity).abs(),
                unitId: t.unitId,
                weightKg: t.weightKg ? new D(t.weightKg).abs() : null,
                reversalOfId: t.id,
                createdById: userId,
              },
            });
            const deltaQ = new D(t.quantity).abs().neg();
            const deltaW = t.weightKg ? new D(t.weightKg).abs().neg() : new D(0);
            const balanceKey = [
              t.partId ?? '-', t.materialId ?? '-', t.warehouseId, t.locationId ?? '-', t.lotId ?? '-', t.unitId, t.ownership, t.qualityStatus,
            ].join(':');
            const bal = await tx.stockBalance.findUnique({ where: { balanceKey } });
            if (bal) {
              await tx.stockBalance.update({
                where: { id: bal.id },
                data: {
                  quantity: Q(bal.quantity).plus(deltaQ),
                  weightKg: Q(bal.weightKg).plus(deltaW),
                  lastTransactionAt: new Date(),
                },
              });
            }
          }
          await recordAudit(tx, {
            userId,
            action: 'REVERSE',
            entityType: 'InventoryDocument',
            entityId: receiptDoc.id,
            changes: { via: 'PRODUCTION_TRANSFER_REVERSAL', transferNumber: transfer.transferNumber },
            ipAddress: meta.ip,
            userAgent: meta.ua,
          });
        }
      }

      await recordAudit(tx, {
        userId,
        action: 'REVERSE',
        entityType: 'ProductionTransfer',
        entityId: transfer.id,
        changes: { transferNumber: transfer.transferNumber, quantity: qty.toFixed(4) },
        ipAddress: meta.ip,
        userAgent: meta.ua,
      });

      return tx.productionTransfer.findUnique({ where: { id } });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 },
  );
}

export async function listProductionTransfers(filters: { moId?: string; partId?: string; take?: number }) {
  return db.productionTransfer.findMany({
    where: {
      partId: filters.partId,
      ...(filters.moId
        ? {
            OR: [
              { fromOperation: { manufacturingOrderId: filters.moId } },
              { toOperation: { manufacturingOrderId: filters.moId } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: filters.take ?? 100,
    include: {
      part: { select: { partNumber: true, nameFa: true } },
      fromOperation: { include: { operation: true, manufacturingOrder: { select: { moNumber: true } } } },
      toOperation: { include: { operation: true, manufacturingOrder: { select: { moNumber: true } } } },
      fromWarehouse: { select: { code: true, nameFa: true } },
      toWarehouse: { select: { code: true, nameFa: true } },
    },
  });
}

// ---------------------------------------------------------------------------
// WIP dashboard
// ---------------------------------------------------------------------------

export async function getWipDashboard() {
  const ops = await db.productionOperation.findMany({
    where: { manufacturingOrder: { status: { in: ['RELEASED', 'IN_PROGRESS'] } } },
    include: {
      operation: { select: { code: true, nameFa: true } },
      machine: { select: { code: true, nameFa: true } },
      manufacturingOrder: {
        select: { moNumber: true, status: true, quantity: true, dueDate: true, part: { select: { partNumber: true, nameFa: true } } },
      },
    },
    orderBy: [{ manufacturingOrderId: 'asc' }, { sequence: 'asc' }],
  });

  const now = Date.now();
  const rows = ops.map((op) => {
    const received = Q(op.receivedQuantity);
    const input = Q(op.inputQuantity);
    const produced = Q(op.producedQuantity);
    const scrap = Q(op.scrappedQuantity);
    const rejected = Q(op.rejectedQuantity);
    const rework = Q(op.reworkQuantity);
    const transferredOut = Q(op.transferredOutQuantity);

    const waitingToProcess = received.plus(rework).minus(input); // arrived + rework pending re-feed
    const processing = input.minus(produced).minus(scrap).minus(rejected).minus(rework);
    const readyForTransfer = produced.minus(transferredOut);
    const wipTotal = received.minus(transferredOut).minus(scrap).minus(rejected);
    const agingHours = op.wipSinceAt ? Math.max(0, (now - op.wipSinceAt.getTime()) / 3_600_000) : 0;

    return {
      operationId: op.id,
      moNumber: op.manufacturingOrder.moNumber,
      partNumber: op.manufacturingOrder.part.partNumber,
      partName: op.manufacturingOrder.part.nameFa,
      sequence: op.sequence,
      operationCode: op.operation.code,
      operationName: op.operation.nameFa,
      machineCode: op.machine?.code ?? null,
      opStatus: op.status,
      plannedQuantity: Q(op.plannedQuantity).toFixed(4),
      receivedQuantity: received.toFixed(4),
      inputQuantity: input.toFixed(4),
      producedQuantity: produced.toFixed(4),
      scrappedQuantity: scrap.toFixed(4),
      rejectedQuantity: rejected.toFixed(4),
      reworkQuantity: rework.toFixed(4),
      transferredOutQuantity: transferredOut.toFixed(4),
      waitingToProcess: waitingToProcess.toFixed(4),
      processing: processing.toFixed(4),
      readyForTransfer: readyForTransfer.toFixed(4),
      wipTotal: wipTotal.toFixed(4),
      agingHours: Math.round(agingHours * 10) / 10,
    };
  });

  const totals = rows.reduce(
    (acc, r) => ({
      waitingToProcess: acc.waitingToProcess.plus(new D(r.waitingToProcess)),
      processing: acc.processing.plus(new D(r.processing)),
      readyForTransfer: acc.readyForTransfer.plus(new D(r.readyForTransfer)),
      wipTotal: acc.wipTotal.plus(new D(r.wipTotal)),
      scrap: acc.scrap.plus(new D(r.scrappedQuantity)),
      rejected: acc.rejected.plus(new D(r.rejectedQuantity)),
    }),
    { waitingToProcess: new D(0), processing: new D(0), readyForTransfer: new D(0), wipTotal: new D(0), scrap: new D(0), rejected: new D(0) },
  );

  return {
    totals: {
      waitingToProcess: totals.waitingToProcess.toFixed(2),
      processing: totals.processing.toFixed(2),
      readyForTransfer: totals.readyForTransfer.toFixed(2),
      wipTotal: totals.wipTotal.toFixed(2),
      scrap: totals.scrap.toFixed(2),
      rejected: totals.rejected.toFixed(2),
    },
    operations: rows,
    generatedAt: new Date().toISOString(),
  };
}

/** Reconciliation: verify quantity conservation across WIP + FG for a part. */
export async function getWipReconciliation(partId?: string) {
  const mos = await db.manufacturingOrder.findMany({
    where: { partId, status: { in: ['RELEASED', 'IN_PROGRESS', 'COMPLETED'] } },
    include: { operations: { orderBy: { sequence: 'asc' } } },
  });
  const rows = mos.map((mo) => {
    const firstOp = mo.operations[0];
    const fedFromWarehouse = firstOp ? Q(firstOp.receivedQuantity) : new D(0);
    const lastOp = mo.operations[mo.operations.length - 1];
    const toFg = lastOp ? Q(lastOp.transferredOutQuantity) : new D(0);
    const scrapAndRejected = mo.operations.reduce(
      (acc, op) => acc.plus(Q(op.scrappedQuantity)).plus(Q(op.rejectedQuantity)),
      new D(0),
    );
    const wip = mo.operations.reduce(
      (acc, op) => acc.plus(Q(op.receivedQuantity)).minus(Q(op.transferredOutQuantity)).minus(Q(op.scrappedQuantity)).minus(Q(op.rejectedQuantity)),
      new D(0),
    );
    return {
      moNumber: mo.moNumber,
      fedFromWarehouse: fedFromWarehouse.toFixed(4),
      transferredToFg: toFg.toFixed(4),
      scrapAndRejected: scrapAndRejected.toFixed(4),
      wipRemaining: wip.toFixed(4),
      conserved: fedFromWarehouse.minus(toFg).minus(scrapAndRejected).minus(wip).abs().comparedTo('0.0001') <= 0,
    };
  });
  return rows;
}

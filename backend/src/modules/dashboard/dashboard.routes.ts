import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { db } from '../../config/db';
import { authenticate, requirePermission } from '../../middleware/auth';
import { toJalaliDateString } from '../../lib/jalali';
import { machineUtilization } from '../reports/reports.helpers';
import { getMrpAlert } from '../mrp/mrp.service';

export const dashboardRouter = Router();

dashboardRouter.use(authenticate, requirePermission('dashboard.view'));

const D = Prisma.Decimal;
const d = (v: Prisma.Decimal.Value | null | undefined) => new D(v ?? 0);

/** Live counters from the database — proves real persistence end-to-end. */
dashboardRouter.get('/summary', async (_req, res) => {
  const [activeParts, activeMachines, warehouses, operations, customers, activeUsers, units] =
    await Promise.all([
      db.part.count({ where: { status: 'ACTIVE' } }),
      db.machine.count({ where: { status: 'ACTIVE' } }),
      db.warehouse.count({ where: { isActive: true } }),
      db.operation.count({ where: { isActive: true } }),
      db.customer.count({ where: { isActive: true } }),
      db.user.count({ where: { isActive: true } }),
      db.unitOfMeasure.count(),
    ]);

  res.json({
    stats: {
      activeParts,
      activeMachines,
      warehouses,
      operations,
      customers,
      activeUsers,
      units,
    },
    jalaliToday: toJalaliDateString(new Date()),
    jalaliTodayFa: toJalaliDateString(new Date(), true),
    generatedAt: new Date().toISOString(),
  });
});

/**
 * Phase 5 — operational KPI dashboard (exported for tests).
 *
 * Every figure is computed from real database records. Values carry an
 * explicit valueKind (ACTUAL / PLANNED / ESTIMATED) so estimates never
 * masquerade as measured production. Machine utilization is returned ONLY
 * where reliable capacity data exists (standard rates + ACTIVE shifts);
 * machines without it are listed with reliable=false and a reason.
 */
export async function getOperationsDashboard() {
  const now = new Date();
  const periodFrom = new Date(now.getTime() - 30 * 86_400_000);
  const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);

  const [
    activeOrders,
    plannedAgg,
    activePlanCount,
    actualReports,
    delayedLines,
    fgWarehouses,
    wipOps,
    scrapSum,
    latestPlan,
    utilization,
  ] = await Promise.all([
    // active customer orders (count + open quantity)
    db.customerOrder.findMany({
      where: { status: { in: ['CONFIRMED', 'IN_PRODUCTION', 'PARTIALLY_DELIVERED'] } },
      select: { lines: { select: { quantity: true, deliveredQuantity: true } } },
    }),
    // planned production: lines of CONFIRMED/RELEASED plans (PLANNED value)
    db.productionPlanLine.aggregate({
      _sum: { plannedQuantity: true },
      where: { plan: { status: { in: ['CONFIRMED', 'RELEASED'] } } },
    }),
    db.productionPlan.count({ where: { status: { in: ['CONFIRMED', 'RELEASED'] } } }),
    // actual production: posted production reports in the last 30 days (ACTUAL)
    db.productionReport.aggregate({
      _sum: { producedQuantity: true },
      where: { postingStatus: 'POSTED', reportDate: { gte: periodFrom } },
    }),
    db.customerOrderLine.findMany({
      where: { status: { in: ['OPEN', 'IN_PRODUCTION'] }, dueDate: { lt: today }, order: { status: { in: ['CONFIRMED', 'IN_PRODUCTION', 'PARTIALLY_DELIVERED'] } } },
      select: { quantity: true, deliveredQuantity: true },
    }),
    // finished goods stock (OWNED + APPROVED) and consignment, in FG warehouses
    db.warehouse.findMany({ where: { warehouseType: 'FINISHED_GOODS', isActive: true }, select: { id: true } }),
    // WIP quantity over ACTIVE MOs (same formula as the WIP dashboard)
    db.productionOperation.findMany({
      where: { manufacturingOrder: { status: { in: ['RELEASED', 'IN_PROGRESS'] } } },
      select: { receivedQuantity: true, transferredOutQuantity: true, scrappedQuantity: true, rejectedQuantity: true },
    }),
    // scrap of the last 30 days
    db.productionScrap.aggregate({
      _sum: { quantity: true },
      where: { scrapDate: { gte: periodFrom } },
    }),
    // material shortages from the latest planning run (real planning records)
    db.productionPlan.findFirst({
      where: { status: { in: ['CONFIRMED', 'RELEASED', 'DRAFT'] } },
      orderBy: { planningRunAt: 'desc' },
      select: {
        planNumber: true, planningRunAt: true,
        lines: { select: { materialShortages: { select: { severity: true, shortageQuantity: true } } } },
      },
    }),
    machineUtilization({ from: periodFrom, to: now }),
  ]);

  // phase 8 — material shortage alert from the newest stored MRP snapshot
  // (computed+stored on first ever load; otherwise never blocks the request)
  const mrpAlert = await getMrpAlert().catch(() => ({
    available: false,
    stale: true,
    ageHours: null,
    ranAt: null,
    summary: null,
    topShortages: [],
    reasonFa: 'محاسبه هشدار کسری با خطا مواجه شد',
  }));

  const openQty = activeOrders.reduce(
    (acc, o) => acc.plus(o.lines.reduce((a, l) => a.plus(d(l.quantity).minus(d(l.deliveredQuantity))), new D(0))),
    new D(0),
  );
  const delayedOpenQty = delayedLines.reduce((acc, l) => acc.plus(d(l.quantity).minus(d(l.deliveredQuantity))), new D(0));

  const fgIds = fgWarehouses.map((w) => w.id);
  const fgBalances = fgIds.length
    ? await db.stockBalance.groupBy({
        by: ['ownership', 'qualityStatus'],
        _sum: { quantity: true },
        where: { warehouseId: { in: fgIds }, partId: { not: null } },
      })
    : [];
  let fgOwned = new D(0);
  let fgConsignment = new D(0);
  for (const b of fgBalances) {
    if (b.ownership === 'OWNED' && b.qualityStatus === 'APPROVED') fgOwned = fgOwned.plus(d(b._sum.quantity));
    if (b.ownership === 'SUPPLIER_CONSIGNMENT' && b.qualityStatus === 'APPROVED') fgConsignment = fgConsignment.plus(d(b._sum.quantity));
  }

  const wipTotal = wipOps.reduce(
    (acc, op) =>
      acc.plus(d(op.receivedQuantity)).minus(d(op.transferredOutQuantity)).minus(d(op.scrappedQuantity)).minus(d(op.rejectedQuantity)),
    new D(0),
  );

  let shortageCount = 0;
  let shortageQty = new D(0);
  let missingBomCount = 0;
  if (latestPlan) {
    for (const line of latestPlan.lines) {
      for (const s of line.materialShortages) {
        if (s.severity === 'SHORTAGE' || s.severity === 'SHORTAGE_COVERED_BY_CONTRACT') {
          shortageCount += 1;
          shortageQty = shortageQty.plus(d(s.shortageQuantity));
        } else if (s.severity === 'MISSING_BOM') {
          missingBomCount += 1;
        }
      }
    }
  }

  const reliableUtil = utilization.filter((u) => u.capacityReliable && u.utilizationPct !== null);
  const avgUtilization =
    reliableUtil.length > 0
      ? Math.round((reliableUtil.reduce((acc, u) => acc + (u.utilizationPct ?? 0), 0) / reliableUtil.length) * 10) / 10
      : null;

  const nowIso = now.toISOString();
  return {
    kpis: {
      activeCustomerOrders: {
        valueKind: 'ACTUAL',
        count: activeOrders.length,
        openQuantity: openQty.toFixed(2),
        unit: 'عدد',
      },
      plannedProduction: {
        valueKind: 'PLANNED',
        quantity: d(activePlanCount > 0 ? plannedAgg._sum.plannedQuantity : 0).toFixed(2),
        planCount: activePlanCount,
        unit: 'عدد',
      },
      actualProduction: {
        valueKind: 'ACTUAL',
        quantity: d(actualReports._sum.producedQuantity).toFixed(2),
        periodDays: 30,
        unit: 'عدد',
      },
      delayedOrders: {
        valueKind: 'INFO',
        lineCount: delayedLines.length,
        openQuantity: delayedOpenQty.toFixed(2),
        unit: 'عدد',
      },
      materialShortages: {
        valueKind: 'INFO',
        count: shortageCount,
        missingBomCount,
        quantity: shortageQty.toFixed(2),
        sourcePlanNumber: latestPlan?.planNumber ?? null,
        sourcePlanningRunAt: latestPlan?.planningRunAt?.toISOString() ?? null,
        unit: 'عدد',
      },
      wipQuantity: { valueKind: 'ACTUAL', quantity: wipTotal.toFixed(2), unit: 'عدد' },
      finishedGoodsStock: {
        valueKind: 'ACTUAL',
        owned: fgOwned.toFixed(2),
        consignment: fgConsignment.toFixed(2),
        unit: 'عدد',
      },
      scrap: { valueKind: 'ACTUAL', quantity: d(scrapSum._sum.quantity).toFixed(2), periodDays: 30, unit: 'عدد' },
      machineUtilization: {
        valueKind: 'ESTIMATED',
        averagePct: avgUtilization,
        reliableMachineCount: reliableUtil.length,
        machines: utilization.map((u) => ({
          machineCode: u.machineCode,
          machineNameFa: u.machineNameFa,
          utilizationPct: u.utilizationPct,
          capacityReliable: u.capacityReliable,
          reasonFa: u.reasonFa,
        })),
        noteFa:
          reliableUtil.length === 0
            ? 'برای هیچ ماشینی داده ظرفیت قابل اتکا (نرخ استاندارد + شیفت فعال) ثبت نشده است؛ بهره‌وری نمایش داده نمی‌شود.'
            : 'بهره‌وری تخمینی بر پایه زمان استاندارد است، نه اندازه‌گیری واقعی.',
      },
    },
    period: { from: periodFrom.toISOString(), to: nowIso, basisFa: '۳۰ روز گذشته برای تولید/ضایعات واقعی' },
    mrpAlert,
    jalaliTodayFa: toJalaliDateString(now, true),
    generatedAt: nowIso,
    generatedAtFa: `${toJalaliDateString(now, true)} — ${now.toLocaleTimeString('fa-IR')}`,
  };
}

dashboardRouter.get('/operations', async (_req, res) => {
  res.json(await getOperationsDashboard());
});

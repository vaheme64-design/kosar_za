/**
 * KPIMS — Phase 5: Management Reporting & Control — service.
 *
 * Ground rules (phase requirements):
 *   • every figure comes from real database records — no invented data;
 *   • filters: date, part, customer, machine, operation (where meaningful);
 *   • values are explicitly kinded: ACTUAL / PLANNED / STANDARD / ESTIMATED;
 *   • missing information is surfaced (e.g. MISSING_BOM), never assumed;
 *   • every summary row can drill down to its source documents.
 */
import { Prisma, CustomerOrderStatus, OrderLineStatus, MoStatus } from '@prisma/client';
import { db } from '../../config/db';
import { ApiError } from '../../lib/http';
import {
  CONSUMPTION_TX, INFLOW_TX, OUTFLOW_TX, TX_SIGN, dec, fmt, isoDate, ledgerTotalsByDims, dimsKey,
  machineUtilization, meta, resolvePeriod, table, endOfDay, ZERO,
} from './reports.helpers';
import type { ReportTable, ReportColumn, DrillRef } from './reports.types';
import type { ReportFilters } from './reports.schemas';

type D = Prisma.Decimal;

const Q = (v: Prisma.Decimal.Value | null | undefined) => dec(v);
const qty = (v: Prisma.Decimal.Value | null | undefined) => fmt(v, 2);

const OPEN_ORDER_STATUSES: CustomerOrderStatus[] = ['CONFIRMED', 'IN_PRODUCTION', 'PARTIALLY_DELIVERED'];
const OPEN_LINE_STATUSES: OrderLineStatus[] = ['OPEN', 'IN_PRODUCTION'];
const OPEN_MO_STATUSES: MoStatus[] = ['PLANNED', 'RELEASED', 'IN_PROGRESS'];
const ACTIVE_MO_STATUSES: MoStatus[] = ['RELEASED', 'IN_PROGRESS'];
const DRILL_TAKE = 100;

function drill(kind: string, id: string, labelFa?: string): DrillRef {
  return { kind, id, labelFa };
}

/** FG warehouses (FINISHED_GOODS type) ids — used by backlog & dashboard. */
async function fgWarehouseIds(): Promise<string[]> {
  const rows = await db.warehouse.findMany({ where: { warehouseType: 'FINISHED_GOODS', isActive: true }, select: { id: true } });
  return rows.map((r) => r.id);
}

/** Part-level WIP aggregates over ACTIVE MOs (same formulas as the WIP dashboard). */
async function wipByPart(partId?: string, operationId?: string): Promise<Map<string, { waiting: D; processing: D; ready: D; total: D; scrap: D; rejected: D; maxAgingHours: number | null }>> {
  const ops = await db.productionOperation.findMany({
    where: {
      manufacturingOrder: { status: { in: ACTIVE_MO_STATUSES }, ...(partId ? { partId } : {}) },
      ...(operationId ? { operationId } : {}),
    },
    select: {
      receivedQuantity: true, inputQuantity: true, producedQuantity: true,
      scrappedQuantity: true, rejectedQuantity: true, reworkQuantity: true, transferredOutQuantity: true,
      wipSinceAt: true,
      manufacturingOrder: { select: { partId: true } },
    },
    take: 10000,
  });
  const map = new Map<string, { waiting: D; processing: D; ready: D; total: D; scrap: D; rejected: D; maxAgingHours: number | null }>();
  const now = Date.now();
  for (const op of ops) {
    const pid = op.manufacturingOrder.partId;
    const acc = map.get(pid) ?? { waiting: ZERO, processing: ZERO, ready: ZERO, total: ZERO, scrap: ZERO, rejected: ZERO, maxAgingHours: null };
    const received = Q(op.receivedQuantity);
    const input = Q(op.inputQuantity);
    const produced = Q(op.producedQuantity);
    const scrap = Q(op.scrappedQuantity);
    const rejected = Q(op.rejectedQuantity);
    const rework = Q(op.reworkQuantity);
    const transferredOut = Q(op.transferredOutQuantity);
    acc.waiting = acc.waiting.plus(received).plus(rework).minus(input);
    acc.processing = acc.processing.plus(input).minus(produced).minus(scrap).minus(rejected).minus(rework);
    acc.ready = acc.ready.plus(produced).minus(transferredOut);
    acc.total = acc.total.plus(received).minus(transferredOut).minus(scrap).minus(rejected);
    acc.scrap = acc.scrap.plus(scrap);
    acc.rejected = acc.rejected.plus(rejected);
    if (op.wipSinceAt) {
      const h = Math.max(0, (now - op.wipSinceAt.getTime()) / 3_600_000);
      acc.maxAgingHours = acc.maxAgingHours === null ? h : Math.max(acc.maxAgingHours, h);
    }
    map.set(pid, acc);
  }
  return map;
}

/** Usable FG stock per part (OWNED + APPROVED in FG warehouses) minus ACTIVE reservations. */
async function fgAvailableByPart(partId?: string): Promise<Map<string, { usable: D; consignment: D; quarantined: D }>> {
  const fgIds = await fgWarehouseIds();
  if (fgIds.length === 0) return new Map();
  const [balances, reservations] = await Promise.all([
    db.stockBalance.groupBy({
      by: ['partId', 'ownership', 'qualityStatus'],
      _sum: { quantity: true },
      where: { warehouseId: { in: fgIds }, partId: { not: null }, ...(partId ? { partId } : {}) },
    }),
    db.inventoryReservation.groupBy({
      by: ['partId'],
      _sum: { quantity: true },
      where: { status: 'ACTIVE', partId: { not: null }, ...(partId ? { partId } : {}) },
    }),
  ]);
  const usable = new Map<string, D>();
  const consignment = new Map<string, D>();
  const quarantined = new Map<string, D>();
  for (const b of balances) {
    if (!b.partId) continue;
    if (b.ownership === 'OWNED' && b.qualityStatus === 'APPROVED') {
      usable.set(b.partId, (usable.get(b.partId) ?? ZERO).plus(Q(b._sum.quantity)));
    } else if (b.ownership === 'SUPPLIER_CONSIGNMENT' && b.qualityStatus === 'APPROVED') {
      consignment.set(b.partId, (consignment.get(b.partId) ?? ZERO).plus(Q(b._sum.quantity)));
    } else {
      quarantined.set(b.partId, (quarantined.get(b.partId) ?? ZERO).plus(Q(b._sum.quantity)));
    }
  }
  const reserved = new Map<string, D>();
  for (const r of reservations) if (r.partId) reserved.set(r.partId, Q(r._sum.quantity));
  const out = new Map<string, { usable: D; consignment: D; quarantined: D }>();
  const keys = new Set([...usable.keys(), ...consignment.keys(), ...quarantined.keys(), ...reserved.keys()]);
  for (const k of keys) {
    out.set(k, {
      usable: (usable.get(k) ?? ZERO).minus(reserved.get(k) ?? ZERO),
      consignment: consignment.get(k) ?? ZERO,
      quarantined: quarantined.get(k) ?? ZERO,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1) plan vs actual
// ---------------------------------------------------------------------------

export async function planVsActual(f: { from?: string; to?: string; partId?: string; customerId?: string }): Promise<ReportTable> {
  const plans = await db.productionPlan.findMany({
    where: {
      status: { in: ['CONFIRMED', 'RELEASED', 'CLOSED'] },
      ...(f.from ? { periodStart: { gte: new Date(`${f.from}T00:00:00.000Z`) } } : {}),
      ...(f.to ? { periodEnd: { lte: endOfDay(new Date(`${f.to}T00:00:00.000Z`)) } } : {}),
    },
    select: { id: true, planNumber: true, version: true, status: true, periodStart: true, periodEnd: true },
    orderBy: { periodStart: 'desc' },
    take: 200,
  });
  const planIds = plans.map((p) => p.id);
  const lines = planIds.length
    ? await db.productionPlanLine.findMany({
        where: { planId: { in: planIds }, ...(f.partId ? { partId: f.partId } : {}) },
        include: {
          part: { select: { partNumber: true, nameFa: true } },
          plan: { select: { planNumber: true, version: true, status: true } },
          customerOrderLine: { select: { order: { select: { customerId: true, orderNumber: true } } } },
          manufacturingOrders: { select: { id: true, moNumber: true, status: true, quantity: true, operations: { orderBy: { sequence: 'desc' }, take: 1, select: { producedQuantity: true } } } },
        },
        orderBy: { lineNo: 'asc' },
        take: 1000,
      })
    : [];

  const rows: Record<string, unknown>[] = [];
  for (const l of lines) {
    if (f.customerId && l.customerOrderLine?.order.customerId !== f.customerId) continue;
    const planned = Q(l.plannedQuantity);
    const moQty = l.manufacturingOrders.reduce((acc, mo) => acc.plus(Q(mo.quantity)), ZERO);
    // ACTUAL: final-operation produced quantity aggregated by confirmed production reports
    const actual = l.manufacturingOrders.reduce((acc, mo) => acc.plus(mo.operations[0] ? Q(mo.operations[0].producedQuantity) : ZERO), ZERO);
    rows.push({
      planNumber: l.plan.planNumber,
      planVersion: l.plan.version,
      planStatus: l.plan.status,
      lineNo: l.lineNo,
      part: `${l.part.partNumber} — ${l.part.nameFa}`,
      orderNumber: l.customerOrderLine?.order.orderNumber ?? '—',
      plannedQuantity: qty(planned),
      coveredByStock: qty(l.coveredByStock),
      coveredByReservations: qty(l.coveredByReservations),
      coveredByWip: qty(l.coveredByWip),
      coveredByPlannedMos: qty(l.coveredByPlannedMos),
      moCreatedQuantity: qty(moQty),
      actualQuantity: qty(actual),
      variance: qty(actual.minus(planned)),
      variancePct: planned.comparedTo(0) !== 0 ? Math.round(actual.minus(planned).div(planned).mul(100).toNumber() * 10) / 10 : null,
      dueDate: l.dueDate ? isoDate(l.dueDate) : null,
      _drill: drill('plan_line', l.id, `ردیف ${l.lineNo} برنامه ${l.plan.planNumber}`),
    });
  }

  const columns: ReportColumn[] = [
    { key: 'planNumber', labelFa: 'شماره برنامه', kind: 'IDENTIFIER' },
    { key: 'planVersion', labelFa: 'نسخه', kind: 'IDENTIFIER' },
    { key: 'planStatus', labelFa: 'وضعیت برنامه', kind: 'INFO' },
    { key: 'lineNo', labelFa: 'ردیف', kind: 'IDENTIFIER' },
    { key: 'part', labelFa: 'قطعه', kind: 'IDENTIFIER' },
    { key: 'orderNumber', labelFa: 'سفارش مشتری', kind: 'IDENTIFIER' },
    { key: 'plannedQuantity', labelFa: 'برنامه‌ریزی‌شده', kind: 'PLANNED', unit: 'عدد' },
    { key: 'coveredByStock', labelFa: 'پوشش موجودی', kind: 'PLANNED', unit: 'عدد' },
    { key: 'coveredByReservations', labelFa: 'پوشش رزرو', kind: 'PLANNED', unit: 'عدد' },
    { key: 'coveredByWip', labelFa: 'پوشش WIP', kind: 'PLANNED', unit: 'عدد' },
    { key: 'coveredByPlannedMos', labelFa: 'پوشش دستور کار باز', kind: 'PLANNED', unit: 'عدد' },
    { key: 'moCreatedQuantity', labelFa: 'دستور کار ایجادشده', kind: 'PLANNED', unit: 'عدد' },
    { key: 'actualQuantity', labelFa: 'تولید واقعی (آخرین عملیات)', kind: 'ACTUAL', unit: 'عدد' },
    { key: 'variance', labelFa: 'انحراف', kind: 'INFO', unit: 'عدد' },
    { key: 'variancePct', labelFa: 'انحراف ٪', kind: 'INFO' },
    { key: 'dueDate', labelFa: 'سررسید', kind: 'INFO' },
    { key: '_drill', labelFa: 'جزئیات منبع', kind: 'INFO' },
  ];

  return table('plan-vs-actual', 'برنامه تولید در مقابل عملکرد واقعی', columns, rows, meta(f, [
    'تولید واقعی = مجموع تولید آخرین عملیات دستور کارهای مرتبط با ردیف برنامه (فقط گزارش‌های تأییدشده که در تراکنش دیتابیس تجمیع شده‌اند).',
    'مقادیر «پوشش» خروجی موتور برنامه‌ریزی در زمان ساخت برنامه‌اند و با وضعیت فعلی موجودی/WIP به‌روزرسانی نمی‌شوند.',
  ]));
}

// ---------------------------------------------------------------------------
// 2) customer order fulfillment
// ---------------------------------------------------------------------------

export async function orderFulfillment(f: { from?: string; to?: string; partId?: string; customerId?: string }): Promise<ReportTable> {
  const lines = await db.customerOrderLine.findMany({
    where: {
      partId: f.partId,
      order: {
        customerId: f.customerId,
        status: { notIn: ['CANCELLED'] },
        ...(f.from ? { orderDate: { gte: new Date(`${f.from}T00:00:00.000Z`) } } : {}),
        ...(f.to ? { orderDate: { lte: endOfDay(new Date(`${f.to}T00:00:00.000Z`)) } } : {}),
      },
    },
    include: {
      order: { select: { orderNumber: true, orderDate: true, status: true, customer: { select: { nameFa: true } } } },
      part: { select: { partNumber: true, nameFa: true } },
    },
    orderBy: [{ order: { orderDate: 'desc' } }, { lineNo: 'asc' }],
    take: 1000,
  });

  const today = new Date(`${isoDate(new Date())}T00:00:00.000Z`);
  const rows = lines.map((l) => {
    const ordered = Q(l.quantity);
    const delivered = Q(l.deliveredQuantity);
    const open = ordered.minus(delivered);
    const overdue = open.comparedTo(0) > 0 && l.dueDate !== null && l.dueDate.getTime() < today.getTime();
    return {
      orderNumber: l.order.orderNumber,
      customer: l.order.customer.nameFa,
      orderStatus: l.order.status,
      lineNo: l.lineNo,
      part: `${l.part.partNumber} — ${l.part.nameFa}`,
      orderDate: isoDate(l.order.orderDate),
      dueDate: l.dueDate ? isoDate(l.dueDate) : null,
      orderedQuantity: qty(ordered),
      deliveredQuantity: qty(delivered),
      openQuantity: qty(open),
      fulfillmentPct: ordered.comparedTo(0) !== 0 ? Math.round(delivered.div(ordered).mul(100).toNumber() * 10) / 10 : null,
      lineStatus: l.status,
      overdue,
      _drill: drill('order_line', l.id, `ردیف ${l.lineNo} سفارش ${l.order.orderNumber}`),
    };
  });

  const columns: ReportColumn[] = [
    { key: 'orderNumber', labelFa: 'شماره سفارش', kind: 'IDENTIFIER' },
    { key: 'customer', labelFa: 'مشتری', kind: 'IDENTIFIER' },
    { key: 'orderStatus', labelFa: 'وضعیت سفارش', kind: 'INFO' },
    { key: 'lineNo', labelFa: 'ردیف', kind: 'IDENTIFIER' },
    { key: 'part', labelFa: 'قطعه', kind: 'IDENTIFIER' },
    { key: 'orderDate', labelFa: 'تاریخ سفارش', kind: 'INFO' },
    { key: 'dueDate', labelFa: 'سررسید', kind: 'INFO' },
    { key: 'orderedQuantity', labelFa: 'مقدار سفارش', kind: 'ACTUAL', unit: 'عدد' },
    { key: 'deliveredQuantity', labelFa: 'تحویل‌شده', kind: 'ACTUAL', unit: 'عدد' },
    { key: 'openQuantity', labelFa: 'باقی‌مانده', kind: 'INFO', unit: 'عدد' },
    { key: 'fulfillmentPct', labelFa: 'اقلا ٪', kind: 'INFO' },
    { key: 'lineStatus', labelFa: 'وضعیت ردیف', kind: 'INFO' },
    { key: 'overdue', labelFa: 'سررسید گذشته', kind: 'INFO' },
    { key: '_drill', labelFa: 'جزئیات منبع', kind: 'INFO' },
  ];

  return table('order-fulfillment', 'اقلای سفارش‌های مشتری', columns, rows, meta(f, [
    'تحویل‌شده از فیلد واقعی ردیف سفارش خوانده می‌شود؛ سامانه تاریخ تحویل ثبت نمی‌کند، بنابراین «تحویل در سررسید» محاسبه نمی‌شود (عدم فرض ساختگی).',
    '«سررسید گذشته» یعنی باقی‌مانده‌ای وجود دارد و تاریخ سررسید قبل از امروز است.',
  ]));
}

// ---------------------------------------------------------------------------
// 3) production backlog
// ---------------------------------------------------------------------------

export async function backlog(f: { partId?: string; customerId?: string }): Promise<ReportTable> {
  const orderLines = await db.customerOrderLine.findMany({
    where: {
      status: { in: OPEN_LINE_STATUSES },
      partId: f.partId,
      order: { status: { in: OPEN_ORDER_STATUSES }, customerId: f.customerId },
    },
    select: { partId: true, quantity: true, deliveredQuantity: true, dueDate: true },
    take: 10000,
  });
  const openMos = await db.manufacturingOrder.groupBy({
    by: ['partId'],
    _sum: { quantity: true },
    where: { status: { in: OPEN_MO_STATUSES }, partId: f.partId, ...(f.customerId ? { planLine: { customerOrderLine: { order: { customerId: f.customerId } } } } : {}) },
  });

  const demandByPart = new Map<string, D>();
  const earliestDue = new Map<string, Date | null>();
  for (const l of orderLines) {
    const open = Q(l.quantity).minus(Q(l.deliveredQuantity));
    if (open.comparedTo(0) <= 0) continue;
    demandByPart.set(l.partId, (demandByPart.get(l.partId) ?? ZERO).plus(open));
    const cur = earliestDue.get(l.partId);
    if (l.dueDate && (cur === undefined || cur === null || l.dueDate.getTime() < cur.getTime())) earliestDue.set(l.partId, l.dueDate);
    else if (!earliestDue.has(l.partId)) earliestDue.set(l.partId, null);
  }

  const [wip, fg] = await Promise.all([wipByPart(f.partId), fgAvailableByPart(f.partId)]);
  const moByPart = new Map<string, D>();
  for (const m of openMos) moByPart.set(m.partId, Q(m._sum.quantity));

  const parts = await db.part.findMany({
    where: { id: { in: [...demandByPart.keys(), ...moByPart.keys()] } },
    select: { id: true, partNumber: true, nameFa: true },
  });
  const partById = new Map(parts.map((p) => [p.id, p]));

  const rows: Record<string, unknown>[] = [];
  const keys = new Set<string>([...demandByPart.keys(), ...moByPart.keys()]);
  for (const pid of keys) {
    const part = partById.get(pid);
    if (!part) continue;
    const openOrders = demandByPart.get(pid) ?? ZERO;
    const w = wip.get(pid);
    const g = fg.get(pid);
    const openMo = moByPart.get(pid) ?? ZERO;
    const wipTotal = w?.total ?? ZERO;
    const fgUsable = g?.usable ?? ZERO;
    const coverage = fgUsable.plus(wipTotal).plus(openMo);
    rows.push({
      part: `${part.partNumber} — ${part.nameFa}`,
      openOrderQuantity: qty(openOrders),
      earliestDueDate: earliestDue.has(pid) && earliestDue.get(pid) ? isoDate(earliestDue.get(pid)!) : null,
      openMoQuantity: qty(openMo),
      wipQuantity: qty(wipTotal),
      finishedGoodsUsable: qty(fgUsable),
      finishedGoodsConsignment: qty(g?.consignment ?? ZERO),
      coverageQuantity: qty(coverage),
      uncoveredBacklog: qty(openOrders.minus(coverage)),
      coveredFully: openOrders.minus(coverage).comparedTo(0) <= 0,
    });
  }
  rows.sort((a, b) => String(a.part).localeCompare(String(b.part), 'fa'));

  const columns: ReportColumn[] = [
    { key: 'part', labelFa: 'قطعه', kind: 'IDENTIFIER' },
    { key: 'openOrderQuantity', labelFa: 'تقاضای باز سفارش‌ها', kind: 'ACTUAL', unit: 'عدد' },
    { key: 'earliestDueDate', labelFa: 'نزدیک‌ترین سررسید', kind: 'INFO' },
    { key: 'openMoQuantity', labelFa: 'دستور کار باز', kind: 'ACTUAL', unit: 'عدد' },
    { key: 'wipQuantity', labelFa: 'WIP (کل)', kind: 'ACTUAL', unit: 'عدد' },
    { key: 'finishedGoodsUsable', labelFa: 'موجودی قابل استفاده محصول', kind: 'ACTUAL', unit: 'عدد' },
    { key: 'finishedGoodsConsignment', labelFa: 'موجودی امانی (غیرقابل استفاده)', kind: 'ACTUAL', unit: 'عدد' },
    { key: 'coverageQuantity', labelFa: 'پوشش کل', kind: 'INFO', unit: 'عدد' },
    { key: 'uncoveredBacklog', labelFa: 'کار پوشش‌نیافته', kind: 'INFO', unit: 'عدد' },
    { key: 'coveredFully', labelFa: 'پوشش کامل؟', kind: 'INFO' },
  ];

  return table('backlog', 'کار در انتظار تولید (Backlog)', columns, rows, meta(f, [
    'موجودی قابل استفاده = انبارهای محصول تکمیلی با مالکیت مالی و تأیید کیفیت منهای رزروهای فعال (منبع: موجودی رسمی).',
    'این گزارش نمایشی است؛ قطع‌بوش دقیق (ضریب ضایعات مسیر و اولویت ردیف‌ها) با موتور برنامه‌ریزی انجام می‌شود.',
  ]));
}

// ---------------------------------------------------------------------------
// 4) WIP by part and operation
// ---------------------------------------------------------------------------

export async function wipByPartOperation(f: { partId?: string; operationId?: string }): Promise<ReportTable> {
  const ops = await db.productionOperation.findMany({
    where: {
      manufacturingOrder: { status: { in: ACTIVE_MO_STATUSES }, partId: f.partId },
      operationId: f.operationId,
    },
    include: {
      operation: { select: { code: true, nameFa: true } },
      manufacturingOrder: { select: { moNumber: true, partId: true, part: { select: { partNumber: true, nameFa: true } } } },
    },
    orderBy: [{ manufacturingOrder: { moNumber: 'asc' } }, { sequence: 'asc' }],
    take: 5000,
  });

  const group = new Map<string, {
    part: string; partId: string; operationCode: string; operationName: string;
    waiting: D; processing: D; ready: D; total: D; ops: number; maxAging: number | null;
  }>();
  for (const op of ops) {
    const key = `${op.manufacturingOrder.part.partNumber}|${op.operation.code}`;
    const g = group.get(key) ?? {
      part: `${op.manufacturingOrder.part.partNumber} — ${op.manufacturingOrder.part.nameFa}`,
      partId: op.manufacturingOrder.partId,
      operationCode: op.operation.code,
      operationName: op.operation.nameFa,
      waiting: ZERO, processing: ZERO, ready: ZERO, total: ZERO, ops: 0, maxAging: null as number | null,
    };
    const received = Q(op.receivedQuantity);
    const input = Q(op.inputQuantity);
    const produced = Q(op.producedQuantity);
    const scrap = Q(op.scrappedQuantity);
    const rejected = Q(op.rejectedQuantity);
    const rework = Q(op.reworkQuantity);
    const out = Q(op.transferredOutQuantity);
    g.waiting = g.waiting.plus(received).plus(rework).minus(input);
    g.processing = g.processing.plus(input).minus(produced).minus(scrap).minus(rejected).minus(rework);
    g.ready = g.ready.plus(produced).minus(out);
    g.total = g.total.plus(received).minus(out).minus(scrap).minus(rejected);
    g.ops += 1;
    if (op.wipSinceAt) {
      const h = Math.max(0, (Date.now() - op.wipSinceAt.getTime()) / 3_600_000);
      g.maxAging = g.maxAging === null ? h : Math.max(g.maxAging, h);
    }
    group.set(key, g);
  }

  const rows = [...group.values()]
    .sort((a, b) => a.part.localeCompare(b.part, 'fa') || a.operationCode.localeCompare(b.operationCode))
    .map((g) => ({
      part: g.part,
      operation: `${g.operationCode} — ${g.operationName}`,
      operationCount: g.ops,
      waitingToProcess: qty(g.waiting),
      processing: qty(g.processing),
      readyForTransfer: qty(g.ready),
      wipTotal: qty(g.total),
      maxAgingHours: g.maxAging === null ? null : Math.round(g.maxAging * 10) / 10,
      conservationCheck: qty(g.waiting.plus(g.processing).plus(g.ready)),
      _drill: drill('wip_part_operation', `${g.partId}|${g.operationCode}`, `${g.part} / ${g.operationCode}`),
    }));

  const columns: ReportColumn[] = [
    { key: 'part', labelFa: 'قطعه', kind: 'IDENTIFIER' },
    { key: 'operation', labelFa: 'عملیات', kind: 'IDENTIFIER' },
    { key: 'operationCount', labelFa: 'تعداد عملیات فعال', kind: 'INFO' },
    { key: 'waitingToProcess', labelFa: 'در انتظار پردازش', kind: 'ACTUAL', unit: 'عدد' },
    { key: 'processing', labelFa: 'در جریان پردازش', kind: 'ACTUAL', unit: 'عدد' },
    { key: 'readyForTransfer', labelFa: 'آماده انتقال', kind: 'ACTUAL', unit: 'عدد' },
    { key: 'wipTotal', labelFa: 'جمع WIP', kind: 'ACTUAL', unit: 'عدد' },
    { key: 'maxAgingHours', labelFa: 'قداره حداکثری (ساعت)', kind: 'ACTUAL' },
    { key: 'conservationCheck', labelFa: 'کنترل حفظ کمیت (انتظار = جمع WIP)', kind: 'INFO', unit: 'عدد' },
    { key: '_drill', labelFa: 'جزئیات منبع', kind: 'INFO' },
  ];

  const notes = [
    'فرمول‌ها با داشبورد WIP یکسان است: در انتظار = رسیده + بازکار − تغذیه؛ در جریان = تغذیه − تولید − ضایعات − مردود − بازکار؛ آماده انتقال = تولید − منتقل‌شده.',
  ];
  if (ops.length >= 5000) notes.push('توجه: تعداد عملیات به سقف پرس‌وجو (۵۰۰۰) رسید؛ ممکن است بخشی از داده‌ها نمایش داده نشده باشد.');

  return table('wip-by-part-operation', 'قطعات در جریان ساخت به تفکیک قطعه و عملیات', columns, rows, meta(f, notes));
}

// ---------------------------------------------------------------------------
// 5) WIP aging
// ---------------------------------------------------------------------------

export async function wipAging(f: { partId?: string; operationId?: string }): Promise<ReportTable> {
  const ops = await db.productionOperation.findMany({
    where: {
      manufacturingOrder: { status: { in: ACTIVE_MO_STATUSES }, partId: f.partId },
      operationId: f.operationId,
    },
    include: {
      operation: { select: { code: true, nameFa: true } },
      manufacturingOrder: { select: { moNumber: true, part: { select: { partNumber: true, nameFa: true } } } },
      machine: { select: { code: true } },
    },
    orderBy: { wipSinceAt: 'asc' },
    take: 5000,
  });

  const now = Date.now();
  const buckets = { under24h: 0, from24to72h: 0, from72to168h: 0, over168h: 0, unknown: 0 };
  const rows: Record<string, unknown>[] = [];
  for (const op of ops) {
    const received = Q(op.receivedQuantity);
    const input = Q(op.inputQuantity);
    const produced = Q(op.producedQuantity);
    const scrap = Q(op.scrappedQuantity);
    const rejected = Q(op.rejectedQuantity);
    const rework = Q(op.reworkQuantity);
    const out = Q(op.transferredOutQuantity);
    const wipTotal = received.minus(out).minus(scrap).minus(rejected);
    if (wipTotal.comparedTo(0) <= 0) continue;

    let agingHours: number | null = null;
    let bucket = 'unknown';
    if (op.wipSinceAt) {
      agingHours = Math.max(0, (now - op.wipSinceAt.getTime()) / 3_600_000);
      if (agingHours < 24) { bucket = 'under24h'; buckets.under24h += 1; }
      else if (agingHours < 72) { bucket = 'from24to72h'; buckets.from24to72h += 1; }
      else if (agingHours < 168) { bucket = 'from72to168h'; buckets.from72to168h += 1; }
      else { bucket = 'over168h'; buckets.over168h += 1; }
    } else {
      buckets.unknown += 1;
    }
    rows.push({
      moNumber: op.manufacturingOrder.moNumber,
      part: `${op.manufacturingOrder.part.partNumber} — ${op.manufacturingOrder.part.nameFa}`,
      sequence: op.sequence,
      operation: `${op.operation.code} — ${op.operation.nameFa}`,
      machine: op.machine?.code ?? null,
      wipTotal: qty(wipTotal),
      readyForTransfer: qty(produced.minus(out)),
      waitingToProcess: qty(received.plus(rework).minus(input)),
      agingHours: agingHours === null ? null : Math.round(agingHours * 10) / 10,
      agingBucket: bucket,
      agingKnown: agingHours !== null,
      _drill: drill('wip_operation', op.id, `${op.manufacturingOrder.moNumber} / ${op.operation.code}`),
    });
  }

  const columns: ReportColumn[] = [
    { key: 'moNumber', labelFa: 'دستور کار', kind: 'IDENTIFIER' },
    { key: 'part', labelFa: 'قطعه', kind: 'IDENTIFIER' },
    { key: 'sequence', labelFa: 'ترتیب', kind: 'IDENTIFIER' },
    { key: 'operation', labelFa: 'عملیات', kind: 'IDENTIFIER' },
    { key: 'machine', labelFa: 'ماشین', kind: 'IDENTIFIER' },
    { key: 'wipTotal', labelFa: 'جمع WIP', kind: 'ACTUAL', unit: 'عدد' },
    { key: 'readyForTransfer', labelFa: 'آماده انتقال', kind: 'ACTUAL', unit: 'عدد' },
    { key: 'waitingToProcess', labelFa: 'در انتظار پردازش', kind: 'ACTUAL', unit: 'عدد' },
    { key: 'agingHours', labelFa: 'قداره (ساعت)', kind: 'ACTUAL' },
    { key: 'agingBucket', labelFa: 'بازه سنی', kind: 'INFO' },
    { key: 'agingKnown', labelFa: 'قداره مشخص است؟', kind: 'INFO' },
    { key: '_drill', labelFa: 'جزئیات منبع', kind: 'INFO' },
  ];

  const notes = [
    'قداره از زمانی که WIP عملیات از صفر بزرگ شد (wip_since_at) محاسبه می‌شود.',
    'ردیف‌هایی که مبنای قداره ندارند صریحاً علامت خورده‌اند (قداره نامشخص) — بدون فرض.',
    `خلاصه سنی: زیر ۲۴ ساعت: ${buckets.under24h} | ۲۴ تا ۷۲ ساعت: ${buckets.from24to72h} | ۷۲ تا ۱۶۸ ساعت: ${buckets.from72to168h} | بیش از ۱۶۸ ساعت: ${buckets.over168h} | نامشخص: ${buckets.unknown}`,
  ];
  if (ops.length >= 5000) notes.push('توجه: تعداد عملیات به سقف پرس‌وجو (۵۰۰۰) رسید؛ ممکن است بخشی از داده‌ها نمایش داده نشده باشد.');

  return table('wip-aging', 'قداره قطعات در جریان ساخت', columns, rows, meta(f, notes));
}

// ---------------------------------------------------------------------------
// 6) material consumption vs standard
// ---------------------------------------------------------------------------

export async function materialConsumption(f: { from?: string; to?: string; materialId?: string; partId?: string }): Promise<ReportTable> {
  const { period, defaultApplied } = resolvePeriod(f.from, f.to);
  const occurredAt = { ...(period.from ? { gte: period.from } : {}), ...(period.to ? { lte: period.to } : {}) };
  const dateWhere = Object.keys(occurredAt).length ? { occurredAt } : {};

  // ACTUAL consumption: posted issue transactions (immutable ledger)
  const consumption = await db.inventoryTransaction.groupBy({
    by: ['materialId'],
    _sum: { quantity: true, weightKg: true },
    where: { materialId: { not: null }, type: { in: CONSUMPTION_TX }, ...(f.materialId ? { materialId: f.materialId } : {}), ...dateWhere },
  });

  // ACTUAL production basis: FG receipts of parts in the same period
  const fgIds = await fgWarehouseIds();
  const produced = fgIds.length
    ? await db.inventoryTransaction.groupBy({
        by: ['partId'],
        _sum: { quantity: true },
        where: { partId: { not: null }, type: 'RECEIPT', warehouseId: { in: fgIds }, ...(f.partId ? { partId: f.partId } : {}), ...dateWhere },
      })
    : [];
  const producedByPart = new Map<string, D>();
  for (const p of produced) if (p.partId) producedByPart.set(p.partId, Q(p._sum.quantity));

  const bom = await db.partMaterialRequirement.findMany({
    where: { partId: { in: [...producedByPart.keys()] }, ...(f.materialId ? { materialId: f.materialId } : {}) },
    select: { partId: true, materialId: true, quantityPerUnit: true, weightKgPerUnit: true, part: { select: { partNumber: true } } },
  });

  const [materials, allParts] = await Promise.all([
    db.material.findMany({ where: f.materialId ? { id: f.materialId } : {}, select: { id: true, materialCode: true, nameFa: true, baseUnit: { select: { code: true } } } }),
    db.part.findMany({ where: { id: { in: [...producedByPart.keys()] } }, select: { id: true, partNumber: true, nameFa: true } }),
  ]);
  const matById = new Map(materials.map((m) => [m.id, m]));
  const partById = new Map(allParts.map((p) => [p.id, p]));

  // parts produced in the period WITHOUT any BOM row → surfaced, never assumed
  const partsWithBom = new Set(bom.map((b) => b.partId));
  const missingBomParts = [...producedByPart.keys()].filter((pid) => !partsWithBom.has(pid));

  const standardByMaterial = new Map<string, { qty: D; kg: D | null; basisParts: string[] }>();
  for (const b of bom) {
    const producedQty = producedByPart.get(b.partId);
    if (!producedQty) continue;
    const cur = standardByMaterial.get(b.materialId) ?? { qty: ZERO, kg: null, basisParts: [] as string[] };
    cur.qty = cur.qty.plus(producedQty.mul(Q(b.quantityPerUnit)));
    if (b.weightKgPerUnit !== null) cur.kg = (cur.kg ?? ZERO).plus(producedQty.mul(Q(b.weightKgPerUnit)));
    cur.basisParts.push(partById.get(b.partId)?.partNumber ?? b.partId);
    standardByMaterial.set(b.materialId, cur);
  }

  const consumedParts: string[] = [...producedByPart.keys()]
    .map((pid) => partById.get(pid)?.partNumber ?? pid)
    .sort();

  const keys = new Set<string>([...consumption.map((c) => c.materialId as string), ...standardByMaterial.keys()]);
  const rows: Record<string, unknown>[] = [];
  for (const mid of keys) {
    const m = matById.get(mid);
    if (!m) continue;
    const cons = consumption.find((c) => c.materialId === mid);
    const consSum = cons?._sum;
    const actualQty = Q(consSum?.quantity ?? 0);
    const actualKg = consSum?.weightKg == null ? null : Q(consSum.weightKg);
    const std = standardByMaterial.get(mid);
    const stdQty = std?.qty ?? null;
    rows.push({
      material: `${m.materialCode} — ${m.nameFa}`,
      unit: m.baseUnit.code,
      actualConsumedQuantity: qty(actualQty),
      actualConsumedKg: actualKg === null ? null : qty(actualKg),
      standardQuantity: stdQty === null ? null : qty(stdQty),
      standardKg: std?.kg == null ? null : qty(std.kg),
      varianceQuantity: stdQty === null ? null : qty(actualQty.minus(stdQty)),
      varianceKg: std?.kg == null || actualKg === null ? null : qty(actualKg.minus(std.kg)),
      standardBasisParts: std ? std.basisParts.join('، ') : null,
      standardKnown: stdQty !== null,
      _drill: drill('material_consumption_group', mid, `مصرف ${m.materialCode}`),
    });
  }
  rows.sort((a, b) => String(a.material).localeCompare(String(b.material), 'fa'));

  const columns: ReportColumn[] = [
    { key: 'material', labelFa: 'ماده اولیه', kind: 'IDENTIFIER' },
    { key: 'unit', labelFa: 'واحد', kind: 'IDENTIFIER' },
    { key: 'actualConsumedQuantity', labelFa: 'مصرف واقعی (مقدار)', kind: 'ACTUAL' },
    { key: 'actualConsumedKg', labelFa: 'مصرف واقعی (kg)', kind: 'ACTUAL', unit: 'kg' },
    { key: 'standardQuantity', labelFa: 'سرانه استاندارد (مقدار)', kind: 'STANDARD' },
    { key: 'standardKg', labelFa: 'سرانه استاندارد (kg)', kind: 'STANDARD', unit: 'kg' },
    { key: 'varianceQuantity', labelFa: 'انحراف مقدار', kind: 'INFO' },
    { key: 'varianceKg', labelFa: 'انحراف kg', kind: 'INFO', unit: 'kg' },
    { key: 'standardBasisParts', labelFa: 'مبنای استاندارد (قطعات تولیدی)', kind: 'INFO' },
    { key: 'standardKnown', labelFa: 'سرانه قابل محاسبه؟', kind: 'INFO' },
    { key: '_drill', labelFa: 'جزئیات منبع', kind: 'INFO' },
  ];

  const notes = [
    'مصرف واقعی = حواله‌های قطع‌بوش‌شده (تراکنش ISSUE — شامل حواله تولید و حواله انبار) از دفتر کل تغییرناپذیر.',
    'سرانه استاندارد = تولید واقعی انبار محصول (رسیدهای قطع‌بوش‌شده) × سرانه BOM هر قطعه.',
    'مبنا تولید دوره: ' + (consumedParts.length ? consumedParts.join('، ') : 'تولیدی ثبت نشده است'),
  ];
  if (defaultApplied) notes.push('بازه پیش‌فرض: ۳۰ روز گذشته (بدون فیلتر تاریخ از سوی کاربر).');
  if (missingBomParts.length) {
    notes.push(
      'قطعات تولیدی بدون BOM (سرانه قابل محاسبه نیست): ' +
        missingBomParts.map((pid) => partById.get(pid)?.partNumber ?? pid).join('، '),
    );
  }

  return table('material-consumption', 'مصرف ماده اولیه در مقابل سرانه استاندارد', columns, rows, meta(f, notes, defaultApplied ? { from: isoDate(period.from!), to: isoDate(period.to!), basisFa: '۳۰ روز گذشته' } : undefined));
}

// ---------------------------------------------------------------------------
// 7) SAPCO material account (kg)
// ---------------------------------------------------------------------------

export async function sapcoAccount(f: { from?: string; to?: string; materialId?: string }): Promise<ReportTable> {
  // explicit 30-day default when the caller passes no range (stated in meta below)
  const { period, defaultApplied } = resolvePeriod(f.from, f.to);
  const from = period.from;
  const to = period.to;
  const periodWhere = {
    ...(f.materialId ? { materialId: f.materialId } : {}),
    ...(from || to ? { occurredAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
  };
  const beforeWhere = { ...(f.materialId ? { materialId: f.materialId } : {}), ...(from ? { occurredAt: { lt: from } } : {}) };

  const [periodGroups, openingGroups, materials, balances, contracts] = await Promise.all([
    db.inventoryTransaction.groupBy({
      by: ['materialId', 'type'],
      _sum: { quantity: true, weightKg: true },
      where: { ...periodWhere, materialId: { not: null } },
    }),
    db.inventoryTransaction.groupBy({
      by: ['materialId'],
      _sum: { quantity: true, weightKg: true },
      where: { ...beforeWhere, materialId: { not: null } },
    }),
    db.material.findMany({
      where: f.materialId ? { id: f.materialId } : {},
      select: { id: true, materialCode: true, nameFa: true, baseUnit: { select: { code: true } } },
    }),
    db.stockBalance.groupBy({
      by: ['materialId', 'ownership'],
      _sum: { quantity: true, weightKg: true },
      where: { materialId: { not: null }, ...(f.materialId ? { materialId: f.materialId } : {}) },
    }),
    db.materialContract.findMany({
      where: { status: { in: ['OPEN', 'PARTIALLY_RECEIVED'] }, materialId: f.materialId },
      select: { materialId: true, totalWeightKg: true, transactions: { select: { weightKg: true } } },
    }),
  ]);

  const openingByMat = new Map<string, D>();
  for (const g of openingGroups) if (g.materialId) openingByMat.set(g.materialId, Q(g._sum.weightKg));

  const typeByMat = new Map<string, Map<string, D>>();
  for (const g of periodGroups) {
    if (!g.materialId) continue;
    const m = typeByMat.get(g.materialId) ?? new Map<string, D>();
    m.set(g.type, Q(g._sum.weightKg));
    typeByMat.set(g.materialId, m);
  }

  const balanceOwned = new Map<string, D>();
  const balanceConsignment = new Map<string, D>();
  for (const b of balances) {
    if (!b.materialId) continue;
    if (b.ownership === 'OWNED') balanceOwned.set(b.materialId, Q(b._sum.weightKg));
    else balanceConsignment.set(b.materialId, Q(b._sum.weightKg));
  }

  const contractRemaining = new Map<string, D>();
  for (const c of contracts) {
    const received = c.transactions.reduce((acc, t) => acc.plus(Q(t.weightKg)), ZERO);
    const total = c.totalWeightKg === null ? ZERO : Q(c.totalWeightKg);
    contractRemaining.set(c.materialId, (contractRemaining.get(c.materialId) ?? ZERO).plus(total.minus(received)));
  }

  const rows: Record<string, unknown>[] = [];
  for (const m of materials) {
    const types = typeByMat.get(m.id) ?? new Map<string, D>();
    const sumOf = (list: string[]) => list.reduce((acc, t) => acc.plus(types.get(t) ?? ZERO), ZERO);
    const opening = openingByMat.get(m.id) ?? ZERO;
    const receipts = sumOf(['RECEIPT', 'TRANSFER_IN']);
    const consumption = sumOf(CONSUMPTION_TX);
    const adjustments = sumOf(['ADJUSTMENT_IN']).minus(sumOf(['ADJUSTMENT_OUT']));
    const closing = opening.plus(receipts).minus(consumption).plus(adjustments);

    rows.push({
      materialId: m.id,
      material: `${m.materialCode} — ${m.nameFa}`,
      unit: 'kg',
      openingKg: qty(opening),
      receiptsKg: qty(receipts),
      consumptionKg: qty(consumption),
      adjustmentsKg: qty(adjustments),
      closingKg: qty(closing),
      balanceOwnedKg: qty(balanceOwned.get(m.id) ?? ZERO),
      balanceConsignmentKg: qty(balanceConsignment.get(m.id) ?? ZERO),
      closingMatchesLedger: true,
      openContractRemainingKg: qty(contractRemaining.get(m.id) ?? ZERO),
      hasMovements: types.size > 0 || opening.comparedTo(0) !== 0,
      _drill: drill('sapco_material', m.id, `حساب ${m.materialCode}`),
    });
  }
  rows.sort((a, b) => String(a.material).localeCompare(String(b.material), 'fa'));

  // reconciliation column: closing must equal signed ledger up to "to"
  const ledgerTo = await ledgerTotalsByDims({ materialId: { not: null }, ...(f.materialId ? { materialId: f.materialId } : {}), ...(to ? { occurredAt: { lte: to } } : {}) });
  const matById = new Map(materials.map((m) => [m.id, m]));
  const ledgerClosing = new Map<string, D>();
  for (const [key, totals] of ledgerTo) {
    const mid = key.split('|')[1];
    if (mid && matById.has(mid)) ledgerClosing.set(mid, (ledgerClosing.get(mid) ?? ZERO).plus(totals.weightKg));
  }
  for (const r of rows) {
    const m = matById.get(String(r.materialId));
    if (!m) continue;
    const ledgerQty = ledgerClosing.get(m.id) ?? ZERO;
    r.closingMatchesLedger = dec(String(r.closingKg) || 0).minus(ledgerQty).abs().comparedTo('0.0001') <= 0;
  }

  const columns: ReportColumn[] = [
    { key: 'material', labelFa: 'ماده اولیه', kind: 'IDENTIFIER' },
    { key: 'unit', labelFa: 'واحد', kind: 'IDENTIFIER' },
    { key: 'openingKg', labelFa: 'افتتاحیه', kind: 'ACTUAL', unit: 'kg' },
    { key: 'receiptsKg', labelFa: 'دریافتی دوره', kind: 'ACTUAL', unit: 'kg' },
    { key: 'consumptionKg', labelFa: 'مصرف دوره', kind: 'ACTUAL', unit: 'kg' },
    { key: 'adjustmentsKg', labelFa: 'تعدیلات دوره', kind: 'ACTUAL', unit: 'kg' },
    { key: 'closingKg', labelFa: 'پایانی دوره', kind: 'INFO', unit: 'kg' },
    { key: 'balanceOwnedKg', labelFa: 'موجودی فعلی مالی', kind: 'ACTUAL', unit: 'kg' },
    { key: 'balanceConsignmentKg', labelFa: 'موجودی فعلی امانی تأمین‌کننده', kind: 'ACTUAL', unit: 'kg' },
    { key: 'closingMatchesLedger', labelFa: 'تطبیق با دفتر کل', kind: 'INFO' },
    { key: 'openContractRemainingKg', labelFa: 'باقی‌مانده قراردادهای باز', kind: 'PLANNED', unit: 'kg' },
    { key: 'hasMovements', labelFa: 'گردش دارد؟', kind: 'INFO' },
    { key: '_drill', labelFa: 'جزئیات منبع', kind: 'INFO' },
  ];


  const notes = [
    'همه ارقام کیلوگرمی و از دفتر کل تراکنش‌های قطع‌بوش‌شده است؛ افتتاحیه = جمع دفتر کل قبل از ابتدای دوره.',
    'ستون «پایانی دوره» = افتتاحیه + دریافتی − مصرف + تعدیلات و با جمع دفتر کل تا پایان دوره تطبیق داده می‌شود.',
    'موجودی امانی (SUPPLIER_CONSIGNMENT) جدا از موجودی مالی نشان داده می‌شود (الزام تأمین‌کننده خارجی).',
  ];
  if (defaultApplied) notes.push('بازه پیش‌فرض: ۳۰ روز گذشته (بدون فیلتر تاریخ از سوی کاربر)؛ افتتاحیه همچنان کل سابقه قبل از ابتدای دوره را در بر می‌گیرد.');

  return table('sapco-account', 'حساب مواد تأمین‌کننده (کیلوگرمی)', columns, rows, meta(f, notes, defaultApplied ? { from: isoDate(period.from!), to: isoDate(period.to!), basisFa: '۳۰ روز گذشته' } : undefined));
}

// ---------------------------------------------------------------------------
// 8) inventory valuation (quantities only — no financial valuation rules)
// ---------------------------------------------------------------------------

export async function inventoryValuation(f: { partId?: string; materialId?: string; warehouseId?: string }): Promise<ReportTable> {
  const balances = await db.stockBalance.findMany({
    where: { partId: f.partId, materialId: f.materialId, warehouseId: f.warehouseId },
    include: {
      part: { select: { partNumber: true, nameFa: true } },
      material: { select: { materialCode: true, nameFa: true } },
      warehouse: { select: { code: true, nameFa: true, warehouseType: true } },
      location: { select: { code: true, nameFa: true } },
      lot: { select: { lotNumber: true } },
      unit: { select: { code: true } },
    },
    orderBy: [{ warehouseId: 'asc' }, { partId: 'asc' }, { materialId: 'asc' }],
    take: 5000,
  });

  const rows = balances
    .filter((b) => dec(b.quantity).comparedTo(0) !== 0 || dec(b.weightKg).comparedTo(0) !== 0)
    .map((b) => ({
      item: b.part ? `قطعه: ${b.part.partNumber} — ${b.part.nameFa}` : `ماده: ${b.material!.materialCode} — ${b.material!.nameFa}`,
      warehouse: `${b.warehouse.code} — ${b.warehouse.nameFa}`,
      warehouseType: b.warehouse.warehouseType,
      location: b.location ? `${b.location.code} — ${b.location.nameFa}` : '—',
      lot: b.lot?.lotNumber ?? '—',
      unit: b.unit.code,
      ownership: b.ownership,
      qualityStatus: b.qualityStatus,
      quantity: qty(b.quantity),
      weightKg: qty(b.weightKg),
      lastTransactionAt: b.lastTransactionAt ? b.lastTransactionAt.toISOString() : null,
      _drill: drill('inventory_balance', b.id, `موجودی ${b.warehouse.code}`),
    }));

  const columns: ReportColumn[] = [
    { key: 'item', labelFa: 'قلم', kind: 'IDENTIFIER' },
    { key: 'warehouse', labelFa: 'انبار', kind: 'IDENTIFIER' },
    { key: 'warehouseType', labelFa: 'نوع انبار', kind: 'INFO' },
    { key: 'location', labelFa: 'موقعیت', kind: 'IDENTIFIER' },
    { key: 'lot', labelFa: 'لوت', kind: 'IDENTIFIER' },
    { key: 'unit', labelFa: 'واحد', kind: 'IDENTIFIER' },
    { key: 'ownership', labelFa: 'مالکیت', kind: 'INFO' },
    { key: 'qualityStatus', labelFa: 'وضعیت کیفیت', kind: 'INFO' },
    { key: 'quantity', labelFa: 'مقدار', kind: 'ACTUAL' },
    { key: 'weightKg', labelFa: 'وزن', kind: 'ACTUAL', unit: 'kg' },
    { key: 'lastTransactionAt', labelFa: 'آخرین تراکنش', kind: 'INFO' },
    { key: '_drill', labelFa: 'جزئیات منبع', kind: 'INFO' },
  ];

  const valNotes = [
    'این گزارش صرفاً کمیت‌ها را نشان می‌دهد؛ سامانه قاعده ارزش‌گذاری مالی (بهای تمام‌شده/FIFO و ...) تعریف نکرده است و هیچ مبلغی ارائه نمی‌شود.',
  ];
  if (balances.length >= 5000) valNotes.push('توجه: تعداد ردیف‌های موجودی به سقف پرس‌وجو (۵۰۰۰) رسید؛ برای داده کامل از فیلتر انبار/قطعه استفاده کنید.');

  return table('inventory-valuation', 'ارزش‌گذاری کمّی موجودی', columns, rows, meta(f, valNotes));
}

// ---------------------------------------------------------------------------
// 9) scrap by part and operation
// ---------------------------------------------------------------------------

export async function scrapReport(f: { from?: string; to?: string; partId?: string; operationId?: string }): Promise<ReportTable> {
  const scraps = await db.productionScrap.findMany({
    where: {
      partId: f.partId,
      operationId: f.operationId,
      scrapDate: { ...(f.from ? { gte: new Date(`${f.from}T00:00:00.000Z`) } : {}), ...(f.to ? { lte: endOfDay(new Date(`${f.to}T00:00:00.000Z`)) } : {}) },
    },
    include: {
      operation: { select: { sequence: true, operation: { select: { code: true, nameFa: true } }, inputQuantity: true, manufacturingOrder: { select: { partId: true, moNumber: true, part: { select: { partNumber: true, nameFa: true } } } } } },
      report: { select: { reportNumber: true } },
    },
    take: 5000,
  });

  const group = new Map<string, {
    partId: string | null; part: string; operationKey: string; operationLabel: string;
    quantity: D; weight: D; count: number; input: D; reasons: Map<string, D>; docRefs: string[];
  }>();
  for (const s of scraps) {
    const op = s.operation;
    const part = op ? `${op.manufacturingOrder.part.partNumber} — ${op.manufacturingOrder.part.nameFa}` : (s.partId ? 'قطعه (بدون عملیات)' : 'نامشخص');
    const partId = op?.manufacturingOrder.partId ?? s.partId ?? null;
    const operationKey = op ? `${op.operation.code}` : '—';
    const operationLabel = op ? `${op.operation.code} — ${op.operation.nameFa}` : '—';
    const key = `${part}|${operationKey}`;
    const g = group.get(key) ?? {
      partId, part, operationKey, operationLabel,
      quantity: ZERO, weight: ZERO, count: 0, input: ZERO, reasons: new Map<string, D>(), docRefs: [] as string[],
    };
    g.quantity = g.quantity.plus(Q(s.quantity));
    g.weight = g.weight.plus(Q(s.weightKg));
    g.count += 1;
    if (op) g.input = g.input.plus(Q(op.inputQuantity));
    g.reasons.set(s.reason, (g.reasons.get(s.reason) ?? ZERO).plus(Q(s.quantity)));
    if (s.report) g.docRefs.push(s.report.reportNumber);
    group.set(key, g);
  }

  const rows = [...group.values()]
    .sort((a, b) => a.part.localeCompare(b.part, 'fa') || a.operationKey.localeCompare(b.operationKey))
    .map((g) => ({
      part: g.part,
      operation: g.operationLabel,
      scrapCount: g.count,
      quantity: qty(g.quantity),
      weightKg: g.weight.comparedTo(0) === 0 ? null : qty(g.weight),
      inputQuantity: g.input.comparedTo(0) === 0 ? null : qty(g.input),
      scrapPctOfInput: g.input.comparedTo(0) > 0 ? Math.round(g.quantity.div(g.input).mul(100).toNumber() * 10) / 10 : null,
      reasons: [...g.reasons.entries()].map(([r, q]) => `${r}: ${fmt(q)}`).join('، '),
      sourceReports: [...new Set(g.docRefs)].slice(0, 10).join('، '),
      _drill: drill('scrap_group', `${g.partId ?? ''}|${g.operationKey}|${f.from ?? ''}|${f.to ?? ''}`, `ضایعات ${g.part} / ${g.operationKey}`),
    }));

  const columns: ReportColumn[] = [
    { key: 'part', labelFa: 'قطعه', kind: 'IDENTIFIER' },
    { key: 'operation', labelFa: 'عملیات', kind: 'IDENTIFIER' },
    { key: 'scrapCount', labelFa: 'تعداد رکورد', kind: 'INFO' },
    { key: 'quantity', labelFa: 'مقدار ضایعات', kind: 'ACTUAL', unit: 'عدد' },
    { key: 'weightKg', labelFa: 'وزن', kind: 'ACTUAL', unit: 'kg' },
    { key: 'inputQuantity', labelFa: 'ورودی عملیات', kind: 'ACTUAL', unit: 'عدد' },
    { key: 'scrapPctOfInput', labelFa: 'سهم از ورودی ٪', kind: 'INFO' },
    { key: 'reasons', labelFa: 'علت‌ها (مقدار)', kind: 'INFO' },
    { key: 'sourceReports', labelFa: 'گزارش‌های منبع', kind: 'IDENTIFIER' },
    { key: '_drill', labelFa: 'جزئیات منبع', kind: 'INFO' },
  ];

  return table('scrap', 'ضایعات به تفکیک قطعه و عملیات', columns, rows, meta(f, [
    'سهم از ورودی = ضایعات گروه ÷ کل ورودی تغذیه‌شده همان عملیات‌ها (فقط ورودی واقعی ثبت‌شده).',
  ]));
}

// ---------------------------------------------------------------------------
// 10) machine workload & available capacity
// ---------------------------------------------------------------------------

export async function machineWorkload(f: { from?: string; to?: string; machineId?: string }): Promise<ReportTable> {
  const { period, defaultApplied } = resolvePeriod(f.from, f.to);
  const utilRows = await machineUtilization(period, f.machineId);
  const rows = utilRows.map((u) => ({
    machine: `${u.machineCode} — ${u.machineNameFa}`,
    machineStatus: u.machineStatus,
    openAssignments: u.openAssignments,
    plannedMinutes: u.plannedMinutesKnown,
    plannedAssignmentsMissingDates: u.plannedAssignmentsMissingDates,
    actualProducedQuantity: u.actualProducedQuantity,
    standardMinutes: u.standardMinutes,
    availableMinutes: u.availableMinutes,
    utilizationPct: u.utilizationPct,
    capacityReliable: u.capacityReliable,
    reasonFa: u.reasonFa,
    _drill: drill('machine_period', `${u.machineId}|${period.from ? isoDate(period.from) : ''}|${period.to ? isoDate(period.to) : ''}`, `بار کاری ${u.machineCode}`),
  }));

  const columns: ReportColumn[] = [
    { key: 'machine', labelFa: 'ماشین', kind: 'IDENTIFIER' },
    { key: 'machineStatus', labelFa: 'وضعیت', kind: 'INFO' },
    { key: 'openAssignments', labelFa: 'تخصیص‌های باز', kind: 'ACTUAL' },
    { key: 'plannedMinutes', labelFa: 'بار برنامه‌ای شناخته‌شده (دقیقه)', kind: 'ACTUAL' },
    { key: 'plannedAssignmentsMissingDates', labelFa: 'تخصیص بدون بازه زمانی', kind: 'INFO' },
    { key: 'actualProducedQuantity', labelFa: 'تولید واقعی دوره', kind: 'ACTUAL', unit: 'عدد' },
    { key: 'standardMinutes', labelFa: 'زمان استاندارد تولید (دقیقه)', kind: 'ESTIMATED' },
    { key: 'availableMinutes', labelFa: 'ظرفیت موجود دوره (دقیقه)', kind: 'ESTIMATED' },
    { key: 'utilizationPct', labelFa: 'بهره‌وری ٪', kind: 'ESTIMATED' },
    { key: 'capacityReliable', labelFa: 'داده ظرفیت قابل اتکا؟', kind: 'INFO' },
    { key: 'reasonFa', labelFa: 'توضیح', kind: 'INFO' },
    { key: '_drill', labelFa: 'جزئیات منبع', kind: 'INFO' },
  ];

  const notes = [
    'بهره‌وری = (تولید واقعی ÷ نرخ استاندارد ماشین-عملیات) ÷ ظرفیت شیفت‌های فعال دوره — یک تخمین بر پایه زمان استاندارد است، نه اندازه‌گیری سensor.',
    'بهره‌وری فقط برای ماشین‌هایی محاسبه می‌شود که نرخ استاندارد عملیات‌های اجراشده‌شان ثبت شده باشد؛ برای بقیه صریحاً «قابل اتکا نیست» علامت خورده است.',
    'بار برنامه‌ای فقط برای تخصیص‌هایی شمرده می‌شود که تاریخ شروع و پایان هر دو ثبت شده‌اند؛ بقیه در ستون جداگانه آشکار می‌شوند.',
  ];
  if (defaultApplied) notes.push('بازه پیش‌فرض: ۳۰ روز گذشته (بدون فیلتر تاریخ از سوی کاربر).');

  return table('machine-workload', 'بار کاری و ظرفیت موجود ماشین‌آلات', columns, rows, meta(f, notes, defaultApplied ? { from: isoDate(period.from!), to: isoDate(period.to!), basisFa: '۳۰ روز گذشته' } : undefined));
}

// ---------------------------------------------------------------------------
// 11) production delays
// ---------------------------------------------------------------------------

export async function productionDelays(f: { partId?: string; customerId?: string; machineId?: string }): Promise<ReportTable> {
  const today = new Date(`${isoDate(new Date())}T00:00:00.000Z`);
  const DAY = 86_400_000;
  const rows: Record<string, unknown>[] = [];

  // A) customer order lines open past due
  const lateLines = await db.customerOrderLine.findMany({
    where: {
      status: { in: OPEN_LINE_STATUSES },
      partId: f.partId,
      dueDate: { not: null, lt: today },
      order: { status: { in: OPEN_ORDER_STATUSES }, customerId: f.customerId },
    },
    include: {
      order: { select: { orderNumber: true, customer: { select: { nameFa: true } } } },
      part: { select: { partNumber: true, nameFa: true } },
    },
    take: 1000,
  });
  for (const l of lateLines) {
    const open = Q(l.quantity).minus(Q(l.deliveredQuantity));
    if (open.comparedTo(0) <= 0) continue;
    rows.push({
      section: 'ردیف سفارش باز',
      reference: l.order.orderNumber,
      customer: l.order.customer.nameFa,
      part: `${l.part.partNumber} — ${l.part.nameFa}`,
      dueDate: l.dueDate ? isoDate(l.dueDate) : null,
      daysLate: Math.max(1, Math.round((today.getTime() - l.dueDate!.getTime()) / DAY)),
      openQuantity: qty(open),
      hasScheduleDates: null,
      _drill: drill('order_line', l.id, `ردیف سفارش ${l.order.orderNumber}`),
    });
  }

  // B) open MOs past due
  const lateMos = await db.manufacturingOrder.findMany({
    where: { status: { in: OPEN_MO_STATUSES }, partId: f.partId, dueDate: { not: null, lt: today } },
    include: { part: { select: { partNumber: true, nameFa: true } } },
    take: 1000,
  });
  for (const mo of lateMos) {
    rows.push({
      section: 'دستور کار باز',
      reference: mo.moNumber,
      customer: null,
      part: `${mo.part.partNumber} — ${mo.part.nameFa}`,
      dueDate: mo.dueDate ? isoDate(mo.dueDate) : null,
      daysLate: Math.max(1, Math.round((today.getTime() - mo.dueDate!.getTime()) / DAY)),
      openQuantity: qty(mo.quantity),
      hasScheduleDates: null,
      _drill: drill('mo_detail', mo.id, `دستور کار ${mo.moNumber}`),
    });
  }

  // C) MOs completed after their due date (real completion timestamp; newest first)
  const completedLate = await db.manufacturingOrder.findMany({
    where: { status: { in: ['COMPLETED', 'CLOSED'] }, partId: f.partId, dueDate: { not: null }, completedAt: { not: null } },
    include: { part: { select: { partNumber: true, nameFa: true } } },
    orderBy: { completedAt: 'desc' },
    take: 1000,
  });
  for (const mo of completedLate) {
    const dueEnd = endOfDay(mo.dueDate!);
    if (mo.completedAt!.getTime() <= dueEnd.getTime()) continue;
    rows.push({
      section: 'تکمیل‌شده با تأخیر',
      reference: mo.moNumber,
      customer: null,
      part: `${mo.part.partNumber} — ${mo.part.nameFa}`,
      dueDate: mo.dueDate ? isoDate(mo.dueDate) : null,
      daysLate: Math.max(1, Math.ceil((mo.completedAt!.getTime() - dueEnd.getTime()) / DAY)),
      openQuantity: qty(mo.quantity),
      hasScheduleDates: null,
      _drill: drill('mo_detail', mo.id, `دستور کار ${mo.moNumber}`),
    });
  }

  // D) operations not completed past their planned end (only where plannedEnd exists)
  const lateOps = await db.productionOperation.findMany({
    where: {
      status: { in: ['PENDING', 'QUEUED', 'IN_PROGRESS', 'PAUSED'] },
      plannedEnd: { not: null, lt: new Date() },
      machineId: f.machineId,
      manufacturingOrder: { partId: f.partId },
    },
    include: {
      operation: { select: { code: true, nameFa: true } },
      machine: { select: { code: true } },
      manufacturingOrder: { select: { moNumber: true, part: { select: { partNumber: true, nameFa: true } } } },
    },
    take: 1000,
  });
  for (const op of lateOps) {
    rows.push({
      section: 'عملیات اجرایی عقب‌افتاده',
      reference: op.manufacturingOrder.moNumber,
      customer: null,
      part: `${op.manufacturingOrder.part.partNumber} — ${op.manufacturingOrder.part.nameFa}`,
      dueDate: isoDate(op.plannedEnd!),
      daysLate: Math.max(1, Math.ceil((Date.now() - op.plannedEnd!.getTime()) / DAY)),
      openQuantity: qty(op.plannedQuantity),
      hasScheduleDates: true,
      machine: op.machine?.code ?? null,
      operation: `${op.operation.code} — ${op.operation.nameFa}`,
      _drill: drill('wip_operation', op.id, `${op.manufacturingOrder.moNumber} / ${op.operation.code}`),
    });
  }

  const columns: ReportColumn[] = [
    { key: 'section', labelFa: 'بخش', kind: 'INFO' },
    { key: 'reference', labelFa: 'مرجع', kind: 'IDENTIFIER' },
    { key: 'customer', labelFa: 'مشتری', kind: 'IDENTIFIER' },
    { key: 'part', labelFa: 'قطعه', kind: 'IDENTIFIER' },
    { key: 'operation', labelFa: 'عملیات', kind: 'IDENTIFIER' },
    { key: 'machine', labelFa: 'ماشین', kind: 'IDENTIFIER' },
    { key: 'dueDate', labelFa: 'سررسید / پایان برنامه', kind: 'INFO' },
    { key: 'daysLate', labelFa: 'روز تأخیر', kind: 'INFO' },
    { key: 'openQuantity', labelFa: 'مقدار باز / برنامه', kind: 'ACTUAL', unit: 'عدد' },
    { key: 'hasScheduleDates', labelFa: 'تاریخ برنامه ثبت‌شده؟', kind: 'INFO' },
    { key: '_drill', labelFa: 'جزئیات منبع', kind: 'INFO' },
  ];

  return table('production-delays', 'تأخیرهای تولید', columns, rows, meta(f, [
    'تأخیر ردیف سفارش/دستور کار نسبت به سررسید واقعی ثبت‌شده محاسبه می‌شود؛ تأخیر عملیات فقط جایی که planned_end ثبت شده است.',
    'دستور کارهایی که بدون سررسید باز مانده‌اند در این گزارش نمی‌آیند — برای شفافیت به گزارش Backlog مراجعه کنید.',
  ]));
}

// ---------------------------------------------------------------------------
// 12) inventory movements
// ---------------------------------------------------------------------------

export async function inventoryMovements(f: { from?: string; to?: string; partId?: string; materialId?: string; warehouseId?: string }): Promise<ReportTable> {
  const { period, defaultApplied } = resolvePeriod(f.from, f.to);
  const where = {
    partId: f.partId,
    materialId: f.materialId,
    warehouseId: f.warehouseId,
    ...(period.from || period.to ? { occurredAt: { ...(period.from ? { gte: period.from } : {}), ...(period.to ? { lte: period.to } : {}) } } : {}),
  };
  const [groups, parts, materials] = await Promise.all([
    db.inventoryTransaction.groupBy({
      by: ['partId', 'materialId', 'type'],
      _sum: { quantity: true, weightKg: true },
      _count: { _all: true },
      where,
    }),
    db.part.findMany({ where: f.partId ? { id: f.partId } : {}, select: { id: true, partNumber: true, nameFa: true } }),
    db.material.findMany({ where: f.materialId ? { id: f.materialId } : {}, select: { id: true, materialCode: true, nameFa: true } }),
  ]);
  const partById = new Map(parts.map((p) => [p.id, p]));
  const matById = new Map(materials.map((m) => [m.id, m]));

  const agg = new Map<string, {
    item: string; itemKind: 'PART' | 'MATERIAL'; id: string;
    in: D; out: D; inKg: D; outKg: D; count: number;
  }>();
  for (const g of groups) {
    const isPart = !!g.partId;
    const id = (g.partId ?? g.materialId)!;
    const item = isPart
      ? `${partById.get(id)?.partNumber ?? '?'} — ${partById.get(id)?.nameFa ?? ''}`
      : `${matById.get(id)?.materialCode ?? '?'} — ${matById.get(id)?.nameFa ?? ''}`;
    const key = `${isPart ? 'P' : 'M'}|${id}`;
    const a = agg.get(key) ?? { item, itemKind: (isPart ? 'PART' : 'MATERIAL') as 'PART' | 'MATERIAL', id, in: ZERO, out: ZERO, inKg: ZERO, outKg: ZERO, count: 0 };
    const sign = TX_SIGN[g.type] ?? 0;
    const q = Q(g._sum.quantity);
    const w = Q(g._sum.weightKg);
    if (sign > 0) { a.in = a.in.plus(q); a.inKg = a.inKg.plus(w); }
    else if (sign < 0) { a.out = a.out.plus(q.abs()); a.outKg = a.outKg.plus(w.abs()); }
    a.count += g._count._all;
    agg.set(key, a);
  }

  const rows = [...agg.values()]
    .sort((a, b) => a.item.localeCompare(b.item, 'fa'))
    .map((a) => ({
      item: a.item,
      itemKind: a.itemKind === 'PART' ? 'قطعه' : 'ماده اولیه',
      transactionCount: a.count,
      inQuantity: qty(a.in),
      outQuantity: qty(a.out),
      netQuantity: qty(a.in.minus(a.out)),
      inKg: a.inKg.comparedTo(0) === 0 ? null : qty(a.inKg),
      outKg: a.outKg.comparedTo(0) === 0 ? null : qty(a.outKg),
      netKg: a.inKg.minus(a.outKg).comparedTo(0) === 0 ? null : qty(a.inKg.minus(a.outKg)),
      _drill: drill('movement_group', `${a.itemKind}|${a.id}|${period.from ? isoDate(period.from) : ''}|${period.to ? isoDate(period.to) : ''}`, `حرکت ${a.item}`),
    }));

  const columns: ReportColumn[] = [
    { key: 'item', labelFa: 'قلم', kind: 'IDENTIFIER' },
    { key: 'itemKind', labelFa: 'نوع قلم', kind: 'INFO' },
    { key: 'transactionCount', labelFa: 'تعداد تراکنش', kind: 'ACTUAL' },
    { key: 'inQuantity', labelFa: 'ورود (مقدار)', kind: 'ACTUAL' },
    { key: 'outQuantity', labelFa: 'خروج (مقدار)', kind: 'ACTUAL' },
    { key: 'netQuantity', labelFa: 'خالص (مقدار)', kind: 'INFO' },
    { key: 'inKg', labelFa: 'ورود (kg)', kind: 'ACTUAL', unit: 'kg' },
    { key: 'outKg', labelFa: 'خروج (kg)', kind: 'ACTUAL', unit: 'kg' },
    { key: 'netKg', labelFa: 'خالص (kg)', kind: 'INFO', unit: 'kg' },
    { key: '_drill', labelFa: 'جزئیات منبع', kind: 'INFO' },
  ];

  const notes = ['مبنای گزارش دفتر کل تغییرناپذیر تراکنش‌های قطع‌بوش‌شده است (پیش‌نویس‌ها اثر ندارند).'];
  if (defaultApplied) notes.push('بازه پیش‌فرض: ۳۰ روز گذشته (بدون فیلتر تاریخ از سوی کاربر).');

  return table('inventory-movements', 'حرکت موجودی انبار', columns, rows, meta(f, notes, defaultApplied ? { from: isoDate(period.from!), to: isoDate(period.to!), basisFa: '۳۰ روز گذشته' } : undefined));
}

// ---------------------------------------------------------------------------
// 13) inventory reconciliation (official balance vs immutable ledger)
// ---------------------------------------------------------------------------

export async function inventoryReconciliation(f: { partId?: string; materialId?: string; warehouseId?: string }): Promise<ReportTable> {
  const balanceWhere = { partId: f.partId, materialId: f.materialId, warehouseId: f.warehouseId };
  const [balances, ledger] = await Promise.all([
    db.stockBalance.findMany({
      where: balanceWhere,
      select: {
        id: true, partId: true, materialId: true, warehouseId: true, locationId: true, lotId: true,
        unitId: true, ownership: true, qualityStatus: true, quantity: true, weightKg: true,
        part: { select: { partNumber: true } }, material: { select: { materialCode: true } },
        warehouse: { select: { code: true } }, location: { select: { code: true } }, lot: { select: { lotNumber: true } },
        unit: { select: { code: true } },
      },
      take: 5000,
    }),
    ledgerTotalsByDims({ partId: f.partId, materialId: f.materialId, warehouseId: f.warehouseId }),
  ]);

  const rows: Record<string, unknown>[] = [];
  let mismatches = 0;
  for (const b of balances) {
    const key = dimsKey({
      partId: b.partId, materialId: b.materialId, warehouseId: b.warehouseId,
      locationId: b.locationId, lotId: b.lotId, unitId: b.unitId, ownership: b.ownership, qualityStatus: b.qualityStatus,
    });
    const l = ledger.get(key) ?? { quantity: ZERO, weightKg: ZERO };
    const diffQty = dec(b.quantity).minus(l.quantity);
    const diffKg = dec(b.weightKg).minus(l.weightKg);
    const matched = diffQty.abs().comparedTo('0.0001') <= 0 && diffKg.abs().comparedTo('0.0001') <= 0;
    if (!matched) mismatches += 1;
    rows.push({
      item: b.part ? `قطعه: ${b.part.partNumber}` : `ماده: ${b.material!.materialCode}`,
      warehouse: b.warehouse.code,
      location: b.location?.code ?? '—',
      lot: b.lot?.lotNumber ?? '—',
      unit: b.unit.code,
      ownership: b.ownership,
      qualityStatus: b.qualityStatus,
      balanceQuantity: qty(b.quantity),
      ledgerQuantity: qty(l.quantity),
      diffQuantity: qty(diffQty),
      balanceKg: qty(b.weightKg),
      ledgerKg: qty(l.weightKg),
      diffKg: qty(diffKg),
      status: matched ? 'MATCH' : 'MISMATCH',
      _drill: drill('inventory_balance', b.id, 'تراکنش‌های این موجودی'),
    });
  }
  rows.sort((a, b) => (a.status === b.status ? String(a.item).localeCompare(String(b.item), 'fa') : a.status === 'MISMATCH' ? -1 : 1));

  const columns: ReportColumn[] = [
    { key: 'item', labelFa: 'قلم', kind: 'IDENTIFIER' },
    { key: 'warehouse', labelFa: 'انبار', kind: 'IDENTIFIER' },
    { key: 'location', labelFa: 'موقعیت', kind: 'IDENTIFIER' },
    { key: 'lot', labelFa: 'لوت', kind: 'IDENTIFIER' },
    { key: 'unit', labelFa: 'واحد', kind: 'IDENTIFIER' },
    { key: 'ownership', labelFa: 'مالکیت', kind: 'INFO' },
    { key: 'qualityStatus', labelFa: 'کیفیت', kind: 'INFO' },
    { key: 'balanceQuantity', labelFa: 'موجودی رسمی', kind: 'ACTUAL' },
    { key: 'ledgerQuantity', labelFa: 'جمع دفتر کل', kind: 'ACTUAL' },
    { key: 'diffQuantity', labelFa: 'اختلاف مقدار', kind: 'INFO' },
    { key: 'balanceKg', labelFa: 'وزن رسمی', kind: 'ACTUAL', unit: 'kg' },
    { key: 'ledgerKg', labelFa: 'وزن دفتر کل', kind: 'ACTUAL', unit: 'kg' },
    { key: 'diffKg', labelFa: 'اختلاف kg', kind: 'INFO', unit: 'kg' },
    { key: 'status', labelFa: 'وضعیت تطبیق', kind: 'INFO' },
    { key: '_drill', labelFa: 'جزئیات منبع', kind: 'INFO' },
  ];

  const recNotes = [
    `تعداد ابعاد بررسی‌شده: ${rows.length} | ناهماهنگ: ${mismatches}`,
    'تطبیق کامل یعنی موجودی رسمی هر بُعد (قلم/انبار/موقعیت/لوت/واحد/مالکیت/کیفیت) با جمع علامت‌دار تراکنش‌های دفتر کل برابر است.',
    'رکورد موجودی بدون هیچ تراکنش دفتر کل (مثلاً ثبت دستی افتتاحیه خارج از سند) به‌عنوان ناهماهنگ آشکار می‌شود.',
  ];
  if (balances.length >= 5000) recNotes.push('توجه: تعداد ردیف‌های موجودی به سقف پرس‌وجو (۵۰۰۰) رسید؛ برای تطبیق کامل از فیلتر انبار/قطعه استفاده کنید.');

  return table('inventory-reconciliation', 'تطبیق موجودی دفتر کل و موجودی رسمی', columns, rows, meta(f, recNotes));
}

// ---------------------------------------------------------------------------
// drill-down: from summary figures to source documents
// ---------------------------------------------------------------------------

const DRILL_KINDS = [
  'plan_line', 'order_line', 'wip_operation', 'wip_part_operation',
  'material_consumption_group', 'sapco_material', 'inventory_balance',
  'scrap_group', 'machine_period', 'movement_group', 'mo_detail',
] as const;

function drillTable(key: string, titleFa: string, columns: ReportColumn[], rows: Record<string, unknown>[], filters: Record<string, string | undefined>, links: { labelFa: string; href: string }[] = []): ReportTable {
  const t = table(key, titleFa, columns, rows, meta(filters, []));
  return { ...t, meta: { ...t.meta, notesFa: links.map((l) => `پیوند: ${l.labelFa} → ${l.href}`) } };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Composite drill ids carry UUID segments — reject handcrafted URLs gracefully (400, not 500). */
function assertUuidSegment(value: string | undefined, kind: string, segment: string): string {
  if (!value || !UUID_RE.test(value)) {
    throw new ApiError(400, `Invalid ${segment} in drill-down id for kind ${kind}`, 'شناسه جزئیات نامعتبر است', 'bad_drill_id');
  }
  return value;
}

function safeDateSegment(value: string | undefined): Date | null {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function drillDown(kind: string, id: string, f: { from?: string; to?: string } = {}): Promise<ReportTable> {
  if (!(DRILL_KINDS as readonly string[]).includes(kind)) {
    throw new ApiError(400, `Unknown drill-down kind: ${kind}`, 'نوع جزئیات نامعتبر است', 'bad_drill_kind');
  }
  const from = f.from ? new Date(`${f.from}T00:00:00.000Z`) : null;
  const to = f.to ? endOfDay(new Date(`${f.to}T00:00:00.000Z`)) : null;

  switch (kind) {
    case 'plan_line': {
      const line = await db.productionPlanLine.findUnique({
        where: { id },
        include: {
          plan: { select: { planNumber: true, version: true, status: true, periodStart: true, periodEnd: true } },
          part: { select: { partNumber: true, nameFa: true } },
          manufacturingOrders: { select: { moNumber: true, status: true, quantity: true, dueDate: true } },
          planOperations: { select: { sequence: true, requiredOutput: true, mustProduce: true, estimatedHours: true, timeSource: true, recommendedMachineCode: true, feasible: true }, orderBy: { sequence: 'asc' } },
          materialShortages: { select: { severity: true, requiredQuantity: true, shortageQuantity: true, material: { select: { materialCode: true } } } },
        },
      });
      if (!line) throw new ApiError(404, 'plan line not found', 'ردیف برنامه یافت نشد', 'not_found');
      const rows: Record<string, unknown>[] = line.manufacturingOrders.map((mo) => ({
        source: 'دستور کار مرتبط',
        reference: mo.moNumber,
        status: mo.status,
        quantity: qty(mo.quantity),
        dueDate: mo.dueDate ? isoDate(mo.dueDate) : null,
      }));
      for (const op of line.planOperations) {
        rows.push({
          source: 'عملیات برنامه (پیشنهاد موتور)',
          reference: `#${op.sequence}`,
          status: op.feasible ? 'قابل اجرا' : 'ناکارآمد',
          quantity: qty(op.mustProduce),
          dueDate: op.timeSource,
          machine: op.recommendedMachineCode,
          estimatedHours: op.estimatedHours === null ? null : fmt(op.estimatedHours),
        });
      }
      for (const s of line.materialShortages) {
        rows.push({
          source: `کسری ماده (${s.severity})`,
          reference: s.material.materialCode,
          status: null,
          quantity: qty(s.shortageQuantity),
          dueDate: `نیاز: ${qty(s.requiredQuantity)}`,
        });
      }
      return drillTable('drill-plan-line', `جزئیات ردیف برنامه ${line.plan.planNumber} #${line.lineNo}`, [
        { key: 'source', labelFa: 'منبع', kind: 'INFO' },
        { key: 'reference', labelFa: 'مرجع', kind: 'IDENTIFIER' },
        { key: 'status', labelFa: 'وضعیت', kind: 'INFO' },
        { key: 'quantity', labelFa: 'مقدار', kind: 'ACTUAL' },
        { key: 'dueDate', labelFa: 'سررسید / منبع زمان', kind: 'INFO' },
        { key: 'machine', labelFa: 'ماشین پیشنهادی', kind: 'INFO' },
        { key: 'estimatedHours', labelFa: 'ساعت تخمینی', kind: 'ESTIMATED' },
      ], rows, f, [
        { labelFa: 'صفحه برنامه', href: `/production-planning/plans/${line.planId}` },
      ]);
    }

    case 'order_line': {
      const line = await db.customerOrderLine.findUnique({
        where: { id },
        include: {
          order: { select: { orderNumber: true, status: true, orderDate: true, customer: { select: { nameFa: true } } } },
          part: { select: { partNumber: true, nameFa: true } },
          reservations: { select: { quantity: true, status: true } },
          planLines: { select: { plan: { select: { planNumber: true, version: true } }, plannedQuantity: true } },
        },
      });
      if (!line) throw new ApiError(404, 'order line not found', 'ردیف سفارش یافت نشد', 'not_found');
      const rows: Record<string, unknown>[] = [
        { source: 'سفارش', reference: line.order.orderNumber, status: line.order.status, quantity: qty(line.quantity), note: `${line.order.customer.nameFa} — تحویل‌شده: ${qty(line.deliveredQuantity)}` },
      ];
      for (const r of line.reservations) rows.push({ source: 'رزرو', reference: '—', status: r.status, quantity: qty(r.quantity), note: null });
      for (const pl of line.planLines) rows.push({ source: 'ردیف برنامه', reference: `${pl.plan.planNumber} (نسخه ${pl.plan.version})`, status: null, quantity: qty(pl.plannedQuantity), note: null });
      return drillTable('drill-order-line', `جزئیات ردیف سفارش ${line.order.orderNumber} #${line.lineNo}`, [
        { key: 'source', labelFa: 'منبع', kind: 'INFO' },
        { key: 'reference', labelFa: 'مرجع', kind: 'IDENTIFIER' },
        { key: 'status', labelFa: 'وضعیت', kind: 'INFO' },
        { key: 'quantity', labelFa: 'مقدار', kind: 'ACTUAL' },
        { key: 'note', labelFa: 'یادداشت', kind: 'INFO' },
      ], rows, f);
    }

    case 'wip_operation': {
      const op = await db.productionOperation.findUnique({
        where: { id },
        include: {
          operation: { select: { code: true, nameFa: true } },
          machine: { select: { code: true } },
          manufacturingOrder: { select: { moNumber: true, part: { select: { partNumber: true } } } },
          reports: { select: { reportNumber: true, reportDate: true, inputQuantity: true, producedQuantity: true, rejectedQuantity: true, reworkQuantity: true, status: true, postingStatus: true }, orderBy: { reportDate: 'desc' }, take: DRILL_TAKE },
          incomingTransfers: { select: { transferNumber: true, quantity: true, transferDate: true, status: true, postingStatus: true }, take: DRILL_TAKE },
          outgoingTransfers: { select: { transferNumber: true, quantity: true, transferDate: true, status: true, postingStatus: true }, take: DRILL_TAKE },
        },
      });
      if (!op) throw new ApiError(404, 'operation not found', 'عملیات یافت نشد', 'not_found');
      const rows: Record<string, unknown>[] = [
        { source: 'دستور کار', reference: op.manufacturingOrder.moNumber, status: op.status, quantity: qty(op.plannedQuantity), note: `قطعه ${op.manufacturingOrder.part.partNumber}` },
      ];
      for (const r of op.reports) {
        rows.push({
          source: 'گزارش تولید',
          reference: r.reportNumber,
          status: `${r.status}/${r.postingStatus}`,
          quantity: qty(r.producedQuantity),
          note: `تاریخ ${isoDate(r.reportDate)} — ورودی ${qty(r.inputQuantity)} مردود ${qty(r.rejectedQuantity)} بازکار ${qty(r.reworkQuantity)}`,
        });
      }
      for (const t of op.incomingTransfers) rows.push({ source: 'انتقال ورودی', reference: t.transferNumber, status: `${t.status}/${t.postingStatus}`, quantity: qty(t.quantity), note: isoDate(t.transferDate) });
      for (const t of op.outgoingTransfers) rows.push({ source: 'انتقال خروجی', reference: t.transferNumber, status: `${t.status}/${t.postingStatus}`, quantity: qty(t.quantity), note: isoDate(t.transferDate) });
      return drillTable('drill-wip-operation', `جزئیات عملیات ${op.manufacturingOrder.moNumber} #${op.sequence} (${op.operation.code})`, [
        { key: 'source', labelFa: 'منبع', kind: 'INFO' },
        { key: 'reference', labelFa: 'مرجع', kind: 'IDENTIFIER' },
        { key: 'status', labelFa: 'وضعیت', kind: 'INFO' },
        { key: 'quantity', labelFa: 'مقدار', kind: 'ACTUAL' },
        { key: 'note', labelFa: 'یادداشت', kind: 'INFO' },
      ], rows, f, [
        { labelFa: 'صفحه دستور کار', href: `/production/mos/${op.manufacturingOrderId}` },
      ]);
    }

    case 'wip_part_operation': {
      const [partId, operationCode] = id.split('|');
      assertUuidSegment(partId, kind, 'partId');
      const ops = await db.productionOperation.findMany({
        where: { manufacturingOrder: { partId: partId!, status: { in: ACTIVE_MO_STATUSES } }, operation: { code: operationCode! } },
        include: { operation: { select: { code: true } }, manufacturingOrder: { select: { moNumber: true } } },
        take: DRILL_TAKE,
      });
      const rows = ops.map((op) => {
        const received = Q(op.receivedQuantity);
        const out = Q(op.transferredOutQuantity);
        const scrap = Q(op.scrappedQuantity);
        const rejected = Q(op.rejectedQuantity);
        return {
          source: 'عملیات فعال',
          reference: `${op.manufacturingOrder.moNumber} #${op.sequence}`,
          status: op.status,
          quantity: qty(received.minus(out).minus(scrap).minus(rejected)),
          note: `آماده انتقال: ${qty(Q(op.producedQuantity).minus(out))}`,
        };
      });
      return drillTable('drill-wip-part-op', `WIP ${operationCode} — تراکنش‌های منبع`, [
        { key: 'source', labelFa: 'منبع', kind: 'INFO' },
        { key: 'reference', labelFa: 'مرجع', kind: 'IDENTIFIER' },
        { key: 'status', labelFa: 'وضعیت', kind: 'INFO' },
        { key: 'quantity', labelFa: 'WIP', kind: 'ACTUAL' },
        { key: 'note', labelFa: 'یادداشت', kind: 'INFO' },
      ], rows, f);
    }

    case 'material_consumption_group': {
      const txs = await db.inventoryTransaction.findMany({
        where: { materialId: id, type: { in: CONSUMPTION_TX }, ...(from || to ? { occurredAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) },
        include: {
          document: { select: { documentNumber: true, documentType: true, documentDate: true } },
          material: { select: { materialCode: true } },
          unit: { select: { code: true } },
          lot: { select: { lotNumber: true } },
        },
        orderBy: { occurredAt: 'desc' },
        take: DRILL_TAKE,
      });
      const rows = txs.map((t) => ({
        source: `${t.document?.documentType ?? 'تراکنش'}`,
        reference: t.document?.documentNumber ?? t.transactionNumber,
        status: isoDate(t.occurredAt),
        quantity: `${fmt(t.quantity)} ${t.unit.code}`,
        note: t.lot?.lotNumber ?? null,
        weightKg: t.weightKg === null ? null : qty(t.weightKg),
      }));
      return drillTable('drill-material-consumption', 'اسناد مصرف ماده (حواله‌ها)', [
        { key: 'source', labelFa: 'نوع سند', kind: 'INFO' },
        { key: 'reference', labelFa: 'شماره سند', kind: 'IDENTIFIER' },
        { key: 'status', labelFa: 'تاریخ', kind: 'INFO' },
        { key: 'quantity', labelFa: 'مقدار', kind: 'ACTUAL' },
        { key: 'weightKg', labelFa: 'وزن', kind: 'ACTUAL', unit: 'kg' },
        { key: 'note', labelFa: 'لوت', kind: 'IDENTIFIER' },
      ], rows, f, [
        { labelFa: 'دفتر کل حرکت موجودی', href: '/inventory/movements' },
      ]);
    }

    case 'sapco_material': {
      const txs = await db.inventoryTransaction.findMany({
        where: { materialId: id, ...(from || to ? { occurredAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) },
        include: {
          document: { select: { documentNumber: true, documentType: true } },
          unit: { select: { code: true } },
          lot: { select: { lotNumber: true } },
        },
        orderBy: { occurredAt: 'desc' },
        take: DRILL_TAKE,
      });
      const rows = txs.map((t) => ({
        source: t.document?.documentType ?? t.type,
        reference: t.document?.documentNumber ?? t.transactionNumber,
        status: t.type,
        quantity: `${fmt(t.quantity)} ${t.unit.code}`,
        weightKg: t.weightKg === null ? null : qty(t.weightKg),
        note: t.lot?.lotNumber ?? null,
      }));
      return drillTable('drill-sapco-material', 'تراکنش‌های ماده (دفتر کل)', [
        { key: 'source', labelFa: 'نوع سند', kind: 'INFO' },
        { key: 'reference', labelFa: 'شماره سند', kind: 'IDENTIFIER' },
        { key: 'status', labelFa: 'نوع تراکنش', kind: 'INFO' },
        { key: 'quantity', labelFa: 'مقدار', kind: 'ACTUAL' },
        { key: 'weightKg', labelFa: 'وزن', kind: 'ACTUAL', unit: 'kg' },
        { key: 'note', labelFa: 'لوت', kind: 'IDENTIFIER' },
      ], rows, f, [
        { labelFa: 'صفحه مواد تأمین‌کننده', href: '/sapco-materials' },
      ]);
    }

    case 'inventory_balance': {
      const b = await db.stockBalance.findUnique({ where: { id }, select: { partId: true, materialId: true, warehouseId: true, locationId: true, lotId: true, unitId: true, ownership: true, qualityStatus: true } });
      if (!b) throw new ApiError(404, 'balance not found', 'موجودی یافت نشد', 'not_found');
      const txs = await db.inventoryTransaction.findMany({
        where: { partId: b.partId ?? undefined, materialId: b.materialId ?? undefined, warehouseId: b.warehouseId, locationId: b.locationId ?? undefined, lotId: b.lotId ?? undefined, unitId: b.unitId, ownership: b.ownership, qualityStatus: b.qualityStatus },
        include: { document: { select: { documentNumber: true, documentType: true } }, unit: { select: { code: true } } },
        orderBy: { occurredAt: 'desc' },
        take: DRILL_TAKE,
      });
      const rows = txs.map((t) => {
        const sign = TX_SIGN[t.type] ?? 0;
        return {
          source: t.document?.documentType ?? t.type,
          reference: t.document?.documentNumber ?? t.transactionNumber,
          status: t.type,
          quantity: `${fmt(Number(t.quantity) * (sign || 1))} ${t.unit.code}`,
          note: isoDate(t.occurredAt),
        };
      });
      return drillTable('drill-inventory-balance', 'تراکنش‌های دفتر کل این موجودی', [
        { key: 'source', labelFa: 'نوع سند', kind: 'INFO' },
        { key: 'reference', labelFa: 'شماره سند', kind: 'IDENTIFIER' },
        { key: 'status', labelFa: 'نوع تراکنش', kind: 'INFO' },
        { key: 'quantity', labelFa: 'مقدار علامت‌دار', kind: 'ACTUAL' },
        { key: 'note', labelFa: 'زمان', kind: 'INFO' },
      ], rows, f, [
        { labelFa: 'دفتر کل حرکت موجودی', href: '/inventory/movements' },
      ]);
    }

    case 'scrap_group': {
      const [partId, operationCode, fFrom, fTo] = id.split('|');
      if (partId) assertUuidSegment(partId, kind, 'partId');
      const scrapRows = await db.productionScrap.findMany({
        where: {
          ...(partId ? { partId } : {}),
          ...(operationCode && operationCode !== '—' ? { operation: { operation: { code: operationCode } } } : {}),
          scrapDate: { ...(fFrom ? { gte: new Date(`${fFrom}T00:00:00.000Z`) } : {}), ...(fTo ? { lte: endOfDay(new Date(`${fTo}T00:00:00.000Z`)) } : {}) },
        },
        include: {
          report: { select: { reportNumber: true } },
          operation: { select: { sequence: true, manufacturingOrder: { select: { moNumber: true } }, operation: { select: { code: true } } } },
        },
        take: DRILL_TAKE,
      });
      const rows = scrapRows.map((s) => ({
        source: s.report?.reportNumber ?? 'بدون گزارش',
        reference: s.operation ? `${s.operation.manufacturingOrder.moNumber} #${s.operation.sequence} (${s.operation.operation.code})` : '—',
        status: s.reason,
        quantity: qty(s.quantity),
        weightKg: s.weightKg === null ? null : qty(s.weightKg),
        note: s.description,
      }));
      return drillTable('drill-scrap-group', 'رکوردهای ضایعات', [
        { key: 'source', labelFa: 'گزارش منبع', kind: 'IDENTIFIER' },
        { key: 'reference', labelFa: 'عملیات', kind: 'IDENTIFIER' },
        { key: 'status', labelFa: 'علت', kind: 'INFO' },
        { key: 'quantity', labelFa: 'مقدار', kind: 'ACTUAL' },
        { key: 'weightKg', labelFa: 'وزن', kind: 'ACTUAL', unit: 'kg' },
        { key: 'note', labelFa: 'توضیح', kind: 'INFO' },
      ], rows, f);
    }

    case 'machine_period': {
      const [machineId, fFrom, fTo] = id.split('|');
      assertUuidSegment(machineId, kind, 'machineId');
      const fromD = safeDateSegment(fFrom);
      const toD = safeDateSegment(fTo);
      const [reports, assignments] = await Promise.all([
        db.productionReport.findMany({
          where: { machineId, postingStatus: 'POSTED', reportDate: { ...(fromD ? { gte: fromD } : {}), ...(toD ? { lte: endOfDay(toD) } : {}) } },
          include: { operation: { select: { sequence: true, manufacturingOrder: { select: { moNumber: true } }, operation: { select: { code: true } } } } },
          orderBy: { reportDate: 'desc' },
          take: DRILL_TAKE,
        }),
        db.machineAssignment.findMany({
          where: { machineId, status: { in: ['PLANNED', 'ACTIVE'] } },
          include: { operation: { select: { manufacturingOrder: { select: { moNumber: true } }, operation: { select: { code: true } } } } },
          orderBy: { plannedStart: 'desc' },
          take: DRILL_TAKE,
        }),
      ]);
      const rows: Record<string, unknown>[] = [];
      for (const r of reports) {
        rows.push({
          source: 'گزارش تولید (قطع‌بوش‌شده)',
          reference: r.reportNumber,
          status: isoDate(r.reportDate),
          quantity: qty(r.producedQuantity),
          note: `${r.operation.manufacturingOrder.moNumber} — ${r.operation.operation.code}`,
        });
      }
      for (const a of assignments) {
        rows.push({
          source: 'تخصیص ماشین',
          reference: a.operation.manufacturingOrder.moNumber,
          status: a.status,
          quantity: null,
          note: `${a.operation.operation.code} — شروع ${a.plannedStart.toISOString()}${a.plannedEnd ? ` تا ${a.plannedEnd.toISOString()}` : ' (پایان ثبت‌نشده)'}`,
        });
      }
      return drillTable('drill-machine-period', 'گزارش‌ها و تخصیص‌های ماشین در دوره', [
        { key: 'source', labelFa: 'منبع', kind: 'INFO' },
        { key: 'reference', labelFa: 'مرجع', kind: 'IDENTIFIER' },
        { key: 'status', labelFa: 'تاریخ/وضعیت', kind: 'INFO' },
        { key: 'quantity', labelFa: 'مقدار', kind: 'ACTUAL' },
        { key: 'note', labelFa: 'یادداشت', kind: 'INFO' },
      ], rows, f);
    }

    case 'movement_group': {
      const [kind2, itemId, fFrom, fTo] = id.split('|');
      assertUuidSegment(itemId, kind, kind2 === 'PART' ? 'partId' : 'materialId');
      const fromD = safeDateSegment(fFrom);
      const toD = safeDateSegment(fTo);
      const txs = await db.inventoryTransaction.findMany({
        where: {
          ...(kind2 === 'PART' ? { partId: itemId } : { materialId: itemId }),
          ...(fromD || toD ? { occurredAt: { ...(fromD ? { gte: fromD } : {}), ...(toD ? { lte: endOfDay(toD) } : {}) } } : {}),
        },
        include: { document: { select: { documentNumber: true, documentType: true } }, unit: { select: { code: true } } },
        orderBy: { occurredAt: 'desc' },
        take: DRILL_TAKE,
      });
      const rows = txs.map((t) => ({
        source: t.document?.documentType ?? t.type,
        reference: t.document?.documentNumber ?? t.transactionNumber,
        status: t.type,
        quantity: `${fmt(t.quantity)} ${t.unit.code}`,
        weightKg: t.weightKg === null ? null : qty(t.weightKg),
        note: isoDate(t.occurredAt),
      }));
      return drillTable('drill-movement-group', 'تراکنش‌های دفتر کل این قلم', [
        { key: 'source', labelFa: 'نوع سند', kind: 'INFO' },
        { key: 'reference', labelFa: 'شماره سند', kind: 'IDENTIFIER' },
        { key: 'status', labelFa: 'نوع تراکنش', kind: 'INFO' },
        { key: 'quantity', labelFa: 'مقدار', kind: 'ACTUAL' },
        { key: 'weightKg', labelFa: 'وزن', kind: 'ACTUAL', unit: 'kg' },
        { key: 'note', labelFa: 'زمان', kind: 'INFO' },
      ], rows, f, [
        { labelFa: 'دفتر کل حرکت موجودی', href: '/inventory/movements' },
      ]);
    }

    case 'mo_detail': {
      const mo = await db.manufacturingOrder.findUnique({
        where: { id },
        include: {
          part: { select: { partNumber: true, nameFa: true } },
          operations: { select: { sequence: true, status: true, plannedQuantity: true, producedQuantity: true, receivedQuantity: true, transferredOutQuantity: true, scrappedQuantity: true, rejectedQuantity: true, operation: { select: { code: true } } }, orderBy: { sequence: 'asc' } },
        },
      });
      if (!mo) throw new ApiError(404, 'MO not found', 'دستور کار یافت نشد', 'not_found');
      const rows = mo.operations.map((op) => ({
        source: `عملیات #${op.sequence}`,
        reference: op.operation.code,
        status: op.status,
        quantity: qty(op.plannedQuantity),
        note: `رسیده ${qty(op.receivedQuantity)} — تولید ${qty(op.producedQuantity)} — منتقل ${qty(op.transferredOutQuantity)} — ضایعات ${qty(op.scrappedQuantity)} — مردود ${qty(op.rejectedQuantity)}`,
      }));
      return drillTable('drill-mo-detail', `عملیات دستور کار ${mo.moNumber}`, [
        { key: 'source', labelFa: 'عملیات', kind: 'IDENTIFIER' },
        { key: 'reference', labelFa: 'کد عملیات', kind: 'IDENTIFIER' },
        { key: 'status', labelFa: 'وضعیت', kind: 'INFO' },
        { key: 'quantity', labelFa: 'مقدار برنامه', kind: 'PLANNED' },
        { key: 'note', labelFa: 'کمیت‌های اجرایی', kind: 'INFO' },
      ], rows, f, [
        { labelFa: 'صفحه دستور کار', href: `/production/mos/${mo.id}` },
      ]);
    }

    default:
      throw new ApiError(400, `Unhandled drill-down kind: ${kind}`, 'نوع جزئیات پشتیبانی نمی‌شود', 'bad_drill_kind');
  }
}

// ---------------------------------------------------------------------------
// Phase 7 — roll/coil (lot) inventory & consumption traceability
// ---------------------------------------------------------------------------

type LotLike = {
  status: string;
  quantityReceived: Prisma.Decimal.Value;
  quantityRemaining: Prisma.Decimal.Value;
  weightReceivedKg: Prisma.Decimal.Value;
  weightRemainingKg: Prisma.Decimal.Value;
};

export type DerivedLotStatus = 'FULL' | 'PARTIAL' | 'CONSUMED' | 'BLOCKED';

export const LOT_STATUS_FA: Record<DerivedLotStatus, string> = {
  FULL: 'سالم (باز)',
  PARTIAL: 'ناقص (بازشده)',
  CONSUMED: 'مصرف‌شده',
  BLOCKED: 'مسدود',
};

/** Roll state derived from real lot balances — never stored, never assumed. */
export function deriveLotStatus(l: LotLike): DerivedLotStatus {
  if (l.status === 'BLOCKED') return 'BLOCKED';
  const remainingKg = Q(l.weightRemainingKg);
  if (l.status === 'CLOSED' || remainingKg.comparedTo(0) <= 0 || Q(l.quantityRemaining).comparedTo(0) <= 0) {
    return 'CONSUMED';
  }
  if (remainingKg.comparedTo(Q(l.weightReceivedKg)) < 0) return 'PARTIAL';
  return 'FULL';
}

interface LotQueryFilters {
  materialId?: string;
  warehouseId?: string;
  lotNumber?: string;
  q?: string;
}

interface LotAggregate {
  id: string;
  lotNumber: string;
  supplierLotNumber: string | null;
  certificateNumber: string | null;
  receiptDate: Date;
  ownership: string;
  status: string;
  derivedStatus: DerivedLotStatus;
  materialId: string;
  materialCode: string;
  materialNameFa: string;
  unitCode: string;
  weightReceivedKg: D;
  weightRemainingKg: D;
  quantityReceived: D;
  quantityRemaining: D;
  contractNumbers: string[];
  locations: { warehouseCode: string; warehouseNameFa: string; locationCode: string | null; locationNameFa: string | null; weightKg: string }[];
}

/** Shared lot fetch+aggregate used by the coil-inventory report and the lots API. */
export async function loadLotAggregates(f: LotQueryFilters, take: number): Promise<LotAggregate[]> {
  const where: Prisma.MaterialLotWhereInput = {};
  if (f.materialId) where.materialId = f.materialId;
  if (f.lotNumber) where.lotNumber = { contains: f.lotNumber };
  if (f.q) {
    const q = f.q.trim();
    const materialIds = (
      await db.material.findMany({
        where: {
          OR: [{ materialCode: { contains: q, mode: 'insensitive' } }, { nameFa: { contains: q } }],
        },
        select: { id: true },
      })
    ).map((m) => m.id);
    where.OR = [
      { lotNumber: { contains: q, mode: 'insensitive' } },
      { supplierLotNumber: { contains: q, mode: 'insensitive' } },
      { certificateNumber: { contains: q, mode: 'insensitive' } },
      ...(materialIds.length > 0 ? [{ materialId: { in: materialIds } }] : []),
    ];
  }

  const lots = await db.materialLot.findMany({
    where,
    orderBy: { receiptDate: 'desc' },
    take,
    include: { material: { select: { materialCode: true, nameFa: true, baseUnit: { select: { code: true } } } } },
  });
  if (lots.length === 0) return [];

  const lotIds = lots.map((l) => l.id);
  const [balances, contractTxs] = await Promise.all([
    db.stockBalance.findMany({
      where: { lotId: { in: lotIds }, ...(f.warehouseId ? { warehouseId: f.warehouseId } : {}) },
      include: {
        warehouse: { select: { code: true, nameFa: true } },
        location: { select: { code: true, nameFa: true } },
      },
    }),
    db.materialContractTransaction.findMany({
      where: { lotId: { in: lotIds } },
      include: { contract: { select: { contractNumber: true } } },
    }),
  ]);

  const balancesByLot = new Map<string, typeof balances>();
  for (const b of balances) {
    if (!b.lotId) continue;
    const list = balancesByLot.get(b.lotId) ?? [];
    list.push(b);
    balancesByLot.set(b.lotId, list);
  }
  const contractsByLot = new Map<string, Set<string>>();
  for (const t of contractTxs) {
    if (!t.lotId) continue;
    const set = contractsByLot.get(t.lotId) ?? new Set<string>();
    set.add(t.contract.contractNumber);
    contractsByLot.set(t.lotId, set);
  }

  return lots
    .filter((l) => (f.warehouseId ? (balancesByLot.get(l.id) ?? []).length > 0 : true))
    .map((l) => {
      const lbs = balancesByLot.get(l.id) ?? [];
      const locations = lbs.map((b) => ({
        warehouseCode: b.warehouse.code,
        warehouseNameFa: b.warehouse.nameFa,
        locationCode: b.location?.code ?? null,
        locationNameFa: b.location?.nameFa ?? null,
        weightKg: fmt(b.weightKg, 3),
      }));
      return {
        id: l.id,
        lotNumber: l.lotNumber,
        supplierLotNumber: l.supplierLotNumber,
        certificateNumber: l.certificateNumber,
        receiptDate: l.receiptDate,
        ownership: l.ownership,
        status: l.status,
        derivedStatus: deriveLotStatus(l),
        materialId: l.materialId,
        materialCode: l.material.materialCode,
        materialNameFa: l.material.nameFa,
        unitCode: l.material.baseUnit.code,
        weightReceivedKg: Q(l.weightReceivedKg),
        weightRemainingKg: Q(l.weightRemainingKg),
        quantityReceived: Q(l.quantityReceived),
        quantityRemaining: Q(l.quantityRemaining),
        contractNumbers: [...(contractsByLot.get(l.id) ?? [])],
        locations,
      };
    });
}

/** گزارش موجودی رول‌ها/کویل‌ها — per-lot ACTUAL weights + derived status. */
export async function coilInventory(f: ReportFilters): Promise<ReportTable> {
  const lots = await loadLotAggregates({ materialId: f.materialId, warehouseId: f.warehouseId, lotNumber: f.lotNumber, q: f.q }, 2000);

  const rows = lots.map((l) => {
    const received = l.weightReceivedKg;
    const remaining = l.weightRemainingKg;
    const consumed = received.minus(remaining);
    return {
      lotNumber: l.lotNumber,
      materialCode: l.materialCode,
      materialNameFa: l.materialNameFa,
      receiptDate: isoDate(l.receiptDate),
      derivedStatus: LOT_STATUS_FA[l.derivedStatus],
      weightReceivedKg: fmt(received, 3),
      weightRemainingKg: fmt(remaining, 3),
      consumedKg: fmt(consumed, 3),
      consumptionPct: received.comparedTo(0) > 0 ? `${consumed.div(received).mul(100).toFixed(1)}٪` : '—',
      ownership: l.ownership === 'SUPPLIER_CONSIGNMENT' ? 'امانی تأمین‌کننده' : 'مالی خود',
      contract: l.contractNumbers.join('، ') || '',
      location: l.locations.map((x) => `${x.warehouseCode}${x.locationCode ? ` / ${x.locationCode}` : ''}`).join('، '),
    };
  });

  const count = (s: DerivedLotStatus) => lots.filter((l) => l.derivedStatus === s).length;
  const totalRemaining = lots.reduce((a, l) => a.plus(l.weightRemainingKg), ZERO);
  const totalReceived = lots.reduce((a, l) => a.plus(l.weightReceivedKg), ZERO);

  const m = meta(
    { materialId: f.materialId, warehouseId: f.warehouseId, lotNumber: f.lotNumber, q: f.q },
    [
      `جمع رول‌ها: ${lots.length} — سالم ${count('FULL')} — ناقص ${count('PARTIAL')} — مصرف‌شده ${count('CONSUMED')} — مسدود ${count('BLOCKED')}`,
      `جمع وزن دریافتی: ${fmt(totalReceived, 3)} کیلوگرم — جمع باقی‌مانده: ${fmt(totalRemaining, 3)} کیلوگرم`,
      'وضعیت هر رول از موجودی واقعی لوت محاسبه شده است (سالم: بدون مصرف — ناقص: مصرف جزئی — مصرف‌شده: باقی‌مانده صفر).',
    ],
  );

  return table(
    'coil-inventory',
    'موجودی رول‌ها و کویل‌های ماده اولیه',
    [
      { key: 'lotNumber', labelFa: 'شماره رول/لوت', kind: 'IDENTIFIER' },
      { key: 'materialCode', labelFa: 'کد ماده', kind: 'IDENTIFIER' },
      { key: 'materialNameFa', labelFa: 'نام ماده', kind: 'IDENTIFIER' },
      { key: 'receiptDate', labelFa: 'تاریخ رسید', kind: 'INFO' },
      { key: 'derivedStatus', labelFa: 'وضعیت رول', kind: 'INFO' },
      { key: 'weightReceivedKg', labelFa: 'وزن دریافتی', kind: 'ACTUAL', unit: 'kg' },
      { key: 'weightRemainingKg', labelFa: 'وزن باقی‌مانده', kind: 'ACTUAL', unit: 'kg' },
      { key: 'consumedKg', labelFa: 'جمع مصرف', kind: 'ACTUAL', unit: 'kg' },
      { key: 'consumptionPct', labelFa: 'درصد مصرف', kind: 'ACTUAL' },
      { key: 'ownership', labelFa: 'مالکیت', kind: 'INFO' },
      { key: 'contract', labelFa: 'قرارداد', kind: 'IDENTIFIER' },
      { key: 'location', labelFa: 'انبار/موقعیت', kind: 'IDENTIFIER' },
    ],
    rows,
    m,
  );
}

/** گزارش ردیابی مصرف رول/لوت — real ISSUE ledger rows with purpose, per lot. */
export async function lotConsumption(f: ReportFilters): Promise<ReportTable> {
  const period = resolvePeriod(f.from, f.to);
  const occurredAt: Record<string, Date> = {};
  if (period.period.from) occurredAt.gte = period.period.from;
  if (period.period.to) occurredAt.lte = period.period.to;

  const lotWhere: Prisma.MaterialLotWhereInput = {
    ...(f.materialId ? { materialId: f.materialId } : {}),
    ...(f.lotNumber ? { lotNumber: { contains: f.lotNumber } } : {}),
  };
  const lots = await db.materialLot.findMany({
    where: lotWhere,
    select: { id: true, lotNumber: true },
    take: 2000,
  });
  const lotIds = lots.map((l) => l.id);
  const lotNumberById = new Map(lots.map((l) => [l.id, l.lotNumber]));

  const txs = lotIds.length
    ? await db.inventoryTransaction.findMany({
        where: {
          lotId: { in: lotIds },
          occurredAt,
          // consumption = ISSUE rows plus their reversal receipts (corrections)
          OR: [{ type: 'ISSUE' }, { type: 'RECEIPT', reversalOfId: { not: null } }],
        },
        orderBy: [{ occurredAt: 'asc' }, { transactionNumber: 'asc' }],
        include: {
          document: {
            select: {
              documentNumber: true,
              documentType: true,
              description: true,
              referenceType: true,
              referenceId: true,
              lines: { select: { notes: true } },
            },
          },
          warehouse: { select: { code: true, nameFa: true } },
          reversalOf: { select: { transactionNumber: true, type: true } },
        },
      })
    : [];

  // resolve ManufacturingOrder references for real purpose labels
  const moIds = [
    ...new Set(
      txs
        .map((t) => (t.document?.referenceType === 'MANUFACTURING_ORDER' ? t.document.referenceId : null))
        .filter((v): v is string => typeof v === 'string'),
    ),
  ];
  const mos = moIds.length
    ? await db.manufacturingOrder.findMany({ where: { id: { in: moIds } }, select: { id: true, moNumber: true } })
    : [];
  const moById = new Map(mos.map((x) => [x.id, x.moNumber]));

  const rows = txs.map((t) => {
    const isReversal = t.type === 'RECEIPT' && t.reversalOfId !== null;
    const purpose =
      t.document?.lines.map((l) => l.notes).find((n) => n && n.trim() !== '')?.trim() ||
      t.document?.description?.trim() ||
      '';
    const ref = t.document?.referenceType === 'MANUFACTURING_ORDER' && t.document.referenceId
      ? moById.get(t.document.referenceId) ?? 'دستور کار'
      : t.document?.referenceType ?? '';
    return {
      date: isoDate(t.occurredAt),
      lotNumber: t.lotId ? lotNumberById.get(t.lotId) ?? '' : '',
      kind: isReversal ? 'ابطال حواله (برگشت به انبار)' : 'مصرف (حواله)',
      weightKg: isReversal ? `-${fmt(t.weightKg, 3)}` : fmt(t.weightKg, 3),
      quantity: fmt(t.quantity, 2),
      documentNumber: t.document?.documentNumber ?? t.transactionNumber,
      documentType: t.document?.documentType ?? '',
      purpose,
      reference: ref,
      warehouse: t.warehouse.code,
    };
  });

  const consumptionRows = txs.filter((t) => t.type === 'ISSUE');
  const reversalRows = txs.filter((t) => t.type !== 'ISSUE');
  const totalConsumed = consumptionRows.reduce((a, t) => a.plus(Q(t.weightKg ?? 0)), ZERO);
  const totalReversed = reversalRows.reduce((a, t) => a.plus(Q(t.weightKg ?? 0)), ZERO);
  const perLot = new Map<string, D>();
  for (const t of consumptionRows) {
    if (!t.lotId) continue;
    perLot.set(t.lotId, (perLot.get(t.lotId) ?? ZERO).plus(Q(t.weightKg ?? 0)));
  }
  const perLotFa = [...perLot.entries()]
    .map(([id, w]) => `${lotNumberById.get(id) ?? id}: ${fmt(w, 3)} کیلوگرم`)
    .slice(0, 30);

  const m = meta(
    { from: f.from, to: f.to, materialId: f.materialId, lotNumber: f.lotNumber },
    [
      `تعداد حواله مصرف: ${consumptionRows.length} — جمع مصرف: ${fmt(totalConsumed, 3)} کیلوگرم`,
      `تعداد ابطال (برگشت به انبار): ${reversalRows.length} — جمع ابطال: ${fmt(totalReversed, 3)} کیلوگرم`,
      'مصرف خالص هر رول = جمع حواله‌ها − جمع ابطال‌ها؛ این رقم باید با تفاضل وزن دریافتی و باقی‌مانده همان لوت برابر باشد.',
      ...(perLotFa.length > 0 ? ['مصرف به تفکیک رول:', ...perLotFa] : []),
    ],
    period.defaultApplied
      ? {
          from: isoDate(period.period.from!),
          to: isoDate(period.period.to!),
          basisFa: 'بازه پیش‌فرض: ۳۰ روز گذشته (بدون ورودی کاربر)',
        }
      : undefined,
  );

  return table(
    'lot-consumption',
    'ردیابی مصرف رول/لوت',
    [
      { key: 'date', labelFa: 'تاریخ', kind: 'INFO' },
      { key: 'lotNumber', labelFa: 'شماره رول/لوت', kind: 'IDENTIFIER' },
      { key: 'kind', labelFa: 'نوع', kind: 'INFO' },
      { key: 'weightKg', labelFa: 'وزن', kind: 'ACTUAL', unit: 'kg' },
      { key: 'quantity', labelFa: 'مقدار', kind: 'ACTUAL' },
      { key: 'documentNumber', labelFa: 'سند انبار', kind: 'IDENTIFIER' },
      { key: 'documentType', labelFa: 'نوع سند', kind: 'IDENTIFIER' },
      { key: 'purpose', labelFa: 'کاربرد/مقصد', kind: 'INFO' },
      { key: 'reference', labelFa: 'مرجع', kind: 'INFO' },
      { key: 'warehouse', labelFa: 'انبار', kind: 'IDENTIFIER' },
    ],
    rows,
    m,
  );
}

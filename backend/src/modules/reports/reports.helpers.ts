/**
 * KPIMS — Phase 5 reports: shared helpers.
 */
import { Prisma, InventoryTxType } from '@prisma/client';
import { db } from '../../config/db';
import { toJalaliDateString } from '../../lib/jalali';
import { VALUE_KIND_FA, type ReportColumn, type ReportMeta, type ReportTable, type ValueKind } from './reports.types';

export const D = Prisma.Decimal;
export const dec = (v: Prisma.Decimal.Value | null | undefined): Prisma.Decimal => new D(v ?? 0);
export const ZERO = new D(0);

/** Quantities render with up to 4 decimals, trimmed — strings keep Decimal precision end-to-end. */
export function fmt(v: Prisma.Decimal.Value | null | undefined, places = 2): string {
  if (v === null || v === undefined) return '';
  const d = dec(v);
  return d.toFixed(places);
}

/** Sign of an inventory ledger transaction type. */
export const TX_SIGN: Record<string, 1 | -1> = {
  RECEIPT: 1,
  TRANSFER_IN: 1,
  ADJUSTMENT_IN: 1,
  ISSUE: -1,
  TRANSFER_OUT: -1,
  ADJUSTMENT_OUT: -1,
};

export const INFLOW_TX: InventoryTxType[] = ['RECEIPT', 'TRANSFER_IN', 'ADJUSTMENT_IN'];
export const OUTFLOW_TX: InventoryTxType[] = ['ISSUE', 'TRANSFER_OUT', 'ADJUSTMENT_OUT'];
/** Consumption = posted issue transactions (PRODUCTION_ISSUE documents post as ISSUE). */
export const CONSUMPTION_TX: InventoryTxType[] = ['ISSUE'];

/** Parse "YYYY-MM-DD" to a UTC Date (00:00). Throws on bad input — callers validate first. */
export function parseDate(s: string): Date {
  const t = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(t.getTime())) throw new Error(`invalid date: ${s}`);
  return t;
}

export interface Period {
  from: Date | null;
  to: Date | null;
}

/** Inclusive end-of-day for a "to" date. */
export function endOfDay(d: Date): Date {
  return new Date(d.getTime() + 86_399_999);
}

/**
 * Explicit default period: when a caller gives no range, the LAST 30 DAYS are
 * used and this is stated in the report meta (never a silent assumption).
 */
export function resolvePeriod(from?: string, to?: string): { period: Period; defaultApplied: boolean } {
  if (!from && !to) {
    const now = new Date();
    const f = new Date(now.getTime() - 30 * 86_400_000);
    return {
      period: { from: new Date(f.toISOString().slice(0, 10) + 'T00:00:00.000Z'), to: endOfDay(now) },
      defaultApplied: true,
    };
  }
  return {
    period: { from: from ? parseDate(from) : null, to: to ? endOfDay(parseDate(to)) : null },
    defaultApplied: false,
  };
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function daysInclusive(from: Date, to: Date): number {
  return Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1);
}

export function meta(
  filters: Record<string, string | undefined>,
  notesFa: string[] = [],
  defaultPeriod?: { from: string; to: string; basisFa: string },
): ReportMeta {
  const now = new Date();
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(filters)) if (v) clean[k] = v;
  return {
    generatedAt: now.toISOString(),
    generatedAtFa: `${toJalaliDateString(now, true)} — ${now.toLocaleTimeString('fa-IR')}`,
    filters: clean,
    valueKinds: VALUE_KIND_FA,
    notesFa,
    defaultPeriodApplied: defaultPeriod,
  };
}

export function table(
  key: string,
  titleFa: string,
  columns: ReportColumn[],
  rows: Record<string, unknown>[],
  m: ReportMeta,
): ReportTable {
  return { key, titleFa, columns, rows: rows as ReportTable['rows'], meta: m };
}

// ---------------------------------------------------------------------------
// CSV export (Excel-compatible: UTF-8 BOM, comma separated, quoted text)
// ---------------------------------------------------------------------------

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    const drill = v as { kind?: string; id?: string; labelFa?: string };
    if (drill.kind && drill.id) return csvSanitize(drill.labelFa ?? `${drill.kind}:${drill.id}`);
    return '';
  }
  return csvSanitize(String(v));
}

/**
 * Excel formula-injection guard: cells starting with = + - @ (or tab/CR) could
 * execute as formulas when opened in Excel/LibreOffice. They are prefixed with
 * a single quote so they render as plain text.
 */
function csvSanitize(s: string): string {
  if (s === '') return '';
  // plain numeric literals (incl. negatives) are safe and must stay numeric in Excel
  if (/^-?\d+(\.\d+)?$/.test(s)) return s;
  // formula-injection check runs on the RAW input — quoting alone must not hide it
  const dangerous = /^[=+\-@\t\r]/.test(s);
  let out = s;
  if (/["\n,;]/.test(out)) out = `"${out.replace(/"/g, '""')}"`;
  return dangerous ? `'${out}` : out;
}

export function reportToCsv(report: ReportTable): string {
  const lines: string[] = [];
  lines.push(`گزارش: ${report.titleFa}`);
  lines.push(`زمان تولید: ${report.meta.generatedAtFa}`);
  const filterText =
    Object.entries(report.meta.filters)
      .map(([k, v]) => `${k}=${v}`)
      .join('؛ ') || 'بدون فیلتر';
  lines.push(`فیلترها: ${filterText}`);
  lines.push('');
  lines.push(report.columns.map((c) => csvCell(`${c.labelFa}${c.unit ? ` (${c.unit})` : ''}`)).join(','));
  for (const row of report.rows) {
    lines.push(report.columns.map((c) => csvCell(row[c.key])).join(','));
  }
  // UTF-8 BOM so Excel opens Persian text correctly
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------
// ledger aggregation (inventory reconciliation / SAPCO account / movements)
// ---------------------------------------------------------------------------

export interface LedgerDims {
  partId: string | null;
  materialId: string | null;
  warehouseId: string;
  locationId: string | null;
  lotId: string | null;
  unitId: string;
  ownership: string;
  qualityStatus: string;
}

export const LEDGER_DIMS_FIELDS = [
  'partId', 'materialId', 'warehouseId', 'locationId', 'lotId', 'unitId', 'ownership', 'qualityStatus',
] as const;

export function dimsKey(d: LedgerDims): string {
  return [d.partId, d.materialId, d.warehouseId, d.locationId, d.lotId, d.unitId, d.ownership, d.qualityStatus].join('|');
}

/** Signed ledger totals per full balance dimension (single SQL GROUP BY). */
export async function ledgerTotalsByDims(where: Prisma.InventoryTransactionWhereInput): Promise<Map<string, { quantity: Prisma.Decimal; weightKg: Prisma.Decimal }>> {
  const groups = await db.inventoryTransaction.groupBy({
    by: ['partId', 'materialId', 'warehouseId', 'locationId', 'lotId', 'unitId', 'ownership', 'qualityStatus', 'type'],
    _sum: { quantity: true, weightKg: true },
    where,
  });
  const map = new Map<string, { quantity: Prisma.Decimal; weightKg: Prisma.Decimal }>();
  for (const g of groups) {
    const key = dimsKey({
      partId: g.partId, materialId: g.materialId, warehouseId: g.warehouseId,
      locationId: g.locationId, lotId: g.lotId, unitId: g.unitId,
      ownership: g.ownership, qualityStatus: g.qualityStatus,
    });
    const sign = TX_SIGN[g.type] ?? 0;
    const prev = map.get(key) ?? { quantity: ZERO, weightKg: ZERO };
    prev.quantity = prev.quantity.plus(dec(g._sum.quantity).mul(sign));
    prev.weightKg = prev.weightKg.plus(dec(g._sum.weightKg).mul(sign));
    map.set(key, prev);
  }
  return map;
}

// ---------------------------------------------------------------------------
// machine utilization (shared by machine-workload report and the dashboard)
// ---------------------------------------------------------------------------

export interface MachineUtilizationRow {
  machineId: string;
  machineCode: string;
  machineNameFa: string;
  machineStatus: string;
  actualProducedQuantity: string;
  standardMinutes: string | null;
  availableMinutes: number | null;
  utilizationPct: number | null;
  capacityReliable: boolean;
  reasonFa: string | null;
  openAssignments: number;
  plannedMinutesKnown: string;
  plannedAssignmentsMissingDates: number;
  _details?: {
    reportsWithoutRate: number;
    hasCapabilityRows: boolean;
    hasShifts: boolean;
  };
}

/**
 * Machine workload & utilization for a period.
 *
 * Utilization = (produced qty ÷ standard rate) ÷ available shift minutes.
 * It is an ESTIMATE based on standard times, and it is computed ONLY where
 * reliable capacity data exists (MachineCapability.standardRatePerHour for the
 * operations the machine actually ran, plus ACTIVE shift definitions). Machines
 * without that data get utilization = null with an explicit reason — never a
 * silent assumption.
 */
export async function machineUtilization(period: Period, machineId?: string): Promise<MachineUtilizationRow[]> {
  const machineWhere = machineId ? { id: machineId } : {};
  const [machines, shifts, reports, assignments, capabilities] = await Promise.all([
    db.machine.findMany({ where: machineWhere, orderBy: { code: 'asc' } }),
    db.shift.findMany({ where: { isActive: true } }),
    db.productionReport.findMany({
      where: {
        postingStatus: 'POSTED',
        reportDate: { ...(period.from ? { gte: period.from } : {}), ...(period.to ? { lte: period.to } : {}) },
        machineId: machineId ?? undefined,
      },
      select: { machineId: true, producedQuantity: true, operation: { select: { operationId: true } } },
    }),
    db.machineAssignment.findMany({
      where: { status: { in: ['PLANNED', 'ACTIVE'] }, machineId: machineId ?? undefined },
      select: { machineId: true, plannedStart: true, plannedEnd: true },
    }),
    db.machineCapability.findMany({ where: machineId ? { machineId } : {}, select: { machineId: true, operationId: true, standardRatePerHour: true } }),
  ]);

  const rateByMachineOp = new Map<string, Prisma.Decimal>();
  const machineHasCapability = new Set<string>();
  for (const c of capabilities) {
    if (c.standardRatePerHour !== null) {
      rateByMachineOp.set(`${c.machineId}:${c.operationId}`, dec(c.standardRatePerHour));
      machineHasCapability.add(c.machineId);
    }
  }

  const hasShifts = shifts.length > 0;
  const dayMinutes = hasShifts
    ? shifts.reduce((acc, s) => {
        const [sh, sm] = s.startTime.split(':').map(Number);
        const [eh, em] = s.endTime.split(':').map(Number);
        if ([sh, sm, eh, em].some((v) => !Number.isFinite(v))) return acc;
        let start = sh! * 60 + sm!;
        let end = eh! * 60 + em!;
        if (end <= start) end += 24 * 60;
        return acc + Math.max(0, end - start);
      }, 0)
    : 0;
  const periodDays = period.from && period.to ? daysInclusive(period.from, period.to) : 1;
  const availableMinutes = hasShifts ? dayMinutes * periodDays : null;

  const qtyByMachine = new Map<string, Prisma.Decimal>();
  const stdMinByMachine = new Map<string, Prisma.Decimal>();
  const noRateByMachine = new Map<string, number>();
  for (const r of reports) {
    if (!r.machineId) continue;
    qtyByMachine.set(r.machineId, qtyByMachine.get(r.machineId)?.plus(dec(r.producedQuantity)) ?? dec(r.producedQuantity));
    const rate = rateByMachineOp.get(`${r.machineId}:${r.operation.operationId}`);
    if (rate && rate.comparedTo(0) > 0) {
      const minutes = dec(r.producedQuantity).div(rate).mul(60);
      stdMinByMachine.set(r.machineId, stdMinByMachine.get(r.machineId)?.plus(minutes) ?? minutes);
    } else {
      noRateByMachine.set(r.machineId, (noRateByMachine.get(r.machineId) ?? 0) + 1);
    }
  }

  return machines.map((m) => {
    const actualQty = qtyByMachine.get(m.id) ?? ZERO;
    const stdMin = stdMinByMachine.get(m.id) ?? null;
    const noRate = noRateByMachine.get(m.id) ?? 0;
    const hasCap = machineHasCapability.has(m.id);
    const mAssignments = assignments.filter((a) => a.machineId === m.id);
    let plannedMin = ZERO;
    let missingDates = 0;
    for (const a of mAssignments) {
      if (a.plannedStart && a.plannedEnd) {
        plannedMin = plannedMin.plus(Math.max(0, (a.plannedEnd.getTime() - a.plannedStart.getTime()) / 60_000));
      } else {
        missingDates += 1;
      }
    }

    let utilizationPct: number | null = null;
    let reasonFa: string | null = null;
    let capacityReliable = true;
    if (!hasCap && noRate > 0) {
      capacityReliable = false;
      reasonFa = 'ظرفیت استاندارد (نرخ ماشین–عملیات) برای این ماشین ثبت نشده است؛ بهره‌وری محاسبه نمی‌شود';
    } else if (!hasShifts) {
      capacityReliable = false;
      reasonFa = 'شیفت فعال تعریف نشده است؛ ظرفیت موجود محاسبه نمی‌شود';
    } else if (stdMin !== null && availableMinutes && availableMinutes > 0) {
      utilizationPct = Math.round(stdMin.div(availableMinutes).mul(100).toNumber() * 10) / 10;
    } else if (noRate > 0) {
      capacityReliable = false;
      reasonFa = 'برای برخی عملیات‌های اجراشده نرخ استاندارد ثبت نشده است؛ بهره‌وری کامل نیست';
    }

    return {
      machineId: m.id,
      machineCode: m.code,
      machineNameFa: m.nameFa,
      machineStatus: m.status,
      actualProducedQuantity: actualQty.toFixed(2),
      standardMinutes: stdMin === null ? null : stdMin.toFixed(1),
      availableMinutes,
      utilizationPct,
      capacityReliable,
      reasonFa,
      openAssignments: mAssignments.length,
      plannedMinutesKnown: plannedMin.toFixed(1),
      plannedAssignmentsMissingDates: missingDates,
      _details: { reportsWithoutRate: noRate, hasCapabilityRows: hasCap, hasShifts },
    };
  });
}

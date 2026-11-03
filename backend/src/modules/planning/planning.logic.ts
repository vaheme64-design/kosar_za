/**
 * KPIMS — Phase 4: Production Planning Engine (pure logic)
 *
 * موتور برنامه‌ریزی تولید — توابع خالص (بدون دسترسی به دیتابیس)
 *
 * Design rules (phase-4 brief):
 *  • Every quantity is Decimal — no floating point in planning results.
 *  • Calculated values are tagged with their SOURCE; missing standard times or
 *    capacities are never silently assumed — they surface as `missingInfo`.
 *  • Machine eligibility is strict: an incompatible die or insufficient
 *    tonnage makes a machine INELIGIBLE under any circumstances.
 *  • Planning output is a proposal (plan snapshot) — it never mutates
 *    production or inventory transactions.
 */
import { Prisma } from '@prisma/client';

type Dec = Prisma.Decimal;
const D = Prisma.Decimal;
export const Q0 = new D(0);
const HUNDRED = new D(100);

const dec = (v: Prisma.Decimal.Value | null | undefined): Dec => new D(v ?? 0);
const maxDec = (a: Dec, b: Dec): Dec => (a.comparedTo(b) >= 0 ? a : b);
const minDec = (a: Dec, b: Dec): Dec => (a.comparedTo(b) <= 0 ? a : b);
/** Round up to 4 decimals (quantities are stored Decimal(18,4)). */
const ceil4 = (v: Dec): Dec => {
  const scaled = v.mul(10000);
  const up = scaled.isInteger() ? scaled : scaled.ceil();
  return up.div(10000);
};
export const fmt = (v: Dec | null | undefined): string => dec(v).toFixed(4);

// ---------------------------------------------------------------------------
// 1) Gross demand — تقاضای ناخالص
// ---------------------------------------------------------------------------

export interface OrderLineInput {
  lineId: string;
  orderId: string;
  orderNumber: string;
  customerId: string;
  customerNameFa: string;
  lineNo: number;
  partId: string;
  quantity: Prisma.Decimal.Value;
  deliveredQuantity: Prisma.Decimal.Value;
  dueDate: Date | null;
  lineStatus: string;
  orderStatus: string;
}

export interface DemandLineResult {
  lineId: string;
  orderId: string;
  orderNumber: string;
  customerNameFa: string;
  lineNo: number;
  partId: string;
  quantity: string;
  deliveredQuantity: string;
  remaining: string;
  dueDate: Date | null;
}

export interface GrossDemandResult {
  byPart: Map<string, { partId: string; gross: Dec; lines: DemandLineResult[] }>;
  skippedLines: { lineId: string; orderNumber: string; lineNo: number; reason: string }[];
}

const DEMAND_LINE_STATUSES = new Set(['OPEN', 'IN_PRODUCTION']);
const DEMAND_ORDER_STATUSES = new Set(['CONFIRMED', 'IN_PRODUCTION', 'PARTIALLY_DELIVERED']);

/**
 * Gross demand per part from open, confirmed customer-order lines.
 * Remaining per line = quantity − deliveredQuantity.
 * Lines that are completed/cancelled (or belong to draft/cancelled orders)
 * are excluded and REPORTED (never silently ignored).
 */
export function computeGrossDemand(lines: OrderLineInput[]): GrossDemandResult {
  const byPart = new Map<string, { partId: string; gross: Dec; lines: DemandLineResult[] }>();
  const skippedLines: GrossDemandResult['skippedLines'] = [];

  for (const l of lines) {
    if (!DEMAND_ORDER_STATUSES.has(l.orderStatus)) {
      skippedLines.push({ lineId: l.lineId, orderNumber: l.orderNumber, lineNo: l.lineNo, reason: `وضعیت سفارش: ${l.orderStatus}` });
      continue;
    }
    if (!DEMAND_LINE_STATUSES.has(l.lineStatus)) {
      skippedLines.push({ lineId: l.lineId, orderNumber: l.orderNumber, lineNo: l.lineNo, reason: `وضعیت ردیف: ${l.lineStatus}` });
      continue;
    }
    const remaining = dec(l.quantity).minus(dec(l.deliveredQuantity));
    if (remaining.comparedTo(0) <= 0) {
      skippedLines.push({ lineId: l.lineId, orderNumber: l.orderNumber, lineNo: l.lineNo, reason: 'کاملاً تحویل‌شده' });
      continue;
    }
    const entry = byPart.get(l.partId) ?? { partId: l.partId, gross: Q0, lines: [] };
    entry.gross = entry.gross.plus(remaining);
    entry.lines.push({
      lineId: l.lineId,
      orderId: l.orderId,
      orderNumber: l.orderNumber,
      customerNameFa: l.customerNameFa,
      lineNo: l.lineNo,
      partId: l.partId,
      quantity: dec(l.quantity).toFixed(4),
      deliveredQuantity: dec(l.deliveredQuantity).toFixed(4),
      remaining: remaining.toFixed(4),
      dueDate: l.dueDate,
    });
    byPart.set(l.partId, entry);
  }

  // earlier due date first (nulls last) — deterministic allocation order
  for (const entry of byPart.values()) {
    entry.lines.sort((a, b) => {
      const ta = a.dueDate?.getTime() ?? Number.POSITIVE_INFINITY;
      const tb = b.dueDate?.getTime() ?? Number.POSITIVE_INFINITY;
      if (ta !== tb) return ta - tb;
      return a.lineNo - b.lineNo;
    });
  }
  return { byPart, skippedLines };
}

// ---------------------------------------------------------------------------
// 2–4) Available FG inventory + reservations — موجودی آزاد و رزروها
// ---------------------------------------------------------------------------

export interface FgBalanceRow {
  partId: string;
  quantity: Prisma.Decimal.Value;
  ownership: string;
  qualityStatus: string;
}

export interface FgAvailability {
  usable: Dec; // approved + owned in FG warehouses
  quarantined: Dec; // PENDING/BLOCKED quality — excluded
  consignment: Dec; // supplier-owned — excluded
  breakdown: string[]; // Persian notes for excluded stock
}

/** Exclude blocked / quarantined / supplier-owned stock from planning supply. */
export function computeFgAvailability(rows: FgBalanceRow[]): FgAvailability {
  let usable = Q0;
  let quarantined = Q0;
  let consignment = Q0;
  for (const r of rows) {
    const q = dec(r.quantity);
    if (q.comparedTo(0) <= 0) continue;
    if (r.qualityStatus !== 'APPROVED') {
      quarantined = quarantined.plus(q);
      continue;
    }
    if (r.ownership !== 'OWNED') {
      consignment = consignment.plus(q);
      continue;
    }
    usable = usable.plus(q);
  }
  const breakdown: string[] = [];
  if (quarantined.comparedTo(0) > 0) breakdown.push(`موجودی غیرقابل استفاده (قرنطینه/مسدود کیفیت): ${quarantined.toFixed(4)}`);
  if (consignment.comparedTo(0) > 0) breakdown.push(`موجودی امانی تأمین‌کننده (حذف‌شده): ${consignment.toFixed(4)}`);
  return { usable, quarantined, consignment, breakdown };
}

export interface ReservationRow {
  id: string;
  quantity: Prisma.Decimal.Value;
  status: string;
  expiresAt: Date | null;
  forCustomerOrderLineId: string | null;
  forManufacturingOrderId: string | null;
}

export interface ReservationSplit {
  forThisLine: Dec;
  forOthers: Dec;
  ignored: { id: string; reason: string }[];
}

/** ACTIVE, unexpired reservations count; others are reported as ignored. */
export function splitReservations(rows: ReservationRow[], orderLineId: string | null): ReservationSplit {
  let forThisLine = Q0;
  let forOthers = Q0;
  const ignored: { id: string; reason: string }[] = [];
  const now = new Date();
  for (const r of rows) {
    if (r.status !== 'ACTIVE') {
      ignored.push({ id: r.id, reason: `وضعیت رزرو: ${r.status}` });
      continue;
    }
    if (r.expiresAt && r.expiresAt.getTime() < now.getTime()) {
      ignored.push({ id: r.id, reason: 'رزرو منقضی‌شده' });
      continue;
    }
    if (orderLineId && r.forCustomerOrderLineId === orderLineId) forThisLine = forThisLine.plus(dec(r.quantity));
    else forOthers = forOthers.plus(dec(r.quantity));
  }
  return { forThisLine, forOthers, ignored };
}

export interface LineNettingInput {
  line: DemandLineResult;
  reservedForThisLine: Dec;
}

export interface LineNettingResult {
  line: DemandLineResult;
  remaining: Dec;
  coveredByReservations: Dec;
  coveredByStock: Dec;
  netRequirement: Dec;
}

/**
 * Per-line demand netting:
 *   1) reservations made FOR this order line cover its demand first;
 *   2) unreserved free stock is allocated FIFO by due date (caller feeds
 *      `freeRemaining` and gets the updated value back).
 */
export function netLine(input: LineNettingInput, freeRemaining: Dec): { result: LineNettingResult; freeRemaining: Dec } {
  const remaining = dec(input.line.remaining);
  const coveredByReservations = minDec(input.reservedForThisLine, remaining);
  const afterReservations = remaining.minus(coveredByReservations);
  const coveredByStock = minDec(maxDec(freeRemaining, Q0), afterReservations);
  const netRequirement = afterReservations.minus(coveredByStock);
  return {
    result: {
      line: input.line,
      remaining,
      coveredByReservations,
      coveredByStock,
      netRequirement: maxDec(netRequirement, Q0),
    },
    freeRemaining: freeRemaining.minus(coveredByStock),
  };
}

// ---------------------------------------------------------------------------
// 5–6) WIP netting per operation — قطع‌بوش WIP عملیات‌به‌عملیات
// ---------------------------------------------------------------------------

export interface WipOpSnapshot {
  sequence: number;
  operationId: string;
  operationCode: string;
  operationNameFa: string;
  /// produced − transferredOut (completed at this op, waiting to move)
  readyForTransfer: Dec;
  /// received + rework − input (arrived, awaiting processing)
  arriving: Dec;
  /// output still expected at this op from OPEN manufacturing orders
  /// (plannedQuantity − produced − scrapped − rejected, summed over open MOs)
  committedRemaining: Dec;
  scrapFactorPct: Prisma.Decimal.Value;
}

export interface WipOpResult {
  sequence: number;
  operationId: string;
  operationCode: string;
  operationNameFa: string;
  requiredOutput: string;
  wipQuantity: string;
  wipUsed: string;
  committedQuantity: string;
  committedUsed: string;
  arrivingQuantity: string;
  arrivingUsed: string;
  mustProduce: string;
  requiredInput: string;
  scrapFactorPct: string;
  infeasibleReasons: string[];
}

export interface WipNettingResult {
  operations: WipOpResult[]; // route order (asc sequence)
  mustProduceFinal: Dec; // new FG units to produce at the last op
  coveredByWip: Dec; // FG-equivalent covered by existing WIP (wipUsed at last op)
  coveredByCommittedMos: Dec; // FG-equivalent covered by open MOs (committedUsed at last op)
  firstOpRequiredInput: Dec; // units to feed into the first op
  infeasibleReasons: string[];
}

/**
 * Backward pass over the route:
 *   requiredOutput[last] = netRequirement
 *   wipUsed[k]       = min(readyForTransfer[k], requiredOutput[k])
 *   committedUsed[k] = min(committedRemaining[k], requiredOutput[k] − wipUsed[k])
 *   mustProduce[k]   = requiredOutput[k] − wipUsed[k] − committedUsed[k]
 *   requiredInput[k] = mustProduce[k] / (1 − scrapFactor[k])   (op k's own scrap)
 *   arrivingUsed[k]  = min(arriving[k], requiredInput[k])      (already transferred from op k−1)
 *   requiredOutput[k−1] = requiredInput[k] − arrivingUsed[k]
 *
 * committedRemaining = output still expected from OPEN manufacturing orders —
 * crediting it here prevents proposing duplicate MOs for work already planned.
 * `netRequirement` of 0 short-circuits to an all-zero chain (no MO proposed).
 */
export function netWipAcrossOperations(netRequirement: Dec, ops: WipOpSnapshot[]): WipNettingResult {
  const results: WipOpResult[] = [];
  const globalReasons: string[] = [];
  if (ops.length === 0) {
    return {
      operations: [],
      mustProduceFinal: Q0,
      coveredByWip: Q0,
      coveredByCommittedMos: Q0,
      firstOpRequiredInput: Q0,
      infeasibleReasons: ['مسیر تولید این قطعه مرحله‌ای ندارد'],
    };
  }

  let requiredOutput = maxDec(netRequirement, Q0);
  for (let k = ops.length - 1; k >= 0; k--) {
    const op = ops[k]!;
    const sf = dec(op.scrapFactorPct).div(HUNDRED);
    const opReasons: string[] = [];
    let divisor = new D(1).minus(sf);
    if (divisor.comparedTo(0) <= 0) {
      opReasons.push(`ضریب ضایعات نامعتبر در مسیر تولید (${dec(op.scrapFactorPct).toFixed(2)}٪)`);
      divisor = new D(1);
      globalReasons.push(...opReasons);
    }
    const wip = maxDec(op.readyForTransfer, Q0);
    const wipUsed = minDec(wip, requiredOutput);
    const afterWip = requiredOutput.minus(wipUsed);
    const committed = maxDec(op.committedRemaining, Q0);
    const committedUsed = minDec(committed, afterWip);
    const mustProduce = afterWip.minus(committedUsed);
    const requiredInput = ceil4(mustProduce.div(divisor));
    const arriving = maxDec(op.arriving, Q0);
    const arrivingUsed = k > 0 ? minDec(arriving, requiredInput) : Q0;
    results.unshift({
      sequence: op.sequence,
      operationId: op.operationId,
      operationCode: op.operationCode,
      operationNameFa: op.operationNameFa,
      requiredOutput: requiredOutput.toFixed(4),
      wipQuantity: wip.toFixed(4),
      wipUsed: wipUsed.toFixed(4),
      committedQuantity: committed.toFixed(4),
      committedUsed: committedUsed.toFixed(4),
      arrivingQuantity: arriving.toFixed(4),
      arrivingUsed: arrivingUsed.toFixed(4),
      mustProduce: mustProduce.toFixed(4),
      requiredInput: requiredInput.toFixed(4),
      scrapFactorPct: dec(op.scrapFactorPct).toFixed(2),
      infeasibleReasons: opReasons,
    });
    // output needed from the previous operation = input still missing here
    requiredOutput = k > 0 ? requiredInput.minus(arrivingUsed) : Q0;
  }

  const last = results[results.length - 1]!;
  const mustProduceFinal = dec(last.mustProduce);
  return {
    operations: results,
    mustProduceFinal,
    coveredByWip: dec(last.wipUsed),
    coveredByCommittedMos: dec(last.committedUsed),
    firstOpRequiredInput: dec(results[0]!.requiredInput),
    infeasibleReasons: globalReasons,
  };
}

// ---------------------------------------------------------------------------
// 7) Material requirements — کسری مواد اولیه
// ---------------------------------------------------------------------------

export interface BomRow {
  materialId: string;
  materialCode: string;
  materialNameFa: string;
  unitCode: string;
  quantityPerUnit: Prisma.Decimal.Value;
  weightKgPerUnit: Prisma.Decimal.Value | null;
}

export interface MaterialStockRow {
  materialId: string;
  quantity: Prisma.Decimal.Value;
  ownership: string;
  qualityStatus: string;
}

export interface ContractRow {
  id: string;
  contractNumber: string;
  materialId: string;
  totalQuantity: Prisma.Decimal.Value;
  receivedQuantity: Prisma.Decimal.Value;
  expectedDeliveryDate: Date | null;
  status: string;
}

export interface MaterialShortageResult {
  materialId: string;
  materialCode: string;
  materialNameFa: string;
  unitCode: string;
  severity: 'OK' | 'SHORTAGE_COVERED_BY_CONTRACT' | 'SHORTAGE' | 'MISSING_BOM';
  requiredQuantity: string;
  availableQuantity: string;
  consignmentQuantity: string;
  shortageQuantity: string;
  coveredByOpenContracts: string;
  contractInfo: { contractNumber: string; remaining: string; expectedDeliveryDate: Date | null }[];
  notes: string[];
}

const OPEN_CONTRACT_STATUSES = new Set(['OPEN', 'PARTIALLY_RECEIVED']);

/** Compare BOM requirement with approved stock (owned + consignment shown apart). */
export function computeMaterialShortages(
  requiredInputUnits: Dec,
  bom: BomRow[],
  stock: MaterialStockRow[],
  contracts: ContractRow[],
): { shortages: MaterialShortageResult[]; missingBomMaterials: string[] } {
  const shortages: MaterialShortageResult[] = [];
  const missingBomMaterials: string[] = [];

  if (bom.length === 0) return { shortages, missingBomMaterials };

  for (const b of bom) {
    const required = ceil4(requiredInputUnits.mul(dec(b.quantityPerUnit)));
    let owned = Q0;
    let consignment = Q0;
    let quarantined = Q0;
    for (const s of stock.filter((x) => x.materialId === b.materialId)) {
      const q = dec(s.quantity);
      if (q.comparedTo(0) <= 0) continue;
      if (s.qualityStatus !== 'APPROVED') {
        quarantined = quarantined.plus(q);
        continue;
      }
      if (s.ownership === 'OWNED') owned = owned.plus(q);
      else consignment = consignment.plus(q);
    }
    const available = owned.plus(consignment);
    const shortage = maxDec(required.minus(available), Q0);

    const openContracts = contracts
      .filter((c) => c.materialId === b.materialId && OPEN_CONTRACT_STATUSES.has(c.status))
      .map((c) => ({
        contractNumber: c.contractNumber,
        remaining: dec(c.totalQuantity).minus(dec(c.receivedQuantity)),
        expectedDeliveryDate: c.expectedDeliveryDate,
      }))
      .filter((c) => c.remaining.comparedTo(0) > 0);
    const contractCovered = minDec(
      shortage,
      openContracts.reduce((acc, c) => acc.plus(c.remaining), Q0),
    );

    let severity: MaterialShortageResult['severity'] = 'OK';
    if (shortage.comparedTo(0) > 0) {
      severity = contractCovered.comparedTo(0) > 0 ? 'SHORTAGE_COVERED_BY_CONTRACT' : 'SHORTAGE';
    }

    const notes: string[] = [];
    if (quarantined.comparedTo(0) > 0) notes.push(`موجودی قرنطینه‌شده (حذف‌شده): ${quarantined.toFixed(4)}`);
    if (consignment.comparedTo(0) > 0) notes.push('شامل موجودی امانی تأمین‌کننده (به‌صورت جداگانه نمایش داده می‌شود)');

    shortages.push({
      materialId: b.materialId,
      materialCode: b.materialCode,
      materialNameFa: b.materialNameFa,
      unitCode: b.unitCode,
      severity,
      requiredQuantity: required.toFixed(4),
      availableQuantity: available.toFixed(4),
      consignmentQuantity: consignment.toFixed(4),
      shortageQuantity: shortage.toFixed(4),
      coveredByOpenContracts: contractCovered.toFixed(4),
      contractInfo: openContracts.map((c) => ({
        contractNumber: c.contractNumber,
        remaining: c.remaining.toFixed(4),
        expectedDeliveryDate: c.expectedDeliveryDate,
      })),
      notes,
    });
  }
  return { shortages, missingBomMaterials };
}

// ---------------------------------------------------------------------------
// 8–10) Time estimation, machine eligibility, capacity, ranking
// ---------------------------------------------------------------------------

export type TimeSource = 'ROUTE_STEP' | 'CAPABILITY' | 'OPERATION_DEFAULT' | 'MISSING';
export type SetupSource = 'ROUTE_STEP' | 'OPERATION_DEFAULT' | 'NOT_DEFINED';

export interface OperationTimeInput {
  quantity: Prisma.Decimal.Value;
  stepCycleTimeSec: Prisma.Decimal.Value | null;
  capabilityRatePerHour: Prisma.Decimal.Value | null;
  operationDefaultCycleTimeSec: Prisma.Decimal.Value | null;
  stepSetupTimeMin: number | null;
  operationDefaultSetupTimeMin: number | null;
}

export interface OperationTimeResult {
  hours: Dec | null;
  source: TimeSource;
  setupMinutes: number;
  setupSource: SetupSource;
  warnings: string[];
}

/**
 * Cycle-time source priority: route step → machine capability rate →
 * operation default. MISSING never falls back silently to a guess.
 */
export function estimateOperationTime(input: OperationTimeInput): OperationTimeResult {
  const warnings: string[] = [];
  let secondsPerUnit: Dec | null = null;
  let source: TimeSource = 'MISSING';

  if (input.stepCycleTimeSec != null) {
    secondsPerUnit = dec(input.stepCycleTimeSec);
    source = 'ROUTE_STEP';
  } else if (input.capabilityRatePerHour != null && dec(input.capabilityRatePerHour).comparedTo(0) > 0) {
    secondsPerUnit = new D(3600).div(dec(input.capabilityRatePerHour));
    source = 'CAPABILITY';
  } else if (input.operationDefaultCycleTimeSec != null) {
    secondsPerUnit = dec(input.operationDefaultCycleTimeSec);
    source = 'OPERATION_DEFAULT';
  }

  const hours = secondsPerUnit != null ? ceil4(dec(input.quantity).mul(secondsPerUnit).div(3600)) : null;

  let setupMinutes = 0;
  let setupSource: SetupSource = 'NOT_DEFINED';
  if (input.stepSetupTimeMin != null) {
    setupMinutes = input.stepSetupTimeMin;
    setupSource = 'ROUTE_STEP';
  } else if (input.operationDefaultSetupTimeMin != null) {
    setupMinutes = input.operationDefaultSetupTimeMin;
    setupSource = 'OPERATION_DEFAULT';
  } else {
    warnings.push('زمان راه‌اندازی تعریف نشده است — صفر در نظر گرفته شد (صریحاً، بدون فرض پنهان)');
  }

  if (source === 'MISSING') {
    warnings.push('زمان سیکل استاندارد برای این عملیات ثبت نشده است');
  }
  return { hours, source, setupMinutes, setupSource, warnings };
}

export interface ShiftDef {
  id: string;
  code: string;
  nameFa: string;
  startTime: string; // "06:00"
  endTime: string; // "14:00"
}

/** Total working minutes per day from ACTIVE shifts (overnight shifts supported). */
export function shiftMinutesPerDay(shifts: ShiftDef[]): { minutes: number; shifts: ShiftDef[] } {
  let minutes = 0;
  const used: ShiftDef[] = [];
  for (const s of shifts) {
    const [sh, sm] = s.startTime.split(':').map(Number);
    const [eh, em] = s.endTime.split(':').map(Number);
    if ([sh, sm, eh, em].some((v) => !Number.isFinite(v))) continue;
    let start = sh! * 60 + sm!;
    let end = eh! * 60 + em!;
    if (end <= start) end += 24 * 60; // overnight
    if (end - start <= 0) continue;
    minutes += end - start;
    used.push(s);
  }
  return { minutes, shifts: used };
}

export interface MachineDef {
  id: string;
  code: string;
  nameFa: string;
  machineType: string;
  tonnage: Prisma.Decimal.Value | null;
  status: string;
}

export interface DieDef {
  id: string;
  code: string;
  nameFa: string;
  status: string;
}

export interface EligibilityContext {
  machine: MachineDef;
  operation: {
    id: string;
    code: string;
    nameFa: string;
    requiresDie: boolean;
    defaultSetupTimeMin: number | null;
    defaultCycleTimeSec: Prisma.Decimal.Value | null;
  };
  routeStep: {
    dieId: string | null;
    requiredTonnage: Prisma.Decimal.Value | null;
    setupTimeMin: number | null;
    cycleTimeSec: Prisma.Decimal.Value | null;
    machineId: string | null;
  } | null;
  capabilityRatePerHour: Prisma.Decimal.Value | null;
  die: DieDef | null;
  compatibleDieMachineIds: Set<string>;
  minutesPerDay: number;
  workloadMinutes: number;
  quantity: Prisma.Decimal.Value;
  now: Date;
}

export interface MachineCandidate {
  machineId: string;
  machineCode: string;
  machineNameFa: string;
  machineStatus: string;
  eligible: boolean;
  rank: number | null;
  timeSource: TimeSource;
  setupSource: SetupSource;
  requiredHours: Dec | null;
  requiredMinutes: number | null;
  setupMinutes: number;
  workloadMinutes: number;
  minutesPerDay: number;
  busyDays: number | null;
  estimatedStart: Date | null;
  estimatedEnd: Date | null;
  checks: { code: string; labelFa: string; pass: boolean; hard: boolean; noteFa?: string }[];
  reasonsFa: string[];
  warningsFa: string[];
}

/**
 * Machine eligibility + capacity checks + estimated completion.
 * Hard-fail checks (capability, machine status, tonnage, die compatibility,
 * shift capacity) make a machine INELIGIBLE — incompatible machines are never
 * assigned under any circumstances.
 */
export function evaluateMachine(ctx: EligibilityContext): MachineCandidate {
  const checks: MachineCandidate['checks'] = [];
  const warningsFa: string[] = [];

  // c1 — operation support
  const hasCapability = ctx.capabilityRatePerHour != null;
  checks.push({
    code: 'CAPABILITY',
    labelFa: 'توانمندی ماشین برای این عملیات',
    pass: hasCapability,
    hard: true,
    noteFa: hasCapability ? undefined : 'این ماشین برای این عملیات توانمندی ثبت‌شده ندارد',
  });

  // c2 — machine availability
  const machineActive = ctx.machine.status === 'ACTIVE';
  checks.push({
    code: 'MACHINE_STATUS',
    labelFa: 'ماشین در دسترس است',
    pass: machineActive,
    hard: true,
    noteFa: machineActive ? undefined : `وضعیت ماشین: ${ctx.machine.status}`,
  });

  // c3 — tonnage vs process requirement
  const requiredTonnage = ctx.routeStep?.requiredTonnage ?? null;
  if (requiredTonnage != null) {
    const machineTonnage = ctx.machine.tonnage != null ? dec(ctx.machine.tonnage) : null;
    const tonnageOk = machineTonnage != null && machineTonnage.comparedTo(dec(requiredTonnage)) >= 0;
    checks.push({
      code: 'TONNAGE',
      labelFa: 'تناژ ماشین پوشش‌دهنده نیاز فرآیند',
      pass: tonnageOk,
      hard: true,
      noteFa: tonnageOk
        ? `تناژ ${dec(machineTonnage).toFixed(0)} تن ≥ ${dec(requiredTonnage).toFixed(0)} تن`
        : machineTonnage == null
          ? 'تناژ ماشین ثبت نشده است'
          : `تناژ ${dec(machineTonnage).toFixed(0)} تن < ${dec(requiredTonnage).toFixed(0)} تن موردنیاز`,
    });
  } else {
    warningsFa.push('تناژ موردنیاز عملیات در مسیر تولید ثبت نشده است — کنترل تناژ انجام نشد');
  }

  // c4 — die compatibility (never assign an incompatible machine)
  if (ctx.operation.requiresDie) {
    if (ctx.routeStep?.dieId == null) {
      warningsFa.push('قالب این عملیات در مسیر تولید ثبت نشده است — امکان کنترل سازگاری قالب نیست');
    } else if (ctx.die == null) {
      warningsFa.push('قالب ثبت‌شده در مسیر یافت نشد');
    } else {
      const dieActive = ctx.die.status === 'ACTIVE';
      checks.push({
        code: 'DIE_STATUS',
        labelFa: 'قالب در وضعیت فعال',
        pass: dieActive,
        hard: true,
        noteFa: dieActive ? undefined : `وضعیت قالب ${ctx.die.code}: ${ctx.die.status}`,
      });
      const compatible = ctx.compatibleDieMachineIds.has(ctx.machine.id);
      checks.push({
        code: 'DIE_COMPATIBILITY',
        labelFa: 'سازگاری قالب با ماشین',
        pass: compatible,
        hard: true,
        noteFa: compatible ? `قالب ${ctx.die.code} با این ماشین سازگار است` : `قالب ${ctx.die.code} با این ماشین سازگار نیست`,
      });
    }
  }

  // time estimation for capacity check
  const time = estimateOperationTime({
    quantity: ctx.quantity,
    stepCycleTimeSec: ctx.routeStep?.cycleTimeSec ?? null,
    capabilityRatePerHour: ctx.capabilityRatePerHour,
    operationDefaultCycleTimeSec: ctx.operation.defaultCycleTimeSec,
    stepSetupTimeMin: ctx.routeStep?.setupTimeMin ?? null,
    operationDefaultSetupTimeMin: ctx.operation.defaultSetupTimeMin,
  });
  warningsFa.push(...time.warnings);

  const requiredMinutes = time.hours != null ? Math.ceil(time.hours.mul(60).toNumber()) : null;
  const totalMinutes = requiredMinutes != null ? requiredMinutes + time.setupMinutes : null;

  // c5 — shift capacity: operation must fit within one working day of shifts
  if (totalMinutes != null) {
    if (ctx.minutesPerDay <= 0) {
      checks.push({
        code: 'SHIFT_CAPACITY',
        labelFa: 'گنجایش در ظرفیت روزانه شیفت‌ها',
        pass: false,
        hard: true,
        noteFa: 'هیچ شیفت فعالی تعریف نشده است — ظرفیت روزانه صفر است',
      });
    } else {
      const fits = totalMinutes <= ctx.minutesPerDay;
      checks.push({
        code: 'SHIFT_CAPACITY',
        labelFa: 'گنجایش در ظرفیت روزانه شیفت‌ها',
        pass: fits,
        hard: true,
        noteFa: `${totalMinutes} دقیقه (تولید + راه‌اندازی) در برابر ظرفیت روزانه ${ctx.minutesPerDay} دقیقه`,
      });
      if (!fits) warningsFa.push('حجم این عملیات از ظرفیت یک روز کاری شیفت‌ها بزرگ‌تر است');
    }
  } else {
    warningsFa.push('بدون زمان سیکل استاندارد، کنترل ظرفیت شیفت ممکن نیست');
  }

  const eligible = checks.filter((c) => c.hard).every((c) => c.pass) && totalMinutes != null;

  // estimated completion (day granularity, ESTIMATED — never presented as exact)
  let busyDays: number | null = null;
  let estimatedStart: Date | null = null;
  let estimatedEnd: Date | null = null;
  if (eligible && ctx.minutesPerDay > 0 && totalMinutes != null) {
    busyDays = Math.max(1, Math.ceil((ctx.workloadMinutes + totalMinutes) / ctx.minutesPerDay));
    estimatedEnd = new Date(ctx.now.getTime() + busyDays * 24 * 3600 * 1000);
    const opDays = Math.max(1, Math.ceil(totalMinutes / ctx.minutesPerDay));
    estimatedStart = new Date(estimatedEnd.getTime() - opDays * 24 * 3600 * 1000);
  }

  return {
    machineId: ctx.machine.id,
    machineCode: ctx.machine.code,
    machineNameFa: ctx.machine.nameFa,
    machineStatus: ctx.machine.status,
    eligible,
    rank: null,
    timeSource: time.source,
    setupSource: time.setupSource,
    requiredHours: time.hours,
    requiredMinutes,
    setupMinutes: time.setupMinutes,
    workloadMinutes: ctx.workloadMinutes,
    minutesPerDay: ctx.minutesPerDay,
    busyDays,
    estimatedStart,
    estimatedEnd,
    checks,
    reasonsFa: [],
    warningsFa,
  };
}

export interface RankOptions {
  /// machine pinned by the route step (preferred, informational)
  routeStepMachineId: string | null;
}

/**
 * Rank ELIGIBLE candidates:
 *   1) earliest estimated completion (covers available capacity + workload),
 *   2) less setup time,
 *   3) lower current workload,
 *   4) stable tie-break by machine code.
 * Reasons are generated for every candidate (why ranked here / why not).
 */
export function rankCandidates(candidates: MachineCandidate[], opts: RankOptions): MachineCandidate[] {
  const eligible = candidates.filter((c) => c.eligible);
  const sorted = [...eligible].sort((a, b) => {
    const ea = a.estimatedEnd?.getTime() ?? Number.POSITIVE_INFINITY;
    const eb = b.estimatedEnd?.getTime() ?? Number.POSITIVE_INFINITY;
    if (ea !== eb) return ea - eb;
    if (a.setupMinutes !== b.setupMinutes) return a.setupMinutes - b.setupMinutes;
    if (a.workloadMinutes !== b.workloadMinutes) return a.workloadMinutes - b.workloadMinutes;
    return a.machineCode.localeCompare(b.machineCode);
  });
  sorted.forEach((c, i) => {
    c.rank = i + 1;
    const reasons: string[] = [];
    if (i === 0) reasons.push('کمترین زمان تکمیل تخمینی');
    else if (sorted[0] && c.estimatedEnd && sorted[0].estimatedEnd && c.estimatedEnd.getTime() === sorted[0].estimatedEnd.getTime()) {
      reasons.push('زمان تکمیل تخمینی برابر رتبه اول');
    }
    if (opts.routeStepMachineId && c.machineId === opts.routeStepMachineId) {
      reasons.push('ماشین تعیین‌شده در مسیر تولید قطعه');
    }
    if (sorted[0] && c.setupMinutes < sorted[0].setupMinutes) {
      reasons.push('زمان راه‌اندازی کمتر از رتبه اول');
    }
    if (sorted[0] && c.workloadMinutes < sorted[0].workloadMinutes) {
      reasons.push('بار کاری جاری کمتر از رتبه اول');
    }
    reasons.push(`ظرفیت روزانه شیفت‌ها: ${c.minutesPerDay} دقیقه`, `بار کاری جاری تخمینی: ${c.workloadMinutes} دقیقه`);
    c.reasonsFa = reasons;
  });

  for (const c of candidates) {
    if (!c.eligible) {
      c.reasonsFa = c.checks.filter((ch) => ch.hard && !ch.pass).map((ch) => ch.noteFa ?? ch.labelFa);
    }
  }
  return candidates;
}

/** Persian labels for time sources — the UI distinguishes calculated vs estimated. */
export const TIME_SOURCE_FA: Record<TimeSource, string> = {
  ROUTE_STEP: 'محاسبه‌شده از مسیر تولید',
  CAPABILITY: 'محاسبه‌شده از توانمندی ماشین',
  OPERATION_DEFAULT: 'محاسبه‌شده از زمان پیش‌فرض عملیات',
  MISSING: 'اطلاعات ناقص — زمان استاندارد ثبت نشده',
};

export const SETUP_SOURCE_FA: Record<SetupSource, string> = {
  ROUTE_STEP: 'محاسبه‌شده از مسیر تولید',
  OPERATION_DEFAULT: 'محاسبه‌شده از زمان پیش‌فرض عملیات',
  NOT_DEFINED: 'تعریف‌نشده (صفر — صریحاً علامت‌گذاری شده)',
};

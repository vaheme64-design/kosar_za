/**
 * KPIMS — Phase 8: MRP (Material Requirements Planning) utility.
 *
 * موتور محاسبه نیاز مواد — مستقل از برنامه تولید
 *
 * What it does:
 *   1. loads the OPEN customer-order demand (same netting rules as the
 *      planning engine — the same pure functions from planning.logic),
 *   2. nets it against finished-goods stock, order reservations, WIP and
 *      open manufacturing orders,
 *   3. explodes the net part requirement through the BOM into material
 *      requirements and nets THOSE against approved stock, active material
 *      reservations and open supplier contracts,
 *   4. highlights every shortage BEFORE material is issued to the shop floor.
 *
 * Honesty rules (unchanged):
 *   • read-only — an MRP run never creates documents, reservations or plans;
 *   • every figure comes from posted ledger data / official balances;
 *   • quarantined stock is excluded from supply and shown transparently;
 *   • consignment stock counts as supply (the factory consumes it) but is
 *     always reported separately from owned (financial) stock.
 */
import { Prisma } from '@prisma/client';
import { db } from '../../config/db';
import { ApiError } from '../../lib/http';
import { recordAudit } from '../../lib/audit';
import { logger } from '../../lib/logger';
import { toJalaliDateString } from '../../lib/jalali';
import {
  computeGrossDemand,
  computeFgAvailability,
  splitReservations,
  netLine,
  netWipAcrossOperations,
  type OrderLineInput,
  type WipOpSnapshot,
} from '../planning/planning.logic';

type Dec = Prisma.Decimal;
const D = Prisma.Decimal;
const Q0 = new D(0);
const dec = (v: Prisma.Decimal.Value | null | undefined): Dec => new D(v ?? 0);
const maxDec = (a: Dec, b: Dec): Dec => (a.comparedTo(b) >= 0 ? a : b);
const minDec = (a: Dec, b: Dec): Dec => (a.comparedTo(b) <= 0 ? a : b);

export interface MrpMaterialRow {
  materialId: string;
  materialCode: string;
  materialNameFa: string;
  grade: string | null;
  thicknessMm: string | null;
  unitCode: string;
  /** aggregated net requirement across all demand parts (base unit of the material) */
  requiredQuantity: string;
  /** same requirement expressed in kg when BOM carries weightKgPerUnit */
  requiredWeightKg: string | null;
  onHandOwned: string;
  onHandConsignment: string;
  /** excluded from supply — shown for transparency */
  onHandQuarantined: string;
  reservedActive: string;
  netAvailable: string;
  openContractQuantity: string;
  shortageQuantity: string;
  coveredByContract: string;
  severity: 'OK' | 'SHORTAGE_COVERED_BY_CONTRACT' | 'SHORTAGE';
  demandedByParts: { partId: string; partNumber: string; requiredQuantity: string }[];
  contractInfo: { contractNumber: string; remaining: string; expectedDeliveryDate: Date | null }[];
}

export interface MrpPartRow {
  partId: string;
  partNumber: string;
  nameFa: string;
  unitCode: string;
  grossDemand: string;
  coveredByStock: string;
  coveredByReservations: string;
  coveredByWip: string;
  coveredByCommittedMos: string;
  netRequirement: string;
  hasRoute: boolean;
  missingInfo: string[];
}

export interface MrpRunResult {
  ranAt: string;
  ranAtFa: string;
  scope: { orderLines: number; parts: number; withNetRequirement: number };
  parts: MrpPartRow[];
  materials: MrpMaterialRow[];
  summary: {
    materialsConsidered: number;
    ok: number;
    contractCovered: number;
    hardShortages: number;
  };
  notes: string[];
}

const OPEN_ORDER_STATUSES = ['CONFIRMED', 'IN_PRODUCTION', 'PARTIALLY_DELIVERED'] as const;
const OPEN_LINE_STATUSES = ['OPEN', 'IN_PRODUCTION'] as const;

/** Run a full MRP calculation over open demand (read-only). */
export async function runMrp(filters: { partIds?: string[]; orderIds?: string[] } = {}): Promise<MrpRunResult> {
  const notes: string[] = [];

  // ------------------------------------------------- 1) open demand
  const orders = await db.customerOrder.findMany({
    where: {
      status: { in: [...OPEN_ORDER_STATUSES] },
      ...(filters.orderIds?.length ? { id: { in: filters.orderIds } } : {}),
    },
    include: {
      customer: { select: { nameFa: true } },
      lines: {
        where: {
          status: { in: [...OPEN_LINE_STATUSES] },
          ...(filters.partIds?.length ? { partId: { in: filters.partIds } } : {}),
        },
        include: { part: { select: { id: true, partNumber: true, nameFa: true, baseUnit: { select: { code: true } } } } },
      },
    },
  });

  const orderLines: OrderLineInput[] = orders.flatMap((o) =>
    o.lines.map((l) => ({
      lineId: l.id,
      orderId: o.id,
      orderNumber: o.orderNumber,
      customerId: o.customerId,
      customerNameFa: o.customer.nameFa,
      lineNo: l.lineNo,
      partId: l.partId,
      quantity: l.quantity,
      deliveredQuantity: l.deliveredQuantity,
      dueDate: l.dueDate,
      lineStatus: l.status,
      orderStatus: o.status,
    })),
  );

  const demand = computeGrossDemand(orderLines);
  const partIds = [...demand.byPart.keys()];
  if (partIds.length === 0) {
    return {
      ranAt: new Date().toISOString(),
      ranAtFa: toJalaliDateString(new Date(), true),
      scope: { orderLines: orderLines.length, parts: 0, withNetRequirement: 0 },
      parts: [],
      materials: [],
      summary: { materialsConsidered: 0, ok: 0, contractCovered: 0, hardShortages: 0 },
      notes: ['سفارش بازی برای محاسبه MRP وجود ندارد'],
    };
  }

  // ------------------------------------------------- 2) reference data
  const bomMaterialIds = (
    await db.partMaterialRequirement.findMany({ where: { partId: { in: partIds } }, select: { materialId: true } })
  ).map((r) => r.materialId);

  const [fgWarehouses, bomRows, openMos, materialBalances, openContracts, activeMaterialReservations] = await Promise.all([
    db.warehouse.findMany({ where: { warehouseType: 'FINISHED_GOODS', isActive: true }, select: { id: true } }),
    db.partMaterialRequirement.findMany({
      where: { partId: { in: partIds } },
      include: { material: { select: { id: true, materialCode: true, nameFa: true, baseUnit: { select: { code: true } } } } },
    }),
    db.manufacturingOrder.findMany({
      where: { status: { in: ['PLANNED', 'RELEASED', 'IN_PROGRESS'] }, partId: { in: partIds } },
      include: { operations: { orderBy: { sequence: 'asc' } } },
    }),
    db.stockBalance.findMany({
      where: { OR: [{ partId: { in: partIds } }, { materialId: bomMaterialIds.length ? { in: bomMaterialIds } : undefined }] },
      select: { partId: true, materialId: true, quantity: true, weightKg: true, ownership: true, qualityStatus: true },
    }),
    db.materialContract.findMany({
      where: { status: { in: ['OPEN', 'PARTIALLY_RECEIVED'] } },
      include: { transactions: { select: { quantity: true } } },
    }),
    db.inventoryReservation.findMany({
      where: { status: 'ACTIVE', materialId: bomMaterialIds.length ? { in: bomMaterialIds } : undefined },
      select: { materialId: true, quantity: true, unitId: true },
    }),
  ]);

  const fgWhIds = new Set(fgWarehouses.map((w) => w.id));

  // WIP snapshot per (partId, operationId) — same definition as the planning engine
  const wipMap = new Map<string, { readyForTransfer: Dec; arriving: Dec; committed: Dec }>();
  const plannedMosByPart = new Map<string, { moNumber: string; remaining: Dec }[]>();
  for (const mo of openMos) {
    const lastOp = mo.operations[mo.operations.length - 1];
    if (mo.status === 'PLANNED') {
      const list = plannedMosByPart.get(mo.partId) ?? [];
      list.push({ moNumber: mo.moNumber, remaining: dec(mo.quantity).minus(lastOp ? dec(lastOp.producedQuantity) : Q0) });
      plannedMosByPart.set(mo.partId, list);
    }
    for (const op of mo.operations) {
      const key = `${mo.partId}:${op.operationId}`;
      const entry = wipMap.get(key) ?? { readyForTransfer: Q0, arriving: Q0, committed: Q0 };
      entry.readyForTransfer = entry.readyForTransfer.plus(dec(op.producedQuantity).minus(dec(op.transferredOutQuantity)));
      entry.arriving = entry.arriving.plus(dec(op.receivedQuantity).plus(dec(op.reworkQuantity)).minus(dec(op.inputQuantity)));
      entry.committed = entry.committed.plus(
        dec(op.plannedQuantity).minus(dec(op.producedQuantity)).minus(dec(op.scrappedQuantity)).minus(dec(op.rejectedQuantity)),
      );
      wipMap.set(key, entry);
    }
  }

  // ------------------------------------------------- 3) netting per part
  const partRows: MrpPartRow[] = [];
  // per part: net input requirement at the FIRST operation (drives material demand)
  const firstOpInputByPart = new Map<string, Dec>();
  let withNetRequirement = 0;

  for (const [partId, demandEntry] of demand.byPart) {
    const partMeta =
      orders.flatMap((o) => o.lines).find((l) => l.partId === partId)?.part ?? { id: partId, partNumber: '?', nameFa: '?', baseUnit: { code: '' } };

    const fgRows = materialBalances
      .filter((b) => b.partId === partId)
      .map((r) => ({ partId, quantity: r.quantity, ownership: r.ownership, qualityStatus: r.qualityStatus }));
    const fg = computeFgAvailability(fgRows);

    const reservationRows = await db.inventoryReservation.findMany({
      where: { partId, status: { in: ['ACTIVE', 'EXPIRED', 'RELEASED', 'CONSUMED'] } },
      select: { id: true, quantity: true, status: true, expiresAt: true, forCustomerOrderLineId: true, forManufacturingOrderId: true },
    });

    const route = await db.partRoute.findFirst({
      where: { partId, status: 'ACTIVE' },
      orderBy: { version: 'desc' },
      include: { steps: { orderBy: { sequence: 'asc' }, include: { operation: true } } },
    });

    let freeRemaining = fg.usable;
    const netted: ReturnType<typeof netLine>['result'][] = [];
    for (const line of demandEntry.lines) {
      const split = splitReservations(reservationRows, line.lineId);
      const { result, freeRemaining: updated } = netLine({ line, reservedForThisLine: split.forThisLine }, freeRemaining);
      freeRemaining = updated;
      netted.push(result);
    }

    const partNetBeforeMos = netted.reduce((acc, n) => acc.plus(n.netRequirement), Q0);
    const committedMos = plannedMosByPart.get(partId) ?? [];

    const wipOps: WipOpSnapshot[] = route
      ? route.steps.map((step) => {
          const w = wipMap.get(`${partId}:${step.operationId}`);
          return {
            sequence: step.sequence,
            operationId: step.operationId,
            operationCode: step.operation.code,
            operationNameFa: step.operation.nameFa,
            readyForTransfer: w?.readyForTransfer ?? Q0,
            arriving: w?.arriving ?? Q0,
            committedRemaining: w?.committed ?? Q0,
            scrapFactorPct: step.scrapFactorPct,
          };
        })
      : [];
    const wipNet = netWipAcrossOperations(partNetBeforeMos, wipOps);

    const missingInfo: string[] = [];
    if (!route) missingInfo.push('مسیر تولید ACTIVE برای این قطعه تعریف نشده است — محاسبه نیاز مواد انجام نشد');
    if (bomRows.filter((b) => b.partId === partId).length === 0) missingInfo.push('سرانه مصرف مواد (BOM) برای این قطعه تعریف نشده است');
    missingInfo.push(...wipNet.infeasibleReasons);

    if (wipNet.firstOpRequiredInput.comparedTo(0) > 0) withNetRequirement += 1;
    firstOpInputByPart.set(partId, wipNet.firstOpRequiredInput);

    partRows.push({
      partId,
      partNumber: partMeta.partNumber,
      nameFa: partMeta.nameFa,
      unitCode: partMeta.baseUnit.code,
      grossDemand: demandEntry.gross.toFixed(4),
      coveredByStock: netted.reduce((acc, n) => acc.plus(n.coveredByStock), Q0).toFixed(4),
      coveredByReservations: netted.reduce((acc, n) => acc.plus(n.coveredByReservations), Q0).toFixed(4),
      coveredByWip: wipNet.coveredByWip.toFixed(4),
      coveredByCommittedMos: wipNet.coveredByCommittedMos.toFixed(4),
      netRequirement: wipNet.mustProduceFinal.toFixed(4),
      hasRoute: Boolean(route),
      missingInfo: [...new Set(missingInfo)],
    });
  }

  // ------------------------------------------------- 4) material explosion
  // aggregate BOM demand per material ACROSS parts first, then net against
  // supply once (ERP-standard MRP netting — never net per part separately)
  const requiredByMaterial = new Map<string, Dec>();
  const requiredKgByMaterial = new Map<string, Dec>();
  const demandPartsByMaterial = new Map<string, { partId: string; partNumber: string; requiredQuantity: string }[]>();

  for (const [partId, firstOpInput] of firstOpInputByPart) {
    if (firstOpInput.comparedTo(0) <= 0) continue;
    const partBom = bomRows.filter((b) => b.partId === partId);
    const partMeta = partRows.find((p) => p.partId === partId);
    for (const b of partBom) {
      const req = dec(b.quantityPerUnit).mul(firstOpInput);
      requiredByMaterial.set(b.materialId, (requiredByMaterial.get(b.materialId) ?? Q0).plus(req));
      if (b.weightKgPerUnit != null) {
        requiredKgByMaterial.set(b.materialId, (requiredKgByMaterial.get(b.materialId) ?? Q0).plus(dec(b.weightKgPerUnit).mul(firstOpInput)));
      }
      const list = demandPartsByMaterial.get(b.materialId) ?? [];
      list.push({ partId, partNumber: partMeta?.partNumber ?? '?', requiredQuantity: req.toFixed(4) });
      demandPartsByMaterial.set(b.materialId, list);
    }
  }

  const materialIds = [...requiredByMaterial.keys()];
  const materials = materialIds.length
    ? await db.material.findMany({
        where: { id: { in: materialIds } },
        select: { id: true, materialCode: true, nameFa: true, grade: true, thicknessMm: true, baseUnit: { select: { id: true, code: true } } },
      })
    : [];
  const materialById = new Map(materials.map((m) => [m.id, m]));

  const matRows: MrpMaterialRow[] = [];
  for (const materialId of materialIds) {
    const m = materialById.get(materialId);
    if (!m) continue;

    const stockRows = materialBalances.filter((b) => b.materialId === materialId);
    let owned = Q0;
    let consignment = Q0;
    let quarantined = Q0;
    for (const s of stockRows) {
      const q = dec(s.quantity);
      if (q.comparedTo(0) <= 0) continue;
      if (s.qualityStatus !== 'APPROVED') {
        quarantined = quarantined.plus(q);
        continue;
      }
      if (s.ownership === 'OWNED') owned = owned.plus(q);
      else consignment = consignment.plus(q);
    }

    // reservations in the material base unit only (same discipline as ATP)
    const reservedActive = activeMaterialReservations
      .filter((r) => r.materialId === materialId && r.unitId === m.baseUnit.id)
      .reduce((acc, r) => acc.plus(dec(r.quantity)), Q0);

    const netAvailable = maxDec(owned.plus(consignment).minus(reservedActive), Q0);
    const required = requiredByMaterial.get(materialId) ?? Q0;
    const shortage = maxDec(required.minus(netAvailable), Q0);

    const contractInfo = openContracts
      .filter((c) => c.materialId === materialId)
      .map((c) => ({
        contractNumber: c.contractNumber,
        remaining: dec(c.totalQuantity).minus(c.transactions.reduce((acc, t) => acc.plus(dec(t.quantity)), Q0)),
        expectedDeliveryDate: c.expectedDeliveryDate,
      }))
      .filter((c) => c.remaining.comparedTo(0) > 0);
    const coveredByContract = minDec(shortage, contractInfo.reduce((acc, c) => acc.plus(c.remaining), Q0));

    matRows.push({
      materialId,
      materialCode: m.materialCode,
      materialNameFa: m.nameFa,
      grade: m.grade,
      thicknessMm: m.thicknessMm ? dec(m.thicknessMm).toFixed(3) : null,
      unitCode: m.baseUnit.code,
      requiredQuantity: required.toFixed(4),
      requiredWeightKg: requiredKgByMaterial.has(materialId) ? (requiredKgByMaterial.get(materialId) ?? Q0).toFixed(3) : null,
      onHandOwned: owned.toFixed(4),
      onHandConsignment: consignment.toFixed(4),
      onHandQuarantined: quarantined.toFixed(4),
      reservedActive: reservedActive.toFixed(4),
      netAvailable: netAvailable.toFixed(4),
      openContractQuantity: contractInfo.reduce((acc, c) => acc.plus(c.remaining), Q0).toFixed(4),
      shortageQuantity: shortage.toFixed(4),
      coveredByContract: coveredByContract.toFixed(4),
      severity: shortage.comparedTo(0) > 0 ? (coveredByContract.comparedTo(0) > 0 ? 'SHORTAGE_COVERED_BY_CONTRACT' : 'SHORTAGE') : 'OK',
      demandedByParts: demandPartsByMaterial.get(materialId) ?? [],
      contractInfo: contractInfo.map((c) => ({ ...c, remaining: c.remaining.toFixed(4) })),
    });
  }

  matRows.sort((a, b) => {
    const order = { SHORTAGE: 0, SHORTAGE_COVERED_BY_CONTRACT: 1, OK: 2 } as const;
    return order[a.severity] - order[b.severity] || a.materialCode.localeCompare(b.materialCode, 'fa');
  });

  if (partRows.some((p) => !p.hasRoute)) {
    notes.push('قطعاتی بدون مسیر تولید ACTIVE از محاسبه مواد حذف شده‌اند (در ستون «نکات» هر قطعه آمده است)');
  }

  return {
    ranAt: new Date().toISOString(),
    ranAtFa: toJalaliDateString(new Date(), true),
    scope: { orderLines: orderLines.length, parts: partIds.length, withNetRequirement },
    parts: partRows,
    materials: matRows,
    summary: {
      materialsConsidered: matRows.length,
      ok: matRows.filter((r) => r.severity === 'OK').length,
      contractCovered: matRows.filter((r) => r.severity === 'SHORTAGE_COVERED_BY_CONTRACT').length,
      hardShortages: matRows.filter((r) => r.severity === 'SHORTAGE').length,
    },
    notes,
  };
}

// ---------------------------------------------------------------------------
// Pre-issue check for a single manufacturing order
// ---------------------------------------------------------------------------

export interface MoMaterialCheckLine {
  materialId: string;
  materialCode: string;
  materialNameFa: string;
  unitCode: string;
  requiredQuantity: string;
  alreadyIssuedQuantity: string;
  remainingRequired: string;
  onHandApproved: string;
  reservedForThisMo: string;
  reservedForOthers: string;
  availableForThisMo: string;
  shortageQuantity: string;
  status: 'NOT_REQUIRED' | 'READY' | 'SHORTAGE';
  notes: string[];
}

export interface MoMaterialCheckResult {
  moId: string;
  moNumber: string;
  moStatus: string;
  partId: string;
  partNumber: string;
  partNameFa: string;
  moQuantity: string;
  lines: MoMaterialCheckLine[];
  readyToIssue: boolean;
  notes: string[];
}

/**
 * Check whether the materials of ONE manufacturing order can be issued right
 * now — the "before issuing material to the shop floor" gate.
 *
 * remainingRequired = BOM × MO quantity − already issued for this MO
 *   (issues are matched via documents with referenceType=MANUFACTURING_ORDER
 *    and referenceId=moId, in the material's base unit);
 * availableForThisMo = approved on-hand − active reservations for OTHERS
 *   (this MO's own reservations count as available — they exist for it).
 */
export async function checkMoMaterials(moId: string): Promise<MoMaterialCheckResult> {
  const mo = await db.manufacturingOrder.findUnique({
    where: { id: moId },
    include: { part: { select: { partNumber: true, nameFa: true } } },
  });
  if (!mo) throw new ApiError(404, 'Manufacturing order not found', 'دستور کار یافت نشد', 'mo_not_found');

  const bom = await db.partMaterialRequirement.findMany({
    where: { partId: mo.partId },
    include: {
      material: { select: { id: true, materialCode: true, nameFa: true, baseUnitId: true, baseUnit: { select: { code: true } } } },
    },
  });

  const notes: string[] = [];
  if (bom.length === 0) notes.push('سرانه مصرف (BOM) برای قطعه این دستور کار ثبت نشده است');

  const materialIds = bom.map((b) => b.materialId);

  // already issued FOR THIS MO (posted issues linked to it, base unit only)
  const issuedTxs = materialIds.length
    ? await db.inventoryTransaction.groupBy({
        by: ['materialId', 'unitId'],
        _sum: { quantity: true },
        where: {
          type: 'ISSUE',
          materialId: { in: materialIds },
          document: { referenceType: 'MANUFACTURING_ORDER', referenceId: moId },
        },
      })
    : [];

  // balances (approved) + reservations for the whole item set in one go
  const [balances, reservations] = await Promise.all([
    materialIds.length
      ? db.stockBalance.groupBy({
          by: ['materialId'],
          _sum: { quantity: true },
          where: { materialId: { in: materialIds }, qualityStatus: 'APPROVED' },
        })
      : Promise.resolve([] as { materialId: string | null; _sum: { quantity: Prisma.Decimal | null } }[]),
    materialIds.length
      ? db.inventoryReservation.findMany({
          where: { status: 'ACTIVE', materialId: { in: materialIds } },
          select: { materialId: true, quantity: true, unitId: true, forManufacturingOrderId: true, forCustomerOrderLineId: true },
        })
      : Promise.resolve([] as { materialId: string; quantity: Prisma.Decimal.Value; unitId: string; forManufacturingOrderId: string | null; forCustomerOrderLineId: string | null }[]),
  ]);

  const lines: MoMaterialCheckLine[] = [];
  for (const b of bom) {
    const baseUnitId = b.material.baseUnitId;
    const required = dec(b.quantityPerUnit).mul(mo.quantity);

    const issuedSameUnit = issuedTxs.find((t) => t.materialId === b.materialId && t.unitId === baseUnitId);
    const issuedOtherUnits = issuedTxs.filter((t) => t.materialId === b.materialId && t.unitId !== baseUnitId);
    const alreadyIssued = dec(issuedSameUnit?._sum.quantity ?? 0);
    if (issuedOtherUnits.length > 0) {
      notes.push(`${b.material.materialCode}: مصرف ثبت‌شده با واحدی غیر از واحد پایه در مقایسه لحاظ نشد`);
    }

    const remainingRequired = maxDec(required.minus(alreadyIssued), Q0);
    const onHandApproved = dec(balances.find((x) => x.materialId === b.materialId)?._sum.quantity ?? 0);

    const resThisMo = reservations
      .filter((r) => r.materialId === b.materialId && r.unitId === baseUnitId && r.forManufacturingOrderId === moId)
      .reduce((acc, r) => acc.plus(dec(r.quantity)), Q0);
    const resOthers = reservations
      .filter((r) => r.materialId === b.materialId && r.unitId === baseUnitId && r.forManufacturingOrderId !== moId)
      .reduce((acc, r) => acc.plus(dec(r.quantity)), Q0);
    const availableForThisMo = onHandApproved.minus(resOthers);

    const shortage = maxDec(remainingRequired.minus(availableForThisMo), Q0);
    const lineNotes: string[] = [];
    if (resThisMo.comparedTo(0) > 0) lineNotes.push('برای این دستور کار رزرو فعال وجود دارد');

    lines.push({
      materialId: b.materialId,
      materialCode: b.material.materialCode,
      materialNameFa: b.material.nameFa,
      unitCode: b.material.baseUnit.code,
      requiredQuantity: required.toFixed(4),
      alreadyIssuedQuantity: alreadyIssued.toFixed(4),
      remainingRequired: remainingRequired.toFixed(4),
      onHandApproved: onHandApproved.toFixed(4),
      reservedForThisMo: resThisMo.toFixed(4),
      reservedForOthers: resOthers.toFixed(4),
      availableForThisMo: availableForThisMo.toFixed(4),
      shortageQuantity: shortage.toFixed(4),
      status: remainingRequired.comparedTo(0) <= 0 ? 'NOT_REQUIRED' : shortage.comparedTo(0) > 0 ? 'SHORTAGE' : 'READY',
      notes: lineNotes,
    });
  }

  return {
    moId,
    moNumber: mo.moNumber,
    moStatus: mo.status,
    partId: mo.partId,
    partNumber: mo.part.partNumber,
    partNameFa: mo.part.nameFa,
    moQuantity: mo.quantity.toFixed(4),
    lines,
    readyToIssue: lines.length > 0 && lines.every((l) => l.status !== 'SHORTAGE'),
    notes: [...new Set(notes)],
  };
}

// ---------------------------------------------------------------------------
// Phase 8 (scheduler) — stored MRP snapshots, daily run, audit trail
// ---------------------------------------------------------------------------

const MRP_SNAPSHOT_KEEP = 30;
const MRP_STALE_HOURS = 24;

export interface MrpSnapshotRow {
  id: string;
  ranAt: string;
  triggeredBy: string;
  summary: MrpRunResult['summary'];
  result: MrpRunResult;
}

/**
 * Run the MRP calculation and persist the result as a snapshot.
 *
 * The snapshot is NOT a business document — it is the stored output of a
 * read-only calculation, used by the dashboard shortage alert and the MRP
 * page so the heavy calculation is not repeated on every load. Each run is
 * recorded in the audit log (append-only) with its shortage summary; old
 * snapshots are pruned to the most recent MRP_SNAPSHOT_KEEP rows.
 */
export async function runAndStoreMrp(triggeredBy: string): Promise<MrpRunResult> {
  const result = await runMrp({});
  const snapshot = await db.mrpSnapshot.create({
    data: {
      triggeredBy: triggeredBy.slice(0, 64),
      summaryJson: result.summary as unknown as Prisma.InputJsonValue,
      resultJson: result as unknown as Prisma.InputJsonValue,
    },
  });
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  await recordAudit(db, {
    // audit.userId is a UUID FK — scheduler runs have no user at all
    userId: UUID_RE.test(triggeredBy) ? triggeredBy : null,
    action: 'RUN',
    entityType: 'MrpRun',
    entityId: snapshot.id,
    changes: {
      trigger: triggeredBy === 'SCHEDULER' ? 'SCHEDULER' : 'MANUAL',
      scope: result.scope,
      summary: result.summary,
      shortageMaterials: result.materials
        .filter((m) => m.severity !== 'OK')
        .map((m) => ({ materialCode: m.materialCode, severity: m.severity, shortage: m.shortageQuantity, unit: m.unitCode })),
    },
  });
  // prune — keep the most recent N snapshots
  const keep = await db.mrpSnapshot.findMany({
    orderBy: { ranAt: 'desc' },
    take: MRP_SNAPSHOT_KEEP,
    select: { id: true },
  });
  if (keep.length === MRP_SNAPSHOT_KEEP) {
    await db.mrpSnapshot.deleteMany({ where: { id: { notIn: keep.map((k) => k.id) } } });
  }
  return result;
}

/** Newest stored snapshot (or null when MRP has never run). */
export async function getLatestMrpSnapshot(): Promise<MrpSnapshotRow | null> {
  const row = await db.mrpSnapshot.findFirst({ orderBy: { ranAt: 'desc' } });
  if (!row) return null;
  return {
    id: row.id,
    ranAt: row.ranAt.toISOString(),
    triggeredBy: row.triggeredBy,
    summary: row.summaryJson as unknown as MrpRunResult['summary'],
    result: row.resultJson as unknown as MrpRunResult,
  };
}

/**
 * Dashboard-facing shortage alert payload. Reads the newest snapshot and
 * states its age honestly; when the snapshot is missing it is computed and
 * stored once (so the first dashboard load after deployment seeds it).
 */
export async function getMrpAlert(): Promise<{
  available: boolean;
  stale: boolean;
  ageHours: number | null;
  ranAt: string | null;
  summary: MrpRunResult['summary'] | null;
  topShortages: { materialId: string; materialCode: string; materialNameFa: string; shortage: string; unitCode: string; severity: string }[];
  reasonFa?: string;
}> {
  let latest = await getLatestMrpSnapshot();
  if (!latest) {
    await runAndStoreMrp('SCHEDULER');
    latest = await getLatestMrpSnapshot();
    if (!latest) return { available: false, stale: true, ageHours: null, ranAt: null, summary: null, topShortages: [], reasonFa: 'محاسبه MRP در دسترس نیست' };
  }
  const ageHours = (Date.now() - new Date(latest.ranAt).getTime()) / 3_600_000;
  const stale = ageHours >= MRP_STALE_HOURS;
  const materials = latest.result.materials ?? [];
  const topShortages = materials
    .filter((m) => m.severity !== 'OK')
    .sort((a, b) => Number(b.shortageQuantity) - Number(a.shortageQuantity))
    .slice(0, 5)
    .map((m) => ({
      materialId: m.materialId,
      materialCode: m.materialCode,
      materialNameFa: m.materialNameFa,
      shortage: m.shortageQuantity,
      unitCode: m.unitCode,
      severity: m.severity,
    }));
  return { available: true, stale, ageHours: Math.round(ageHours * 10) / 10, ranAt: latest.ranAt, summary: latest.summary, topShortages };
}

// ---------------------------------------------------------------------------
// In-process daily scheduler (single API process)
// ---------------------------------------------------------------------------

let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let schedulerRunning = false;

/**
 * Background MRP run — every hour, but the calculation itself executes at
 * most once per MRP_STALE_HOURS (a daily cadence unless someone deletes the
 * snapshots). Failures are logged and never crash the API; the in-flight
 * flag prevents overlapping runs.
 */
export async function scheduledMrpTick(): Promise<void> {
  if (schedulerRunning) return;
  schedulerRunning = true;
  try {
    const latest = await getLatestMrpSnapshot();
    const ageHours = latest ? (Date.now() - new Date(latest.ranAt).getTime()) / 3_600_000 : Infinity;
    if (ageHours < MRP_STALE_HOURS) return;
    const result = await runAndStoreMrp('SCHEDULER');
    logger.info('[mrp-scheduler] snapshot stored', {
      hardShortages: result.summary.hardShortages,
      contractCovered: result.summary.contractCovered,
    });
  } catch (err) {
    logger.error('[mrp-scheduler] run failed', { error: String(err) });
  } finally {
    schedulerRunning = false;
  }
}

/** Start the hourly tick (first run shortly after boot). Idempotent. */
export function startMrpScheduler(): void {
  if (schedulerTimer) return;
  schedulerTimer = setInterval(() => void scheduledMrpTick(), 60 * 60 * 1000);
  // first run shortly after boot so the dashboard alert has data today
  setTimeout(() => void scheduledMrpTick(), 45_000);
  logger.info('[mrp-scheduler] started (hourly tick, snapshot at most every 24h)');
}

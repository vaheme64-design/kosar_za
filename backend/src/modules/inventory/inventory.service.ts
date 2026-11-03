import { Prisma, type InventoryTxType, type StockOwnership, type QualityStatus } from '@prisma/client';
import { db } from '../../config/db';
import { ApiError } from '../../lib/http';
import { recordAudit } from '../../lib/audit';
import { getSetting } from '../../lib/settings';
import { generateDocumentNumber } from '../../services/documentNumber.service';
import {
  createDocumentSchema,
  createContractSchema,
  createReservationSchema,
  lineSchemaFor,
  qualityReleaseSchema,
  reverseDocumentSchema,
  type CreateDocumentInput,
} from './inventory.schemas';
import { deriveLotStatus, LOT_STATUS_FA, loadLotAggregates } from '../reports/reports.service';

const D = Prisma.Decimal;
type Tx = Prisma.TransactionClient;
type Dec = Prisma.Decimal;

/** Sign of a ledger movement per transaction type (immutable ledger math). */
const TX_SIGN: Record<InventoryTxType, 1 | -1> = {
  RECEIPT: 1,
  TRANSFER_IN: 1,
  ADJUSTMENT_IN: 1,
  ISSUE: -1,
  TRANSFER_OUT: -1,
  ADJUSTMENT_OUT: -1,
};

const FLIP_TYPE: Record<InventoryTxType, InventoryTxType> = {
  RECEIPT: 'ISSUE',
  ISSUE: 'RECEIPT',
  TRANSFER_IN: 'TRANSFER_OUT',
  TRANSFER_OUT: 'TRANSFER_IN',
  ADJUSTMENT_IN: 'ADJUSTMENT_OUT',
  ADJUSTMENT_OUT: 'ADJUSTMENT_IN',
};

/** Balance dimensions — the identity of one StockBalance row. */
interface BalanceDims {
  partId: string | null;
  materialId: string | null;
  warehouseId: string;
  locationId: string | null;
  lotId: string | null;
  /// balances are tracked per unit of measure (piece vs kilogram)
  unitId: string;
  ownership: StockOwnership;
  qualityStatus: QualityStatus;
}

function balanceKeyOf(d: BalanceDims): string {
  return [
    d.partId ?? '-',
    d.materialId ?? '-',
    d.warehouseId,
    d.locationId ?? '-',
    d.lotId ?? '-',
    d.unitId,
    d.ownership,
    d.qualityStatus,
  ].join(':');
}

function whereOf(d: Omit<BalanceDims, 'warehouseId'> & { warehouseId?: string }): Record<string, unknown> {
  return {
    partId: d.partId,
    materialId: d.materialId,
    warehouseId: d.warehouseId,
    locationId: d.locationId,
    lotId: d.lotId,
    unitId: d.unitId,
    ownership: d.ownership,
    qualityStatus: d.qualityStatus,
  };
}

/**
 * Ledger position for exact dimensions, computed FROM POSTED TRANSACTIONS
 * (business rule 1 — official balances are a projection of the immutable
 * ledger, never edited directly). Must be called inside the posting tx.
 */
async function ledgerPosition(
  tx: Tx,
  d: Omit<BalanceDims, 'warehouseId'> & { warehouseId?: string },
): Promise<{ quantity: Dec; weightKg: Dec }> {
  const groups = await tx.inventoryTransaction.groupBy({
    by: ['type'],
    where: whereOf(d) as Prisma.InventoryTransactionWhereInput,
    _sum: { quantity: true, weightKg: true },
  });
  let quantity = new D(0);
  let weightKg = new D(0);
  for (const g of groups) {
    const sign = TX_SIGN[g.type];
    if (g._sum?.quantity) quantity = quantity.plus(new D(g._sum.quantity).mul(sign));
    if (g._sum?.weightKg) weightKg = weightKg.plus(new D(g._sum.weightKg).mul(sign));
  }
  return { quantity, weightKg };
}

/** Apply a signed movement to the official balance with negative-stock guard. */
async function applyStockMovement(
  tx: Tx,
  dims: BalanceDims,
  qtyDelta: Dec,
  weightDelta: Dec,
  occurredAt: Date,
): Promise<void> {
  if (qtyDelta.isNegative() || weightDelta.isNegative()) {
    // Authoritative check against the ledger (source of truth).
    const pos = await ledgerPosition(tx, dims);
    if (pos.quantity.plus(qtyDelta).isNegative()) {
      throw new ApiError(
        422,
        `Insufficient stock: requested ${qtyDelta.abs().toFixed(4)}, available ${pos.quantity.toFixed(4)}`,
        'موجودی کافی نیست؛ موجودی رسمی منفی نمی‌شود',
        'negative_stock',
        { requested: qtyDelta.abs().toFixed(4), available: pos.quantity.toFixed(4) },
      );
    }
    if (pos.weightKg.plus(weightDelta).isNegative()) {
      throw new ApiError(
        422,
        `Insufficient stock weight: requested ${weightDelta.abs().toFixed(4)} kg, available ${pos.weightKg.toFixed(4)} kg`,
        'وزن کافی نیست؛ موجودی منفی نمی‌شود',
        'negative_stock_weight',
        { requestedKg: weightDelta.abs().toFixed(4), availableKg: pos.weightKg.toFixed(4) },
      );
    }
  }

  const key = balanceKeyOf(dims);
  const existing = await tx.stockBalance.findUnique({ where: { balanceKey: key } });
  if (existing) {
    await tx.stockBalance.update({
      where: { id: existing.id },
      data: {
        quantity: new D(existing.quantity).plus(qtyDelta),
        weightKg: new D(existing.weightKg).plus(weightDelta),
        lastTransactionAt: occurredAt,
      },
    });
  } else {
    if (qtyDelta.isNegative() || weightDelta.isNegative()) {
      throw new ApiError(
        422,
        'Cannot remove stock that was never received',
        'برداشت از موجودی که هرگز ثبت نشده ممکن نیست',
        'negative_stock',
      );
    }
    await tx.stockBalance.create({
      data: {
        partId: dims.partId,
        materialId: dims.materialId,
        warehouseId: dims.warehouseId,
        locationId: dims.locationId,
        lotId: dims.lotId,
        unitId: dims.unitId,
        ownership: dims.ownership,
        qualityStatus: dims.qualityStatus,
        balanceKey: key,
        quantity: qtyDelta,
        weightKg: weightDelta,
        lastTransactionAt: occurredAt,
      },
    });
  }
}

/**
 * Resolve a document line item (part xor material): validates existence,
 * resolves the unit (default = item base unit) and derives the weight in kg.
 * `allowNegative` is only for adjustment lines (negative = decrease).
 */
async function resolveLineItem(
  tx: Tx,
  line: { partId?: string | null; materialId?: string | null; unitId?: string | null; quantity: string; weightKg?: string | null },
  allowNegative = false,
): Promise<{
  partId: string | null;
  materialId: string | null;
  unitId: string;
  quantity: Dec;
  weightKg: Dec | null;
}> {
  const quantity = new D(line.quantity);
  if (quantity.comparedTo(0) === 0) {
    throw new ApiError(422, 'Quantity must be non-zero', 'مقدار نمی‌تواند صفر باشد', 'bad_quantity');
  }
  if (!allowNegative && !quantity.isPositive()) {
    throw new ApiError(422, 'Quantity must be positive', 'مقدار باید مثبت باشد', 'bad_quantity');
  }

  if (line.partId) {
    const part = await tx.part.findUnique({ where: { id: line.partId } });
    if (!part) throw new ApiError(404, 'Part not found', 'قطعه یافت نشد', 'part_not_found');
    const unitId = line.unitId ?? part.baseUnitId;
    const unit = await tx.unitOfMeasure.findUnique({ where: { id: unitId } });
    if (!unit) throw new ApiError(404, 'Unit not found', 'واحد شمارش یافت نشد', 'unit_not_found');
    const weightKg = line.weightKg != null ? new D(line.weightKg) : part.standardWeightKg ? quantity.mul(new D(part.standardWeightKg)) : null;
    return { partId: part.id, materialId: null, unitId, quantity, weightKg };
  }

  const material = await tx.material.findUnique({
    where: { id: line.materialId! },
    include: { baseUnit: true },
  });
  if (!material) throw new ApiError(404, 'Material not found', 'ماده اولیه یافت نشد', 'material_not_found');

  const unitId = line.unitId ?? material.baseUnitId;
  const unit = await tx.unitOfMeasure.findUnique({ where: { id: unitId } });
  if (!unit) throw new ApiError(404, 'Unit not found', 'واحد شمارش یافت نشد', 'unit_not_found');

  let weightKg: Dec;
  if (line.weightKg != null) {
    weightKg = new D(line.weightKg);
  } else if (unit.kind === 'WEIGHT') {
    weightKg = quantity; // base unit is KG → quantity IS kilograms
  } else if (material.unitWeightKg) {
    weightKg = quantity.mul(new D(material.unitWeightKg)); // e.g. sheets × kg/sheet
  } else {
    throw new ApiError(
      422,
      `Weight cannot be derived for material ${material.materialCode}; provide weightKg explicitly`,
      'وزن به‌صورت خودکار محاسبه نمی‌شود؛ وزن را صریح وارد کنید',
      'weight_required',
    );
  }
  return { partId: null, materialId: material.id, unitId, quantity, weightKg };
}

async function createLedgerTx(
  tx: Tx,
  args: {
    documentId: string;
    documentLineId: string | null;
    type: InventoryTxType;
    partId: string | null;
    materialId: string | null;
    warehouseId: string;
    locationId: string | null;
    lotId: string | null;
    ownership: StockOwnership;
    qualityStatus: QualityStatus;
    quantity: Dec;
    unitId: string;
    weightKg: Dec | null;
    reversalOfId?: string | null;
    createdById: string | null;
  },
) {
  const transactionNumber = await generateDocumentNumber(tx, 'TX');
  return tx.inventoryTransaction.create({
    data: {
      transactionNumber,
      documentId: args.documentId,
      documentLineId: args.documentLineId,
      type: args.type,
      partId: args.partId,
      materialId: args.materialId,
      warehouseId: args.warehouseId,
      locationId: args.locationId,
      lotId: args.lotId,
      ownership: args.ownership,
      qualityStatus: args.qualityStatus,
      quantity: args.quantity,
      unitId: args.unitId,
      weightKg: args.weightKg,
      reversalOfId: args.reversalOfId ?? null,
      createdById: args.createdById,
    },
  });
}

interface LotOp {
  lotId: string;
  qtyDelta: Dec;
  weightDelta: Dec;
}

async function updateLot(tx: Tx, op: LotOp, occurredAt: Date): Promise<void> {
  const lot = await tx.materialLot.findUnique({ where: { id: op.lotId } });
  if (!lot) return;
  const remaining = new D(lot.quantityRemaining).plus(op.qtyDelta);
  const weightRemaining = new D(lot.weightRemainingKg).plus(op.weightDelta);
  // receipts also grow the cumulative received counters
  const receivedQty = op.qtyDelta.isPositive()
    ? new D(lot.quantityReceived).plus(op.qtyDelta)
    : new D(lot.quantityReceived);
  const receivedWeight = op.weightDelta.isPositive()
    ? new D(lot.weightReceivedKg).plus(op.weightDelta)
    : new D(lot.weightReceivedKg);
  await tx.materialLot.update({
    where: { id: lot.id },
    data: {
      quantityReceived: receivedQty,
      quantityRemaining: remaining,
      weightReceivedKg: receivedWeight,
      weightRemainingKg: weightRemaining,
      status: remaining.comparedTo(0) <= 0 ? 'CLOSED' : lot.status === 'BLOCKED' ? 'BLOCKED' : 'OPEN',
    },
  });
  void occurredAt;
}

async function refreshContractStatus(tx: Tx, contractId: string): Promise<void> {
  const contract = await tx.materialContract.findUnique({ where: { id: contractId } });
  if (!contract) return;
  const agg = await tx.materialContractTransaction.aggregate({
    where: { contractId },
    _sum: { quantity: true },
  });
  const received = agg._sum.quantity ? new D(agg._sum.quantity) : new D(0);
  const total = new D(contract.totalQuantity);
  let status: 'OPEN' | 'PARTIALLY_RECEIVED' | 'COMPLETED' = 'OPEN';
  if (received.comparedTo(0) > 0 && received.comparedTo(total) < 0) status = 'PARTIALLY_RECEIVED';
  if (received.comparedTo(total) >= 0) status = 'COMPLETED';
  await tx.materialContract.update({ where: { id: contractId }, data: { status } });
}

async function consumeReservation(tx: Tx, reservationId: string, qty: Dec): Promise<void> {
  const res = await tx.inventoryReservation.findUnique({ where: { id: reservationId } });
  if (!res) return;
  const remaining = new D(res.quantity).minus(qty);
  await tx.inventoryReservation.update({
    where: { id: reservationId },
    data: {
      quantity: remaining.comparedTo(0) <= 0 ? new D(0) : remaining,
      status: remaining.comparedTo(0) <= 0 ? 'CONSUMED' : 'ACTIVE',
    },
  });
}

// ---------------------------------------------------------------------------
// document creation (DRAFT — never affects stock; business rule 2)
// ---------------------------------------------------------------------------

export async function createDocument(input: CreateDocumentInput, userId: string, meta: { ip?: string; ua?: string }) {
  const parsed = createDocumentSchema.parse(input);
  const allowNegative = parsed.documentType === 'ADJUSTMENT';

  const document = await db.$transaction(async (tx) => {
    // resolve + normalize every line up-front (unit, weight, item existence)
    const resolvedLines = [];
    for (const raw of parsed.lines) {
      const line = lineSchemaFor(parsed.documentType).parse(raw);
      const item = await resolveLineItem(tx, line as never, allowNegative);
      resolvedLines.push({ line, item });
    }

    const documentNumber = await generateDocumentNumber(tx, 'INV');
    const doc = await tx.inventoryDocument.create({
      data: {
        documentNumber,
        documentType: parsed.documentType,
        status: 'DRAFT',
        postingStatus: 'UNPOSTED',
        documentDate: new Date(`${parsed.documentDate}T00:00:00Z`),
        warehouseId: parsed.warehouseId,
        referenceType: parsed.referenceType,
        referenceId: parsed.referenceId,
        description: parsed.description ?? null,
        reasonCode: parsed.reasonCode ?? null,
        reasonText: parsed.reasonText ?? null,
        createdById: userId,
        lines: {
          create: resolvedLines.map(({ line, item }, i) => ({
            lineNo: i + 1,
            partId: item.partId,
            materialId: item.materialId,
            lotId: (line as { lotId?: string }).lotId ?? null,
            lotNumber: (line as { lotNumber?: string }).lotNumber ?? null,
            quantity: item.quantity,
            unitId: item.unitId,
            weightKg: item.weightKg,
            fromLocationId: (line as { fromLocationId?: string }).fromLocationId ?? (line as { locationId?: string }).locationId ?? null,
            toLocationId: (line as { toLocationId?: string }).toLocationId ?? (line as { locationId?: string }).locationId ?? null,
            contractId: (line as { contractId?: string }).contractId ?? null,
            reservationId: (line as { reservationId?: string }).reservationId ?? null,
            ownership: (line as { ownership?: StockOwnership }).ownership ?? null,
            qualityStatus: (line as { qualityStatus?: QualityStatus }).qualityStatus ?? null,
            notes: (line as { notes?: string }).notes ?? null,
          })),
        },
      },
      include: { lines: true },
    });
    await recordAudit(tx, {
      userId,
      action: 'CREATE',
      entityType: 'InventoryDocument',
      entityId: doc.id,
      changes: { documentType: doc.documentType, lines: doc.lines.length },
      ipAddress: meta.ip,
      userAgent: meta.ua,
    });
    return doc;
  });

  return document;
}

export async function getDocument(id: string) {
  const doc = await db.inventoryDocument.findUnique({
    where: { id },
    include: {
      warehouse: true,
      createdBy: { select: { fullName: true, username: true } },
      postedBy: { select: { fullName: true, username: true } },
      reversalOf: { select: { id: true, documentNumber: true } },
      reversals: { select: { id: true, documentNumber: true, postingStatus: true } },
      lines: {
        orderBy: { lineNo: 'asc' },
        include: {
          part: { select: { partNumber: true, nameFa: true } },
          material: { select: { materialCode: true, nameFa: true } },
          lot: { select: { lotNumber: true } },
          unit: { select: { code: true, nameFa: true } },
          fromLocation: { select: { code: true, nameFa: true } },
          toLocation: { select: { code: true, nameFa: true } },
          contract: { select: { contractNumber: true } },
          transactions: { select: { id: true, transactionNumber: true, type: true } },
        },
      },
    },
  });
  if (!doc) throw new ApiError(404, 'Document not found', 'سند یافت نشد', 'document_not_found');
  return doc;
}

export async function listDocuments(filters: { documentType?: string; status?: string; postingStatus?: string; take?: number }) {
  return db.inventoryDocument.findMany({
    where: {
      documentType: filters.documentType as never,
      status: filters.status as never,
      postingStatus: filters.postingStatus as never,
    },
    orderBy: { createdAt: 'desc' },
    take: filters.take ?? 100,
    include: {
      warehouse: { select: { code: true, nameFa: true } },
      createdBy: { select: { fullName: true } },
      _count: { select: { lines: true } },
    },
  });
}

export async function cancelDocument(id: string, userId: string, meta: { ip?: string; ua?: string }) {
  return db.$transaction(async (tx) => {
    const doc = await tx.inventoryDocument.findUnique({ where: { id } });
    if (!doc) throw new ApiError(404, 'Document not found', 'سند یافت نشد', 'document_not_found');
    if (doc.postingStatus !== 'UNPOSTED') {
      throw new ApiError(
        409,
        'Posted documents cannot be cancelled — use a reversal document',
        'سند قطع‌بوش‌شده قابل ابطال نیست؛ از سند ابطالی استفاده کنید',
        'doc_already_posted',
      );
    }
    const updated = await tx.inventoryDocument.update({ where: { id }, data: { status: 'CANCELLED' } });
    await recordAudit(tx, {
      userId,
      action: 'CANCEL',
      entityType: 'InventoryDocument',
      entityId: id,
      ipAddress: meta.ip,
      userAgent: meta.ua,
    });
    return updated;
  });
}

// ---------------------------------------------------------------------------
// POSTING — atomic; the only place the ledger and official balances change
// ---------------------------------------------------------------------------

interface Movement {
  lineDbId: string;
  type: InventoryTxType;
  partId: string | null;
  materialId: string | null;
  warehouseId: string;
  locationId: string | null;
  lotId: string | null;
  unitId: string;
  ownership: StockOwnership;
  qualityStatus: QualityStatus;
  quantity: Dec; // always positive — direction comes from type
  weightKg: Dec | null; // always positive
  lotOp?: LotOp | null;
  contractTx?: { contractId: string; quantity: Dec; weightKg: Dec | null; lotId: string | null } | null;
  reservationId?: string | null;
  reservationQty?: Dec | null;
}

type DocWithLines = Prisma.InventoryDocumentGetPayload<{ include: { lines: true } }>;

export async function postDocument(id: string, userId: string, meta: { ip?: string; ua?: string }) {
  return db.$transaction(
    async (tx) => {
      const doc = await tx.inventoryDocument.findUnique({
        where: { id },
        include: { lines: { orderBy: { lineNo: 'asc' } } },
      });
      if (!doc) throw new ApiError(404, 'Document not found', 'سند یافت نشد', 'document_not_found');
      if (doc.status === 'CANCELLED') {
        throw new ApiError(409, 'Cancelled documents cannot be posted', 'سند ابطال‌شده قابل قطع‌بوش نیست', 'doc_cancelled');
      }

      // ---- duplicate-posting guard: atomic conditional update (rule 4) ----
      const guarded = await tx.inventoryDocument.updateMany({
        where: { id, postingStatus: 'UNPOSTED' },
        data: { status: 'CONFIRMED', postingStatus: 'POSTED', postedById: userId, postedAt: new Date() },
      });
      if (guarded.count === 0) {
        throw new ApiError(
          409,
          `Document ${doc.documentNumber} is already posted`,
          'این سند قبلاً قطع‌بوش شده است',
          'duplicate_posting',
        );
      }

      const occurredAt = new Date();
      const movements: Movement[] = [];

      for (const line of doc.lines) {
        const allowNegative = doc.documentType === 'ADJUSTMENT';
        const item = await resolveLineItem(
          tx,
          {
            partId: line.partId,
            materialId: line.materialId,
            unitId: line.unitId,
            quantity: String(line.quantity),
            weightKg: line.weightKg != null ? String(line.weightKg) : null,
          },
          allowNegative,
        );

        switch (doc.documentType) {
          case 'RECEIPT':
          case 'PRODUCTION_RECEIPT':
            await buildReceiptMovement(tx, doc, line, item, movements);
            break;
          case 'ISSUE':
          case 'PRODUCTION_ISSUE':
          case 'SCRAP_DISPOSAL':
            await buildIssueMovement(tx, doc, line, item, movements);
            break;
          case 'TRANSFER':
            await buildTransferMovement(tx, doc, line, item, movements);
            break;
          case 'ADJUSTMENT':
            await buildAdjustmentMovement(tx, doc, line, item, movements, doc.warehouseId);
            break;
        }
      }

      // ---- write ledger transactions + balances atomically ----
      // NOTE: apply the balance movement BEFORE writing its own ledger row so
      // the negative-stock check measures the position excluding this document.
      for (const m of movements) {
        const sign = TX_SIGN[m.type];
        await applyStockMovement(
          tx,
          {
            partId: m.partId,
            materialId: m.materialId,
            warehouseId: m.warehouseId,
            locationId: m.locationId,
            lotId: m.lotId,
            unitId: m.unitId,
            ownership: m.ownership,
            qualityStatus: m.qualityStatus,
          },
          new D(sign).mul(m.quantity),
          m.weightKg ? new D(sign).mul(m.weightKg) : new D(0),
          occurredAt,
        );
        await createLedgerTx(tx, {
          documentId: doc.id,
          documentLineId: m.lineDbId,
          type: m.type,
          partId: m.partId,
          materialId: m.materialId,
          warehouseId: m.warehouseId,
          locationId: m.locationId,
          lotId: m.lotId,
          ownership: m.ownership,
          qualityStatus: m.qualityStatus,
          quantity: m.quantity,
          unitId: m.unitId,
          weightKg: m.weightKg,
          createdById: userId,
        });

        if (m.lotOp) await updateLot(tx, m.lotOp, occurredAt);

        if (m.contractTx) {
          await tx.materialContractTransaction.create({
            data: {
              contractId: m.contractTx.contractId,
              receivedDate: doc.documentDate,
              quantity: m.contractTx.quantity,
              weightKg: m.contractTx.weightKg,
              lotId: m.contractTx.lotId,
              inventoryDocumentId: doc.id,
              notes: doc.reversalOfId ? 'سند ابطالی' : null,
            },
          });
          await refreshContractStatus(tx, m.contractTx.contractId);
        }

        if (m.reservationId && m.reservationQty) {
          await consumeReservation(tx, m.reservationId, m.reservationQty);
        }
      }

      await recordAudit(tx, {
        userId,
        action: 'POST',
        entityType: 'InventoryDocument',
        entityId: doc.id,
        changes: {
          documentNumber: doc.documentNumber,
          documentType: doc.documentType,
          movements: movements.length,
          reasonCode: doc.reasonCode,
          reasonText: doc.reasonText,
          reversalOf: doc.reversalOfId,
        },
        ipAddress: meta.ip,
        userAgent: meta.ua,
      });

      return tx.inventoryDocument.findUnique({
        where: { id: doc.id },
        include: { transactions: true, lines: true },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 },
  );
}

async function buildReceiptMovement(
  tx: Tx,
  doc: DocWithLines,
  line: DocWithLines['lines'][number],
  item: Awaited<ReturnType<typeof resolveLineItem>>,
  movements: Movement[],
): Promise<void> {
  let lotId: string | null = null;
  let ownership: StockOwnership = line.ownership ?? (line.contractId ? 'SUPPLIER_CONSIGNMENT' : 'OWNED');

  if (item.materialId) {
    if (line.lotId) {
      const lot = await tx.materialLot.findUnique({ where: { id: line.lotId } });
      if (!lot) throw new ApiError(404, 'Lot not found', 'لوت یافت نشد', 'lot_not_found');
      if (lot.materialId !== item.materialId) {
        throw new ApiError(422, 'Lot belongs to a different material', 'لوت متعلق به ماده اولیه دیگری است', 'lot_material_mismatch');
      }
      lotId = lot.id;
      ownership = line.ownership ?? lot.ownership;
    } else if (line.lotNumber) {
      const existing = await tx.materialLot.findUnique({
        where: { materialId_lotNumber: { materialId: item.materialId, lotNumber: line.lotNumber } },
      });
      if (existing) {
        lotId = existing.id;
        ownership = line.ownership ?? existing.ownership;
      } else {
        const lot = await tx.materialLot.create({
          data: {
            materialId: item.materialId,
            lotNumber: line.lotNumber,
            receiptDate: doc.documentDate,
            quantityReceived: 0,
            quantityRemaining: 0,
            weightReceivedKg: 0,
            weightRemainingKg: 0,
            ownership,
          },
        });
        lotId = lot.id;
      }
    } else {
      throw new ApiError(
        422,
        'Material receipts require a lot (lotId or lotNumber)',
        'رسید ماده اولیه نیازمند شماره لوت است',
        'lot_required',
      );
    }
    if (line.contractId) {
      const contract = await tx.materialContract.findUnique({ where: { id: line.contractId } });
      if (!contract) throw new ApiError(404, 'Contract not found', 'قرارداد یافت نشد', 'contract_not_found');
      if (contract.materialId !== item.materialId) {
        throw new ApiError(422, 'Contract is for a different material', 'قرارداد متعلق به ماده اولیه دیگری است', 'contract_material_mismatch');
      }
    }
  }

  movements.push({
    lineDbId: line.id,
    type: 'RECEIPT',
    partId: item.partId,
    materialId: item.materialId,
    warehouseId: doc.warehouseId,
    locationId: line.toLocationId,
    lotId,
    unitId: item.unitId,
    ownership,
    qualityStatus: line.qualityStatus ?? 'APPROVED',
    quantity: item.quantity,
    weightKg: item.weightKg,
    lotOp: lotId ? { lotId, qtyDelta: item.quantity, weightDelta: item.weightKg ?? new D(0) } : null,
    contractTx: line.contractId
      ? { contractId: line.contractId, quantity: item.quantity, weightKg: item.weightKg, lotId }
      : null,
  });
}

async function buildIssueMovement(
  tx: Tx,
  doc: DocWithLines,
  line: DocWithLines['lines'][number],
  item: Awaited<ReturnType<typeof resolveLineItem>>,
  movements: Movement[],
): Promise<void> {
  let lotId: string | null = null;
  let ownership: StockOwnership = 'OWNED';
  if (item.materialId) {
    if (!line.lotId) {
      throw new ApiError(
        422,
        'Material issues must reference a lot (lotId)',
        'حواله ماده اولیه باید شماره لوت داشته باشد',
        'lot_required',
      );
    }
    const lot = await tx.materialLot.findUnique({ where: { id: line.lotId } });
    if (!lot) throw new ApiError(404, 'Lot not found', 'لوت یافت نشد', 'lot_not_found');
    if (lot.materialId !== item.materialId) {
      throw new ApiError(422, 'Lot belongs to a different material', 'لوت متعلق به ماده اولیه دیگری است', 'lot_material_mismatch');
    }
    lotId = lot.id;
    ownership = lot.ownership;
  }

  let reservationId: string | null = null;
  let reservationQty: Dec | null = null;
  if (line.reservationId) {
    const res = await tx.inventoryReservation.findUnique({ where: { id: line.reservationId } });
    if (!res) throw new ApiError(404, 'Reservation not found', 'رزرو یافت نشد', 'reservation_not_found');
    if (res.status !== 'ACTIVE') {
      throw new ApiError(409, 'Reservation is not active', 'رزرو فعال نیست', 'reservation_inactive');
    }
    const sameItem = res.partId ? res.partId === item.partId : res.materialId === item.materialId;
    if (!sameItem) {
      throw new ApiError(422, 'Reservation is for a different item', 'رزرو متعلق به قلم دیگری است', 'reservation_item_mismatch');
    }
    if (res.warehouseId && res.warehouseId !== doc.warehouseId) {
      throw new ApiError(422, 'Reservation is for a different warehouse', 'رزرو متعلق به انبار دیگری است', 'reservation_warehouse_mismatch');
    }
    if (res.unitId !== item.unitId) {
      throw new ApiError(422, 'Reservation unit differs from the issue unit', 'واحد رزرو با واحد حواله متفاوت است', 'reservation_unit_mismatch');
    }
    reservationId = res.id;
    reservationQty = item.quantity;
  }

  movements.push({
    lineDbId: line.id,
    type: 'ISSUE',
    partId: item.partId,
    materialId: item.materialId,
    warehouseId: doc.warehouseId,
    locationId: line.fromLocationId,
    lotId,
    unitId: item.unitId,
    ownership,
    qualityStatus: 'APPROVED',
    quantity: item.quantity,
    weightKg: item.weightKg,
    lotOp: lotId ? { lotId, qtyDelta: item.quantity.neg(), weightDelta: (item.weightKg ?? new D(0)).neg() } : null,
    reservationId,
    reservationQty,
  });
}

async function buildTransferMovement(
  tx: Tx,
  doc: DocWithLines,
  line: DocWithLines['lines'][number],
  item: Awaited<ReturnType<typeof resolveLineItem>>,
  movements: Movement[],
): Promise<void> {
  let lotId: string | null = null;
  let ownership: StockOwnership = 'OWNED';
  if (item.materialId) {
    if (!line.lotId) {
      throw new ApiError(422, 'Material transfers must reference a lot', 'انتقال ماده اولیه نیازمند لوت است', 'lot_required');
    }
    const lot = await tx.materialLot.findUnique({ where: { id: line.lotId } });
    if (!lot) throw new ApiError(404, 'Lot not found', 'لوت یافت نشد', 'lot_not_found');
    if (lot.materialId !== item.materialId) {
      throw new ApiError(422, 'Lot belongs to a different material', 'لوت متعلق به ماده اولیه دیگری است', 'lot_material_mismatch');
    }
    lotId = lot.id;
    ownership = lot.ownership;
  }

  const destLocation = await tx.warehouseLocation.findUnique({ where: { id: line.toLocationId! } });
  if (!destLocation) throw new ApiError(404, 'Destination location not found', 'موقعیت مقصد یافت نشد', 'location_not_found');
  if (destLocation.warehouseId === doc.warehouseId && line.fromLocationId === destLocation.id) {
    throw new ApiError(422, 'Source and destination must differ', 'مبدأ و مقصد باید متفاوت باشند', 'same_location');
  }

  const common = {
    lineDbId: line.id,
    partId: item.partId,
    materialId: item.materialId,
    lotId,
    unitId: item.unitId,
    ownership,
    qualityStatus: 'APPROVED' as QualityStatus,
    quantity: item.quantity,
    weightKg: item.weightKg,
  };

  movements.push({
    ...common,
    type: 'TRANSFER_OUT',
    warehouseId: doc.warehouseId,
    locationId: line.fromLocationId,
    lotOp: lotId ? { lotId, qtyDelta: item.quantity.neg(), weightDelta: (item.weightKg ?? new D(0)).neg() } : null,
  });
  movements.push({
    ...common,
    type: 'TRANSFER_IN',
    warehouseId: destLocation.warehouseId,
    locationId: destLocation.id,
    lotOp: null,
  });
}

async function buildAdjustmentMovement(
  tx: Tx,
  doc: DocWithLines,
  line: DocWithLines['lines'][number],
  item: Awaited<ReturnType<typeof resolveLineItem>>,
  movements: Movement[],
  warehouseId: string,
): Promise<void> {
  const qty = item.quantity; // signed: negative = decrease
  const weight = item.weightKg ?? new D(0);
  const increase = qty.isPositive();

  let lotId: string | null = line.lotId;
  let ownership: StockOwnership = line.ownership ?? 'OWNED';
  if (item.materialId) {
    if (!lotId && line.lotNumber) {
      const existing = await tx.materialLot.findUnique({
        where: { materialId_lotNumber: { materialId: item.materialId, lotNumber: line.lotNumber } },
      });
      if (existing) {
        lotId = existing.id;
        ownership = line.ownership ?? existing.ownership;
      } else {
        const lot = await tx.materialLot.create({
          data: {
            materialId: item.materialId,
            lotNumber: line.lotNumber,
            receiptDate: doc.documentDate,
            quantityReceived: 0,
            quantityRemaining: 0,
            weightReceivedKg: 0,
            weightRemainingKg: 0,
            ownership,
          },
        });
        lotId = lot.id;
      }
    }
    if (!lotId) {
      throw new ApiError(422, 'Material adjustments require a lot', 'اصلاحیه ماده اولیه نیازمند لوت است', 'lot_required');
    }
    const lot = await tx.materialLot.findUnique({ where: { id: lotId } });
    if (!lot) throw new ApiError(404, 'Lot not found', 'لوت یافت نشد', 'lot_not_found');
    if (lot.materialId !== item.materialId) {
      throw new ApiError(422, 'Lot belongs to a different material', 'لوت متعلق به ماده اولیه دیگری است', 'lot_material_mismatch');
    }
    ownership = line.ownership ?? lot.ownership;
  }

  movements.push({
    lineDbId: line.id,
    type: increase ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
    partId: item.partId,
    materialId: item.materialId,
    warehouseId,
    locationId: line.toLocationId ?? line.fromLocationId,
    lotId,
    unitId: item.unitId,
    ownership,
    qualityStatus: line.qualityStatus ?? 'APPROVED',
    quantity: increase ? qty : qty.neg(),
    weightKg: increase ? weight : weight.neg(),
    lotOp: lotId ? { lotId, qtyDelta: qty, weightDelta: weight } : null,
  });
  void tx;
}

// ---------------------------------------------------------------------------
// REVERSAL — corrections always through reversal documents (rule 10)
// ---------------------------------------------------------------------------

export async function reverseDocument(id: string, userId: string, reason: string, meta: { ip?: string; ua?: string }) {
  const parsed = reverseDocumentSchema.parse({ reason });

  return db.$transaction(
    async (tx) => {
      const original = await tx.inventoryDocument.findUnique({
        where: { id },
        include: { lines: { orderBy: { lineNo: 'asc' } } },
      });
      if (!original) throw new ApiError(404, 'Document not found', 'سند یافت نشد', 'document_not_found');
      if (original.postingStatus === 'UNPOSTED') {
        throw new ApiError(409, 'Draft documents are cancelled, not reversed', 'سند پیش‌نویس ابطال می‌شود نه ابطال قطع‌بوش', 'doc_not_posted');
      }
      if (original.postingStatus === 'REVERSED') {
        throw new ApiError(409, 'Document is already reversed', 'این سند قبلاً ابطال شده است', 'already_reversed');
      }
      if (original.reversalOfId != null) {
        throw new ApiError(409, 'Reversal documents cannot be reversed', 'سند ابطالی قابل ابطال مجدد نیست', 'reversal_of_reversal');
      }

      // mark original reversed (guarded)
      const guarded = await tx.inventoryDocument.updateMany({
        where: { id, postingStatus: 'POSTED' },
        data: { postingStatus: 'REVERSED' },
      });
      if (guarded.count === 0) {
        throw new ApiError(409, 'Document state changed concurrently', 'وضعیت سند هم‌زمان تغییر کرده است', 'conflict');
      }

      // reversal document shell
      const documentNumber = await generateDocumentNumber(tx, 'INV');
      const reversalDoc = await tx.inventoryDocument.create({
        data: {
          documentNumber,
          documentType: original.documentType,
          status: 'CONFIRMED',
          postingStatus: 'UNPOSTED',
          documentDate: new Date(),
          warehouseId: original.warehouseId,
          description: `ابطال سند ${original.documentNumber} — ${parsed.reason}`,
          reasonCode: 'OTHER',
          reasonText: parsed.reason,
          createdById: userId,
          reversalOfId: original.id,
          lines: {
            create: original.lines.map((l) => ({
              lineNo: l.lineNo,
              partId: l.partId,
              materialId: l.materialId,
              lotId: l.lotId,
              lotNumber: null,
              quantity: new D(l.quantity).abs(),
              unitId: l.unitId,
              weightKg: l.weightKg ? new D(l.weightKg).abs() : null,
              fromLocationId: l.toLocationId, // mirrored
              toLocationId: l.fromLocationId,
              contractId: l.contractId,
              reservationId: null,
              ownership: l.ownership,
              qualityStatus: l.qualityStatus,
              notes: `ابطال ${original.documentNumber}`,
            })),
          },
        },
        include: { lines: true },
      });

      // map original line id → reversal line id (mirrored by lineNo)
      const reversalLineByOriginalLine = new Map<string, string>();
      for (const ol of original.lines) {
        const rl = reversalDoc.lines.find((l) => l.lineNo === ol.lineNo);
        if (rl) reversalLineByOriginalLine.set(ol.id, rl.id);
      }

      // mirror every original transaction with flipped type, same dimensions
      const originalTxs = await tx.inventoryTransaction.findMany({ where: { documentId: original.id } });
      if (originalTxs.length === 0) {
        throw new ApiError(500, 'Original document has no transactions', 'سند اصلی تراکنشی ندارد', 'reversal_no_tx');
      }
      const occurredAt = new Date();
      for (const t of originalTxs) {
        const flipType = FLIP_TYPE[t.type];
        const sign = TX_SIGN[flipType];
        const qty = new D(t.quantity).abs();
        const weight = t.weightKg ? new D(t.weightKg).abs() : null;
        const dims = {
          partId: t.partId,
          materialId: t.materialId,
          warehouseId: t.warehouseId,
          locationId: t.locationId,
          lotId: t.lotId,
          unitId: t.unitId,
          ownership: t.ownership,
          qualityStatus: t.qualityStatus,
        };
        // apply the balance movement BEFORE writing the flipped ledger row so
        // the negative-stock check sees only the original ledger
        await applyStockMovement(
          tx,
          dims,
          new D(sign).mul(qty),
          weight ? new D(sign).mul(weight) : new D(0),
          occurredAt,
        );
        await createLedgerTx(tx, {
          documentId: reversalDoc.id,
          documentLineId: t.documentLineId ? reversalLineByOriginalLine.get(t.documentLineId) ?? null : null,
          type: flipType,
          partId: t.partId,
          materialId: t.materialId,
          warehouseId: t.warehouseId,
          locationId: t.locationId,
          lotId: t.lotId,
          ownership: t.ownership,
          qualityStatus: t.qualityStatus,
          quantity: qty,
          unitId: t.unitId,
          weightKg: weight,
          reversalOfId: t.id,
          createdById: userId,
        });
        if (t.lotId) {
          await updateLot(
            tx,
            {
              lotId: t.lotId,
              qtyDelta: new D(sign).mul(qty),
              weightDelta: weight ? new D(sign).mul(weight) : new D(0),
            },
            occurredAt,
          );
        }
      }

      // restore consumed reservations of the original issue lines
      for (const line of original.lines) {
        if (line.reservationId) {
          const res = await tx.inventoryReservation.findUnique({ where: { id: line.reservationId } });
          if (res) {
            const restored = new D(res.quantity).plus(new D(line.quantity).abs());
            await tx.inventoryReservation.update({
              where: { id: res.id },
              data: { quantity: restored, status: 'ACTIVE' },
            });
          }
        }
      }

      // negative contract-ledger entries for receipt lines with contracts
      for (const line of original.lines) {
        if (line.contractId) {
          await tx.materialContractTransaction.create({
            data: {
              contractId: line.contractId,
              receivedDate: new Date(),
              quantity: new D(line.quantity).abs().neg(),
              weightKg: line.weightKg ? new D(line.weightKg).abs().neg() : null,
              lotId: line.lotId,
              inventoryDocumentId: reversalDoc.id,
              notes: `ابطال ${original.documentNumber}`,
            },
          });
          await refreshContractStatus(tx, line.contractId);
        }
      }

      const postedReversal = await tx.inventoryDocument.update({
        where: { id: reversalDoc.id },
        data: { status: 'CONFIRMED', postingStatus: 'POSTED', postedById: userId, postedAt: new Date() },
      });

      await recordAudit(tx, {
        userId,
        action: 'REVERSE',
        entityType: 'InventoryDocument',
        entityId: original.id,
        changes: {
          reversalDocumentId: reversalDoc.id,
          reversalNumber: reversalDoc.documentNumber,
          reason: parsed.reason,
        },
        ipAddress: meta.ip,
        userAgent: meta.ua,
      });

      return postedReversal;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 },
  );
}

// ---------------------------------------------------------------------------
// reservations
// ---------------------------------------------------------------------------

export async function createReservation(input: unknown, userId: string) {
  const parsed = createReservationSchema.parse(input);
  return db.$transaction(async (tx) => {
    const unitId =
      parsed.unitId ??
      (parsed.partId
        ? (await tx.part.findUnique({ where: { id: parsed.partId } }))?.baseUnitId
        : (await tx.material.findUnique({ where: { id: parsed.materialId! } }))?.baseUnitId);
    if (!unitId) throw new ApiError(422, 'unitId could not be resolved', 'واحد شمارش مشخص نشده است', 'unit_required');

    const reservation = await tx.inventoryReservation.create({
      data: {
        partId: parsed.partId ?? null,
        materialId: parsed.materialId ?? null,
        warehouseId: parsed.warehouseId ?? null,
        quantity: new D(parsed.quantity),
        unitId,
        forManufacturingOrderId: parsed.forManufacturingOrderId ?? null,
        forCustomerOrderLineId: parsed.forCustomerOrderLineId ?? null,
        expiresAt: parsed.expiresAt ? new Date(parsed.expiresAt) : null,
        notes: parsed.notes ?? null,
      },
    });
    await recordAudit(tx, {
      userId,
      action: 'CREATE',
      entityType: 'InventoryReservation',
      entityId: reservation.id,
      changes: { quantity: parsed.quantity },
    });
    return reservation;
  });
}

export async function releaseReservation(id: string, userId: string) {
  return db.$transaction(async (tx) => {
    const res = await tx.inventoryReservation.findUnique({ where: { id } });
    if (!res) throw new ApiError(404, 'Reservation not found', 'رزرو یافت نشد', 'reservation_not_found');
    if (res.status !== 'ACTIVE') {
      throw new ApiError(409, 'Only active reservations can be released', 'فقط رزرو فعال قابل آزادسازی است', 'reservation_not_active');
    }
    const updated = await tx.inventoryReservation.update({ where: { id }, data: { status: 'RELEASED' } });
    await recordAudit(tx, { userId, action: 'RELEASE', entityType: 'InventoryReservation', entityId: id });
    return updated;
  });
}

export async function listReservations(status?: string) {
  return db.inventoryReservation.findMany({
    where: { status: status as never },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: {
      part: { select: { partNumber: true, nameFa: true } },
      material: { select: { materialCode: true, nameFa: true } },
      unit: { select: { code: true } },
      warehouse: { select: { code: true, nameFa: true } },
      forManufacturingOrder: { select: { moNumber: true } },
    },
  });
}

// ---------------------------------------------------------------------------
// balances / ledger / inquiries
// ---------------------------------------------------------------------------

export interface BalanceRow {
  partId: string | null;
  materialId: string | null;
  itemCode: string;
  itemName: string;
  unitCode: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  locationId: string | null;
  locationCode: string | null;
  lotId: string | null;
  lotNumber: string | null;
  ownership: StockOwnership;
  qualityStatus: QualityStatus;
  quantity: string;
  weightKg: string;
  lastTransactionAt: string | null;
}

export interface ReservedSummaryRow {
  partId: string | null;
  materialId: string | null;
  warehouseId: string | null;
  unitCode: string;
  quantity: string;
}

export interface BalanceFilters {
  partId?: string;
  materialId?: string;
  warehouseId?: string;
  locationId?: string;
  lotId?: string;
  ownership?: StockOwnership;
  qualityStatus?: QualityStatus;
}

export interface LedgerFilters {
  partId?: string;
  materialId?: string;
  warehouseId?: string;
  lotId?: string;
  documentId?: string;
  type?: InventoryTxType;
  from?: string;
  to?: string;
  take?: number;
}

/** Physical / owned / consignment / blocked / reserved / available stock inquiry. */
export async function getBalances(filters: BalanceFilters) {
  const where: Prisma.StockBalanceWhereInput = {
    partId: filters.partId,
    materialId: filters.materialId,
    warehouseId: filters.warehouseId,
    locationId: filters.locationId,
    lotId: filters.lotId,
    ownership: filters.ownership,
    qualityStatus: filters.qualityStatus,
  };

  const rows = await db.stockBalance.findMany({
    where,
    include: {
      part: { select: { partNumber: true, nameFa: true, baseUnit: { select: { code: true } } } },
      material: { select: { materialCode: true, nameFa: true, baseUnit: { select: { code: true } } } },
      warehouse: { select: { code: true, nameFa: true } },
      location: { select: { code: true, nameFa: true } },
      lot: { select: { lotNumber: true } },
      unit: { select: { code: true, nameFa: true } },
    },
    orderBy: [{ warehouseId: 'asc' }, { updatedAt: 'desc' }],
    take: 1000,
  });

  const result: BalanceRow[] = rows.map((b) => ({
    partId: b.partId,
    materialId: b.materialId,
    itemCode: b.part?.partNumber ?? b.material?.materialCode ?? '',
    itemName: b.part?.nameFa ?? b.material?.nameFa ?? '',
    unitCode: b.unit.code,
    warehouseId: b.warehouseId,
    warehouseCode: b.warehouse.code,
    warehouseName: b.warehouse.nameFa,
    locationId: b.locationId,
    locationCode: b.location?.code ?? null,
    lotId: b.lotId,
    lotNumber: b.lot?.lotNumber ?? null,
    ownership: b.ownership,
    qualityStatus: b.qualityStatus,
    quantity: new D(b.quantity).toFixed(4),
    weightKg: new D(b.weightKg).toFixed(4),
    lastTransactionAt: b.lastTransactionAt?.toISOString() ?? null,
  }));

  return result;
}

export async function getReservedSummary(): Promise<ReservedSummaryRow[]> {
  const allReservations = await db.inventoryReservation.groupBy({
    by: ['partId', 'materialId', 'warehouseId', 'unitId'],
    where: { status: 'ACTIVE' },
    _sum: { quantity: true },
  });
  const out: ReservedSummaryRow[] = [];
  for (const r of allReservations) {
    const u = await db.unitOfMeasure.findUnique({ where: { id: r.unitId }, select: { code: true } });
    out.push({
      partId: r.partId,
      materialId: r.materialId,
      warehouseId: r.warehouseId,
      unitCode: u?.code ?? '',
      quantity: new D(r._sum?.quantity ?? 0).toFixed(4),
    });
  }
  return out;
}

export async function getLedger(filters: LedgerFilters) {
  const where: Prisma.InventoryTransactionWhereInput = {
    partId: filters.partId,
    materialId: filters.materialId,
    warehouseId: filters.warehouseId,
    lotId: filters.lotId,
    documentId: filters.documentId,
    type: filters.type,
  };
  if (filters.from || filters.to) {
    where.occurredAt = {};
    if (filters.from) where.occurredAt.gte = new Date(`${filters.from}T00:00:00.000Z`);
    if (filters.to) where.occurredAt.lte = new Date(`${filters.to}T23:59:59.999Z`);
  }
  const rows = await db.inventoryTransaction.findMany({
    where,
    orderBy: { occurredAt: 'desc' },
    take: Number(filters.take ?? 200),
    include: {
      part: { select: { partNumber: true, nameFa: true } },
      material: { select: { materialCode: true, nameFa: true } },
      warehouse: { select: { code: true, nameFa: true } },
      location: { select: { code: true, nameFa: true } },
      lot: { select: { lotNumber: true } },
      unit: { select: { code: true } },
      document: { select: { documentNumber: true, documentType: true, reasonCode: true } },
      createdBy: { select: { fullName: true } },
      reversalOf: { select: { transactionNumber: true } },
    },
  });
  return rows;
}

// ---------------------------------------------------------------------------
// Supplier material account report (kg) + contracts
// (تأمین‌کننده از تنظیمات سامانه خوانده می‌شود — قابل شخصی‌سازی)
// ---------------------------------------------------------------------------

export async function getSapcoAccount(filters: { materialId?: string; from?: string; to?: string }) {
  const defaultSupplier = await getSetting('materials.defaultSupplierName', 'SAPCO');
  const materials = await db.material.findMany({
    where: { ...(filters.materialId ? { id: filters.materialId } : {}), supplierName: { equals: defaultSupplier, mode: 'insensitive' } },
    include: { baseUnit: true },
  });

  const fromDate = filters.from ? new Date(`${filters.from}T00:00:00.000Z`) : null;
  const toDate = filters.to ? new Date(`${filters.to}T23:59:59.999Z`) : new Date();

  const inTypes: InventoryTxType[] = ['RECEIPT', 'TRANSFER_IN', 'ADJUSTMENT_IN'];
  const outTypes: InventoryTxType[] = ['ISSUE', 'TRANSFER_OUT', 'ADJUSTMENT_OUT'];

  const rows = [];
  for (const material of materials) {
    const baseWhere: Prisma.InventoryTransactionWhereInput = { materialId: material.id };
    const periodWhere: Prisma.InventoryTransactionWhereInput = {
      ...baseWhere,
      occurredAt: { gte: fromDate ?? undefined, lte: toDate },
    };
    const openingWhere: Prisma.InventoryTransactionWhereInput = fromDate
      ? { ...baseWhere, occurredAt: { lt: fromDate } }
      : { id: '00000000-0000-0000-0000-000000000000' }; // no period start → opening is zero

    const [receipts, consumption, byOwnership, openingGroups] = await Promise.all([
      db.inventoryTransaction.aggregate({
        where: { ...periodWhere, type: { in: inTypes } },
        _sum: { weightKg: true },
      }),
      db.inventoryTransaction.aggregate({
        where: { ...periodWhere, type: { in: outTypes } },
        _sum: { weightKg: true },
      }),
      db.inventoryTransaction.groupBy({
        by: ['ownership'],
        where: { ...periodWhere, type: { in: inTypes } },
        _sum: { weightKg: true },
      }),
      db.inventoryTransaction.groupBy({ by: ['type'], where: openingWhere, _sum: { weightKg: true } }),
    ]);

    let openingKg = new D(0);
    for (const g of openingGroups) {
      if (g._sum?.weightKg) openingKg = openingKg.plus(new D(g._sum.weightKg).mul(TX_SIGN[g.type]));
    }

    const receivedKg = receipts._sum.weightKg ? new D(receipts._sum.weightKg) : new D(0);
    const consumedKg = consumption._sum.weightKg ? new D(consumption._sum.weightKg) : new D(0);
    const closingKg = openingKg.plus(receivedKg).minus(consumedKg);

    const consignmentReceived = byOwnership.find((o) => o.ownership === 'SUPPLIER_CONSIGNMENT')?._sum.weightKg;
    const ownedReceived = byOwnership.find((o) => o.ownership === 'OWNED')?._sum.weightKg;

    const contractTxs = await db.materialContractTransaction.findMany({
      where: {
        contract: { materialId: material.id },
        receivedDate: { gte: fromDate ?? undefined, lte: toDate },
      },
      include: { contract: { select: { contractNumber: true, status: true, totalWeightKg: true } } },
      orderBy: { receivedDate: 'asc' },
      take: 200,
    });

    rows.push({
      materialId: material.id,
      materialCode: material.materialCode,
      materialName: material.nameFa,
      grade: material.grade,
      thicknessMm: material.thicknessMm,
      openingKg: openingKg.toFixed(3),
      receivedKg: receivedKg.toFixed(3),
      ownedReceivedKg: ownedReceived ? new D(ownedReceived).toFixed(3) : '0.000',
      consignmentReceivedKg: consignmentReceived ? new D(consignmentReceived).toFixed(3) : '0.000',
      consumedKg: consumedKg.toFixed(3),
      closingKg: closingKg.toFixed(3),
      contractMovements: contractTxs.map((t) => ({
        id: t.id,
        contractNumber: t.contract.contractNumber,
        contractStatus: t.contract.status,
        receivedDate: t.receivedDate,
        quantity: new D(t.quantity).toFixed(2),
        weightKg: t.weightKg ? new D(t.weightKg).toFixed(3) : null,
        isReversal: new D(t.quantity).isNegative(),
        notes: t.notes,
      })),
    });
  }
  return rows;
}

export async function listContracts() {
  const contracts = await db.materialContract.findMany({
    orderBy: { orderDate: 'desc' },
    include: {
      material: { select: { materialCode: true, nameFa: true, baseUnit: { select: { code: true } } } },
      transactions: { select: { quantity: true, weightKg: true } },
    },
    take: 200,
  });
  return contracts.map((c) => {
    const receivedQty = c.transactions.reduce((acc, t) => acc.plus(new D(t.quantity)), new D(0));
    const receivedKg = c.transactions.reduce((acc, t) => acc.plus(t.weightKg ? new D(t.weightKg) : new D(0)), new D(0));
    return {
      id: c.id,
      contractNumber: c.contractNumber,
      supplierName: c.supplierName,
      material: c.material,
      orderDate: c.orderDate,
      expectedDeliveryDate: c.expectedDeliveryDate,
      totalQuantity: new D(c.totalQuantity).toFixed(2),
      totalWeightKg: c.totalWeightKg ? new D(c.totalWeightKg).toFixed(3) : null,
      receivedQuantity: receivedQty.toFixed(2),
      receivedWeightKg: receivedKg.toFixed(3),
      status: c.status,
      description: c.description,
    };
  });
}

export async function createContract(input: unknown, userId: string) {
  const parsed = createContractSchema.parse(input);
  // تأمین‌کنندهٔ پیش‌فرض از تنظیمات سامانه (قابل تغییر توسط کاربر)
  const supplierName = parsed.supplierName?.trim() || (await getSetting('materials.defaultSupplierName', 'SAPCO'));
  const contract = await db.materialContract.create({
    data: {
      contractNumber: parsed.contractNumber,
      supplierName,
      materialId: parsed.materialId,
      orderDate: new Date(`${parsed.orderDate}T00:00:00Z`),
      expectedDeliveryDate: parsed.expectedDeliveryDate ? new Date(`${parsed.expectedDeliveryDate}T00:00:00Z`) : null,
      totalQuantity: new D(parsed.totalQuantity),
      totalWeightKg: parsed.totalWeightKg != null ? new D(parsed.totalWeightKg) : null,
      description: parsed.description ?? null,
    },
  });
  await recordAudit(db, {
    userId,
    action: 'CREATE',
    entityType: 'MaterialContract',
    entityId: contract.id,
    changes: { contractNumber: contract.contractNumber },
  });
  return contract;
}

export async function listLots(materialId?: string) {
  return db.materialLot.findMany({
    where: materialId ? { materialId } : undefined,
    orderBy: { receiptDate: 'desc' },
    take: 200,
    include: { material: { select: { materialCode: true, nameFa: true } } },
  });
}

// ---------------------------------------------------------------------------
// quality release — reclassification between quality dimensions (net zero)
// ---------------------------------------------------------------------------

export async function releaseQuality(input: unknown, userId: string, meta: { ip?: string; ua?: string }) {
  const parsed = qualityReleaseSchema.parse(input);
  const qty = new D(parsed.quantity);
  if (!qty.isPositive()) {
    throw new ApiError(422, 'Quantity must be positive', 'مقدار باید مثبت باشد', 'bad_quantity');
  }

  return db.$transaction(
    async (tx) => {
      let partId: string | null = null;
      let materialId: string | null = null;
      let unitId: string;
      let weightKg: Dec | null = null;
      let ownership: StockOwnership = 'OWNED';

      if (parsed.lotId) {
        const lot = await tx.materialLot.findUnique({ where: { id: parsed.lotId } });
        if (!lot) throw new ApiError(404, 'Lot not found', 'لوت یافت نشد', 'lot_not_found');
        materialId = lot.materialId;
        ownership = lot.ownership;
        const material = await tx.material.findUnique({ where: { id: materialId }, include: { baseUnit: true } });
        // prefer the unit of the existing stock rows for this lot/quality dimension
        const existingUnits = await tx.stockBalance.findMany({
          where: { lotId: lot.id, qualityStatus: parsed.fromQualityStatus, quantity: { gt: 0 } },
          select: { unitId: true },
          distinct: ['unitId'],
        });
        unitId = parsed.unitId ?? existingUnits[0]?.unitId ?? material!.baseUnitId;
        const unit = await tx.unitOfMeasure.findUnique({ where: { id: unitId } });
        weightKg =
          unit!.kind === 'WEIGHT'
            ? qty
            : material!.unitWeightKg
              ? qty.mul(new D(material!.unitWeightKg))
              : null;
        void unit;
      } else if (parsed.partId) {
        const part = await tx.part.findUnique({ where: { id: parsed.partId } });
        if (!part) throw new ApiError(404, 'Part not found', 'قطعه یافت نشد', 'part_not_found');
        partId = part.id;
        unitId = part.baseUnitId;
        weightKg = part.standardWeightKg ? qty.mul(new D(part.standardWeightKg)) : null;
      } else if (parsed.materialId) {
        const material = await tx.material.findUnique({ where: { id: parsed.materialId }, include: { baseUnit: true } });
        if (!material) throw new ApiError(404, 'Material not found', 'ماده اولیه یافت نشد', 'material_not_found');
        materialId = material.id;
        unitId = material.baseUnitId;
        weightKg =
          material.baseUnit.kind === 'WEIGHT' ? qty : material.unitWeightKg ? qty.mul(new D(material.unitWeightKg)) : null;
      } else {
        throw new ApiError(422, 'lotId, partId or materialId is required', 'یکی از شناسه‌های قلم الزامی است', 'item_required');
      }

      const documentNumber = await generateDocumentNumber(tx, 'INV');
      const doc = await tx.inventoryDocument.create({
        data: {
          documentNumber,
          documentType: 'ADJUSTMENT',
          status: 'DRAFT',
          postingStatus: 'UNPOSTED',
          documentDate: new Date(),
          warehouseId: parsed.warehouseId,
          description: `آزادسازی کیفیت از ${parsed.fromQualityStatus} به تأییدشده`,
          reasonCode: 'QUALITY_RELEASE',
          reasonText: parsed.notes ?? null,
          createdById: userId,
        },
      });

      // resolve the location/unit from the existing quarantined stock rows when
      // the caller did not specify them (release wherever the stock actually sits)
      const existingRows = await tx.stockBalance.findMany({
        where: {
          warehouseId: parsed.warehouseId,
          qualityStatus: parsed.fromQualityStatus,
          quantity: { gt: 0 },
          ...(parsed.lotId ? { lotId: parsed.lotId } : {}),
          ...(partId ? { partId } : {}),
          ...(materialId ? { materialId } : {}),
        },
        select: { unitId: true, locationId: true },
        take: 1,
      });
      if (!parsed.unitId && parsed.lotId && existingRows[0]) {
        unitId = existingRows[0].unitId;
        const unitRow = await tx.unitOfMeasure.findUnique({ where: { id: unitId } });
        weightKg =
          unitRow!.kind === 'WEIGHT'
            ? qty
            : materialId
              ? await tx.material
                  .findUnique({ where: { id: materialId }, select: { unitWeightKg: true } })
                  .then((m) => (m?.unitWeightKg ? qty.mul(new D(m.unitWeightKg)) : null))
              : null;
      }
      const locationId = parsed.locationId ?? existingRows[0]?.locationId ?? null;

      const occurredAt = new Date();
      const dims = {
        partId,
        materialId,
        warehouseId: parsed.warehouseId,
        locationId,
        lotId: parsed.lotId ?? null,
        ownership,
      };

      // balance movement BEFORE its own ledger row (consistent with postDocument)
      await applyStockMovement(tx, { ...dims, unitId, qualityStatus: parsed.fromQualityStatus }, qty.neg(), weightKg ? weightKg.neg() : new D(0), occurredAt);
      await createLedgerTx(tx, {
        documentId: doc.id, documentLineId: null, type: 'ADJUSTMENT_OUT',
        ...dims, qualityStatus: parsed.fromQualityStatus,
        quantity: qty, unitId, weightKg, createdById: userId,
      });

      await applyStockMovement(tx, { ...dims, unitId, qualityStatus: 'APPROVED' }, qty, weightKg ?? new D(0), occurredAt);
      await createLedgerTx(tx, {
        documentId: doc.id, documentLineId: null, type: 'ADJUSTMENT_IN',
        ...dims, qualityStatus: 'APPROVED',
        quantity: qty, unitId, weightKg, createdById: userId,
      });

      const postedDoc = await tx.inventoryDocument.update({
        where: { id: doc.id },
        data: { status: 'CONFIRMED', postingStatus: 'POSTED', postedById: userId, postedAt: new Date() },
      });

      await recordAudit(tx, {
        userId,
        action: 'POST',
        entityType: 'InventoryDocument',
        entityId: doc.id,
        changes: { action: 'QUALITY_RELEASE', quantity: parsed.quantity, fromQualityStatus: parsed.fromQualityStatus },
        ipAddress: meta.ip,
        userAgent: meta.ua,
      });

      return postedDoc;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20_000 },
  );
}

// ---------------------------------------------------------------------------
// dashboard
// ---------------------------------------------------------------------------

export async function getInventoryDashboard() {
  const [docCounts, txToday, itemsInStock, consignmentAgg, ownedAgg, reservedCount, recentTxs, blockedRows] =
    await Promise.all([
      db.inventoryDocument.groupBy({ by: ['documentType', 'postingStatus'], _count: true }),
      db.inventoryTransaction.count({ where: { occurredAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } } }),
      db.stockBalance.count({ where: { quantity: { gt: 0 } } }),
      db.stockBalance.aggregate({
        where: { ownership: 'SUPPLIER_CONSIGNMENT' },
        _sum: { weightKg: true },
      }),
      db.stockBalance.aggregate({ where: { ownership: 'OWNED' }, _sum: { weightKg: true } }),
      db.inventoryReservation.count({ where: { status: 'ACTIVE' } }),
      db.inventoryTransaction.findMany({
        orderBy: { occurredAt: 'desc' },
        take: 10,
        include: {
          part: { select: { partNumber: true, nameFa: true } },
          material: { select: { materialCode: true, nameFa: true } },
          warehouse: { select: { code: true, nameFa: true } },
          document: { select: { documentNumber: true } },
        },
      }),
      db.stockBalance.count({ where: { qualityStatus: { not: 'APPROVED' }, quantity: { gt: 0 } } }),
    ]);

  const draftDocs = docCounts.filter((d) => d.postingStatus === 'UNPOSTED').reduce((a, d) => a + d._count, 0);
  const postedDocs = docCounts.filter((d) => d.postingStatus === 'POSTED').reduce((a, d) => a + d._count, 0);

  const byType: Record<string, number> = {};
  for (const d of docCounts) {
    byType[d.documentType] = (byType[d.documentType] ?? 0) + d._count;
  }

  return {
    documents: { draft: draftDocs, posted: postedDocs, byType },
    transactionsToday: txToday,
    itemsInStock,
    stockKg: {
      owned: ownedAgg._sum.weightKg ? new D(ownedAgg._sum.weightKg).toFixed(2) : '0.00',
      supplierConsignment: consignmentAgg._sum.weightKg ? new D(consignmentAgg._sum.weightKg).toFixed(2) : '0.00',
    },
    qualityBlockedRows: blockedRows,
    activeReservations: reservedCount,
    recentTransactions: recentTxs,
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Phase 7 — roll/coil (lot) summary & consumption traceability
// The scenario: coils received (optionally against a contract) sit in the
// warehouse; each issue consumes part of a roll and the remainder stays as a
// "partial" roll; every consumption is traceable back to its document and
// purpose. All figures come from real ledger records — nothing derived twice.
// ---------------------------------------------------------------------------

export interface LotSummaryFilters {
  materialId?: string;
  warehouseId?: string;
  lotNumber?: string;
  q?: string;
  status?: string;
}

/** Roll inventory answer: how many rolls, how many partial, how many consumed. */
export async function getLotSummaries(filters: LotSummaryFilters) {
  const aggregates = await loadLotAggregates(filters, 500);
  const rows = aggregates
    .filter((l) => (filters.status ? l.derivedStatus === filters.status : true))
    .map((l) => {
      const received = l.weightReceivedKg;
      const remaining = l.weightRemainingKg;
      const consumed = received.minus(remaining);
      return {
        id: l.id,
        lotNumber: l.lotNumber,
        supplierLotNumber: l.supplierLotNumber,
        certificateNumber: l.certificateNumber,
        receiptDate: l.receiptDate,
        ownership: l.ownership,
        status: l.status,
        derivedStatus: l.derivedStatus,
        derivedStatusFa: LOT_STATUS_FA[l.derivedStatus],
        material: { id: l.materialId, code: l.materialCode, nameFa: l.materialNameFa, unit: l.unitCode },
        weightReceivedKg: received.toFixed(3),
        weightRemainingKg: remaining.toFixed(3),
        consumedKg: consumed.toFixed(3),
        consumedPct:
          received.comparedTo(0) > 0
            ? Number(consumed.div(received).mul(100).toFixed(1))
            : 0,
        quantityReceived: l.quantityReceived.toFixed(4),
        quantityRemaining: l.quantityRemaining.toFixed(4),
        contractNumbers: l.contractNumbers,
        locations: l.locations,
      };
    });

  const count = (s: string) => rows.filter((r) => r.derivedStatus === s).length;
  const summary = {
    total: rows.length,
    full: count('FULL'),
    partial: count('PARTIAL'),
    consumed: count('CONSUMED'),
    blocked: count('BLOCKED'),
    totalReceivedKg: rows.reduce((a, r) => a.plus(r.weightReceivedKg), new D(0)).toFixed(3),
    totalRemainingKg: rows.reduce((a, r) => a.plus(r.weightRemainingKg), new D(0)).toFixed(3),
    generatedAt: new Date().toISOString(),
  };
  return { lots: rows, summary };
}

/** Full traceability of one roll: receipt, every issue (with purpose), reversals. */
export async function getLotTrace(lotId: string) {
  const lot = await db.materialLot.findUnique({
    where: { id: lotId },
    include: { material: { select: { materialCode: true, nameFa: true, baseUnit: { select: { code: true } } } } },
  });
  if (!lot) throw new ApiError(404, 'Lot not found', 'لوت یافت نشد', 'lot_not_found');

  const [txs, contractTxs, balances] = await Promise.all([
    db.inventoryTransaction.findMany({
      where: { lotId },
      orderBy: { occurredAt: 'asc' },
      include: {
        document: {
          select: {
            documentNumber: true,
            documentType: true,
            description: true,
            referenceType: true,
            referenceId: true,
            postingStatus: true,
            lines: { select: { notes: true } },
          },
        },
        warehouse: { select: { code: true, nameFa: true } },
        location: { select: { code: true, nameFa: true } },
      },
    }),
    db.materialContractTransaction.findMany({
      where: { lotId },
      orderBy: { receivedDate: 'asc' },
      include: { contract: { select: { contractNumber: true, supplierName: true } } },
    }),
    db.stockBalance.findMany({
      where: { lotId },
      include: {
        warehouse: { select: { code: true, nameFa: true } },
        location: { select: { code: true, nameFa: true } },
        unit: { select: { code: true } },
      },
    }),
  ]);

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
  const moById = new Map(mos.map((m) => [m.id, m.moNumber]));

  const movements = txs.map((t) => ({
    transactionNumber: t.transactionNumber,
    type: t.type,
    direction: TX_SIGN[t.type] === 1 ? 'IN' : 'OUT',
    quantity: new D(t.quantity).toFixed(4),
    weightKg: t.weightKg != null ? new D(t.weightKg).toFixed(3) : null,
    occurredAt: t.occurredAt,
    warehouse: { code: t.warehouse.code, nameFa: t.warehouse.nameFa },
    location: t.location ? { code: t.location.code, nameFa: t.location.nameFa } : null,
    reversalOfTransaction: t.reversalOfId,
    document: t.document
      ? {
          number: t.document.documentNumber,
          type: t.document.documentType,
          postingStatus: t.document.postingStatus,
          referenceType: t.document.referenceType,
          referenceLabel:
            t.document.referenceType === 'MANUFACTURING_ORDER' && t.document.referenceId
              ? (moById.get(t.document.referenceId) ?? 'دستور کار')
              : t.document.referenceType,
          purpose:
            t.document.lines.map((l) => l.notes).find((n) => n && n.trim() !== '')?.trim() ||
            t.document.description?.trim() ||
            null,
        }
      : null,
  }));

  const derived = deriveLotStatus(lot);
  const received = new D(lot.weightReceivedKg);
  const remaining = new D(lot.weightRemainingKg);
  const consumed = received.minus(remaining);
  const issueCount = txs.filter((t) => t.type === 'ISSUE').length;

  return {
    lot: {
      id: lot.id,
      lotNumber: lot.lotNumber,
      supplierLotNumber: lot.supplierLotNumber,
      certificateNumber: lot.certificateNumber,
      receiptDate: lot.receiptDate,
      ownership: lot.ownership,
      status: lot.status,
      derivedStatus: derived,
      derivedStatusFa: LOT_STATUS_FA[derived],
      material: { id: lot.materialId, code: lot.material.materialCode, nameFa: lot.material.nameFa, unit: lot.material.baseUnit.code },
      weightReceivedKg: received.toFixed(3),
      weightRemainingKg: remaining.toFixed(3),
      consumedKg: consumed.toFixed(3),
      consumedPct: received.comparedTo(0) > 0 ? Number(consumed.div(received).mul(100).toFixed(1)) : 0,
    },
    contractReceipts: contractTxs.map((t) => ({
      contractNumber: t.contract.contractNumber,
      supplierName: t.contract.supplierName,
      receivedDate: t.receivedDate,
      quantity: new D(t.quantity).toFixed(4),
      weightKg: t.weightKg != null ? new D(t.weightKg).toFixed(3) : null,
    })),
    balances: balances.map((b) => ({
      warehouse: { code: b.warehouse.code, nameFa: b.warehouse.nameFa },
      location: b.location ? { code: b.location.code, nameFa: b.location.nameFa } : null,
      unit: b.unit.code,
      quantity: new D(b.quantity).toFixed(4),
      weightKg: new D(b.weightKg).toFixed(3),
      qualityStatus: b.qualityStatus,
      ownership: b.ownership,
    })),
    movements,
    summary: {
      issueCount,
      movementCount: movements.length,
      lastActivityAt: txs.length > 0 ? (txs[txs.length - 1]?.occurredAt ?? null) : null,
      generatedAt: new Date().toISOString(),
    },
  };
}

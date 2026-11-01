import { describe, it, expect, beforeAll } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  createDocument,
  postDocument,
  reverseDocument,
  cancelDocument,
  createReservation,
  releaseReservation,
  listReservations,
  getBalances,
  getSapcoAccount,
  releaseQuality,
} from '../src/modules/inventory/inventory.service';
import { db, buildFixtures, ledgerSum, balanceOf, uniqueCode, type Fixtures } from './helpers';

const D = Prisma.Decimal;

describe('inventory module', () => {
  let f: Fixtures;
  let openingLotNumber: string;
  let consignmentLotNumber: string;

  beforeAll(async () => {
    f = await buildFixtures();
    openingLotNumber = uniqueCode('LOT');
    consignmentLotNumber = uniqueCode('LOT');
  });

  it('opening balance (adjustment with reason OPENING_BALANCE) seeds official stock', async () => {
    const doc = await createDocument(
      {
        documentType: 'ADJUSTMENT',
        documentDate: f.today,
        warehouseId: f.warehouseId,
        reasonCode: 'OPENING_BALANCE',
        description: 'موجودی افتتاحیه',
        lines: [{ materialId: f.materialId, lotNumber: openingLotNumber, quantity: 500, locationId: f.locationAId }],
      },
      f.adminId,
      {},
    );
    const posted = await postDocument(doc.id, f.adminId, {});
    expect(posted?.postingStatus).toBe('POSTED');

    const lot = await db.materialLot.findUniqueOrThrow({
      where: { materialId_lotNumber: { materialId: f.materialId, lotNumber: openingLotNumber } },
    });
    const bal = await balanceOf({ materialId: f.materialId, warehouseId: f.warehouseId, locationId: f.locationAId, lotId: lot.id });
    expect(bal).not.toBeNull();
    expect(new D(bal!.quantity).toFixed(1)).toBe('500.0');
    expect(new D(bal!.weightKg).toFixed(1)).toBe('500.0'); // KG base unit → qty == kg
    expect(bal!.unitCode ?? '').toBe('');
    const unit = await db.unitOfMeasure.findUniqueOrThrow({ where: { id: bal!.unitId } });
    expect(unit.code).toBe('KG');
  });

  it('draft documents never affect official stock (rule 2)', async () => {
    const before = await ledgerSum({ materialId: f.materialId, warehouseId: f.warehouseId });
    const draft = await createDocument(
      {
        documentType: 'RECEIPT',
        documentDate: f.today,
        warehouseId: f.warehouseId,
        lines: [{ materialId: f.materialId, lotNumber: uniqueCode('LOT'), quantity: 999, toLocationId: f.locationAId }],
      },
      f.adminId,
      {},
    );
    expect(draft.postingStatus).toBe('UNPOSTED');
    expect(draft.status).toBe('DRAFT');
    const after = await ledgerSum({ materialId: f.materialId, warehouseId: f.warehouseId });
    expect(after.quantity).toBe(before.quantity);
    expect(after.weightKg).toBeCloseTo(before.weightKg, 6);
    await cancelDocument(draft.id, f.adminId, {});
    const cancelled = await db.inventoryDocument.findUniqueOrThrow({ where: { id: draft.id } });
    expect(cancelled.status).toBe('CANCELLED');
  });

  it('material receipt with lot + SAPCO contract: sheets unit, consignment ownership, contract ledger', async () => {
    const doc = await createDocument(
      {
        documentType: 'RECEIPT',
        documentDate: f.today,
        warehouseId: f.warehouseId,
        description: 'رسید ورق SAPCO',
        lines: [
          {
            materialId: f.materialId,
            lotNumber: consignmentLotNumber,
            quantity: 100, // sheets
            unitId: f.unitSheetId,
            toLocationId: f.locationAId,
            contractId: f.contractId,
            qualityStatus: 'PENDING', // QC quarantine on arrival
          },
        ],
      },
      f.adminId,
      {},
    );
    await postDocument(doc.id, f.adminId, {});

    const lot = await db.materialLot.findUniqueOrThrow({
      where: { materialId_lotNumber: { materialId: f.materialId, lotNumber: consignmentLotNumber } },
    });
    // 100 sheets × 12.56 kg = 1256 kg
    expect(new D(lot.quantityReceived).toFixed(1)).toBe('100.0');
    expect(new D(lot.weightReceivedKg).toFixed(2)).toBe('1256.00');
    expect(lot.ownership).toBe('SUPPLIER_CONSIGNMENT');

    const bal = await balanceOf({ materialId: f.materialId, warehouseId: f.warehouseId, locationId: f.locationAId, lotId: lot.id, qualityStatus: 'PENDING' });
    expect(new D(bal!.quantity).toFixed(1)).toBe('100.0');
    expect(new D(bal!.weightKg).toFixed(2)).toBe('1256.00');
    expect(bal!.ownership).toBe('SUPPLIER_CONSIGNMENT');
    expect(bal!.qualityStatus).toBe('PENDING');

    const contractTxs = await db.materialContractTransaction.findMany({ where: { contractId: f.contractId } });
    expect(contractTxs).toHaveLength(1);
    expect(new D(contractTxs[0]!.quantity).toFixed(1)).toBe('100.0');

    const contract = await db.materialContract.findUniqueOrThrow({ where: { id: f.contractId } });
    expect(contract.status).toBe('PARTIALLY_RECEIVED');
  });

  it('duplicate posting is rejected (rule 4) and ledger stays intact', async () => {
    const doc = await createDocument(
      {
        documentType: 'RECEIPT',
        documentDate: f.today,
        warehouseId: f.warehouseId,
        lines: [{ partId: f.partId, quantity: 10, toLocationId: f.locationAId }],
      },
      f.adminId,
      {},
    );
    await postDocument(doc.id, f.adminId, {});
    const txCountBefore = await db.inventoryTransaction.count({ where: { documentId: doc.id } });

    await expect(postDocument(doc.id, f.adminId, {})).rejects.toMatchObject({ code: 'duplicate_posting' });

    const txCountAfter = await db.inventoryTransaction.count({ where: { documentId: doc.id } });
    expect(txCountAfter).toBe(txCountBefore);

    const bal = await balanceOf({ partId: f.partId, warehouseId: f.warehouseId, locationId: f.locationAId });
    expect(new D(bal!.quantity).toFixed(1)).toBe('10.0'); // posted exactly once
  });

  it('issue decreases stock and lot remaining; supports kilogram and piece units (rule 6)', async () => {
    const openingLot = await db.materialLot.findUniqueOrThrow({
      where: { materialId_lotNumber: { materialId: f.materialId, lotNumber: openingLotNumber } },
    });
    const docKg = await createDocument(
      {
        documentType: 'ISSUE',
        documentDate: f.today,
        warehouseId: f.warehouseId,
        description: 'حواله ۳۰ کیلوگرم ورق',
        lines: [{ materialId: f.materialId, lotId: openingLot.id, quantity: 30, fromLocationId: f.locationAId }],
      },
      f.adminId,
      {},
    );
    await postDocument(docKg.id, f.adminId, {});
    const balKg = await balanceOf({ materialId: f.materialId, warehouseId: f.warehouseId, locationId: f.locationAId, lotId: openingLot.id });
    expect(new D(balKg!.weightKg).toFixed(2)).toBe('470.00');
    const lotAfter = await db.materialLot.findUniqueOrThrow({ where: { id: openingLot.id } });
    expect(new D(lotAfter.weightRemainingKg).toFixed(2)).toBe('470.00');

    // part: issue 4 pcs (weight = 4 × 2 kg)
    const docPcs = await createDocument(
      {
        documentType: 'ISSUE',
        documentDate: f.today,
        warehouseId: f.warehouseId,
        lines: [{ partId: f.partId, quantity: 4, fromLocationId: f.locationAId }],
      },
      f.adminId,
      {},
    );
    await postDocument(docPcs.id, f.adminId, {});
    const balPcs = await balanceOf({ partId: f.partId, warehouseId: f.warehouseId, locationId: f.locationAId });
    expect(new D(balPcs!.quantity).toFixed(1)).toBe('6.0');
    expect(new D(balPcs!.weightKg).toFixed(1)).toBe('12.0');
  });

  it('issuing the FULL available quantity is allowed (exact depletion)', async () => {
    // fresh part stock: 15 pcs at locB
    const doc1 = await createDocument(
      {
        documentType: 'RECEIPT',
        documentDate: f.today,
        warehouseId: f.warehouseId,
        lines: [{ partId: f.partId, quantity: 15, toLocationId: f.locationBId }],
      },
      f.adminId,
      {},
    );
    await postDocument(doc1.id, f.adminId, {});

    // issue all 15 — must succeed (guard must not see its own ledger row)
    const doc2 = await createDocument(
      {
        documentType: 'ISSUE',
        documentDate: f.today,
        warehouseId: f.warehouseId,
        lines: [{ partId: f.partId, quantity: 15, fromLocationId: f.locationBId }],
      },
      f.adminId,
      {},
    );
    const posted = await postDocument(doc2.id, f.adminId, {});
    expect(posted?.postingStatus).toBe('POSTED');
    const bal = await balanceOf({ partId: f.partId, warehouseId: f.warehouseId, locationId: f.locationBId });
    expect(new D(bal!.quantity).toFixed(1)).toBe('0.0');
  });

  it('unauthorised negative stock is prevented (rule 5) and failed postings roll back', async () => {
    const before = await ledgerSum({ partId: f.partId, warehouseId: f.warehouseId });
    const doc = await createDocument(
      {
        documentType: 'ISSUE',
        documentDate: f.today,
        warehouseId: f.warehouseId,
        lines: [{ partId: f.partId, quantity: 1000, fromLocationId: f.locationAId }],
      },
      f.adminId,
      {},
    );
    await expect(postDocument(doc.id, f.adminId, {})).rejects.toMatchObject({ code: 'negative_stock' });

    const after = await ledgerSum({ partId: f.partId, warehouseId: f.warehouseId });
    expect(after.quantity).toBe(before.quantity);
    const docAfter = await db.inventoryDocument.findUniqueOrThrow({ where: { id: doc.id } });
    expect(docAfter.postingStatus).toBe('UNPOSTED');
    const txRows = await db.inventoryTransaction.count({ where: { documentId: doc.id } });
    expect(txRows).toBe(0);
  });

  it('quality-blocked (PENDING) stock cannot be issued before QC release', async () => {
    const consignmentLot = await db.materialLot.findUniqueOrThrow({
      where: { materialId_lotNumber: { materialId: f.materialId, lotNumber: consignmentLotNumber } },
    });
    const doc = await createDocument(
      {
        documentType: 'ISSUE',
        documentDate: f.today,
        warehouseId: f.warehouseId,
        lines: [{ materialId: f.materialId, lotId: consignmentLot.id, quantity: 10, fromLocationId: f.locationAId }],
      },
      f.adminId,
      {},
    );
    // issues draw from the APPROVED dimension; the consignment lot is still PENDING
    await expect(postDocument(doc.id, f.adminId, {})).rejects.toMatchObject({ code: 'negative_stock' });
  });

  it('transfers move stock atomically between locations and warehouses', async () => {
    const doc = await createDocument(
      {
        documentType: 'TRANSFER',
        documentDate: f.today,
        warehouseId: f.warehouseId,
        lines: [{ partId: f.partId, quantity: 3, fromLocationId: f.locationAId, toLocationId: f.whOtherLocId }],
      },
      f.adminId,
      {},
    );
    await postDocument(doc.id, f.adminId, {});

    const outTx = await db.inventoryTransaction.findFirstOrThrow({ where: { documentId: doc.id, type: 'TRANSFER_OUT' } });
    const inTx = await db.inventoryTransaction.findFirstOrThrow({ where: { documentId: doc.id, type: 'TRANSFER_IN' } });
    expect(outTx.warehouseId).toBe(f.warehouseId);
    expect(inTx.warehouseId).toBe(f.whOtherId);

    const src = await balanceOf({ partId: f.partId, warehouseId: f.warehouseId, locationId: f.locationAId });
    const dst = await balanceOf({ partId: f.partId, warehouseId: f.whOtherId, locationId: f.whOtherLocId });
    expect(new D(src!.quantity).toFixed(1)).toBe('3.0');
    expect(new D(dst!.quantity).toFixed(1)).toBe('3.0');
  });

  it('every adjustment requires a reason; decrease adjustments work with audit records (rule 9)', async () => {
    await expect(
      createDocument(
        {
          documentType: 'ADJUSTMENT',
          documentDate: f.today,
          warehouseId: f.warehouseId,
          lines: [{ partId: f.partId, quantity: 5, locationId: f.locationAId }],
        },
        f.adminId,
        {},
      ),
    ).rejects.toThrow(/reasonCode is required/);

    const doc = await createDocument(
      {
        documentType: 'ADJUSTMENT',
        documentDate: f.today,
        warehouseId: f.warehouseId,
        reasonCode: 'COUNT_CORRECTION',
        reasonText: 'کسری انبارشویی',
        lines: [{ partId: f.partId, quantity: -1, locationId: f.locationAId }],
      },
      f.adminId,
      {},
    );
    await postDocument(doc.id, f.adminId, {});
    const outTx = await db.inventoryTransaction.findFirstOrThrow({ where: { documentId: doc.id, type: 'ADJUSTMENT_OUT' } });
    expect(new D(outTx.quantity).toFixed(1)).toBe('1.0');
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityType: 'InventoryDocument', entityId: doc.id, action: 'POST' } });
    expect(audit.changes).toBeTruthy();
  });

  it('corrections use reversal documents and restore balances (rule 10)', async () => {
    const doc = await createDocument(
      {
        documentType: 'RECEIPT',
        documentDate: f.today,
        warehouseId: f.warehouseId,
        lines: [{ partId: f.partId, quantity: 20, toLocationId: f.locationBId }],
      },
      f.adminId,
      {},
    );
    await postDocument(doc.id, f.adminId, {});
    const before = await ledgerSum({ partId: f.partId, warehouseId: f.warehouseId, locationId: f.locationBId });
    expect(before.quantity).toBeCloseTo(20, 6);

    const reversal = await reverseDocument(doc.id, f.adminId, 'خطای ثبت رسید', {});
    expect(reversal.postingStatus).toBe('POSTED');
    const original = await db.inventoryDocument.findUniqueOrThrow({ where: { id: doc.id } });
    expect(original.postingStatus).toBe('REVERSED');
    expect(reversal.reversalOfId).toBe(doc.id);

    const after = await ledgerSum({ partId: f.partId, warehouseId: f.warehouseId, locationId: f.locationBId });
    expect(after.quantity).toBeCloseTo(0, 6);
    const bal = await balanceOf({ partId: f.partId, warehouseId: f.warehouseId, locationId: f.locationBId });
    expect(new D(bal!.quantity).toFixed(1)).toBe('0.0');

    // double reversal is blocked
    await expect(reverseDocument(doc.id, f.adminId, 'دوباره', {})).rejects.toMatchObject({ code: 'already_reversed' });
  });

  it('reservations reduce available stock and are consumed by issues (rule 8)', async () => {
    // extra stock first
    const topUp = await createDocument(
      {
        documentType: 'RECEIPT',
        documentDate: f.today,
        warehouseId: f.warehouseId,
        lines: [{ partId: f.partId, quantity: 20, toLocationId: f.locationAId }],
      },
      f.adminId,
      {},
    );
    await postDocument(topUp.id, f.adminId, {});

    const reservation = await createReservation(
      { partId: f.partId, warehouseId: f.warehouseId, quantity: 5 },
      f.adminId,
    );
    expect(reservation.status).toBe('ACTIVE');

    const rows = await getBalances({ partId: f.partId, warehouseId: f.warehouseId });
    const approved = rows.filter((r) => r.qualityStatus === 'APPROVED');
    const totalQty = approved.reduce((a, r) => a.plus(new D(r.quantity)), new D(0));
    const { getReservedSummary } = await import('../src/modules/inventory/inventory.service');
    const reservedSummary = await getReservedSummary();
    const totalReserved = reservedSummary
      .filter((r) => r.partId === f.partId && r.warehouseId === f.warehouseId)
      .reduce((a, r) => a.plus(new D(r.quantity)), new D(0));
    expect(totalQty.comparedTo(0)).toBeGreaterThan(0);
    expect(totalReserved.toFixed(1)).toBe('5.0');
    const available = totalQty.minus(totalReserved);
    expect(available.comparedTo(totalQty)).toBeLessThan(0);

    const doc = await createDocument(
      {
        documentType: 'ISSUE',
        documentDate: f.today,
        warehouseId: f.warehouseId,
        lines: [{ partId: f.partId, quantity: 5, fromLocationId: f.locationAId, reservationId: reservation.id }],
      },
      f.adminId,
      {},
    );
    await postDocument(doc.id, f.adminId, {});
    const consumed = await db.inventoryReservation.findUniqueOrThrow({ where: { id: reservation.id } });
    expect(consumed.status).toBe('CONSUMED');
    expect(new D(consumed.quantity).toFixed(1)).toBe('0.0');

    await expect(releaseReservation(reservation.id, f.adminId)).rejects.toMatchObject({ code: 'reservation_not_active' });

    const r2 = await createReservation({ partId: f.partId, warehouseId: f.warehouseId, quantity: 2 }, f.adminId);
    await releaseReservation(r2.id, f.adminId);
    const list = await listReservations('RELEASED');
    expect(list.some((r) => r.id === r2.id)).toBe(true);
  });

  it('quality release moves stock between quality dimensions (net zero, per unit)', async () => {
    const consignmentLot = await db.materialLot.findUniqueOrThrow({
      where: { materialId_lotNumber: { materialId: f.materialId, lotNumber: consignmentLotNumber } },
    });

    const relDoc = await releaseQuality(
      {
        lotId: consignmentLot.id,
        warehouseId: f.warehouseId,
        locationId: f.locationAId,
        fromQualityStatus: 'PENDING',
        quantity: 50, // sheets (unit resolved from existing stock rows)
        notes: 'تأیید کنترل کیفیت',
      },
      f.adminId,
      {},
    );
    expect(relDoc.postingStatus).toBe('POSTED');

    const pendingBal = await db.stockBalance.findFirst({
      where: { materialId: f.materialId, lotId: consignmentLot.id, qualityStatus: 'PENDING' },
    });
    const approvedBal = await db.stockBalance.findFirst({
      where: { materialId: f.materialId, lotId: consignmentLot.id, qualityStatus: 'APPROVED' },
    });
    expect(new D(pendingBal!.quantity).toFixed(1)).toBe('50.0');
    expect(new D(approvedBal!.quantity).toFixed(1)).toBe('50.0');

    // now an issue from the released (APPROVED) bucket succeeds — 20 sheets
    const doc = await createDocument(
      {
        documentType: 'ISSUE',
        documentDate: f.today,
        warehouseId: f.warehouseId,
        lines: [{ materialId: f.materialId, lotId: consignmentLot.id, quantity: 20, unitId: f.unitSheetId, fromLocationId: f.locationAId }],
      },
      f.adminId,
      {},
    );
    await postDocument(doc.id, f.adminId, {});
    const approvedAfter = await db.stockBalance.findFirstOrThrow({
      where: { materialId: f.materialId, lotId: consignmentLot.id, qualityStatus: 'APPROVED' },
    });
    expect(new D(approvedAfter.quantity).toFixed(1)).toBe('30.0');
    // 20 sheets × 12.56 = 251.2 kg issued
    expect(new D(approvedAfter.weightKg).toFixed(2)).toBe('376.80');

    // overall ledger per quality dimension stays conserved
    const rows = await db.inventoryTransaction.findMany({ where: { materialId: f.materialId, lotId: consignmentLot.id } });
    const sign: Record<string, 1 | -1> = {
      RECEIPT: 1, TRANSFER_IN: 1, ADJUSTMENT_IN: 1, ISSUE: -1, TRANSFER_OUT: -1, ADJUSTMENT_OUT: -1,
    };
    const sumByQuality = (q: string) =>
      rows.filter((t) => t.qualityStatus === q).reduce((a, t) => a + sign[t.type] * Number(t.quantity), 0);
    expect(sumByQuality('PENDING')).toBeCloseTo(50, 6);
    expect(sumByQuality('APPROVED')).toBeCloseTo(30, 6);
  });

  it('SAPCO account report computes opening/receipts/consumption/closing in kg', async () => {
    const account = await getSapcoAccount({ materialId: f.materialId });
    expect(account).toHaveLength(1);
    const row = account[0]!;

    const opening = new D(row.openingKg);
    const received = new D(row.receivedKg);
    const consumed = new D(row.consumedKg);
    const closing = new D(row.closingKg);

    expect(closing.toFixed(2)).toBe(opening.plus(received).minus(consumed).toFixed(2));
    expect(received.comparedTo(0)).toBeGreaterThan(0);
    expect(consumed.comparedTo(0)).toBeGreaterThan(0);

    // ledger cross-check: signed kg sum of all material transactions == closing
    const allTx = await db.inventoryTransaction.findMany({ where: { materialId: f.materialId } });
    const sign: Record<string, 1 | -1> = {
      RECEIPT: 1, TRANSFER_IN: 1, ADJUSTMENT_IN: 1,
      ISSUE: -1, TRANSFER_OUT: -1, ADJUSTMENT_OUT: -1,
    };
    const signedKg = allTx.reduce((acc, t) => acc.plus(new D(t.weightKg ?? 0).mul(sign[t.type])), new D(0));
    expect(signedKg.toFixed(2)).toBe(closing.toFixed(2));

    // ownership split fields exist; consignment receipts were tracked
    expect(Number(row.consignmentReceivedKg)).toBeGreaterThan(0);

    // contract movement ledger has entries linked to documents
    expect(row.contractMovements.length).toBeGreaterThan(0);
    expect(row.contractMovements[0]!.contractNumber).toBeTruthy();
  });
});

/**
 * KPIMS — Phase 7: the user's real roll/coil scenario, end to end on the real
 * posting engine:
 *
 *   1. three rolls arrive — no contract exists yet → the contract is created
 *   2. receipt of 3 rolls against that contract (SAPCO consignment ownership)
 *   3. one roll leaves for TWO PIECES on the line — only the consumed weight
 *      is issued, the remainder stays as a PARTIAL roll
 *   4. roll inventory answers: how many rolls / how many partial / how much left
 *   5. traceability: this roll was consumed for what purpose, when, with which document
 *   6. the rest of the roll is consumed → roll becomes CONSUMED (closed)
 *   7. a mistake is corrected through a reversal document (گovernance rule)
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  createDocument,
  postDocument,
  reverseDocument,
  createContract,
  getLotSummaries,
  getLotTrace,
} from '../src/modules/inventory/inventory.service';
import { createManufacturingOrder } from '../src/modules/production/production.service';
import { coilInventory, lotConsumption } from '../src/modules/reports/reports.service';
import { db, buildFixtures, uniqueCode, type Fixtures } from './helpers';

const D = Prisma.Decimal;
const ROLL_KG = 2000;

describe('roll/coil scenario — contract → receipt 3 rolls → partial consumption → traceability', () => {
  let f: Fixtures;
  let contractId: string;
  let rollA: string; // stays untouched (FULL)
  let rollB: string; // partially consumed → PARTIAL → CONSUMED → partially restored by reversal
  let rollC: string; // stays untouched (FULL)
  let issueDocId: string;
  let moId: string;

  beforeAll(async () => {
    f = await buildFixtures();
    rollA = uniqueCode('R');
    rollB = uniqueCode('R');
    rollC = uniqueCode('R');
  });

  it('step 1 — rolls arrive with no contract: user creates the contract first', async () => {
    const contract = await createContract(
      {
        contractNumber: uniqueCode('CT'),
        supplierName: 'SAPCO',
        materialId: f.materialId,
        orderDate: f.today,
        totalQuantity: 12000,
        totalWeightKg: 12000,
        description: 'قرارداد ورق ۰٫۸ میلی‌متر — ۳ رول ۲۰۰۰ کیلوگرمی',
      },
      f.adminId,
    );
    contractId = contract.id;
    expect(contract.status).toBe('OPEN');
  });

  it('step 2 — receipt of 3 rolls against the contract → 3 OPEN consignment lots', async () => {
    const doc = await createDocument(
      {
        documentType: 'RECEIPT',
        documentDate: f.today,
        warehouseId: f.warehouseId,
        description: 'رسید ۳ رول ورق ۰٫۸',
        lines: [rollA, rollB, rollC].map((lotNumber) => ({
          materialId: f.materialId,
          lotNumber,
          quantity: ROLL_KG,
          weightKg: ROLL_KG,
          contractId,
          toLocationId: f.locationAId,
          ownership: 'SUPPLIER_CONSIGNMENT' as const,
        })),
      },
      f.adminId,
      {},
    );
    const posted = await postDocument(doc.id, f.adminId, {});
    expect(posted?.postingStatus).toBe('POSTED');

    const lots = await db.materialLot.findMany({ where: { materialId: f.materialId } });
    expect(lots).toHaveLength(3);
    for (const lot of lots) {
      expect(lot.status).toBe('OPEN');
      expect(new D(lot.weightReceivedKg).toFixed(1)).toBe('2000.0');
      expect(new D(lot.weightRemainingKg).toFixed(1)).toBe('2000.0');
      expect(lot.ownership).toBe('SUPPLIER_CONSIGNMENT');
    }

    const contractTxs = await db.materialContractTransaction.findMany({ where: { contractId } });
    expect(contractTxs).toHaveLength(3);
    const totalKg = contractTxs.reduce((a, t) => a.plus(new D(t.weightKg ?? 0)), new D(0));
    expect(totalKg.toFixed(1)).toBe('6000.0');

    const contract = await db.materialContract.findUniqueOrThrow({ where: { id: contractId } });
    expect(contract.status).toBe('PARTIALLY_RECEIVED');
  });

  it('step 3 — one roll goes out for 2 pieces: only the consumed weight is issued, the remainder stays', async () => {
    const mo = await createManufacturingOrder({ partId: f.partId, quantity: 2 }, f.adminId, {});
    moId = mo.id;

    const lotB = await db.materialLot.findUniqueOrThrow({
      where: { materialId_lotNumber: { materialId: f.materialId, lotNumber: rollB } },
    });

    const doc = await createDocument(
      {
        documentType: 'ISSUE',
        documentDate: f.today,
        warehouseId: f.warehouseId,
        description: 'خروج رول برای ساخت ۲ قطعه',
        referenceType: 'MANUFACTURING_ORDER',
        referenceId: mo.id,
        lines: [
          {
            materialId: f.materialId,
            lotId: lotB.id,
            quantity: 80,
            weightKg: 80,
            fromLocationId: f.locationAId,
            notes: 'مصرف برای ۲ قطعه در خط تولید',
          },
        ],
      },
      f.adminId,
      {},
    );
    issueDocId = doc.id;
    const posted = await postDocument(doc.id, f.adminId, {});
    expect(posted?.postingStatus).toBe('POSTED');

    const after = await db.materialLot.findUniqueOrThrow({ where: { id: lotB.id } });
    expect(new D(after.weightRemainingKg).toFixed(1)).toBe('1920.0');
    expect(after.status).toBe('OPEN'); // the roll itself stays open as a partial roll
  });

  it('step 4 — roll inventory answers: 3 rolls, 2 full, 1 partial, remaining 5920 kg', async () => {
    const { lots, summary } = await getLotSummaries({ materialId: f.materialId });
    expect(summary.total).toBe(3);
    expect(summary.full).toBe(2);
    expect(summary.partial).toBe(1);
    expect(summary.consumed).toBe(0);
    expect(new D(summary.totalReceivedKg).toFixed(1)).toBe('6000.0');
    expect(new D(summary.totalRemainingKg).toFixed(1)).toBe('5920.0');

    const partial = lots.find((l) => l.lotNumber === rollB);
    expect(partial).toBeDefined();
    expect(partial!.derivedStatus).toBe('PARTIAL');
    expect(partial!.consumedKg).toBe('80.000');
  });

  it('step 5 — traceability: this roll was consumed for what, when, which document', async () => {
    const lotB = await db.materialLot.findUniqueOrThrow({
      where: { materialId_lotNumber: { materialId: f.materialId, lotNumber: rollB } },
    });
    const trace = await getLotTrace(lotB.id);

    expect(trace.lot.derivedStatus).toBe('PARTIAL');
    expect(trace.lot.consumedKg).toBe('80.000');
    expect(trace.summary.issueCount).toBe(1);

    const issueMovement = trace.movements.find((m) => m.type === 'ISSUE');
    expect(issueMovement).toBeDefined();
    expect(issueMovement!.direction).toBe('OUT');
    expect(issueMovement!.weightKg).toBe('80.000');
    expect(issueMovement!.document?.number).toBeTruthy();
    expect(issueMovement!.document?.referenceLabel).toBeTruthy();
    expect(issueMovement!.document?.purpose).toContain('۲ قطعه');

    // receipt side is also visible with its contract
    const receipt = trace.movements.find((m) => m.type === 'RECEIPT');
    expect(receipt).toBeDefined();
    expect(trace.contractReceipts).toHaveLength(1);

    // consumption report row for this roll reconciles with the ledger
    const report = await lotConsumption({ lotNumber: rollB, format: 'json' });
    const issueRows = report.rows.filter((r) => r.kind === 'مصرف (حواله)');
    expect(issueRows).toHaveLength(1);
    expect(issueRows[0]!.weightKg).toBe('80.000');
    expect(String(issueRows[0]!.purpose)).toContain('۲ قطعه');
  });

  it('step 5b — coil-inventory report reconciles with raw ledger math', async () => {
    const report = await coilInventory({ materialId: f.materialId, format: 'json' });
    expect(report.rows).toHaveLength(3);

    const rollBRow = report.rows.find((r) => r.lotNumber === rollB);
    expect(rollBRow!.weightRemainingKg).toBe('1920.000');
    expect(rollBRow!.consumedKg).toBe('80.000');

    // ledger reconciliation: received − issues = remaining, for every roll
    const lots = await db.materialLot.findMany({ where: { materialId: f.materialId } });
    for (const lot of lots) {
      const txs = await db.inventoryTransaction.findMany({ where: { lotId: lot.id } });
      const sign = (t: string) => (t === 'ISSUE' || t === 'TRANSFER_OUT' || t === 'ADJUSTMENT_OUT' ? -1 : 1);
      const netKg = txs.reduce((a, t) => a.plus(new D(t.weightKg ?? 0).mul(sign(t.type))), new D(0));
      expect(netKg.toFixed(3)).toBe(new D(lot.weightRemainingKg).toFixed(3));
    }
  });

  it('step 6 — the rest of the roll is consumed → roll closes as CONSUMED', async () => {
    const lotB = await db.materialLot.findUniqueOrThrow({
      where: { materialId_lotNumber: { materialId: f.materialId, lotNumber: rollB } },
    });

    const doc = await createDocument(
      {
        documentType: 'ISSUE',
        documentDate: f.today,
        warehouseId: f.warehouseId,
        description: 'مصرف باقی‌مانده رول',
        referenceType: 'MANUFACTURING_ORDER',
        referenceId: moId,
        lines: [
          {
            materialId: f.materialId,
            lotId: lotB.id,
            quantity: 1920,
            weightKg: 1920,
            fromLocationId: f.locationAId,
            notes: 'مصرف کامل باقی‌مانده رول',
          },
        ],
      },
      f.adminId,
      {},
    );
    const posted = await postDocument(doc.id, f.adminId, {});
    expect(posted?.postingStatus).toBe('POSTED');

    const after = await db.materialLot.findUniqueOrThrow({ where: { id: lotB.id } });
    expect(after.status).toBe('CLOSED');

    const { lots, summary } = await getLotSummaries({ materialId: f.materialId });
    expect(summary.full).toBe(2);
    expect(summary.partial).toBe(0);
    expect(summary.consumed).toBe(1);
    const closed = lots.find((l) => l.lotNumber === rollB);
    expect(closed!.derivedStatus).toBe('CONSUMED');
  });

  it('step 7 — correction goes through a reversal document: consumption shrinks, roll reopens', async () => {
    const reversed = await reverseDocument(issueDocId, f.adminId, 'اشتباه در وزن مصرف — سند ابطالی', {});
    expect(reversed?.postingStatus).toBe('POSTED');
    expect(reversed?.reversalOfId).toBe(issueDocId);

    const lotB = await db.materialLot.findUniqueOrThrow({
      where: { materialId_lotNumber: { materialId: f.materialId, lotNumber: rollB } },
    });
    // 2000 received − 1920 consumed in step 6 + 80 restored by this reversal = 80
    expect(new D(lotB.weightRemainingKg).toFixed(1)).toBe('80.0');

    const { lots, summary } = await getLotSummaries({ materialId: f.materialId });
    expect(summary.partial).toBe(1);
    expect(summary.consumed).toBe(0);

    // the trace now shows the reversal explicitly
    const trace = await getLotTrace(lotB.id);
    const reversalMovement = trace.movements.find((m) => m.reversalOfTransaction !== null);
    expect(reversalMovement).toBeDefined();
    expect(reversalMovement!.type).toBe('RECEIPT');

    // and the consumption report separates consumption from reversals
    const report = await lotConsumption({ materialId: f.materialId, format: 'json' });
    const reversalRows = report.rows.filter((r) => String(r.kind).startsWith('ابطال'));
    expect(reversalRows).toHaveLength(1);
    expect(reversalRows[0]!.weightKg).toBe('-80.000');
  });
});

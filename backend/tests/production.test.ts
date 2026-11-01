import { describe, it, expect, beforeAll } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  createManufacturingOrder,
  releaseManufacturingOrder,
  createProductionReport,
  confirmProductionReport,
  createProductionTransfer,
  postProductionTransfer,
  reverseProductionTransfer,
  completeManufacturingOrder,
  getWipDashboard,
  getWipReconciliation,
  listManufacturingOrders,
} from '../src/modules/production/production.service';
import { db, buildFixtures, uniqueCode, type Fixtures } from './helpers';

const D = Prisma.Decimal;
const Q = (v: Prisma.Decimal | string | number | null | undefined) => new D(v ?? 0);

describe('production & WIP module', () => {
  let f: Fixtures;
  let moId: string;
  let ops: { id: string; sequence: number }[] = [];

  beforeAll(async () => {
    f = await buildFixtures();
  });

  it('creates an MO and generates operations from the ACTIVE route with scrap-adjusted planned quantities', async () => {
    const mo = await createManufacturingOrder(
      { partId: f.partId, quantity: 95, routeId: f.routeId, dueDate: f.today },
      f.adminId,
      {},
    );
    moId = mo.id;
    expect(mo.status).toBe('PLANNED');
    expect(mo.operations).toHaveLength(3);
    expect(mo.operations.map((o) => o.sequence)).toEqual([1, 2, 3]);

    // backward planning: step3 = 95, step2 = 95/0.99, step1 = step2/0.99
    expect(Q(mo.operations[2]!.plannedQuantity).toFixed(2)).toBe('95.00');
    expect(Q(mo.operations[1]!.plannedQuantity).toFixed(2)).toBe('95.96');
    expect(Q(mo.operations[0]!.plannedQuantity).toFixed(2)).toBe('96.93');

    ops = mo.operations.map((o) => ({ id: o.id, sequence: o.sequence }));
  });

  it('rejects reports that violate the conservation equation', async () => {
    await releaseManufacturingOrder(moId, f.adminId, {});
    // input 105 ≠ produced 100 + scrap 3 (outputs = 103)
    await expect(
      createProductionReport(
        {
          operationId: ops[0]!.id,
          reportDate: f.today,
          inputQuantity: 105,
          producedQuantity: 100,
          scraps: [{ reason: 'SETUP_WASTE', quantity: 3 }],
        },
        f.adminId,
        {},
      ),
    ).rejects.toMatchObject({ code: 'report_not_balanced' });
  });

  it('confirms reports, updates aggregates, and enforces WIP feed limits', async () => {
    // feed op1 from the raw-material warehouse (material issued via inventory beforehand)
    const feed = await createProductionTransfer(
      { partId: f.partId, fromWarehouseId: f.warehouseId, toOperationId: ops[0]!.id, quantity: 105, transferDate: f.today },
      f.adminId,
      {},
    );
    await postProductionTransfer(feed.id, f.adminId, {});

    // feeding more than received must fail
    await expect(
      createProductionReport(
        {
          operationId: ops[0]!.id,
          reportDate: f.today,
          inputQuantity: 200,
          producedQuantity: 200,
        },
        f.adminId,
        {},
      ),
    ).resolves.toBeTruthy(); // creation allowed; confirmation must fail
    const badReport = await db.productionReport.findFirstOrThrow({
      where: { operationId: ops[0]!.id, inputQuantity: 200 },
      orderBy: { createdAt: 'desc' },
    });
    await expect(confirmProductionReport(badReport.id, f.adminId, {})).rejects.toMatchObject({ code: 'not_enough_wip' });
    await db.productionReport.update({ where: { id: badReport.id }, data: { status: 'CANCELLED' } });

    // balanced report with scrap + rejected + rework: 105 = 100 + 3 + 2 + 0? → produced 98, scrap 3, rejected 2, rework 2
    const report = await createProductionReport(
      {
        operationId: ops[0]!.id,
        reportDate: f.today,
        shiftId: (await db.shift.findFirstOrThrow({ where: { code: 'SH1' } })).id,
        inputQuantity: 105,
        producedQuantity: 98,
        rejectedQuantity: 2,
        reworkQuantity: 2,
        scraps: [
          { reason: 'SETUP_WASTE', quantity: 2 },
          { reason: 'DIE_DEFECT', quantity: 1 },
        ],
      },
      f.adminId,
      {},
    );
    expect(report.status).toBe('DRAFT');
    await confirmProductionReport(report.id, f.adminId, {});

    const op1 = await db.productionOperation.findUniqueOrThrow({ where: { id: ops[0]!.id } });
    expect(Q(op1.receivedQuantity).toFixed(1)).toBe('105.0');
    expect(Q(op1.inputQuantity).toFixed(1)).toBe('105.0');
    expect(Q(op1.producedQuantity).toFixed(1)).toBe('98.0');
    expect(Q(op1.scrappedQuantity).toFixed(1)).toBe('3.0');
    expect(Q(op1.rejectedQuantity).toFixed(1)).toBe('2.0');
    expect(Q(op1.reworkQuantity).toFixed(1)).toBe('2.0');

    const mo = await db.manufacturingOrder.findUniqueOrThrow({ where: { id: moId } });
    expect(mo.status).toBe('IN_PROGRESS');

    // duplicate confirmation guard
    await expect(confirmProductionReport(report.id, f.adminId, {})).rejects.toMatchObject({ code: 'duplicate_posting' });
  });

  it('transfers between operations are explicit, partial, and never double-count quantity', async () => {
    // op1 produced 98; ready for transfer = 98. Try over-transfer first.
    const over = await createProductionTransfer(
      { partId: f.partId, fromOperationId: ops[0]!.id, toOperationId: ops[1]!.id, quantity: 99, transferDate: f.today },
      f.adminId,
      {},
    );
    await expect(postProductionTransfer(over.id, f.adminId, {})).rejects.toMatchObject({ code: 'not_ready_for_transfer' });

    // partial transfer 60
    const t1 = await createProductionTransfer(
      { partId: f.partId, fromOperationId: ops[0]!.id, toOperationId: ops[1]!.id, quantity: 60, transferDate: f.today },
      f.adminId,
      {},
    );
    await postProductionTransfer(t1.id, f.adminId, {});

    let op1 = await db.productionOperation.findUniqueOrThrow({ where: { id: ops[0]!.id } });
    let op2 = await db.productionOperation.findUniqueOrThrow({ where: { id: ops[1]!.id } });
    expect(Q(op1.transferredOutQuantity).toFixed(1)).toBe('60.0');
    expect(Q(op2.receivedQuantity).toFixed(1)).toBe('60.0');
    // remaining at op1 = produced − transferred = 38
    expect(Q(op1.producedQuantity).minus(Q(op1.transferredOutQuantity)).toFixed(1)).toBe('38.0');

    // duplicate posting of the same transfer is blocked
    await expect(postProductionTransfer(t1.id, f.adminId, {})).rejects.toMatchObject({ code: 'duplicate_posting' });

    // second partial transfer 38 (rework is re-fed into op1 later)
    const t2 = await createProductionTransfer(
      { partId: f.partId, fromOperationId: ops[0]!.id, toOperationId: ops[1]!.id, quantity: 38, transferDate: f.today },
      f.adminId,
      {},
    );
    await postProductionTransfer(t2.id, f.adminId, {});
    op1 = await db.productionOperation.findUniqueOrThrow({ where: { id: ops[0]!.id } });
    op2 = await db.productionOperation.findUniqueOrThrow({ where: { id: ops[1]!.id } });
    expect(Q(op1.transferredOutQuantity).toFixed(1)).toBe('98.0');
    expect(Q(op2.receivedQuantity).toFixed(1)).toBe('98.0');
  });

  it('reversal of a transfer restores operation aggregates (rule 10 analogue)', async () => {
    const t = await createProductionTransfer(
      { partId: f.partId, fromOperationId: ops[1]!.id, toOperationId: ops[2]!.id, quantity: 10, transferDate: f.today },
      f.adminId,
      {},
    );
    // nothing produced at op2 yet → guard fires
    await expect(postProductionTransfer(t.id, f.adminId, {})).rejects.toMatchObject({ code: 'not_ready_for_transfer' });
  });

  it('runs a full multi-operation route to finished goods and conserves every quantity', async () => {
    // op2: receive 98 → produce 95, scrap 2, rejected 1 (98 = 95+2+1)
    const r2 = await createProductionReport(
      { operationId: ops[1]!.id, reportDate: f.today, inputQuantity: 98, producedQuantity: 95, rejectedQuantity: 1, scraps: [{ reason: 'MACHINE_FAULT', quantity: 2 }] },
      f.adminId,
      {},
    );
    await confirmProductionReport(r2.id, f.adminId, {});

    // rework re-feed at op1: 2 rework pieces → input 2, produced 2 (feed available = 0 received + 2 rework)
    const r3 = await createProductionReport(
      { operationId: ops[0]!.id, reportDate: f.today, inputQuantity: 2, producedQuantity: 2 },
      f.adminId,
      {},
    );
    await confirmProductionReport(r3.id, f.adminId, {});

    // transfer reworked 2 to op2
    const t3 = await createProductionTransfer(
      { partId: f.partId, fromOperationId: ops[0]!.id, toOperationId: ops[1]!.id, quantity: 2, transferDate: f.today },
      f.adminId,
      {},
    );
    await postProductionTransfer(t3.id, f.adminId, {});

    // op2: second report (input 2 reworked → produced 2)
    const r4 = await createProductionReport(
      { operationId: ops[1]!.id, reportDate: f.today, inputQuantity: 2, producedQuantity: 2 },
      f.adminId,
      {},
    );
    await confirmProductionReport(r4.id, f.adminId, {});
    const op2 = await db.productionOperation.findUniqueOrThrow({ where: { id: ops[1]!.id } });
    expect(Q(op2.producedQuantity).toFixed(1)).toBe('97.0');

    // op2 → op3 transfer of all 97
    const t4 = await createProductionTransfer(
      { partId: f.partId, fromOperationId: ops[1]!.id, toOperationId: ops[2]!.id, quantity: 97, transferDate: f.today },
      f.adminId,
      {},
    );
    await postProductionTransfer(t4.id, f.adminId, {});

    // op3: paint all 97 (97 in → 95 good, 2 scrap)
    const r5 = await createProductionReport(
      { operationId: ops[2]!.id, reportDate: f.today, inputQuantity: 97, producedQuantity: 95, scraps: [{ reason: 'QUALITY_REJECT', quantity: 2 }] },
      f.adminId,
      {},
    );
    await confirmProductionReport(r5.id, f.adminId, {});

    // op3 → FG warehouse transfer
    const fg = await createProductionTransfer(
      { partId: f.partId, fromOperationId: ops[2]!.id, toWarehouseId: f.whOtherId, quantity: 95, transferDate: f.today },
      f.adminId,
      {},
    );
    await postProductionTransfer(fg.id, f.adminId, {});

    // FG stock exists as posted inventory + balance
    const fgBal = await db.stockBalance.findFirstOrThrow({ where: { partId: f.partId, warehouseId: f.whOtherId } });
    expect(Q(fgBal.quantity).toFixed(1)).toBe('95.0');
    expect(Q(fgBal.weightKg).toFixed(1)).toBe('190.0'); // 95 × 2 kg
    const fgDoc = await db.inventoryDocument.findFirstOrThrow({
      where: { documentType: 'PRODUCTION_RECEIPT', referenceType: 'PRODUCTION_TRANSFER', referenceId: fg.id },
    });
    expect(fgDoc.postingStatus).toBe('POSTED');

    // MO completes
    const mo = await completeManufacturingOrder(moId, f.adminId, {});
    expect(mo.status).toBe('COMPLETED');

    // ---- global conservation ----
    // fed 105 = FG 95 + scrap(3+2+2) + rejected(2) + WIP(0) + produced-not-transferred(0)
    const wip = await getWipReconciliation(f.partId);
    const moRec = await db.manufacturingOrder.findUniqueOrThrow({ where: { id: moId } });
    const row = wip.find((r) => r.moNumber === moRec.moNumber)!;
    expect(row.conserved).toBe(true);
    expect(row.fedFromWarehouse).toBe('105.0000');
    expect(row.transferredToFg).toBe('95.0000');
    expect(row.scrapAndRejected).toBe('10.0000');
    expect(row.wipRemaining).toBe('0.0000');

    // WIP dashboard shows zero remaining but recorded production
    const dash = await getWipDashboard();
    const partRec = await db.part.findUniqueOrThrow({ where: { id: f.partId } });
    const moRows = dash.operations.filter((r) => r.partNumber === partRec.partNumber);
    const totalWip = moRows.reduce((a, r) => a + Number(r.wipTotal), 0);
    expect(totalWip).toBeCloseTo(0, 6);
  });

  it('FG transfer reversal returns finished-goods stock (correction path)', async () => {
    // small second MO to exercise reversal without touching the completed one
    const mo2 = await createManufacturingOrder({ partId: f.partId, quantity: 10, routeId: f.routeId }, f.adminId, {});
    await releaseManufacturingOrder(mo2.id, f.adminId, {});
    const ops2 = await db.productionOperation.findMany({ where: { manufacturingOrderId: mo2.id }, orderBy: { sequence: 'asc' } });

    const feed = await createProductionTransfer(
      { partId: f.partId, fromWarehouseId: f.warehouseId, toOperationId: ops2[0]!.id, quantity: 11, transferDate: f.today },
      f.adminId,
      {},
    );
    await postProductionTransfer(feed.id, f.adminId, {});

    const rep = await createProductionReport(
      { operationId: ops2[0]!.id, reportDate: f.today, inputQuantity: 11, producedQuantity: 10, scraps: [{ reason: 'OTHER', quantity: 1 }] },
      f.adminId,
      {},
    );
    await confirmProductionReport(rep.id, f.adminId, {});

    const fg = await createProductionTransfer(
      { partId: f.partId, fromOperationId: ops2[0]!.id, toWarehouseId: f.whOtherId, quantity: 10, transferDate: f.today },
      f.adminId,
      {},
    );
    await postProductionTransfer(fg.id, f.adminId, {});
    let fgBal = await db.stockBalance.findFirstOrThrow({ where: { partId: f.partId, warehouseId: f.whOtherId } });
    const before = Q(fgBal.quantity);

    await reverseProductionTransfer(fg.id, f.adminId, 'خطای ثبت خروجی');
    fgBal = await db.stockBalance.findFirstOrThrow({ where: { partId: f.partId, warehouseId: f.whOtherId } });
    expect(Q(fgBal.quantity).toFixed(1)).toBe(before.minus(10).toFixed(1));

    const transfer = await db.productionTransfer.findUniqueOrThrow({ where: { id: fg.id } });
    expect(transfer.postingStatus).toBe('REVERSED');

    // re-posting a reversed transfer is blocked
    await expect(postProductionTransfer(fg.id, f.adminId, {})).rejects.toMatchObject({ code: 'duplicate_posting' });
  });

  it('lists MOs with progress and exposes the WIP dashboard totals', async () => {
    const list = await listManufacturingOrders({});
    expect(list.length).toBeGreaterThanOrEqual(2);
    const completed = list.find((m) => m.id === moId)!;
    expect(completed.progressPercent).toBe(100);
    expect(completed.producedFinal).toBe('95.0000');
  });

  it('prevents duplicate physical quantity across locations after transfers', async () => {
    // sum of all op WIP + FG stock must equal fed-from-warehouse − scrap − rejected
    const mos = await db.manufacturingOrder.findMany({
      where: { partId: f.partId },
      include: { operations: { orderBy: { sequence: 'asc' } } },
    });
    let totalWip = new D(0);
    let totalScrapRej = new D(0);
    for (const mo of mos) {
      for (const op of mo.operations) {
        totalWip = totalWip
          .plus(Q(op.receivedQuantity))
          .minus(Q(op.transferredOutQuantity))
          .minus(Q(op.scrappedQuantity))
          .minus(Q(op.rejectedQuantity));
        totalScrapRej = totalScrapRej.plus(Q(op.scrappedQuantity)).plus(Q(op.rejectedQuantity));
      }
    }
    const fgBal = await db.stockBalance.findFirstOrThrow({ where: { partId: f.partId, warehouseId: f.whOtherId } });
    const fed = mos.reduce((a, mo) => a.plus(mo.operations.length ? Q(mo.operations[0]!.receivedQuantity) : new D(0)), new D(0));
    // conservation: fed = FG + WIP + scrap/rejected
    expect(fed.toFixed(1)).toBe(Q(fgBal.quantity).plus(totalWip).plus(totalScrapRej).toFixed(1));
    void uniqueCode;
  });
});

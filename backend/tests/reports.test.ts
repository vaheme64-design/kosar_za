/**
 * KPIMS — Phase 5: management reporting reconciliation tests.
 *
 * Every report figure is checked against the raw records that must back it
 * (production reports, the immutable inventory ledger, stock balances, WIP
 * aggregates). The suite also proves: CSV export shape, drill-down to source
 * documents, machine-utilization gating on reliable capacity data, and that
 * a drifted stock balance is detected by the reconciliation report.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  createCustomerOrder,
} from '../src/modules/planning/planning.service';
import { getOperationsDashboard } from '../src/modules/dashboard/dashboard.routes';
import {
  createManufacturingOrder,
  releaseManufacturingOrder,
  createProductionReport,
  confirmProductionReport,
  createProductionTransfer,
  postProductionTransfer,
} from '../src/modules/production/production.service';
import { createDocument, postDocument } from '../src/modules/inventory/inventory.service';
import {
  planVsActual,
  orderFulfillment,
  backlog,
  wipByPartOperation,
  wipAging,
  materialConsumption,
  sapcoAccount,
  inventoryValuation,
  scrapReport,
  machineWorkload,
  productionDelays,
  inventoryMovements,
  inventoryReconciliation,
  drillDown,
} from '../src/modules/reports/reports.service';
import { reportToCsv } from '../src/modules/reports/reports.helpers';
import { drillDownSchema } from '../src/modules/reports/reports.schemas';
import { db, buildFixtures, uniqueCode, ledgerSum, type Fixtures } from './helpers';

const iso = (offsetDays: number): string => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
const d = (v: string | number | null | undefined) => Number(v ?? 0);

describe('phase 5 — management reporting & control (integration)', () => {
  let f: Fixtures;
  let customerId: string;
  let lineId: string;
  let lineOverdueId: string;
  let moId: string;
  let moOps: { id: string; sequence: number }[] = [];
  let mo2Id: string;
  let machineCapId: string; // PNT-501 (has PNT capability, 150/h)
  let machineNoCapId: string; // CUT-201 (no BLK capability)
  let lotOwnedId: string;
  let part2Id: string; // produced without BOM
  let partNumber: string;
  let whCode: string;
  const period = { from: iso(-3), to: iso(1) };

  beforeAll(async () => {
    f = await buildFixtures();
    const unitPcs = await db.unitOfMeasure.findUniqueOrThrow({ where: { code: 'PCS' } });
    const unitKg = await db.unitOfMeasure.findUniqueOrThrow({ where: { code: 'KG' } });
    partNumber = (await db.part.findUniqueOrThrow({ where: { id: f.partId } })).partNumber;
    whCode = (await db.warehouse.findUniqueOrThrow({ where: { id: f.warehouseId } })).code;

    const customer = await db.customer.create({ data: { code: uniqueCode('CU'), nameFa: 'مشتری گزارش' } });
    customerId = customer.id;

    // machines: PNT-501 has capability for the paint op; CUT-201 has none for blanking
    machineCapId = (await db.machine.findUniqueOrThrow({ where: { code: 'PNT-501' } })).id;
    machineNoCapId = (await db.machine.findUniqueOrThrow({ where: { code: 'CUT-201' } })).id;

    // BOM: 2 kg of fixture material per finished part
    await db.partMaterialRequirement.create({
      data: { partId: f.partId, materialId: f.materialId, quantityPerUnit: 2, weightKgPerUnit: 2, notes: 'داده آزمون گزارش' },
    });

    // part 2 — will be produced WITHOUT any BOM row (missing standard must be surfaced)
    const part2 = await db.part.create({
      data: { partNumber: uniqueCode('PT'), nameFa: 'قطعه بدون BOM', partType: 'FINISHED_PART', baseUnitId: unitPcs.id },
    });
    part2Id = part2.id;

    // ---- customer orders (real planning-module service)
    const order = await createCustomerOrder(
      { customerId, orderDate: iso(0), lines: [{ partId: f.partId, quantity: 100, dueDate: iso(10) }] },
      f.adminId,
      {},
    );
    lineId = order.lines[0]!.id;
    const orderOverdue = await createCustomerOrder(
      { customerId, orderDate: iso(-9), lines: [{ partId: f.partId, quantity: 30, dueDate: iso(-5) }] },
      f.adminId,
      {},
    );
    lineOverdueId = orderOverdue.lines[0]!.id;

    // ---- plan + plan line (fixture), MO linked through planLineId
    const plan = await db.productionPlan.create({
      data: {
        planNumber: uniqueCode('PL'), title: 'برنامه آزمون گزارش',
        periodStart: new Date(), periodEnd: new Date(Date.now() + 7 * 86_400_000),
        status: 'CONFIRMED', createdById: f.adminId, confirmedAt: new Date(),
      },
    });
    const planLine = await db.productionPlanLine.create({
      data: { planId: plan.id, lineNo: 1, partId: f.partId, plannedQuantity: 200, customerOrderLineId: lineId, grossQuantity: 200 },
    });

    // ---- MO #1 (200 pcs, full 3-op chain, ending with 60 pcs in FG)
    const mo = await createManufacturingOrder(
      { partId: f.partId, quantity: 200, routeId: f.routeId, dueDate: iso(7), planLineId: planLine.id },
      f.adminId,
      {},
    );
    moId = mo.id;
    moOps = mo.operations.map((o) => ({ id: o.id, sequence: o.sequence }));
    await releaseManufacturingOrder(moId, f.adminId, {});

    const feed = await createProductionTransfer({ partId: f.partId, fromWarehouseId: f.warehouseId, toOperationId: moOps[0]!.id, quantity: 210, transferDate: f.today }, f.adminId, {});
    await postProductionTransfer(feed.id, f.adminId, {});
    const r1 = await createProductionReport({ operationId: moOps[0]!.id, reportDate: f.today, inputQuantity: 210, producedQuantity: 206, machineId: (await db.machine.findUniqueOrThrow({ where: { code: 'PRES-101' } })).id, scraps: [{ reason: 'SETUP_WASTE', quantity: 4 }] }, f.adminId, {});
    await confirmProductionReport(r1.id, f.adminId, {});
    const t12 = await createProductionTransfer({ partId: f.partId, fromOperationId: moOps[0]!.id, toOperationId: moOps[1]!.id, quantity: 206, transferDate: f.today }, f.adminId, {});
    await postProductionTransfer(t12.id, f.adminId, {});
    const r2 = await createProductionReport({ operationId: moOps[1]!.id, reportDate: f.today, inputQuantity: 206, producedQuantity: 204, machineId: (await db.machine.findUniqueOrThrow({ where: { code: 'PRES-102' } })).id, scraps: [{ reason: 'SETUP_WASTE', quantity: 2 }] }, f.adminId, {});
    await confirmProductionReport(r2.id, f.adminId, {});
    const t23 = await createProductionTransfer({ partId: f.partId, fromOperationId: moOps[1]!.id, toOperationId: moOps[2]!.id, quantity: 204, transferDate: f.today }, f.adminId, {});
    await postProductionTransfer(t23.id, f.adminId, {});
    const r3 = await createProductionReport({ operationId: moOps[2]!.id, reportDate: f.today, inputQuantity: 64, producedQuantity: 60, machineId: machineCapId, scraps: [{ reason: 'SETUP_WASTE', quantity: 4 }] }, f.adminId, {});
    await confirmProductionReport(r3.id, f.adminId, {});

    // FG receipt: 60 finished parts into the finished-goods warehouse
    const fg = await createProductionTransfer({ partId: f.partId, fromOperationId: moOps[2]!.id, toWarehouseId: f.whOtherId, quantity: 60, transferDate: f.today }, f.adminId, {});
    await postProductionTransfer(fg.id, f.adminId, {});

    // ---- MO #2 (50 pcs, overdue, reported on a machine WITHOUT the capability)
    const mo2 = await createManufacturingOrder({ partId: f.partId, quantity: 50, routeId: f.routeId, dueDate: iso(-5) }, f.adminId, {});
    mo2Id = mo2.id;
    await releaseManufacturingOrder(mo2Id, f.adminId, {});
    const feed2 = await createProductionTransfer({ partId: f.partId, fromWarehouseId: f.warehouseId, toOperationId: mo2.operations[0]!.id, quantity: 52, transferDate: f.today }, f.adminId, {});
    await postProductionTransfer(feed2.id, f.adminId, {});
    const r4 = await createProductionReport({ operationId: mo2.operations[0]!.id, reportDate: f.today, inputQuantity: 52, producedQuantity: 50, machineId: machineNoCapId, scraps: [{ reason: 'SETUP_WASTE', quantity: 2 }] }, f.adminId, {});
    await confirmProductionReport(r4.id, f.adminId, {});

    // ---- machine assignments (one fully dated, one missing plannedEnd)
    await db.machineAssignment.create({
      data: { operationId: moOps[2]!.id, machineId: machineCapId, plannedStart: new Date(Date.now() - 2 * 3_600_000), plannedEnd: new Date(), status: 'ACTIVE' },
    });
    await db.machineAssignment.create({
      data: { operationId: mo2.operations[0]!.id, machineId: machineNoCapId, plannedStart: new Date(Date.now() - 3_600_000), status: 'PLANNED' },
    });

    // ---- material: receipt 500 kg owned + 50 kg consignment, issue 100 kg
    const rec1 = await createDocument(
      { documentType: 'RECEIPT', documentDate: f.today, warehouseId: f.warehouseId, lines: [{ materialId: f.materialId, lotNumber: uniqueCode('LOT'), quantity: 500, weightKg: 500 }] },
      f.adminId, {},
    );
    await postDocument(rec1.id, f.adminId, {});
    // the lot is created at posting time — fetch it for the issue line
    lotOwnedId = (await db.materialLot.findFirstOrThrow({ where: { materialId: f.materialId, ownership: 'OWNED' } })).id;
    const rec2 = await createDocument(
      { documentType: 'RECEIPT', documentDate: f.today, warehouseId: f.warehouseId, lines: [{ materialId: f.materialId, lotNumber: uniqueCode('LOT'), quantity: 50, weightKg: 50, ownership: 'SUPPLIER_CONSIGNMENT' }] },
      f.adminId, {},
    );
    await postDocument(rec2.id, f.adminId, {});
    const iss = await createDocument(
      { documentType: 'PRODUCTION_ISSUE', documentDate: f.today, warehouseId: f.warehouseId, referenceType: 'MANUFACTURING_ORDER', referenceId: moId, lines: [{ materialId: f.materialId, lotId: lotOwnedId, quantity: 100, weightKg: 100 }] },
      f.adminId, {},
    );
    await postDocument(iss.id, f.adminId, {});

    // ---- delivered quantity is a real order-line field (40 of 100 delivered)
    await db.customerOrderLine.update({ where: { id: lineId }, data: { deliveredQuantity: 40 } });

    // ---- finished goods seed for the backlog coverage check
    await db.stockBalance.upsert({
      where: { balanceKey: `${f.partId}:-:${f.whOtherId}:-:-:${unitPcs.id}:OWNED:APPROVED` },
      create: { balanceKey: `${f.partId}:-:${f.whOtherId}:-:-:${unitPcs.id}:OWNED:APPROVED`, partId: f.partId, warehouseId: f.whOtherId, unitId: unitPcs.id, quantity: 300, weightKg: 0 },
      update: { quantity: { increment: 300 } },
    });

    void unitKg;
  });

  // -----------------------------------------------------------------
  it('plan-vs-actual: actual equals posted production reports of the final operation (reconciliation)', async () => {
    const report = await planVsActual({ customerId });
    const line = await db.productionPlanLine.findFirstOrThrow({ where: { partId: f.partId, plan: { title: 'برنامه آزمون گزارش' } }, include: { plan: true } });
    const row2 = report.rows.find((r) => (r.lineNo as number) === line.lineNo && String(r.planNumber) === line.plan.planNumber)!;
    expect(row2).toBeTruthy();
    expect(d(row2.plannedQuantity as string)).toBe(200);
    expect(d(row2.moCreatedQuantity as string)).toBe(200);
    expect(d(row2.actualQuantity as string)).toBe(60);

    // raw reconciliation: sum of POSTED reports on the final operation
    const finalOp = await db.productionOperation.findFirstOrThrow({ where: { manufacturingOrderId: moId, sequence: 3 } });
    const raw = await db.productionReport.aggregate({ _sum: { producedQuantity: true }, where: { operationId: finalOp.id, postingStatus: 'POSTED' } });
    expect(d(raw._sum.producedQuantity)).toBe(60);
    expect(d(row2.actualQuantity as string)).toBe(d(raw._sum.producedQuantity));
    expect(d(row2.variance as string)).toBeCloseTo(-140, 5);
  });

  it('order-fulfillment: ordered/delivered/open match real order-line fields, overdue flagged', async () => {
    const report = await orderFulfillment({ customerId });
    const row = report.rows.find((r) => r._drill && (r._drill as { id: string }).id === lineId)!;
    expect(d(row.orderedQuantity as string)).toBe(100);
    expect(d(row.deliveredQuantity as string)).toBe(40);
    expect(d(row.openQuantity as string)).toBe(60);
    expect(row.overdue).toBe(false);

    const rowOverdue = report.rows.find((r) => r._drill && (r._drill as { id: string }).id === lineOverdueId)!;
    expect(d(rowOverdue.openQuantity as string)).toBe(30);
    expect(rowOverdue.overdue).toBe(true);
  });

  it('backlog: open demand vs stock + WIP + open MOs reconciles with raw records', async () => {
    const report = await backlog({ partId: f.partId });
    expect(report.rows).toHaveLength(1);
    const row = report.rows[0]!;
    // open orders: 60 (delivered 40 of 100) + 30 overdue = 90
    expect(d(row.openOrderQuantity as string)).toBe(90);
    // open MOs: 200 + 50
    expect(d(row.openMoQuantity as string)).toBe(250);
    // WIP: mo#1 op3 = 204 − 60 − 4 = 140; mo#2 op1 = 52 − 0 − 2 = 50 → 190
    expect(d(row.wipQuantity as string)).toBe(190);
    // FG usable: 300 seeded + 60 FG receipt = 360
    expect(d(row.finishedGoodsUsable as string)).toBe(360);
    expect(d(row.coverageQuantity as string)).toBe(800);
    expect(d(row.uncoveredBacklog as string)).toBe(-710);
    expect(row.coveredFully).toBe(true);

    // cross-check WIP against productionOperation aggregates (reconciliation)
    const ops = await db.productionOperation.findMany({ where: { manufacturingOrder: { partId: f.partId, status: { in: ['RELEASED', 'IN_PROGRESS'] } } } });
    const wipRaw = ops.reduce((acc, op) => acc + d(op.receivedQuantity) - d(op.transferredOutQuantity) - d(op.scrappedQuantity) - d(op.rejectedQuantity), 0);
    expect(d(row.wipQuantity as string)).toBe(wipRaw);
  });

  it('wip-by-part-operation: conservation (waiting+processing+ready = total) and raw match', async () => {
    const report = await wipByPartOperation({ partId: f.partId });
    const pnt = report.rows.find((r) => String(r.part).startsWith(partNumber) && String(r.operation).startsWith('PNT'))!;
    expect(d(pnt.wipTotal as string)).toBe(140);
    expect(d(pnt.waitingToProcess as string)).toBe(140);
    expect(d(pnt.readyForTransfer as string)).toBe(0);
    // conservation check column equals wipTotal
    expect(d(pnt.conservationCheck as string)).toBe(d(pnt.wipTotal as string));

    const blk = report.rows.find((r) => String(r.part).startsWith(partNumber) && String(r.operation).startsWith('BLK'))!;
    // mo#1 op1 fully transferred (0) + mo#2 op1: 50 produced ready for transfer
    expect(d(blk.wipTotal as string)).toBe(50);
    expect(d(blk.readyForTransfer as string)).toBe(50);
  });

  it('wip-aging: aging hours derived from wipSinceAt, unknown aging flagged explicitly', async () => {
    const report = await wipAging({ partId: f.partId });
    const rows = report.rows.filter((r) => d(r.wipTotal as string) > 0);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.agingKnown).toBe(true);
      expect(d(r.agingHours as number)).toBeGreaterThanOrEqual(0);
    }
    // summary note lists buckets
    expect(report.meta.notesFa.some((n) => n.includes('خلاصه سنی'))).toBe(true);
  });

  it('material-consumption: actual = posted issues, standard = produced × BOM, missing BOM surfaced', async () => {
    // produce part2 (no BOM) into FG: 5 pcs via production transfer from a temp op —
    // simpler: a direct PRODUCTION_RECEIPT document (real inventory path)
    const unitPcs = await db.unitOfMeasure.findUniqueOrThrow({ where: { code: 'PCS' } });
    const doc = await createDocument(
      { documentType: 'PRODUCTION_RECEIPT', documentDate: f.today, warehouseId: f.whOtherId, lines: [{ partId: part2Id, quantity: 5, unitId: unitPcs.id }] },
      f.adminId, {},
    );
    await postDocument(doc.id, f.adminId, {});

    const report = await materialConsumption({ from: period.from, to: period.to, materialId: f.materialId });
    const row = report.rows.find((r) => (r._drill as { id: string } | undefined)?.id === f.materialId)!;
    expect(d(row.actualConsumedQuantity as string)).toBe(100);
    expect(d(row.actualConsumedKg as string)).toBe(100);
    expect(d(row.standardQuantity as string)).toBe(120); // 60 produced × 2 kg
    expect(d(row.standardKg as string)).toBe(120);
    expect(d(row.varianceQuantity as string)).toBe(-20);
    expect(row.standardKnown).toBe(true);

    // missing-BOM part is surfaced in the notes — never silently assumed
    expect(report.meta.notesFa.some((n) => n.includes('بدون BOM'))).toBe(true);

    // reconciliation against the raw ledger
    const rawIssue = await db.inventoryTransaction.aggregate({
      _sum: { weightKg: true },
      where: { materialId: f.materialId, type: 'ISSUE', occurredAt: { gte: new Date(`${period.from}T00:00:00.000Z`) } },
    });
    expect(d(rawIssue._sum.weightKg)).toBe(100);
  });

  it('sapco-account: opening/receipts/consumption/closing reconcile with the immutable ledger', async () => {
    const report = await sapcoAccount({ from: period.from, to: period.to, materialId: f.materialId });
    const row = report.rows.find((r) => String(r.materialId) === f.materialId)!;
    expect(d(row.openingKg as string)).toBe(0);
    expect(d(row.receiptsKg as string)).toBe(550); // 500 owned + 50 consignment
    expect(d(row.consumptionKg as string)).toBe(100);
    expect(d(row.closingKg as string)).toBe(450);
    expect(row.closingMatchesLedger).toBe(true);
    expect(d(row.balanceOwnedKg as string)).toBe(400);
    expect(d(row.balanceConsignmentKg as string)).toBe(50);

    const ledger = await ledgerSum({ materialId: f.materialId, warehouseId: f.warehouseId, lotId: null });
    // ledgerSum without lot filter would double count — use explicit per-lot sums
    const lots = await db.materialLot.findMany({ where: { materialId: f.materialId } });
    let totalKg = 0;
    for (const lot of lots) {
      const s = await ledgerSum({ materialId: f.materialId, warehouseId: f.warehouseId, lotId: lot.id });
      totalKg += s.weightKg;
    }
    expect(d(row.closingKg as string)).toBeCloseTo(totalKg, 5);
    expect(totalKg).toBe(450);
    void ledger;
  });

  it('inventory-valuation: quantities only, no monetary valuation, ownership separated', async () => {
    const report = await inventoryValuation({ materialId: f.materialId });
    expect(report.rows.length).toBeGreaterThanOrEqual(2);
    const owned = report.rows.find((r) => r.ownership === 'OWNED' && String(r.warehouse).startsWith(whCode))!;
    const consignment = report.rows.find((r) => r.ownership === 'SUPPLIER_CONSIGNMENT' && String(r.warehouse).startsWith(whCode))!;
    expect(d(owned.quantity as string)).toBe(400);
    expect(d(consignment.quantity as string)).toBe(50);
    // no money column exists — quantities and weights only
    expect(report.columns.some((c) => c.key === 'quantity' && c.kind === 'ACTUAL')).toBe(true);
    expect(report.columns.some((c) => c.key.toLowerCase().includes('value') || c.key.toLowerCase().includes('amount'))).toBe(false);
    expect(report.meta.notesFa.some((n) => n.includes('قاعده ارزش‌گذاری مالی'))).toBe(true);
  });

  it('scrap report: totals equal raw ProductionScrap records (reconciliation)', async () => {
    const report = await scrapReport({ partId: f.partId });
    const rows = report.rows.filter((r) => String(r.part).startsWith(partNumber));
    const total = rows.reduce((acc, r) => acc + d(r.quantity as string), 0);
    // mo#1: 4+2+4 = 10, mo#2: 2 → 12
    expect(total).toBe(12);
    const blk = rows.find((r) => String(r.operation).startsWith('BLK'))!;
    expect(d(blk.quantity as string)).toBe(6);
    expect(blk.scrapPctOfInput).not.toBeNull();

    const raw = await db.productionScrap.aggregate({ _sum: { quantity: true }, where: { partId: f.partId } });
    expect(d(raw._sum.quantity)).toBe(12);
    expect(total).toBe(d(raw._sum.quantity));
  });

  it('machine-workload: utilization only where reliable capacity data exists', async () => {
    const report = await machineWorkload({ ...period, machineId: machineCapId });
    const row = report.rows.find((r) => String(r.machine).startsWith('PNT-501'))!;
    expect(row.capacityReliable).toBe(true);
    expect(row.utilizationPct).not.toBeNull();
    // 60 pcs ÷ 150/h = 24 standard minutes
    expect(d(row.standardMinutes as string)).toBeCloseTo(24, 1);
    expect(d(row.actualProducedQuantity as string)).toBe(60);
    // assignment had 2h planned window
    expect(d(row.plannedMinutes as string)).toBe(120);
    expect(row.plannedAssignmentsMissingDates).toBe(0);

    const noCap = await machineWorkload({ ...period, machineId: machineNoCapId });
    const rowNoCap = noCap.rows.find((r) => String(r.machine).startsWith('CUT-201'))!;
    expect(rowNoCap.capacityReliable).toBe(false);
    expect(rowNoCap.utilizationPct).toBeNull();
    expect(rowNoCap.reasonFa).toBeTruthy();
    expect(rowNoCap.plannedAssignmentsMissingDates).toBe(1);
  });

  it('production-delays: overdue order lines and overdue open MOs from real dates', async () => {
    const report = await productionDelays({ customerId });
    const orderRow = report.rows.find((r) => r.section === 'ردیف سفارش باز' && r._drill && (r._drill as { id: string }).id === lineOverdueId)!;
    expect(orderRow).toBeTruthy();
    expect(d(orderRow.openQuantity as string)).toBe(30);
    expect(d(orderRow.daysLate as number)).toBeGreaterThanOrEqual(5);

    const moRow = report.rows.find((r) => r.section === 'دستور کار باز' && r._drill && (r._drill as { id: string }).id === mo2Id)!;
    expect(moRow).toBeTruthy();
    expect(d(moRow.daysLate as number)).toBeGreaterThanOrEqual(5);
  });

  it('inventory-movements: grouped net equals the signed ledger (reconciliation)', async () => {
    const report = await inventoryMovements({ from: period.from, to: period.to, materialId: f.materialId });
    const row = report.rows.find((r) => (r._drill as { id: string } | undefined)?.id === `MATERIAL|${f.materialId}|${period.from}|${period.to}`)!;
    expect(d(row.inKg as string)).toBe(550);
    expect(d(row.outKg as string)).toBe(100);
    expect(d(row.netKg as string)).toBe(450);

    const lots = await db.materialLot.findMany({ where: { materialId: f.materialId } });
    let inSum = 0;
    let outSum = 0;
    for (const lot of lots) {
      const s = await ledgerSum({ materialId: f.materialId, warehouseId: f.warehouseId, lotId: lot.id });
      if (s.weightKg >= 0) inSum += s.weightKg;
      else outSum += -s.weightKg;
    }
    // per-lot sums are net; recompute gross from raw transactions instead
    const txs = await db.inventoryTransaction.findMany({ where: { materialId: f.materialId, warehouseId: f.warehouseId } });
    let grossIn = 0;
    let grossOut = 0;
    for (const t of txs) {
      const w = d(t.weightKg);
      if (['RECEIPT', 'TRANSFER_IN', 'ADJUSTMENT_IN'].includes(t.type)) grossIn += w;
      else grossOut += w;
    }
    expect(grossIn).toBe(550);
    expect(grossOut).toBe(100);
    expect(grossIn - grossOut).toBe(d(row.netKg as string));
    void inSum;
    void outSum;
  });

  it('inventory-reconciliation: ledger-backed dimensions MATCH, drifted balance flagged', async () => {
    const report = await inventoryReconciliation({ materialId: f.materialId });
    expect(report.rows.length).toBeGreaterThanOrEqual(2);
    for (const r of report.rows) {
      expect(r.status).toBe('MATCH');
      expect(Math.abs(d(r.diffKg as string))).toBeLessThan(0.0001);
    }

    // deliberately drift one balance (test-only manipulation) — must be detected
    const drifted = await db.stockBalance.findFirstOrThrow({
      where: { materialId: f.materialId, ownership: 'OWNED', quantity: { gt: 0 } },
    });
    await db.stockBalance.update({ where: { id: drifted.id }, data: { quantity: d(drifted.quantity) + 7 } });

    const after = await inventoryReconciliation({ materialId: f.materialId });
    const flagged = after.rows.find((r) => r.status === 'MISMATCH');
    expect(flagged).toBeTruthy();
    expect(d((flagged as Record<string, unknown>).diffQuantity as string)).toBeCloseTo(7, 5);

    // restore for other suites
    await db.stockBalance.update({ where: { id: drifted.id }, data: { quantity: d(drifted.quantity) } });
    const restored = await inventoryReconciliation({ materialId: f.materialId });
    expect(restored.rows.every((r) => r.status === 'MATCH')).toBe(true);
  });

  it('CSV export: BOM, header block with Jalali timestamp, column labels and data rows', async () => {
    const report = await scrapReport({ partId: f.partId });
    const csv = reportToCsv(report);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('گزارش: ضایعات به تفکیک قطعه و عملیات');
    expect(csv).toContain('زمان تولید:');
    expect(csv).toContain('فیلترها:');
    expect(csv).toContain('مقدار ضایعات');
    const dataRows = csv.trim().split('\r\n').length - 5; // 3 header lines + blank + column header
    expect(dataRows).toBe(report.rows.length);
  });

  it('drill-down: summary rows resolve to source documents', async () => {
    // plan_line → linked MOs
    const line = await db.productionPlanLine.findFirstOrThrow({ where: { partId: f.partId, plan: { title: 'برنامه آزمون گزارش' } } });
    const dd1 = await drillDown('plan_line', line.id, {});
    expect(dd1.rows.some((r) => r.source === 'دستور کار مرتبط' && d(r.quantity as string) === 200)).toBe(true);
    expect(dd1.meta.notesFa.some((n) => n.includes('/production-planning/plans/'))).toBe(true);

    // wip_operation → production reports of that operation
    const pntOp = await db.productionOperation.findFirstOrThrow({ where: { id: moOps[2]!.id } });
    const dd2 = await drillDown('wip_operation', pntOp.id, {});
    expect(dd2.rows.some((r) => r.source === 'گزارش تولید')).toBe(true);

    // inventory_balance → ledger transactions of the balance dimension
    const bal = await db.stockBalance.findFirstOrThrow({ where: { materialId: f.materialId, ownership: 'OWNED', quantity: { gt: 0 } } });
    const dd3 = await drillDown('inventory_balance', bal.id, {});
    expect(dd3.rows.length).toBeGreaterThan(0);

    // movement_group → transactions of the material in the period
    const dd4 = await drillDown('movement_group', `MATERIAL|${f.materialId}|${period.from}|${period.to}`, {});
    expect(dd4.rows.length).toBeGreaterThanOrEqual(3);

    // unknown kind → 400
    await expect(drillDown('bogus_kind', f.partId, {})).rejects.toThrow();
  });

  it('operations dashboard: 9 KPI groups from real records with explicit value kinds', async () => {
    const dash = await getOperationsDashboard();
    const k = dash.kpis;
    expect(k.activeCustomerOrders.count).toBeGreaterThanOrEqual(2);
    expect(d(k.activeCustomerOrders.openQuantity)).toBeGreaterThan(0);
    expect(k.plannedProduction.valueKind).toBe('PLANNED');
    expect(d(k.plannedProduction.quantity)).toBeGreaterThanOrEqual(200);
    expect(k.actualProduction.valueKind).toBe('ACTUAL');
    // actual production (30d) ≥ our posted reports: 206+204+60+50 = 520 for this fixture
    expect(d(k.actualProduction.quantity)).toBeGreaterThanOrEqual(520);
    expect(k.delayedOrders.lineCount).toBeGreaterThanOrEqual(1);
    expect(k.wipQuantity.valueKind).toBe('ACTUAL');
    expect(d(k.wipQuantity.quantity)).toBeGreaterThanOrEqual(140);
    expect(d(k.finishedGoodsStock.owned)).toBeGreaterThan(0);
    expect(d(k.scrap.quantity)).toBeGreaterThanOrEqual(12);
    expect(k.machineUtilization.valueKind).toBe('ESTIMATED');
    // utilization only where reliable — PNT-501 is reliable in this fixture
    const pnt = k.machineUtilization.machines.find((m) => m.machineCode === 'PNT-501');
    expect(pnt?.capacityReliable).toBe(true);
    expect(pnt?.utilizationPct).not.toBeNull();
    const cut = k.machineUtilization.machines.find((m) => m.machineCode === 'CUT-201');
    expect(cut?.capacityReliable).toBe(false);
    expect(cut?.reasonFa).toBeTruthy();
    expect(dash.generatedAt).toBeTruthy();
    expect(dash.generatedAtFa).toBeTruthy();
  });

  // ---- review regressions (phase 5 hardening) ----

  it('drill-down HTTP schema accepts composite server-issued ids (regression: 4 kinds were 400)', () => {
    // wip_part_operation / scrap_group / machine_period / movement_group emit "a|b|c" ids
    const composite = drillDownSchema.parse({ kind: 'movement_group', id: `MATERIAL|${f.partId}|${period.from}|${period.to}` });
    expect(composite.id).toContain('|');
    const single = drillDownSchema.parse({ kind: 'plan_line', id: f.partId });
    expect(single.id).toBe(f.partId);
    expect(() => drillDownSchema.parse({ kind: 'plan_line', id: '' })).toThrow();
  });

  it('drill-down service resolves a composite machine_period id end-to-end', async () => {
    const dd = await drillDown('machine_period', `${machineCapId}|${period.from}|${period.to}`, {});
    expect(dd.rows.some((r) => r.source === 'گزارش تولید (قطع‌بوش‌شده)')).toBe(true);
    expect(dd.rows.some((r) => r.source === 'تخصیص ماشین')).toBe(true);
  });

  it('CSV export neutralizes formula injection and keeps numeric cells numeric', () => {
    const report = reportTableFixture(
      [
        { key: 'part', labelFa: 'قطعه', kind: 'IDENTIFIER' },
        { key: 'quantity', labelFa: 'مقدار', kind: 'ACTUAL' },
      ],
      [
        { part: '=HYPERLINK("http://evil",1)', quantity: '-710.00' },
        { part: '@SUM(1+1)', quantity: '12.5' },
      ],
    );
    const csv = reportToCsv(report);
    expect(csv).toContain("'\"=HYPERLINK"); // quoted AND neutralized
    expect(csv).toContain("'@SUM(1+1)");
    expect(csv).toContain(',-710.00\r\n'); // negative number stays numeric (no quote prefix)
    expect(csv).toContain(',12.5\r\n');
  });
});

/** Minimal in-memory ReportTable for CSV serializer tests (no database access). */
function reportTableFixture(columns: { key: string; labelFa: string; kind: 'IDENTIFIER' | 'ACTUAL' }, rows: Record<string, string>[]) {
  return {
    key: 'fixture',
    titleFa: 'گزارش آزمون CSV',
    columns,
    rows,
    meta: {
      generatedAt: new Date().toISOString(),
      generatedAtFa: '۱۴۰۵/۰۸/۱۱ — ۱۳:۰۰',
      filters: {},
      valueKinds: { IDENTIFIER: 'x', ACTUAL: 'x', PLANNED: 'x', STANDARD: 'x', ESTIMATED: 'x', INFO: 'x' },
      notesFa: [],
    },
  };
}

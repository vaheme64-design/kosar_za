import { describe, it, expect, beforeAll } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  computeGrossDemand,
  computeFgAvailability,
  splitReservations,
  netLine,
  netWipAcrossOperations,
  computeMaterialShortages,
  estimateOperationTime,
  shiftMinutesPerDay,
  evaluateMachine,
  rankCandidates,
  type OrderLineInput,
  type WipOpSnapshot,
  type MachineDef,
  type MachineCandidate,
} from '../src/modules/planning/planning.logic';
import {
  runPlanning,
  createCustomerOrder,
  getPlan,
  confirmPlan,
} from '../src/modules/planning/planning.service';
import { releaseManufacturingOrder, createProductionTransfer, postProductionTransfer, createProductionReport, confirmProductionReport } from '../src/modules/production/production.service';
import { db, buildFixtures, uniqueCode, type Fixtures } from './helpers';

const D = Prisma.Decimal;
const d = (v: Prisma.Decimal.Value | null | undefined) => new D(v ?? 0);
const iso = (offsetDays: number): string => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// pure logic — demand / inventory netting / WIP / materials
// ---------------------------------------------------------------------------

describe('planning engine — demand & inventory netting (pure logic)', () => {
  const line = (over: Partial<OrderLineInput>): OrderLineInput => ({
    lineId: 'l1',
    orderId: 'o1',
    orderNumber: 'CO-1',
    customerId: 'c1',
    customerNameFa: 'مشتری',
    lineNo: 1,
    partId: 'p1',
    quantity: 100,
    deliveredQuantity: 0,
    dueDate: new Date('2026-01-10'),
    lineStatus: 'OPEN',
    orderStatus: 'CONFIRMED',
    ...over,
  });

  it('computes gross demand as quantity − delivered per open confirmed line', () => {
    const r = computeGrossDemand([
      line({ quantity: 500, deliveredQuantity: 120 }),
      line({ lineId: 'l2', partId: 'p1', quantity: 300, dueDate: new Date('2026-01-05') }),
    ]);
    expect(r.byPart.get('p1')!.gross.toFixed(4)).toBe('680.0000');
    // earlier due date first
    expect(r.byPart.get('p1')!.lines[0]!.lineId).toBe('l2');
  });

  it('excludes closed/cancelled lines and draft orders but REPORTS them', () => {
    const r = computeGrossDemand([
      line({ lineStatus: 'COMPLETED' }),
      line({ lineId: 'l2', orderStatus: 'DRAFT' }),
      line({ lineId: 'l3', orderStatus: 'CANCELLED' }),
      line({ lineId: 'l4', quantity: 100, deliveredQuantity: 100 }),
    ]);
    expect(r.byPart.size).toBe(0);
    expect(r.skippedLines).toHaveLength(4);
  });

  it('excludes blocked quality and supplier-owned stock from planning supply', () => {
    const r = computeFgAvailability([
      { partId: 'p1', quantity: 300, ownership: 'OWNED', qualityStatus: 'APPROVED' },
      { partId: 'p1', quantity: 100, ownership: 'OWNED', qualityStatus: 'BLOCKED' },
      { partId: 'p1', quantity: 50, ownership: 'SUPPLIER_CONSIGNMENT', qualityStatus: 'APPROVED' },
    ]);
    expect(r.usable.toFixed(4)).toBe('300.0000');
    expect(r.quarantined.toFixed(4)).toBe('100.0000');
    expect(r.consignment.toFixed(4)).toBe('50.0000');
    expect(r.breakdown).toHaveLength(2);
  });

  it('counts only ACTIVE unexpired reservations and separates line-linked ones', () => {
    const now = new Date();
    const rows = [
      { id: 'r1', quantity: 100, status: 'ACTIVE', expiresAt: null, forCustomerOrderLineId: 'lineA', forManufacturingOrderId: null },
      { id: 'r2', quantity: 40, status: 'ACTIVE', expiresAt: new Date(now.getTime() - 1000), forCustomerOrderLineId: null, forManufacturingOrderId: null },
      { id: 'r3', quantity: 60, status: 'RELEASED', expiresAt: null, forCustomerOrderLineId: null, forManufacturingOrderId: null },
      { id: 'r4', quantity: 30, status: 'ACTIVE', expiresAt: null, forCustomerOrderLineId: 'other', forManufacturingOrderId: null },
    ];
    const split = splitReservations(rows, 'lineA');
    expect(split.forThisLine.toFixed(4)).toBe('100.0000');
    expect(split.forOthers.toFixed(4)).toBe('30.0000');
    expect(split.ignored).toHaveLength(2);
  });

  it('nets per line: reservation for the line first, then FIFO free stock', () => {
    // lineB (earlier due) gets the free stock first
    const mkResult = (lineId: string, remaining: string) => ({
      lineId,
      orderId: 'o1',
      orderNumber: 'CO-1',
      customerNameFa: 'مشتری',
      lineNo: 1,
      partId: 'p1',
      quantity: remaining,
      deliveredQuantity: '0.0000',
      remaining,
      dueDate: new Date('2026-01-10'),
    });
    const lineB = mkResult('lB', '400.0000');
    const lineA = mkResult('lA', '500.0000');
    let free = d(300);
    const rB = netLine({ line: lineB, reservedForThisLine: d(0) }, free);
    free = rB.freeRemaining;
    const rA = netLine({ line: lineA, reservedForThisLine: d(100) }, free);
    expect(rB.result.coveredByStock.toFixed(4)).toBe('300.0000');
    expect(rB.result.netRequirement.toFixed(4)).toBe('100.0000');
    expect(rA.result.coveredByReservations.toFixed(4)).toBe('100.0000');
    expect(rA.result.coveredByStock.toFixed(4)).toBe('0.0000');
    expect(rA.result.netRequirement.toFixed(4)).toBe('400.0000');
  });

  it('never allocates more free stock than exists (over-committed reservations)', () => {
    const mkResult = (lineId: string, remaining: string) => ({
      lineId,
      orderId: 'o1',
      orderNumber: 'CO-1',
      customerNameFa: 'مشتری',
      lineNo: 1,
      partId: 'p1',
      quantity: remaining,
      deliveredQuantity: '0.0000',
      remaining,
      dueDate: null,
    });
    let free = d(50);
    const r1 = netLine({ line: mkResult('x', '500.0000'), reservedForThisLine: d(0) }, free);
    free = r1.freeRemaining;
    const r2 = netLine({ line: mkResult('y', '500.0000'), reservedForThisLine: d(0) }, free);
    expect(r2.result.coveredByStock.toFixed(4)).toBe('0.0000');
  });
});

describe('planning engine — WIP netting across operations (pure logic)', () => {
  const op = (over: Partial<WipOpSnapshot> & { sequence: number; operationId: string }): WipOpSnapshot => ({
    operationCode: 'OP',
    operationNameFa: 'عملیات',
    readyForTransfer: d(0),
    arriving: d(0),
    committedRemaining: d(0),
    scrapFactorPct: 0,
    ...over,
  });

  it('grosses the requirement up by every downstream scrap factor', () => {
    const r = netWipAcrossOperations(d(100), [
      op({ sequence: 1, operationId: 'o1', scrapFactorPct: 2 }),
      op({ sequence: 2, operationId: 'o2', scrapFactorPct: 1 }),
      op({ sequence: 3, operationId: 'o3', scrapFactorPct: 1 }),
    ]);
    expect(r.mustProduceFinal.toFixed(4)).toBe('100.0000');
    // op3: 100/0.99 → op2: /0.99 → op1: /0.98
    expect(d(r.operations[2]!.requiredInput).toFixed(4)).toBe('101.0102');
    expect(d(r.operations[1]!.requiredInput).toFixed(4)).toBe('102.0306');
    expect(r.firstOpRequiredInput.toFixed(4)).toBe('104.1129');
  });

  it('credits WIP ready-for-transfer at the last operation against the FG requirement', () => {
    const r = netWipAcrossOperations(d(100), [
      op({ sequence: 1, operationId: 'o1' }),
      op({ sequence: 2, operationId: 'o2' }),
      op({ sequence: 3, operationId: 'o3', readyForTransfer: d(60), scrapFactorPct: 1 }),
    ]);
    expect(r.operations[2]!.wipUsed).toBe('60.0000');
    expect(r.mustProduceFinal.toFixed(4)).toBe('40.0000');
    expect(r.coveredByWip.toFixed(4)).toBe('60.0000');
  });

  it('credits mid-route WIP against the upstream requirement only', () => {
    const r = netWipAcrossOperations(d(100), [
      op({ sequence: 1, operationId: 'o1', scrapFactorPct: 2 }),
      op({ sequence: 2, operationId: 'o2', readyForTransfer: d(150), scrapFactorPct: 1 }),
      op({ sequence: 3, operationId: 'o3', scrapFactorPct: 1 }),
    ]);
    // op3 still must run 100; op2 WIP covers op1 output need → op1 mustProduce = 0
    expect(r.operations[2]!.mustProduce).toBe('100.0000');
    expect(r.operations[1]!.wipUsed).toBe('101.0102');
    expect(r.operations[0]!.mustProduce).toBe('0.0000');
    expect(r.coveredByWip.toFixed(4)).toBe('0.0000');
  });

  it('credits arriving units (already transferred from previous op) against upstream output', () => {
    const r = netWipAcrossOperations(d(100), [
      op({ sequence: 1, operationId: 'o1', scrapFactorPct: 2 }),
      op({ sequence: 2, operationId: 'o2', arriving: d(50), scrapFactorPct: 1 }),
      op({ sequence: 3, operationId: 'o3', scrapFactorPct: 1 }),
    ]);
    // op2 input 102.0306 (incl. its own scrap allowance); 50 already arrived → op1 output need = 52.0306
    expect(d(r.operations[1]!.arrivingUsed).toFixed(4)).toBe('50.0000');
    expect(d(r.operations[0]!.requiredOutput).toFixed(4)).toBe('52.0306');
  });

  it('credits committed remaining of open MOs and never proposes duplicates', () => {
    const r = netWipAcrossOperations(d(800), [
      op({ sequence: 1, operationId: 'o1', committedRemaining: d(1000) }),
      op({ sequence: 2, operationId: 'o2', committedRemaining: d(1000) }),
      op({ sequence: 3, operationId: 'o3', committedRemaining: d(1000) }),
    ]);
    expect(r.operations[2]!.committedUsed).toBe('800.0000');
    expect(r.mustProduceFinal.toFixed(4)).toBe('0.0000');
    expect(r.coveredByCommittedMos.toFixed(4)).toBe('800.0000');
    expect(r.firstOpRequiredInput.toFixed(4)).toBe('0.0000');
  });

  it('flags invalid scrap factors instead of assuming them away', () => {
    const r = netWipAcrossOperations(d(100), [
      op({ sequence: 1, operationId: 'o1', scrapFactorPct: 100 }),
    ]);
    expect(r.infeasibleReasons[0]).toContain('ضریب ضایعات نامعتبر');
  });
});

describe('planning engine — material shortages (pure logic)', () => {
  const bom = [
    { materialId: 'm1', materialCode: 'ST12', materialNameFa: 'ورق', unitCode: 'KG', quantityPerUnit: 2, weightKgPerUnit: 2 },
  ];

  it('computes requirement = first-op input × quantity-per-unit and detects shortage', () => {
    const { shortages } = computeMaterialShortages(
      d(168.038),
      bom,
      [{ materialId: 'm1', quantity: 100, ownership: 'OWNED', qualityStatus: 'APPROVED' }],
      [],
    );
    expect(shortages[0]!.requiredQuantity).toBe('336.0760');
    expect(shortages[0]!.severity).toBe('SHORTAGE');
    expect(shortages[0]!.shortageQuantity).toBe('236.0760');
  });

  it('marks shortages covered by open contracts and counts consignment as available', () => {
    const { shortages } = computeMaterialShortages(
      d(100),
      bom,
      [
        { materialId: 'm1', quantity: 80, ownership: 'SUPPLIER_CONSIGNMENT', qualityStatus: 'APPROVED' },
        { materialId: 'm1', quantity: 40, ownership: 'OWNED', qualityStatus: 'APPROVED' },
      ],
      [{ id: 'c1', contractNumber: 'CT-1', materialId: 'm1', totalQuantity: 1000, receivedQuantity: 400, expectedDeliveryDate: iso(7), status: 'PARTIALLY_RECEIVED' }],
    );
    expect(shortages[0]!.availableQuantity).toBe('120.0000');
    expect(shortages[0]!.consignmentQuantity).toBe('80.0000');
    expect(shortages[0]!.severity).toBe('SHORTAGE_COVERED_BY_CONTRACT');
    expect(shortages[0]!.coveredByOpenContracts).toBe('80.0000');
    expect(shortages[0]!.contractInfo[0]!.contractNumber).toBe('CT-1');
  });

  it('reports OK when approved stock covers the requirement', () => {
    const { shortages } = computeMaterialShortages(
      d(30),
      bom,
      [{ materialId: 'm1', quantity: 100, ownership: 'OWNED', qualityStatus: 'APPROVED' }],
      [],
    );
    expect(shortages[0]!.severity).toBe('OK');
    expect(shortages[0]!.shortageQuantity).toBe('0.0000');
  });
});

// ---------------------------------------------------------------------------
// pure logic — time estimation / shift capacity / machine eligibility / ranking
// ---------------------------------------------------------------------------

describe('planning engine — time estimation & capacity (pure logic)', () => {
  it('prefers route-step cycle time over capability rate over operation default', () => {
    const base = { quantity: 120, capabilityRatePerHour: 240, operationDefaultCycleTimeSec: 30, stepSetupTimeMin: null, operationDefaultSetupTimeMin: 10 };
    expect(estimateOperationTime({ ...base, stepCycleTimeSec: 20 }).source).toBe('ROUTE_STEP');
    expect(estimateOperationTime({ ...base, stepCycleTimeSec: 20 }).hours!.toFixed(4)).toBe('0.6667'); // 120×20s
    const cap = estimateOperationTime({ ...base, stepCycleTimeSec: null });
    expect(cap.source).toBe('CAPABILITY');
    expect(cap.hours!.toFixed(4)).toBe('0.5000'); // 120 / 240 per hour
    const def = estimateOperationTime({ ...base, stepCycleTimeSec: null, capabilityRatePerHour: null });
    expect(def.source).toBe('OPERATION_DEFAULT');
    expect(def.hours!.toFixed(4)).toBe('1.0000');
  });

  it('never silently assumes a missing standard time', () => {
    const r = estimateOperationTime({
      quantity: 100,
      stepCycleTimeSec: null,
      capabilityRatePerHour: null,
      operationDefaultCycleTimeSec: null,
      stepSetupTimeMin: null,
      operationDefaultSetupTimeMin: null,
    });
    expect(r.hours).toBeNull();
    expect(r.source).toBe('MISSING');
    expect(r.warnings.length).toBe(2);
    expect(r.setupSource).toBe('NOT_DEFINED');
  });

  it('sums active shift durations (overnight supported)', () => {
    const r = shiftMinutesPerDay([
      { id: 's1', code: 'SH1', nameFa: 'صبح', startTime: '06:00', endTime: '14:00' },
      { id: 's2', code: 'SH2', nameFa: 'عصر', startTime: '14:00', endTime: '22:00' },
      { id: 's3', code: 'SH3', nameFa: 'شب', startTime: '22:00', endTime: '06:00' },
    ]);
    expect(r.minutes).toBe(1440);
  });

  const machine = (over: Partial<MachineDef> & { id: string; code: string }): MachineDef => ({
    nameFa: 'ماشین',
    machineType: 'PRESS',
    tonnage: 200,
    status: 'ACTIVE',
    ...over,
  });
  const ctxBase = (machineDef: MachineDef, over: Record<string, unknown> = {}) => ({
    machine: machineDef,
    operation: { id: 'op1', code: 'BLK', nameFa: 'خالی‌بری', requiresDie: false, defaultSetupTimeMin: 20, defaultCycleTimeSec: null },
    routeStep: { dieId: null, requiredTonnage: null, setupTimeMin: 30, cycleTimeSec: 20, machineId: null },
    capabilityRatePerHour: 240,
    die: null,
    compatibleDieMachineIds: new Set<string>(),
    minutesPerDay: 480,
    workloadMinutes: 0,
    quantity: 100,
    now: new Date('2026-01-01T00:00:00Z'),
    ...over,
  });

  it('marks a machine without operation capability ineligible', () => {
    const c = evaluateMachine(ctxBase(machine({ id: 'm1', code: 'M1' }), { capabilityRatePerHour: null }));
    expect(c.eligible).toBe(false);
    const fail = c.checks.find((x) => x.code === 'CAPABILITY')!;
    expect(fail.pass).toBe(false);
  });

  it('marks a non-ACTIVE machine ineligible', () => {
    const c = evaluateMachine(ctxBase(machine({ id: 'm1', code: 'M1', status: 'MAINTENANCE' })));
    expect(c.eligible).toBe(false);
  });

  it('treats insufficient tonnage as a HARD failure', () => {
    const c = evaluateMachine(ctxBase(machine({ id: 'm1', code: 'M1', tonnage: 63 }), { routeStep: { dieId: null, requiredTonnage: 100, setupTimeMin: 30, cycleTimeSec: 20, machineId: null } }));
    expect(c.eligible).toBe(false);
    expect(c.checks.find((x) => x.code === 'TONNAGE')!.pass).toBe(false);
  });

  it('flags missing tonnage requirement explicitly (no silent assumption)', () => {
    const c = evaluateMachine(ctxBase(machine({ id: 'm1', code: 'M1', tonnage: null })));
    expect(c.eligible).toBe(true);
    expect(c.warningsFa.some((w) => w.includes('تناژ'))).toBe(true);
  });

  it('never assigns a machine incompatible with the die', () => {
    const shared = {
      operation: { id: 'op1', code: 'BLK', nameFa: 'خالی‌بری', requiresDie: true, defaultSetupTimeMin: 20, defaultCycleTimeSec: null },
      routeStep: { dieId: 'die1', requiredTonnage: null, setupTimeMin: 30, cycleTimeSec: 20, machineId: null },
      die: { id: 'die1', code: 'DIE-1', nameFa: 'قالب', status: 'ACTIVE' },
    };
    const ok = evaluateMachine(ctxBase(machine({ id: 'm1', code: 'M1' }), { ...shared, compatibleDieMachineIds: new Set(['m1']) }));
    const bad = evaluateMachine(ctxBase(machine({ id: 'm2', code: 'M2' }), { ...shared, compatibleDieMachineIds: new Set(['m1']) }));
    expect(ok.eligible).toBe(true);
    expect(bad.eligible).toBe(false);
    expect(bad.checks.find((x) => x.code === 'DIE_COMPATIBILITY')!.pass).toBe(false);
  });

  it('rejects operations larger than one day of shift capacity', () => {
    // 500 pcs × 20 s = 166.7 min + 30 min setup = 197 min > 100 min/day
    const c = evaluateMachine(ctxBase(machine({ id: 'm1', code: 'M1' }), { minutesPerDay: 100, quantity: 500 }));
    expect(c.eligible).toBe(false);
    expect(c.checks.find((x) => x.code === 'SHIFT_CAPACITY')!.pass).toBe(false);
  });

  it('ranks eligible candidates by earliest estimated completion and explains itself', () => {
    const mk = (id: string, code: string, workload: number): MachineCandidate =>
      evaluateMachine(ctxBase(machine({ id, code }), { workloadMinutes: workload }));
    const candidates = [mk('m1', 'M-A', 0), mk('m2', 'M-B', 600), mk('m3', 'M-C', 0)];
    const ranked = rankCandidates(candidates, { routeStepMachineId: null });
    const eligible = ranked.filter((c) => c.eligible);
    expect(eligible.length).toBe(3);
    expect(ranked.find((c) => c.machineId === 'm1')!.rank).toBe(1);
    expect(ranked.find((c) => c.machineId === 'm1')!.reasonsFa).toContain('کمترین زمان تکمیل تخمینی');
    // m2 has more workload → later completion → worse rank
    const m1 = ranked.find((c) => c.machineId === 'm1')!;
    const m2 = ranked.find((c) => c.machineId === 'm2')!;
    expect(m1.estimatedEnd!.getTime()).toBeLessThan(m2.estimatedEnd!.getTime());
  });
});

// ---------------------------------------------------------------------------
// planning service — end-to-end against the test database
// ---------------------------------------------------------------------------

describe('planning service (integration)', () => {
  let f: Fixtures;
  let customerId: string;
  let orderAId: string;
  let orderBId: string;
  let lineAId: string;
  let moOps: { id: string; sequence: number }[] = [];
  let moId: string;

  /** Directly seed a StockBalance row (fixture data, not an operational posting). */
  async function seedBalance(dims: {
    partId?: string | null; materialId?: string | null; warehouseId: string;
    unitId: string; quantity: Prisma.Decimal.Value;
    ownership?: 'OWNED' | 'SUPPLIER_CONSIGNMENT'; qualityStatus?: 'PENDING' | 'APPROVED' | 'BLOCKED';
  }) {
    const key = [
      dims.partId ?? '-', dims.materialId ?? '-', dims.warehouseId, '-', '-', dims.unitId,
      dims.ownership ?? 'OWNED', dims.qualityStatus ?? 'APPROVED',
    ].join(':');
    await db.stockBalance.upsert({
      where: { balanceKey: key },
      create: { balanceKey: key, partId: dims.partId ?? null, materialId: dims.materialId ?? null, warehouseId: dims.warehouseId, unitId: dims.unitId, quantity: dims.quantity, weightKg: 0, ownership: dims.ownership ?? 'OWNED', qualityStatus: dims.qualityStatus ?? 'APPROVED' },
      update: { quantity: dims.quantity },
    });
  }

  beforeAll(async () => {
    f = await buildFixtures();
    const customer = await db.customer.create({
      data: { code: uniqueCode('CU'), nameFa: 'مشتری برنامه‌ریزی تست' },
    });
    customerId = customer.id;

    // ---- finished-goods supply: 300 usable + 100 blocked + 50 consignment
    const unitPcs = await db.unitOfMeasure.findUniqueOrThrow({ where: { code: 'PCS' } });
    await seedBalance({ partId: f.partId, warehouseId: f.whOtherId, unitId: unitPcs.id, quantity: 300 });
    await seedBalance({ partId: f.partId, warehouseId: f.whOtherId, unitId: unitPcs.id, quantity: 100, qualityStatus: 'BLOCKED' });
    await seedBalance({ partId: f.partId, warehouseId: f.whOtherId, unitId: unitPcs.id, quantity: 50, ownership: 'SUPPLIER_CONSIGNMENT' });

    // ---- demand: order B (400, due +3d) and order A (500, due +10d, 100 reserved for it)
    const orderA = await createCustomerOrder(
      { customerId, orderDate: iso(0), lines: [{ partId: f.partId, quantity: 500, dueDate: iso(10) }] },
      f.adminId,
      {},
    );
    orderAId = orderA.id;
    lineAId = orderA.lines[0]!.id;
    const orderB = await createCustomerOrder(
      { customerId, orderDate: iso(0), lines: [{ partId: f.partId, quantity: 400, dueDate: iso(3) }] },
      f.adminId,
      {},
    );
    orderBId = orderB.id;

    const unitPcsId = unitPcs.id;
    await db.inventoryReservation.create({
      data: { partId: f.partId, quantity: 100, unitId: unitPcsId, forCustomerOrderLineId: lineAId, status: 'ACTIVE' },
    });
    await db.inventoryReservation.create({
      data: { partId: f.partId, quantity: 999, unitId: unitPcsId, status: 'EXPIRED', expiresAt: new Date(Date.now() - 86_400_000) },
    });

    // ---- BOM: 2 kg of the fixture material per part (stock + open contract exist)
    await db.partMaterialRequirement.create({
      data: { partId: f.partId, materialId: f.materialId, quantityPerUnit: 2, weightKgPerUnit: 2, notes: 'داده آزمون' },
    });
    const unitKg = await db.unitOfMeasure.findUniqueOrThrow({ where: { code: 'KG' } });
    await seedBalance({ materialId: f.materialId, warehouseId: f.warehouseId, unitId: unitKg.id, quantity: 100 });

    // ---- open MO with real WIP: 60 produced at the last op (PNT) and waiting,
    //      140 arrived at the last op awaiting processing
    const { createManufacturingOrder } = await import('../src/modules/production/production.service');
    const mo = await createManufacturingOrder({ partId: f.partId, quantity: 200, routeId: f.routeId, dueDate: iso(5) }, f.adminId, {});
    moId = mo.id;
    moOps = mo.operations.map((o) => ({ id: o.id, sequence: o.sequence }));
    await releaseManufacturingOrder(moId, f.adminId, {});

    const feed = await createProductionTransfer({ partId: f.partId, fromWarehouseId: f.warehouseId, toOperationId: moOps[0]!.id, quantity: 210, transferDate: f.today }, f.adminId, {});
    await postProductionTransfer(feed.id, f.adminId, {});
    const r1 = await createProductionReport({ operationId: moOps[0]!.id, reportDate: f.today, inputQuantity: 210, producedQuantity: 206, scraps: [{ reason: 'SETUP_WASTE', quantity: 4 }] }, f.adminId, {});
    await confirmProductionReport(r1.id, f.adminId, {});
    const t12 = await createProductionTransfer({ partId: f.partId, fromOperationId: moOps[0]!.id, toOperationId: moOps[1]!.id, quantity: 206, transferDate: f.today }, f.adminId, {});
    await postProductionTransfer(t12.id, f.adminId, {});
    const r2 = await createProductionReport({ operationId: moOps[1]!.id, reportDate: f.today, inputQuantity: 206, producedQuantity: 204, scraps: [{ reason: 'SETUP_WASTE', quantity: 2 }] }, f.adminId, {});
    await confirmProductionReport(r2.id, f.adminId, {});
    const t23 = await createProductionTransfer({ partId: f.partId, fromOperationId: moOps[1]!.id, toOperationId: moOps[2]!.id, quantity: 204, transferDate: f.today }, f.adminId, {});
    await postProductionTransfer(t23.id, f.adminId, {});
    const r3 = await createProductionReport({ operationId: moOps[2]!.id, reportDate: f.today, inputQuantity: 64, producedQuantity: 60, scraps: [{ reason: 'SETUP_WASTE', quantity: 4 }] }, f.adminId, {});
    await confirmProductionReport(r3.id, f.adminId, {});
  });

  it('runs the engine and nets demand, stock, reservations, open-MO commitment and WIP', async () => {
    const res = await runPlanning({ partIds: [f.partId] }, f.adminId, {});
    expect(res.status).toBe('DRAFT');
    expect(res.version).toBe(1);
    const plan = await getPlan(res.id);
    const line = plan.lines.find((l) => l.partId === f.partId)!;

    // gross = 500 + 400 = 900 (both orders confirmed and open)
    expect(d(line.grossQuantity!).toFixed(1)).toBe('900.0');
    // stock: only 300 approved+owned count (100 blocked + 50 consignment excluded)
    expect(d(line.coveredByStock!).toFixed(1)).toBe('300.0');
    // reservations: 100 ACTIVE for line A (expired one ignored)
    expect(d(line.coveredByReservations!).toFixed(1)).toBe('100.0');
    // net before MOs = 900 − 300 − 100 = 500
    // WIP at last op: 60 ready + 136 committed (MO 200 − 60 produced − 4 scrap) → 196 FG-equivalent
    expect(d(line.coveredByWip!).toFixed(1)).toBe('60.0');
    expect(d(line.coveredByPlannedMos!).toFixed(1)).toBe('136.0');
    // proposed MO = 500 − 196 = 304
    expect(d(line.plannedQuantity).toFixed(1)).toBe('304.0');

    // WIP chain detail (per operation)
    const detail = line.detail as { wipChain: { operationCode: string; wipUsed: string; committedUsed: string; arrivingUsed: string; mustProduce: string }[] };
    const pnt = detail.wipChain.find((o) => o.operationCode === 'PNT')!;
    expect(d(pnt.wipUsed).toFixed(1)).toBe('60.0');
    expect(d(pnt.committedUsed).toFixed(1)).toBe('136.0');
    expect(d(pnt.arrivingUsed).toFixed(1)).toBe('140.0'); // 204 arrived, 64 fed
    const blank = detail.wipChain.find((o) => o.operationCode === 'BLK')!;
    // PNT must produce 304 → input ceil4(304/0.99) = 307.0708; 140 already arrived → FRM output 167.0708
    // FRM input ceil4(167.0708/0.99) = 168.7584 → BLK output 168.7584 → BLK input ceil4(/0.98) = 172.2025
    expect(d(blank.mustProduce).toFixed(4)).toBe('168.7584');
    expect(d(blank.requiredInput).toFixed(4)).toBe('172.2025');

    // material requirement = 172.2025 × 2 kg = 344.4050 → stock 100 → shortage 244.4050 covered by open contract (1000)
    const shortage = line.materialShortages.find((s) => s.materialId === f.materialId)!;
    expect(shortage.severity).toBe('SHORTAGE_COVERED_BY_CONTRACT');
    expect(d(shortage.requiredQuantity).toFixed(4)).toBe('344.4050');
    expect(d(shortage.shortageQuantity).toFixed(4)).toBe('244.4050');
    expect(d(shortage.coveredByOpenContracts).toFixed(4)).toBe('244.4050');
  });

  it('recommends only machines passing ALL hard constraints and explains each decision', async () => {
    // part 2: one-step BLK route with die DIE-101 (compatible with PRES-102/103 only)
    //         and requiredTonnage 150 → only PRES-103 (160t) passes both
    const part2 = await db.part.create({
      data: { partNumber: uniqueCode('PT'), nameFa: 'قطعه صلاحیت ماشین', partType: 'FINISHED_PART', baseUnitId: (await db.unitOfMeasure.findUniqueOrThrow({ where: { code: 'PCS' } })).id },
    });
    const dieDoor = await db.die.findUniqueOrThrow({ where: { code: 'DIE-101' } });
    const opBlank = await db.operation.findUniqueOrThrow({ where: { code: 'BLK' } });
    const route2 = await db.partRoute.create({ data: { partId: part2.id, version: 1, status: 'ACTIVE', name: 'مسیر تست صلاحیت' } });
    await db.partRouteStep.create({
      data: { routeId: route2.id, sequence: 1, operationId: opBlank.id, dieId: dieDoor.id, requiredTonnage: 150, setupTimeMin: 30, cycleTimeSec: 20, scrapFactorPct: 0 },
    });
    await createCustomerOrder({ customerId, orderDate: iso(0), lines: [{ partId: part2.id, quantity: 50, dueDate: iso(4) }] }, f.adminId, {});

    const res = await runPlanning({ partIds: [part2.id] }, f.adminId, {});
    const plan = await getPlan(res.id);
    const line = plan.lines.find((l) => l.partId === part2.id)!;
    expect(line.feasible).toBe(true);
    expect(d(line.plannedQuantity).toFixed(1)).toBe('50.0');

    const op = line.planOperations.find((o) => o.operation.code === 'BLK')!;
    const candidates = op.candidates as { machineCode: string; eligible: boolean; rank: number | null; checks: { code: string; pass: boolean }[]; reasonsFa: string[] }[];
    const pres103 = candidates.find((c) => c.machineCode === 'PRES-103')!;
    expect(pres103.eligible).toBe(true);
    expect(pres103.rank).toBe(1);

    // tonnage: PRES-101 is 63t < 150t → hard fail
    const pres101 = candidates.find((c) => c.machineCode === 'PRES-101')!;
    expect(pres101.eligible).toBe(false);
    expect(pres101.checks.find((c) => c.code === 'TONNAGE')!.pass).toBe(false);
    // die: PRES-104 is not compatible with DIE-101 → hard fail (never assigned)
    const pres104 = candidates.find((c) => c.machineCode === 'PRES-104')!;
    expect(pres104.eligible).toBe(false);
    expect(pres104.checks.find((c) => c.code === 'DIE_COMPATIBILITY')!.pass).toBe(false);
    expect(op.recommendedMachineCode).toBe('PRES-103');
    // cycle time source = ROUTE_STEP (step cycle 20s present) — a CALCULATED value
    expect(op.timeSource).toBe('ROUTE_STEP');
    expect(Number(op.estimatedHours)).toBeCloseTo((50 * 20) / 3600, 3);
  });

  it('marks lines without an ACTIVE route infeasible with explicit missing info', async () => {
    const part3 = await db.part.create({
      data: { partNumber: uniqueCode('PT'), nameFa: 'قطعه بدون مسیر', partType: 'FINISHED_PART', baseUnitId: (await db.unitOfMeasure.findUniqueOrThrow({ where: { code: 'PCS' } })).id },
    });
    await createCustomerOrder({ customerId, orderDate: iso(0), lines: [{ partId: part3.id, quantity: 10, dueDate: iso(2) }] }, f.adminId, {});
    const res = await runPlanning({ partIds: [part3.id] }, f.adminId, {});
    const plan = await getPlan(res.id);
    const line = plan.lines.find((l) => l.partId === part3.id)!;
    expect(line.feasible).toBe(false);
    const detail = line.detail as { missingInfo: string[] };
    expect(detail.missingInfo.join(' ')).toContain('مسیر تولید ACTIVE');
  });

  it('marks lines with uncovered material shortage infeasible', async () => {
    const unitKg = await db.unitOfMeasure.findUniqueOrThrow({ where: { code: 'KG' } });
    const mat2 = await db.material.create({
      data: { materialCode: uniqueCode('MT'), nameFa: 'ورق بدون موجودی آزمون', materialType: 'SHEET', baseUnitId: unitKg.id, supplierName: 'SAPCO' },
    });
    const part4 = await db.part.create({
      data: { partNumber: uniqueCode('PT'), nameFa: 'قطعه با کسری ماده', partType: 'FINISHED_PART', baseUnitId: (await db.unitOfMeasure.findUniqueOrThrow({ where: { code: 'PCS' } })).id },
    });
    const opForm = await db.operation.findUniqueOrThrow({ where: { code: 'FRM' } });
    const route4 = await db.partRoute.create({ data: { partId: part4.id, version: 1, status: 'ACTIVE', name: 'مسیر تست کسری' } });
    await db.partRouteStep.create({ data: { routeId: route4.id, sequence: 1, operationId: opForm.id, cycleTimeSec: 10, scrapFactorPct: 0 } });
    await db.partMaterialRequirement.create({ data: { partId: part4.id, materialId: mat2.id, quantityPerUnit: 1 } });
    await createCustomerOrder({ customerId, orderDate: iso(0), lines: [{ partId: part4.id, quantity: 100, dueDate: iso(2) }] }, f.adminId, {});

    const res = await runPlanning({ partIds: [part4.id] }, f.adminId, {});
    const plan = await getPlan(res.id);
    const line = plan.lines.find((l) => l.partId === part4.id)!;
    expect(line.feasible).toBe(false);
    expect(line.materialShortages[0]!.severity).toBe('SHORTAGE');
    expect(d(line.materialShortages[0]!.shortageQuantity).comparedTo(0)).toBe(1);
  });

  it('versions plans: a new run supersedes DRAFTs, confirmed plans stay immutable', async () => {
    // current state: several DRAFT plans from previous tests
    const res2 = await runPlanning({}, f.adminId, {});
    expect(res2.version).toBeGreaterThanOrEqual(2);
    const prevDrafts = await db.productionPlan.findMany({ where: { status: 'SUPERSEDED' } });
    expect(prevDrafts.length).toBeGreaterThanOrEqual(1);
    expect(res2.revisionOfId).toBeTruthy();

    await confirmPlan(res2.id, f.adminId, {});
    const confirmed = await db.productionPlan.findUniqueOrThrow({ where: { id: res2.id } });
    expect(confirmed.status).toBe('CONFIRMED');
    expect(confirmed.confirmedAt).toBeTruthy();

    // double-confirm must fail
    await expect(confirmPlan(res2.id, f.adminId, {})).rejects.toMatchObject({ code: 'plan_status' });

    const res3 = await runPlanning({}, f.adminId, {});
    expect(res3.version).toBe(res2.version + 1);
    const stillConfirmed = await db.productionPlan.findUniqueOrThrow({ where: { id: res2.id } });
    expect(stillConfirmed.status).toBe('CONFIRMED');
  });
});

/**
 * KPIMS — Phase 8 tests: MRP utility, reservation ATP (double-allocation
 * guard), MO auto-reserve/release, supplier matrix report and the daily
 * ledger snapshot (mv_daily_ledger).
 *
 * Everything runs against real service functions on the throwaway test
 * database — no mocks, no invented numbers.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  createDocument,
  postDocument,
  createReservation,
  listReservations,
  autoReserveForMo,
} from '../src/modules/inventory/inventory.service';
import { createCustomerOrder } from '../src/modules/planning/planning.service';
import { createManufacturingOrder, cancelManufacturingOrder } from '../src/modules/production/production.service';
import { runMrp, checkMoMaterials } from '../src/modules/mrp/mrp.service';
import { supplierMatrix, refreshLedgerSnapshot, drillDown } from '../src/modules/reports/reports.service';
import { REPORT_KEYS } from '../src/modules/reports/reports.types';
import { db, buildFixtures, ledgerSum, uniqueCode, type Fixtures } from './helpers';

const D = Prisma.Decimal;
const d = (v: Prisma.Decimal.Value | null | undefined) => new D(v ?? 0);

describe('phase 8 — MRP, reservations ATP, supplier matrix, ledger snapshot', () => {
  let f: Fixtures;
  let openingLotId: string;
  let consignmentLotId: string;
  let customerId: string;
  let mo1Id = '';
  let mo2Id = '';
  let mo3Id = '';

  beforeAll(async () => {
    f = await buildFixtures();
    // BOM: 2 kg of the fixture material per piece
    await db.partMaterialRequirement.create({
      data: { partId: f.partId, materialId: f.materialId, quantityPerUnit: 2, weightKgPerUnit: 2 },
    });
    const customer = await db.customer.create({
      data: { code: uniqueCode('CUS'), nameFa: 'مشتری تست فاز ۸', isActive: true },
    });
    customerId = customer.id;

    // 1) opening balance 500 kg (owned, approved)
    const openingLot = uniqueCode('LOT');
    const adj = await createDocument(
      {
        documentType: 'ADJUSTMENT',
        documentDate: f.today,
        warehouseId: f.warehouseId,
        reasonCode: 'OPENING_BALANCE',
        lines: [{ materialId: f.materialId, lotNumber: openingLot, quantity: 500, locationId: f.locationAId }],
      },
      f.adminId,
      {},
    );
    await postDocument(adj.id, f.adminId, {});
    openingLotId = (await db.materialLot.findUniqueOrThrow({ where: { materialId_lotNumber: { materialId: f.materialId, lotNumber: openingLot } } })).id;

    // 2) consignment receipt 200 kg (supplier-owned steel)
    const consignmentLot = uniqueCode('LOT');
    const rcpt = await createDocument(
      {
        documentType: 'RECEIPT',
        documentDate: f.today,
        warehouseId: f.warehouseId,
        lines: [
          {
            materialId: f.materialId,
            lotNumber: consignmentLot,
            quantity: 200,
            ownership: 'SUPPLIER_CONSIGNMENT',
            contractId: f.contractId,
            toLocationId: f.locationAId,
          },
        ],
      },
      f.adminId,
      {},
    );
    await postDocument(rcpt.id, f.adminId, {});
    consignmentLotId = (await db.materialLot.findUniqueOrThrow({ where: { materialId_lotNumber: { materialId: f.materialId, lotNumber: consignmentLot } } })).id;
  });

  // ---------------------------------------------------------------- MRP
  it('MRP with full stock coverage reports no shortage', async () => {
    await createCustomerOrder(
      { customerId, orderDate: f.today, lines: [{ partId: f.partId, quantity: 200, dueDate: f.today }] },
      f.adminId,
      {},
    );
    const result = await runMrp({ partIds: [f.partId] });
    expect(result.scope.parts).toBe(1);
    expect(result.parts[0]!.grossDemand).toBe('200.0000');
    // net requirement 200 pcs → first-op input (2% scrap at op1) → BOM ×2 > 400 kg
    const required = d(result.materials[0]!.requiredQuantity);
    expect(required.comparedTo(400) > 0).toBe(true);
    // stock 500 owned + 200 consignment covers it
    expect(result.materials[0]!.severity).toBe('OK');
    expect(result.summary.hardShortages).toBe(0);
    expect(result.summary.ok).toBe(1);
  });

  it('MRP highlights the shortage after consumption, covered by the open contract', async () => {
    // issue 350 kg to the shop floor → owned stock 150, consignment 200
    const issue = await createDocument(
      {
        documentType: 'ISSUE',
        documentDate: f.today,
        warehouseId: f.warehouseId,
        lines: [{ materialId: f.materialId, lotId: openingLotId, quantity: 350, fromLocationId: f.locationAId }],
      },
      f.adminId,
      {},
    );
    await postDocument(issue.id, f.adminId, {});

    const result = await runMrp({ partIds: [f.partId] });
    const mat = result.materials[0]!;
    expect(mat.severity).toBe('SHORTAGE_COVERED_BY_CONTRACT');
    expect(d(mat.shortageQuantity).comparedTo(0) > 0).toBe(true);
    expect(d(mat.coveredByContract).toFixed(4)).toBe(d(mat.shortageQuantity).toFixed(4));
    expect(mat.onHandOwned).toBe('150.0000');
    expect(mat.onHandConsignment).toBe('200.0000');
    expect(result.summary.contractCovered).toBe(1);
    expect(result.summary.hardShortages).toBe(0);
  });

  // ------------------------------------------------- reservation ATP
  it('rejects reservations beyond available-to-reserve (double allocation guard)', async () => {
    // ATP = 350 (owned 150 + consignment 200), no reservations yet
    await expect(
      createReservation({ materialId: f.materialId, quantity: 400 }, f.adminId),
    ).rejects.toMatchObject({ code: 'reservation_exceeds_available' });

    const ok = await createReservation({ materialId: f.materialId, quantity: 100 }, f.adminId);
    expect(ok.status).toBe('ACTIVE');

    await expect(
      createReservation({ materialId: f.materialId, quantity: 260 }, f.adminId),
    ).rejects.toMatchObject({ code: 'reservation_exceeds_available' });

    // expiry date in the past is rejected up front
    await expect(
      createReservation({ materialId: f.materialId, quantity: 10, expiresAt: new Date(Date.now() - 1000).toISOString() }, f.adminId),
    ).rejects.toMatchObject({ code: 'reservation_expired_date' });
  });

  it('sweeps expired reservations lazily and restores ATP', async () => {
    const res = await createReservation({ materialId: f.materialId, quantity: 40 }, f.adminId);
    // simulate the passage of time
    await db.inventoryReservation.update({
      where: { id: res.id },
      data: { expiresAt: new Date(Date.now() - 86_400_000) },
    });
    const list = await listReservations('ACTIVE');
    expect(list.find((r) => r.id === res.id)).toBeUndefined();
    const expired = await db.inventoryReservation.findUniqueOrThrow({ where: { id: res.id } });
    expect(expired.status).toBe('EXPIRED');
  });

  // ------------------------------------------- MO auto-reserve / release
  it('autoReserveForMo reserves the BOM requirement against real ATP and is idempotent', async () => {
    // ATP now = 350 − 100 (active) = 250; MO needs 50 × 2 = 100
    const mo1 = await createManufacturingOrder({ partId: f.partId, quantity: 50, routeId: f.routeId }, f.adminId, {});
    mo1Id = mo1.id;
    const first = await autoReserveForMo(mo1Id, f.adminId);
    expect(first.shortages).toHaveLength(0);
    expect(first.reserved).toHaveLength(1);
    expect(first.reserved[0]!.created).toBe(true);
    expect(d(first.reserved[0]!.quantity).toFixed(4)).toBe('100.0000');

    // re-run → requirement already covered, nothing new created
    const second = await autoReserveForMo(mo1Id, f.adminId);
    expect(second.reserved[0]!.created).toBe(false);

    // a second MO grabs the rest of the ATP (150 − 100 = 50 → its 50 fits)
    const mo2 = await createManufacturingOrder({ partId: f.partId, quantity: 25, routeId: f.routeId }, f.adminId, {});
    mo2Id = mo2.id;
    const res2 = await autoReserveForMo(mo2Id, f.adminId);
    expect(res2.shortages).toHaveLength(0);
    expect(d(res2.reserved[0]!.quantity).toFixed(4)).toBe('50.0000');

    // a third MO finds less ATP than it needs → reserves what is left and
    // reports the uncovered shortage
    const mo3 = await createManufacturingOrder({ partId: f.partId, quantity: 100, routeId: f.routeId }, f.adminId, {});
    mo3Id = mo3.id;
    const res3 = await autoReserveForMo(mo3Id, f.adminId);
    expect(res3.reserved[0]!.created).toBe(true);
    expect(d(res3.reserved[0]!.quantity).toFixed(4)).toBe('100.0000');
    expect(res3.shortages).toHaveLength(1);
    expect(res3.shortages[0]!.shortage).toBe('100.0000');
  });

  it('cancelling an MO releases its reservations back to ATP', async () => {
    await cancelManufacturingOrder(mo1Id, f.adminId, {});
    const stillActive = await db.inventoryReservation.findMany({
      where: { forManufacturingOrderId: mo1Id, status: 'ACTIVE' },
    });
    expect(stillActive).toHaveLength(0);
  });

  // ------------------------------------------ pre-issue MO material check
  it('checkMoMaterials reports READY for a covered order and SHORTAGE when others hold the stock', async () => {
    const ready = await checkMoMaterials(mo2Id);
    expect(ready.readyToIssue).toBe(true);
    expect(ready.lines[0]!.status).toBe('READY');
    expect(ready.lines[0]!.reservedForThisMo).toBe('50.0000');

    // another actor reserves the last free 100 kg (not linked to mo3)
    await createReservation({ materialId: f.materialId, quantity: 100 }, f.adminId);
    const shortage = await checkMoMaterials(mo3Id);
    expect(shortage.readyToIssue).toBe(false);
    expect(shortage.lines[0]!.status).toBe('SHORTAGE');
    expect(shortage.lines[0]!.shortageQuantity).toBe('100.0000');
    // mo3's own auto-reservation counts as available FOR mo3, never against it
    expect(shortage.lines[0]!.reservedForThisMo).toBe('100.0000');
  });

  // ---------------------------------------- supplier matrix + MV snapshot
  it('materialized daily ledger matches the raw ledger after refresh', async () => {
    const refresh = await refreshLedgerSnapshot(true);
    expect(refresh.refreshed).toBe(true);

    const raw = await ledgerSum({ materialId: f.materialId, warehouseId: f.warehouseId });
    const mv = await db.$queryRaw<{ w: Prisma.Decimal | null }[]>(
      Prisma.sql`SELECT COALESCE(SUM(weight_kg_sum * CASE type WHEN 'ISSUE' THEN -1 WHEN 'TRANSFER_OUT' THEN -1 WHEN 'ADJUSTMENT_OUT' THEN -1 ELSE 1 END), 0) AS w
                 FROM "mv_daily_ledger" WHERE material_key = ${f.materialId}::uuid AND warehouse_id = ${f.warehouseId}::uuid`,
    );
    expect(Number(mv[0]!.w)).toBeCloseTo(raw.weightKg, 4);
  });

  it('supplier matrix (per material) reconciles opening/receipts/consumption/closing with the ledger', async () => {
    const report = await supplierMatrix({ groupBy: 'material', materialId: f.materialId } as never);
    const row = report.rows.find((r) => r.materialId === f.materialId) as Record<string, unknown> | undefined;
    expect(row).toBeDefined();
    expect(row!.openingKg).toBe('0.00'); // everything happened "today", no opening bucket
    expect(row!.ownedReceiptsKg).toBe('0.00');
    expect(row!.consignmentReceiptsKg).toBe('200.00');
    expect(row!.consumptionKg).toBe('350.00');
    expect(row!.adjustmentsKg).toBe('500.00');
    expect(row!.closingKg).toBe('350.00');
    expect(row!.liveOwnedKg).toBe('150.00');
    expect(row!.liveConsignmentKg).toBe('200.00');
    expect(row!.closingMatchesLedger).toBe(true);
  });

  it('supplier matrix (grade × thickness grid) aggregates materials and drills into a cell', async () => {
    const report = await supplierMatrix({ groupBy: undefined, materialId: f.materialId } as never);
    const grid = report.rows.filter((r) => r.grade !== 'جمع کل');
    expect(grid.length).toBeGreaterThanOrEqual(1);
    const row = grid[0] as Record<string, unknown>;
    expect(String(row.grade)).toBe('ST12');
    expect(String(row.thickness)).toBe('0.800');
    expect(Number(row.materialsCount)).toBeGreaterThanOrEqual(1);
    expect(row.closingMatchesLedger).toBe(true);

    const drill = await drillDown('supplier_matrix_row', `${row.grade}|${row.thickness}`, {});
    expect(drill.rows.length).toBeGreaterThanOrEqual(1);
    expect(drill.rows.every((r) => r.materialId && r.closingKg !== undefined)).toBe(true);
  });

  it('report catalog exposes the supplier matrix', () => {
    expect(REPORT_KEYS).toContain('supplier-matrix');
  });
});

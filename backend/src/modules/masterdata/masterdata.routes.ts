import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import { db } from '../../config/db';

export const masterDataRouter = Router();

masterDataRouter.use(authenticate);

/**
 * Read-only lookups for the operational forms (Phase 2/3 UI).
 * Full master-data CRUD arrives with its own phase — this endpoint only
 * exposes compact lists needed to build inventory/production documents.
 */
masterDataRouter.get('/lookups', async (_req, res) => {
  const [parts, materials, warehouses, locations, units, lots, contracts, shifts, machines, customers, routes] =
    await Promise.all([
      db.part.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, partNumber: true, nameFa: true, baseUnitId: true, standardWeightKg: true, partType: true },
        orderBy: { partNumber: 'asc' },
      }),
      db.material.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, materialCode: true, nameFa: true, baseUnitId: true, unitWeightKg: true, supplierName: true, materialType: true },
        orderBy: { materialCode: 'asc' },
      }),
      db.warehouse.findMany({
        where: { isActive: true },
        select: { id: true, code: true, nameFa: true, warehouseType: true },
        orderBy: { code: 'asc' },
      }),
      db.warehouseLocation.findMany({
        where: { isActive: true },
        select: { id: true, warehouseId: true, code: true, nameFa: true },
        orderBy: { code: 'asc' },
      }),
      db.unitOfMeasure.findMany({
        where: { isActive: true },
        select: { id: true, code: true, nameFa: true, kind: true },
        orderBy: { code: 'asc' },
      }),
      db.materialLot.findMany({
        where: { status: { not: 'CLOSED' } },
        select: { id: true, materialId: true, lotNumber: true, quantityRemaining: true, weightRemainingKg: true, ownership: true, status: true },
        orderBy: { receiptDate: 'desc' },
        take: 500,
      }),
      db.materialContract.findMany({
        where: { status: { in: ['OPEN', 'PARTIALLY_RECEIVED'] } },
        select: { id: true, contractNumber: true, materialId: true, supplierName: true, status: true },
        orderBy: { orderDate: 'desc' },
        take: 200,
      }),
      db.shift.findMany({
        where: { isActive: true },
        select: { id: true, code: true, nameFa: true },
        orderBy: { code: 'asc' },
      }),
      db.machine.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, code: true, nameFa: true, machineType: true },
        orderBy: { code: 'asc' },
      }),
      db.customer.findMany({
        where: { isActive: true },
        select: { id: true, code: true, nameFa: true },
        orderBy: { code: 'asc' },
      }),
      db.partRoute.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, partId: true, version: true, name: true },
        orderBy: { version: 'desc' },
      }),
    ]);

  res.json({ parts, materials, warehouses, locations, units, lots, contracts, shifts, machines, customers, routes });
});

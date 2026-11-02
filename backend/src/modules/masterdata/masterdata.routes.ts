import { Router } from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { authenticate, requirePermission } from '../../middleware/auth';
import { db } from '../../config/db';
import { ApiError } from '../../lib/http';
import { RESOURCES, getResource } from './masterdata.resources';
import {
  createResource,
  exportResource,
  getResourceOne,
  importResource,
  listResource,
  removeResource,
  updateResource,
} from './masterdata.controller';
import type { ResourceDef } from './masterdata.resources';

type ResHandler = (req: Request, res: Response, def: ResourceDef) => Promise<void>;

export const masterDataRouter = Router();

masterDataRouter.use(authenticate, requirePermission('masterdata.view'));

/** Wrap async handlers uniformly. */
const h =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next: NextFunction) => {
    fn(req, res).catch(next);
  };

/**
 * Read-only lookups for the operational forms.
 * Compact lists needed to build inventory/production documents.
 */
masterDataRouter.get(
  '/lookups',
  h(async (_req, res) => {
    const [parts, materials, warehouses, locations, units, lots, contracts, shifts, machines, customers, routes, operations, dies] =
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
          where: { status: { in: ['ACTIVE', 'DRAFT'] } },
          select: { id: true, partId: true, version: true, name: true, status: true },
          orderBy: { version: 'desc' },
          take: 500,
        }),
        db.operation.findMany({
          where: { isActive: true },
          select: { id: true, code: true, nameFa: true },
          orderBy: { code: 'asc' },
        }),
        db.die.findMany({
          where: { status: { in: ['ACTIVE', 'MAINTENANCE'] } },
          select: { id: true, code: true, nameFa: true, status: true },
          orderBy: { code: 'asc' },
        }),
      ]);

    res.json({ parts, materials, warehouses, locations, units, lots, contracts, shifts, machines, customers, routes, operations, dies });
  }),
);

/** Metadata for the generic UI (labels, filters, import availability, enum options). */
masterDataRouter.get(
  '/meta',
  h(async (req, res) => {
    const requested = typeof req.query.resource === 'string' ? [req.query.resource] : Object.keys(RESOURCES);
    const resources = requested
      .filter((key) => key in RESOURCES)
      .map((key) => {
        const def = RESOURCES[key]!;
        return {
          key: def.key,
          labelFa: def.labelFa,
          permModule: def.permModule,
          uniqueField: def.uniqueField,
          searchFields: def.searchFields,
          filters: def.filters,
          enumFilters: def.enumFilters ?? {},
          remove: def.remove,
          hasImport: Boolean(def.import),
          importExample: def.import?.example ?? null,
          importHeaders: def.import?.columns.map((c) => c.header) ?? [],
          columns: def.columns.map((c) => c.header),
        };
      });
    res.json({ resources });
  }),
);

// ---- generic resource CRUD (registry-driven) ----
const RESOURCE_KEYS = Object.keys(RESOURCES);

for (const key of RESOURCE_KEYS) {
  const def = getResource(key);
  const router = Router();
  const view = requirePermission(`${def.permModule}.view`);
  const manage = requirePermission(`${def.permModule}.manage`);

  // bind the resource definition per sub-router (closure, not route params —
  // Express 5 recomputes req.params at every matched layer)
  const bound = (fn: ResHandler) => h((req, res) => fn(req, res, def));

  router.get('/', view, bound(listResource));
  router.get('/export', view, bound(exportResource));
  router.post('/import', manage, bound(importResource));
  router.get('/:id', view, bound(getResourceOne));
  router.post('/', manage, bound(createResource));
  router.put('/:id', manage, bound(updateResource));
  router.patch('/:id', manage, bound(updateResource));
  router.delete('/:id', manage, bound(removeResource));

  masterDataRouter.use(`/${key}`, router);
}

masterDataRouter.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'unknown_resource', message: 'منبع درخواستی شناخته‌شده نیست' });
});

/**
 * KPIMS — Phase 5: management reporting routes.
 *
 * All report endpoints are read-only and require the reports.view permission.
 * Add `?format=csv` to any report endpoint to export the same table as an
 * Excel-compatible CSV file (UTF-8 BOM, Jalali generation timestamp included).
 */
import { Router } from 'express';
import { authenticate, requirePermission } from '../../middleware/auth';
import * as ctrl from './reports.controller';

export const reportsRouter = Router();

reportsRouter.use(authenticate, requirePermission('reports.view'));

// report catalog (the 13 management reports)
reportsRouter.get('/', ctrl.reportsCatalog);

// drill-down from summary figures to source documents
reportsRouter.get('/drill-down', ctrl.reportDrillDown);

// one endpoint per report key: /reports/:key?from=&to=&partId=&customerId=&machineId=&operationId=&format=
reportsRouter.get('/:key', ctrl.reportByKey);

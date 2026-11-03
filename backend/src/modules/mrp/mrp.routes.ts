/**
 * KPIMS — Phase 8: MRP routes.
 *
 * GET  /mrp/run            — full MRP calculation over open demand
 * GET  /mrp/mos/:id/check  — pre-issue material check for one MO
 * POST /mrp/mos/:id/reserve — reserve the MO's BOM materials against real ATP
 */
import { Router } from 'express';
import { authenticate, requirePermission } from '../../middleware/auth';
import * as ctrl from './mrp.controller';

export const mrpRouter = Router();

mrpRouter.use(authenticate);

mrpRouter.get('/run', requirePermission('planning.view'), ctrl.mrpRun);
mrpRouter.get('/mos/:id/check', requirePermission('planning.view'), ctrl.moCheck);
mrpRouter.post('/mos/:id/reserve', requirePermission('inventory.manage'), ctrl.moAutoReserve);

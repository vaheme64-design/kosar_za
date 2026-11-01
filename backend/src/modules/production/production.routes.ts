import { Router } from 'express';
import { authenticate, requirePermission } from '../../middleware/auth';
import * as ctrl from './production.controller';

export const productionRouter = Router();
export const wipRouter = Router();

productionRouter.use(authenticate);
wipRouter.use(authenticate);

// ---- manufacturing orders ----
productionRouter.get('/mos', requirePermission('production.view'), ctrl.mosList);
productionRouter.post('/mos', requirePermission('production.manage'), ctrl.mosCreate);
productionRouter.get('/mos/:id', requirePermission('production.view'), ctrl.mosGet);
productionRouter.post('/mos/:id/release', requirePermission('production.post'), ctrl.mosRelease);
productionRouter.post('/mos/:id/complete', requirePermission('production.post'), ctrl.mosComplete);
productionRouter.post('/mos/:id/cancel', requirePermission('production.manage'), ctrl.mosCancel);

// ---- production reports ----
productionRouter.get('/reports', requirePermission('production.view'), ctrl.reportsList);
productionRouter.post('/reports', requirePermission('production.manage'), ctrl.reportsCreate);
productionRouter.post('/reports/:id/confirm', requirePermission('production.post'), ctrl.reportsConfirm);
productionRouter.post('/reports/:id/cancel', requirePermission('production.manage'), ctrl.reportsCancel);

// ---- production transfers ----
productionRouter.get('/transfers', requirePermission('production.view'), ctrl.transfersList);
productionRouter.post('/transfers', requirePermission('production.manage'), ctrl.transfersCreate);
productionRouter.post('/transfers/:id/post', requirePermission('production.post'), ctrl.transfersPost);
productionRouter.post('/transfers/:id/reverse', requirePermission('production.post'), ctrl.transfersReverse);

// ---- WIP ----
wipRouter.get('/dashboard', requirePermission('wip.view'), ctrl.wipDashboard);
wipRouter.get('/reconciliation', requirePermission('wip.view'), ctrl.wipReconciliation);

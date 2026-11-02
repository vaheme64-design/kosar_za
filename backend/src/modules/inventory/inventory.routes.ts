import { Router } from 'express';
import { authenticate, requirePermission } from '../../middleware/auth';
import * as ctrl from './inventory.controller';

export const inventoryRouter = Router();

inventoryRouter.use(authenticate);

// ---- read (view) ----
inventoryRouter.get('/dashboard', requirePermission('inventory.view'), ctrl.dashboard);
inventoryRouter.get('/balances', requirePermission('inventory.view'), ctrl.balances);
inventoryRouter.get('/transactions', requirePermission('inventory.view'), ctrl.ledger);
inventoryRouter.get('/documents', requirePermission('inventory.view'), ctrl.documentsList);
inventoryRouter.get('/documents/:id', requirePermission('inventory.view'), ctrl.documentsGet);
inventoryRouter.get('/reservations', requirePermission('inventory.view'), ctrl.reservationsList);
inventoryRouter.get('/lots', requirePermission('inventory.view'), ctrl.lotsList);
inventoryRouter.get('/lots/summary', requirePermission('inventory.view'), ctrl.lotsSummary);
inventoryRouter.get('/lots/:id/trace', requirePermission('inventory.view'), ctrl.lotTrace);
inventoryRouter.get('/contracts', requirePermission('inventory.view'), ctrl.contractsList);
inventoryRouter.get('/sapco/account', requirePermission('inventory.view'), ctrl.sapcoAccount);

// ---- write (manage) ----
inventoryRouter.post('/documents', requirePermission('inventory.manage'), ctrl.documentsCreate);
inventoryRouter.post('/reservations', requirePermission('inventory.manage'), ctrl.reservationsCreate);
inventoryRouter.post('/reservations/:id/release', requirePermission('inventory.manage'), ctrl.reservationsRelease);
inventoryRouter.post('/contracts', requirePermission('inventory.manage'), ctrl.contractsCreate);
inventoryRouter.post('/quality/release', requirePermission('inventory.manage'), ctrl.qualityRelease);

// ---- posting (post) — state-changing accounting actions ----
inventoryRouter.post('/documents/:id/post', requirePermission('inventory.post'), ctrl.documentsPost);
inventoryRouter.post('/documents/:id/reverse', requirePermission('inventory.post'), ctrl.documentsReverse);
inventoryRouter.post('/documents/:id/cancel', requirePermission('inventory.manage'), ctrl.documentsCancel);

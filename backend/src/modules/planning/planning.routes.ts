/**
 * KPIMS — Phase 4: production planning routes.
 *
 * Planning suggestions stay SEPARATE from production transactions:
 * running the engine only creates a DRAFT plan proposal; users must
 * explicitly confirm it (and MOs are still created by hand afterwards).
 */
import { Router } from 'express';
import { authenticate, requirePermission } from '../../middleware/auth';
import * as ctrl from './planning.controller';

export const planningRouter = Router();

planningRouter.use(authenticate);

// ---- dashboard ----
planningRouter.get('/dashboard', requirePermission('planning.view'), ctrl.planningDashboard);

// ---- customer orders (planning input) ----
planningRouter.get('/customer-orders', requirePermission('planning.view'), ctrl.ordersList);
planningRouter.post('/customer-orders', requirePermission('planning.manage'), ctrl.ordersCreate);

// ---- engine + plans ----
planningRouter.post('/run', requirePermission('planning.manage'), ctrl.planningRun);
planningRouter.get('/plans', requirePermission('planning.view'), ctrl.plansList);
planningRouter.get('/plans/:id', requirePermission('planning.view'), ctrl.plansGet);
planningRouter.post('/plans/:id/confirm', requirePermission('planning.post'), ctrl.plansConfirm);
planningRouter.post('/plans/:id/cancel', requirePermission('planning.manage'), ctrl.plansCancel);

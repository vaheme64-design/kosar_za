import { Router } from 'express';
import { authRouter } from '../modules/auth/auth.routes';
import { healthRouter } from '../modules/health/health.routes';
import { dashboardRouter } from '../modules/dashboard/dashboard.routes';
import { inventoryRouter } from '../modules/inventory/inventory.routes';
import { productionRouter, wipRouter } from '../modules/production/production.routes';
import { planningRouter } from '../modules/planning/planning.routes';
import { reportsRouter } from '../modules/reports/reports.routes';
import { masterDataRouter } from '../modules/masterdata/masterdata.routes';
import { machinesRouter } from '../modules/machines/machines.routes';
import { settingsRouter } from '../modules/settings/settings.routes';
import { searchRouter } from '../modules/search/search.routes';
import { aiRouter } from '../modules/ai/ai.routes';
import { authenticate } from '../middleware/auth';
import { MODULES } from '../config/modules';

export const apiRouter = Router();

// ---- public ----
apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);

// ---- authenticated ----
apiRouter.use('/dashboard', dashboardRouter);
apiRouter.use('/inventory', inventoryRouter);
apiRouter.use('/production', productionRouter);
apiRouter.use('/wip', wipRouter);
apiRouter.use('/planning', planningRouter);
apiRouter.use('/reports', reportsRouter);

apiRouter.use('/master-data', masterDataRouter);
apiRouter.use('/machines', machinesRouter);
apiRouter.use('/settings', settingsRouter);
apiRouter.use('/search', searchRouter);
apiRouter.use('/ai', aiRouter);

apiRouter.get('/meta/modules', authenticate, (_req, res) => {
  res.json({ modules: MODULES });
});



import { Router } from 'express';
import { authRouter } from '../modules/auth/auth.routes';
import { healthRouter } from '../modules/health/health.routes';
import { dashboardRouter } from '../modules/dashboard/dashboard.routes';
import { inventoryRouter } from '../modules/inventory/inventory.routes';
import { productionRouter, wipRouter } from '../modules/production/production.routes';
import { planningRouter } from '../modules/planning/planning.routes';
import { reportsRouter } from '../modules/reports/reports.routes';
import { masterDataRouter } from '../modules/masterdata/masterdata.routes';
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

// read-only lookups (master-data CRUD arrives in its own phase)
apiRouter.use('/master-data', masterDataRouter);

apiRouter.get('/meta/modules', authenticate, (_req, res) => {
  res.json({ modules: MODULES });
});

// ---- planned modules (later phases): explicit, documented 501 stubs ----
// machines, settings still have their Phase-1 database schema but no
// business services yet (reports arrived in Phase 5).
const plannedModules = MODULES.filter((m) => m.status === 'planned' && m.key !== 'master-data');
for (const module of plannedModules) {
  const stub = Router();
  stub.use((req, res) => {
    res.status(501).json({
      error: 'not_implemented',
      module: module.key,
      message: `Module "${module.key}" (${module.titleEn}) is planned for a future phase`,
      messageFa: `ماژول «${module.titleFa}» در فازهای بعدی پیاده‌سازی می‌شود؛ طرح دیتابیس آن آماده است.`,
      method: req.method,
    });
  });
  apiRouter.use(`/${module.key}`, authenticate, stub);
}

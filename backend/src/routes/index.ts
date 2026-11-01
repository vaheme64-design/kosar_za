import { Router } from 'express';
import { authRouter } from '../modules/auth/auth.routes';
import { healthRouter } from '../modules/health/health.routes';
import { dashboardRouter } from '../modules/dashboard/dashboard.routes';
import { authenticate } from '../middleware/auth';
import { MODULES } from '../config/modules';

export const apiRouter = Router();

// ---- public ----
apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);

// ---- authenticated ----
apiRouter.use('/dashboard', dashboardRouter);

apiRouter.get('/meta/modules', authenticate, (_req, res) => {
  res.json({ modules: MODULES });
});

// ---- planned modules (Phase 2+): explicit, documented 501 stubs ----
// The database schema for these domains already exists (Phase 1);
// business services and endpoints arrive with their own phases.
const plannedModules = MODULES.filter((m) => m.status === 'planned');
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

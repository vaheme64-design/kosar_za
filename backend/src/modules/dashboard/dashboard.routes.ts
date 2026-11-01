import { Router } from 'express';
import { db } from '../../config/db';
import { authenticate, requirePermission } from '../../middleware/auth';
import { toJalaliDateString } from '../../lib/jalali';

export const dashboardRouter = Router();

dashboardRouter.use(authenticate, requirePermission('dashboard.view'));

/** Live counters from the database — proves real persistence end-to-end. */
dashboardRouter.get('/summary', async (_req, res) => {
  const [activeParts, activeMachines, warehouses, operations, customers, activeUsers, units] =
    await Promise.all([
      db.part.count({ where: { status: 'ACTIVE' } }),
      db.machine.count({ where: { status: 'ACTIVE' } }),
      db.warehouse.count({ where: { isActive: true } }),
      db.operation.count({ where: { isActive: true } }),
      db.customer.count({ where: { isActive: true } }),
      db.user.count({ where: { isActive: true } }),
      db.unitOfMeasure.count(),
    ]);

  res.json({
    stats: {
      activeParts,
      activeMachines,
      warehouses,
      operations,
      customers,
      activeUsers,
      units,
    },
    jalaliToday: toJalaliDateString(new Date()),
    jalaliTodayFa: toJalaliDateString(new Date(), true),
    generatedAt: new Date().toISOString(),
  });
});

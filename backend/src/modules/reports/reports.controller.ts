/**
 * KPIMS — Phase 5: management reports controller.
 * GET endpoints only — reports are read-only by design.
 */
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { ApiError } from '../../lib/http';
import { reportToCsv } from './reports.helpers';
import { REPORT_CATALOG, type ReportTable } from './reports.types';
import { reportFiltersSchema, drillDownSchema, type ReportFilters } from './reports.schemas';
import {
  backlog,
  coilInventory,
  drillDown,
  inventoryMovements,
  inventoryReconciliation,
  inventoryValuation,
  lotConsumption,
  machineWorkload,
  materialConsumption,
  orderFulfillment,
  planVsActual,
  productionDelays,
  sapcoAccount,
  scrapReport,
  wipAging,
  wipByPartOperation,
} from './reports.service';

type ReportFn = (f: ReportFilters) => Promise<ReportTable>;

const REPORTS: Record<string, ReportFn> = {
  'plan-vs-actual': planVsActual,
  'order-fulfillment': orderFulfillment,
  backlog,
  'wip-by-part-operation': wipByPartOperation,
  'wip-aging': wipAging,
  'material-consumption': materialConsumption,
  'sapco-account': sapcoAccount,
  'inventory-valuation': inventoryValuation,
  scrap: scrapReport,
  'machine-workload': machineWorkload,
  'production-delays': productionDelays,
  'inventory-movements': inventoryMovements,
  'inventory-reconciliation': inventoryReconciliation,
  'coil-inventory': coilInventory,
  'lot-consumption': lotConsumption,
};

/** Safe route-param/query parsing — empty query strings are dropped. */
function filters(req: Request): ReportFilters {
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(req.query)) {
    if (v !== '' && v !== undefined) cleaned[k] = v;
  }
  return reportFiltersSchema.parse(cleaned);
}

export function reportsCatalog(_req: Request, res: Response): void {
  res.json({ reports: REPORT_CATALOG, generatedAt: new Date().toISOString() });
}

export async function reportByKey(req: Request, res: Response): Promise<void> {
  const key = req.params.key;
  if (typeof key !== 'string' || key === '') {
    throw new ApiError(400, 'Missing report key', 'کلید گزارش نامعتبر است', 'bad_param');
  }
  const fn = REPORTS[key];
  if (!fn) throw new ApiError(404, `Unknown report: ${key}`, 'گزارش درخواستی یافت نشد', 'report_not_found');

  const { format, ...businessFilters } = filters(req);
  const report = await fn(businessFilters as ReportFilters);

  if (format === 'csv') {
    const csv = reportToCsv(report);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${key}-${report.meta.generatedAt.slice(0, 10)}.csv"`);
    res.setHeader('X-Report-Generated-At', report.meta.generatedAt);
    res.status(200).send(csv);
    return;
  }

  res.json(report);
}

/** Executed by the AI report-query endpoint (whitelisted key + zod-validated filters). */
export async function runReportByKey(key: string, filters: ReportFilters): Promise<ReportTable> {
  const fn = REPORTS[key];
  if (!fn) throw new ApiError(404, `Unknown report: ${key}`, 'گزارش درخواستی یافت نشد', 'report_not_found');
  return fn(filters);
}

export async function reportDrillDown(req: Request, res: Response): Promise<void> {
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(req.query)) {
    if (v !== '' && v !== undefined) cleaned[k] = v;
  }
  const q = drillDownSchema.parse(cleaned) as z.infer<typeof drillDownSchema>;
  res.json(await drillDown(q.kind, q.id, { from: q.from, to: q.to }));
}

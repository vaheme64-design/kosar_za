import type { Request, Response } from 'express';
import type { z } from 'zod';
import { ApiError } from '../../lib/http';
import {
  createManufacturingOrder,
  listManufacturingOrders,
  getManufacturingOrder,
  releaseManufacturingOrder,
  cancelManufacturingOrder,
  completeManufacturingOrder,
  createProductionReport,
  confirmProductionReport,
  cancelProductionReport,
  listProductionReports,
  createProductionTransfer,
  postProductionTransfer,
  reverseProductionTransfer,
  listProductionTransfers,
  getWipDashboard,
  getWipReconciliation,
} from './production.service';
import {
  createMoSchema,
  createReportSchema,
  createTransferSchema,
  moFilterSchema,
  reportFilterSchema,
  transferFilterSchema,
} from './production.schemas';

function meta(req: Request) {
  return { ip: req.ip, ua: req.headers['user-agent']?.slice(0, 500) };
}

function userId(req: Request): string {
  if (!req.user) throw new ApiError(401, 'Unauthenticated', 'ابتدا وارد سامانه شوید', 'unauthorized');
  return req.user.id;
}

/** Safe route-param accessor (Express 5 + noUncheckedIndexedAccess). */
function param(req: Request, name: string): string {
  const v = req.params[name];
  if (typeof v !== 'string' || v === '') {
    throw new ApiError(400, `Missing path parameter: ${name}`, 'پارامتر مسیر نامعتبر است', 'bad_param');
  }
  return v;
}

function query<T extends z.ZodTypeAny>(schema: T, req: Request): z.infer<T> {
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(req.query)) {
    if (v !== '' && v !== undefined) cleaned[k] = v;
  }
  return schema.parse(cleaned) as z.infer<T>;
}

// ---- manufacturing orders ----
export async function mosList(req: Request, res: Response) {
  const f = query(moFilterSchema, req);
  const rows = await listManufacturingOrders(f);
  res.json({ manufacturingOrders: rows, count: rows.length });
}

export async function mosCreate(req: Request, res: Response) {
  const parsed = createMoSchema.parse(req.body);
  const mo = await createManufacturingOrder(parsed, userId(req), meta(req));
  res.status(201).json({ manufacturingOrder: mo });
}

export async function mosGet(req: Request, res: Response) {
  res.json({ manufacturingOrder: await getManufacturingOrder(param(req, "id")) });
}

export async function mosRelease(req: Request, res: Response) {
  res.json({ manufacturingOrder: await releaseManufacturingOrder(param(req, "id"), userId(req), meta(req)) });
}

export async function mosComplete(req: Request, res: Response) {
  res.json({ manufacturingOrder: await completeManufacturingOrder(param(req, "id"), userId(req), meta(req)) });
}

export async function mosCancel(req: Request, res: Response) {
  res.json({ manufacturingOrder: await cancelManufacturingOrder(param(req, "id"), userId(req), meta(req)) });
}

// ---- production reports ----
export async function reportsList(req: Request, res: Response) {
  const f = query(reportFilterSchema, req);
  const rows = await listProductionReports(f);
  res.json({ reports: rows, count: rows.length });
}

export async function reportsCreate(req: Request, res: Response) {
  const parsed = createReportSchema.parse(req.body);
  const report = await createProductionReport(parsed, userId(req), meta(req));
  res.status(201).json({ report });
}

export async function reportsConfirm(req: Request, res: Response) {
  const report = await confirmProductionReport(param(req, "id"), userId(req), meta(req));
  res.json({ report });
}

export async function reportsCancel(req: Request, res: Response) {
  const report = await cancelProductionReport(param(req, "id"), userId(req), meta(req));
  res.json({ report });
}

// ---- production transfers ----
export async function transfersList(req: Request, res: Response) {
  const f = query(transferFilterSchema, req);
  const rows = await listProductionTransfers(f);
  res.json({ transfers: rows, count: rows.length });
}

export async function transfersCreate(req: Request, res: Response) {
  const parsed = createTransferSchema.parse(req.body);
  const transfer = await createProductionTransfer(parsed, userId(req), meta(req));
  res.status(201).json({ transfer });
}

export async function transfersPost(req: Request, res: Response) {
  const transfer = await postProductionTransfer(param(req, "id"), userId(req), meta(req));
  res.json({ transfer });
}

export async function transfersReverse(req: Request, res: Response) {
  const transfer = await reverseProductionTransfer(param(req, "id"), userId(req), meta(req));
  res.json({ transfer });
}

// ---- WIP ----
export async function wipDashboard(_req: Request, res: Response) {
  res.json(await getWipDashboard());
}

export async function wipReconciliation(req: Request, res: Response) {
  const partId = typeof req.query.partId === 'string' && req.query.partId !== '' ? req.query.partId : undefined;
  res.json({ reconciliation: await getWipReconciliation(partId) });
}

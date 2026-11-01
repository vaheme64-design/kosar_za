/**
 * KPIMS — Phase 4: planning module HTTP controller.
 */
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { ApiError } from '../../lib/http';
import {
  runPlanning,
  createCustomerOrder,
  listCustomerOrders,
  listPlans,
  getPlan,
  confirmPlan,
  cancelPlan,
  getPlanningDashboard,
} from './planning.service';
import {
  runPlanningSchema,
  createCustomerOrderSchema,
  listOrdersSchema,
  planningFilterSchema,
  type PlanningFilters,
} from './planning.schemas';

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

// ---- dashboard ----
export async function planningDashboard(req: Request, res: Response) {
  const f = query(planningFilterSchema, req);
  const filters: PlanningFilters = {
    partIds: f.partIds ? f.partIds.split(',').filter(Boolean) : undefined,
    dueFrom: f.dueFrom,
    dueTo: f.dueTo,
  };
  res.json(await getPlanningDashboard(filters));
}

// ---- customer orders (planning input) ----
export async function ordersList(req: Request, res: Response) {
  const f = query(listOrdersSchema, req);
  const rows = await listCustomerOrders({ openOnly: f.openOnly, take: f.take });
  res.json({ customerOrders: rows, count: rows.length });
}

export async function ordersCreate(req: Request, res: Response) {
  const parsed = createCustomerOrderSchema.parse(req.body);
  const order = await createCustomerOrder(parsed, userId(req), meta(req));
  res.status(201).json({ customerOrder: order });
}

// ---- planning engine ----
export async function planningRun(req: Request, res: Response) {
  const parsed = runPlanningSchema.parse(req.body);
  const plan = await runPlanning(parsed, userId(req), meta(req));
  res.status(201).json({ plan: { id: plan.id, planNumber: plan.planNumber, version: plan.version, status: plan.status, summary: plan.summary } });
}

// ---- plans ----
export async function plansList(_req: Request, res: Response) {
  const rows = await listPlans();
  res.json({ plans: rows, count: rows.length });
}

export async function plansGet(req: Request, res: Response) {
  res.json({ plan: await getPlan(param(req, 'id')) });
}

export async function plansConfirm(req: Request, res: Response) {
  res.json({ plan: await confirmPlan(param(req, 'id'), userId(req), meta(req)) });
}

export async function plansCancel(req: Request, res: Response) {
  res.json({ plan: await cancelPlan(param(req, 'id'), userId(req), meta(req)) });
}

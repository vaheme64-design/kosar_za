/**
 * KPIMS — Phase 8: MRP controller (read-only calculator + pre-issue gate).
 */
import type { Request, Response } from 'express';
import { z } from 'zod';
import { runMrp, checkMoMaterials, runAndStoreMrp, getLatestMrpSnapshot } from './mrp.service';
import { autoReserveForMo } from '../inventory/inventory.service';

const runMrpQuerySchema = z.object({
  partIds: z
    .string()
    .optional()
    .transform((v) => (v ? (v.split(',').filter(Boolean) as string[]) : undefined)),
  orderIds: z
    .string()
    .optional()
    .transform((v) => (v ? (v.split(',').filter(Boolean) as string[]) : undefined)),
});

function userId(req: Request): string {
  return req.user?.id ?? '';
}

/** Safe route-param accessor (Express 5 params can be arrays). */
function param(req: Request, name: string): string | null {
  const v = req.params[name];
  return typeof v === 'string' && v !== '' ? v : null;
}

function badParam(res: Response, messageFa = 'شناسه نامعتبر است'): void {
  res.status(400).json({ error: 'bad_param', message: 'Invalid id', messageFa });
}

export async function mrpRun(req: Request, res: Response) {
  const f = runMrpQuerySchema.parse(req.query);
  // validate uuid segments explicitly (query strings are untrusted)
  for (const id of [...(f.partIds ?? []), ...(f.orderIds ?? [])]) {
    if (!z.string().uuid().safeParse(id).success) {
      badParam(res, 'شناسه نامعتبر است');
      return;
    }
  }
  res.json(await runMrp({ partIds: f.partIds, orderIds: f.orderIds }));
}

/** Phase 8 (scheduler) — newest stored MRP snapshot for the MRP page. */
export async function mrpLatest(_req: Request, res: Response) {
  res.json({ snapshot: await getLatestMrpSnapshot() });
}

/**
 * Phase 8 (scheduler) — run the MRP calculation and store the snapshot
 * (audited). Manual runs land in the same store the scheduler uses.
 */
export async function mrpRunNow(req: Request, res: Response) {
  const user = req.user;
  res.status(201).json(await runAndStoreMrp(user?.id ?? 'MANUAL'));
}

export async function moCheck(req: Request, res: Response) {
  const id = param(req, 'id');
  if (!id || !z.string().uuid().safeParse(id).success) {
    badParam(res);
    return;
  }
  res.json(await checkMoMaterials(id));
}

export async function moAutoReserve(req: Request, res: Response) {
  const id = param(req, 'id');
  if (!id || !z.string().uuid().safeParse(id).success) {
    badParam(res);
    return;
  }
  res.status(201).json(await autoReserveForMo(id, userId(req)));
}

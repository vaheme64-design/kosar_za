import type { Request, Response } from 'express';
import type { z } from 'zod';
import { ApiError } from '../../lib/http';
import {
  createDocument,
  getDocument,
  listDocuments,
  cancelDocument,
  postDocument,
  reverseDocument,
  createReservation,
  releaseReservation,
  listReservations,
  getBalances,
  getReservedSummary,
  getLedger,
  getSapcoAccount,
  listContracts,
  createContract,
  listLots,
  releaseQuality,
  getInventoryDashboard,
} from './inventory.service';
import {
  balanceFilterSchema,
  createContractSchema,
  createDocumentSchema,
  createReservationSchema,
  ledgerFilterSchema,
  qualityReleaseSchema,
  reverseDocumentSchema,
  sapcoAccountQuerySchema,
} from './inventory.schemas';

function meta(req: Request) {
  return {
    ip: req.ip,
    ua: req.headers['user-agent']?.slice(0, 500),
  };
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

/** Parse query params with a zod object (ignoring empty strings). */
function query<T extends z.ZodTypeAny>(schema: T, req: Request): z.infer<T> {
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(req.query)) {
    if (v !== '' && v !== undefined) cleaned[k] = v;
  }
  return schema.parse(cleaned) as z.infer<T>;
}

export async function dashboard(_req: Request, res: Response) {
  res.json(await getInventoryDashboard());
}

export async function balances(req: Request, res: Response) {
  const f = query(balanceFilterSchema, req);
  const rows = await getBalances(f);
  const reserved = await getReservedSummary();
  // warehouse-level reserved figure per item+unit (never per location row)
  const reservedKey = (partId: string | null, materialId: string | null, warehouseId: string | null, unitCode: string) =>
    `${partId ?? '-'}|${materialId ?? '-'}|${warehouseId ?? '*'}|${unitCode}`;
  const reservedMap = new Map<string, number>();
  for (const r of reserved) {
    reservedMap.set(reservedKey(r.partId, r.materialId, r.warehouseId, r.unitCode), Number(r.quantity));
  }
  const balances = rows.map((r) => {
    const reservedForItem =
      (reservedMap.get(reservedKey(r.partId, r.materialId, r.warehouseId, r.unitCode)) ?? 0) +
      (reservedMap.get(reservedKey(r.partId, r.materialId, null, r.unitCode)) ?? 0);
    const physical = Number(r.quantity);
    const blocked = r.qualityStatus === 'APPROVED' ? 0 : physical;
    const available = Math.max(0, physical - (r.qualityStatus === 'APPROVED' ? reservedForItem : 0));
    return {
      ...r,
      reservedQuantity: reservedForItem.toFixed(4),
      blockedQuantity: blocked.toFixed(4),
      availableQuantity: available.toFixed(4),
    };
  });
  res.json({ balances, reservedSummary: reserved, count: balances.length });
}

export async function ledger(req: Request, res: Response) {
  const f = query(ledgerFilterSchema, req);
  const rows = await getLedger(f);
  res.json({ transactions: rows, count: rows.length });
}

export async function documentsList(req: Request, res: Response) {
  const rows = await listDocuments({
    documentType: typeof req.query.documentType === 'string' ? req.query.documentType : undefined,
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
    postingStatus: typeof req.query.postingStatus === 'string' ? req.query.postingStatus : undefined,
    take: typeof req.query.take === 'string' ? Number(req.query.take) : undefined,
  });
  res.json({ documents: rows, count: rows.length });
}

export async function documentsCreate(req: Request, res: Response) {
  const parsed = createDocumentSchema.parse(req.body);
  const doc = await createDocument(parsed, userId(req), meta(req));
  res.status(201).json({ document: doc });
}

export async function documentsGet(req: Request, res: Response) {
  res.json({ document: await getDocument(param(req, "id")) });
}

export async function documentsPost(req: Request, res: Response) {
  const doc = await postDocument(param(req, "id"), userId(req), meta(req));
  res.json({ document: doc });
}

export async function documentsReverse(req: Request, res: Response) {
  const { reason } = reverseDocumentSchema.parse(req.body ?? {});
  const doc = await reverseDocument(param(req, "id"), userId(req), reason, meta(req));
  res.json({ document: doc });
}

export async function documentsCancel(req: Request, res: Response) {
  const doc = await cancelDocument(param(req, "id"), userId(req), meta(req));
  res.json({ document: doc });
}

export async function reservationsList(req: Request, res: Response) {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  res.json({ reservations: await listReservations(status) });
}

export async function reservationsCreate(req: Request, res: Response) {
  const parsed = createReservationSchema.parse(req.body);
  const reservation = await createReservation(parsed, userId(req));
  res.status(201).json({ reservation });
}

export async function reservationsRelease(req: Request, res: Response) {
  const reservation = await releaseReservation(param(req, "id"), userId(req));
  res.json({ reservation });
}

export async function lotsList(req: Request, res: Response) {
  const materialId = typeof req.query.materialId === 'string' ? req.query.materialId : undefined;
  res.json({ lots: await listLots(materialId) });
}

export async function contractsList(_req: Request, res: Response) {
  res.json({ contracts: await listContracts() });
}

export async function contractsCreate(req: Request, res: Response) {
  const parsed = createContractSchema.parse(req.body);
  const contract = await createContract(parsed, userId(req));
  res.status(201).json({ contract });
}

export async function sapcoAccount(req: Request, res: Response) {
  const f = query(sapcoAccountQuerySchema, req);
  res.json({ account: await getSapcoAccount(f), generatedAt: new Date().toISOString() });
}

export async function qualityRelease(req: Request, res: Response) {
  const parsed = qualityReleaseSchema.parse(req.body);
  const doc = await releaseQuality(parsed, userId(req), meta(req));
  res.status(201).json({ document: doc });
}

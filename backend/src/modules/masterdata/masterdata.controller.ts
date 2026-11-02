import type { Request, Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from '../../config/db';
import { ApiError } from '../../lib/http';
import { recordAudit } from '../../lib/audit';
import { MD_ENUMS, type ImportColumn, type ResourceDef } from './masterdata.resources';

/* eslint-disable @typescript-eslint/no-explicit-any */

const MAX_PAGE_SIZE = 500;
const DEFAULT_PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// query helpers
// ---------------------------------------------------------------------------

function buildWhere(def: ResourceDef, query: Record<string, unknown>): Record<string, unknown> {
  const where: Record<string, unknown> = {};

  const q = typeof query.q === 'string' ? query.q.trim() : '';
  if (q.length > 0) {
    const clauses: Record<string, unknown>[] = def.searchFields.map((f) => ({
      [f]: { contains: q, mode: 'insensitive' as const },
    }));
    for (const [relation, fields] of Object.entries(def.searchRelations ?? {})) {
      for (const f of fields) {
        clauses.push({ [relation]: { [f]: { contains: q, mode: 'insensitive' as const } } });
      }
    }
    where.OR = clauses;
  }

  for (const field of def.filters) {
    const value = query[field];
    if (typeof value === 'string' && value.length > 0) {
      where[field] = value;
    }
  }

  for (const [field, allowed] of Object.entries(def.enumFilters ?? {})) {
    const value = query[field];
    if (typeof value === 'string' && value.length > 0) {
      if (!(allowed as readonly string[]).includes(value)) {
        throw new ApiError(400, `invalid filter value: ${field}`, `مقدار فیلتر «${field}» نامعتبر است`);
      }
      where[field] = value;
    }
  }

  return where;
}

function parsePagination(query: Record<string, unknown>): { skip: number; take: number; page: number; pageSize: number } {
  const page = Math.max(1, Number.parseInt(String(query.page ?? '1'), 10) || 1);
  let pageSize = Number.parseInt(String(query.pageSize ?? String(DEFAULT_PAGE_SIZE)), 10) || DEFAULT_PAGE_SIZE;
  if (pageSize < 1) pageSize = DEFAULT_PAGE_SIZE;
  if (pageSize > MAX_PAGE_SIZE) pageSize = MAX_PAGE_SIZE;
  return { skip: (page - 1) * pageSize, take: pageSize, page, pageSize };
}

const delegate = (def: ResourceDef): any => (db as any)[def.model];

async function audit(req: Request, action: string, def: ResourceDef, entityId: string | null, changes?: unknown): Promise<void> {
  await recordAudit(null, {
    userId: req.user?.id ?? null,
    action,
    entityType: def.key,
    entityId,
    changes: changes as object,
    ipAddress: req.ip ?? null,
    userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
  });
}

function friendlyUniqueError(def: ResourceDef, fallbackFa: string): ApiError {
  const fa: Record<string, string> = {
    parts: 'شماره قطعه تکراری است',
    materials: 'کد ماده تکراری است',
    units: 'کد واحد تکراری است',
    operations: 'کد عملیات تکراری است',
    warehouses: 'کد انبار تکراری است',
    'warehouse-locations': 'کد موقعیت در این انبار تکراری است',
    shifts: 'کد شیفت تکراری است',
    customers: 'کد مشتری تکراری است',
    machines: 'کد ماشین تکراری است',
    dies: 'کد قالب تکراری است',
    bom: 'برای این قطعه سرانهٔ مصرف این ماده قبلاً ثبت شده است',
  };
  return new ApiError(409, `duplicate ${def.uniqueField}`, fa[def.key] ?? fallbackFa);
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function listResource(req: Request, res: Response, def: ResourceDef): Promise<void> {
  const where = buildWhere(def, req.query as Record<string, unknown>);
  const { skip, take, page, pageSize } = parsePagination(req.query as Record<string, unknown>);

  const [rows, total] = await Promise.all([
    delegate(def).findMany({ where, include: def.include, orderBy: def.orderBy, skip, take }),
    delegate(def).count({ where }),
  ]);

  res.json({ rows, total, page, pageSize });
}

export async function getResourceOne(req: Request, res: Response, def: ResourceDef): Promise<void> {
  const row = await delegate(def).findUnique({ where: { id: String(req.params.id) }, include: def.include });
  if (!row) throw new ApiError(404, 'not found', `${def.labelFa} یافت نشد`);
  res.json({ row });
}

export async function createResource(req: Request, res: Response, def: ResourceDef): Promise<void> {
  const data = def.create.parse(req.body ?? {});

  try {
    let row: any;
    if (def.key === 'routes') {
      row = await createRouteWithSteps(data);
    } else {
      row = await delegate(def).create({ data });
      if (def.include) {
        row = await delegate(def).findUniqueOrThrow({ where: { id: row.id }, include: def.include });
      }
    }
    await audit(req, 'CREATE', def, row.id, { after: data });
    res.status(201).json({ row });
  } catch (err) {
    throw translatePrismaError(err, def);
  }
}

export async function updateResource(req: Request, res: Response, def: ResourceDef): Promise<void> {
  const data = def.update.parse(req.body ?? {});
  if (Object.keys(data as Record<string, unknown>).length === 0) {
    throw new ApiError(400, 'empty update', 'داده‌ای برای ویرایش ارسال نشده است');
  }

  const before = await delegate(def).findUnique({ where: { id: String(req.params.id) } });
  if (!before) throw new ApiError(404, 'not found', `${def.labelFa} یافت نشد`);

  try {
    let row: any;
    if (def.key === 'routes' && Array.isArray((data as any).steps)) {
      row = await replaceRouteSteps(String(req.params.id), data as any);
    } else {
      row = await delegate(def).update({ where: { id: String(req.params.id) }, data });
      if (def.include && def.key !== 'routes') {
        row = await delegate(def).findUniqueOrThrow({ where: { id: row.id }, include: def.include });
      }
    }
    await audit(req, 'UPDATE', def, row.id, { before, after: data });
    res.json({ row });
  } catch (err) {
    throw translatePrismaError(err, def);
  }
}

export async function removeResource(req: Request, res: Response, def: ResourceDef): Promise<void> {
  const before = await delegate(def).findUnique({ where: { id: String(req.params.id) } });
  if (!before) throw new ApiError(404, 'not found', `${def.labelFa} یافت نشد`);

  if (def.remove === 'soft' && def.soft) {
    const row = await delegate(def).update({ where: { id: String(req.params.id) }, data: { [def.soft.field]: def.soft.value } });
    await audit(req, 'DEACTIVATE', def, row.id, { before });
    res.json({ row, mode: 'deactivated' });
    return;
  }

  // hard delete — routes must not be removed when referenced by MOs/plans
  if (def.key === 'routes') {
    const moCount = await db.manufacturingOrder.count({ where: { routeId: String(req.params.id) } });
    const planCount = await db.productionPlanLine.count({ where: { routeId: String(req.params.id) } });
    if (moCount > 0 || planCount > 0) {
      throw new ApiError(409, 'route in use', 'این مسیر تولید در دستور کارها/برنامه‌ها استفاده شده و قابل حذف نیست');
    }
  }

  try {
    await delegate(def).delete({ where: { id: String(req.params.id) } });
    await audit(req, 'DELETE', def, String(req.params.id), { before });
    res.json({ mode: 'deleted' });
  } catch (err) {
    throw translatePrismaError(err, def);
  }
}

function translatePrismaError(err: unknown, def: ResourceDef): unknown {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') return friendlyUniqueError(def, 'مقدار یکتا تکراری است');
    if (err.code === 'P2003') {
      return new ApiError(409, 'foreign_key_violation', 'این رکورد در اسناد دیگر استفاده شده و قابل حذف/تغییر نیست');
    }
    if (err.code === 'P2025') return new ApiError(404, 'not found', `${def.labelFa} یافت نشد`);
  }
  return err;
}

// ---------------------------------------------------------------------------
// routes: nested steps create/replace (versioned route editor)
// ---------------------------------------------------------------------------

async function createRouteWithSteps(data: any): Promise<any> {
  const { steps, ...head } = data;
  return db.$transaction(async (tx: Prisma.TransactionClient) => {
    let version = head.version as number | undefined;
    if (!version) {
      const last = await tx.partRoute.findFirst({
        where: { partId: head.partId },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      version = (last?.version ?? 0) + 1;
    }
    const route = await tx.partRoute.create({
      data: {
        ...head,
        version,
        status: head.status ?? 'DRAFT',
        steps: {
          create: (steps ?? []).map((s: any, idx: number) => ({
            sequence: s.sequence ?? idx + 1,
            operationId: s.operationId,
            machineId: s.machineId ?? null,
            dieId: s.dieId ?? null,
            setupTimeMin: s.setupTimeMin ?? null,
            cycleTimeSec: s.cycleTimeSec ?? null,
            scrapFactorPct: s.scrapFactorPct ?? 0,
            requiredTonnage: s.requiredTonnage ?? null,
            description: s.description ?? null,
          })),
        },
      },
      include: RES_INCLUDE_STEPS,
    });
    return route;
  });
}

async function replaceRouteSteps(routeId: string, data: any): Promise<any> {
  const { steps, ...head } = data;
  return db.$transaction(async (tx: Prisma.TransactionClient) => {
    if (steps) {
      const route = await tx.partRoute.findUnique({ where: { id: routeId }, include: { _count: { select: { manufacturingOrders: true } } } });
      if (!route) throw new ApiError(404, 'not found', 'مسیر تولید یافت نشد');
      if (route._count.manufacturingOrders > 0) {
        throw new ApiError(409, 'route in use', 'این مسیر در دستور کارها استفاده شده است؛ برای تغییر، نسخهٔ جدید بسازید');
      }
      await tx.partRouteStep.deleteMany({ where: { routeId } });
      if (steps.length > 0) {
        await tx.partRouteStep.createMany({
          data: steps.map((s: any, idx: number) => ({
            routeId,
            sequence: s.sequence ?? idx + 1,
            operationId: s.operationId,
            machineId: s.machineId ?? null,
            dieId: s.dieId ?? null,
            setupTimeMin: s.setupTimeMin ?? null,
            cycleTimeSec: s.cycleTimeSec ?? null,
            scrapFactorPct: s.scrapFactorPct ?? 0,
            requiredTonnage: s.requiredTonnage ?? null,
            description: s.description ?? null,
          })),
        });
      }
    }
    const updated = await tx.partRoute.update({ where: { id: routeId }, data: head, include: RES_INCLUDE_STEPS });
    return updated;
  });
}

const RES_INCLUDE_STEPS: Prisma.PartRouteInclude = {
  part: { select: { partNumber: true, nameFa: true } },
  steps: {
    orderBy: { sequence: 'asc' },
    include: {
      operation: { select: { code: true, nameFa: true } },
      machine: { select: { code: true, nameFa: true } },
      die: { select: { code: true, nameFa: true } },
    },
  },
};

// ---------------------------------------------------------------------------
// CSV export (Excel-compatible: UTF-8 BOM + CRLF + formula-injection guard)
// ---------------------------------------------------------------------------

function csvCell(value: unknown): string {
  let text: string;
  if (value === null || value === undefined) text = '';
  else if (value instanceof Date) text = value.toISOString().slice(0, 19).replace('T', ' ');
  else if (typeof value === 'boolean') text = value ? 'بله' : 'خیر';
  else text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`; // anti formula injection
  if (/[",\n\r;]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function rowsToCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) lines.push(row.map(csvCell).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export async function exportResource(req: Request, res: Response, def: ResourceDef): Promise<void> {
  const where = buildWhere(def, req.query as Record<string, unknown>);
  const rows: any[] = await delegate(def).findMany({ where, include: def.include, orderBy: def.orderBy, take: 100_000 });

  const headers = def.columns.map((c) => c.header);
  const body = rows.map((row) => def.columns.map((c) => (c.get ? c.get(row) : c.key ? row[c.key] ?? '' : '')));
  const csv = rowsToCsv(headers, body);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="kpims-${def.key}-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.status(200).send(csv);
}

// ---------------------------------------------------------------------------
// CSV import (JSON rows posted by the UI after client-side parsing)
// ---------------------------------------------------------------------------

const REF_LOOKUPS: Record<NonNullable<ImportColumn['ref']>, { model: string; field: string; labelFa: string }> = {
  unit: { model: 'unitOfMeasure', field: 'code', labelFa: 'واحد' },
  material: { model: 'material', field: 'materialCode', labelFa: 'ماده' },
  part: { model: 'part', field: 'partNumber', labelFa: 'قطعه' },
  machine: { model: 'machine', field: 'code', labelFa: 'ماشین' },
  operation: { model: 'operation', field: 'code', labelFa: 'عملیات' },
  die: { model: 'die', field: 'code', labelFa: 'قالب' },
  warehouse: { model: 'warehouse', field: 'code', labelFa: 'انبار' },
  customer: { model: 'customer', field: 'code', labelFa: 'مشتری' },
};

function parseCell(col: ImportColumn, raw: unknown): unknown {
  if (raw === undefined || raw === null) return undefined;
  const text = String(raw).trim();
  if (text === '') return undefined;
  switch (col.kind) {
    case 'int': {
      const n = Number(text.replace(/[٬,\s]/g, ''));
      if (!Number.isInteger(n)) throw new ApiError(400, 'bad int', `مقدار «${text}» عدد صحیح نیست`);
      return n;
    }
    case 'decimal': {
      const n = Number(text.replace(/[٬,\s]/g, '').replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))));
      if (!Number.isFinite(n)) throw new ApiError(400, 'bad decimal', `مقدار «${text}» عدد معتبر نیست`);
      return String(n);
    }
    case 'boolean':
      return ['1', 'true', 'yes', 'بله', 'y'].includes(text.toLowerCase());
    case 'enum': {
      const allowed = col.values ?? [];
      const direct = text.toUpperCase();
      if (allowed.includes(direct)) return direct;
      throw new ApiError(400, 'bad enum', `مقدار «${text}» نامعتبر است؛ مجاز: ${allowed.join(' / ')}`);
    }
    default:
      return text;
  }
}

export async function importResource(req: Request, res: Response, def: ResourceDef): Promise<void> {
  if (!def.import) throw new ApiError(400, 'no import', 'برای این موجودیت ورود فایل تعریف نشده است');

  const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
  if (!rows) throw new ApiError(400, 'bad payload', 'فهرست ردیف‌ها ارسال نشده است');
  if (rows.length === 0) throw new ApiError(400, 'empty', 'فایل خالی است');
  if (rows.length > 5_000) throw new ApiError(400, 'too many rows', 'حداکثر ۵۰۰۰ ردیف در هر بار ورود فایل');

  // resolve reference caches once (code → id)
  const refCache = new Map<string, Map<string, string>>();
  const resolveRef = async (kind: NonNullable<ImportColumn['ref']>, code: string): Promise<string> => {
    let cache = refCache.get(kind);
    if (!cache) {
      const spec = REF_LOOKUPS[kind];
      const all: any[] = await (db as any)[spec.model].findMany({
        select: { id: true, [spec.field]: true },
        take: 100_000,
      });
      cache = new Map(all.map((r) => [String(r[spec.field]).trim().toLowerCase(), r.id]));
      refCache.set(kind, cache);
    }
    const id = cache.get(code.trim().toLowerCase());
    if (!id) throw new ApiError(400, 'unknown_ref', `${REF_LOOKUPS[kind].labelFa} «${code}» یافت نشد`);
    return id;
  };

  const errors: { row: number; message: string; messageFa: string }[] = [];
  let created = 0;
  let updated = 0;

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i] as Record<string, unknown>;
    try {
      const data: Record<string, unknown> = {};
      for (const col of def.import!.columns) {
        const cell = raw[col.header] ?? raw[col.key];
        let value = parseCell(col, cell);
        if (col.ref && value !== undefined) value = await resolveRef(col.ref, String(value));
        if (value === undefined && col.required) {
          throw new ApiError(400, 'missing_required', `ستون «${col.header}» الزامی است`);
        }
        if (value !== undefined) data[col.key] = value;
      }

      if (def.key === 'bom') {
        const partId = data.partId as string;
        const materialId = data.materialId as string;
        const existing = await db.partMaterialRequirement.findUnique({
          where: { partId_materialId: { partId, materialId } },
        });
        if (existing) {
          await db.partMaterialRequirement.update({ where: { id: existing.id }, data: data as any });
          updated++;
        } else {
          await db.partMaterialRequirement.create({ data: data as any });
          created++;
        }
        continue;
      }

      const keyValue = data[def.uniqueField];
      if (keyValue === undefined) {
        throw new ApiError(400, 'missing_key', `ستون کلید (${def.import!.columns[0]!.header}) الزامی است`);
      }
      const existing = await delegate(def).findFirst({ where: { [def.uniqueField]: keyValue }, select: { id: true } });
      if (existing) {
        const { [def.uniqueField]: _omit, ...rest } = data;
        await delegate(def).update({ where: { id: existing.id }, data: rest });
        updated++;
      } else {
        await delegate(def).create({ data: data as any });
        created++;
      }
    } catch (err) {
      const messageFa =
        (err instanceof ApiError ? err.messageFa : undefined) ??
        (err instanceof z.ZodError ? 'ساختار داده نامعتبر است' : 'خطای نامشخص در پردازش ردیف');
      const message = err instanceof Error ? err.message : 'unknown';
      errors.push({ row: i + 1, message, messageFa });
    }
  }

  await recordAudit(null, {
    userId: req.user?.id ?? null,
    action: 'IMPORT',
    entityType: def.key,
    changes: { created, updated, failed: errors.length } as object,
    ipAddress: req.ip ?? null,
    userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
  });

  res.json({ created, updated, failed: errors.length, errors });
}

// re-export for tests
export { MD_ENUMS };

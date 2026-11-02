import { Router } from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { db } from '../../config/db';
import { authenticate } from '../../middleware/auth';

export const searchRouter = Router();

searchRouter.use(authenticate);

const h =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next: NextFunction) => {
    fn(req, res).catch(next);
  };

export interface SearchResultItem {
  id: string;
  title: string;
  subtitle: string | null;
  /** exact code to pre-fill the target page's search box (deep-link with ?q=) */
  q: string | null;
}

export interface SearchResultGroup {
  type: string;
  labelFa: string;
  /** frontend route of the owning module */
  path: string;
  results: SearchResultItem[];
  /** true when the user lacks the module's view permission */
  hidden: boolean;
}

const querySchema = z.object({
  q: z.string().trim().min(1).max(100),
  limit: z.coerce.number().int().min(1).max(20).optional(),
});

/**
 * Global search across modules (جستجوی سراسری) — کالا، کویل/لوت، قرارداد، سفارش،
 * دستور کار، سند انبار، ماشین، قالب، مسیر و کاربر — همه با یک جعبه جستجو.
 * Each group is permission-aware: modules the user cannot view are reported
 * as `hidden` (so the UI can explain, not silently drop).
 */
searchRouter.get(
  '/',
  h(async (req, res) => {
    const { q, limit } = querySchema.parse(req.query ?? {});
    const take = limit ?? 6;
    const contains = { contains: q, mode: 'insensitive' as const };
    const permissions = new Set(req.user?.permissions ?? []);
    const can = (code: string) => permissions.has(code);

    const [
      parts, materials, lots, contracts, machines, dies, customers, orders, mos, documents, routes, users, warehouses,
    ] = await Promise.all([
      can('masterdata.view')
        ? db.part.findMany({ where: { OR: [{ partNumber: contains }, { nameFa: contains }, { nameEn: contains }] }, select: { id: true, partNumber: true, nameFa: true, partType: true, status: true }, orderBy: { partNumber: 'asc' }, take })
        : Promise.resolve([]),
      can('masterdata.view')
        ? db.material.findMany({ where: { OR: [{ materialCode: contains }, { nameFa: contains }, { nameEn: contains }, { grade: contains }] }, select: { id: true, materialCode: true, nameFa: true, materialType: true, status: true }, orderBy: { materialCode: 'asc' }, take })
        : Promise.resolve([]),
      can('inventory.view')
        ? db.materialLot.findMany({
            where: { lotNumber: contains },
            include: { material: { select: { materialCode: true, nameFa: true } } },
            orderBy: { receiptDate: 'desc' },
            take,
          })
        : Promise.resolve([]),
      can('materials.view')
        ? db.materialContract.findMany({
            where: { OR: [{ contractNumber: contains }, { supplierName: contains }] },
            include: { material: { select: { materialCode: true, nameFa: true } } },
            orderBy: { orderDate: 'desc' },
            take,
          })
        : Promise.resolve([]),
      can('capacity.view')
        ? db.machine.findMany({ where: { OR: [{ code: contains }, { nameFa: contains }, { manufacturer: contains }, { location: contains }] }, select: { id: true, code: true, nameFa: true, machineType: true, status: true }, orderBy: { code: 'asc' }, take })
        : Promise.resolve([]),
      can('capacity.view')
        ? db.die.findMany({ where: { OR: [{ code: contains }, { nameFa: contains }] }, select: { id: true, code: true, nameFa: true, status: true }, orderBy: { code: 'asc' }, take })
        : Promise.resolve([]),
      can('masterdata.view')
        ? db.customer.findMany({ where: { OR: [{ code: contains }, { nameFa: contains }, { nameEn: contains }] }, select: { id: true, code: true, nameFa: true, isActive: true }, orderBy: { code: 'asc' }, take })
        : Promise.resolve([]),
      can('production.view')
        ? db.customerOrder.findMany({
            where: { OR: [{ orderNumber: contains }, { description: contains }, { customer: { nameFa: contains } }, { customer: { nameEn: contains } }] },
            include: { customer: { select: { code: true, nameFa: true } } },
            orderBy: { orderDate: 'desc' },
            take,
          })
        : Promise.resolve([]),
      can('production.view')
        ? db.manufacturingOrder.findMany({
            where: { OR: [{ moNumber: contains }, { part: { partNumber: contains } }, { part: { nameFa: contains } }] },
            include: { part: { select: { partNumber: true, nameFa: true } } },
            orderBy: { createdAt: 'desc' },
            take,
          })
        : Promise.resolve([]),
      can('inventory.view')
        ? db.inventoryDocument.findMany({
            where: { OR: [{ documentNumber: contains }, { description: contains }] },
            select: { id: true, documentNumber: true, documentType: true, documentDate: true, postingStatus: true },
            orderBy: { documentDate: 'desc' },
            take,
          })
        : Promise.resolve([]),
      can('masterdata.view')
        ? db.partRoute.findMany({
            where: { OR: [{ name: contains }, { part: { partNumber: contains } }, { part: { nameFa: contains } }] },
            include: { part: { select: { partNumber: true, nameFa: true } } },
            orderBy: { updatedAt: 'desc' },
            take,
          })
        : Promise.resolve([]),
      can('settings.view')
        ? db.user.findMany({ where: { OR: [{ username: contains }, { fullName: contains }, { email: contains }] }, select: { id: true, username: true, fullName: true, isActive: true }, orderBy: { username: 'asc' }, take })
        : Promise.resolve([]),
      can('masterdata.view')
        ? db.warehouse.findMany({ where: { OR: [{ code: contains }, { nameFa: contains }] }, select: { id: true, code: true, nameFa: true, isActive: true }, orderBy: { code: 'asc' }, take })
        : Promise.resolve([]),
    ]);

    const groups: SearchResultGroup[] = [
      {
        type: 'parts', labelFa: 'قطعات (کالا)', path: '/master-data/parts', hidden: !can('masterdata.view'),
        results: parts.map((p) => ({ id: p.id, title: `${p.partNumber} — ${p.nameFa}`, subtitle: p.status === 'ACTIVE' ? 'فعال' : p.status, q: p.partNumber })),
      },
      {
        type: 'materials', labelFa: 'مواد اولیه', path: '/master-data/materials', hidden: !can('masterdata.view'),
        results: materials.map((m) => ({ id: m.id, title: `${m.materialCode} — ${m.nameFa}`, subtitle: m.materialType, q: m.materialCode })),
      },
      {
        type: 'lots', labelFa: 'کویل / لوت مواد', path: '/inventory/inquiry', hidden: !can('inventory.view'),
        results: lots.map((l) => ({ id: l.id, title: `لوت ${l.lotNumber}`, subtitle: l.material ? `${l.material.materialCode} — ${l.material.nameFa}` : null, q: l.lotNumber })),
      },
      {
        type: 'contracts', labelFa: 'قراردادهای مواد', path: '/sapco-materials', hidden: !can('materials.view'),
        results: contracts.map((c) => ({ id: c.id, title: `قرارداد ${c.contractNumber}`, subtitle: c.material ? c.material.nameFa : c.supplierName, q: c.contractNumber })),
      },
      {
        type: 'orders', labelFa: 'سفارش‌های مشتری', path: '/production', hidden: !can('production.view'),
        results: orders.map((o) => ({ id: o.id, title: `سفارش ${o.orderNumber}`, subtitle: o.customer?.nameFa ?? null, q: o.orderNumber })),
      },
      {
        type: 'mos', labelFa: 'دستور کارهای ساخت', path: '/production', hidden: !can('production.view'),
        results: mos.map((mo) => ({ id: mo.id, title: `${mo.moNumber}`, subtitle: mo.part ? `${mo.part.partNumber} — ${mo.part.nameFa}` : null, q: mo.moNumber })),
      },
      {
        type: 'documents', labelFa: 'سندهای انبار', path: '/inventory/documents', hidden: !can('inventory.view'),
        results: documents.map((d) => ({ id: d.id, title: `${d.documentNumber}`, subtitle: `${d.documentType} — ${d.postingStatus === 'POSTED' ? 'قطع‌بوش‌شده' : d.postingStatus === 'REVERSED' ? 'ابطالی' : 'قطع‌بوش‌نشده'}`, q: d.documentNumber })),
      },
      {
        type: 'machines', labelFa: 'ماشین‌آلات', path: '/machines', hidden: !can('capacity.view'),
        results: machines.map((m) => ({ id: m.id, title: `${m.code} — ${m.nameFa}`, subtitle: m.machineType, q: m.code })),
      },
      {
        type: 'dies', labelFa: 'قالب‌ها', path: '/machines/dies', hidden: !can('capacity.view'),
        results: dies.map((d) => ({ id: d.id, title: `${d.code} — ${d.nameFa}`, subtitle: d.status, q: d.code })),
      },
      {
        type: 'routes', labelFa: 'مسیرهای تولید', path: '/master-data/routes', hidden: !can('masterdata.view'),
        results: routes.map((r) => ({ id: r.id, title: r.name ?? `مسیر نسخهٔ ${r.version}`, subtitle: r.part ? `${r.part.partNumber} — ${r.part.nameFa}` : null, q: r.part?.partNumber ?? null })),
      },
      {
        type: 'customers', labelFa: 'مشتریان', path: '/master-data/customers', hidden: !can('masterdata.view'),
        results: customers.map((c) => ({ id: c.id, title: `${c.code} — ${c.nameFa}`, subtitle: c.isActive ? 'فعال' : 'غیرفعال', q: c.code })),
      },
      {
        type: 'warehouses', labelFa: 'انبارها', path: '/master-data/warehouses', hidden: !can('masterdata.view'),
        results: warehouses.map((w) => ({ id: w.id, title: `${w.code} — ${w.nameFa}`, subtitle: w.isActive ? 'فعال' : 'غیرفعال', q: w.code })),
      },
      {
        type: 'users', labelFa: 'کاربران', path: '/settings/users', hidden: !can('settings.view'),
        results: users.map((u) => ({ id: u.id, title: `${u.username} — ${u.fullName}`, subtitle: u.isActive ? 'فعال' : 'غیرفعال', q: u.username })),
      },
    ];

    const visible = groups.filter((g) => !g.hidden);
    const totalHits = visible.reduce((sum, g) => sum + g.results.length, 0);
    const hiddenModules = groups.filter((g) => g.hidden).map((g) => g.labelFa);

    res.json({ query: q, totalHits, hiddenModules, groups: visible.filter((g) => g.results.length > 0) });
  }),
);

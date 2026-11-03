import { Router } from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { db } from '../../config/db';
import { authenticate, requirePermission } from '../../middleware/auth';
import { ApiError } from '../../lib/http';
import { recordAudit } from '../../lib/audit';
import { getPublicSettings } from '../../lib/settings';
import { rowsToCsv } from '../masterdata/masterdata.controller';

export const settingsRouter = Router();

settingsRouter.use(authenticate);

const h =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next: NextFunction) => {
    fn(req, res).catch(next);
  };

const manage = requirePermission('settings.manage');
const view = requirePermission('settings.view');

// ---------------------------------------------------------------------------
// public settings — every authenticated user (whitelisted, non-secret keys)
// ---------------------------------------------------------------------------

settingsRouter.get(
  '/public',
  h(async (_req, res) => {
    res.json({ settings: await getPublicSettings() });
  }),
);

const publicUserSelect = {
  id: true,
  username: true,
  email: true,
  fullName: true,
  isActive: true,
  roleId: true,
  lastLoginAt: true,
  createdAt: true,
  role: { select: { id: true, name: true, nameFa: true } },
} as const;

// ---------------------------------------------------------------------------
// overview
// ---------------------------------------------------------------------------

settingsRouter.get(
  '/overview',
  view,
  h(async (_req, res) => {
    const [users, activeUsers, roles, permissions, sequences, settings, auditToday] = await Promise.all([
      db.user.count(),
      db.user.count({ where: { isActive: true } }),
      db.role.count({ where: { isActive: true } }),
      db.permission.count(),
      db.documentSequence.count(),
      db.systemSetting.count(),
      db.auditLog.count({ where: { occurredAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } } }),
    ]);
    res.json({ users, activeUsers, roles, permissions, sequences, settings, auditToday });
  }),
);

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------

const userCreateSchema = z.object({
  username: z.string().trim().min(3).max(64).regex(/^[a-zA-Z0-9._-]+$/, 'نام کاربری فقط حروف/عدد/نقطه/خط تیره'),
  fullName: z.string().trim().min(2).max(190),
  email: z.string().trim().email().max(190).nullish(),
  password: z.string().min(8, 'گذرواژه حداقل ۸ نویسه').max(100),
  roleId: z.string().uuid(),
  isActive: z.boolean().optional(),
});

const userUpdateSchema = z.object({
  fullName: z.string().trim().min(2).max(190).optional(),
  email: z.string().trim().email().max(190).nullish(),
  roleId: z.string().uuid().optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(8).max(100).optional(),
});

const userFilterSchema = z.object({
  q: z.string().trim().max(100).optional(),
  roleId: z.string().uuid().optional(),
  isActive: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(500).optional(),
});

function userWhere(query: z.infer<typeof userFilterSchema>): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  if (query.q) {
    where.OR = [
      { username: { contains: query.q, mode: 'insensitive' } },
      { fullName: { contains: query.q, mode: 'insensitive' } },
      { email: { contains: query.q, mode: 'insensitive' } },
    ];
  }
  if (query.roleId) where.roleId = query.roleId;
  if (query.isActive) where.isActive = query.isActive === 'true';
  return where;
}

settingsRouter.get(
  '/users',
  view,
  h(async (req, res) => {
    const query = userFilterSchema.parse(req.query ?? {});
    const where = userWhere(query);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const [rows, total] = await Promise.all([
      db.user.findMany({
        where,
        select: publicUserSelect,
        orderBy: { username: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.user.count({ where }),
    ]);
    res.json({ rows, total, page, pageSize });
  }),
);

settingsRouter.get(
  '/users/export',
  view,
  h(async (req, res) => {
    const query = userFilterSchema.parse(req.query ?? {});
    const rows = await db.user.findMany({ where: userWhere(query), select: publicUserSelect, orderBy: { username: 'asc' }, take: 100_000 });
    // گذرواژه‌ها هرگز خروجی گرفته نمی‌شوند
    const csv = rowsToCsv(
      ['نام کاربری', 'نام و نام خانوادگی', 'ایمیل', 'نقش', 'فعال', 'آخرین ورود', 'تاریخ ایجاد'],
      rows.map((u) => [
        u.username,
        u.fullName,
        u.email ?? '',
        u.role.nameFa,
        u.isActive ? 'بله' : 'خیر',
        u.lastLoginAt ? u.lastLoginAt.toISOString().slice(0, 16).replace('T', ' ') : '',
        u.createdAt.toISOString().slice(0, 10),
      ]),
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="kpims-users.csv"');
    res.status(200).send(csv);
  }),
);

settingsRouter.post(
  '/users',
  manage,
  h(async (req, res) => {
    const body = userCreateSchema.parse(req.body ?? {});
    const role = await db.role.findUnique({ where: { id: body.roleId }, select: { id: true, isActive: true } });
    if (!role || !role.isActive) throw new ApiError(400, 'unknown role', 'نقش نامعتبر است');
    const exists = await db.user.findUnique({ where: { username: body.username }, select: { id: true } });
    if (exists) throw new ApiError(409, 'duplicate username', 'نام کاربری تکراری است');

    const user = await db.user.create({
      data: {
        username: body.username,
        fullName: body.fullName,
        email: body.email ?? null,
        passwordHash: await bcrypt.hash(body.password, 10),
        roleId: body.roleId,
        isActive: body.isActive ?? true,
      },
      select: publicUserSelect,
    });
    await recordAudit(null, {
      userId: req.user?.id ?? null,
      action: 'CREATE',
      entityType: 'user',
      entityId: user.id,
      changes: { username: user.username, roleId: user.roleId } as object,
      ipAddress: req.ip ?? null,
    });
    res.status(201).json({ user });
  }),
);

settingsRouter.put(
  '/users/:id',
  manage,
  h(async (req, res) => {
    const body = userUpdateSchema.parse(req.body ?? {});
    const before = await db.user.findUnique({ where: { id: String(req.params.id) }, select: publicUserSelect });
    if (!before) throw new ApiError(404, 'not found', 'کاربر یافت نشد');
    if (body.roleId) {
      const role = await db.role.findUnique({ where: { id: body.roleId }, select: { id: true, isActive: true } });
      if (!role || !role.isActive) throw new ApiError(400, 'unknown role', 'نقش نامعتبر است');
    }

    const data: Record<string, unknown> = {
      ...(body.fullName !== undefined ? { fullName: body.fullName } : {}),
      ...(body.email !== undefined ? { email: body.email ?? null } : {}),
      ...(body.roleId !== undefined ? { roleId: body.roleId } : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
    };
    if (body.password) data.passwordHash = await bcrypt.hash(body.password, 10);

    const user = await db.user.update({ where: { id: before.id }, data, select: publicUserSelect });
    await recordAudit(null, {
      userId: req.user?.id ?? null,
      action: 'UPDATE',
      entityType: 'user',
      entityId: before.id,
      changes: {
        before: { fullName: before.fullName, roleId: before.roleId, isActive: before.isActive },
        after: { fullName: user.fullName, roleId: user.roleId, isActive: user.isActive, passwordChanged: Boolean(body.password) },
      } as object,
      ipAddress: req.ip ?? null,
    });
    res.json({ user });
  }),
);

settingsRouter.post(
  '/users/import',
  manage,
  h(async (req, res) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (rows.length === 0) throw new ApiError(400, 'empty', 'فایل خالی است');
    if (rows.length > 1000) throw new ApiError(400, 'too many', 'حداکثر ۱۰۰۰ کاربر در هر بار ورود');

    const roles = await db.role.findMany({ select: { id: true, name: true, nameFa: true } });
    const roleByName = new Map<string, string>();
    for (const r of roles) {
      roleByName.set(r.name.toLowerCase(), r.id);
      roleByName.set(r.nameFa.trim(), r.id);
    }

    const errors: { row: number; messageFa: string }[] = [];
    let created = 0;
    let updated = 0;
    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i] as Record<string, unknown>;
      try {
        const username = String(raw['نام کاربری'] ?? raw['username'] ?? '').trim();
        const fullName = String(raw['نام و نام خانوادگی'] ?? raw['fullName'] ?? '').trim();
        const roleName = String(raw['نقش'] ?? raw['role'] ?? '').trim();
        const email = String(raw['ایمیل'] ?? raw['email'] ?? '').trim() || null;
        const password = String(raw['گذرواژه'] ?? raw['password'] ?? '').trim();
        const isActiveRaw = String(raw['فعال'] ?? raw['isActive'] ?? 'بله').trim();

        if (!username) throw new ApiError(400, 'missing', 'ستون «نام کاربری» الزامی است');
        if (!fullName) throw new ApiError(400, 'missing', 'ستون «نام و نام خانوادگی» الزامی است');
        const roleId = roleByName.get(roleName);
        if (!roleId) throw new ApiError(400, 'unknown role', `نقش «${roleName}» یافت نشد`);

        const existing = await db.user.findUnique({ where: { username }, select: { id: true } });
        if (existing) {
          const data: Record<string, unknown> = { fullName, email, roleId, isActive: ['بله', '1', 'true'].includes(isActiveRaw) };
          if (password) data.passwordHash = await bcrypt.hash(password, 10);
          await db.user.update({ where: { id: existing.id }, data });
          updated++;
        } else {
          if (!password) throw new ApiError(400, 'missing password', 'برای کاربر جدید ستون «گذرواژه» الزامی است');
          await db.user.create({
            data: {
              username,
              fullName,
              email,
              passwordHash: await bcrypt.hash(password, 10),
              roleId,
              isActive: ['بله', '1', 'true'].includes(isActiveRaw),
            },
          });
          created++;
        }
      } catch (err) {
        errors.push({ row: i + 1, messageFa: (err instanceof ApiError ? err.messageFa : undefined) ?? 'خطای نامشخص' });
      }
    }

    await recordAudit(null, {
      userId: req.user?.id ?? null,
      action: 'IMPORT',
      entityType: 'user',
      changes: { created, updated, failed: errors.length } as object,
      ipAddress: req.ip ?? null,
    });
    res.json({ created, updated, failed: errors.length, errors });
  }),
);

// ---------------------------------------------------------------------------
// roles & permissions
// ---------------------------------------------------------------------------

settingsRouter.get(
  '/roles',
  view,
  h(async (_req, res) => {
    const roles = await db.role.findMany({
      include: {
        _count: { select: { users: true } },
        rolePermissions: { include: { permission: { select: { code: true, module: true, action: true } } } },
      },
      orderBy: { name: 'asc' },
    });
    res.json({
      roles: roles.map((r) => ({
        id: r.id,
        name: r.name,
        nameFa: r.nameFa,
        description: r.description,
        isActive: r.isActive,
        userCount: r._count.users,
        permissions: r.rolePermissions.map((rp) => rp.permission.code),
      })),
    });
  }),
);

const roleSchema = z.object({
  name: z.string().trim().min(2).max(64).regex(/^[A-Z0-9_]+$/, 'نام نقش لاتین بزرگ (مثلاً PLANNER)'),
  nameFa: z.string().trim().min(2).max(190),
  description: z.string().trim().max(500).nullish(),
  isActive: z.boolean().optional(),
  permissionCodes: z.array(z.string().max(100)).max(500).optional(),
});

const roleUpdateSchema = roleSchema.partial();

settingsRouter.post(
  '/roles',
  manage,
  h(async (req, res) => {
    const body = roleSchema.parse(req.body ?? {});
    const exists = await db.role.findUnique({ where: { name: body.name }, select: { id: true } });
    if (exists) throw new ApiError(409, 'duplicate role', 'نام نقش تکراری است');

    const role = await db.$transaction(async (tx) => {
      const created = await tx.role.create({
        data: { name: body.name, nameFa: body.nameFa, description: body.description ?? null, isActive: body.isActive ?? true },
      });
      if (body.permissionCodes?.length) {
        const perms = await tx.permission.findMany({ where: { code: { in: body.permissionCodes } }, select: { id: true } });
        await tx.rolePermission.createMany({ data: perms.map((p) => ({ roleId: created.id, permissionId: p.id })) });
      }
      return created;
    });
    await recordAudit(null, { userId: req.user?.id ?? null, action: 'CREATE', entityType: 'role', entityId: role.id, changes: body as object });
    res.status(201).json({ role });
  }),
);

settingsRouter.put(
  '/roles/:id',
  manage,
  h(async (req, res) => {
    const body = roleUpdateSchema.parse(req.body ?? {});
    const before = await db.role.findUnique({
      where: { id: String(req.params.id) },
      include: { rolePermissions: { select: { permissionId: true } }, _count: { select: { users: true } } },
    });
    if (!before) throw new ApiError(404, 'not found', 'نقش یافت نشد');

    const role = await db.$transaction(async (tx) => {
      const updated = await tx.role.update({
        where: { id: before.id },
        data: {
          ...(body.nameFa !== undefined ? { nameFa: body.nameFa } : {}),
          ...(body.description !== undefined ? { description: body.description ?? null } : {}),
          ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        },
      });
      if (body.permissionCodes) {
        const perms = await tx.permission.findMany({ where: { code: { in: body.permissionCodes } }, select: { id: true } });
        await tx.rolePermission.deleteMany({ where: { roleId: before.id } });
        if (perms.length > 0) {
          await tx.rolePermission.createMany({ data: perms.map((p) => ({ roleId: before.id, permissionId: p.id })) });
        }
      }
      return updated;
    });
    await recordAudit(null, {
      userId: req.user?.id ?? null,
      action: 'UPDATE',
      entityType: 'role',
      entityId: before.id,
      changes: { before: { isActive: before.isActive }, after: body } as object,
    });
    res.json({ role });
  }),
);

settingsRouter.delete(
  '/roles/:id',
  manage,
  h(async (req, res) => {
    const role = await db.role.findUnique({ where: { id: String(req.params.id) }, include: { _count: { select: { users: true } } } });
    if (!role) throw new ApiError(404, 'not found', 'نقش یافت نشد');
    if (role._count.users > 0) {
      throw new ApiError(409, 'role in use', `${role._count.users} کاربر با این نقش وجود دارد؛ ابتدا نقش کاربران را تغییر دهید`);
    }
    await db.role.delete({ where: { id: role.id } });
    await recordAudit(null, { userId: req.user?.id ?? null, action: 'DELETE', entityType: 'role', entityId: role.id, changes: { name: role.name } as object });
    res.json({ mode: 'deleted' });
  }),
);

settingsRouter.get(
  '/permissions',
  view,
  h(async (_req, res) => {
    const permissions = await db.permission.findMany({ orderBy: [{ module: 'asc' }, { action: 'asc' }] });
    const byModule = new Map<string, typeof permissions>();
    for (const p of permissions) {
      const list = byModule.get(p.module) ?? [];
      list.push(p);
      byModule.set(p.module, list);
    }
    res.json({
      groups: [...byModule.entries()].map(([module, perms]) => ({ module, permissions: perms })),
    });
  }),
);

// ---------------------------------------------------------------------------
// document sequences
// ---------------------------------------------------------------------------

settingsRouter.get(
  '/sequences',
  view,
  h(async (_req, res) => {
    const sequences = await db.documentSequence.findMany({ orderBy: { key: 'asc' } });
    res.json({ sequences });
  }),
);

const sequenceSchema = z.object({
  title: z.string().trim().max(190).nullish(),
  prefix: z.string().trim().min(1).max(16).optional(),
  padLength: z.number().int().min(2).max(12).optional(),
  resetPolicy: z.enum(['NEVER', 'YEARLY']).optional(),
});

settingsRouter.put(
  '/sequences/:id',
  manage,
  h(async (req, res) => {
    const body = sequenceSchema.parse(req.body ?? {});
    const before = await db.documentSequence.findUnique({ where: { id: String(req.params.id) } });
    if (!before) throw new ApiError(404, 'not found', 'دنباله شماره‌گذاری یافت نشد');
    const sequence = await db.documentSequence.update({ where: { id: before.id }, data: body });
    await recordAudit(null, {
      userId: req.user?.id ?? null,
      action: 'UPDATE',
      entityType: 'document_sequence',
      entityId: before.id,
      changes: { before, after: body } as object,
    });
    res.json({ sequence });
  }),
);

// ---------------------------------------------------------------------------
// system settings
// ---------------------------------------------------------------------------

settingsRouter.get(
  '/system',
  view,
  h(async (_req, res) => {
    const settings = await db.systemSetting.findMany({ orderBy: { key: 'asc' } });
    res.json({
      settings: settings.map((s) => ({ ...s, value: s.isSecret ? '••••••••' : s.value })),
    });
  }),
);

const settingSchema = z.object({
  key: z.string().trim().min(2).max(100).regex(/^[a-zA-Z0-9._-]+$/),
  value: z.string().max(2000),
  valueType: z.enum(['STRING', 'NUMBER', 'BOOLEAN', 'JSON']).optional(),
  description: z.string().trim().max(500).nullish(),
  isSecret: z.boolean().optional(),
});

settingsRouter.post(
  '/system',
  manage,
  h(async (req, res) => {
    const body = settingSchema.parse(req.body ?? {});
    const exists = await db.systemSetting.findUnique({ where: { key: body.key }, select: { id: true } });
    if (exists) throw new ApiError(409, 'duplicate key', 'کلید تنظیم تکراری است');
    const setting = await db.systemSetting.create({ data: body });
    await recordAudit(null, { userId: req.user?.id ?? null, action: 'CREATE', entityType: 'system_setting', entityId: setting.id, changes: { key: body.key } as object });
    res.status(201).json({ setting: { ...setting, value: setting.isSecret ? '••••••••' : setting.value } });
  }),
);

settingsRouter.put(
  '/system/:id',
  manage,
  h(async (req, res) => {
    const body = z.object({ value: z.string().max(2000) }).parse(req.body ?? {});
    const before = await db.systemSetting.findUnique({ where: { id: String(req.params.id) } });
    if (!before) throw new ApiError(404, 'not found', 'تنظیم یافت نشد');
    const setting = await db.systemSetting.update({ where: { id: before.id }, data: { value: body.value } });
    await recordAudit(null, {
      userId: req.user?.id ?? null,
      action: 'UPDATE',
      entityType: 'system_setting',
      entityId: before.id,
      changes: { key: before.key, before: before.isSecret ? '(hidden)' : before.value, after: before.isSecret ? '(hidden)' : body.value } as object,
    });
    res.json({ setting: { ...setting, value: setting.isSecret ? '••••••••' : setting.value } });
  }),
);

// ---------------------------------------------------------------------------
// audit logs (read-only + CSV export)
// ---------------------------------------------------------------------------

const auditFilterSchema = z.object({
  q: z.string().trim().max(100).optional(),
  action: z.string().trim().max(64).optional(),
  entityType: z.string().trim().max(64).optional(),
  userId: z.string().uuid().optional(),
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(500).optional(),
});

function auditWhere(query: z.infer<typeof auditFilterSchema>): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  if (query.q) {
    where.OR = [
      { action: { contains: query.q, mode: 'insensitive' } },
      { entityType: { contains: query.q, mode: 'insensitive' } },
      { entityId: { contains: query.q, mode: 'insensitive' } },
    ];
  }
  if (query.action) where.action = { contains: query.action, mode: 'insensitive' };
  if (query.entityType) where.entityType = { contains: query.entityType, mode: 'insensitive' };
  if (query.userId) where.userId = query.userId;
  if (query.from || query.to) {
    const occurredAt: Record<string, Date> = {};
    if (query.from) {
      const d = new Date(`${query.from}T00:00:00Z`);
      if (!Number.isNaN(d.getTime())) occurredAt.gte = d;
    }
    if (query.to) {
      const d = new Date(`${query.to}T23:59:59Z`);
      if (!Number.isNaN(d.getTime())) occurredAt.lte = d;
    }
    if (Object.keys(occurredAt).length > 0) where.occurredAt = occurredAt;
  }
  return where;
}

settingsRouter.get(
  '/audit-logs',
  view,
  h(async (req, res) => {
    const query = auditFilterSchema.parse(req.query ?? {});
    const where = auditWhere(query);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const [rows, total] = await Promise.all([
      db.auditLog.findMany({
        where,
        include: { user: { select: { username: true, fullName: true } } },
        orderBy: { occurredAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.auditLog.count({ where }),
    ]);
    res.json({ rows, total, page, pageSize });
  }),
);

settingsRouter.get(
  '/audit-logs/export',
  view,
  h(async (req, res) => {
    const query = auditFilterSchema.parse(req.query ?? {});
    const rows = await db.auditLog.findMany({
      where: auditWhere(query),
      include: { user: { select: { username: true, fullName: true } } },
      orderBy: { occurredAt: 'desc' },
      take: 100_000,
    });
    const csv = rowsToCsv(
      ['زمان (UTC)', 'کاربر', 'رویداد', 'موجودیت', 'شناسه رکورد', 'تغییرات', 'IP'],
      rows.map((r) => [
        r.occurredAt.toISOString().slice(0, 19).replace('T', ' '),
        r.user ? `${r.user.username} — ${r.user.fullName}` : '',
        r.action,
        r.entityType ?? '',
        r.entityId ?? '',
        r.changes ? JSON.stringify(r.changes).slice(0, 500) : '',
        r.ipAddress ?? '',
      ]),
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="kpims-audit-logs.csv"');
    res.status(200).send(csv);
  }),
);

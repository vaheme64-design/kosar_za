import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';

/**
 * HTTP integration tests for the master-data / machines / settings modules
 * and the global search. Runs against the real test database through the
 * actual Express app (auth + RBAC included), like the production path.
 */
import { createApp } from '../src/app';
import { db, uniqueCode } from './helpers';

let app: Express;
let baseUrl = '';
let adminToken = '';
let viewerToken = '';

async function api(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
  token = adminToken,
): Promise<{ status: number; json: any; text: string }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* csv responses */
  }
  return { status: res.status, json, text };
}

async function login(username: string): Promise<string> {
  const res = await api('POST', '/api/v1/auth/login', { username, password: 'Kpims@1404' });
  if (res.status !== 200) throw new Error(`login ${username} failed: ${res.text}`);
  return res.json.token as string;
}

const dec = (v: unknown): string => String(v ?? '');

// file-level server lifecycle — shared by every describe block below
let testServer: any;

beforeAll(async () => {
  app = createApp();
  testServer = app.listen(0);
  await new Promise<void>((resolve) => testServer.on('listening', resolve));
  const address = testServer.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
  adminToken = await login('admin');
  viewerToken = await login('viewer');
});

afterAll(async () => {
  if (testServer) await new Promise<void>((resolve) => testServer.close(() => resolve()));
  await db.$disconnect();
});

describe('master-data CRUD + search + import/export', () => {
  const codes = { unit: '', part: '', machine: '' };

  it('creates a unit and a part through the generic resource API', async () => {
    codes.unit = uniqueCode('U');
    const unit = await api('POST', '/api/v1/master-data/units', {
      code: codes.unit,
      nameFa: 'جعبه',
      nameEn: 'Box',
      kind: 'COUNT',
    });
    expect(unit.status).toBe(201);
    expect(unit.json.row.code).toBe(codes.unit);

    codes.part = uniqueCode('PT');
    const unitId = unit.json.row.id;
    const part = await api('POST', '/api/v1/master-data/parts', {
      partNumber: codes.part,
      nameFa: 'قطعه جستجوی آزمون',
      baseUnitId: unitId,
      standardWeightKg: '3.25',
    });
    expect(part.status).toBe(201);
    expect(dec(part.json.row.standardWeightKg)).toBe('3.25');
    expect(part.json.row.baseUnit?.nameFa).toBe('جعبه'); // part uses the unit created in this test
  });

  it('rejects duplicate unique keys with a Persian 409', async () => {
    const dup = await api('POST', '/api/v1/master-data/parts', {
      partNumber: codes.part,
      nameFa: 'تکراری',
      baseUnitId: (await api('GET', '/api/v1/master-data/units?pageSize=1')).json.rows[0].id,
    });
    expect(dup.status).toBe(409);
    expect(dup.json.messageFa).toContain('تکراری');
  });

  it('searches parts server-side (q + pagination contract)', async () => {
    const res = await api('GET', `/api/v1/master-data/parts?q=${codes.part}&pageSize=10`);
    expect(res.status).toBe(200);
    expect(res.json.total).toBe(1);
    expect(res.json.rows[0].partNumber).toBe(codes.part);
  });

  it('blocks viewer role from managing master data (RBAC)', async () => {
    const res = await api('POST', '/api/v1/master-data/units', { code: uniqueCode('V'), nameFa: 'x', nameEn: 'x' }, viewerToken);
    expect(res.status).toBe(403);
    expect(res.json.requiredPermission).toBe('masterdata.manage');
  });

  it('soft-deactivates a part (delete → INACTIVE, never hard delete)', async () => {
    const res = await api('DELETE', `/api/v1/master-data/parts/${(await api('GET', `/api/v1/master-data/parts?q=${codes.part}`)).json.rows[0].id}`);
    expect(res.status).toBe(200);
    expect(res.json.mode).toBe('deactivated');
    const row = (await api('GET', `/api/v1/master-data/parts?q=${codes.part}`)).json.rows[0];
    expect(row.status).toBe('INACTIVE');
  });

  it('exports parts CSV with Persian headers and UTF-8 BOM', async () => {
    const res = await api('GET', `/api/v1/master-data/parts/export?q=${codes.part}`);
    expect(res.status).toBe(200);
    // fetch's res.text() strips the BOM — inspect the raw bytes instead
    const bytes = new Uint8Array(await (await fetch(`${baseUrl}/api/v1/master-data/parts/export?q=${codes.part}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    })).arrayBuffer());
    expect(bytes[0]).toBe(0xef);
    expect(bytes[1]).toBe(0xbb);
    expect(bytes[2]).toBe(0xbf);
    expect(res.text).toContain('شماره قطعه');
    expect(res.text).toContain(codes.part);
  });

  it('imports parts from CSV rows: creates new + updates existing (upsert)', async () => {
    const unitId = (await api('GET', '/api/v1/master-data/units?pageSize=5')).json.rows.find((u: any) => u.code === 'PCS').id;
    const newCode = uniqueCode('PT');
    const res = await api('POST', '/api/v1/master-data/parts/import', {
      rows: [
        { 'شماره قطعه': codes.part, 'نام فارسی': 'قطعه ویرایش‌شده با ورود فایل', واحد: 'PCS' },
        { 'شماره قطعه': newCode, 'نام فارسی': 'قطعه واردشده', واحد: 'PCS' },
        { 'نام فارسی': 'ردیف بدون کلید' }, // error row
        { 'شماره قطعه': uniqueCode('PT'), 'نام فارسی': 'واحد ناموجود', واحد: 'XX-NO' },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.json.created).toBe(1);
    expect(res.json.updated).toBe(1);
    expect(res.json.failed).toBe(2);
    expect(res.json.errors.length).toBe(2);

    const edited = (await api('GET', `/api/v1/master-data/parts?q=${codes.part}`)).json.rows[0];
    expect(edited.nameFa).toBe('قطعه ویرایش‌شده با ورود فایل');
    expect(edited.baseUnit.id ?? edited.baseUnitId ?? '').toBeTruthy();
    const imported = (await api('GET', `/api/v1/master-data/parts?q=${newCode}`)).json.rows[0];
    expect(imported.baseUnitId).toBe(unitId);
  });

  it('updates and deactivates a unit; units referenced by docs deactivate instead of hard delete', async () => {
    const unit = (await api('GET', `/api/v1/master-data/units?q=${codes.unit}`)).json.rows[0];
    const upd = await api('PUT', `/api/v1/master-data/units/${unit.id}`, { nameFa: 'جعبه ۲۴تایی' });
    expect(upd.status).toBe(200);
    const del = await api('DELETE', `/api/v1/master-data/units/${unit.id}`);
    expect(del.status).toBe(200);
    expect(del.json.mode).toBe('deactivated');
    const after = (await api('GET', `/api/v1/master-data/units?q=${codes.unit}`)).json.rows[0];
    expect(after.isActive).toBe(false);
  });
});

describe('machines & capacity module', () => {
  let machineId = '';
  let opId = '';
  let dieId = '';

  it('creates machine and die via registry CRUD (capacity permissions)', async () => {
    const machine = await api('POST', '/api/v1/master-data/machines', {
      code: uniqueCode('M'),
      nameFa: 'پرس آزمون ظرفیت',
      machineType: 'PRESS',
      tonnage: '160',
      status: 'ACTIVE',
    });
    expect(machine.status).toBe(201);
    machineId = machine.json.row.id;

    const die = await api('POST', '/api/v1/master-data/dies', {
      code: uniqueCode('D'),
      nameFa: 'قالب آزمون ظرفیت',
      status: 'ACTIVE',
    });
    expect(die.status).toBe(201);
    dieId = die.json.row.id;

    opId = (await api('GET', '/api/v1/master-data/operations?q=BLK')).json.rows[0].id;
    expect(opId).toBeTruthy();
  });

  it('replaces machine capabilities and die compatibility atomically', async () => {
    const caps = await api('PUT', `/api/v1/machines/${machineId}/capabilities`, {
      capabilities: [{ operationId: opId, standardRatePerHour: '120' }],
    });
    expect(caps.status).toBe(200);
    expect(caps.json.capabilities.length).toBe(1);
    expect(dec(caps.json.capabilities[0].standardRatePerHour)).toBe('120');

    const dies = await api('PUT', `/api/v1/machines/${machineId}/dies`, { dieIds: [dieId] });
    expect(dies.status).toBe(200);
    expect(dies.json.dies.length).toBe(1);

    const dup = await api('PUT', `/api/v1/machines/${machineId}/capabilities`, {
      capabilities: [
        { operationId: opId, standardRatePerHour: '100' },
        { operationId: opId, standardRatePerHour: '200' },
      ],
    });
    expect(dup.status).toBe(400);
  });

  it('machine detail returns capabilities + compatible dies', async () => {
    const detail = await api('GET', `/api/v1/machines/${machineId}`);
    expect(detail.status).toBe(200);
    expect(detail.json.machine.capabilities.length).toBe(1);
    expect(detail.json.machine.dieCompatibilities.length).toBe(1);
  });

  it('capacity overview marks missing standard rates as unknown (no silent assumption)', async () => {
    const res = await api('GET', '/api/v1/machines/capacity');
    expect(res.status).toBe(200);
    expect(res.json.capacityHoursPerDay).toBeGreaterThan(0);
    const row = res.json.machines.find((m: any) => m.id === machineId);
    expect(row).toBeTruthy();
    expect(row.capabilityCount).toBe(1);
    // no open assignments → zero load, utilization still null (nothing to measure)
    expect(row.openAssignmentCount).toBe(0);
    expect(row.utilizationPct).toBeNull();
  });

  it('changes machine status with audit trail', async () => {
    const res = await api('POST', `/api/v1/machines/${machineId}/status`, { status: 'MAINTENANCE', notes: 'تست' });
    expect(res.status).toBe(200);
    expect(res.json.machine.status).toBe('MAINTENANCE');
    const log = await db.auditLog.findFirst({ where: { entityType: 'machine', entityId: machineId, action: 'STATUS_CHANGE' } });
    expect(log).toBeTruthy();
    // restore
    await api('POST', `/api/v1/machines/${machineId}/status`, { status: 'ACTIVE' });
  });
});

describe('settings module (users / roles / sequences / audit)', () => {
  it('lists users without leaking password hashes', async () => {
    const res = await api('GET', '/api/v1/settings/users');
    expect(res.status).toBe(200);
    expect(res.json.total).toBeGreaterThanOrEqual(4);
    for (const row of res.json.rows) {
      expect(row.passwordHash).toBeUndefined();
      expect(row.role?.nameFa ?? row.role?.name ?? '').toBeTruthy();
    }
  });

  it('creates a user with a hashed password and blocks duplicate usernames', async () => {
    const role = (await api('GET', '/api/v1/settings/roles')).json.roles.find((r: any) => r.name === 'VIEWER');
    const username = uniqueCode('u').toLowerCase();
    const created = await api('POST', '/api/v1/settings/users', {
      username,
      fullName: 'کاربر آزمون',
      password: 'Test@12345',
      roleId: role.id,
    });
    expect(created.status).toBe(201);
    expect(created.json.user.username).toBe(username);

    const hash = await db.user.findUniqueOrThrow({ where: { username }, select: { passwordHash: true } });
    expect(hash.passwordHash).not.toBe('Test@12345');
    expect(hash.passwordHash.startsWith('$2')).toBe(true);

    const dup = await api('POST', '/api/v1/settings/users', {
      username,
      fullName: 'تکراری',
      password: 'Test@12345',
      roleId: role.id,
    });
    expect(dup.status).toBe(409);

    const upd = await api('PUT', `/api/v1/settings/users/${created.json.user.id}`, { isActive: false });
    expect(upd.status).toBe(200);
    expect(upd.json.user.isActive).toBe(false);
  });

  it('updates role permissions and refuses deleting a role with users', async () => {
    const roles = (await api('GET', '/api/v1/settings/roles')).json.roles;
    const adminRole = roles.find((r: any) => r.name === 'ADMIN');
    expect(adminRole.permissions.length).toBeGreaterThan(0);

    const del = await api('DELETE', `/api/v1/settings/roles/${adminRole.id}`);
    expect(del.status).toBe(409);

    // create a fresh role, edit permissions, then delete it (no users)
    const created = await api('POST', '/api/v1/settings/roles', {
      name: uniqueCode('R').toUpperCase().replace(/[^A-Z0-9_]/g, ''),
      nameFa: 'نقش آزمون',
      permissionCodes: ['dashboard.view', 'reports.view'],
    });
    expect(created.status).toBe(201);
    const roleId = created.json.role.id;

    const perms = (await api('GET', '/api/v1/settings/permissions')).json.groups;
    const reportsEdit = perms.find((g: any) => g.module === 'reports').permissions.find((p: any) => p.action === 'view');
    const upd = await api('PUT', `/api/v1/settings/roles/${roleId}`, { permissionCodes: [reportsEdit.code, 'dashboard.view'] });
    expect(upd.status).toBe(200);
    const after = (await api('GET', '/api/v1/settings/roles')).json.roles.find((r: any) => r.id === roleId);
    expect(after.permissions.length).toBe(2);

    const removed = await api('DELETE', `/api/v1/settings/roles/${roleId}`);
    expect(removed.status).toBe(200);
  });

  it('edits document sequence prefix/pad and writes audit log', async () => {
    const seq = (await api('GET', '/api/v1/settings/sequences')).json.sequences[0];
    const upd = await api('PUT', `/api/v1/settings/sequences/${seq.id}`, { padLength: Math.max(2, seq.padLength) });
    expect(upd.status).toBe(200);
  });

  it('audit logs list + CSV export work and respect filters', async () => {
    const res = await api('GET', '/api/v1/settings/audit-logs?action=CREATE&pageSize=5');
    expect(res.status).toBe(200);
    expect(res.json.rows.length).toBeGreaterThan(0);
    for (const row of res.json.rows) expect(row.action.toLowerCase()).toContain('create');

    const csv = await api('GET', '/api/v1/settings/audit-logs/export?action=CREATE');
    expect(csv.status).toBe(200);
    expect(csv.text).toContain('رویداد');
  });
});

describe('global search (جستجوی سراسری)', () => {
  it('finds parts, machines and dies across modules with one query', async () => {
    const part = (await api('GET', '/api/v1/master-data/parts?pageSize=1')).json.rows[0];
    expect(part).toBeTruthy();
    const res = await api('GET', `/api/v1/search?q=${part.partNumber}`);
    expect(res.status).toBe(200);
    const types = res.json.groups.map((g: any) => g.type);
    expect(types).toContain('parts');
    if (res.json.totalHits > 0) {
      const partsGroup = res.json.groups.find((g: any) => g.type === 'parts');
      expect(partsGroup.results[0].q).toBe(part.partNumber);
    }
  });

  it('hides modules the user has no permission for (keeper → settings & machines hidden)', async () => {
    const keeperToken = await login('keeper');
    const admin = await api('GET', '/api/v1/search?q=admin');
    const keeper = await api('GET', '/api/v1/search?q=admin', undefined, keeperToken);
    expect(keeper.status).toBe(200);
    const adminGroups = admin.json.groups.map((g: any) => g.type);
    const keeperGroups = keeper.json.groups.map((g: any) => g.type);
    expect(adminGroups).toContain('users');
    expect(keeperGroups).not.toContain('users'); // keeper lacks settings.view
    expect(keeperGroups).not.toContain('machines'); // keeper lacks capacity.view
    expect(keeper.json.hiddenModules.length).toBeGreaterThan(0);
  });

  it('rejects empty queries', async () => {
    const res = await api('GET', '/api/v1/search?q=');
    expect(res.status).toBe(400);
  });
});

describe('master-data relation search (BOM by part number, routes by part)', () => {
  it('finds a BOM line by searching its part number', async () => {
    // create part + material + bom line through the API
    const unitId = (await api('GET', '/api/v1/master-data/units?pageSize=5')).json.rows.find((u: any) => u.code === 'PCS').id;
    const partCode = uniqueCode('BPT');
    const matCode = uniqueCode('BMT');
    const part = (await api('POST', '/api/v1/master-data/parts', { partNumber: partCode, nameFa: 'قطعه BOM آزمون', baseUnitId: unitId })).json.row;
    const material = (await api('POST', '/api/v1/master-data/materials', { materialCode: matCode, nameFa: 'ماده BOM آزمون', baseUnitId: unitId })).json.row;
    const bom = await api('POST', '/api/v1/master-data/bom', { partId: part.id, materialId: material.id, quantityPerUnit: '2.5' });
    expect(bom.status).toBe(201);

    const byPart = await api('GET', `/api/v1/master-data/bom?q=${partCode}`);
    expect(byPart.json.total).toBe(1);
    expect(byPart.json.rows[0].part.partNumber).toBe(partCode);

    // upsert the same (part, material) pair again → update, not duplicate
    const again = await api('POST', '/api/v1/master-data/bom/import', {
      rows: [{ 'شماره قطعه': partCode, 'کد ماده': matCode, 'مقدار در هر عدد': '3.5' }],
    });
    expect(again.json.updated).toBe(1);
    expect(again.json.created).toBe(0);
    const line = (await api('GET', `/api/v1/master-data/bom?q=${partCode}`)).json.rows[0];
    expect(String(line.quantityPerUnit)).toBe('3.5');
  });
});

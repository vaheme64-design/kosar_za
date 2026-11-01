import { PrismaClient } from '@prisma/client';

/**
 * Shared fixtures for service-level tests. Every suite builds its own
 * isolated master data with unique codes (seed data is never mutated).
 */
export const db = new PrismaClient({ log: ['error'] });

let counter = 0;
/** Short unique code that fits VarChar(16) columns (e.g. warehouses). */
export function uniqueCode(prefix: string): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36).slice(-5)}${counter}${Math.floor(Math.random() * 90 + 10)}`;
}

export interface Fixtures {
  adminId: string;
  unitSheetId: string;
  warehouseId: string;
  locationAId: string;
  locationBId: string;
  whOtherId: string;
  whOtherLocId: string;
  materialId: string;
  partId: string;
  contractId: string;
  routeId: string;
  opBlankId: string;
  opFormId: string;
  opPaintId: string;
  today: string;
}

export async function buildFixtures(): Promise<Fixtures> {
  const admin = await db.user.findFirst({ where: { username: 'admin' } });
  if (!admin) throw new Error('seed did not create the admin user');

  const unitKg = await db.unitOfMeasure.findUniqueOrThrow({ where: { code: 'KG' } });
  const unitPcs = await db.unitOfMeasure.findUniqueOrThrow({ where: { code: 'PCS' } });
  const unitSheet = await db.unitOfMeasure.findUniqueOrThrow({ where: { code: 'SHEET' } });
  const opBlank = await db.operation.findUniqueOrThrow({ where: { code: 'BLK' } });
  const opForm = await db.operation.findUniqueOrThrow({ where: { code: 'FRM' } });
  const opPaint = await db.operation.findUniqueOrThrow({ where: { code: 'PNT' } });

  const wh = await db.warehouse.create({
    data: { code: uniqueCode('WHT'), nameFa: 'انبار تست', warehouseType: 'RAW_MATERIAL' },
  });
  const locA = await db.warehouseLocation.create({
    data: { warehouseId: wh.id, code: 'LOC-A', nameFa: 'موقعیت A' },
  });
  const locB = await db.warehouseLocation.create({
    data: { warehouseId: wh.id, code: 'LOC-B', nameFa: 'موقعیت B' },
  });
  const whOther = await db.warehouse.create({
    data: { code: uniqueCode('WHO'), nameFa: 'انبار محصول تست', warehouseType: 'FINISHED_GOODS' },
  });
  const whOtherLoc = await db.warehouseLocation.create({
    data: { warehouseId: whOther.id, code: 'OLOC-A', nameFa: 'موقعیت انبار دیگر' },
  });

  const material = await db.material.create({
    data: {
      materialCode: uniqueCode('MT'),
      nameFa: 'ورق تست',
      materialType: 'SHEET',
      grade: 'ST12',
      thicknessMm: 0.8,
      unitWeightKg: 12.56,
      baseUnitId: unitKg.id,
      supplierName: 'SAPCO',
    },
  });

  const part = await db.part.create({
    data: {
      partNumber: uniqueCode('PT'),
      nameFa: 'قطعه تست',
      partType: 'FINISHED_PART',
      baseUnitId: unitPcs.id,
      standardWeightKg: 2,
      mainMaterialId: material.id,
    },
  });

  const contract = await db.materialContract.create({
    data: {
      contractNumber: uniqueCode('CT'),
      supplierName: 'SAPCO',
      materialId: material.id,
      orderDate: new Date(),
      totalQuantity: 1000,
      totalWeightKg: 12000,
    },
  });

  // an ACTIVE 3-step route for the part (scrap factors 2% / 1% / 1%)
  const route = await db.partRoute.create({
    data: { partId: part.id, version: 1, status: 'ACTIVE', name: 'مسیر تست' },
  });
  await db.partRouteStep.createMany({
    data: [
      { routeId: route.id, sequence: 1, operationId: opBlank.id, scrapFactorPct: 2 },
      { routeId: route.id, sequence: 2, operationId: opForm.id, scrapFactorPct: 1 },
      { routeId: route.id, sequence: 3, operationId: opPaint.id, scrapFactorPct: 1 },
    ],
  });

  const today = new Date().toISOString().slice(0, 10);

  return {
    adminId: admin.id,
    unitSheetId: unitSheet.id,
    warehouseId: wh.id,
    locationAId: locA.id,
    locationBId: locB.id,
    whOtherId: whOther.id,
    whOtherLocId: whOtherLoc.id,
    materialId: material.id,
    partId: part.id,
    contractId: contract.id,
    routeId: route.id,
    opBlankId: opBlank.id,
    opFormId: opForm.id,
    opPaintId: opPaint.id,
    today,
  };
}

/** Sum of signed ledger quantities for one balance dimension set. */
export async function ledgerSum(
  dims: { partId?: string | null; materialId?: string | null; warehouseId: string; locationId?: string | null; lotId?: string | null },
): Promise<{ quantity: number; weightKg: number }> {
  const rows = await db.inventoryTransaction.findMany({
    where: {
      partId: dims.partId ?? undefined,
      materialId: dims.materialId ?? undefined,
      warehouseId: dims.warehouseId,
      locationId: dims.locationId ?? undefined,
      lotId: dims.lotId ?? undefined,
    },
  });
  const sign: Record<string, 1 | -1> = {
    RECEIPT: 1, TRANSFER_IN: 1, ADJUSTMENT_IN: 1,
    ISSUE: -1, TRANSFER_OUT: -1, ADJUSTMENT_OUT: -1,
  };
  let quantity = 0;
  let weightKg = 0;
  for (const t of rows) {
    quantity += sign[t.type] * Number(t.quantity);
    weightKg += sign[t.type] * Number(t.weightKg ?? 0);
  }
  return { quantity, weightKg };
}

export async function balanceOf(dims: { partId?: string | null; materialId?: string | null; warehouseId: string; locationId?: string | null; lotId?: string | null }) {
  return db.stockBalance.findFirst({
    where: {
      partId: dims.partId ?? null,
      materialId: dims.materialId ?? null,
      warehouseId: dims.warehouseId,
      locationId: dims.locationId ?? null,
      lotId: dims.lotId ?? null,
    },
  });
}

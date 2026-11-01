import { PrismaClient } from '@prisma/client';

const db = new PrismaClient({ log: ['error'] });

async function main() {
  const admin = await db.user.findFirstOrThrow({ where: { username: 'admin' } });
  const material = await db.material.findFirstOrThrow({ where: { materialCode: { startsWith: 'MT' } } });
  const wh = await db.warehouse.findFirstOrThrow({ where: { code: { startsWith: 'WHT' } } });
  const loc = await db.warehouseLocation.findFirstOrThrow({ where: { warehouseId: wh.id, code: 'LOC-A' } });
  const sheet = await db.unitOfMeasure.findUniqueOrThrow({ where: { code: 'SHEET' } });

  const { createDocument, postDocument } = await import('../src/modules/inventory/inventory.service');

  const doc = await createDocument(
    {
      documentType: 'RECEIPT',
      documentDate: '2026-11-01',
      warehouseId: wh.id,
      lines: [{ materialId: material.id, lotNumber: 'DEBUGLOT1', quantity: 100, unitId: sheet.id, toLocationId: loc.id }],
    },
    admin.id,
    {},
  );
  console.log('draft line:', doc.lines.map((l) => ({ lotNumber: l.lotNumber, qty: l.quantity.toString() })));
  const posted = await postDocument(doc.id, admin.id, {});
  console.log('posted:', posted?.postingStatus);
  const lot = await db.materialLot.findUniqueOrThrow({
    where: { materialId_lotNumber: { materialId: material.id, lotNumber: 'DEBUGLOT1' } },
  });
  console.log('lot received:', lot.quantityReceived.toString(), 'weight:', lot.weightReceivedKg.toString());
  const bal = await db.stockBalance.findFirst({ where: { lotId: lot.id } });
  console.log('balance:', bal?.quantity.toString(), bal?.weightKg?.toString());
}

main()
  .catch((e) => {
    console.error('FAILED:', e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());

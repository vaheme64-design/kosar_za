/* eslint-disable no-console */
/**
 * KPIMS — database seed (Phase 1)
 *
 * ▓▓ DEMONSTRATION DATA ▓▓
 * Everything created here is clearly-labelled sample/master data needed to
 * develop and test the skeleton (users, units, operations, machines, ...).
 * NO operational transactions are seeded: no customer orders, no
 * manufacturing orders, no inventory documents, no stock balances.
 * Those domains are implemented in later phases.
 *
 * The seed is IDEMPOTENT: if an admin user already exists it exits without
 * changing anything. Run explicitly with:  npm run db:seed
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const db = new PrismaClient();

const DEMO_NOTICE = `
======================================================================
  KPIMS SEED — داده‌های نمونه (DEMONSTRATION DATA)
  - کاربران نمونه با گذرواژه‌های شناخته‌شده ساخته می‌شوند؛
    در محیط واقعی حتماً تغییر داده شوند.
  - هیچ سند عملیاتی (سفارش/دستور کار/سند انبار/موجودی) درج نمی‌شود.
======================================================================`;

async function main(): Promise<void> {
  console.log(DEMO_NOTICE);

  const existingUsers = await db.user.count();
  if (existingUsers > 0) {
    console.log(`[seed] users already exist (${existingUsers}) — skipping full seed (idempotent).`);
    await ensureDemoBom();
    await ensurePlanningPostGrant();
    return;
  }

  // ---------------------------------------------------------------- units
  const unitPcs = await db.unitOfMeasure.create({
    data: { code: 'PCS', nameFa: 'عدد', nameEn: 'Piece', kind: 'COUNT' },
  });
  const unitKg = await db.unitOfMeasure.create({
    data: { code: 'KG', nameFa: 'کیلوگرم', nameEn: 'Kilogram', kind: 'WEIGHT' },
  });
  await db.unitOfMeasure.create({ data: { code: 'M', nameFa: 'متر', nameEn: 'Meter', kind: 'LENGTH' } });
  await db.unitOfMeasure.create({ data: { code: 'M2', nameFa: 'مترمربع', nameEn: 'Square meter', kind: 'AREA' } });
  await db.unitOfMeasure.create({ data: { code: 'SHEET', nameFa: 'برگ', nameEn: 'Sheet', kind: 'COUNT' } });

  // ------------------------------------------------------------ operations
  const opCut = await db.operation.create({
    data: { code: 'CUT', nameFa: 'برش ورق', nameEn: 'Cutting', defaultSetupTimeMin: 20, defaultCycleTimeSec: 30 },
  });
  const opBlank = await db.operation.create({
    data: { code: 'BLK', nameFa: 'خالی‌بری', nameEn: 'Blanking', defaultSetupTimeMin: 30, defaultCycleTimeSec: 12, requiresDie: true },
  });
  const opBend = await db.operation.create({
    data: { code: 'BND', nameFa: 'خم‌کاری', nameEn: 'Bending', defaultSetupTimeMin: 25, defaultCycleTimeSec: 15 },
  });
  const opForm = await db.operation.create({
    data: { code: 'FRM', nameFa: 'پرس و فرم‌دهی', nameEn: 'Punching / Forming', defaultSetupTimeMin: 25, defaultCycleTimeSec: 15, requiresDie: true },
  });
  const opPressWeld = await db.operation.create({
    data: { code: 'PRW', nameFa: 'جوش پرس', nameEn: 'Press welding', defaultSetupTimeMin: 20, defaultCycleTimeSec: 10 },
  });
  const opCo2Weld = await db.operation.create({
    data: { code: 'COW', nameFa: 'جوش CO2', nameEn: 'CO2 welding', defaultSetupTimeMin: 15, defaultCycleTimeSec: 45 },
  });
  const opPaint = await db.operation.create({
    data: { code: 'PNT', nameFa: 'رنگ‌آمیزی', nameEn: 'Painting', defaultSetupTimeMin: 30, defaultCycleTimeSec: 20 },
  });
  const opAssembly = await db.operation.create({
    data: { code: 'ASM', nameFa: 'مونتاژ', nameEn: 'Assembly', defaultSetupTimeMin: 10, defaultCycleTimeSec: 30 },
  });

  // -------------------------------------------------------------- machines
  // نمونه‌ی ماشین‌آلات (کارخانه حدود ۲۰ پرس دارد؛ اینجا زیرمجموعه‌ی نمونه seed می‌شود)
  const pressDefs = [
    ['PRES-101', 'پرس ۶۳ تن', 63],
    ['PRES-102', 'پرس ۱۰۰ تن', 100],
    ['PRES-103', 'پرس ۱۶۰ تن', 160],
    ['PRES-104', 'پرس ۲۰۰ تن', 200],
    ['PRES-105', 'پرس ۲۵۰ تن', 250],
    ['PRES-106', 'پرس ۳۱۵ تن', 315],
  ] as const;
  const presses = [] as { id: string; code: string }[];
  for (const [code, nameFa, tonnage] of pressDefs) {
    presses.push(
      await db.machine.create({
        data: { code, nameFa, machineType: 'PRESS', tonnage, location: 'سالن پرس' },
        select: { id: true, code: true },
      }),
    );
  }
  const cutGuillotine = await db.machine.create({
    data: { code: 'CUT-201', nameFa: 'قینیوتین برش ۴ متر', machineType: 'CUTTING', location: 'سالن برش' },
  });
  const cutLaser = await db.machine.create({
    data: { code: 'CUT-202', nameFa: 'دستگاه برش لیزر', machineType: 'CUTTING', location: 'سالن برش' },
  });
  const weldPress1 = await db.machine.create({
    data: { code: 'WPR-301', nameFa: 'ایستگاه جوش پرس ۱', machineType: 'PRESS_WELDING', location: 'سالن جوش' },
  });
  const weldPress2 = await db.machine.create({
    data: { code: 'WPR-302', nameFa: 'ایستگاه جوش پرس ۲', machineType: 'PRESS_WELDING', location: 'سالن جوش' },
  });
  const weldCo21 = await db.machine.create({
    data: { code: 'WCO-401', nameFa: 'ایستگاه جوش CO2 شماره ۱', machineType: 'CO2_WELDING', location: 'سالن جوش' },
  });
  const weldCo22 = await db.machine.create({
    data: { code: 'WCO-402', nameFa: 'ایستگاه جوش CO2 شماره ۲', machineType: 'CO2_WELDING', location: 'سالن جوش' },
  });
  const paintLine = await db.machine.create({
    data: { code: 'PNT-501', nameFa: 'خط رنگ الکترواستاتیک', machineType: 'PAINTING', location: 'سالن رنگ' },
  });
  const assemblyStation = await db.machine.create({
    data: { code: 'ASM-601', nameFa: 'ایستگاه مونتاژ', machineType: 'ASSEMBLY', location: 'سالن مونتاژ' },
  });

  // ------------------------------------------------- machine capabilities
  const capabilityRows: { machineId: string; operationId: string; standardRatePerHour: number }[] = [];
  const pressOps: { id: string; rate: number }[] = [
    { id: opBlank.id, rate: 280 },
    { id: opBend.id, rate: 220 },
    { id: opForm.id, rate: 240 },
  ];
  for (const press of presses) {
    for (const op of pressOps) {
      capabilityRows.push({ machineId: press.id, operationId: op.id, standardRatePerHour: op.rate });
    }
  }
  for (const m of [cutGuillotine, cutLaser]) {
    capabilityRows.push({ machineId: m.id, operationId: opCut.id, standardRatePerHour: m.code === 'CUT-202' ? 60 : 90 });
  }
  for (const m of [weldPress1, weldPress2]) {
    capabilityRows.push({ machineId: m.id, operationId: opPressWeld.id, standardRatePerHour: 200 });
  }
  for (const m of [weldCo21, weldCo22]) {
    capabilityRows.push({ machineId: m.id, operationId: opCo2Weld.id, standardRatePerHour: 60 });
  }
  capabilityRows.push({ machineId: paintLine.id, operationId: opPaint.id, standardRatePerHour: 150 });
  capabilityRows.push({ machineId: assemblyStation.id, operationId: opAssembly.id, standardRatePerHour: 80 });
  await db.machineCapability.createMany({ data: capabilityRows });

  // ----------------------------------------------------------------- dies
  const dieDoor = await db.die.create({
    data: { code: 'DIE-101', nameFa: 'قالب خالی‌بری یراق درب', storageLocation: 'انبار قالب - قفسه A' },
  });
  const dieHood = await db.die.create({
    data: { code: 'DIE-102', nameFa: 'قالب فرم تقویت‌کننده کاپوت', storageLocation: 'انبار قالب - قفسه A' },
  });
  const dieBend = await db.die.create({
    data: { code: 'DIE-103', nameFa: 'قالب خم تقویت‌کننده', storageLocation: 'انبار قالب - قفسه B' },
  });
  const dieFloor = await db.die.create({
    data: { code: 'DIE-104', nameFa: 'قالب برش صفحه کف', storageLocation: 'انبار قالب - قفسه B' },
  });
  await db.machineDieCompatibility.createMany({
    data: [
      { machineId: presses[1]!.id, dieId: dieDoor.id },
      { machineId: presses[2]!.id, dieId: dieDoor.id },
      { machineId: presses[3]!.id, dieId: dieHood.id },
      { machineId: presses[4]!.id, dieId: dieHood.id },
      { machineId: presses[0]!.id, dieId: dieBend.id },
      { machineId: presses[5]!.id, dieId: dieFloor.id },
    ],
  });

  // ------------------------------------------------------------ warehouses
  const whRaw = await db.warehouse.create({
    data: { code: 'WH-RM', nameFa: 'انبار مواد اولیه', warehouseType: 'RAW_MATERIAL' },
  });
  const whWip = await db.warehouse.create({
    data: { code: 'WH-WIP', nameFa: 'انبار محصول در جریان ساخت', warehouseType: 'WIP' },
  });
  const whFg = await db.warehouse.create({
    data: { code: 'WH-FG', nameFa: 'انبار محصول تکمیلی', warehouseType: 'FINISHED_GOODS' },
  });
  const whScrap = await db.warehouse.create({
    data: { code: 'WH-SCR', nameFa: 'انبار ضایعات', warehouseType: 'SCRAP' },
  });
  const locRawA1 = await db.warehouseLocation.create({
    data: { warehouseId: whRaw.id, code: 'RM-A01', nameFa: 'قفسه A - ردیف ۱' },
  });
  await db.warehouseLocation.create({ data: { warehouseId: whRaw.id, code: 'RM-A02', nameFa: 'قفسه A - ردیف ۲' } });
  const locWip1 = await db.warehouseLocation.create({
    data: { warehouseId: whWip.id, code: 'WIP-01', nameFa: 'پالت‌های بین عملیاتی ۱' },
  });
  await db.warehouseLocation.create({ data: { warehouseId: whWip.id, code: 'WIP-02', nameFa: 'پالت‌های بین عملیاتی ۲' } });
  const locFgA1 = await db.warehouseLocation.create({
    data: { warehouseId: whFg.id, code: 'FG-A01', nameFa: 'قفسه محصول تکمیلی A1' },
  });
  await db.warehouseLocation.create({ data: { warehouseId: whScrap.id, code: 'SCR-01', nameFa: 'محوطه ضایعات فلزی' } });

  // ---------------------------------------------------------------- shifts
  const shift1 = await db.shift.create({ data: { code: 'SH1', nameFa: 'شیفت صبح', startTime: '06:00', endTime: '14:00' } });
  await db.shift.create({ data: { code: 'SH2', nameFa: 'شیفت عصر', startTime: '14:00', endTime: '22:00' } });
  await db.shift.create({ data: { code: 'SH3', nameFa: 'شیفت شب', startTime: '22:00', endTime: '06:00' } });

  // ------------------------------------------------------------- customers
  const custSaipa = await db.customer.create({
    data: { code: 'CUST-001', nameFa: 'شرکت سایپا', nameEn: 'SAIPA', phone: '021-0000' },
  });
  const custIkco = await db.customer.create({
    data: { code: 'CUST-002', nameFa: 'ایران‌خودرو', nameEn: 'IKCO' },
  });
  await db.customer.create({ data: { code: 'CUST-003', nameFa: 'مگاموتور', nameEn: 'Mega Motor' } });

  // ------------------------------------------------------------- materials
  const matSt12_08 = await db.material.create({
    data: {
      materialCode: 'ST12-0.8-1000x2000', nameFa: 'ورق سرد ST12 ضخامت ۰٫۸', nameEn: 'Cold rolled ST12 0.8mm',
      materialType: 'SHEET', grade: 'ST12', thicknessMm: 0.8, widthMm: 1000, lengthMm: 2000,
      unitWeightKg: 12.56, baseUnitId: unitKg.id, supplierName: 'SAPCO',
    },
  });
  const matSt12_07 = await db.material.create({
    data: {
      materialCode: 'ST12-0.7-1000x2000', nameFa: 'ورق سرد ST12 ضخامت ۰٫۷', nameEn: 'Cold rolled ST12 0.7mm',
      materialType: 'SHEET', grade: 'ST12', thicknessMm: 0.7, widthMm: 1000, lengthMm: 2000,
      unitWeightKg: 10.99, baseUnitId: unitKg.id, supplierName: 'SAPCO',
    },
  });
  const matSt37_15 = await db.material.create({
    data: {
      materialCode: 'ST37-1.5-1250x2500', nameFa: 'ورق گرم ST37 ضخامت ۱٫۵', nameEn: 'Hot rolled ST37 1.5mm',
      materialType: 'SHEET', grade: 'ST37', thicknessMm: 1.5, widthMm: 1250, lengthMm: 2500,
      unitWeightKg: 36.79, baseUnitId: unitKg.id, supplierName: 'SAPCO',
    },
  });
  const matSt37_20 = await db.material.create({
    data: {
      materialCode: 'ST37-2.0-1250x2500', nameFa: 'ورق گرم ST37 ضخامت ۲٫۰', nameEn: 'Hot rolled ST37 2.0mm',
      materialType: 'SHEET', grade: 'ST37', thicknessMm: 2.0, widthMm: 1250, lengthMm: 2500,
      unitWeightKg: 49.06, baseUnitId: unitKg.id, supplierName: 'SAPCO',
    },
  });
  await db.material.create({
    data: {
      materialCode: 'PNT-BLK-EP', nameFa: 'رنگ پودری الکترواستاتیک مشکی', nameEn: 'Black powder coating',
      materialType: 'PAINT', baseUnitId: unitKg.id, supplierName: 'SAPCO',
    },
  });

  // ----------------------------------------------------------------- parts
  const partDoorL = await db.part.create({
    data: {
      partNumber: 'KP-1001', nameFa: 'یراق درب جلو چپ', nameEn: 'Front door reinforcement LH',
      partType: 'FINISHED_PART', baseUnitId: unitPcs.id, standardWeightKg: 2.35,
      mainMaterialId: matSt12_08.id, primaryCustomerId: custSaipa.id,
      description: 'نمونه — قطعه فلزی خودرویی',
    },
  });
  const partDoorR = await db.part.create({
    data: {
      partNumber: 'KP-1002', nameFa: 'یراق درب جلو راست', nameEn: 'Front door reinforcement RH',
      partType: 'FINISHED_PART', baseUnitId: unitPcs.id, standardWeightKg: 2.35,
      mainMaterialId: matSt12_08.id, primaryCustomerId: custSaipa.id,
      description: 'نمونه',
    },
  });
  const partHood = await db.part.create({
    data: {
      partNumber: 'KP-1003', nameFa: 'تقویت‌کننده کاپوت', nameEn: 'Hood reinforcement',
      partType: 'FINISHED_PART', baseUnitId: unitPcs.id, standardWeightKg: 1.8,
      mainMaterialId: matSt37_15.id, primaryCustomerId: custIkco.id,
      description: 'نمونه',
    },
  });
  const partTrunk = await db.part.create({
    data: {
      partNumber: 'KP-1004', nameFa: 'صفحه کف صندوق', nameEn: 'Trunk floor panel',
      partType: 'FINISHED_PART', baseUnitId: unitPcs.id, standardWeightKg: 3.1,
      mainMaterialId: matSt12_07.id, primaryCustomerId: custIkco.id,
      description: 'نمونه',
    },
  });
  const partBumper = await db.part.create({
    data: {
      partNumber: 'KP-1005', nameFa: 'تقویت‌کننده سپر عقب', nameEn: 'Rear bumper reinforcement',
      partType: 'FINISHED_PART', baseUnitId: unitPcs.id, standardWeightKg: 1.25,
      mainMaterialId: matSt37_20.id, primaryCustomerId: custSaipa.id,
      description: 'نمونه',
    },
  });

  // ------------------------------------------- demo production route (v1 active + v2 draft)
  const routeV1 = await db.partRoute.create({
    data: {
      partId: partDoorL.id, version: 1, status: 'ACTIVE', effectiveFrom: new Date('2025-03-21'),
      name: 'مسیر تولید یراق درب جلو چپ — نسخه ۱',
    },
  });
  await db.partRouteStep.createMany({
    data: [
      { routeId: routeV1.id, sequence: 1, operationId: opBlank.id, machineId: presses[2]!.id, dieId: dieDoor.id, setupTimeMin: 30, cycleTimeSec: 12, scrapFactorPct: 1.5 },
      { routeId: routeV1.id, sequence: 2, operationId: opForm.id, machineId: presses[3]!.id, dieId: dieHood.id, setupTimeMin: 25, cycleTimeSec: 15, scrapFactorPct: 1.0 },
      { routeId: routeV1.id, sequence: 3, operationId: opPressWeld.id, machineId: weldPress1.id, setupTimeMin: 20, cycleTimeSec: 10, scrapFactorPct: 0.8 },
      { routeId: routeV1.id, sequence: 4, operationId: opCo2Weld.id, machineId: weldCo21.id, setupTimeMin: 15, cycleTimeSec: 45, scrapFactorPct: 0.5 },
      { routeId: routeV1.id, sequence: 5, operationId: opPaint.id, machineId: paintLine.id, setupTimeMin: 30, cycleTimeSec: 20, scrapFactorPct: 1.0 },
      { routeId: routeV1.id, sequence: 6, operationId: opAssembly.id, machineId: assemblyStation.id, setupTimeMin: 10, cycleTimeSec: 30, scrapFactorPct: 0.2 },
    ],
  });
  const routeV2 = await db.partRoute.create({
    data: {
      partId: partDoorL.id, version: 2, status: 'DRAFT',
      name: 'مسیر تولید یراق درب جلو چپ — نسخه ۲ (پیش‌نویس)',
      description: 'نمونه‌ی نسخه‌بندی مسیر: جاگذاری ایستگاه دوم جوش CO2',
    },
  });
  await db.partRouteStep.createMany({
    data: [
      { routeId: routeV2.id, sequence: 1, operationId: opBlank.id, machineId: presses[2]!.id, dieId: dieDoor.id, setupTimeMin: 30, cycleTimeSec: 12, scrapFactorPct: 1.5 },
      { routeId: routeV2.id, sequence: 2, operationId: opForm.id, machineId: presses[3]!.id, dieId: dieHood.id, setupTimeMin: 25, cycleTimeSec: 15, scrapFactorPct: 1.0 },
      { routeId: routeV2.id, sequence: 3, operationId: opPressWeld.id, machineId: weldPress2.id, setupTimeMin: 20, cycleTimeSec: 10, scrapFactorPct: 0.8 },
      { routeId: routeV2.id, sequence: 4, operationId: opCo2Weld.id, machineId: weldCo22.id, setupTimeMin: 15, cycleTimeSec: 40, scrapFactorPct: 0.5 },
      { routeId: routeV2.id, sequence: 5, operationId: opPaint.id, machineId: paintLine.id, setupTimeMin: 30, cycleTimeSec: 20, scrapFactorPct: 1.0 },
      { routeId: routeV2.id, sequence: 6, operationId: opAssembly.id, machineId: assemblyStation.id, setupTimeMin: 10, cycleTimeSec: 30, scrapFactorPct: 0.2 },
    ],
  });

  // Small routes for the other demo parts (single draft route each)
  for (const [idx, part] of [partDoorR, partHood, partTrunk, partBumper].entries()) {
    const route = await db.partRoute.create({
      data: { partId: part.id, version: 1, status: 'DRAFT', name: `مسیر تولید ${part.nameFa} — نسخه ۱ (پیش‌نویس)` },
    });
    await db.partRouteStep.createMany({
      data: [
        { routeId: route.id, sequence: 1, operationId: opBlank.id, scrapFactorPct: 1.5 },
        { routeId: route.id, sequence: 2, operationId: [opForm, opBend, opCut, opForm][idx]!.id, scrapFactorPct: 1.0 },
        { routeId: route.id, sequence: 3, operationId: opPressWeld.id, scrapFactorPct: 0.8 },
        { routeId: route.id, sequence: 4, operationId: opPaint.id, scrapFactorPct: 1.0 },
      ],
    });
  }

  // ------------------------------------------------- roles / permissions / users
  const moduleDefs: [string, string][] = [
    ['dashboard', 'داشبورد'],
    ['masterdata', 'اطلاعات پایه'],
    ['inventory', 'انبار'],
    ['production', 'تولید'],
    ['wip', 'قطعات در جریان ساخت'],
    ['planning', 'برنامه‌ریزی تولید'],
    ['capacity', 'ماشین‌آلات و ظرفیت'],
    ['materials', 'مواد SAPCO'],
    ['reports', 'گزارش‌ها'],
    ['settings', 'کاربران و تنظیمات'],
  ];
  const actionDefs: [string, string][] = [
    ['view', 'مشاهده'],
    ['manage', 'ایجاد/ویرایش'],
    ['post', 'قطع‌بوش/تأیید'],
  ];

  const permissionIds = new Map<string, string>();
  for (const [module, moduleFa] of moduleDefs) {
    for (const [action, actionFa] of actionDefs) {
      const perm = await db.permission.create({
        data: {
          code: `${module}.${action}`,
          module,
          action,
          description: `${actionFa} ${moduleFa}`,
        },
      });
      permissionIds.set(perm.code, perm.id);
    }
  }

  const roleAdmin = await db.role.create({
    data: { name: 'ADMIN', nameFa: 'مدیر سامانه', description: 'دسترسی کامل به همه ماژول‌ها' },
  });
  const roleProduction = await db.role.create({
    data: { name: 'PRODUCTION_MANAGER', nameFa: 'مدیر تولید', description: 'تولید، برنامه‌ریزی، WIP و ظرفیت' },
  });
  const roleWarehouse = await db.role.create({
    data: { name: 'WAREHOUSE_KEEPER', nameFa: 'انباردار', description: 'سندهای انبار و مواد SAPCO' },
  });
  const roleViewer = await db.role.create({
    data: { name: 'VIEWER', nameFa: 'مشاهده‌گر', description: 'فقط مشاهده' },
  });

  const grant = (roleId: string, codes: string[]) =>
    db.rolePermission.createMany({
      data: codes.map((code) => ({
        roleId,
        permissionId: permissionIds.get(code)!,
      })),
    });

  await grant(roleAdmin.id, [...permissionIds.keys()]);
  await grant(roleProduction.id, [
    'dashboard.view', 'masterdata.view', 'production.view', 'production.manage', 'production.post',
    'wip.view', 'wip.manage', 'planning.view', 'planning.manage', 'planning.post', 'capacity.view', 'reports.view',
  ]);
  await grant(roleWarehouse.id, [
    'dashboard.view', 'masterdata.view', 'inventory.view', 'inventory.manage', 'inventory.post',
    'materials.view', 'materials.manage', 'reports.view',
  ]);
  await grant(
    roleViewer.id,
    moduleDefs.map(([m]) => `${m}.view`),
  );

  const password = await bcrypt.hash('Kpims@1404', 10);
  await db.user.create({
    data: { username: 'admin', fullName: 'مدیر سامانه (نمونه)', passwordHash: password, roleId: roleAdmin.id },
  });
  await db.user.create({
    data: { username: 'planner', fullName: 'کارشناس برنامه‌ریزی (نمونه)', passwordHash: password, roleId: roleProduction.id },
  });
  await db.user.create({
    data: { username: 'keeper', fullName: 'انباردار (نمونه)', passwordHash: password, roleId: roleWarehouse.id },
  });
  await db.user.create({
    data: { username: 'viewer', fullName: 'مشاهده‌گر (نمونه)', passwordHash: password, roleId: roleViewer.id },
  });

  // ----------------------------------------------------- document sequences
  const seqDefs: [string, string, string][] = [
    ['CO', 'سفارش مشتری', 'CO'],
    ['PP', 'برنامه تولید', 'PP'],
    ['MO', 'دستور کار ساخت', 'MO'],
    ['PR', 'گزارش تولید', 'PR'],
    ['TRF', 'انتقال تولید', 'TRF'],
    ['INV', 'سند انبار', 'INV'],
    ['TX', 'تراکنش انبار', 'TX'],
  ];
  for (const [key, title, prefix] of seqDefs) {
    await db.documentSequence.create({
      data: { key, title, prefix, nextNumber: 1001, padLength: 6, resetPolicy: 'NEVER' },
    });
  }

  // -------------------------------------------------------- system settings
  const settings: [string, string, 'STRING' | 'NUMBER' | 'BOOLEAN', string][] = [
    ['factory.name', 'کارخانه قطعات فلزی کوثر', 'STRING', 'نام کارخانه'],
    ['app.timezone', 'Asia/Tehran', 'STRING', 'منطقه زمانی مرجع'],
    ['app.calendar', 'jalali', 'STRING', 'تقویم نمایشی'],
    ['inventory.allowNegativeStock', 'false', 'BOOLEAN', 'اجازه موجودی منفی'],
    ['planning.defaultHorizonDays', '30', 'NUMBER', 'افق پیش‌فرض برنامه‌ریزی (روز)'],
    ['app.version', '0.1.0', 'STRING', 'نسخه طرح دیتابیس/سامانه'],
  ];
  for (const [key, value, valueType, description] of settings) {
    await db.systemSetting.create({ data: { key, value, valueType, description } });
  }

  console.log('[seed] demo master data created:');
  console.log(`        - units, ${moduleDefs.length * actionDefs.length} permissions, 4 roles, 4 users`);
  console.log('        - 8 operations, 14 machines, 4 dies, 4 warehouses, 3 shifts, 3 customers');
  console.log('        - 5 materials (SAPCO), 5 parts, 5 production routes (1 active + 4 draft)');
  console.log('        - 7 document sequences, 6 system settings');
  console.log('[seed] demo users: admin | planner | keeper | viewer  — password: Kpims@1404');
  console.log('[seed] NO operational transactions were created (by design in Phase 1).');
  await ensureDemoBom();
  await ensurePlanningPostGrant();
}

/**
 * Idempotent demo BOM (part_material_requirements) for the five demo parts.
 * DEMO DATA: consumption per unit = the part standard weight (net).
 * Only fills rows that do not exist yet; never overwrites manual entries.
 */
/** Idempotent backfill: the planner (production manager) role may confirm plans. */
async function ensurePlanningPostGrant(): Promise<void> {
  const perm = await db.permission.findUnique({ where: { code: 'planning.post' } });
  const role = await db.role.findUnique({ where: { name: 'PRODUCTION_MANAGER' } });
  if (!perm || !role) return;
  const exists = await db.rolePermission.findUnique({ where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } }, select: { roleId: true } });
  if (!exists) {
    await db.rolePermission.create({ data: { roleId: role.id, permissionId: perm.id } });
    console.log('[seed] granted planning.post to PRODUCTION_MANAGER (برنامه‌ریز می‌تواند برنامه را تأیید کند).');
  }
}

async function ensureDemoBom(): Promise<void> {
  const parts = await db.part.findMany({
    where: { partNumber: { in: ['KP-1001', 'KP-1002', 'KP-1003', 'KP-1004', 'KP-1005'] }, mainMaterialId: { not: null } },
    select: { id: true, partNumber: true, mainMaterialId: true, standardWeightKg: true },
  });
  let created = 0;
  for (const part of parts) {
    if (!part.mainMaterialId || !part.standardWeightKg) continue;
    const exists = await db.partMaterialRequirement.findFirst({
      where: { partId: part.id, materialId: part.mainMaterialId },
      select: { id: true },
    });
    if (exists) continue;
    await db.partMaterialRequirement.create({
      data: {
        partId: part.id,
        materialId: part.mainMaterialId,
        quantityPerUnit: part.standardWeightKg,
        weightKgPerUnit: part.standardWeightKg,
        notes: 'نمونه (DEMO) — سرانه مصرف برابر وزن استاندارد قطعه',
      },
    });
    created += 1;
  }
  if (created > 0) console.log(`[seed] demo BOM rows created for ${created} part(s) (DEMO — سرانه مصرف = وزن استاندارد).`);
}

main()
  .catch((err) => {
    console.error('[seed] failed:', err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());

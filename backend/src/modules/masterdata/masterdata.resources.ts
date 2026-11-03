import { z } from 'zod';
import { ApiError } from '../../lib/http';

/**
 * Master-data / capacity resource registry.
 *
 * A single declarative description per entity drives the generic CRUD,
 * search, CSV export and CSV import endpoints — so every master-data screen
 * gets the same behaviour (جستجو، خروجی و ورودی اکسل) without duplicated code.
 */

export const decimalField = z
  .union([z.number(), z.string()])
  .transform((v) => String(v))
  .nullable()
  .optional();

export const optionalTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional();

export const requiredCode = (max: number) => z.string().trim().min(1).max(max);

// ---------------------------------------------------------------------------
// column helpers — one definition drives both table UI and CSV export
// ---------------------------------------------------------------------------

export interface CsvColumn {
  /** Persian Excel header */
  header: string;
  /** row key for scalar columns (used when `get` is absent) */
  key?: string;
  /** custom value for export; return string | number | null */
  get?: (row: any) => string | number | null;
}

export interface ImportColumn {
  /** CSV header name (Persian) — matching is trimmed + whitespace-insensitive */
  header: string;
  /** target key in the prisma data object */
  key: string;
  kind?: 'string' | 'int' | 'decimal' | 'boolean' | 'enum';
  /** allowed enum values (kind = enum) */
  values?: readonly string[];
  /** required in every imported row */
  required?: boolean;
  /** resolve external reference (returns id or throws Persian error) */
  ref?: 'unit' | 'material' | 'part' | 'machine' | 'operation' | 'die' | 'warehouse' | 'customer';
}

export interface ResourceDef {
  key: string;
  /** prisma delegate name */
  model: string;
  /** permission module used for view/manage guards */
  permModule: string;
  labelFa: string;
  uniqueField: string;
  /** free-text search across these scalar fields (contains, insensitive) */
  searchFields: string[];
  /** free-text search inside relations, e.g. { part: ['partNumber','nameFa'] } */
  searchRelations?: Record<string, string[]>;
  /** exact-match query filters allowed (field → optional value map) */
  filters: string[];
  /** enum filters: { [queryKey]: allowedValues } — validated before query */
  enumFilters?: Record<string, readonly string[]>;
  orderBy: Record<string, 'asc' | 'desc'>;
  /** prisma include for list/get (kept small) */
  include?: Record<string, unknown>;
  /** extra relation filter applied to list (e.g. location belongs to warehouse) */
  create: z.ZodTypeAny;
  update: z.ZodTypeAny;
  /** CSV export columns */
  columns: CsvColumn[];
  /** CSV import mapping — omit for resources without import (e.g. joins handled elsewhere) */
  import?: { columns: ImportColumn[]; example: Record<string, string> };
  /** delete strategy */
  remove: 'soft' | 'hard';
  /** for soft: field + inactive value */
  soft?: { field: 'status' | 'isActive'; value: unknown; activeWhere?: Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// enum values (mirrors prisma schema)
// ---------------------------------------------------------------------------

const PART_TYPES = ['FINISHED_PART', 'SEMI_FINISHED', 'SUBASSEMBLY'] as const;
const PART_STATUSES = ['ACTIVE', 'INACTIVE', 'PHASED_OUT'] as const;
const MATERIAL_TYPES = ['SHEET', 'COIL', 'PROFILE', 'PAINT', 'CONSUMABLE', 'OTHER'] as const;
const MATERIAL_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
const UNIT_KINDS = ['COUNT', 'WEIGHT', 'LENGTH', 'AREA'] as const;
const MACHINE_TYPES = ['PRESS', 'CUTTING', 'PRESS_WELDING', 'CO2_WELDING', 'PAINTING', 'ASSEMBLY', 'OTHER'] as const;
const MACHINE_STATUSES = ['ACTIVE', 'MAINTENANCE', 'BREAKDOWN', 'RETIRED'] as const;
const DIE_STATUSES = ['ACTIVE', 'MAINTENANCE', 'RETIRED'] as const;
const WAREHOUSE_TYPES = ['RAW_MATERIAL', 'WIP', 'FINISHED_GOODS', 'SCRAP', 'TOOLS'] as const;
const ROUTE_STATUSES = ['DRAFT', 'ACTIVE', 'RETIRED'] as const;
const CONTRACT_STATUSES = ['OPEN', 'PARTIALLY_RECEIVED', 'COMPLETED', 'CANCELLED'] as const;

export const MD_ENUMS: Record<string, readonly string[]> = {
  partType: PART_TYPES,
  partStatus: PART_STATUSES,
  materialType: MATERIAL_TYPES,
  materialStatus: MATERIAL_STATUSES,
  unitKind: UNIT_KINDS,
  machineType: MACHINE_TYPES,
  machineStatus: MACHINE_STATUSES,
  dieStatus: DIE_STATUSES,
  warehouseType: WAREHOUSE_TYPES,
  routeStatus: ROUTE_STATUSES,
  contractStatus: CONTRACT_STATUSES,
};

// ---------------------------------------------------------------------------
// resources
// ---------------------------------------------------------------------------

export const RESOURCES: Record<string, ResourceDef> = {
  parts: {
    key: 'parts',
    model: 'part',
    permModule: 'masterdata',
    labelFa: 'قطعه',
    uniqueField: 'partNumber',
    searchFields: ['partNumber', 'nameFa', 'nameEn', 'description'],
    filters: ['partType', 'mainMaterialId', 'primaryCustomerId', 'baseUnitId'],
    enumFilters: { partType: PART_TYPES, status: PART_STATUSES },
    orderBy: { partNumber: 'asc' },
    include: {
      baseUnit: { select: { code: true, nameFa: true } },
      mainMaterial: { select: { materialCode: true, nameFa: true } },
      primaryCustomer: { select: { code: true, nameFa: true } },
    },
    create: z.object({
      partNumber: requiredCode(64),
      nameFa: requiredCode(190),
      nameEn: optionalTrimmed(190),
      partType: z.enum(PART_TYPES).optional(),
      status: z.enum(PART_STATUSES).optional(),
      baseUnitId: z.string().uuid(),
      standardWeightKg: decimalField,
      mainMaterialId: z.string().uuid().nullish(),
      primaryCustomerId: z.string().uuid().nullish(),
      description: optionalTrimmed(2000),
    }),
    update: z.object({
      nameFa: requiredCode(190).optional(),
      nameEn: optionalTrimmed(190),
      partType: z.enum(PART_TYPES).optional(),
      status: z.enum(PART_STATUSES).optional(),
      baseUnitId: z.string().uuid().optional(),
      standardWeightKg: decimalField,
      mainMaterialId: z.string().uuid().nullish(),
      primaryCustomerId: z.string().uuid().nullish(),
      description: optionalTrimmed(2000),
    }),
    remove: 'soft',
    soft: { field: 'status', value: 'INACTIVE' },
    columns: [
      { header: 'شماره قطعه', key: 'partNumber' },
      { header: 'نام فارسی', key: 'nameFa' },
      { header: 'نام انگلیسی', get: (r) => r.nameEn },
      { header: 'نوع', get: (r) => r.partType },
      { header: 'وضعیت', get: (r) => r.status },
      { header: 'واحد', get: (r) => r.baseUnit?.nameFa ?? '' },
      { header: 'وزن استاندارد (کیلوگرم)', get: (r) => r.standardWeightKg },
      { header: 'ماده اصلی', get: (r) => r.mainMaterial?.nameFa ?? '' },
      { header: 'مشتری اصلی', get: (r) => r.primaryCustomer?.nameFa ?? '' },
      { header: 'توضیحات', get: (r) => r.description },
    ],
    import: {
      example: { 'شماره قطعه': 'K-1234', 'نام فارسی': 'یراق درب جلو چپ', واحد: 'PCS', 'وزن استاندارد (کیلوگرم)': '2.35' },
      columns: [
        { header: 'شماره قطعه', key: 'partNumber', required: true },
        { header: 'نام فارسی', key: 'nameFa', required: true },
        { header: 'نام انگلیسی', key: 'nameEn' },
        { header: 'نوع', key: 'partType', kind: 'enum', values: PART_TYPES },
        { header: 'واحد', key: 'baseUnitId', kind: 'string', ref: 'unit', required: true },
        { header: 'وزن استاندارد (کیلوگرم)', key: 'standardWeightKg', kind: 'decimal' },
        { header: 'ماده اصلی', key: 'mainMaterialId', ref: 'material' },
        { header: 'مشتری اصلی', key: 'primaryCustomerId', ref: 'customer' },
        { header: 'توضیحات', key: 'description' },
      ],
    },
  },

  materials: {
    key: 'materials',
    model: 'material',
    permModule: 'masterdata',
    labelFa: 'ماده اولیه',
    uniqueField: 'materialCode',
    searchFields: ['materialCode', 'nameFa', 'nameEn', 'grade', 'supplierName'],
    filters: ['materialType', 'supplierName', 'baseUnitId'],
    enumFilters: { materialType: MATERIAL_TYPES, status: MATERIAL_STATUSES },
    orderBy: { materialCode: 'asc' },
    include: { baseUnit: { select: { code: true, nameFa: true } } },
    create: z.object({
      materialCode: requiredCode(64),
      nameFa: requiredCode(190),
      nameEn: optionalTrimmed(190),
      materialType: z.enum(MATERIAL_TYPES).optional(),
      grade: optionalTrimmed(64),
      thicknessMm: decimalField,
      widthMm: decimalField,
      lengthMm: decimalField,
      unitWeightKg: decimalField,
      baseUnitId: z.string().uuid(),
      supplierName: optionalTrimmed(190),
      status: z.enum(MATERIAL_STATUSES).optional(),
      notes: optionalTrimmed(2000),
    }),
    update: z.object({
      nameFa: requiredCode(190).optional(),
      nameEn: optionalTrimmed(190),
      materialType: z.enum(MATERIAL_TYPES).optional(),
      grade: optionalTrimmed(64),
      thicknessMm: decimalField,
      widthMm: decimalField,
      lengthMm: decimalField,
      unitWeightKg: decimalField,
      baseUnitId: z.string().uuid().optional(),
      supplierName: optionalTrimmed(190),
      status: z.enum(MATERIAL_STATUSES).optional(),
      notes: optionalTrimmed(2000),
    }),
    remove: 'soft',
    soft: { field: 'status', value: 'INACTIVE' },
    columns: [
      { header: 'کد ماده', key: 'materialCode' },
      { header: 'نام فارسی', key: 'nameFa' },
      { header: 'نام انگلیسی', get: (r) => r.nameEn },
      { header: 'نوع', get: (r) => r.materialType },
      { header: 'گرید', get: (r) => r.grade },
      { header: 'ضخامت (میلی‌متر)', get: (r) => r.thicknessMm },
      { header: 'عرض (میلی‌متر)', get: (r) => r.widthMm },
      { header: 'طول (میلی‌متر)', get: (r) => r.lengthMm },
      { header: 'وزن واحد (کیلوگرم)', get: (r) => r.unitWeightKg },
      { header: 'واحد', get: (r) => r.baseUnit?.nameFa ?? '' },
      { header: 'تأمین‌کننده', get: (r) => r.supplierName },
      { header: 'وضعیت', get: (r) => r.status },
      { header: 'توضیحات', get: (r) => r.notes },
    ],
    import: {
      example: { 'کد ماده': 'SHEET-ST12-1.5', 'نام فارسی': 'ورق ST12 ضخامت ۱٫۵', واحد: 'KG', 'ضخامت (میلی‌متر)': '1.5' },
      columns: [
        { header: 'کد ماده', key: 'materialCode', required: true },
        { header: 'نام فارسی', key: 'nameFa', required: true },
        { header: 'نام انگلیسی', key: 'nameEn' },
        { header: 'نوع', key: 'materialType', kind: 'enum', values: MATERIAL_TYPES },
        { header: 'گرید', key: 'grade' },
        { header: 'ضخامت (میلی‌متر)', key: 'thicknessMm', kind: 'decimal' },
        { header: 'عرض (میلی‌متر)', key: 'widthMm', kind: 'decimal' },
        { header: 'طول (میلی‌متر)', key: 'lengthMm', kind: 'decimal' },
        { header: 'وزن واحد (کیلوگرم)', key: 'unitWeightKg', kind: 'decimal' },
        { header: 'واحد', key: 'baseUnitId', ref: 'unit', required: true },
        { header: 'تأمین‌کننده', key: 'supplierName' },
        { header: 'توضیحات', key: 'notes' },
      ],
    },
  },

  units: {
    key: 'units',
    model: 'unitOfMeasure',
    permModule: 'masterdata',
    labelFa: 'واحد شمارش',
    uniqueField: 'code',
    searchFields: ['code', 'nameFa', 'nameEn'],
    filters: [],
    enumFilters: { kind: UNIT_KINDS },
    orderBy: { code: 'asc' },
    create: z.object({
      code: requiredCode(16),
      nameFa: requiredCode(190),
      nameEn: requiredCode(190),
      kind: z.enum(UNIT_KINDS).optional(),
      isActive: z.boolean().optional(),
    }),
    update: z.object({
      nameFa: requiredCode(190).optional(),
      nameEn: requiredCode(190).optional(),
      kind: z.enum(UNIT_KINDS).optional(),
      isActive: z.boolean().optional(),
    }),
    remove: 'soft',
    soft: { field: 'isActive', value: false },
    columns: [
      { header: 'کد', key: 'code' },
      { header: 'نام فارسی', key: 'nameFa' },
      { header: 'نام انگلیسی', key: 'nameEn' },
      { header: 'نوع', get: (r) => r.kind },
      { header: 'فعال', get: (r) => (r.isActive ? 'بله' : 'خیر') },
    ],
    import: {
      example: { کد: 'SET', 'نام فارسی': 'دستگاه', 'نام انگلیسی': 'Set', نوع: 'COUNT' },
      columns: [
        { header: 'کد', key: 'code', required: true },
        { header: 'نام فارسی', key: 'nameFa', required: true },
        { header: 'نام انگلیسی', key: 'nameEn', required: true },
        { header: 'نوع', key: 'kind', kind: 'enum', values: UNIT_KINDS },
      ],
    },
  },

  operations: {
    key: 'operations',
    model: 'operation',
    permModule: 'masterdata',
    labelFa: 'عملیات تولید',
    uniqueField: 'code',
    searchFields: ['code', 'nameFa', 'nameEn', 'description'],
    filters: [],
    enumFilters: {},
    orderBy: { code: 'asc' },
    create: z.object({
      code: requiredCode(16),
      nameFa: requiredCode(190),
      nameEn: requiredCode(190),
      description: optionalTrimmed(2000),
      defaultSetupTimeMin: z.number().int().min(0).nullish(),
      defaultCycleTimeSec: decimalField,
      requiresDie: z.boolean().optional(),
      isActive: z.boolean().optional(),
    }),
    update: z.object({
      nameFa: requiredCode(190).optional(),
      nameEn: requiredCode(190).optional(),
      description: optionalTrimmed(2000),
      defaultSetupTimeMin: z.number().int().min(0).nullish(),
      defaultCycleTimeSec: decimalField,
      requiresDie: z.boolean().optional(),
      isActive: z.boolean().optional(),
    }),
    remove: 'soft',
    soft: { field: 'isActive', value: false },
    columns: [
      { header: 'کد', key: 'code' },
      { header: 'نام فارسی', key: 'nameFa' },
      { header: 'نام انگلیسی', key: 'nameEn' },
      { header: 'زمان راه‌اندازی (دقیقه)', get: (r) => r.defaultSetupTimeMin },
      { header: 'زمان سیکل (ثانیه)', get: (r) => r.defaultCycleTimeSec },
      { header: 'نیازمند قالب', get: (r) => (r.requiresDie ? 'بله' : 'خیر') },
      { header: 'فعال', get: (r) => (r.isActive ? 'بله' : 'خیر') },
    ],
    import: {
      example: { کد: 'INS', 'نام فارسی': 'بازرسی', 'نام انگلیسی': 'Inspection' },
      columns: [
        { header: 'کد', key: 'code', required: true },
        { header: 'نام فارسی', key: 'nameFa', required: true },
        { header: 'نام انگلیسی', key: 'nameEn', required: true },
        { header: 'زمان راه‌اندازی (دقیقه)', key: 'defaultSetupTimeMin', kind: 'int' },
        { header: 'زمان سیکل (ثانیه)', key: 'defaultCycleTimeSec', kind: 'decimal' },
        { header: 'نیازمند قالب', key: 'requiresDie', kind: 'boolean' },
      ],
    },
  },

  warehouses: {
    key: 'warehouses',
    model: 'warehouse',
    permModule: 'masterdata',
    labelFa: 'انبار',
    uniqueField: 'code',
    searchFields: ['code', 'nameFa', 'notes'],
    filters: [],
    enumFilters: { warehouseType: WAREHOUSE_TYPES },
    orderBy: { code: 'asc' },
    include: { _count: { select: { locations: true } } },
    create: z.object({
      code: requiredCode(16),
      nameFa: requiredCode(190),
      warehouseType: z.enum(WAREHOUSE_TYPES),
      isActive: z.boolean().optional(),
      notes: optionalTrimmed(2000),
    }),
    update: z.object({
      nameFa: requiredCode(190).optional(),
      warehouseType: z.enum(WAREHOUSE_TYPES).optional(),
      isActive: z.boolean().optional(),
      notes: optionalTrimmed(2000),
    }),
    remove: 'soft',
    soft: { field: 'isActive', value: false },
    columns: [
      { header: 'کد', key: 'code' },
      { header: 'نام فارسی', key: 'nameFa' },
      { header: 'نوع', get: (r) => r.warehouseType },
      { header: 'تعداد موقعیت', get: (r) => r._count?.locations ?? 0 },
      { header: 'فعال', get: (r) => (r.isActive ? 'بله' : 'خیر') },
      { header: 'توضیحات', get: (r) => r.notes },
    ],
    import: {
      example: { کد: 'WH-TOOL', 'نام فارسی': 'انبار ابزار', نوع: 'TOOLS' },
      columns: [
        { header: 'کد', key: 'code', required: true },
        { header: 'نام فارسی', key: 'nameFa', required: true },
        { header: 'نوع', key: 'warehouseType', kind: 'enum', values: WAREHOUSE_TYPES, required: true },
        { header: 'توضیحات', key: 'notes' },
      ],
    },
  },

  'warehouse-locations': {
    key: 'warehouse-locations',
    model: 'warehouseLocation',
    permModule: 'masterdata',
    labelFa: 'موقعیت انبار',
    uniqueField: 'code',
    searchFields: ['code', 'nameFa'],
    filters: ['warehouseId'],
    enumFilters: {},
    orderBy: { code: 'asc' },
    include: { warehouse: { select: { code: true, nameFa: true } } },
    create: z.object({
      warehouseId: z.string().uuid(),
      code: requiredCode(32),
      nameFa: requiredCode(190),
      capacityKg: decimalField,
      isActive: z.boolean().optional(),
    }),
    update: z.object({
      nameFa: requiredCode(190).optional(),
      capacityKg: decimalField,
      isActive: z.boolean().optional(),
    }),
    remove: 'soft',
    soft: { field: 'isActive', value: false },
    columns: [
      { header: 'کد', key: 'code' },
      { header: 'نام فارسی', key: 'nameFa' },
      { header: 'انبار', get: (r) => r.warehouse?.nameFa ?? '' },
      { header: 'ظرفیت (کیلوگرم)', get: (r) => r.capacityKg },
      { header: 'فعال', get: (r) => (r.isActive ? 'بله' : 'خیر') },
    ],
    import: {
      example: { کد: 'RM-B01', 'نام فارسی': 'قفسه B ردیف ۱', انبار: 'WH-RM' },
      columns: [
        { header: 'کد', key: 'code', required: true },
        { header: 'نام فارسی', key: 'nameFa', required: true },
        { header: 'انبار', key: 'warehouseId', ref: 'warehouse', required: true },
        { header: 'ظرفیت (کیلوگرم)', key: 'capacityKg', kind: 'decimal' },
      ],
    },
  },

  shifts: {
    key: 'shifts',
    model: 'shift',
    permModule: 'masterdata',
    labelFa: 'شیفت کاری',
    uniqueField: 'code',
    searchFields: ['code', 'nameFa'],
    filters: [],
    enumFilters: {},
    orderBy: { code: 'asc' },
    create: z.object({
      code: requiredCode(16),
      nameFa: requiredCode(190),
      startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'ساعت به قالب HH:MM'),
      endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'ساعت به قالب HH:MM'),
      isActive: z.boolean().optional(),
    }),
    update: z.object({
      nameFa: requiredCode(190).optional(),
      startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'ساعت به قالب HH:MM').optional(),
      endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'ساعت به قالب HH:MM').optional(),
      isActive: z.boolean().optional(),
    }),
    remove: 'soft',
    soft: { field: 'isActive', value: false },
    columns: [
      { header: 'کد', key: 'code' },
      { header: 'نام فارسی', key: 'nameFa' },
      { header: 'ساعت شروع', key: 'startTime' },
      { header: 'ساعت پایان', key: 'endTime' },
      { header: 'فعال', get: (r) => (r.isActive ? 'بله' : 'خیر') },
    ],
    import: {
      example: { کد: 'SH4', 'نام فارسی': 'شیفت تسهیلات', 'ساعت شروع': '22:30', 'ساعت پایان': '06:30' },
      columns: [
        { header: 'کد', key: 'code', required: true },
        { header: 'نام فارسی', key: 'nameFa', required: true },
        { header: 'ساعت شروع', key: 'startTime', required: true },
        { header: 'ساعت پایان', key: 'endTime', required: true },
      ],
    },
  },

  customers: {
    key: 'customers',
    model: 'customer',
    permModule: 'masterdata',
    labelFa: 'مشتری',
    uniqueField: 'code',
    searchFields: ['code', 'nameFa', 'nameEn', 'contactPerson', 'phone'],
    filters: [],
    enumFilters: {},
    orderBy: { code: 'asc' },
    create: z.object({
      code: requiredCode(32),
      nameFa: requiredCode(190),
      nameEn: optionalTrimmed(190),
      contactPerson: optionalTrimmed(190),
      phone: optionalTrimmed(32),
      email: optionalTrimmed(190),
      address: optionalTrimmed(2000),
      isActive: z.boolean().optional(),
    }),
    update: z.object({
      nameFa: requiredCode(190).optional(),
      nameEn: optionalTrimmed(190),
      contactPerson: optionalTrimmed(190),
      phone: optionalTrimmed(32),
      email: optionalTrimmed(190),
      address: optionalTrimmed(2000),
      isActive: z.boolean().optional(),
    }),
    remove: 'soft',
    soft: { field: 'isActive', value: false },
    columns: [
      { header: 'کد', key: 'code' },
      { header: 'نام فارسی', key: 'nameFa' },
      { header: 'نام انگلیسی', get: (r) => r.nameEn },
      { header: 'رابط', get: (r) => r.contactPerson },
      { header: 'تلفن', get: (r) => r.phone },
      { header: 'ایمیل', get: (r) => r.email },
      { header: 'فعال', get: (r) => (r.isActive ? 'بله' : 'خیر') },
    ],
    import: {
      example: { کد: 'CUST-003', 'نام فارسی': 'مدیران خودرو' },
      columns: [
        { header: 'کد', key: 'code', required: true },
        { header: 'نام فارسی', key: 'nameFa', required: true },
        { header: 'نام انگلیسی', key: 'nameEn' },
        { header: 'رابط', key: 'contactPerson' },
        { header: 'تلفن', key: 'phone' },
        { header: 'ایمیل', key: 'email' },
        { header: 'آدرس', key: 'address' },
      ],
    },
  },

  // ----- capacity-domain resources (ماشین‌آلات و ظرفیت) -----

  machines: {
    key: 'machines',
    model: 'machine',
    permModule: 'capacity',
    labelFa: 'ماشین',
    uniqueField: 'code',
    searchFields: ['code', 'nameFa', 'nameEn', 'manufacturer', 'location'],
    filters: ['machineType', 'location'],
    enumFilters: { machineType: MACHINE_TYPES, status: MACHINE_STATUSES },
    orderBy: { code: 'asc' },
    include: { _count: { select: { capabilities: true, dieCompatibilities: true } } },
    create: z.object({
      code: requiredCode(32),
      nameFa: requiredCode(190),
      nameEn: optionalTrimmed(190),
      machineType: z.enum(MACHINE_TYPES),
      tonnage: decimalField,
      manufacturer: optionalTrimmed(190),
      location: optionalTrimmed(190),
      status: z.enum(MACHINE_STATUSES).optional(),
      notes: optionalTrimmed(2000),
    }),
    update: z.object({
      nameFa: requiredCode(190).optional(),
      nameEn: optionalTrimmed(190),
      machineType: z.enum(MACHINE_TYPES).optional(),
      tonnage: decimalField,
      manufacturer: optionalTrimmed(190),
      location: optionalTrimmed(190),
      status: z.enum(MACHINE_STATUSES).optional(),
      notes: optionalTrimmed(2000),
    }),
    remove: 'soft',
    soft: { field: 'status', value: 'RETIRED' },
    columns: [
      { header: 'کد', key: 'code' },
      { header: 'نام فارسی', key: 'nameFa' },
      { header: 'نوع ماشین', get: (r) => r.machineType },
      { header: 'تناژ (تن)', get: (r) => r.tonnage },
      { header: 'سازنده', get: (r) => r.manufacturer },
      { header: 'محل استقرار', get: (r) => r.location },
      { header: 'وضعیت', get: (r) => r.status },
      { header: 'تعداد توانمندی', get: (r) => r._count?.capabilities ?? 0 },
      { header: 'تعداد قالب سازگار', get: (r) => r._count?.dieCompatibilities ?? 0 },
    ],
    import: {
      example: { کد: 'PRS-210', 'نام فارسی': 'پرس ۲۰۰ تن', 'نوع ماشین': 'PRESS', 'تناژ (تن)': '200' },
      columns: [
        { header: 'کد', key: 'code', required: true },
        { header: 'نام فارسی', key: 'nameFa', required: true },
        { header: 'نوع ماشین', key: 'machineType', kind: 'enum', values: MACHINE_TYPES, required: true },
        { header: 'تناژ (تن)', key: 'tonnage', kind: 'decimal' },
        { header: 'سازنده', key: 'manufacturer' },
        { header: 'محل استقرار', key: 'location' },
        { header: 'وضعیت', key: 'status', kind: 'enum', values: MACHINE_STATUSES },
        { header: 'توضیحات', key: 'notes' },
      ],
    },
  },

  dies: {
    key: 'dies',
    model: 'die',
    permModule: 'capacity',
    labelFa: 'قالب',
    uniqueField: 'code',
    searchFields: ['code', 'nameFa', 'description', 'storageLocation'],
    filters: [],
    enumFilters: { status: DIE_STATUSES },
    orderBy: { code: 'asc' },
    include: { _count: { select: { dieCompatibilities: true, routeSteps: true } } },
    create: z.object({
      code: requiredCode(32),
      nameFa: requiredCode(190),
      description: optionalTrimmed(2000),
      status: z.enum(DIE_STATUSES).optional(),
      storageLocation: optionalTrimmed(190),
      notes: optionalTrimmed(2000),
    }),
    update: z.object({
      nameFa: requiredCode(190).optional(),
      description: optionalTrimmed(2000),
      status: z.enum(DIE_STATUSES).optional(),
      storageLocation: optionalTrimmed(190),
      notes: optionalTrimmed(2000),
    }),
    remove: 'soft',
    soft: { field: 'status', value: 'RETIRED' },
    columns: [
      { header: 'کد', key: 'code' },
      { header: 'نام فارسی', key: 'nameFa' },
      { header: 'وضعیت', get: (r) => r.status },
      { header: 'محل نگهداری', get: (r) => r.storageLocation },
      { header: 'تعداد ماشین سازگار', get: (r) => r._count?.dieCompatibilities ?? 0 },
      { header: 'توضیحات', get: (r) => r.description },
    ],
    import: {
      example: { کد: 'DIE-105', 'نام فارسی': 'قالب فرم سپر' },
      columns: [
        { header: 'کد', key: 'code', required: true },
        { header: 'نام فارسی', key: 'nameFa', required: true },
        { header: 'وضعیت', key: 'status', kind: 'enum', values: DIE_STATUSES },
        { header: 'محل نگهداری', key: 'storageLocation' },
        { header: 'توضیحات', key: 'description' },
      ],
    },
  },

  routes: {
    key: 'routes',
    model: 'partRoute',
    permModule: 'masterdata',
    labelFa: 'مسیر تولید',
    uniqueField: 'id',
    searchFields: ['name', 'description'],
    searchRelations: { part: ['partNumber', 'nameFa'] },
    filters: ['partId'],
    enumFilters: { status: ROUTE_STATUSES },
    orderBy: { updatedAt: 'desc' },
    include: {
      part: { select: { partNumber: true, nameFa: true } },
      steps: {
        orderBy: { sequence: 'asc' },
        include: {
          operation: { select: { code: true, nameFa: true } },
          machine: { select: { code: true, nameFa: true } },
          die: { select: { code: true, nameFa: true } },
        },
      },
      _count: { select: { manufacturingOrders: true } },
    },
    create: z.object({
      partId: z.string().uuid(),
      version: z.number().int().min(1).optional(),
      name: optionalTrimmed(190),
      status: z.enum(ROUTE_STATUSES).optional(),
      description: optionalTrimmed(2000),
      effectiveFrom: z.string().datetime().nullish(),
      steps: z
        .array(
          z.object({
            sequence: z.number().int().min(1).optional(),
            operationId: z.string().uuid(),
            machineId: z.string().uuid().nullish(),
            dieId: z.string().uuid().nullish(),
            setupTimeMin: z.number().int().min(0).nullish(),
            cycleTimeSec: decimalField,
            scrapFactorPct: z.union([z.number(), z.string()]).transform(String).optional(),
            requiredTonnage: decimalField,
            description: optionalTrimmed(500),
          }),
        )
        .max(30)
        .optional(),
    }),
    update: z.object({
      name: optionalTrimmed(190),
      status: z.enum(ROUTE_STATUSES).optional(),
      description: optionalTrimmed(2000),
      effectiveFrom: z.string().datetime().nullish(),
      steps: z
        .array(
          z.object({
            sequence: z.number().int().min(1).optional(),
            operationId: z.string().uuid(),
            machineId: z.string().uuid().nullish(),
            dieId: z.string().uuid().nullish(),
            setupTimeMin: z.number().int().min(0).nullish(),
            cycleTimeSec: decimalField,
            scrapFactorPct: z.union([z.number(), z.string()]).transform(String).optional(),
            requiredTonnage: decimalField,
            description: optionalTrimmed(500),
          }),
        )
        .max(30)
        .optional(),
    }),
    remove: 'hard',
    columns: [
      { header: 'قطعه', get: (r) => r.part?.nameFa ?? '' },
      { header: 'شماره قطعه', get: (r) => r.part?.partNumber ?? '' },
      { header: 'نسخه', key: 'version' },
      { header: 'نام', get: (r) => r.name },
      { header: 'وضعیت', get: (r) => r.status },
      { header: 'تعداد عملیات', get: (r) => r.steps?.length ?? 0 },
      { header: 'تعداد دستور کار', get: (r) => r._count?.manufacturingOrders ?? 0 },
    ],
  },

  bom: {
    key: 'bom',
    model: 'partMaterialRequirement',
    permModule: 'masterdata',
    labelFa: 'سرانه مصرف (BOM)',
    uniqueField: 'id',
    searchFields: ['notes'],
    searchRelations: { part: ['partNumber', 'nameFa'], material: ['materialCode', 'nameFa'] },
    filters: ['partId', 'materialId'],
    enumFilters: {},
    orderBy: { createdAt: 'asc' },
    include: {
      part: { select: { partNumber: true, nameFa: true } },
      material: { select: { materialCode: true, nameFa: true } },
    },
    create: z.object({
      partId: z.string().uuid(),
      materialId: z.string().uuid(),
      quantityPerUnit: z.union([z.number(), z.string()]).transform(String),
      weightKgPerUnit: decimalField,
      notes: optionalTrimmed(500),
    }),
    update: z.object({
      quantityPerUnit: z.union([z.number(), z.string()]).transform(String).optional(),
      weightKgPerUnit: decimalField,
      notes: optionalTrimmed(500),
    }),
    remove: 'hard',
    columns: [
      { header: 'قطعه', get: (r) => r.part?.nameFa ?? '' },
      { header: 'شماره قطعه', get: (r) => r.part?.partNumber ?? '' },
      { header: 'ماده', get: (r) => r.material?.nameFa ?? '' },
      { header: 'کد ماده', get: (r) => r.material?.materialCode ?? '' },
      { header: 'مقدار در هر عدد', key: 'quantityPerUnit' },
      { header: 'وزن در هر عدد (کیلوگرم)', get: (r) => r.weightKgPerUnit },
      { header: 'توضیحات', get: (r) => r.notes },
    ],
    import: {
      example: { 'شماره قطعه': 'K-1234', 'کد ماده': 'SHEET-ST12-1.5', 'مقدار در هر عدد': '2.1' },
      columns: [
        { header: 'شماره قطعه', key: 'partId', ref: 'part', required: true },
        { header: 'کد ماده', key: 'materialId', ref: 'material', required: true },
        { header: 'مقدار در هر عدد', key: 'quantityPerUnit', kind: 'decimal', required: true },
        { header: 'وزن در هر عدد (کیلوگرم)', key: 'weightKgPerUnit', kind: 'decimal' },
        { header: 'توضیحات', key: 'notes' },
      ],
    },
  },
};

/** Guard used by routes — throws a 404-style ApiError when unknown. */
export function getResource(key: string): ResourceDef {
  const def = RESOURCES[key];
  if (!def) throw new ApiError(404, `Unknown resource: ${key}`, 'موجودیت شناخته‌شده نیست');
  return def;
}

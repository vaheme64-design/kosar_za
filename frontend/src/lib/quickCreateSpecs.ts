import type { QuickCreateSpec } from '../components/quickcreate/QuickCreate';
import type { Lookups } from './lookups';
import type { AppSettings } from './appSettings';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Shared quick-create specs (مشخصات ایجاد سریع) — used by CrudPage select
 * fields and the operational forms. Creating a missing master-data record
 * must never force the user out of the form they are working in.
 */

const UNIT_KINDS = ['COUNT', 'WEIGHT', 'LENGTH', 'AREA'];
const UNIT_KIND_FA: Record<string, string> = {
  COUNT: 'شمارشی (عدد، برگ…)',
  WEIGHT: 'وزنی (کیلوگرم…)',
  LENGTH: 'طول (متر…)',
  AREA: 'مساحت (مترمربع…)',
};
const WAREHOUSE_TYPES = ['RAW_MATERIAL', 'WIP', 'FINISHED_GOODS', 'SCRAP', 'TOOLS'];
const WAREHOUSE_TYPE_FA: Record<string, string> = {
  RAW_MATERIAL: 'مواد اولیه',
  WIP: 'در جریان ساخت',
  FINISHED_GOODS: 'محصول تکمیلی',
  SCRAP: 'ضایعات',
  TOOLS: 'ابزار و قالب',
};

/** new quick-create for a customer (مشتری) */
export function customerQuickCreate(): QuickCreateSpec {
  return {
    resourcePath: '/master-data/customers',
    title: 'مشتری جدید',
    permission: 'masterdata.manage',
    pickId: (res) => res?.customer?.id ?? res?.row?.id ?? res?.id,
    fields: [
      { key: 'code', label: 'کد مشتری', required: true, dir: 'ltr', placeholder: 'CUST-010' },
      { key: 'nameFa', label: 'نام فارسی', required: true },
      { key: 'nameEn', label: 'نام انگلیسی', dir: 'ltr' },
      { key: 'phone', label: 'تلفن', dir: 'ltr' },
      { key: 'contactPerson', label: 'شخص رابط' },
    ],
  };
}

/** quick-create for a unit of measure (واحد شمارش) */
export function unitQuickCreate(): QuickCreateSpec {
  return {
    resourcePath: '/master-data/units',
    title: 'واحد شمارش جدید',
    permission: 'masterdata.manage',
    pickId: (res) => res?.row?.id ?? res?.id,
    fields: [
      { key: 'code', label: 'کد واحد', required: true, dir: 'ltr', placeholder: 'SET' },
      { key: 'nameFa', label: 'نام فارسی', required: true, placeholder: 'دستگاه' },
      { key: 'nameEn', label: 'نام انگلیسی', required: true, dir: 'ltr', placeholder: 'Set' },
      {
        key: 'kind',
        label: 'نوع واحد',
        type: 'select',
        options: UNIT_KINDS.map((k) => ({ value: k, label: UNIT_KIND_FA[k] ?? k })),
        hint: 'پیش‌فرض: شمارشی',
      },
    ],
  };
}

/** quick-create for a warehouse (انبار) */
export function warehouseQuickCreate(): QuickCreateSpec {
  return {
    resourcePath: '/master-data/warehouses',
    title: 'انبار جدید',
    permission: 'masterdata.manage',
    pickId: (res) => res?.row?.id ?? res?.id,
    fields: [
      { key: 'code', label: 'کد انبار', required: true, dir: 'ltr', placeholder: 'WH-TOOL' },
      { key: 'nameFa', label: 'نام انبار', required: true, placeholder: 'انبار ابزار' },
      {
        key: 'warehouseType',
        label: 'نوع انبار',
        type: 'select',
        required: true,
        options: WAREHOUSE_TYPES.map((t) => ({ value: t, label: WAREHOUSE_TYPE_FA[t] ?? t })),
      },
      { key: 'notes', label: 'توضیحات', type: 'textarea', wide: true },
    ],
  };
}

/** quick-create for a raw material (ماده اولیه / ورق) — supplier default from settings */
export function materialQuickCreate(lookups: Lookups, settings: AppSettings): QuickCreateSpec {
  return {
    resourcePath: '/master-data/materials',
    title: 'ماده اولیه جدید',
    permission: 'masterdata.manage',
    initialValues: () => ({
      // مقدار پیش‌فرض فقط از تنظیمات می‌آید — در کد نوشته نشده و قابل تغییر است
      supplierName: settings['materials.defaultSupplierName'] || '',
      materialType: 'SHEET',
    }),
    pickId: (res) => res?.row?.id ?? res?.id,
    fields: [
      { key: 'materialCode', label: 'کد ماده', required: true, dir: 'ltr', placeholder: 'ST12-1.0-1250x2500' },
      { key: 'nameFa', label: 'نام فارسی', required: true, placeholder: 'ورق سرد ST12 ضخامت ۱٫۰' },
      { key: 'grade', label: 'گرید', dir: 'ltr', placeholder: 'ST12' },
      {
        key: 'materialType',
        label: 'نوع ماده',
        type: 'select',
        options: [
          { value: 'SHEET', label: 'ورق' },
          { value: 'COIL', label: 'کویل' },
          { value: 'PAINT', label: 'رنگ' },
          { value: 'CONSUMABLE', label: 'مصرفی' },
          { value: 'OTHER', label: 'سایر' },
        ],
      },
      { key: 'thicknessMm', label: 'ضخامت (mm)', type: 'number', step: '0.01', dir: 'ltr' },
      { key: 'widthMm', label: 'عرض (mm)', type: 'number', step: '0.1', dir: 'ltr' },
      { key: 'lengthMm', label: 'طول (mm)', type: 'number', step: '0.1', dir: 'ltr' },
      { key: 'unitWeightKg', label: 'وزن واحد (kg)', type: 'number', step: '0.001', dir: 'ltr' },
      {
        key: 'baseUnitId',
        label: 'واحد پایه',
        type: 'select',
        required: true,
        options: lookups.units.map((u) => ({ value: u.id, label: `${u.nameFa} (${u.code})` })),
      },
      { key: 'supplierName', label: 'تأمین‌کننده', hint: 'پیش‌فرض از تنظیمات سامانه — قابل تغییر' },
    ],
  };
}

/** quick-create for a part (قطعه / کالا) */
export function partQuickCreate(lookups: Lookups): QuickCreateSpec {
  return {
    resourcePath: '/master-data/parts',
    title: 'قطعه جدید',
    permission: 'masterdata.manage',
    pickId: (res) => res?.row?.id ?? res?.id,
    fields: [
      { key: 'partNumber', label: 'شماره قطعه', required: true, dir: 'ltr', placeholder: 'KP-1010' },
      { key: 'nameFa', label: 'نام فارسی', required: true },
      { key: 'standardWeightKg', label: 'وزن استاندارد (kg)', type: 'number', step: '0.001', dir: 'ltr' },
      {
        key: 'partType',
        label: 'نوع قطعه',
        type: 'select',
        options: [
          { value: 'FINISHED_PART', label: 'قطعه تکمیلی' },
          { value: 'SEMI_FINISHED', label: 'نیمه‌ساخت' },
          { value: 'SUBASSEMBLY', label: 'زیرمونتاژ' },
        ],
      },
      {
        key: 'baseUnitId',
        label: 'واحد پایه',
        type: 'select',
        required: true,
        options: lookups.units.map((u) => ({ value: u.id, label: `${u.nameFa} (${u.code})` })),
      },
      {
        key: 'mainMaterialId',
        label: 'ماده اصلی',
        type: 'select',
        options: lookups.materials.map((m) => ({ value: m.id, label: `${m.materialCode} — ${m.nameFa}` })),
      },
      {
        key: 'primaryCustomerId',
        label: 'مشتری اصلی',
        type: 'select',
        options: lookups.customers.map((c) => ({ value: c.id, label: `${c.code} — ${c.nameFa}` })),
      },
    ],
  };
}

/** quick-create for a shift (شیفت کاری) */
export function shiftQuickCreate(): QuickCreateSpec {
  return {
    resourcePath: '/master-data/shifts',
    title: 'شیفت جدید',
    permission: 'masterdata.manage',
    pickId: (res) => res?.row?.id ?? res?.id,
    fields: [
      { key: 'code', label: 'کد شیفت', required: true, dir: 'ltr', placeholder: 'SH4' },
      { key: 'nameFa', label: 'نام شیفت', required: true, placeholder: 'شیفت اضافه‌کاری' },
      { key: 'startTime', label: 'ساعت شروع', type: 'time', required: true },
      { key: 'endTime', label: 'ساعت پایان', type: 'time', required: true },
    ],
  };
}

/** quick-create for a die (قالب) */
export function dieQuickCreate(): QuickCreateSpec {
  return {
    resourcePath: '/master-data/dies',
    title: 'قالب جدید',
    permission: 'capacity.manage',
    pickId: (res) => res?.row?.id ?? res?.id,
    fields: [
      { key: 'code', label: 'کد قالب', required: true, dir: 'ltr', placeholder: 'DIE-110' },
      { key: 'nameFa', label: 'نام قالب', required: true },
      { key: 'storageLocation', label: 'محل نگهداری' },
    ],
  };
}

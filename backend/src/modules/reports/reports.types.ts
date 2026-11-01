/**
 * KPIMS — Phase 5: Management Reporting & Control.
 *
 * Shared report contract. Every report:
 *   • reads ONLY real database records,
 *   • declares its columns with an explicit value kind
 *     (IDENTIFIER / ACTUAL / PLANNED / STANDARD / ESTIMATED / INFO)
 *     so estimates can never masquerade as measured values,
 *   • carries a generation timestamp (UTC ISO + Jalali display string),
 *   • offers optional drill-down references to source documents.
 */

export type ValueKind = 'IDENTIFIER' | 'ACTUAL' | 'PLANNED' | 'STANDARD' | 'ESTIMATED' | 'INFO';

export const VALUE_KIND_FA: Record<ValueKind, string> = {
  IDENTIFIER: 'شناسه',
  ACTUAL: 'واقعی (از رکوردهای ثبت‌شده)',
  PLANNED: 'برنامه‌ای (سند برنامه)',
  STANDARD: 'استاندارد (محاسبه از BOM و زمان استاندارد)',
  ESTIMATED: 'تخمینی (برآورد بر پایه داده‌های مرجع)',
  INFO: 'توضیحی',
};

export interface ReportColumn {
  key: string;
  labelFa: string;
  kind: ValueKind;
  unit?: string | null;
}

export interface DrillRef {
  kind: string;
  id: string;
  labelFa?: string;
}

export type ReportCell = string | number | boolean | null;
export interface ReportRow {
  [columnKey: string]: ReportCell | DrillRef | undefined;
}

export interface ReportMeta {
  generatedAt: string;
  generatedAtFa: string;
  filters: Record<string, string>;
  valueKinds: Record<ValueKind, string>;
  notesFa: string[];
  /** Explicitly stated default period when the caller passed no date range. */
  defaultPeriodApplied?: { from: string; to: string; basisFa: string };
}

export interface ReportTable {
  key: string;
  titleFa: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  meta: ReportMeta;
}

export interface ReportDef {
  key: string;
  titleFa: string;
  descriptionFa: string;
  filters: string[];
}

/** The 13 management reports (catalog served on GET /reports). */
export const REPORT_CATALOG: ReportDef[] = [
  {
    key: 'plan-vs-actual',
    titleFa: 'برنامه تولید در مقابل عملکرد واقعی',
    descriptionFa: 'مقایسه مقدار برنامه‌ریزی‌شده هر ردیف برنامه با تولید واقعی ثبت‌شده دستور کارهای مرتبط',
    filters: ['from', 'to', 'partId', 'customerId'],
  },
  {
    key: 'order-fulfillment',
    titleFa: 'اقلای سفارش‌های مشتری',
    descriptionFa: 'مقدار سفارش، تحویل‌شده، باقی‌مانده و وضعیت سررسید هر ردیف سفارش',
    filters: ['from', 'to', 'partId', 'customerId'],
  },
  {
    key: 'backlog',
    titleFa: 'کار در انتظار تولید (Backlog)',
    descriptionFa: 'تقاضای باز سفارش‌ها و پوشش آن با موجودی محصول، WIP و دستور کارهای باز',
    filters: ['partId', 'customerId'],
  },
  {
    key: 'wip-by-part-operation',
    titleFa: 'قطعات در جریان ساخت به تفکیک قطعه و عملیات',
    descriptionFa: 'موجودی در انتظار پردازش، در جریان و آماده انتقال در هر عملیات',
    filters: ['partId', 'operationId'],
  },
  {
    key: 'wip-aging',
    titleFa: 'قداره قطعات در جریان ساخت',
    descriptionFa: 'مدت ماندگاری WIP در هر عملیات و خلاصه سنی (بازه‌های زمانی)',
    filters: ['partId', 'operationId'],
  },
  {
    key: 'material-consumption',
    titleFa: 'مصرف ماده اولیه در مقابل سرانه استاندارد',
    descriptionFa: 'مصرف واقعی حواله‌شده در برابر سرانه محاسبه‌شده از BOM و تولید واقعی دوره',
    filters: ['from', 'to', 'materialId', 'partId'],
  },
  {
    key: 'sapco-account',
    titleFa: 'حساب مواد SAPCO (کیلوگرمی)',
    descriptionFa: 'افتتاحیه، دریافتی، مصرف، تعدیلات و پایانی دوره به تفکیک ماده — با تفکیک امانی/مالی',
    filters: ['from', 'to', 'materialId'],
  },
  {
    key: 'inventory-valuation',
    titleFa: 'ارزش‌گذاری کمّی موجودی',
    descriptionFa: 'موجودی رسمی به تفکیک قلم، انبار، لوت، مالکیت و وضعیت کیفیت — صرفاً کمیت (قاعده ارزش‌گذاری مالی تعریف نشده است)',
    filters: ['partId', 'materialId', 'warehouseId'],
  },
  {
    key: 'scrap',
    titleFa: 'ضایعات به تفکیک قطعه و عملیات',
    descriptionFa: 'ضایعات ثبت‌شده با علت، وزن و سهم از ورودی عملیات',
    filters: ['from', 'to', 'partId', 'operationId'],
  },
  {
    key: 'machine-workload',
    titleFa: 'بار کاری و ظرفیت موجود ماشین‌آلات',
    descriptionFa: 'بار برنامه‌ای تخصیص‌ها، تولید واقعی دوره و بهره‌وری تخمینی — بهره‌وری فقط جایی که داده ظرفیت قابل اتکا موجود است',
    filters: ['from', 'to', 'machineId'],
  },
  {
    key: 'production-delays',
    titleFa: 'تأخیرهای تولید',
    descriptionFa: 'ردیف‌های سفارش، دستور کارها و عملیات‌های دارای تأخیر نسبت به سررسید/برنامه',
    filters: ['partId', 'customerId', 'machineId'],
  },
  {
    key: 'inventory-movements',
    titleFa: 'حرکت موجودی انبار',
    descriptionFa: 'خلاصه ورود/خروج دفتر کل به تفکیک قلم و نوع تراکنش در بازه دوره',
    filters: ['from', 'to', 'partId', 'materialId', 'warehouseId'],
  },
  {
    key: 'inventory-reconciliation',
    titleFa: 'تطبیق موجودی دفتر کل و موجودی رسمی',
    descriptionFa: 'مقایسه موجودی رسمی هر بُعد با جمع تراکنش‌های دفتر کل و آشکارسازی اختلاف',
    filters: ['partId', 'materialId', 'warehouseId'],
  },
];

export const REPORT_KEYS = REPORT_CATALOG.map((r) => r.key);

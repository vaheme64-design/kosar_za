import { fa } from '../components/ui';

/**
 * Persian labels for master-data / capacity enums (Phase 6).
 * Falls back to the shared domain map in ui.tsx.
 */
const LABELS: Record<string, string> = {
  // part / material types
  FINISHED_PART: 'قطعه تکمیلی',
  SEMI_FINISHED: 'نیم‌ساخت',
  SUBASSEMBLY: 'زیرمونتاژ',
  SHEET: 'ورق',
  COIL: 'کویل',
  PROFILE: 'پروفیل',
  PAINT: 'رنگ',
  CONSUMABLE: 'مصرفی',
  OTHER: 'سایر',
  // unit kinds
  COUNT: 'شمارشی',
  WEIGHT: 'وزنی',
  LENGTH: 'طولی',
  AREA: 'مساحتی',
  // machine types
  PRESS: 'پرس',
  CUTTING: 'برش',
  PRESS_WELDING: 'جوش پرس',
  CO2_WELDING: 'جوش CO2',
  PAINTING: 'رنگ‌آمیزی',
  ASSEMBLY: 'مونتاژ',
  // machine / die statuses
  MAINTENANCE: 'در تعمیرات',
  BREAKDOWN: 'خراب',
  // part statuses
  PHASED_OUT: 'از رده خارج',
  // warehouse types
  RAW_MATERIAL: 'مواد اولیه',
  WIP: 'در جریان ساخت',
  FINISHED_GOODS: 'محصول تکمیلی',
  SCRAP: 'ضایعات',
  TOOLS: 'ابزار و قالب',
  // route statuses
  DRAFT: 'پیش‌نویس',
  RETIRED: 'بازنشسته',
};

/** Extended Persian label lookup (labels.ts first, then the shared ui map). */
export function faEx(value: string | null | undefined): string {
  if (!value) return '—';
  return LABELS[value] ?? fa(value);
}

export const OPTION_SETS = {
  partType: [
    { value: 'FINISHED_PART', label: 'قطعه تکمیلی' },
    { value: 'SEMI_FINISHED', label: 'نیم‌ساخت' },
    { value: 'SUBASSEMBLY', label: 'زیرمونتاژ' },
  ],
  partStatus: [
    { value: 'ACTIVE', label: 'فعال' },
    { value: 'INACTIVE', label: 'غیرفعال' },
    { value: 'PHASED_OUT', label: 'از رده خارج' },
  ],
  materialType: [
    { value: 'SHEET', label: 'ورق' },
    { value: 'COIL', label: 'کویل' },
    { value: 'PROFILE', label: 'پروفیل' },
    { value: 'PAINT', label: 'رنگ' },
    { value: 'CONSUMABLE', label: 'مصرفی' },
    { value: 'OTHER', label: 'سایر' },
  ],
  unitKind: [
    { value: 'COUNT', label: 'شمارشی' },
    { value: 'WEIGHT', label: 'وزنی' },
    { value: 'LENGTH', label: 'طولی' },
    { value: 'AREA', label: 'مساحتی' },
  ],
  machineType: [
    { value: 'PRESS', label: 'پرس' },
    { value: 'CUTTING', label: 'برش' },
    { value: 'PRESS_WELDING', label: 'جوش پرس' },
    { value: 'CO2_WELDING', label: 'جوش CO2' },
    { value: 'PAINTING', label: 'رنگ‌آمیزی' },
    { value: 'ASSEMBLY', label: 'مونتاژ' },
    { value: 'OTHER', label: 'سایر' },
  ],
  machineStatus: [
    { value: 'ACTIVE', label: 'فعال' },
    { value: 'MAINTENANCE', label: 'در تعمیرات' },
    { value: 'BREAKDOWN', label: 'خراب' },
    { value: 'RETIRED', label: 'بازنشسته' },
  ],
  dieStatus: [
    { value: 'ACTIVE', label: 'فعال' },
    { value: 'MAINTENANCE', label: 'در تعمیرات' },
    { value: 'RETIRED', label: 'بازنشسته' },
  ],
  warehouseType: [
    { value: 'RAW_MATERIAL', label: 'مواد اولیه' },
    { value: 'WIP', label: 'در جریان ساخت' },
    { value: 'FINISHED_GOODS', label: 'محصول تکمیلی' },
    { value: 'SCRAP', label: 'ضایعات' },
    { value: 'TOOLS', label: 'ابزار و قالب' },
  ],
  routeStatus: [
    { value: 'DRAFT', label: 'پیش‌نویس' },
    { value: 'ACTIVE', label: 'فعال' },
    { value: 'RETIRED', label: 'بازنشسته' },
  ],
};

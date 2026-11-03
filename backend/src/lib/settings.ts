import { db } from '../config/db';

/**
 * Runtime system settings (SystemSetting table) — the single source of truth
 * for values the factory must be able to personalize (هیچ مقداری در کد
 * نوشته نمی‌شود؛ همه‌چیز از این جدول خوانده می‌شود و کاربر از صفحهٔ
 * «تنظیمات سامانه» می‌تواند آن‌ها را تغییر دهد).
 */

/** Keys readable by every authenticated user (non-secret, UI-relevant). */
export const PUBLIC_SETTING_KEYS = [
  'factory.name',
  'materials.defaultSupplierName',
  'inventory.allowNegativeStock',
  'app.calendar',
] as const;

export type PublicSettings = Record<(typeof PUBLIC_SETTING_KEYS)[number], string>;

const DEFAULTS: Record<string, string> = {
  'factory.name': 'کارخانه قطعات فلزی کوثر',
  // مقدار اولیهٔ قابل تغییر — کاربر می‌تواند در تنظیمات سامانه عوضش کند
  'materials.defaultSupplierName': 'SAPCO',
};

/** Read one setting; falls back to the registered default when not set. */
export async function getSetting(key: string, fallback = ''): Promise<string> {
  const row = await db.systemSetting.findUnique({ where: { key }, select: { value: true } });
  if (row && row.value !== null && row.value.trim() !== '') return row.value;
  if (DEFAULTS[key] !== undefined) return DEFAULTS[key];
  return fallback;
}

/** Whitelisted, non-secret settings for the authenticated UI. */
export async function getPublicSettings(): Promise<PublicSettings> {
  const rows = await db.systemSetting.findMany({
    where: { key: { in: [...PUBLIC_SETTING_KEYS] } },
    select: { key: true, value: true },
  });
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const out = {} as PublicSettings;
  for (const key of PUBLIC_SETTING_KEYS) {
    out[key] = map.get(key) ?? DEFAULTS[key] ?? '';
  }
  return out;
}

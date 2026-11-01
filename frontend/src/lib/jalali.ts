const TZ = import.meta.env.VITE_APP_TIMEZONE ?? 'Asia/Tehran';

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

/** Convert Latin digits to Persian digits. */
export function faDigits(value: string | number): string {
  return String(value).replace(/\d/g, (d) => FA_DIGITS.charAt(Number(d)));
}

/** Format a number with thousand separators and Persian digits. */
export function faNumber(value: number): string {
  return new Intl.NumberFormat('fa-IR').format(value);
}

/**
 * Format an ISO timestamp / Date as a Jalali date string (e.g. ۱۴۰۵/۰۸/۱۰).
 * Uses Intl with the explicit app timezone so the result does not depend on
 * the browser's local timezone.
 */
export function formatJalaliDate(input: string | Date, persianDigits = true): string {
  const date = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(date.getTime())) return '—';
  const formatted = new Intl.DateTimeFormat('fa-IR-u-ca-persian-nu-latn', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  return persianDigits ? faDigits(formatted) : formatted;
}

/** Current time HH:mm (Persian digits) for the topbar clock. */
export function formatClock(date: Date): string {
  const formatted = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
  return faDigits(formatted);
}

export const JALALI_MONTH_NAMES = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
];

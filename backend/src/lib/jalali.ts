import { env } from '../config/env';

/**
 * Jalali (Persian) calendar helpers — server side.
 *
 * Timestamps are stored in UTC; business dates are rendered in the Jalali
 * calendar using the configured application timezone (APP_TIMEZONE).
 */

function persianParts(date: Date): Intl.DateTimeFormatPart[] {
  const fmt = new Intl.DateTimeFormat('en-US-u-ca-persian', {
    timeZone: env.APP_TIMEZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
  return fmt.formatToParts(date);
}

/** e.g. "1404/08/11" — with Persian digits when withPersianDigits is true */
export function toJalaliDateString(date: Date = new Date(), withPersianDigits = false): string {
  const parts = persianParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const year = get('year').replace(/\D/g, '');
  const month = get('month').padStart(2, '0');
  const day = get('day').padStart(2, '0');
  const iso = `${year}/${month}/${day}`;
  if (!withPersianDigits) return iso;
  return iso.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.charAt(Number(d)));
}

/** Current Jalali year as a number (used by YEARLY document sequences). */
export function currentJalaliYear(date: Date = new Date()): number {
  return Number(toJalaliDateString(date).slice(0, 4));
}

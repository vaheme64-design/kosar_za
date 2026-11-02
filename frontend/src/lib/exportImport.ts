import { api, getAuthToken } from './api';

/**
 * Excel-compatible CSV import/export helpers (client side).
 * - Export: server-side CSV (same filters/search as the on-screen table)
 *   downloaded as a Blob with the auth header.
 * - Import: the user picks a CSV/TSV file, we parse it in the browser,
 *   show a preview and POST the rows as JSON to the resource import endpoint.
 */

export function faDigitsToEn(text: string): string {
  return text
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

/** Download a server-generated CSV (auth-protected) as a file. */
export async function downloadCsvExport(path: string, filename: string): Promise<void> {
  const base: string = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';
  const token = getAuthToken();
  const res = await fetch(`${base}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    let messageFa = 'خطا در تولید فایل خروجی';
    try {
      const payload = await res.json();
      if (payload?.messageFa) messageFa = payload.messageFa;
    } catch {
      /* non-json */
    }
    throw new Error(messageFa);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
  delimiter: string;
}

/** Minimal RFC-4180-ish parser with ; or , or tab auto-detect and BOM handling. */
export function parseCsvText(raw: string): ParsedCsv {
  let text = raw.replace(/^\uFEFF/, '');
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const firstLine = text.split('\n')[0] ?? '';
  const candidates = [';', ',', '\t'];
  let delimiter = ',';
  let best = -1;
  for (const d of candidates) {
    const count = firstLine.split(d).length;
    if (count > best) {
      best = count;
      delimiter = d;
    }
  }

  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"' && field.length === 0) {
      inQuotes = true;
    } else if (ch === delimiter) {
      record.push(field);
      field = '';
    } else if (ch === '\n') {
      record.push(field);
      field = '';
      records.push(record);
      record = [];
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  const nonEmpty = records.filter((r) => r.some((c) => c.trim() !== ''));
  if (nonEmpty.length === 0) return { headers: [], rows: [], delimiter };

  const headers = nonEmpty[0]!.map((h) => h.trim());
  const rows = nonEmpty.slice(1).map((cells) => {
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = (cells[idx] ?? '').trim();
    });
    return row;
  });
  return { headers, rows, delimiter };
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('خواندن فایل ناموفق بود'));
    reader.readAsText(file, 'utf-8');
  });
}

/** Build a client-side CSV (for small local tables) — Excel-friendly. */
export function buildCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const cell = (value: string | number | null | undefined): string => {
    let text = value === null || value === undefined ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    if (/[",\n\r;]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
    return text;
  };
  const lines = [headers.map(cell).join(',')];
  for (const row of rows) lines.push(row.map(cell).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function downloadTextFile(content: string, filename: string, mime = 'text/csv; charset=utf-8'): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Trigger a plain API download for endpoints that answer with a file (e.g. reports CSV). */
export async function apiDownload(path: string, filename: string): Promise<void> {
  await downloadCsvExport(path, filename);
}

export { api };

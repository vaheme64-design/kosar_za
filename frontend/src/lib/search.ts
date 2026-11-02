import { api } from './api';

export interface SearchResultItem {
  id: string;
  title: string;
  subtitle: string | null;
  q: string | null;
}

export interface SearchResultGroup {
  type: string;
  labelFa: string;
  path: string;
  results: SearchResultItem[];
}

/**
 * Global search across modules (کالا، کویل/لوت، قرارداد، سفارش، دستور کار،
 * سند انبار، ماشین، قالب، مسیر، مشتری، انبار، کاربر) — one box for everything.
 */
export async function globalSearch(q: string, limit = 6): Promise<{ totalHits: number; groups: SearchResultGroup[] }> {
  const params = new URLSearchParams({ q, limit: String(limit) });
  const res = await api<{ totalHits: number; groups: SearchResultGroup[] }>(`/search?${params.toString()}`);
  return res;
}

/** Where each search group should navigate (module page with prefilled search). */
export function groupTargetPath(group: SearchResultGroup, item: SearchResultItem): string {
  const base = group.path;
  if (group.type === 'mos') return `/production/mos/${item.id}`;
  if (item.q) return `${base}?q=${encodeURIComponent(item.q)}`;
  return base;
}

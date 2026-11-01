import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { FileSpreadsheet, Search, ExternalLink, RefreshCw } from 'lucide-react';
import { api, getAuthToken, ApiClientError } from '../../lib/api';
import { useLookups } from '../../lib/lookups';
import { faNumber } from '../../lib/jalali';
import {
  Page, Card, Field, Select, TextInput, Button, Table, EmptyState, Loading, ErrorBanner, Badge, Qty, fa, Modal,
} from '../../components/ui';

// ---------------------------------------------------------------------------
// report contract (mirrors backend reports.types.ts)
// ---------------------------------------------------------------------------

type ValueKind = 'IDENTIFIER' | 'ACTUAL' | 'PLANNED' | 'STANDARD' | 'ESTIMATED' | 'INFO';

interface ReportColumn {
  key: string;
  labelFa: string;
  kind: ValueKind;
  unit?: string | null;
}

interface DrillRef {
  kind: string;
  id: string;
  labelFa?: string;
}

interface ReportMeta {
  generatedAt: string;
  generatedAtFa: string;
  filters: Record<string, string>;
  valueKinds: Record<ValueKind, string>;
  notesFa: string[];
  defaultPeriodApplied?: { from: string; to: string; basisFa: string };
}

interface ReportTable {
  key: string;
  titleFa: string;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  meta: ReportMeta;
}

const KIND_TONE: Record<ValueKind, 'ok' | 'warn' | 'info' | 'primary' | 'muted'> = {
  ACTUAL: 'ok',
  PLANNED: 'info',
  ESTIMATED: 'warn',
  STANDARD: 'primary',
  INFO: 'muted',
  IDENTIFIER: 'muted',
};

const KIND_SHORT: Record<ValueKind, string> = {
  ACTUAL: 'واقعی',
  PLANNED: 'برنامه‌ای',
  ESTIMATED: 'تخمینی',
  STANDARD: 'استاندارد',
  INFO: 'توضیح',
  IDENTIFIER: 'شناسه',
};

/** Which filters each report exposes (mirrors the backend catalog). */
const REPORT_FILTERS: Record<string, string[]> = {
  'plan-vs-actual': ['from', 'to', 'partId', 'customerId'],
  'order-fulfillment': ['from', 'to', 'partId', 'customerId'],
  backlog: ['partId', 'customerId'],
  'wip-by-part-operation': ['partId', 'operationId'],
  'wip-aging': ['partId', 'operationId'],
  'material-consumption': ['from', 'to', 'materialId', 'partId'],
  'sapco-account': ['from', 'to', 'materialId'],
  'inventory-valuation': ['partId', 'materialId', 'warehouseId'],
  scrap: ['from', 'to', 'partId', 'operationId'],
  'machine-workload': ['from', 'to', 'machineId'],
  'production-delays': ['partId', 'customerId', 'machineId'],
  'inventory-movements': ['from', 'to', 'partId', 'materialId', 'warehouseId'],
  'inventory-reconciliation': ['partId', 'materialId', 'warehouseId'],
};

const CELL_VALUE_KIND: Record<string, ValueKind> = {};

function cellDisplay(value: unknown): React.ReactNode {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'بله' : 'خیر';
  if (typeof value === 'object') return '—';
  return String(value);
}

// ---------------------------------------------------------------------------
// drill-down modal
// ---------------------------------------------------------------------------

function DrillDownModal({ drill, onClose }: { drill: DrillRef; onClose: () => void }) {
  const [data, setData] = useState<ReportTable | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    const params = new URLSearchParams({ kind: drill.kind, id: drill.id });
    api<ReportTable>(`/reports/drill-down?${params.toString()}`)
      .then(setData)
      .catch((err) => setError(err instanceof ApiClientError ? err.messageFa ?? err.message : 'خطا در دریافت جزئیات'));
  }, [drill]);

  const links = (data?.meta.notesFa ?? []).filter((n) => n.startsWith('پیوند:'));
  const linkTargets = links.map((n) => {
    const m = n.match(/پیوند: (.+) → (.+)$/);
    return m ? { labelFa: m[1]!, href: m[2]! } : null;
  }).filter((x): x is { labelFa: string; href: string } => x !== null);

  return (
    <Modal title={data?.titleFa ?? 'جزئیات منبع'} onClose={onClose} wide>
      {error && <ErrorBanner message={error} />}
      {!data && !error && <Loading />}
      {data && (
        <>
          {data.rows.length === 0 ? (
            <EmptyState title="سند منبعی یافت نشد" />
          ) : (
            <Table head={data.columns.map((c) => c.labelFa)} dense>
              {data.rows.map((row, i) => (
                <tr key={i}>
                  {data.columns.map((c) => (
                    <td key={c.key}>{cellDisplay(row[c.key])}</td>
                  ))}
                </tr>
              ))}
            </Table>
          )}
          {linkTargets.length > 0 && (
            <div className="modal__links">
              {linkTargets.map((l) => (
                <Link key={l.href} className="btn btn--ghost btn--sm" to={l.href} onClick={onClose}>
                  <ExternalLink size={14} /> {l.labelFa}
                </Link>
              ))}
            </div>
          )}
          <p className="card__note">زمان تولید: {data.meta.generatedAtFa}</p>
        </>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// main viewer
// ---------------------------------------------------------------------------

export function ReportViewerPage() {
  const { key = '' } = useParams();
  const { lookups } = useLookups();
  const [filters, setFilters] = useState({ from: '', to: '', partId: '', materialId: '', customerId: '', machineId: '', operationId: '', warehouseId: '' });
  const [report, setReport] = useState<ReportTable | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drill, setDrill] = useState<DrillRef | null>(null);
  const [csvBusy, setCsvBusy] = useState(false);

  const filterKeys = useMemo(() => REPORT_FILTERS[key] ?? [], [key]);

  const load = useCallback(async () => {
    if (!key) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      for (const k of filterKeys) {
        const v = filters[k as keyof typeof filters];
        if (v) params.set(k, v);
      }
      setReport(await api<ReportTable>(`/reports/${key}?${params.toString()}`));
    } catch (err) {
      setError(err instanceof ApiClientError ? err.messageFa ?? err.message : 'خطا در تولید گزارش');
    } finally {
      setLoading(false);
    }
  }, [key, filterKeys, filters]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const set = (k: keyof typeof filters) => (e: { target: { value: string } }) =>
    setFilters((f) => ({ ...f, [k]: e.target.value }));

  /** Excel-compatible CSV download with the Authorization header. */
  const downloadCsv = async () => {
    setCsvBusy(true);
    try {
      const params = new URLSearchParams({ format: 'csv' });
      for (const k of filterKeys) {
        const v = filters[k as keyof typeof filters];
        if (v) params.set(k, v);
      }
      const headers: Record<string, string> = { Accept: 'text/csv' };
      const token = getAuthToken();
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`${(import.meta.env.VITE_API_BASE_URL ?? '/api/v1')}/reports/${key}?${params.toString()}`, { headers });
      if (!res.ok) throw new Error('CSV export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${key}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError('خروجی CSV دریافت نشد');
    } finally {
      setCsvBusy(false);
    }
  };

  const hasDate = filterKeys.includes('from');

  return (
    <Page
      title={report?.titleFa ?? 'گزارش'}
      subtitle="مقادیر «واقعی» از رکوردهای ثبت‌شده، «برنامه‌ای/استاندارد» از اسناد مرجع و «تخمینی» بر پایه داده‌های مرجع محاسبه می‌شود"
      actions={
        <>
          <Button variant="ghost" onClick={() => void load()} disabled={loading} type="button">
            <RefreshCw size={15} /> به‌روزرسانی
          </Button>
          <Button onClick={() => void downloadCsv()} disabled={csvBusy || loading} type="button">
            <FileSpreadsheet size={15} /> خروجی CSV
          </Button>
        </>
      }
    >
      {filterKeys.length > 0 && (
        <Card title="فیلترها">
          <div className="form-grid form-grid--wide">
            {hasDate && (
              <>
                <Field label="از تاریخ">
                  <TextInput type="date" value={filters.from} onChange={set('from')} />
                </Field>
                <Field label="تا تاریخ">
                  <TextInput type="date" value={filters.to} onChange={set('to')} />
                </Field>
              </>
            )}
            {filterKeys.includes('partId') && (
              <Field label="قطعه">
                <Select value={filters.partId} onChange={set('partId')}>
                  <option value="">— همه —</option>
                  {lookups.parts.map((p) => (
                    <option key={p.id} value={p.id}>{p.partNumber} — {p.nameFa}</option>
                  ))}
                </Select>
              </Field>
            )}
            {filterKeys.includes('materialId') && (
              <Field label="ماده اولیه">
                <Select value={filters.materialId} onChange={set('materialId')}>
                  <option value="">— همه —</option>
                  {lookups.materials.map((m) => (
                    <option key={m.id} value={m.id}>{m.materialCode} — {m.nameFa}</option>
                  ))}
                </Select>
              </Field>
            )}
            {filterKeys.includes('customerId') && (
              <Field label="مشتری">
                <Select value={filters.customerId} onChange={set('customerId')}>
                  <option value="">— همه —</option>
                  {lookups.customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.code} — {c.nameFa}</option>
                  ))}
                </Select>
              </Field>
            )}
            {filterKeys.includes('machineId') && (
              <Field label="ماشین">
                <Select value={filters.machineId} onChange={set('machineId')}>
                  <option value="">— همه —</option>
                  {lookups.machines.map((m) => (
                    <option key={m.id} value={m.id}>{m.code} — {m.nameFa}</option>
                  ))}
                </Select>
              </Field>
            )}
            {filterKeys.includes('operationId') && (
              <Field label="عملیات">
                <Select value={filters.operationId} onChange={set('operationId')}>
                  <option value="">— همه —</option>
                  {(lookups.operations ?? []).map((o) => (
                    <option key={o.id} value={o.id}>{o.code} — {o.nameFa}</option>
                  ))}
                </Select>
              </Field>
            )}
            {filterKeys.includes('warehouseId') && (
              <Field label="انبار">
                <Select value={filters.warehouseId} onChange={set('warehouseId')}>
                  <option value="">— همه —</option>
                  {lookups.warehouses.map((w) => (
                    <option key={w.id} value={w.id}>{w.code} — {w.nameFa}</option>
                  ))}
                </Select>
              </Field>
            )}
            <div className="form-grid__action">
              <Button onClick={() => void load()} disabled={loading} type="button">
                <Search size={16} /> تولید گزارش
              </Button>
            </div>
          </div>
        </Card>
      )}

      <ErrorBanner message={error} />
      {loading && <Loading label="در حال تولید گزارش…" />}

      {!loading && report && (
        <>
          <Card
            title={`${faNumber(report.rows.length)} ردیف`}
            note={`زمان تولید گزارش: ${report.meta.generatedAtFa}`}
          >
            {/* value-kind legend — separates actuals from estimates explicitly */}
            <div className="report-legend">
              {report.columns
                .filter((c, i, arr) => arr.findIndex((x) => x.kind === c.kind) === i)
                .map((c) => (
                  <Badge key={c.kind} tone={KIND_TONE[c.kind]}>{KIND_SHORT[c.kind]}</Badge>
                ))}
              <span className="report-legend__text">{report.meta.valueKinds.ACTUAL} | {report.meta.valueKinds.ESTIMATED}</span>
            </div>

            {report.rows.length === 0 ? (
              <EmptyState icon={<FileSpreadsheet size={28} />} title="داده‌ای برای این گزارش یافت نشد" hint="فیلترها را تغییر دهید یا ابتدا داده ثبت کنید" />
            ) : (
              <Table head={report.columns.map((c) => c.labelFa + (c.unit ? ` (${c.unit})` : ''))} dense>
                {report.rows.map((row, i) => (
                  <tr key={i}>
                    {report.columns.map((c) => {
                      const v = row[c.key];
                      if (c.key === '_drill') {
                        const d = v as DrillRef | undefined;
                        if (!d || typeof d !== 'object' || !d.kind) return <td key={c.key}>—</td>;
                        return (
                          <td key={c.key}>
                            <button className="btn btn--ghost btn--sm" onClick={() => setDrill(d)} type="button">
                              جزئیات
                            </button>
                          </td>
                        );
                      }
                      if (typeof v === 'boolean') {
                        return (
                          <td key={c.key}>
                            <Badge tone={v ? 'ok' : 'warn'}>{v ? 'بله' : 'خیر'}</Badge>
                          </td>
                        );
                      }
                      if (c.kind === 'ACTUAL' || c.kind === 'ESTIMATED' || c.kind === 'STANDARD' || c.kind === 'PLANNED') {
                        const num = Number(v);
                        if (v !== null && v !== undefined && Number.isFinite(num)) {
                          return <td key={c.key}><Qty value={num} unit={c.unit ?? null} /></td>;
                        }
                        return <td key={c.key}>{cellDisplay(v)}</td>;
                      }
                      void CELL_VALUE_KIND;
                      void fa;
                      return <td key={c.key}>{cellDisplay(v)}</td>;
                    })}
                  </tr>
                ))}
              </Table>
            )}
          </Card>

          {report.meta.notesFa.length > 0 && (
            <Card title="یادداشت‌های گزارش">
              <ul className="report-notes">
                {report.meta.notesFa.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}

      {drill && <DrillDownModal drill={drill} onClose={() => setDrill(null)} />}
    </Page>
  );
}

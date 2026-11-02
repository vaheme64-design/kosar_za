import { Fragment, useCallback, useEffect, useState } from 'react';
import { Download, History, Layers, Lock, PackageCheck, PackageMinus, PackageOpen, RotateCcw, Scale, Search } from 'lucide-react';
import { api } from '../../lib/api';
import { useLookups } from '../../lib/lookups';
import { faNumber, formatJalaliDate } from '../../lib/jalali';
import { buildCsv, downloadTextFile } from '../../lib/exportImport';
import { Page, Card, Field, TextInput, Select, Button, Table, EmptyState, Loading, ErrorBanner, Badge, Qty, StatCardLike, fa } from '../../components/ui';
import { SubNav } from '../../components/SubNav';

// ---------------------------------------------------------------------------
// types (mirror /inventory/lots/summary and /inventory/lots/:id/trace)
// ---------------------------------------------------------------------------

type DerivedLotStatus = 'FULL' | 'PARTIAL' | 'CONSUMED' | 'BLOCKED';

interface LotLocation {
  warehouseCode: string;
  warehouseNameFa: string;
  locationCode: string | null;
  locationNameFa: string | null;
  weightKg: string;
}

interface LotRow {
  id: string;
  lotNumber: string;
  supplierLotNumber: string | null;
  certificateNumber: string | null;
  receiptDate: string;
  ownership: string;
  status: string;
  derivedStatus: DerivedLotStatus;
  derivedStatusFa: string;
  material: { id: string; code: string; nameFa: string; unit: string };
  weightReceivedKg: string;
  weightRemainingKg: string;
  consumedKg: string;
  consumedPct: number;
  quantityReceived: string;
  quantityRemaining: string;
  contractNumbers: string[];
  locations: LotLocation[];
}

interface LotSummary {
  total: number;
  full: number;
  partial: number;
  consumed: number;
  blocked: number;
  totalReceivedKg: string;
  totalRemainingKg: string;
  generatedAt: string;
}

interface LotTrace {
  lot: LotRow;
  contractReceipts: { contractNumber: string; supplierName: string; receivedDate: string; quantity: string; weightKg: string | null }[];
  balances: {
    warehouse: { code: string; nameFa: string };
    location: { code: string; nameFa: string } | null;
    unit: string;
    quantity: string;
    weightKg: string;
    qualityStatus: string;
    ownership: string;
  }[];
  movements: {
    transactionNumber: string;
    type: string;
    direction: 'IN' | 'OUT';
    quantity: string;
    weightKg: string | null;
    occurredAt: string;
    warehouse: { code: string; nameFa: string };
    location: { code: string; nameFa: string } | null;
    reversalOfTransaction: string | null;
    document: {
      number: string;
      type: string;
      postingStatus: string;
      referenceType: string | null;
      referenceLabel: string | null;
      purpose: string | null;
    } | null;
  }[];
  summary: { issueCount: number; movementCount: number; lastActivityAt: string | null; generatedAt: string };
}

const STATUS_TONE: Record<DerivedLotStatus, 'ok' | 'warn' | 'muted' | 'danger'> = {
  FULL: 'ok',
  PARTIAL: 'warn',
  CONSUMED: 'muted',
  BLOCKED: 'danger',
};

const TX_TYPE_FA: Record<string, string> = {
  RECEIPT: 'رسید',
  ISSUE: 'حواله مصرف',
  ADJUSTMENT_IN: 'اصلاحیه (افزایش)',
  ADJUSTMENT_OUT: 'اصلاحیه (کاهش)',
  TRANSFER_IN: 'انتقال (ورود)',
  TRANSFER_OUT: 'انتقال (خروج)',
};

export function LotsPage() {
  const { lookups } = useLookups();
  const [filters, setFilters] = useState({ q: '', materialId: '', warehouseId: '', status: '' });
  const [debouncedQ, setDebouncedQ] = useState('');
  const [rows, setRows] = useState<LotRow[]>([]);
  const [summary, setSummary] = useState<LotSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // inline trace
  const [openLotId, setOpenLotId] = useState<string | null>(null);
  const [trace, setTrace] = useState<Record<string, LotTrace>>({});
  const [traceLoadingId, setTraceLoadingId] = useState<string | null>(null);
  const [traceError, setTraceError] = useState<string | null>(null);

  // debounce the free-text search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(filters.q.trim()), 350);
    return () => clearTimeout(t);
  }, [filters.q]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (debouncedQ) params.set('q', debouncedQ);
      if (filters.materialId) params.set('materialId', filters.materialId);
      if (filters.warehouseId) params.set('warehouseId', filters.warehouseId);
      if (filters.status) params.set('status', filters.status);
      const res = await api<{ lots: LotRow[]; summary: LotSummary }>(`/inventory/lots/summary?${params.toString()}`);
      setRows(res.lots);
      setSummary(res.summary);
    } catch (err) {
      const faMsg = (err as { messageFa?: string }).messageFa;
      setError(faMsg ?? (err instanceof Error ? err.message : 'خطا در دریافت رول‌ها'));
    } finally {
      setLoading(false);
    }
  }, [debouncedQ, filters.materialId, filters.warehouseId, filters.status]);

  useEffect(() => {
    void load();
  }, [load]);

  const set = (k: keyof typeof filters) => (e: { target: { value: string } }) =>
    setFilters((f) => ({ ...f, [k]: e.target.value }));

  const toggleTrace = async (id: string) => {
    setTraceError(null);
    if (openLotId === id) {
      setOpenLotId(null);
      return;
    }
    setOpenLotId(id);
    if (trace[id]) return; // cached
    setTraceLoadingId(id);
    try {
      const res = await api<LotTrace>(`/inventory/lots/${id}/trace`);
      setTrace((prev) => ({ ...prev, [id]: res }));
    } catch (err) {
      const faMsg = (err as { messageFa?: string }).messageFa;
      setTraceError(faMsg ?? (err instanceof Error ? err.message : 'خطا در ردیابی مصرف رول'));
    } finally {
      setTraceLoadingId(null);
    }
  };

  /** Excel-friendly client-side CSV of the CURRENT filtered lot list. */
  const exportCsv = () => {
    const csv = buildCsv(
      ['شماره لوت', 'کد ماده', 'ماده', 'تاریخ رسید', 'وضعیت رول', 'مالکیت', 'دریافتی (kg)', 'باقی‌مانده (kg)', 'مصرف‌شده (kg)', 'درصد مصرف', 'قراردادها', 'موقعیت‌ها'],
      rows.map((r) => [
        r.lotNumber,
        r.material.code,
        r.material.nameFa,
        formatJalaliDate(r.receiptDate),
        r.derivedStatusFa,
        fa(r.ownership),
        r.weightReceivedKg,
        r.weightRemainingKg,
        r.consumedKg,
        String(r.consumedPct),
        r.contractNumbers.join(' | '),
        r.locations.map((x) => `${x.warehouseCode}${x.locationCode ? ` / ${x.locationCode}` : ''}`).join(' | '),
      ]),
    );
    downloadTextFile(csv, 'kpims-lots.csv');
  };

  return (
    <Page
      title="رول‌ها و لوت‌های ماده اولیه"
      subtitle="پاسخ به «چند رول دارم، چند تا ناقص است و هر رول برای چه کاری مصرف شده» — وضعیت هر رول از موجودی واقعی محاسبه می‌شود"
      actions={
        <Button variant="ghost" onClick={exportCsv} disabled={rows.length === 0} type="button">
          <Download size={15} /> خروجی CSV
        </Button>
      }
    >
      <SubNav
        items={[
          { to: '/inventory', label: 'داشبورد' },
          { to: '/inventory/inquiry', label: 'استعلام موجودی' },
          { to: '/inventory/lots', label: 'رول‌ها و لوت‌ها' },
          { to: '/inventory/documents', label: 'سندها' },
        ]}
      />

      {summary && (
        <div className="stat-grid stat-grid--wide">
          <StatCardLike icon={<Layers size={20} />} value={faNumber(summary.total)} label="کل رول‌ها (نتیجه فیلتر فعلی)" tone="primary" />
          <StatCardLike icon={<PackageCheck size={20} />} value={faNumber(summary.full)} label="سالم" tone="ok" />
          <StatCardLike icon={<PackageOpen size={20} />} value={faNumber(summary.partial)} label="ناقص (بازشده)" tone="warn" />
          <StatCardLike icon={<PackageMinus size={20} />} value={faNumber(summary.consumed)} label="مصرف‌شده" tone="muted" />
          <StatCardLike icon={<Lock size={20} />} value={faNumber(summary.blocked)} label="مسدود" tone="danger" />
          <StatCardLike icon={<Scale size={20} />} value={`${faNumber(Math.round(Number(summary.totalRemainingKg)))} kg`} label="جمع باقی‌مانده" tone="info" />
        </div>
      )}

      <Card title="فیلترها">
        <div className="form-grid form-grid--wide">
          <Field label="جستجو (شماره لوت، گواهی، قرارداد…)">
            <TextInput type="search" value={filters.q} onChange={set('q')} placeholder="مثلاً شماره لوت یا شماره قرارداد" />
          </Field>
          <Field label="ماده اولیه">
            <Select value={filters.materialId} onChange={set('materialId')}>
              <option value="">— همه —</option>
              {lookups.materials.map((m) => (
                <option key={m.id} value={m.id}>{m.materialCode} — {m.nameFa}</option>
              ))}
            </Select>
          </Field>
          <Field label="انبار">
            <Select value={filters.warehouseId} onChange={set('warehouseId')}>
              <option value="">— همه —</option>
              {lookups.warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.code} — {w.nameFa}</option>
              ))}
            </Select>
          </Field>
          <Field label="وضعیت رول">
            <Select value={filters.status} onChange={set('status')}>
              <option value="">— همه —</option>
              <option value="FULL">سالم (باز)</option>
              <option value="PARTIAL">ناقص (بازشده)</option>
              <option value="CONSUMED">مصرف‌شده</option>
              <option value="BLOCKED">مسدود</option>
            </Select>
          </Field>
          <div className="form-grid__action">
            <Button onClick={() => void load()} disabled={loading} type="button">
              <Search size={16} /> جستجو
            </Button>
          </div>
        </div>
      </Card>

      <ErrorBanner message={error} />
      {loading && <Loading label="در حال دریافت رول‌ها…" />}

      {!loading && rows.length === 0 && (
        <EmptyState icon={<Layers size={28} />} title="رولی یافت نشد" hint="فیلترها را تغییر دهید یا اولین رسید ماده اولیه را ثبت کنید" />
      )}

      {rows.length > 0 && (
        <Card title={`${faNumber(rows.length)} رول`} note={summary ? `خلاصه در ${formatJalaliDate(summary.generatedAt)} — اعداد فقط از موجودی واقعی` : undefined}>
          <Table
            head={['شماره لوت', 'ماده', 'تاریخ رسید', 'وضعیت', 'دریافتی (kg)', 'باقی‌مانده (kg)', 'مصرف‌شده (kg)', 'درصد مصرف', 'قراردادها', 'موقعیت‌ها', '']}
            dense
          >
            {rows.map((r) => (
              <Fragment key={r.id}>
                <tr>
                  <td>
                    <strong dir="ltr">{r.lotNumber}</strong>
                    {r.supplierLotNumber && <div className="muted" dir="ltr">{r.supplierLotNumber}</div>}
                  </td>
                  <td>
                    <span dir="ltr">{r.material.code}</span>
                    <div className="muted">{r.material.nameFa}</div>
                  </td>
                  <td className="muted">{formatJalaliDate(r.receiptDate)}</td>
                  <td><Badge tone={STATUS_TONE[r.derivedStatus]}>{r.derivedStatusFa}</Badge></td>
                  <td><Qty value={r.weightReceivedKg} unit="kg" /></td>
                  <td><strong><Qty value={r.weightRemainingKg} unit="kg" /></strong></td>
                  <td><Qty value={r.consumedKg} unit="kg" /></td>
                  <td>{faNumber(r.consumedPct)}٪</td>
                  <td className="muted">{r.contractNumbers.length > 0 ? r.contractNumbers.join('، ') : '—'}</td>
                  <td className="muted">
                    {r.locations.length > 0
                      ? r.locations.map((x) => `${x.warehouseCode}${x.locationCode ? ` / ${x.locationCode}` : ''}`).join('، ')
                      : '—'}
                  </td>
                  <td>
                    <button className="btn btn--sm btn--ghost" onClick={() => void toggleTrace(r.id)} type="button">
                      <History size={13} /> {openLotId === r.id ? 'بستن ردیابی' : 'ردیابی مصرف'}
                    </button>
                  </td>
                </tr>
                {openLotId === r.id && (
                  <tr className="trace-row">
                    <td colSpan={11}>
                      {traceLoadingId === r.id && <Loading label="در حال ردیابی مصرف رول…" />}
                      {traceError && openLotId === r.id && <ErrorBanner message={traceError} />}
                      {trace[r.id] && <LotTraceView t={trace[r.id]!} />}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </Table>
        </Card>
      )}
    </Page>
  );
}

// ---------------------------------------------------------------------------
// inline trace detail
// ---------------------------------------------------------------------------

function LotTraceView({ t }: { t: LotTrace }) {
  return (
    <div className="lot-trace">
      <div className="lot-trace__header">
        <div className="detail-grid">
          <div>
            <span className="muted">رول:</span> <b dir="ltr">{t.lot.lotNumber}</b>{' '}
            <Badge tone={STATUS_TONE[t.lot.derivedStatus]}>{t.lot.derivedStatusFa}</Badge>
          </div>
          <div>
            <span className="muted">ماده:</span> <span dir="ltr">{t.lot.material.code}</span> — {t.lot.material.nameFa}
          </div>
          <div>
            <span className="muted">تاریخ رسید:</span> {formatJalaliDate(t.lot.receiptDate)}
          </div>
          <div>
            <span className="muted">مالکیت:</span> {fa(t.lot.ownership)}
          </div>
          <div>
            <span className="muted">مصرف:</span> {faNumber(t.lot.consumedPct)}٪ ({faNumber(Math.round(Number(t.lot.consumedKg)))} kg)
          </div>
          <div>
            <span className="muted">آخرین فعالیت:</span> {t.summary.lastActivityAt ? formatJalaliDate(t.summary.lastActivityAt) : '—'}
          </div>
          {t.lot.certificateNumber && (
            <div>
              <span className="muted">شماره گواهی:</span> <span dir="ltr">{t.lot.certificateNumber}</span>
            </div>
          )}
          <div>
            <span className="muted">تعداد حواله مصرف:</span> {faNumber(t.summary.issueCount)} از {faNumber(t.summary.movementCount)} تراکنش
          </div>
        </div>
      </div>

      {/* قراردادها */}
      <h4 className="modal-section-title">دریافت‌های قرارداد</h4>
      {t.contractReceipts.length === 0 ? (
        <p className="muted">دریافتی روی قرارداد ثبت نشده است.</p>
      ) : (
        <Table head={['قرارداد', 'تأمین‌کننده', 'تاریخ دریافت', 'مقدار', 'وزن (kg)']} dense>
          {t.contractReceipts.map((c, i) => (
            <tr key={i}>
              <td dir="ltr">{c.contractNumber}</td>
              <td>{c.supplierName}</td>
              <td className="muted">{formatJalaliDate(c.receivedDate)}</td>
              <td><Qty value={c.quantity} unit={t.lot.material.unit} /></td>
              <td><Qty value={c.weightKg} unit="kg" /></td>
            </tr>
          ))}
        </Table>
      )}

      {/* موجودی‌های فعلی */}
      <h4 className="modal-section-title">موجودی فعلی رول</h4>
      {t.balances.length === 0 ? (
        <p className="muted">موجودی فعلی برای این رول ثبت نشده است (احتمالاً کاملاً مصرف شده).</p>
      ) : (
        <Table head={['انبار', 'موقعیت', 'واحد', 'مقدار', 'وزن (kg)', 'کیفیت', 'مالکیت']} dense>
          {t.balances.map((b, i) => (
            <tr key={i}>
              <td>{b.warehouse.nameFa} (<span dir="ltr">{b.warehouse.code}</span>)</td>
              <td>{b.location ? <span dir="ltr">{b.location.code}</span> : '—'}</td>
              <td>{b.unit}</td>
              <td><Qty value={b.quantity} unit={b.unit} /></td>
              <td><Qty value={b.weightKg} unit="kg" /></td>
              <td>
                <Badge tone={b.qualityStatus === 'APPROVED' ? 'ok' : b.qualityStatus === 'BLOCKED' ? 'danger' : 'warn'}>
                  {b.qualityStatus === 'APPROVED' ? 'تأیید' : b.qualityStatus === 'BLOCKED' ? 'مسدود' : 'در انتظار'}
                </Badge>
              </td>
              <td>{fa(b.ownership)}</td>
            </tr>
          ))}
        </Table>
      )}

      {/* خط زمانی حرکات */}
      <h4 className="modal-section-title">خط زمانی حرکات رول</h4>
      {t.movements.length === 0 ? (
        <p className="muted">حرکتی برای این رول ثبت نشده است.</p>
      ) : (
        <ol className="ai-timeline">
          {t.movements.map((m) => (
            <li key={m.transactionNumber} className={`ai-timeline__item ai-timeline__item--${m.direction.toLowerCase()}${m.reversalOfTransaction ? ' row--reversal' : ''}`}>
              <div className="ai-timeline__when muted">
                {formatJalaliDate(m.occurredAt)} · <span dir="ltr">{m.transactionNumber}</span>
              </div>
              <div className="ai-timeline__main">
                <b>
                  {m.direction === 'IN' ? '↑' : '↓'} {TX_TYPE_FA[m.type] ?? fa(m.type)}
                </b>{' '}
                <Qty value={m.quantity} unit={t.lot.material.unit} /> · <Qty value={m.weightKg} unit="kg" />
                <span className="muted">
                  {' '}
                  — {m.warehouse.nameFa}
                  {m.location ? ` / ${m.location.code}` : ''}
                </span>
                {m.document && (
                  <div className="ai-timeline__doc">
                    <span className="muted">سند:</span> <span dir="ltr">{m.document.number}</span> ({fa(m.document.type)} · {fa(m.document.postingStatus)})
                    {m.document.referenceLabel && (
                      <>
                        {' '}· <span className="muted">مرجع:</span> {m.document.referenceLabel}
                      </>
                    )}
                    {m.document.purpose && (
                      <>
                        {' '}· <span className="muted">کاربرد:</span> {m.document.purpose}
                      </>
                    )}
                  </div>
                )}
                {m.reversalOfTransaction && (
                  <div className="ai-timeline__reversal">
                    <RotateCcw size={11} /> ابطالی — خنثی‌کننده تراکنش <span dir="ltr">{m.reversalOfTransaction}</span>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

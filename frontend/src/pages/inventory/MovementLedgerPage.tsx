import { useCallback, useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { api } from '../../lib/api';
import { useLookups } from '../../lib/lookups';
import { Page, Card, Field, Select, TextInput, Button, Table, EmptyState, Loading, ErrorBanner, Badge, Qty, fa } from '../../components/ui';
import { SubNav } from '../../components/SubNav';

interface TxRow {
  id: string;
  transactionNumber: string;
  type: string;
  quantity: string;
  weightKg: string | null;
  occurredAt: string;
  ownership: string;
  qualityStatus: string;
  part?: { partNumber: string; nameFa: string } | null;
  material?: { materialCode: string; nameFa: string } | null;
  warehouse: { code: string; nameFa: string };
  location?: { code: string; nameFa: string } | null;
  lot?: { lotNumber: string } | null;
  unit: { code: string };
  document?: { documentNumber: string; documentType: string } | null;
  reversalOf?: { transactionNumber: string } | null;
}

const TX_TYPES = ['RECEIPT', 'ISSUE', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT'];

export function MovementLedgerPage() {
  const { lookups, loading: lookupsLoading } = useLookups();
  const [filters, setFilters] = useState({ partId: '', materialId: '', warehouseId: '', lotId: '', type: '', from: '', to: '' });
  const [rows, setRows] = useState<TxRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const search = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSearched(true);
    try {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
      params.set('take', '300');
      const res = await api<{ transactions: TxRow[] }>(`/inventory/transactions?${params.toString()}`);
      setRows(res.transactions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در دریافت دفتر کل');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (k: keyof typeof filters) => (e: { target: { value: string } }) => setFilters((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Page title="دفتر کل حرکت موجودی" subtitle="تراکنش‌های تغییرناپذیر — رکوردهای ابطالی به تراکنش اصلی ارجاع دارند">
      <SubNav
        items={[
          { to: '/inventory', label: 'داشبورد' },
          { to: '/inventory/inquiry', label: 'استعلام موجودی' },
          { to: '/inventory/movements', label: 'دفتر کل حرکت' },
        ]}
      />

      <Card title="فیلترها">
        <div className="form-grid form-grid--wide">
          <Field label="قطعه">
            <Select value={filters.partId} onChange={set('partId')}>
              <option value="">— همه —</option>
              {lookups.parts.map((p) => (
                <option key={p.id} value={p.id}>{p.partNumber} — {p.nameFa}</option>
              ))}
            </Select>
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
          <Field label="نوع تراکنش">
            <Select value={filters.type} onChange={set('type')}>
              <option value="">— همه —</option>
              {TX_TYPES.map((t) => (
                <option key={t} value={t}>{fa(t)}</option>
              ))}
            </Select>
          </Field>
          <Field label="از تاریخ">
            <TextInput type="date" value={filters.from} onChange={set('from')} />
          </Field>
          <Field label="تا تاریخ">
            <TextInput type="date" value={filters.to} onChange={set('to')} />
          </Field>
          <div className="form-grid__action">
            <Button onClick={() => void search()} disabled={loading} type="button">
              <History size={16} /> جستجو
            </Button>
          </div>
        </div>
      </Card>

      <ErrorBanner message={error} />
      {lookupsLoading && <Loading />}
      {loading && <Loading />}

      {!loading && rows.length === 0 && searched && (
        <EmptyState icon={<History size={28} />} title="تراکنشی یافت نشد" />
      )}

      {rows.length > 0 && (
        <Card title={`${rows.length} تراکنش`}>
          <Table head={['شماره', 'نوع', 'قلم', 'انبار', 'موقعیت', 'لوت', 'مقدار', 'وزن (kg)', 'سند', 'زمان', 'ابطال']}>
            {rows.map((t) => (
              <tr key={t.id} className={t.reversalOf ? 'row--reversal' : ''}>
                <td>{t.transactionNumber}</td>
                <td>
                  <Badge tone={t.type === 'RECEIPT' || t.type.includes('IN') ? 'ok' : 'warn'}>
                    {t.reversalOf ? 'ابطال' : fa(t.type)}
                  </Badge>
                </td>
                <td>
                  {t.part ? `${t.part.partNumber} — ${t.part.nameFa}` : t.material ? `${t.material.materialCode} — ${t.material.nameFa}` : '—'}
                </td>
                <td>{t.warehouse.nameFa}</td>
                <td>{t.location?.code ?? '—'}</td>
                <td>{t.lot?.lotNumber ?? '—'}</td>
                <td><Qty value={t.quantity} unit={t.unit.code} /></td>
                <td><Qty value={t.weightKg} unit="kg" /></td>
                <td>{t.document?.documentNumber ?? '—'}</td>
                <td className="muted">{new Date(t.occurredAt).toLocaleString('fa-IR')}</td>
                <td>{t.reversalOf ? <span className="muted">↩ {t.reversalOf.transactionNumber}</span> : '—'}</td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </Page>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { api } from '../../lib/api';
import { useLookups } from '../../lib/lookups';
import { Page, Card, Field, Select, Button, Table, EmptyState, Loading, ErrorBanner, Badge, Qty, fa } from '../../components/ui';
import { SubNav } from '../../components/SubNav';

interface BalanceRow {
  partId: string | null;
  materialId: string | null;
  itemCode: string;
  itemName: string;
  unitCode: string;
  warehouseCode: string;
  warehouseName: string;
  locationCode: string | null;
  lotNumber: string | null;
  ownership: string;
  qualityStatus: string;
  quantity: string;
  weightKg: string;
  reservedQuantity: string;
  blockedQuantity: string;
  availableQuantity: string;
  lastTransactionAt: string | null;
}

export function StockInquiryPage() {
  const { lookups, loading: lookupsLoading } = useLookups();
  const [filters, setFilters] = useState({ partId: '', materialId: '', warehouseId: '', locationId: '', ownership: '', qualityStatus: '' });
  const [rows, setRows] = useState<BalanceRow[]>([]);
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
      const res = await api<{ balances: BalanceRow[] }>(`/inventory/balances?${params.toString()}`);
      setRows(res.balances);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در استعلام موجودی');
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
    <Page title="استعلام موجودی" subtitle="موجودی فیزیکی، امانی، رزروشده، مسدود کیفیت و قابل دسترس — به تفکیک قلم، انبار، موقعیت، لوت و وضعیت">
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
          <Field label="موقعیت">
            <Select value={filters.locationId} onChange={set('locationId')}>
              <option value="">— همه —</option>
              {lookups.locations
                .filter((l) => !filters.warehouseId || l.warehouseId === filters.warehouseId)
                .map((l) => (
                  <option key={l.id} value={l.id}>{l.code} — {l.nameFa}</option>
                ))}
            </Select>
          </Field>
          <Field label="مالکیت">
            <Select value={filters.ownership} onChange={set('ownership')}>
              <option value="">— همه —</option>
              <option value="OWNED">مالی</option>
              <option value="SUPPLIER_CONSIGNMENT">امانی تأمین‌کننده</option>
            </Select>
          </Field>
          <Field label="وضعیت کیفیت">
            <Select value={filters.qualityStatus} onChange={set('qualityStatus')}>
              <option value="">— همه —</option>
              <option value="APPROVED">تأییدشده</option>
              <option value="PENDING">در انتظار کنترل کیفیت</option>
              <option value="BLOCKED">مسدود</option>
            </Select>
          </Field>
          <div className="form-grid__action">
            <Button onClick={() => void search()} disabled={loading} type="button">
              <Search size={16} /> جستجو
            </Button>
          </div>
        </div>
      </Card>

      {lookupsLoading && <Loading />}
      <ErrorBanner message={error} />
      {loading && <Loading />}

      {!loading && rows.length === 0 && searched && (
        <EmptyState icon={<Search size={28} />} title="موردی یافت نشد" hint="فیلترها را تغییر دهید یا اولین رسید را ثبت کنید" />
      )}

      {rows.length > 0 && (
        <Card title={`نتایج (${rows.length} ردیف)`}>
          <Table head={['قلم', 'انبار', 'موقعیت', 'لوت', 'واحد', 'مالکیت', 'کیفیت', 'موجودی', 'وزن (kg)', 'رزروشده', 'مسدود', 'قابل دسترس']}>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>
                  <strong>{r.itemCode}</strong>
                  <div className="muted">{r.itemName}</div>
                </td>
                <td>{r.warehouseName}</td>
                <td>{r.locationCode ?? '—'}</td>
                <td>{r.lotNumber ?? '—'}</td>
                <td>{r.unitCode}</td>
                <td><Badge tone={r.ownership === 'OWNED' ? 'primary' : 'info'}>{fa(r.ownership)}</Badge></td>
                <td>
                  <Badge tone={r.qualityStatus === 'APPROVED' ? 'ok' : r.qualityStatus === 'BLOCKED' ? 'danger' : 'warn'}>
                    {r.qualityStatus === 'APPROVED' ? 'تأیید' : r.qualityStatus === 'BLOCKED' ? 'مسدود' : 'در انتظار'}
                  </Badge>
                </td>
                <td><Qty value={r.quantity} unit={r.unitCode} /></td>
                <td><Qty value={r.weightKg} unit="kg" /></td>
                <td><Qty value={r.reservedQuantity} /></td>
                <td><Qty value={r.blockedQuantity} /></td>
                <td><strong><Qty value={r.availableQuantity} /></strong></td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </Page>
  );
}

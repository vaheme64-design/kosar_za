import { useCallback, useEffect, useState } from 'react';
import { Lock, Plus, Unlock } from 'lucide-react';
import { api } from '../../lib/api';
import { useLookups } from '../../lib/lookups';
import { Page, Card, Modal, Field, TextInput, Select, Button, Table, EmptyState, Loading, ErrorBanner, SuccessBanner, Badge, Qty, fa } from '../../components/ui';
import { SubNav } from '../../components/SubNav';

interface ReservationRow {
  id: string;
  partId: string | null;
  materialId: string | null;
  quantity: string;
  unit: { code: string };
  status: string;
  warehouse?: { code: string; nameFa: string } | null;
  part?: { partNumber: string; nameFa: string } | null;
  material?: { materialCode: string; nameFa: string } | null;
  forManufacturingOrder?: { moNumber: string } | null;
  notes: string | null;
  createdAt: string;
}

export function ReservationsPage() {
  const { lookups, loading: lookupsLoading } = useLookups();
  const [rows, setRows] = useState<ReservationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ kind: 'MATERIAL', itemId: '', quantity: '', warehouseId: '', notes: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ reservations: ReservationRow[] }>('/inventory/reservations');
      setRows(res.reservations);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در دریافت رزروها');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (!form.itemId) return setError('قلم را انتخاب کنید');
    if (!form.quantity || Number(form.quantity) <= 0) return setError('مقدار نامعتبر است');
    setBusy(true);
    setError(null);
    try {
      await api('/inventory/reservations', {
        method: 'POST',
        body: {
          ...(form.kind === 'MATERIAL' ? { materialId: form.itemId } : { partId: form.itemId }),
          quantity: form.quantity,
          ...(form.warehouseId ? { warehouseId: form.warehouseId } : {}),
          notes: form.notes || null,
        },
      });
      setModal(false);
      setNotice('رزرو ایجاد شد');
      setForm({ kind: 'MATERIAL', itemId: '', quantity: '', warehouseId: '', notes: '' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در ایجاد رزرو');
    } finally {
      setBusy(false);
    }
  };

  const release = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/inventory/reservations/${id}/release`, { method: 'POST' });
      setNotice('رزرو آزاد شد');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در آزادسازی رزرو');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page
      title="رزرو موجودی"
      subtitle="موجودی رزروشده از «قابل دسترس» کسر می‌شود؛ رزرو با حواله مصرف و با ابطال حواله بازیابی می‌شود"
      actions={
        <Button onClick={() => setModal(true)} type="button">
          <Plus size={16} /> رزرو جدید
        </Button>
      }
    >
      <SubNav
        items={[
          { to: '/inventory', label: 'داشبورد' },
          { to: '/inventory/inquiry', label: 'استعلام موجودی' },
          { to: '/inventory/reservations', label: 'رزروها' },
        ]}
      />
      <SuccessBanner message={notice} />
      <ErrorBanner message={error} />
      {lookupsLoading && <Loading />}
      {loading && <Loading />}

      {!loading && rows.length === 0 && <EmptyState icon={<Lock size={28} />} title="رزروی وجود ندارد" />}

      {rows.length > 0 && (
        <Card title={`${rows.length} رزرو`}>
          <Table head={['قلم', 'انبار', 'مقدار', 'دستور کار مرتبط', 'وضعیت', 'یادداشت', 'تاریخ', '']}>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.part ? `${r.part.partNumber} — ${r.part.nameFa}` : r.material ? `${r.material.materialCode} — ${r.material.nameFa}` : '—'}</td>
                <td>{r.warehouse?.nameFa ?? '—'}</td>
                <td><Qty value={r.quantity} unit={r.unit.code} /></td>
                <td>{r.forManufacturingOrder?.moNumber ?? '—'}</td>
                <td>
                  <Badge tone={r.status === 'ACTIVE' ? 'primary' : r.status === 'CONSUMED' ? 'ok' : 'muted'}>{fa(r.status)}</Badge>
                </td>
                <td className="muted">{r.notes ?? '—'}</td>
                <td className="muted">{new Date(r.createdAt).toLocaleDateString('fa-IR')}</td>
                <td>
                  {r.status === 'ACTIVE' && (
                    <button className="btn btn--sm btn--warn" onClick={() => void release(r.id)} disabled={busy}>
                      <Unlock size={13} /> آزادسازی
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      {modal && (
        <Modal title="رزرو جدید" onClose={() => setModal(false)}>
          <div className="form-grid">
            <Field label="نوع قلم" required>
              <Select value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value, itemId: '' }))}>
                <option value="MATERIAL">ماده اولیه</option>
                <option value="PART">قطعه</option>
              </Select>
            </Field>
            <Field label="قلم" required>
              <Select value={form.itemId} onChange={(e) => setForm((f) => ({ ...f, itemId: e.target.value }))}>
                <option value="">— انتخاب —</option>
                {(form.kind === 'MATERIAL' ? lookups.materials : lookups.parts).map((item) => (
                  <option key={item.id} value={item.id}>
                    {'materialCode' in item ? item.materialCode : (item as { partNumber: string }).partNumber} — {item.nameFa}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="مقدار" required>
              <TextInput type="number" min="0" step="0.001" value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} />
            </Field>
            <Field label="انبار (اختیاری)">
              <Select value={form.warehouseId} onChange={(e) => setForm((f) => ({ ...f, warehouseId: e.target.value }))}>
                <option value="">— همه انبارها —</option>
                {lookups.warehouses.map((w) => (
                  <option key={w.id} value={w.id}>{w.code} — {w.nameFa}</option>
                ))}
              </Select>
            </Field>
            <Field label="یادداشت">
              <TextInput value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </Field>
          </div>
          <div className="form-actions">
            <Button onClick={() => void create()} disabled={busy} type="button">
              <Lock size={15} /> ایجاد رزرو
            </Button>
          </div>
        </Modal>
      )}
    </Page>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Send, Undo2, ArrowLeftRight, Plus } from 'lucide-react';
import { api } from '../../lib/api';
import { useLookups } from '../../lib/lookups';
import { useAuth } from '../../context/AuthContext';
import { Page, Card, Modal, Field, TextInput, Select, Button, Table, EmptyState, Loading, ErrorBanner, SuccessBanner, Badge, Qty, fa } from '../../components/ui';
import { SubNav } from '../../components/SubNav';

interface TransferRow {
  id: string;
  transferNumber: string;
  part: { partNumber: string; nameFa: string };
  quantity: string;
  weightKg: string | null;
  transferDate: string;
  status: string;
  postingStatus: string;
  fromOperation?: { sequence: number; operation: { nameFa: string }; manufacturingOrder: { moNumber: string } } | null;
  toOperation?: { sequence: number; operation: { nameFa: string }; manufacturingOrder: { moNumber: string } } | null;
  fromWarehouse?: { nameFa: string } | null;
  toWarehouse?: { nameFa: string } | null;
}

interface OpRow {
  id: string;
  sequence: number;
  operation: { nameFa: string };
  moNumber: string;
  partNumber: string;
  partId: string;
  ready: number;
  produced: number;
}

export function ProductionTransfersPage() {
  const [params] = useSearchParams();
  const { lookups, loading: lookupsLoading } = useLookups();
  const { can } = useAuth();
  const [rows, setRows] = useState<TransferRow[]>([]);
  const [ops, setOps] = useState<OpRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ mode: 'OP_TO_OP', fromOperationId: '', toOperationId: '', toWarehouseId: '', fromWarehouseId: '', quantity: '', transferDate: new Date().toISOString().slice(0, 10), notes: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const moId = params.get('moId') ?? '';
      const res = await api<{ transfers: TransferRow[] }>(`/production/transfers${moId ? `?moId=${moId}` : ''}`);
      setRows(res.transfers);

      const mos = await api<{ manufacturingOrders: { id: string; moNumber: string; partId: string; part: { partNumber: string }; status: string; operations: { id: string; sequence: number; operation: { nameFa: string }; producedQuantity: string; transferredOutQuantity: string }[] }[] }>('/production/mos?take=200');
      const opRows: OpRow[] = [];
      for (const mo of mos.manufacturingOrders) {
        if (!['RELEASED', 'IN_PROGRESS'].includes(mo.status)) continue;
        for (const op of mo.operations) {
          opRows.push({
            id: op.id,
            sequence: op.sequence,
            operation: op.operation,
            moNumber: mo.moNumber,
            partNumber: mo.part.partNumber,
            partId: mo.partId,
            produced: Number(op.producedQuantity),
            ready: Number(op.producedQuantity) - Number(op.transferredOutQuantity),
          });
        }
      }
      setOps(opRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در دریافت انتقالات');
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (!form.quantity || Number(form.quantity) <= 0) return setError('مقدار نامعتبر است');
    if (form.mode === 'OP_TO_OP' && (!form.fromOperationId || !form.toOperationId)) return setError('عملیات مبدأ و مقصد الزامی است');
    if (form.mode === 'FEED' && (!form.toOperationId || !form.fromWarehouseId)) return setError('انبار مبدأ و عملیات مقصد الزامی است');
    if (form.mode === 'TO_FG' && (!form.fromOperationId || !form.toWarehouseId)) return setError('عملیات مبدأ و انبار محصول تکمیلی الزامی است');
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ transfer: { transferNumber: string } }>('/production/transfers', {
        method: 'POST',
        body: {
          partId:
            form.mode === 'OP_TO_OP'
              ? ops.find((o) => o.id === form.fromOperationId)?.partId ?? ''
              : form.mode === 'FEED'
                ? ops.find((o) => o.id === form.toOperationId)?.partId ?? ''
                : ops.find((o) => o.id === form.fromOperationId)?.partId ?? '',
          fromOperationId: form.mode === 'FEED' ? null : form.fromOperationId,
          toOperationId: form.mode === 'TO_FG' ? null : form.toOperationId,
          fromWarehouseId: form.mode === 'FEED' ? form.fromWarehouseId : null,
          toWarehouseId: form.mode === 'TO_FG' ? form.toWarehouseId : null,
          quantity: form.quantity,
          transferDate: form.transferDate,
          notes: form.notes || null,
        },
      });
      setModal(false);
      setNotice(`انتقال ${res.transfer.transferNumber} به‌صورت پیش‌نویس ساخته شد — برای اثرگذاری، قطع‌بوش کنید`);
      setForm({ ...form, fromOperationId: '', toOperationId: '', quantity: '', notes: '' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در ایجاد انتقال');
    } finally {
      setBusy(false);
    }
  };

  const act = async (id: string, action: 'post' | 'reverse') => {
    setBusy(true);
    setError(null);
    try {
      if (action === 'post') {
        await api(`/production/transfers/${id}/post`, { method: 'POST' });
        setNotice('انتقال قطع‌بوش شد');
      } else {
        const reason = window.prompt('علت ابطال (الزامی):');
        if (!reason) {
          setBusy(false);
          return;
        }
        await api(`/production/transfers/${id}/reverse`, { method: 'POST', body: { notes: reason } });
        setNotice('انتقال ابطال شد');
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در انجام عملیات');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page
      title="انتقالات بین عملیاتی"
      subtitle="تنها راه جابه‌جایی مقدار بین عملیات یا به انبار محصول — هر انتقال صریح، قابل ردیابی و پشتیبانی از انتقال جزئی"
      actions={
        can('production.manage') && (
          <Button onClick={() => setModal(true)} type="button">
            <Plus size={16} /> انتقال جدید
          </Button>
        )
      }
    >
      <SubNav
        items={[
          { to: '/production', label: 'دستور کارها' },
          { to: '/production/transfers', label: 'انتقالات تولید' },
          { to: '/wip', label: 'داشبورد WIP' },
        ]}
      />
      <SuccessBanner message={notice} />
      <ErrorBanner message={error} />
      {lookupsLoading && <Loading />}
      {loading && <Loading />}

      {!loading && rows.length === 0 && <EmptyState icon={<ArrowLeftRight size={28} />} title="انتقالی ثبت نشده است" />}

      {rows.length > 0 && (
        <Card title={`${rows.length} انتقال`}>
          <Table head={['شماره', 'قطعه', 'از', 'به', 'مقدار', 'وزن (kg)', 'تاریخ', 'قطع‌بوش', '']}>
            {rows.map((t) => (
              <tr key={t.id}>
                <td>{t.transferNumber}</td>
                <td>{t.part.partNumber}</td>
                <td>{t.fromOperation ? `${t.fromOperation.manufacturingOrder.moNumber} / مرحله ${t.fromOperation.sequence} — ${t.fromOperation.operation.nameFa}` : `انبار: ${t.fromWarehouse?.nameFa ?? '—'}`}</td>
                <td>{t.toOperation ? `${t.toOperation.manufacturingOrder.moNumber} / مرحله ${t.toOperation.sequence} — ${t.toOperation.operation.nameFa}` : `انبار: ${t.toWarehouse?.nameFa ?? '—'}`}</td>
                <td><Qty value={t.quantity} /></td>
                <td><Qty value={t.weightKg} unit="kg" /></td>
                <td className="muted">{new Date(t.transferDate).toLocaleDateString('fa-IR')}</td>
                <td><Badge tone={t.postingStatus === 'POSTED' ? 'ok' : t.postingStatus === 'REVERSED' ? 'danger' : 'warn'}>{fa(t.postingStatus)}</Badge></td>
                <td>
                  <div className="row-actions">
                    {t.postingStatus === 'UNPOSTED' && can('production.post') && (
                      <button className="btn btn--sm" onClick={() => void act(t.id, 'post')} disabled={busy}>
                        <Send size={12} /> قطع‌بوش
                      </button>
                    )}
                    {t.postingStatus === 'POSTED' && can('production.post') && (
                      <button className="btn btn--sm btn--warn" onClick={() => void act(t.id, 'reverse')} disabled={busy}>
                        <Undo2 size={12} /> ابطالی
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      {modal && (
        <Modal title="انتقال تولید جدید" onClose={() => setModal(false)}>
          <div className="form-grid">
            <Field label="نوع انتقال" required>
              <Select value={form.mode} onChange={(e) => setForm((f) => ({ ...f, mode: e.target.value }))}>
                <option value="OP_TO_OP">بین دو عملیات</option>
                <option value="FEED">تغذیه از انبار به عملیات اول</option>
                <option value="TO_FG">خروجی به انبار محصول تکمیلی</option>
              </Select>
            </Field>
            {form.mode !== 'FEED' && (
              <Field label="عملیات مبدأ" required hint="فقط مقدارِ «آماده انتقال» قابل انتقال است">
                <Select value={form.fromOperationId} onChange={(e) => setForm((f) => ({ ...f, fromOperationId: e.target.value }))}>
                  <option value="">— انتخاب —</option>
                  {ops.filter((o) => o.ready > 0).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.moNumber} / مرحله {o.sequence} — {o.operation.nameFa} (آماده: {o.ready})
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {form.mode !== 'TO_FG' && (
              <Field label="عملیات مقصد" required={form.mode === 'OP_TO_OP'}>
                <Select value={form.toOperationId} onChange={(e) => setForm((f) => ({ ...f, toOperationId: e.target.value }))}>
                  <option value="">— انتخاب —</option>
                  {ops
                    .filter((o) => (form.mode === 'OP_TO_OP' ? o.id !== form.fromOperationId && o.partId === ops.find((x) => x.id === form.fromOperationId)?.partId : true))
                    .map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.moNumber} / مرحله {o.sequence} — {o.operation.nameFa}
                      </option>
                    ))}
                </Select>
              </Field>
            )}
            {form.mode === 'FEED' && (
              <Field label="انبار مبدأ (مواد اولیه)" required>
                <Select value={form.fromWarehouseId} onChange={(e) => setForm((f) => ({ ...f, fromWarehouseId: e.target.value }))}>
                  <option value="">— انتخاب انبار —</option>
                  {lookups.warehouses.map((w) => (
                    <option key={w.id} value={w.id}>{w.code} — {w.nameFa}</option>
                  ))}
                </Select>
              </Field>
            )}
            {form.mode === 'TO_FG' && (
              <Field label="انبار محصول تکمیلی" required>
                <Select value={form.toWarehouseId} onChange={(e) => setForm((f) => ({ ...f, toWarehouseId: e.target.value }))}>
                  <option value="">— انتخاب انبار —</option>
                  {lookups.warehouses.filter((w) => w.warehouseType === 'FINISHED_GOODS').map((w) => (
                    <option key={w.id} value={w.id}>{w.code} — {w.nameFa}</option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="مقدار" required>
              <TextInput type="number" min="0" step="1" value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} />
            </Field>
            <Field label="تاریخ انتقال" required>
              <TextInput type="date" value={form.transferDate} onChange={(e) => setForm((f) => ({ ...f, transferDate: e.target.value }))} />
            </Field>
            <Field label="یادداشت">
              <TextInput value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </Field>
          </div>
          <div className="form-actions">
            <Button onClick={() => void create()} disabled={busy} type="button">
              <Plus size={15} /> ایجاد پیش‌نویس انتقال
            </Button>
          </div>
        </Modal>
      )}

      <Link to="/wip" className="see-all">مشاهده اثر انتقالات در داشبورد WIP</Link>
    </Page>
  );
}

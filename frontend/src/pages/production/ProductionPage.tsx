import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Factory, Plus, ChevronLeft } from 'lucide-react';
import { api } from '../../lib/api';
import { useLookups } from '../../lib/lookups';
import { Page, Card, Modal, Field, TextInput, Select, Button, Table, EmptyState, Loading, ErrorBanner, Badge, Qty, Progress, fa } from '../../components/ui';
import { SubNav } from '../../components/SubNav';
import { QuickCreateButton } from '../../components/quickcreate/QuickCreate';
import { partQuickCreate } from '../../lib/quickCreateSpecs';

interface MoRow {
  id: string;
  moNumber: string;
  part: { partNumber: string; nameFa: string; baseUnit: { code: string } };
  route: { version: number; status: string; name: string | null } | null;
  quantity: string;
  dueDate: string | null;
  priority: string;
  status: string;
  progressPercent: number;
  producedFinal: string;
  wipTotal: string;
  operations: { id: string; sequence: number; operation: { code: string; nameFa: string }; status: string; plannedQuantity: string; producedQuantity: string }[];
}

export function ProductionPage() {
  const { lookups, loading: lookupsLoading, reload } = useLookups();
  const [rows, setRows] = useState<MoRow[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ partId: '', quantity: '', routeId: '', dueDate: '', priority: 'NORMAL', notes: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      const res = await api<{ manufacturingOrders: MoRow[] }>(`/production/mos?${params.toString()}`);
      setRows(res.manufacturingOrders);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در دریافت دستور کارها');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const createMo = async () => {
    if (!form.partId) return setError('قطعه را انتخاب کنید');
    if (!form.quantity || Number(form.quantity) <= 0) return setError('مقدار نامعتبر است');
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ manufacturingOrder: { moNumber: string } }>('/production/mos', {
        method: 'POST',
        body: {
          partId: form.partId,
          quantity: form.quantity,
          ...(form.routeId ? { routeId: form.routeId } : {}),
          ...(form.dueDate ? { dueDate: form.dueDate } : {}),
          priority: form.priority,
          notes: form.notes || null,
        },
      });
      setModal(false);
      setNotice(`دستور کار ${res.manufacturingOrder.moNumber} با عملیات مسیر تولید ساخته شد`);
      setForm({ partId: '', quantity: '', routeId: '', dueDate: '', priority: 'NORMAL', notes: '' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در ایجاد دستور کار');
    } finally {
      setBusy(false);
    }
  };

  const release = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/production/mos/${id}/release`, { method: 'POST' });
      setNotice('دستور کار آزاد شد — ثبت گزارش تولید امکان‌پذیر است');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در آزادسازی');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page
      title="دستور کارهای ساخت"
      subtitle="عملیات هر دستور کار از مسیر تولید تأییدشده (ACTIVE) قطعه تولید می‌شود"
      actions={
        <Button onClick={() => setModal(true)} type="button">
          <Plus size={16} /> دستور کار جدید
        </Button>
      }
    >
      <SubNav
        items={[
          { to: '/production', label: 'دستور کارها' },
          { to: '/production/transfers', label: 'انتقالات تولید', permission: 'production.view' },
          { to: '/wip', label: 'داشبورد WIP' },
        ]}
      />
      <ErrorBanner message={error} />
      <SuccessBannerLike message={notice} />
      {lookupsLoading && <Loading />}
      {loading && <Loading />}

      {!loading && rows.length === 0 && <EmptyState icon={<Factory size={28} />} title="دستور کاری وجود ندارد" hint="اولین دستور کار را بسازید" />}

      {rows.length > 0 && (
        <>
          <Card title="فیلتر">
            <select className="input input--select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="وضعیت">
              <option value="">همه وضعیت‌ها</option>
              {['PLANNED', 'RELEASED', 'IN_PROGRESS', 'COMPLETED', 'CLOSED', 'CANCELLED'].map((s) => (
                <option key={s} value={s}>{fa(s)}</option>
              ))}
            </select>
          </Card>
          <Card title={`${rows.length} دستور کار`}>
            <Table head={['شماره', 'قطعه', 'مقدار', 'مسیر', 'پیشرفت (عملیات آخر)', 'WIP باقی‌مانده', 'وضعیت', 'تاریخ سررسید', '']}>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td><Link className="link-btn" to={`/production/mos/${m.id}`}>{m.moNumber}</Link></td>
                  <td>
                    <strong>{m.part.partNumber}</strong>
                    <div className="muted">{m.part.nameFa}</div>
                  </td>
                  <td><Qty value={m.quantity} unit={m.part.baseUnit.code} /></td>
                  <td>{m.route ? `نسخه ${m.route.version}` : '—'}</td>
                  <td style={{ minWidth: 130 }}>
                    <Progress percent={m.progressPercent} />
                  </td>
                  <td><Qty value={m.wipTotal} unit={m.part.baseUnit.code} /></td>
                  <td>
                    <Badge tone={m.status === 'COMPLETED' ? 'ok' : m.status === 'IN_PROGRESS' ? 'primary' : m.status === 'CANCELLED' ? 'danger' : 'warn'}>
                      {fa(m.status)}
                    </Badge>
                  </td>
                  <td className="muted">{m.dueDate ? new Date(m.dueDate).toLocaleDateString('fa-IR') : '—'}</td>
                  <td>
                    {m.status === 'PLANNED' && (
                      <button className="btn btn--sm" onClick={() => void release(m.id)} disabled={busy}>آزادسازی</button>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          </Card>
        </>
      )}

      {modal && (
        <Modal title="دستور کار جدید" onClose={() => setModal(false)}>
          <div className="form-grid">
            <Field label="قطعه" required hint="قطعه باید مسیر تولید تأییدشده داشته باشد">
              <div className="inline-controls">
                <Select value={form.partId} onChange={(e) => setForm((f) => ({ ...f, partId: e.target.value, routeId: '' }))}>
                  <option value="">— انتخاب قطعه —</option>
                  {lookups.parts.map((p) => (
                    <option key={p.id} value={p.id}>{p.partNumber} — {p.nameFa}</option>
                  ))}
                </Select>
                <QuickCreateButton
                  spec={partQuickCreate(lookups)}
                  onCreated={async (id) => {
                    await reload();
                    if (id) setForm((f) => ({ ...f, partId: id }));
                  }}
                />
              </div>
            </Field>
            <Field label="مقدار" required>
              <TextInput type="number" min="1" step="1" value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} />
            </Field>
            <Field label="مسیر تولید (اختیاری)" hint="خالی = آخرین نسخه ACTIVE">
              <Select value={form.routeId} onChange={(e) => setForm((f) => ({ ...f, routeId: e.target.value }))}>
                <option value="">— پیش‌فرض (ACTIVE) —</option>
                {lookups.routes.filter((r) => r.partId === form.partId).map((r) => (
                  <option key={r.id} value={r.id}>{r.name ?? `نسخه ${r.version}`}</option>
                ))}
              </Select>
            </Field>
            <Field label="سررسید">
              <TextInput type="date" value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} />
            </Field>
            <Field label="اولویت">
              <Select value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}>
                {['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((p) => (
                  <option key={p} value={p}>{fa(p)}</option>
                ))}
              </Select>
            </Field>
            <Field label="یادداشت">
              <TextInput value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </Field>
          </div>
          <div className="form-actions">
            <Button onClick={() => void createMo()} disabled={busy} type="button">
              <Plus size={15} /> ایجاد دستور کار
            </Button>
          </div>
        </Modal>
      )}

      <Link to="/wip" className="see-all">
        داشبورد قطعات در جریان ساخت <ChevronLeft size={14} />
      </Link>
    </Page>
  );
}

function SuccessBannerLike({ message }: { message: string | null }) {
  if (!message) return null;
  return <div className="alert alert--ok">{message}</div>;
}

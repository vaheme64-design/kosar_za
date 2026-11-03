import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CalendarClock, Play, Plus, ChevronLeft, ClipboardList, Package, Factory, Calculator } from 'lucide-react';
import { api } from '../../lib/api';
import { useLookups } from '../../lib/lookups';
import { Page, Card, Modal, Field, TextInput, Select, Button, Table, EmptyState, Loading, ErrorBanner, Badge, Qty, StatCardLike, fa } from '../../components/ui';
import { formatJalaliDate, faNumber } from '../../lib/jalali';
import { QuickCreateButton } from '../../components/quickcreate/QuickCreate';
import { customerQuickCreate, partQuickCreate } from '../../lib/quickCreateSpecs';

// ---------------------------------------------------------------------------
// types (mirror of the API payloads)
// ---------------------------------------------------------------------------

interface PlanSummary {
  partsPlanned: number;
  feasibleLines: number;
  infeasibleLines: number;
  materialShortageRows: number;
  totalGrossDemand: string;
  totalCoveredByStock: string;
  totalCoveredByReservations: string;
  totalCoveredByWip: string;
  totalCoveredByOpenMos: string;
  totalNetRequirement: string;
  warnings: string[];
  generatedAt: string;
}

interface PlanRow {
  id: string;
  planNumber: string;
  title: string;
  version: number;
  status: string;
  periodStart: string;
  periodEnd: string;
  planningRunAt: string | null;
  summary: PlanSummary | null;
  revisionOf: { planNumber: string; version: number } | null;
  createdBy: { username: string; fullName: string };
  lineCount: number;
  createdAt: string;
}

interface DashboardData {
  openOrders: number;
  openLines: number;
  demandParts: number;
  totalRemainingDemand: string;
  latestPlan: { id: string; planNumber: string; version: number; status: string; planningRunAt: string | null; summary: PlanSummary | null; lineCount: number } | null;
  openMos: number;
  machines: { active: number; total: number };
  generatedAt: string;
}

interface OrderRow {
  id: string;
  orderNumber: string;
  customer: { code: string; nameFa: string };
  orderDate: string;
  dueDate: string | null;
  status: string;
  lines: { id: string; lineNo: number; part: { partNumber: string; nameFa: string }; quantity: string; deliveredQuantity: string; remaining: string; dueDate: string | null; status: string; unit: string }[];
}

export function PlanningDashboardPage() {
  const navigate = useNavigate();
  const { lookups, reload } = useLookups();
  const [dash, setDash] = useState<DashboardData | null>(null);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // run-planning form
  const [runForm, setRunForm] = useState({ horizonDays: '30', dueFrom: '', dueTo: '', notes: '' });
  // new-order modal
  const [orderModal, setOrderModal] = useState(false);
  const [orderForm, setOrderForm] = useState({ customerId: '', orderDate: '', dueDate: '', description: '' });
  const [orderLines, setOrderLines] = useState<{ partId: string; quantity: string; dueDate: string }[]>([{ partId: '', quantity: '', dueDate: '' }]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [d, p, o] = await Promise.all([
        api<DashboardData>('/planning/dashboard'),
        api<{ plans: PlanRow[] }>('/planning/plans'),
        api<{ customerOrders: OrderRow[] }>('/planning/customer-orders?openOnly=true'),
      ]);
      setDash(d);
      setPlans(p.plans);
      setOrders(o.customerOrders);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در دریافت اطلاعات برنامه‌ریزی');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runPlanning = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const body: Record<string, unknown> = { horizonDays: Number(runForm.horizonDays) || 30 };
      if (runForm.dueFrom) body.dueFrom = runForm.dueFrom;
      if (runForm.dueTo) body.dueTo = runForm.dueTo;
      if (runForm.notes) body.notes = runForm.notes;
      const res = await api<{ plan: { id: string; planNumber: string; version: number } }>('/planning/run', { method: 'POST', body });
      setNotice(`برنامه ${res.plan.planNumber} (نسخه ${faNumber(res.plan.version)}) ساخته شد`);
      navigate(`/production-planning/plans/${res.plan.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در اجرای موتور برنامه‌ریزی');
    } finally {
      setBusy(false);
    }
  };

  const createOrder = async () => {
    if (!orderForm.customerId) return setError('مشتری را انتخاب کنید');
    if (!orderForm.orderDate) return setError('تاریخ سفارش را وارد کنید');
    const lines = orderLines.filter((l) => l.partId && Number(l.quantity) > 0);
    if (lines.length === 0) return setError('حداقل یک ردیف سفارش با مقدار مثبت لازم است');
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ customerOrder: { orderNumber: string } }>('/planning/customer-orders', {
        method: 'POST',
        body: {
          customerId: orderForm.customerId,
          orderDate: orderForm.orderDate,
          ...(orderForm.dueDate ? { dueDate: orderForm.dueDate } : {}),
          ...(orderForm.description ? { description: orderForm.description } : {}),
          lines: lines.map((l) => ({
            partId: l.partId,
            quantity: Number(l.quantity),
            ...(l.dueDate ? { dueDate: l.dueDate } : {}),
          })),
        },
      });
      setOrderModal(false);
      setOrderForm({ customerId: '', orderDate: '', dueDate: '', description: '' });
      setOrderLines([{ partId: '', quantity: '', dueDate: '' }]);
      setNotice(`سفارش ${res.customerOrder.orderNumber} ثبت شد (تأییدشده — ورودی برنامه‌ریزی)`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در ثبت سفارش');
    } finally {
      setBusy(false);
    }
  };

  const statusTone = useMemo(
    () => (s: string): 'ok' | 'warn' | 'danger' | 'info' | 'muted' | 'primary' =>
      s === 'CONFIRMED' ? 'ok' : s === 'DRAFT' ? 'warn' : s === 'CANCELLED' ? 'danger' : 'muted',
    [],
  );

  return (
    <Page
      title="برنامه‌ریزی تولید"
      subtitle="محاسبه نیاز خالص تولید از سفارش‌ها، موجودی محصول، رزروها و WIP — به‌همراه پیشنهاد ماشین هر عملیات با ذکر دلیل"
      actions={
        <Button onClick={() => setOrderModal(true)} type="button" variant="ghost">
          <Plus size={16} /> سفارش مشتری جدید
        </Button>
      }
    >
      <ErrorBanner message={error} />
      {notice && <div className="alert alert--ok">{notice}</div>}
      {loading && <Loading />}

      {!loading && dash && (
        <>
          <div className="stat-grid">
            <StatCardLike icon={<ClipboardList size={20} />} value={faNumber(dash.openOrders)} label="سفارش باز مشتری" tone="primary" />
            <StatCardLike icon={<Package size={20} />} value={faNumber(dash.demandParts)} label="قطعه دارای تقاضای باز" tone="info" />
            <StatCardLike icon={<CalendarClock size={20} />} value={<Qty value={dash.totalRemainingDemand} />} label="تقاضای باقی‌مانده (کل)" tone="warn" />
            <StatCardLike icon={<Factory size={20} />} value={`${faNumber(dash.machines.active)} / ${faNumber(dash.machines.total)}`} label="ماشین فعال" tone="ok" />
          </div>

          <Card title="اجرای موتور برنامه‌ریزی" note="خروجی فقط «پیشنهاد» است؛ تا تأیید شما هیچ سند تولیدی ساخته نمی‌شود">
            <div className="form-grid">
              <Field label="افق برنامه (روز)" hint="پایان دوره برنامه">
                <TextInput type="number" min="1" max="365" value={runForm.horizonDays} onChange={(e) => setRunForm((f) => ({ ...f, horizonDays: e.target.value }))} />
              </Field>
              <Field label="سررسید از (اختیاری)">
                <TextInput type="date" value={runForm.dueFrom} onChange={(e) => setRunForm((f) => ({ ...f, dueFrom: e.target.value }))} />
              </Field>
              <Field label="سررسید تا (اختیاری)">
                <TextInput type="date" value={runForm.dueTo} onChange={(e) => setRunForm((f) => ({ ...f, dueTo: e.target.value }))} />
              </Field>
              <Field label="یادداشت (اختیاری)">
                <TextInput value={runForm.notes} onChange={(e) => setRunForm((f) => ({ ...f, notes: e.target.value }))} />
              </Field>
            </div>
            <div className="form-actions">
              <Button onClick={() => void runPlanning()} disabled={busy} type="button">
                <Play size={15} /> اجرای برنامه‌ریزی
              </Button>
              <Link to="/production-planning/mrp" className="btn btn--ghost" style={{ textDecoration: 'none' }}>
                <Calculator size={15} /> محاسبه نیاز مواد (MRP) — بدون ثبت برنامه
              </Link>
            </div>
          </Card>

          {dash.latestPlan && (
            <Card title="آخرین برنامه">
              <div className="muted" style={{ marginBottom: 8 }}>
                {dash.latestPlan.planNumber} — نسخه {faNumber(dash.latestPlan.version)} — <Badge tone={statusTone(dash.latestPlan.status)}>{fa(dash.latestPlan.status)}</Badge>
                {dash.latestPlan.planningRunAt && <> — اجرا: {formatJalaliDate(dash.latestPlan.planningRunAt)}</>}
              </div>
              {dash.latestPlan.summary && (
                <div className="chip-row">
                  <span className="chip">ردیف: {faNumber(dash.latestPlan.summary.partsPlanned)}</span>
                  <span className="chip chip--ok">قابل اجرا: {faNumber(dash.latestPlan.summary.feasibleLines)}</span>
                  <span className="chip chip--danger">ناکارآمد: {faNumber(dash.latestPlan.summary.infeasibleLines)}</span>
                  <span className="chip chip--warn">کسری ماده: {faNumber(dash.latestPlan.summary.materialShortageRows)}</span>
                  <span className="chip">نیاز خالص: {faNumber(Number(dash.latestPlan.summary.totalNetRequirement))}</span>
                </div>
              )}
              <Link className="see-all" to={`/production-planning/plans/${dash.latestPlan.id}`}>
                مشاهده جزئیات برنامه <ChevronLeft size={14} />
              </Link>
            </Card>
          )}

          <Card title="برنامه‌های تولید (نسخه‌ها)">
            {plans.length === 0 ? (
              <EmptyState icon={<CalendarClock size={28} />} title="هنوز برنامه‌ای اجرا نشده است" hint="پس از ثبت سفارش، موتور برنامه‌ریزی را اجرا کنید" />
            ) : (
              <Table head={['شماره برنامه', 'نسخه', 'وضعیت', 'ردیف‌ها', 'قابل اجرا', 'ناکارآمد', 'نیاز خالص', 'زمان اجرا', '']}>
                {plans.map((p) => (
                  <tr key={p.id}>
                    <td><Link className="link-btn" to={`/production-planning/plans/${p.id}`}>{p.planNumber}</Link></td>
                    <td>{p.revisionOf ? `↺ ${faNumber(p.version)}` : faNumber(p.version)}</td>
                    <td><Badge tone={statusTone(p.status)}>{fa(p.status)}</Badge></td>
                    <td>{faNumber(p.lineCount)}</td>
                    <td>{p.summary ? faNumber(p.summary.feasibleLines) : '—'}</td>
                    <td>{p.summary && p.summary.infeasibleLines > 0 ? <span className="text-danger">{faNumber(p.summary.infeasibleLines)}</span> : '۰'}</td>
                    <td>{p.summary ? <Qty value={p.summary.totalNetRequirement} /> : '—'}</td>
                    <td className="muted">{p.planningRunAt ? formatJalaliDate(p.planningRunAt) : '—'}</td>
                    <td>
                      {p.status === 'DRAFT' && (
                        <Link className="btn btn--sm" to={`/production-planning/plans/${p.id}`}>بررسی و تأیید</Link>
                      )}
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>

          <Card title="سفارش‌های باز مشتری (ورودی برنامه‌ریزی)">
            {orders.length === 0 ? (
              <EmptyState icon={<ClipboardList size={28} />} title="سفارش بازی وجود ندارد" hint="سفارش مشتری را ثبت کنید؛ سفارش‌های تأییدشده در محاسبه تقاضا لحاظ می‌شوند" />
            ) : (
              <Table head={['شماره سفارش', 'مشتری', 'وضعیت', 'ردیف‌ها', 'تعداد ردیف', 'سررسید', 'تاریخ سفارش']}>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td><strong>{o.orderNumber}</strong></td>
                    <td>{o.customer.nameFa}</td>
                    <td><Badge tone="info">{fa(o.status)}</Badge></td>
                    <td>
                      {o.lines.map((l) => (
                        <div key={l.id} className="muted" style={{ fontSize: 12 }}>
                          {l.part.partNumber} — <Qty value={l.remaining} unit={l.unit} /> {l.dueDate ? `(سررسید ${formatJalaliDate(l.dueDate)})` : ''}
                        </div>
                      ))}
                    </td>
                    <td>{faNumber(o.lines.length)}</td>
                    <td className="muted">{o.dueDate ? formatJalaliDate(o.dueDate) : '—'}</td>
                    <td className="muted">{formatJalaliDate(o.orderDate)}</td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </>
      )}

      {orderModal && (
        <Modal title="سفارش مشتری جدید" onClose={() => setOrderModal(false)} wide>
          <div className="form-grid">
            <Field label="مشتری" required>
              <div className="inline-controls">
                <Select value={orderForm.customerId} onChange={(e) => setOrderForm((f) => ({ ...f, customerId: e.target.value }))}>
                  <option value="">— انتخاب مشتری —</option>
                  {lookups.customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.nameFa} ({c.code})</option>
                  ))}
                </Select>
                <QuickCreateButton
                  spec={customerQuickCreate()}
                  onCreated={async (id) => {
                    await reload();
                    if (id) setOrderForm((f) => ({ ...f, customerId: id }));
                  }}
                />
              </div>
            </Field>
            <Field label="تاریخ سفارش" required>
              <TextInput type="date" value={orderForm.orderDate} onChange={(e) => setOrderForm((f) => ({ ...f, orderDate: e.target.value }))} />
            </Field>
            <Field label="سررسید کل (اختیاری)" hint="سررسید هر ردیف می‌تواند جداگانه باشد">
              <TextInput type="date" value={orderForm.dueDate} onChange={(e) => setOrderForm((f) => ({ ...f, dueDate: e.target.value }))} />
            </Field>
            <Field label="توضیح">
              <TextInput value={orderForm.description} onChange={(e) => setOrderForm((f) => ({ ...f, description: e.target.value }))} />
            </Field>
          </div>

          <h4 style={{ margin: '12px 0 8px' }}>ردیف‌های سفارش</h4>
          {orderLines.map((l, i) => (
            <div key={i} className="form-grid" style={{ gridTemplateColumns: '2fr 1fr 1fr auto', alignItems: 'end' }}>
              <Field label="قطعه" required={i === 0}>
                <div className="inline-controls">
                  <Select value={l.partId} onChange={(e) => setOrderLines((arr) => arr.map((x, j) => (j === i ? { ...x, partId: e.target.value } : x)))}>
                    <option value="">— انتخاب قطعه —</option>
                    {lookups.parts.map((p) => (
                      <option key={p.id} value={p.id}>{p.partNumber} — {p.nameFa}</option>
                    ))}
                  </Select>
                  <QuickCreateButton
                    spec={partQuickCreate(lookups)}
                    onCreated={async (id) => {
                      await reload();
                      if (id) setOrderLines((arr) => arr.map((x, j) => (j === i ? { ...x, partId: id ?? x.partId } : x)));
                    }}
                  />
                </div>
              </Field>
              <Field label="مقدار" required={i === 0}>
                <TextInput type="number" min="1" step="1" value={l.quantity} onChange={(e) => setOrderLines((arr) => arr.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
              </Field>
              <Field label="سررسید">
                <TextInput type="date" value={l.dueDate} onChange={(e) => setOrderLines((arr) => arr.map((x, j) => (j === i ? { ...x, dueDate: e.target.value } : x)))} />
              </Field>
              <div style={{ paddingBottom: 6 }}>
                <Button variant="danger" type="button" onClick={() => setOrderLines((arr) => arr.filter((_, j) => j !== i))} disabled={orderLines.length === 1}>حذف</Button>
              </div>
            </div>
          ))}
          <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
            <Button variant="ghost" type="button" onClick={() => setOrderLines((arr) => [...arr, { partId: '', quantity: '', dueDate: '' }])}>
              <Plus size={14} /> افزودن ردیف
            </Button>
          </div>
          <div className="form-actions">
            <Button onClick={() => void createOrder()} disabled={busy} type="button">ثبت سفارش</Button>
          </div>
        </Modal>
      )}
    </Page>
  );
}

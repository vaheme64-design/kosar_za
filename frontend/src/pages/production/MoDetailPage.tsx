import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowRight, ClipboardEdit, CheckCircle2, Send, Undo2, PackageCheck, Loader2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { Page, Card, Table, EmptyState, Loading, ErrorBanner, SuccessBanner, Badge, Qty, Progress, fa } from '../../components/ui';

interface MoDetail {
  manufacturingOrder: {
    id: string;
    moNumber: string;
    quantity: string;
    status: string;
    priority: string;
    dueDate: string | null;
    notes: string | null;
    part: { partNumber: string; nameFa: string; baseUnit: { code: string } };
    route: { version: number; status: string; name: string | null } | null;
    operations: {
      id: string;
      sequence: number;
      status: string;
      plannedQuantity: string;
      receivedQuantity: string;
      inputQuantity: string;
      producedQuantity: string;
      scrappedQuantity: string;
      rejectedQuantity: string;
      reworkQuantity: string;
      transferredOutQuantity: string;
      wipSinceAt: string | null;
      operation: { code: string; nameFa: string };
      machine?: { code: string; nameFa: string } | null;
      reports: { id: string; reportNumber: string; inputQuantity: string; producedQuantity: string; rejectedQuantity: string; reworkQuantity: string; status: string; postingStatus: string; reportDate: string; scraps: { reason: string; quantity: string }[] }[];
    }[];
  };
}

interface TransferRow {
  id: string;
  transferNumber: string;
  quantity: string;
  postingStatus: string;
  transferDate: string;
  fromOperation?: { sequence: number; operation: { nameFa: string } } | null;
  toOperation?: { sequence: number; operation: { nameFa: string } } | null;
  toWarehouse?: { nameFa: string } | null;
  fromWarehouse?: { nameFa: string } | null;
}

/** Phase 8 — pre-issue material check (MRP module). */
interface MoCheckLine {
  materialId: string;
  materialCode: string;
  materialNameFa: string;
  unitCode: string;
  requiredQuantity: string;
  alreadyIssuedQuantity: string;
  remainingRequired: string;
  availableForThisMo: string;
  shortageQuantity: string;
  status: 'NOT_REQUIRED' | 'READY' | 'SHORTAGE';
}

interface MoCheckResult {
  moNumber: string;
  readyToIssue: boolean;
  lines: MoCheckLine[];
  notes: string[];
}

export function MoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const [data, setData] = useState<MoDetail | null>(null);
  const [transfers, setTransfers] = useState<TransferRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [moCheck, setMoCheck] = useState<MoCheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [reserving, setReserving] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [mo, trf] = await Promise.all([
        api<MoDetail>(`/production/mos/${id}`),
        api<{ transfers: TransferRow[] }>(`/production/transfers?moId=${id}`),
      ]);
      setData(mo);
      setTransfers(trf.transfers);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در دریافت دستور کار');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // phase 8: pre-issue material check — loaded alongside the order
  const runCheck = useCallback(async () => {
    if (!id) return;
    setChecking(true);
    try {
      setMoCheck(await api<MoCheckResult>(`/mrp/mos/${id}/check`));
    } catch {
      setMoCheck(null); // the card hides itself when the check is unavailable
    } finally {
      setChecking(false);
    }
  }, [id]);

  useEffect(() => {
    void runCheck();
  }, [runCheck]);

  const autoReserve = async () => {
    if (!id) return;
    setReserving(true);
    setError(null);
    try {
      const res = await api<{ reserved: { created: boolean }[]; shortages: unknown[]; moNumber: string }>(
        `/mrp/mos/${id}/reserve`,
        { method: 'POST' },
      );
      const created = res.reserved.filter((r) => r.created).length;
      setNotice(res.shortages.length > 0 ? `رزرو انجام شد ولی کسری پوشش‌نیافته وجود دارد (${res.shortages.length} ماده)` : `رزرو خودکار مواد ${res.moNumber} انجام شد (${created} رزرو جدید)`);
      await runCheck();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در رزرو خودکار مواد');
    } finally {
      setReserving(false);
    }
  };

  const act = async (path: string, message: string, body?: unknown) => {
    setBusy(true);
    setError(null);
    try {
      await api(path, { method: 'POST', body });
      setNotice(message);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در انجام عملیات');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading />;
  if (!data) return <ErrorBanner message={error} />;

  const mo = data.manufacturingOrder;
  const ops = mo.operations;
  const finalOp = ops[ops.length - 1];
  const progress = finalOp ? (Number(finalOp.producedQuantity) / Number(mo.quantity)) * 100 : 0;

  return (
    <Page
      title={`دستور کار ${mo.moNumber}`}
      subtitle={`${mo.part.partNumber} — ${mo.part.nameFa} • مقدار: ${mo.quantity} ${mo.part.baseUnit.code}`}
      actions={
        <div className="row-actions">
          {mo.status === 'PLANNED' && can('production.post') && (
            <Buttonish label="آزادسازی دستور کار" icon={<Send size={14} />} onClick={() => act(`/production/mos/${mo.id}/release`, 'دستور کار آزاد شد')} disabled={busy} />
          )}
          {(mo.status === 'RELEASED' || mo.status === 'IN_PROGRESS') && can('production.post') && (
            <Buttonish label="تکمیل دستور کار" icon={<CheckCircle2 size={14} />} onClick={() => act(`/production/mos/${mo.id}/complete`, 'دستور کار تکمیل شد')} disabled={busy} />
          )}
        </div>
      }
    >
      <SuccessBanner message={notice} />
      <ErrorBanner message={error} />

      {moCheck && moCheck.lines.length > 0 && (
        <Card
          title="مواد لازم (بررسی پیش از حواله)"
          note="نیاز باقی‌مانده = سرانه BOM × مقدار دستور کار − مصرف ثبت‌شده همین دستور کار؛ موجودی آزاد، رزروهای سایر دستور کارها را کنار می‌گذارد"
          actions={
            <>
              {checking && <Loader2 size={15} className="spin" />}
              {can('inventory.manage') && mo.status !== 'COMPLETED' && mo.status !== 'CANCELLED' && (
                <button className="btn btn--sm" onClick={() => void autoReserve()} disabled={reserving} type="button">
                  {reserving ? <Loader2 size={13} className="spin" /> : <PackageCheck size={13} />} رزرو خودکار مواد
                </button>
              )}
            </>
          }
        >
          <p style={{ marginTop: 0 }}>
            <Badge tone={moCheck.readyToIssue ? 'ok' : 'danger'}>{moCheck.readyToIssue ? 'مواد کافی — قابل حواله' : 'کسری مواد'}</Badge>
          </p>
          <Table head={['ماده', 'نیاز کل', 'مصرف‌شده', 'نیاز باقی‌مانده', 'آزاد برای این دستور', 'کسری', 'وضعیت']} dense>
            {moCheck.lines.map((l) => (
              <tr key={l.materialId}>
                <td>{l.materialCode} — {l.materialNameFa}</td>
                <td><Qty value={l.requiredQuantity} unit={l.unitCode} /></td>
                <td><Qty value={l.alreadyIssuedQuantity} /></td>
                <td><Qty value={l.remainingRequired} /></td>
                <td><Qty value={l.availableForThisMo} /></td>
                <td>{l.shortageQuantity !== '0.0000' ? <strong><Qty value={l.shortageQuantity} unit={l.unitCode} /></strong> : '—'}</td>
                <td>
                  <Badge tone={l.status === 'SHORTAGE' ? 'danger' : l.status === 'READY' ? 'ok' : 'muted'}>
                    {l.status === 'SHORTAGE' ? 'کسری' : l.status === 'READY' ? 'آماده حواله' : 'نیازی ندارد'}
                  </Badge>
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      <Card title="پیشرفت کلی">
        <Progress percent={progress} />
        <div className="detail-grid">
          <div><span className="muted">وضعیت:</span> <Badge tone={mo.status === 'COMPLETED' ? 'ok' : mo.status === 'IN_PROGRESS' ? 'primary' : 'warn'}>{fa(mo.status)}</Badge></div>
          <div><span className="muted">اولویت:</span> {fa(mo.priority)}</div>
          <div><span className="muted">مسیر:</span> {mo.route ? `${mo.route.name ?? ''} (نسخه ${mo.route.version})` : '—'}</div>
          <div><span className="muted">سررسید:</span> {mo.dueDate ? new Date(mo.dueDate).toLocaleDateString('fa-IR') : '—'}</div>
        </div>
      </Card>

      <Card title="عملیات تولید (به ترتیب مسیر)" note="خروجی تولید به‌صورت خودکار منتقل نمی‌شود؛ انتقال فقط با سند انتقال">
        {ops.length === 0 ? (
          <EmptyState title="عملیاتی تعریف نشده است" />
        ) : (
          <div className="ops-flow">
            {ops.map((op) => {
              const ready = Number(op.producedQuantity) - Number(op.transferredOutQuantity);
              const wip = Number(op.receivedQuantity) - Number(op.transferredOutQuantity) - Number(op.scrappedQuantity) - Number(op.rejectedQuantity);
              const agingH = op.wipSinceAt ? Math.round((Date.now() - new Date(op.wipSinceAt).getTime()) / 3_600_000) : 0;
              return (
                <div className="op-card" key={op.id}>
                  <div className="op-card__head">
                    <span className="op-card__seq">{op.sequence}</span>
                    <div>
                      <strong>{op.operation.nameFa}</strong>
                      <div className="muted">
                        {op.machine?.nameFa ?? 'بدون ماشین'} • {fa(op.status)}
                      </div>
                    </div>
                    <div className="op-card__actions">
                      {can('production.manage') && ['PLANNED', 'RELEASED', 'IN_PROGRESS'].includes(mo.status) && (
                        <Link className="btn btn--sm" to={`/production/reports/new?operationId=${op.id}`}>
                          <ClipboardEdit size={13} /> گزارش تولید
                        </Link>
                      )}
                    </div>
                  </div>
                  <div className="op-quantities">
                    <span title="دریافتی از عملیات قبل">دریافتی: <b><Qty value={op.receivedQuantity} /></b></span>
                    <span title="ورودی ماشین">ورودی: <b><Qty value={op.inputQuantity} /></b></span>
                    <span title="تولید سالم">تولید: <b className="text-ok"><Qty value={op.producedQuantity} /></b></span>
                    <span title="ضایعات">ضایعات: <b className="text-danger"><Qty value={op.scrappedQuantity} /></b></span>
                    <span title="مردود">مردود: <b className="text-danger"><Qty value={op.rejectedQuantity} /></b></span>
                    <span title="بازکار">بازکار: <b className="text-warn"><Qty value={op.reworkQuantity} /></b></span>
                    <span title="منتقل‌شده">منتقل‌شده: <b><Qty value={op.transferredOutQuantity} /></b></span>
                    <span title="آماده انتقال (تولید − منتقل‌شده)">آماده انتقال: <b className="text-info"><Qty value={ready} /></b></span>
                    <span title="WIP این عملیات">WIP: <b><Qty value={wip} /></b></span>
                    {wip > 0 && <span className="muted">قداره: {agingH} ساعت</span>}
                  </div>
                  {op.reports.length > 0 && (
                    <details className="op-reports">
                      <summary>گزارش‌ها ({op.reports.length})</summary>
                      <Table head={['شماره', 'تاریخ', 'ورودی', 'تولید', 'مردود', 'بازکار', 'ضایعات', 'وضعیت']} dense>
                        {op.reports.map((r) => (
                          <tr key={r.id}>
                            <td>{r.reportNumber}</td>
                            <td className="muted">{new Date(r.reportDate).toLocaleDateString('fa-IR')}</td>
                            <td><Qty value={r.inputQuantity} /></td>
                            <td><Qty value={r.producedQuantity} /></td>
                            <td><Qty value={r.rejectedQuantity} /></td>
                            <td><Qty value={r.reworkQuantity} /></td>
                            <td className="muted">{r.scraps.map((s) => `${fa(s.reason)}: ${s.quantity}`).join('، ') || '—'}</td>
                            <td><Badge tone={r.postingStatus === 'POSTED' ? 'ok' : r.postingStatus === 'REVERSED' ? 'danger' : 'warn'}>{fa(r.postingStatus)}</Badge></td>
                          </tr>
                        ))}
                      </Table>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card
        title="انتقالات این دستور کار"
        note="انتقال باید صریحاً قطع‌بوش شود"
        actions={
          can('production.manage') && <Link className="btn btn--sm" to={`/production/transfers?moId=${mo.id}`}>انتقال جدید</Link>
        }
      >
        {transfers.length === 0 ? (
          <EmptyState title="انتقالی ثبت نشده است" />
        ) : (
          <Table head={['شماره', 'از', 'به', 'مقدار', 'تاریخ', 'قطع‌بوش', '']} dense>
            {transfers.map((t) => (
              <tr key={t.id}>
                <td>{t.transferNumber}</td>
                <td>
                  {t.fromOperation ? `عملیات ${t.fromOperation.sequence} — ${t.fromOperation.operation.nameFa}` : `انبار ${t.fromWarehouse?.nameFa ?? ''}`}
                </td>
                <td>
                  {t.toOperation ? `عملیات ${t.toOperation.sequence} — ${t.toOperation.operation.nameFa}` : `انبار ${t.toWarehouse?.nameFa ?? ''}`}
                </td>
                <td><Qty value={t.quantity} unit={mo.part.baseUnit.code} /></td>
                <td className="muted">{new Date(t.transferDate).toLocaleDateString('fa-IR')}</td>
                <td><Badge tone={t.postingStatus === 'POSTED' ? 'ok' : t.postingStatus === 'REVERSED' ? 'danger' : 'warn'}>{fa(t.postingStatus)}</Badge></td>
                <td>
                  <div className="row-actions">
                    {t.postingStatus === 'UNPOSTED' && can('production.post') && (
                      <button className="btn btn--sm" onClick={() => act(`/production/transfers/${t.id}/post`, `انتقال ${t.transferNumber} قطع‌بوش شد`)} disabled={busy}>
                        <Send size={12} /> قطع‌بوش
                      </button>
                    )}
                    {t.postingStatus === 'POSTED' && can('production.post') && (
                      <button
                        className="btn btn--sm btn--warn"
                        onClick={() => {
                          const reason = window.prompt('علت ابطال انتقال (الزامی):');
                          if (reason) void act(`/production/transfers/${t.id}/reverse`, 'انتقال ابطال شد', { notes: reason });
                        }}
                        disabled={busy}
                      >
                        <Undo2 size={12} /> ابطالی
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Link to="/production" className="see-all">
        <ArrowRight size={14} /> بازگشت به فهرست دستور کارها
      </Link>
    </Page>
  );
}

function Buttonish({ label, icon, onClick, disabled }: { label: string; icon: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button className="btn" onClick={onClick} disabled={disabled}>
      {icon} {label}
    </button>
  );
}

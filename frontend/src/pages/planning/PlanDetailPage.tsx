import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowRight, CheckCircle2, XCircle, TriangleAlert, Gauge, ChevronDown, ChevronUp, ListChecks } from 'lucide-react';
import { api } from '../../lib/api';
import { Page, Card, Button, Table, Loading, ErrorBanner, Badge, Qty, fa } from '../../components/ui';
import { formatJalaliDate, faNumber } from '../../lib/jalali';

// ---------------------------------------------------------------------------
// types
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

interface CandidateCheck {
  code: string;
  labelFa: string;
  pass: boolean;
  hard: boolean;
  noteFa?: string;
}

interface Candidate {
  machineId: string;
  machineCode: string;
  machineNameFa: string;
  machineStatus: string;
  eligible: boolean;
  rank: number | null;
  timeSource: string;
  setupSource: string;
  requiredHours: string | null;
  requiredMinutes: number | null;
  setupMinutes: number;
  workloadMinutes: number;
  minutesPerDay: number;
  busyDays: number | null;
  estimatedStart: string | null;
  estimatedEnd: string | null;
  checks: CandidateCheck[];
  reasonsFa: string[];
  warningsFa: string[];
}

interface PlanOperation {
  id: string;
  sequence: number;
  operation: { code: string; nameFa: string };
  requiredOutput: string;
  wipQuantity: string;
  wipUsed: string;
  mustProduce: string;
  requiredInput: string;
  arrivingQuantity: string;
  timeSource: string | null;
  setupSource: string | null;
  estimatedHours: string | null;
  setupMinutes: number | null;
  feasible: boolean;
  infeasibleReasons: string[] | null;
  missingInfo: string[] | null;
  recommendedMachineCode: string | null;
  recommendedDieCode: string | null;
  recommendedRank: number | null;
  candidates: Candidate[] | null;
}

interface Shortage {
  id: string;
  material: { materialCode: string; nameFa: string; baseUnit: { code: string } };
  severity: string;
  requiredQuantity: string;
  availableQuantity: string;
  consignmentQuantity: string;
  shortageQuantity: string;
  coveredByOpenContracts: string;
  contractInfo: { contractNumber: string; remaining: string; expectedDeliveryDate: string | null }[] | null;
  notes: string | null;
}

interface PlanLine {
  id: string;
  part: { partNumber: string; nameFa: string; baseUnit: { code: string } };
  plannedQuantity: string;
  routeVersion: number | null;
  dueDate: string | null;
  grossQuantity: string | null;
  coveredByStock: string | null;
  coveredByReservations: string | null;
  coveredByWip: string | null;
  coveredByPlannedMos: string | null;
  feasible: boolean;
  detail: {
    demandLines: { orderNumber: string; customerNameFa: string; lineNo: number; remaining: string; coveredByReservations: string; coveredByStock: string; netRequirement: string; dueDate: string | null }[];
    finishedGoods: { usable: string; quarantined: string; consignment: string; breakdown: string[] };
    committedOpenMos: { moNumber: string; remainingFinalOutput: string }[];
    wipChain: { sequence: number; operationCode: string; operationNameFa: string; requiredOutput: string; wipQuantity: string; wipUsed: string; committedQuantity: string; committedUsed: string; arrivingQuantity: string; arrivingUsed: string; mustProduce: string; requiredInput: string; scrapFactorPct: string }[];
    wipWithoutRouteStep: { readyForTransfer: string; note: string }[];
    missingInfo: string[];
  } | null;
  planOperations: PlanOperation[];
  materialShortages: Shortage[];
}

interface PlanDetail {
  id: string;
  planNumber: string;
  title: string;
  version: number;
  status: string;
  periodStart: string;
  periodEnd: string;
  planningRunAt: string | null;
  planningParams: { horizonDays?: number; dueFrom?: string | null; dueTo?: string | null; shiftMinutesPerDay?: number; shiftsUsed?: string[] } | null;
  summary: PlanSummary | null;
  revisionOf: { id: string; planNumber: string; version: number } | null;
  revisions: { id: string; planNumber: string; version: number; status: string }[];
  createdBy: { username: string; fullName: string };
  lines: PlanLine[];
}

const SEVERITY_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'muted'> = {
  OK: 'ok',
  SHORTAGE_COVERED_BY_CONTRACT: 'warn',
  SHORTAGE: 'danger',
  MISSING_BOM: 'muted',
};

const TIME_SOURCE_TONE: Record<string, 'ok' | 'warn' | 'muted'> = {
  ROUTE_STEP: 'ok',
  CAPABILITY: 'ok',
  OPERATION_DEFAULT: 'warn',
  MISSING: 'muted',
};

export function PlanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [plan, setPlan] = useState<PlanDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ plan: PlanDetail }>(`/planning/plans/${id}`);
      setPlan(res.plan);
      setExpanded(Object.fromEntries(res.plan.lines.map((l) => [l.id, false])));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در دریافت برنامه');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (action: 'confirm' | 'cancel') => {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/planning/plans/${id}/${action}`, { method: 'POST' });
      setNotice(action === 'confirm' ? 'برنامه تأیید شد — اکنون می‌توانید از ماژول تولید، دستور کار با ارجاع به ردیف برنامه بسازید' : 'برنامه ابطال شد');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در تغییر وضعیت برنامه');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Page title="برنامه تولید"><Loading /></Page>;
  if (!plan) return <Page title="برنامه تولید"><ErrorBanner message={error ?? 'برنامه یافت نشد'} /></Page>;

  const s = plan.summary;

  return (
    <Page
      title={`برنامه ${plan.planNumber}`}
      subtitle={`${plan.title} — نسخه ${faNumber(plan.version)}${plan.revisionOf ? ` (بازنگری ${plan.revisionOf.planNumber} نسخه ${faNumber(plan.revisionOf.version)})` : ''}`}
      actions={
        <>
          {plan.status === 'DRAFT' && (
            <>
              <Button onClick={() => void act('confirm')} disabled={busy} type="button">
                <CheckCircle2 size={15} /> تأیید برنامه
              </Button>
              <Button variant="danger" onClick={() => void act('cancel')} disabled={busy} type="button">ابطال</Button>
            </>
          )}
          <Link className="btn btn--ghost" to="/production-planning"><ArrowRight size={15} /> بازگشت</Link>
        </>
      }
    >
      <ErrorBanner message={error} />
      {notice && <div className="alert alert--ok">{notice}</div>}

      <Card title="وضعیت برنامه">
        <div className="chip-row" style={{ marginBottom: 10 }}>
          <Badge tone={plan.status === 'CONFIRMED' ? 'ok' : plan.status === 'DRAFT' ? 'warn' : 'muted'}>{fa(plan.status)}</Badge>
          {plan.planningRunAt && <span className="chip">زمان اجرا: {formatJalaliDate(plan.planningRunAt)}</span>}
          {plan.planningParams?.shiftMinutesPerDay != null && (
            <span className="chip"><Gauge size={11} /> ظرفیت روزانه شیفت‌ها: {faNumber(plan.planningParams.shiftMinutesPerDay)} دقیقه {(plan.planningParams.shiftsUsed ?? []).length > 0 && `(${plan.planningParams.shiftsUsed!.join('، ')})`}</span>
          )}
          {plan.planningParams?.dueFrom && <span className="chip">سررسید از {formatJalaliDate(plan.planningParams.dueFrom)}</span>}
          {plan.planningParams?.dueTo && <span className="chip">سررسید تا {formatJalaliDate(plan.planningParams.dueTo)}</span>}
        </div>
        {s && (
          <div className="chip-row">
            <span className="chip">ردیف‌ها: {faNumber(s.partsPlanned)}</span>
            <span className="chip chip--ok">قابل اجرا: {faNumber(s.feasibleLines)}</span>
            <span className="chip chip--danger">ناکارآمد: {faNumber(s.infeasibleLines)}</span>
            <span className="chip chip--warn">کسری ماده: {faNumber(s.materialShortageRows)}</span>
            <span className="chip">تقاضای ناخالص: {faNumber(Number(s.totalGrossDemand))}</span>
            <span className="chip">پوشش موجودی: {faNumber(Number(s.totalCoveredByStock))}</span>
            <span className="chip">پوشش رزرو: {faNumber(Number(s.totalCoveredByReservations))}</span>
            <span className="chip">پوشش WIP: {faNumber(Number(s.totalCoveredByWip))}</span>
            <span className="chip">پوشش دستور کارهای باز: {faNumber(Number(s.totalCoveredByOpenMos))}</span>
            <span className="chip chip--primary">نیاز خالص (پیشنهاد MO): {faNumber(Number(s.totalNetRequirement))}</span>
          </div>
        )}
        {plan.revisions.length > 0 && (
          <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
            نسخه‌های بعدی این برنامه: {plan.revisions.map((r) => `${r.planNumber} (v${faNumber(r.version)})`).join('، ')}
          </div>
        )}
        {s?.warnings && s.warnings.length > 0 && (
          <div style={{ marginTop: 8 }}>
            {s.warnings.map((w, i) => (
              <div key={i} className="alert alert--warn"><TriangleAlert size={14} /> {w}</div>
            ))}
          </div>
        )}
        {plan.status === 'DRAFT' && (
          <div className="alert alert--info" style={{ marginTop: 8 }}>
            این برنامه «پیشنهاد» است. پس از تأیید، ساخت دستور کار همچنان اقدامی جداگانه در ماژول تولید است (ارجاع به ردیف برنامه).
          </div>
        )}
      </Card>

      {plan.lines.length === 0 && (
        <Card>
          <div className="empty">
            <div className="empty__title">این برنامه ردیفی ندارد</div>
            <div className="empty__hint">سفارش باز تأییدشده‌ای برای برنامه‌ریزی وجود نداشت</div>
          </div>
        </Card>
      )}

      {plan.lines.map((line) => {
        const open = expanded[line.id];
        const unit = line.part.baseUnit.code;
        return (
          <Card
            key={line.id}
            title={`${line.part.partNumber} — ${line.part.nameFa}`}
            note={line.routeVersion ? `مسیر نسخه ${faNumber(line.routeVersion)}` : 'بدون مسیر ACTIVE'}
            actions={
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {line.feasible ? <Badge tone="ok">قابل اجرا</Badge> : <Badge tone="danger">ناکارآمد</Badge>}
                <button className="btn btn--sm" onClick={() => setExpanded((e) => ({ ...e, [line.id]: !open }))} type="button">
                  {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />} جزئیات
                </button>
              </div>
            }
          >
            {/* netting strip */}
            <div className="chip-row" style={{ marginBottom: 10 }}>
              <span className="chip">پیشنهاد MO: <strong>{faNumber(Number(line.plannedQuantity))}</strong> {unit}</span>
              <span className="chip">تقاضای ناخالص: {faNumber(Number(line.grossQuantity ?? 0))}</span>
              <span className="chip chip--ok">موجودی آزاد: {faNumber(Number(line.coveredByStock ?? 0))}</span>
              <span className="chip chip--ok">رزرو همین ردیف: {faNumber(Number(line.coveredByReservations ?? 0))}</span>
              <span className="chip chip--info">WIP: {faNumber(Number(line.coveredByWip ?? 0))}</span>
              <span className="chip chip--info">دستور کار باز: {faNumber(Number(line.coveredByPlannedMos ?? 0))}</span>
              {line.dueDate && <span className="chip">سررسید: {formatJalaliDate(line.dueDate)}</span>}
            </div>

            {/* machine recommendations preview (always visible — the assignment screen) */}
            <h4 style={{ margin: '8px 0 6px', display: 'flex', gap: 6, alignItems: 'center' }}>
              <ListChecks size={15} /> پیشنهاد تخصیص ماشین به عملیات‌ها
            </h4>
            {line.planOperations.length === 0 && <div className="muted">بدون عملیات (مسیر تولید تعریف نشده)</div>}
            <div className="grid-2">
              {line.planOperations.map((op) => {
                const candidates = (op.candidates ?? []) as Candidate[];
                const eligible = candidates.filter((c) => c.eligible);
                const best = candidates.find((c) => c.rank === 1) ?? null;
                const must = Number(op.mustProduce);
                return (
                  <div key={op.id} className="op-card">
                    <div className="op-card__head">
                      <strong>{faNumber(op.sequence)}. {op.operation.nameFa} <span className="muted">({op.operation.code})</span></strong>
                      {must > 0 ? (
                        <span>تولید جدید: <strong>{faNumber(must)}</strong></span>
                      ) : (
                        <Badge tone="info">با WIP/دستور کار باز پوشش داده شد</Badge>
                      )}
                    </div>

                    {op.infeasibleReasons && op.infeasibleReasons.length > 0 && (
                      <div className="alert alert--error">{op.infeasibleReasons.map((r, i) => <div key={i}>{r}</div>)}</div>
                    )}

                    {must > 0 && (
                      <>
                        {best ? (
                          <div className="op-card__best">
                            <Badge tone="primary">پیشنهاد رتبه {faNumber(best.rank ?? 0)}</Badge>
                            <strong> {best.machineCode}</strong> <span className="muted">{best.machineNameFa}</span>
                            {op.recommendedDieCode && <span className="muted"> — قالب: {op.recommendedDieCode}</span>}
                            <div className="muted" style={{ fontSize: 12 }}>
                              زمان لازم: {op.estimatedHours ? `${faNumber(Number(op.estimatedHours))} ساعت` : '—'}
                              {' · '}
                              <Badge tone={TIME_SOURCE_TONE[op.timeSource ?? 'MISSING'] ?? 'muted'}>{fa(op.timeSource)}</Badge>
                              {op.setupMinutes != null && <> · راه‌اندازی: {faNumber(op.setupMinutes)} دقیقه <Badge tone={op.setupSource === 'NOT_DEFINED' ? 'warn' : 'ok'}>{fa(op.setupSource)}</Badge></>}
                              {best.busyDays != null && <> · تکمیل تخمینی: {best.estimatedEnd ? formatJalaliDate(best.estimatedEnd) : '—'} (تخمینی)</>}
                            </div>
                            <div className="muted" style={{ fontSize: 12 }}>دلایل: {best.reasonsFa.join(' · ')}</div>
                          </div>
                        ) : (
                          <div className="alert alert--error">هیچ ماشین واجد شرایطی برای این عملیات یافت نشد</div>
                        )}
                        {(op.missingInfo ?? []).length > 0 && (
                          <div className="alert alert--warn">
                            <TriangleAlert size={13} /> {(op.missingInfo ?? []).map((m, i) => <div key={i}>{m}</div>)}
                          </div>
                        )}
                        <details className="op-card__details">
                          <summary>همه ماشین‌های نامزد ({faNumber(candidates.length)} ماشین، {faNumber(eligible.length)} واجد شرایط)</summary>
                          <Table dense head={['رتبه', 'ماشین', 'وضعیت', 'زمان لازم', 'راه‌اندازی', 'بار جاری', 'تکمیل تخمینی', 'دلایل / موانع']}>
                            {candidates.map((c) => (
                              <tr key={c.machineId} className={c.eligible ? '' : 'row-muted'}>
                                <td>{c.rank ? faNumber(c.rank) : '—'}</td>
                                <td><strong>{c.machineCode}</strong><div className="muted" style={{ fontSize: 11 }}>{c.machineNameFa}</div></td>
                                <td>{c.eligible ? <CheckCircle2 size={14} color="var(--ok)" /> : <XCircle size={14} color="var(--danger)" />}</td>
                                <td>{c.requiredMinutes != null ? `${faNumber(c.requiredMinutes)} دقیقه` : '—'}</td>
                                <td>{faNumber(c.setupMinutes)}</td>
                                <td>{faNumber(Math.round(c.workloadMinutes))} دقیقه</td>
                                <td>{c.estimatedEnd ? formatJalaliDate(c.estimatedEnd) : '—'}</td>
                                <td style={{ fontSize: 11.5 }}>
                                  {(c.eligible ? c.reasonsFa : c.checks.filter((ch) => ch.hard && !ch.pass).map((ch) => ch.noteFa ?? ch.labelFa)).map((r, i) => <div key={i}>• {r}</div>)}
                                  {c.warningsFa.map((w, i) => <div key={`w${i}`} className="text-warn">△ {w}</div>)}
                                </td>
                              </tr>
                            ))}
                          </Table>
                        </details>
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            {open && (
              <>
                {/* demand lines */}
                <h4 style={{ margin: '14px 0 6px' }}>ردیف‌های تقاضا</h4>
                <Table dense head={['سفارش', 'مشتری', 'ردیف', 'باقی‌مانده', 'پوشش رزرو', 'پوشش موجودی', 'نیاز خالص', 'سررسید']}>
                  {(line.detail?.demandLines ?? []).map((d, i) => (
                    <tr key={i}>
                      <td>{d.orderNumber}</td>
                      <td>{d.customerNameFa}</td>
                      <td>{faNumber(d.lineNo)}</td>
                      <td><Qty value={d.remaining} unit={unit} /></td>
                      <td><Qty value={d.coveredByReservations} unit={unit} /></td>
                      <td><Qty value={d.coveredByStock} unit={unit} /></td>
                      <td><strong><Qty value={d.netRequirement} unit={unit} /></strong></td>
                      <td className="muted">{d.dueDate ? formatJalaliDate(d.dueDate) : '—'}</td>
                    </tr>
                  ))}
                </Table>

                {/* WIP chain */}
                <h4 style={{ margin: '14px 0 6px' }}>زنجیره قطع‌بوش WIP عملیات‌به‌عملیات</h4>
                <Table dense head={['مرحله', 'عملیات', 'خروجی موردنیاز', 'WIP آماده', 'استفاده از WIP', 'تعهد دستور کار باز', 'در راه (رسیده)', 'تولید جدید', 'ورودی لازم', 'ضریب ضایعات']}>
                  {(line.detail?.wipChain ?? []).map((w) => (
                    <tr key={w.sequence}>
                      <td>{faNumber(w.sequence)}</td>
                      <td>{w.operationNameFa} <span className="muted">({w.operationCode})</span></td>
                      <td><Qty value={w.requiredOutput} unit={unit} /></td>
                      <td><Qty value={w.wipQuantity} unit={unit} /></td>
                      <td><Qty value={w.wipUsed} unit={unit} /></td>
                      <td><Qty value={w.committedUsed} unit={unit} /> <span className="muted">از {faNumber(Number(w.committedQuantity))}</span></td>
                      <td><Qty value={w.arrivingUsed} unit={unit} /> <span className="muted">از {faNumber(Number(w.arrivingQuantity))}</span></td>
                      <td><strong><Qty value={w.mustProduce} unit={unit} /></strong></td>
                      <td><Qty value={w.requiredInput} unit={unit} /></td>
                      <td>{faNumber(Number(w.scrapFactorPct))}٪</td>
                    </tr>
                  ))}
                </Table>
                {(line.detail?.wipWithoutRouteStep ?? []).length > 0 && (
                  <div className="alert alert--warn" style={{ marginTop: 6 }}>
                    {(line.detail?.wipWithoutRouteStep ?? []).map((w, i) => <div key={i}><TriangleAlert size={13} /> {w.note} ({w.readyForTransfer})</div>)}
                  </div>
                )}

                {/* material shortages */}
                {line.materialShortages.length > 0 && (
                  <>
                    <h4 style={{ margin: '14px 0 6px' }}>مواد اولیه</h4>
                    <Table dense head={['ماده', 'شدت', 'موردنیاز', 'موجود (تأییدشده)', 'امانی تأمین‌کننده', 'کسری', 'پوشش قرارداد باز', 'قراردادها']}>
                      {line.materialShortages.map((m) => (
                        <tr key={m.id}>
                          <td><strong>{m.material.materialCode}</strong><div className="muted" style={{ fontSize: 11 }}>{m.material.nameFa}</div></td>
                          <td><Badge tone={SEVERITY_TONE[m.severity] ?? 'muted'}>{fa(m.severity)}</Badge></td>
                          <td><Qty value={m.requiredQuantity} unit={m.material.baseUnit.code} /></td>
                          <td><Qty value={m.availableQuantity} unit={m.material.baseUnit.code} /></td>
                          <td><Qty value={m.consignmentQuantity} unit={m.material.baseUnit.code} /></td>
                          <td className={Number(m.shortageQuantity) > 0 ? 'text-danger' : ''}><Qty value={m.shortageQuantity} unit={m.material.baseUnit.code} /></td>
                          <td><Qty value={m.coveredByOpenContracts} unit={m.material.baseUnit.code} /></td>
                          <td style={{ fontSize: 11.5 }}>
                            {(m.contractInfo ?? []).map((c) => (
                              <div key={c.contractNumber}>{c.contractNumber} — باقی‌مانده {faNumber(Number(c.remaining))}{c.expectedDeliveryDate ? ` — تحویل ${formatJalaliDate(c.expectedDeliveryDate)}` : ''}</div>
                            ))}
                            {m.notes && <div className="muted">{m.notes}</div>}
                          </td>
                        </tr>
                      ))}
                    </Table>
                  </>
                )}

                {/* supply breakdown + missing info */}
                <h4 style={{ margin: '14px 0 6px' }}>توضیح موجودی و اطلاعات ناقص</h4>
                {(line.detail?.finishedGoods.breakdown ?? []).map((b, i) => (
                  <div key={i} className="alert alert--warn" style={{ marginBottom: 4 }}><TriangleAlert size={13} /> {b}</div>
                ))}
                {(line.detail?.committedOpenMos ?? []).length > 0 && (
                  <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                    دستور کارهای باز لحاظ‌شده: {(line.detail?.committedOpenMos ?? []).map((m) => `${m.moNumber} (${faNumber(Number(m.remainingFinalOutput))})`).join('، ')}
                  </div>
                )}
                {(line.detail?.missingInfo ?? []).length > 0 ? (
                  (line.detail?.missingInfo ?? []).map((m, i) => (
                    <div key={i} className="alert alert--warn"><TriangleAlert size={13} /> {m}</div>
                  ))
                ) : (
                  <div className="alert alert--ok">اطلاعات ناقصی برای این ردیف یافت نشد</div>
                )}
              </>
            )}
          </Card>
        );
      })}
    </Page>
  );
}

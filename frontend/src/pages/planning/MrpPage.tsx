/**
 * KPIMS — Phase 8: MRP page.
 *
 * دو ابزار مستقل روی یک صفحه:
 *  1) اجرای MRP: تقاضای باز ← قطع‌بوش موجودی/WIP/رزرو ← انفجار BOM ← کسری مواد
 *     (فقط‌خواندنی — هیچ سندی ساخته نمی‌شود)
 *  2) بررسی پیش از حواله: مواد یک دستور کار مشخص همین حالا قابل حواله است؟
 *     + رزرو خودکار مواد همان دستور کار با رعایت موجودی آزاد (ATP)
 */
import { useCallback, useEffect, useState } from 'react';
import { Calculator, ClipboardCheck, Download, Loader2, PackageCheck, ShieldAlert } from 'lucide-react';
import { api } from '../../lib/api';
import { Page, Card, Button, Table, EmptyState, Loading, ErrorBanner, SuccessBanner, Badge, Qty, StatCardLike, fa } from '../../components/ui';
import { faNumber } from '../../lib/jalali';
import { buildCsv, downloadTextFile } from '../../lib/exportImport';
import { SubNav } from '../../components/SubNav';

// ---------------------------------------------------------------------------
// API payload mirrors
// ---------------------------------------------------------------------------

interface MrpMaterialRow {
  materialId: string;
  materialCode: string;
  materialNameFa: string;
  grade: string | null;
  thicknessMm: string | null;
  unitCode: string;
  requiredQuantity: string;
  requiredWeightKg: string | null;
  onHandOwned: string;
  onHandConsignment: string;
  onHandQuarantined: string;
  reservedActive: string;
  netAvailable: string;
  openContractQuantity: string;
  shortageQuantity: string;
  coveredByContract: string;
  severity: 'OK' | 'SHORTAGE_COVERED_BY_CONTRACT' | 'SHORTAGE';
  demandedByParts: { partId: string; partNumber: string; requiredQuantity: string }[];
  contractInfo: { contractNumber: string; remaining: string; expectedDeliveryDate: string | null }[];
}

interface MrpPartRow {
  partId: string;
  partNumber: string;
  nameFa: string;
  unitCode: string;
  grossDemand: string;
  coveredByStock: string;
  coveredByReservations: string;
  coveredByWip: string;
  coveredByCommittedMos: string;
  netRequirement: string;
  hasRoute: boolean;
  missingInfo: string[];
}

interface MrpResult {
  ranAt: string;
  ranAtFa: string;
  scope: { orderLines: number; parts: number; withNetRequirement: number };
  parts: MrpPartRow[];
  materials: MrpMaterialRow[];
  summary: { materialsConsidered: number; ok: number; contractCovered: number; hardShortages: number };
  notes: string[];
}

interface MoCheckLine {
  materialId: string;
  materialCode: string;
  materialNameFa: string;
  unitCode: string;
  requiredQuantity: string;
  alreadyIssuedQuantity: string;
  remainingRequired: string;
  onHandApproved: string;
  reservedForThisMo: string;
  reservedForOthers: string;
  availableForThisMo: string;
  shortageQuantity: string;
  status: 'NOT_REQUIRED' | 'READY' | 'SHORTAGE';
  notes: string[];
}

interface MoCheckResult {
  moId: string;
  moNumber: string;
  moStatus: string;
  partNumber: string;
  partNameFa: string;
  moQuantity: string;
  lines: MoCheckLine[];
  readyToIssue: boolean;
  notes: string[];
}

interface MoOption {
  id: string;
  moNumber: string;
  status: string;
  part?: { partNumber: string; nameFa: string };
}

const SEVERITY_FA: Record<MrpMaterialRow['severity'], string> = {
  OK: 'پوشش کامل',
  SHORTAGE_COVERED_BY_CONTRACT: 'کسری — با قرارداد باز پوشش می‌شود',
  SHORTAGE: 'کسری واقعی',
};

const SEVERITY_TONE: Record<MrpMaterialRow['severity'], 'ok' | 'warn' | 'danger'> = {
  OK: 'ok',
  SHORTAGE_COVERED_BY_CONTRACT: 'warn',
  SHORTAGE: 'danger',
};

const LINE_STATUS_FA: Record<MoCheckLine['status'], string> = {
  NOT_REQUIRED: 'نیاز باقی‌مانده ندارد',
  READY: 'آماده حواله',
  SHORTAGE: 'کسری',
};

const LINE_TONE: Record<MoCheckLine['status'], 'muted' | 'ok' | 'danger'> = {
  NOT_REQUIRED: 'muted',
  READY: 'ok',
  SHORTAGE: 'danger',
};

// ---------------------------------------------------------------------------

export function MrpPage() {
  const [mrp, setMrp] = useState<MrpResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [mos, setMos] = useState<MoOption[]>([]);
  const [moId, setMoId] = useState('');
  const [check, setCheck] = useState<MoCheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [reserving, setReserving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const loadMos = useCallback(async () => {
    try {
      const res = await api<{ manufacturingOrders: MoOption[] }>('/production/mos?take=200');
      setMos(res.manufacturingOrders);
    } catch {
      /* the dropdown just stays empty; the error shows on run */
    }
  }, []);

  useEffect(() => {
    void loadMos();
  }, [loadMos]);

  const run = async () => {
    setRunning(true);
    setError(null);
    setNotice(null);
    try {
      setMrp(await api<MrpResult>('/mrp/run'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در اجرای MRP');
    } finally {
      setRunning(false);
    }
  };

  const runCheck = async () => {
    if (!moId) return setError('دستور کار را انتخاب کنید');
    setChecking(true);
    setError(null);
    setNotice(null);
    setCheck(null);
    try {
      setCheck(await api<MoCheckResult>(`/mrp/mos/${moId}/check`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در بررسی مواد دستور کار');
    } finally {
      setChecking(false);
    }
  };

  const autoReserve = async () => {
    if (!moId) return;
    setReserving(true);
    setError(null);
    try {
      const res = await api<{ reserved: { created: boolean; materialCode: string; quantity: string; unitCode: string }[]; shortages: { materialCode: string; shortage: string; unitCode: string }[]; moNumber: string }>(
        `/mrp/mos/${moId}/reserve`,
        { method: 'POST' },
      );
      const createdCount = res.reserved.filter((r) => r.created).length;
      const shortageText = res.shortages.length
        ? `؛ کسری پوشش‌نیافته: ${res.shortages.map((s) => `${s.materialCode} (${s.shortage} ${s.unitCode})`).join('، ')}`
        : '';
      setNotice(`رزرو خودکار برای ${res.moNumber} انجام شد — ${createdCount} رزرو جدید${shortageText}`);
      await runCheck();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در رزرو خودکار');
    } finally {
      setReserving(false);
    }
  };

  const exportCsv = () => {
    if (!mrp) return;
    const csv = buildCsv(
      ['کالا', 'نام', 'گرید', 'ضخامت', 'واحد', 'نیاز', 'نیاز (kg)', 'موجودی مالی', 'موجودی امانی', 'قرنطینه', 'رزرو فعال', 'موجودی آزاد', 'قرارداد باز', 'کسری', 'پوشش با قرارداد', 'وضعیت'],
      mrp.materials.map((r) => [
        r.materialCode,
        r.materialNameFa,
        r.grade ?? '',
        r.thicknessMm ?? '',
        r.unitCode,
        r.requiredQuantity,
        r.requiredWeightKg ?? '',
        r.onHandOwned,
        r.onHandConsignment,
        r.onHandQuarantined,
        r.reservedActive,
        r.netAvailable,
        r.openContractQuantity,
        r.shortageQuantity,
        r.coveredByContract,
        SEVERITY_FA[r.severity],
      ]),
    );
    downloadTextFile(csv, `mrp-${new Date().toISOString().slice(0, 10)}.csv`);
  };

  return (
    <Page
      title="محاسبه نیاز مواد (MRP)"
      subtitle="تقاضای باز، موجودی، WIP و رزروها قطع‌بوش می‌شود و کسری مواد پیش از حواله به سالن تولید آشکار می‌گردد — این صفحه فقط محاسبه می‌کند و هیچ سندی نمی‌سازد"
    >
      <SubNav
        items={[
          { to: '/production-planning', label: 'داشبورد برنامه‌ریزی' },
          { to: '/production-planning/mrp', label: 'محاسبه نیاز مواد (MRP)' },
        ]}
      />
      <SuccessBanner message={notice} />
      <ErrorBanner message={error} />

      {/* ------------------------------------------------ MRP run */}
      <Card
        title="اجرای محاسبه MRP"
        note="مبنای محاسبه: سفارش‌های باز مشتری − موجودی قطعی − رزروها − WIP − دستور کارهای باز؛ سپس انفجار BOM"
        actions={
          <Button onClick={() => void run()} disabled={running} type="button">
            {running ? <Loader2 size={16} className="spin" /> : <Calculator size={16} />} اجرای محاسبه
          </Button>
        }
      >
        {!mrp && !running && <EmptyState icon={<Calculator size={28} />} title="هنوز اجرا نشده" hint="با دکمه «اجرای محاسبه» آخرین وضعیت نیاز مواد از داده‌های واقعی محاسبه می‌شود" />}
        {running && <Loading label="در حال قطع‌بوش تقاضا و مواد…" />}
      </Card>

      {mrp && (
        <>
          <div className="stat-grid">
            <StatCardLike icon={<PackageCheck size={20} />} value={faNumber(mrp.summary.ok)} label="ماده با پوشش کامل" tone="ok" />
            <StatCardLike icon={<ShieldAlert size={20} />} value={faNumber(mrp.summary.contractCovered)} label="کسری با پوشش قرارداد" tone="warn" />
            <StatCardLike icon={<ShieldAlert size={20} />} value={faNumber(mrp.summary.hardShortages)} label="کسری واقعی" tone={mrp.summary.hardShortages > 0 ? 'danger' : 'ok'} />
            <StatCardLike icon={<Calculator size={20} />} value={`${faNumber(mrp.scope.parts)} / ${faNumber(mrp.scope.withNetRequirement)}`} label="قطعه دارای تقاضا / نیاز خالص" tone="primary" />
          </div>

          {mrp.notes.length > 0 && (
            <Card title="نکات محاسبه">
              <ul className="muted">
                {mrp.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </Card>
          )}

          <Card
            title={`نیاز مواد (${mrp.materials.length} ماده)`}
            note="نیازها در سطح «ورودی عملیات اول» محاسبه و برای هر ماده جمع شده است؛ ردیف‌ها با اولویت کسری مرتب شده‌اند"
            actions={
              <Button variant="ghost" onClick={exportCsv} type="button">
                <Download size={15} /> خروجی CSV
              </Button>
            }
          >
            {mrp.materials.length === 0 ? (
              <EmptyState title="ماده‌ای برای محاسبه یافت نشد" hint="یا تقاضای باز وجود ندارد یا BOM قطعات ثبت نشده است" />
            ) : (
              <Table head={['کالا', 'گرید × ضخامت', 'نیاز', 'موجودی آزاد', 'مالی / امانی', 'رزرو فعال', 'قرارداد باز', 'کسری', 'پوشش با قرارداد', 'وضعیت', 'قطعات متقاضی']}>
                {mrp.materials.map((r) => (
                  <tr key={r.materialId}>
                    <td>{r.materialCode} — {r.materialNameFa}</td>
                    <td className="muted">{r.grade ?? '—'} × {r.thicknessMm ?? '—'}</td>
                    <td><Qty value={r.requiredQuantity} unit={r.unitCode} />{r.requiredWeightKg && <> <span className="muted">({r.requiredWeightKg} kg)</span></>}</td>
                    <td><Qty value={r.netAvailable} unit={r.unitCode} /></td>
                    <td className="muted"><Qty value={r.onHandOwned} /> / <Qty value={r.onHandConsignment} /></td>
                    <td><Qty value={r.reservedActive} unit={r.unitCode} /></td>
                    <td className="muted">{r.contractInfo.length > 0 ? r.contractInfo.map((c) => `${c.contractNumber} (${c.remaining})`).join('، ') : '—'}</td>
                    <td><strong>{r.shortageQuantity !== '0.0000' ? <Qty value={r.shortageQuantity} unit={r.unitCode} /> : '—'}</strong></td>
                    <td>{r.coveredByContract !== '0.0000' ? <Qty value={r.coveredByContract} unit={r.unitCode} /> : '—'}</td>
                    <td><Badge tone={SEVERITY_TONE[r.severity]}>{SEVERITY_FA[r.severity]}</Badge></td>
                    <td className="muted">{r.demandedByParts.map((p) => `${p.partNumber} (${p.requiredQuantity})`).join('، ') || '—'}</td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>

          <Card title="قطع‌بوش تقاضای قطعات" note="تقاضای ناخالص ← پوشش با موجودی محصول، رزرو سفارش، WIP و دستور کارهای باز ← نیاز خالص تولید">
            <Table head={['قطعه', 'تقاضای ناخالص', 'پوشش با موجودی', 'پوشش با رزرو', 'پوشش با WIP', 'پوشش با دستور کار باز', 'نیاز خالص', 'نکات']}>
              {mrp.parts.map((p) => (
                <tr key={p.partId}>
                  <td>{p.partNumber} — {p.nameFa}</td>
                  <td><Qty value={p.grossDemand} unit={p.unitCode} /></td>
                  <td><Qty value={p.coveredByStock} /></td>
                  <td><Qty value={p.coveredByReservations} /></td>
                  <td><Qty value={p.coveredByWip} /></td>
                  <td><Qty value={p.coveredByCommittedMos} /></td>
                  <td><strong><Qty value={p.netRequirement} unit={p.unitCode} /></strong></td>
                  <td className="muted">{p.missingInfo.length > 0 ? p.missingInfo.join('؛ ') : '—'}</td>
                </tr>
              ))}
            </Table>
          </Card>
        </>
      )}

      {/* ------------------------------------------------ MO pre-issue check */}
      <Card
        title="بررسی مواد دستور کار (پیش از حواله)"
        note="برای هر ماده: نیاز باقی‌مانده = BOM × مقدار دستور کار − مصرف ثبت‌شده همین دستور کار؛ موجودی آزاد = موجودی قطعی − رزرو دیگران (رزرو خودِ دستور کار جزو آزاد آن است)"
      >
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label style={{ minWidth: 280, flex: 1 }}>
            <span className="muted">دستور کار</span>
            <select className="input" value={moId} onChange={(e) => setMoId(e.target.value)}>
              <option value="">— انتخاب دستور کار —</option>
              {mos.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.moNumber} — {m.part?.partNumber ?? ''} {m.part?.nameFa ?? ''} ({fa(m.status)})
                </option>
              ))}
            </select>
          </label>
          <Button variant="ghost" onClick={() => void runCheck()} disabled={checking || !moId} type="button">
            {checking ? <Loader2 size={15} className="spin" /> : <ClipboardCheck size={15} />} بررسی مواد
          </Button>
          {check && (
            <Button onClick={() => void autoReserve()} disabled={reserving} type="button">
              {reserving ? <Loader2 size={15} className="spin" /> : <PackageCheck size={15} />} رزرو خودکار مواد
            </Button>
          )}
        </div>

        {check && (
          <>
            <p style={{ marginTop: '0.75rem' }}>
              <Badge tone={check.readyToIssue ? 'ok' : 'danger'}>{check.readyToIssue ? 'مواد کافی — قابل حواله' : 'کسری مواد — قبل از حواله برطرف شود'}</Badge>{' '}
              <span className="muted">
                {check.moNumber} — {check.partNumber} ({check.partNameFa}) — مقدار: <Qty value={check.moQuantity} />
              </span>
            </p>
            {check.notes.length > 0 && (
              <ul className="muted">
                {check.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
            {check.lines.length === 0 ? (
              <EmptyState title="BOM برای قطعه این دستور کار ثبت نشده است" />
            ) : (
              <Table head={['ماده', 'نیاز کل', 'مصرف‌شده', 'نیاز باقی‌مانده', 'موجودی قطعی', 'رزرو این دستور', 'رزرو دیگران', 'آزاد برای این دستور', 'کسری', 'وضعیت']}>
                {check.lines.map((l) => (
                  <tr key={l.materialId}>
                    <td>{l.materialCode} — {l.materialNameFa}</td>
                    <td><Qty value={l.requiredQuantity} unit={l.unitCode} /></td>
                    <td><Qty value={l.alreadyIssuedQuantity} /></td>
                    <td><Qty value={l.remainingRequired} /></td>
                    <td><Qty value={l.onHandApproved} /></td>
                    <td>{l.reservedForThisMo !== '0.0000' ? <Qty value={l.reservedForThisMo} /> : '—'}</td>
                    <td><Qty value={l.reservedForOthers} /></td>
                    <td><Qty value={l.availableForThisMo} /></td>
                    <td><strong>{l.shortageQuantity !== '0.0000' ? <Qty value={l.shortageQuantity} unit={l.unitCode} /> : '—'}</strong></td>
                    <td>
                      <Badge tone={LINE_TONE[l.status]}>{LINE_STATUS_FA[l.status]}</Badge>
                      {l.notes.length > 0 && <div className="muted">{l.notes.join('؛ ')}</div>}
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </>
        )}
      </Card>
    </Page>
  );
}

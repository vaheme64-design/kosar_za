import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Badge, Card, ErrorBanner, Loading, Page, Table, fa } from '../../components/ui';
import { faEx } from '../../lib/labels';

/* eslint-disable @typescript-eslint/no-explicit-any */

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'muted'> = {
  ACTIVE: 'ok',
  MAINTENANCE: 'warn',
  BREAKDOWN: 'danger',
  RETIRED: 'muted',
};

function utilTone(pct: number): string {
  if (pct >= 100) return 'util-bar__fill--hot';
  if (pct >= 75) return 'util-bar__fill--warn';
  return 'util-bar__fill';
}

/**
 * Capacity view per machine — honest reporting:
 * - capacity hours/day = active shift calendar (computed);
 * - workload = sum of remaining open-assignment quantities ÷ standard rate
 *   (estimate) — machines with missing standard rates are flagged
 *   «نرخ نامعلوم» and utilization stays null (no silent assumption).
 */
export function CapacityPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api<any>('/machines/capacity')
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'خطا در محاسبه ظرفیت');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Page
      title="نمای ظرفیت ماشین‌آلات"
      subtitle="ظرفیت روزانه از تقویم شیفت‌های فعال، بار جاری از دستور کارهای باز — تخمین‌ها با برچسب «تخمینی» جدا از واقعیت نمایش داده می‌شوند"
    >
      {error && <ErrorBanner message={error} />}
      {loading && <Loading />}

      {data && (
        <>
          <Card title="تقویم شیفت فعال" note={data.capacityBasis}>
            <div className="chip-row">
              {data.shifts.map((s: any) => (
                <span key={s.id} className="chip chip--info">
                  {s.nameFa}: {s.hours} ساعت
                </span>
              ))}
              <span className="chip chip--primary">
                ظرفیت اسمی روزانه: {data.capacityHoursPerDay} ساعت
              </span>
            </div>
          </Card>

          <Card title="بار جاری ماشین‌ها">
            <Table head={['کد', 'ماشین', 'نوع', 'وضعیت', 'دستور کار باز', 'بار تخمینی (ساعت)', 'نرخ نامعلوم', 'استفاده از ظرفیت']} dense>
              {data.machines.map((m: any) => (
                <tr key={m.id} className={m.status === 'RETIRED' ? 'row-muted' : undefined}>
                  <td dir="ltr">
                    <b>{m.code}</b>
                  </td>
                  <td>{m.nameFa}</td>
                  <td>{faEx(m.machineType)}</td>
                  <td>
                    <Badge tone={STATUS_TONE[m.status] ?? 'muted'}>{faEx(m.status)}</Badge>
                  </td>
                  <td>{m.openAssignmentCount}</td>
                  <td>
                    {m.openAssignmentCount === 0 ? (
                      <span className="cell-empty">بدون بار</span>
                    ) : (
                      <span dir="ltr">
                        {m.estimatedWorkloadHours.toLocaleString('fa-IR', { maximumFractionDigits: 1 })} (تخمینی)
                      </span>
                    )}
                  </td>
                  <td>
                    {m.unknownRateCount > 0 ? (
                      <Badge tone="warn">{m.unknownRateCount} عملیات بدون نرخ</Badge>
                    ) : (
                      <span className="cell-empty">—</span>
                    )}
                  </td>
                  <td>
                    {m.utilizationPct === null ? (
                      <span className="cell-empty">قابل محاسبه نیست</span>
                    ) : (
                      <div className="util-bar" title={`${Math.round(m.utilizationPct)}٪`}>
                        <div className={utilTone(m.utilizationPct)} style={{ width: `${Math.min(100, m.utilizationPct)}%` }} />
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
            <p className="kpi-note">
              درصد استفاده فقط زمانی نمایش داده می‌شود که همه دستور کارهای بازِ ماشین نرخ استاندارد معتبر داشته باشند؛
              در غیر این صورت «قابل محاسبه نیست» گزارش می‌شود — برخلاف فرض ضمنی نرخ.
            </p>
          </Card>

          {data.machines.some((m: any) => m.assignments.length > 0) && (
            <Card title="جزئیات دستور کارهای تخصیص‌یافته">
              {data.machines
                .filter((m: any) => m.assignments.length > 0)
                .map((m: any) => (
                  <div key={m.id} className="op-card">
                    <h4>
                      {m.code} — {m.nameFa}
                    </h4>
                    <Table head={['دستور کار', 'عملیات', 'وضعیت عملیات', 'مانده (عدد)', 'نرخ استاندارد', 'ساعت تخمینی']} dense>
                      {m.assignments.map((a: any) => (
                        <tr key={a.assignmentId}>
                          <td dir="ltr">{a.moNumber}</td>
                          <td>{a.operationNameFa}</td>
                          <td>{fa(a.opStatus)}</td>
                          <td dir="ltr">{a.remainingQuantity.toLocaleString('fa-IR')}</td>
                          <td>{a.standardRatePerHour ? <span dir="ltr">{a.standardRatePerHour}</span> : <Badge tone="warn">تعریف‌نشده</Badge>}</td>
                          <td>{a.estimatedHours !== null ? <span dir="ltr">{a.estimatedHours.toFixed(1)}</span> : <span className="cell-empty">—</span>}</td>
                        </tr>
                      ))}
                    </Table>
                  </div>
                ))}
            </Card>
          )}
        </>
      )}
    </Page>
  );
}

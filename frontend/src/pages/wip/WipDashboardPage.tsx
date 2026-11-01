import { useCallback, useEffect, useState } from 'react';
import { Workflow } from 'lucide-react';
import { api } from '../../lib/api';
import { Page, Card, Table, EmptyState, Loading, ErrorBanner, StatCardLike, Badge, Qty, fa } from '../../components/ui';
import { faNumber } from '../../lib/jalali';
import { SubNav } from '../../components/SubNav';

interface WipRow {
  operationId: string;
  moNumber: string;
  partNumber: string;
  partName: string;
  sequence: number;
  operationCode: string;
  operationName: string;
  machineCode: string | null;
  opStatus: string;
  receivedQuantity: string;
  inputQuantity: string;
  producedQuantity: string;
  scrappedQuantity: string;
  rejectedQuantity: string;
  reworkQuantity: string;
  transferredOutQuantity: string;
  waitingToProcess: string;
  processing: string;
  readyForTransfer: string;
  wipTotal: string;
  agingHours: number;
}

interface WipData {
  totals: { waitingToProcess: string; processing: string; readyForTransfer: string; wipTotal: string; scrap: string; rejected: string };
  operations: WipRow[];
}

export function WipDashboardPage() {
  const [data, setData] = useState<WipData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api<WipData>('/wip/dashboard'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در دریافت WIP');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const active = data?.operations.filter((r) => Number(r.wipTotal) > 0 || Number(r.producedQuantity) > 0) ?? [];

  return (
    <Page title="داشبورد قطعات در جریان ساخت (WIP)" subtitle="موجودی هر عملیات: در انتظار، در جریان پردازش، آماده انتقال، تکمیل و ضایعات — با قداره انتظار">
      <SubNav
        items={[
          { to: '/production', label: 'دستور کارها' },
          { to: '/production/transfers', label: 'انتقالات تولید' },
          { to: '/wip', label: 'داشبورد WIP' },
        ]}
      />
      <ErrorBanner message={error} />
      {loading && <Loading />}

      {data && (
        <>
          <div className="stat-grid stat-grid--wide">
            <StatCardLike icon={<Workflow size={20} />} value={faNumber(Math.round(Number(data.totals.wipTotal)))} label="WIP کل (قطعه)" tone="primary" />
            <StatCardLike icon={<Workflow size={20} />} value={faNumber(Math.round(Number(data.totals.waitingToProcess)))} label="در انتظار پردازش" tone="warn" />
            <StatCardLike icon={<Workflow size={20} />} value={faNumber(Math.round(Number(data.totals.processing)))} label="در جریان پردازش" tone="info" />
            <StatCardLike icon={<Workflow size={20} />} value={faNumber(Math.round(Number(data.totals.readyForTransfer)))} label="آماده انتقال" tone="ok" />
            <StatCardLike icon={<Workflow size={20} />} value={faNumber(Math.round(Number(data.totals.scrap)))} label="ضایعات تجمعی" tone="danger" />
            <StatCardLike icon={<Workflow size={20} />} value={faNumber(Math.round(Number(data.totals.rejected)))} label="مردود تجمعی" tone="danger" />
          </div>

          {active.length === 0 ? (
            <EmptyState icon={<Workflow size={28} />} title="WIP فعالی وجود ندارد" hint="با آزادسازی یک دستور کار و ثبت گزارش تولید شروع کنید" />
          ) : (
            <Card title="وضعیت عملیات" note="برای هر دستور کار و مرحله — مقدارها فقط با تراکنش‌های تأییدشده تغییر می‌کنند">
              <Table
                head={[
                  'دستور کار / قطعه', 'مرحله', 'عملیات', 'دریافتی', 'ورودی', 'در انتظار', 'در پردازش', 'آماده انتقال', 'تولید', 'ضایعات', 'مردود', 'بازکار', 'WIP', 'قداره',
                ]}
                dense
              >
                {active.map((r) => (
                  <tr key={r.operationId}>
                    <td>
                      <strong>{r.moNumber}</strong>
                      <div className="muted">{r.partNumber} — {r.partName}</div>
                    </td>
                    <td>{faNumber(r.sequence)}</td>
                    <td>
                      {r.operationName}
                      <div className="muted">{r.machineCode ?? ''} • <Badge tone={r.opStatus === 'IN_PROGRESS' ? 'primary' : 'muted'}>{fa(r.opStatus)}</Badge></div>
                    </td>
                    <td><Qty value={r.receivedQuantity} /></td>
                    <td><Qty value={r.inputQuantity} /></td>
                    <td><Qty value={r.waitingToProcess} /></td>
                    <td><Qty value={r.processing} /></td>
                    <td><strong className="text-info"><Qty value={r.readyForTransfer} /></strong></td>
                    <td><strong className="text-ok"><Qty value={r.producedQuantity} /></strong></td>
                    <td className="text-danger"><Qty value={r.scrappedQuantity} /></td>
                    <td className="text-danger"><Qty value={r.rejectedQuantity} /></td>
                    <td className="text-warn"><Qty value={r.reworkQuantity} /></td>
                    <td><strong><Qty value={r.wipTotal} /></strong></td>
                    <td className="muted">{Number(r.wipTotal) > 0 ? `${faNumber(r.agingHours)} ساعت` : '—'}</td>
                  </tr>
                ))}
              </Table>
            </Card>
          )}
        </>
      )}
    </Page>
  );
}

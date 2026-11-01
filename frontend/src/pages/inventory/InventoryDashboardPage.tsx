import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Boxes, FilePlus2, ArrowLeftRight, Scale, Search, History, FileText, Lock, Truck, ChevronLeft } from 'lucide-react';
import { api } from '../../lib/api';
import { faNumber, formatJalaliDate } from '../../lib/jalali';
import { Page, Card, StatCardLike, Badge, Table, EmptyState, Loading, ErrorBanner, Qty, fa } from '../../components/ui';
import { SubNav } from '../../components/SubNav';

interface DashboardData {
  documents: { draft: number; posted: number; byType: Record<string, number> };
  transactionsToday: number;
  itemsInStock: number;
  stockKg: { owned: string; supplierConsignment: string };
  qualityBlockedRows: number;
  activeReservations: number;
  recentTransactions: {
    id: string;
    transactionNumber: string;
    type: string;
    quantity: string;
    weightKg: string | null;
    occurredAt: string;
    part?: { partNumber: string; nameFa: string } | null;
    material?: { materialCode: string; nameFa: string } | null;
    warehouse: { code: string; nameFa: string };
    document?: { documentNumber: string } | null;
  }[];
  generatedAt: string;
}

export function InventoryDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api<DashboardData>('/inventory/dashboard'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در دریافت اطلاعات');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Page title="داشبورد انبار" subtitle="نمای کلی موجودی رسمی، سندها و آخرین حرکات — محاسبه فقط از تراکنش‌های قطع‌بوش‌شده">
      <SubNav
        items={[
          { to: '/inventory', label: 'داشبورد' },
          { to: '/inventory/receipts/new', label: 'رسید جدید', permission: 'inventory.manage' },
          { to: '/inventory/issues/new', label: 'حواله جدید', permission: 'inventory.manage' },
          { to: '/inventory/transfers/new', label: 'انتقال', permission: 'inventory.manage' },
          { to: '/inventory/adjustments/new', label: 'اصلاحیه', permission: 'inventory.manage' },
          { to: '/inventory/inquiry', label: 'استعلام موجودی' },
          { to: '/inventory/movements', label: 'دفتر کل حرکت' },
          { to: '/inventory/documents', label: 'سندها' },
          { to: '/inventory/reservations', label: 'رزروها' },
        ]}
      />

      {loading && <Loading />}
      <ErrorBanner message={error} />

      {data && (
        <>
          <div className="stat-grid stat-grid--wide">
            <StatCardLike icon={<Boxes size={20} />} value={faNumber(data.itemsInStock)} label="قلم دارای موجودی" tone="primary" />
            <StatCardLike icon={<Truck size={20} />} value={`${faNumber(Math.round(Number(data.stockKg.owned)))} kg`} label="موجودی مالی (کیلوگرم)" tone="ok" />
            <StatCardLike icon={<Truck size={20} />} value={`${faNumber(Math.round(Number(data.stockKg.supplierConsignment)))} kg`} label="موجودی امانی SAPCO (کیلوگرم)" tone="info" />
            <StatCardLike icon={<FileText size={20} />} value={faNumber(data.documents.draft)} label="سند در پیش‌نویس" tone="warn" />
            <StatCardLike icon={<Lock size={20} />} value={faNumber(data.qualityBlockedRows)} label="ردیف مسدود کیفیت" tone="danger" />
            <StatCardLike icon={<FilePlus2 size={20} />} value={faNumber(data.activeReservations)} label="رزرو فعال" tone="muted" />
          </div>

          <Card title="دسترسی سریع">
            <div className="quick-links">
              <Link className="quick-link" to="/inventory/receipts/new"><FilePlus2 size={18} /> رسید مواد/قطعات</Link>
              <Link className="quick-link" to="/inventory/issues/new"><FilePlus2 size={18} /> حواله مصرف</Link>
              <Link className="quick-link" to="/inventory/transfers/new"><ArrowLeftRight size={18} /> انتقال بین انبارها</Link>
              <Link className="quick-link" to="/inventory/adjustments/new"><Scale size={18} /> اصلاحیه انبار</Link>
              <Link className="quick-link" to="/inventory/inquiry"><Search size={18} /> استعلام موجودی</Link>
              <Link className="quick-link" to="/inventory/movements"><History size={18} /> دفتر کل حرکت</Link>
              <Link className="quick-link" to="/sapco-materials"><Truck size={18} /> گزارش حساب SAPCO</Link>
            </div>
          </Card>

          <Card title="آخرین تراکنش‌های انبار" note={`${faNumber(data.transactionsToday)} تراکنش امروز`}>
            {data.recentTransactions.length === 0 ? (
              <EmptyState title="هنوز تراکنشی ثبت نشده است" hint="با ثبت اولین رسید شروع کنید" />
            ) : (
              <Table head={['شماره تراکنش', 'نوع', 'قلم', 'مقدار', 'وزن (kg)', 'انبار', 'سند', 'زمان']}>
                {data.recentTransactions.map((t) => (
                  <tr key={t.id}>
                    <td>{t.transactionNumber}</td>
                    <td><Badge tone={t.type.includes('IN') || t.type === 'RECEIPT' ? 'ok' : 'warn'}>{fa(t.type)}</Badge></td>
                    <td>{t.part ? `${t.part.partNumber} — ${t.part.nameFa}` : t.material ? `${t.material.materialCode} — ${t.material.nameFa}` : '—'}</td>
                    <td><Qty value={t.quantity} /></td>
                    <td><Qty value={t.weightKg} unit="kg" /></td>
                    <td>{t.warehouse.nameFa}</td>
                    <td>{t.document?.documentNumber ?? '—'}</td>
                    <td className="muted">{formatJalaliDate(t.occurredAt)}</td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>

          <Link to="/inventory/documents" className="see-all">
            مشاهده همه سندها <ChevronLeft size={14} />
          </Link>
        </>
      )}
    </Page>
  );
}

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, FileSpreadsheet, ArrowLeft } from 'lucide-react';
import { api } from '../../lib/api';
import { Page, Card, Loading, ErrorBanner, EmptyState, Badge } from '../../components/ui';

interface ReportDef {
  key: string;
  titleFa: string;
  descriptionFa: string;
  filters: string[];
}

interface Catalog {
  reports: ReportDef[];
  generatedAt: string;
}

const FILTER_LABELS: Record<string, string> = {
  from: 'از تاریخ',
  to: 'تا تاریخ',
  partId: 'قطعه',
  customerId: 'مشتری',
  machineId: 'ماشین',
  operationId: 'عملیات',
  materialId: 'ماده اولیه',
  warehouseId: 'انبار',
};

export function ReportsIndexPage() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Catalog>('/reports')
      .then(setCatalog)
      .catch((err) => setError(err instanceof Error ? err.message : 'خطا در دریافت فهرست گزارش‌ها'));
  }, []);

  return (
    <Page
      title="گزارش‌های مدیریتی و کنترلی"
      subtitle="۱۳ گزارش مدیریتی بر پایه رکوردهای واقعی دیتابیس — با فیلتر، خروجی Excel (CSV)، ساعت تولید گزارش و جزئیات منبع"
    >
      <ErrorBanner message={error} />
      {!catalog && !error && <Loading />}

      {catalog && (
        <div className="report-grid">
          {catalog.reports.map((r) => (
            <Link key={r.key} to={`/reports/${r.key}`} className="report-card card">
              <div className="report-card__head">
                <span className="report-card__icon" aria-hidden>
                  <BarChart3 size={20} />
                </span>
                <h3>{r.titleFa}</h3>
              </div>
              <p className="report-card__desc">{r.descriptionFa}</p>
              <div className="report-card__foot">
                <div className="report-card__filters">
                  {r.filters.map((f) => (
                    <Badge key={f} tone="muted">{FILTER_LABELS[f] ?? f}</Badge>
                  ))}
                </div>
                <span className="report-card__open">
                  <FileSpreadsheet size={14} /> CSV <ArrowLeft size={14} />
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {catalog && catalog.reports.length === 0 && (
        <Card>
          <EmptyState icon={<BarChart3 size={28} />} title="گزارشی تعریف نشده است" />
        </Card>
      )}
    </Page>
  );
}

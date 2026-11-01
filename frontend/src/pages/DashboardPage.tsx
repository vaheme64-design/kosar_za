import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Package, Cog, Warehouse, Users, Wrench, AlertCircle } from 'lucide-react';
import { api } from '../lib/api';
import { faNumber, formatJalaliDate } from '../lib/jalali';
import { MODULES } from '../config/modules';

interface DashboardSummary {
  stats: {
    activeParts: number;
    activeMachines: number;
    warehouses: number;
    operations: number;
    customers: number;
    activeUsers: number;
    units: number;
  };
  jalaliToday: string;
  jalaliTodayFa: string;
  generatedAt: string;
}

export function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSummary(await api<DashboardSummary>('/dashboard/summary'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در دریافت اطلاعات');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="dashboard">
        <div className="stat-grid" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card stat-card stat-card--skeleton" />
          ))}
        </div>
        <div className="card skeleton-card" />
      </div>
    );
  }

  if (error || !summary) {
    return (
      <div className="alert alert--error" role="alert">
        <AlertCircle size={16} aria-hidden />
        <span>{error ?? 'داده‌ای دریافت نشد'}</span>
        <button className="btn btn--ghost btn--sm" onClick={() => void load()}>
          <RefreshCw size={14} aria-hidden /> تلاش مجدد
        </button>
      </div>
    );
  }

  const statCards = [
    { icon: Package, label: 'قطعات فعال', value: summary.stats.activeParts, hint: 'مستری قطعات' },
    { icon: Cog, label: 'ماشین‌آلات فعال', value: summary.stats.activeMachines, hint: 'پرس، برش، جوش، رنگ' },
    { icon: Warehouse, label: 'انبارهای فعال', value: summary.stats.warehouses, hint: 'مواد، WIP، تکمیلی، ضایعات' },
    { icon: Users, label: 'کاربران فعال', value: summary.stats.activeUsers, hint: 'کاربران سامانه' },
  ];

  return (
    <div className="dashboard">
      <div className="dashboard__welcome card">
        <div>
          <h2>به KPIMS خوش آمدید</h2>
          <p>
            اسکلت سامانه (فاز صفر) و طرح کامل دیتابیس (فاز یک) پیاده‌سازی شده است. شمارنده‌های زیر
            مستقیماً از PostgreSQL خوانده می‌شود.
          </p>
        </div>
        <div className="dashboard__date" dir="ltr">
          <span className="dashboard__date-num">{summary.jalaliTodayFa}</span>
          <span className="dashboard__date-label">{formatJalaliDate(summary.generatedAt, false)} (جلالی)</span>
        </div>
      </div>

      <div className="stat-grid">
        {statCards.map((s) => (
          <div key={s.label} className="card stat-card">
            <div className="stat-card__icon" aria-hidden>
              <s.icon size={22} />
            </div>
            <div>
              <div className="stat-card__value">{faNumber(s.value)}</div>
              <div className="stat-card__label">{s.label}</div>
              <div className="stat-card__hint">{s.hint}</div>
            </div>
          </div>
        ))}
      </div>

      <section className="card" aria-labelledby="modules-heading">
        <div className="card__head">
          <h3 id="modules-heading">ماژول‌ها و وضعیت پیاده‌سازی</h3>
          <button className="btn btn--ghost btn--sm" onClick={() => void load()}>
            <RefreshCw size={14} aria-hidden /> به‌روزرسانی
          </button>
        </div>
        <ul className="module-list">
          {MODULES.map((m) => (
            <li key={m.key} className="module-list__item">
              <div className="module-list__icon" aria-hidden>
                <m.icon size={18} />
              </div>
              <div className="module-list__body">
                <div className="module-list__title">
                  {m.titleFa}
                  <span className="module-list__en" dir="ltr">
                    {m.titleEn}
                  </span>
                </div>
                <div className="module-list__desc">{m.descriptionFa}</div>
              </div>
              <span className={`badge ${m.status === 'ready' ? 'badge--ok' : 'badge--planned'}`}>
                {m.status === 'ready' ? 'فعال' : 'فاز بعدی'}
              </span>
            </li>
          ))}
        </ul>
        <p className="card__note">
          <Wrench size={13} aria-hidden /> ماژول‌های «فاز بعدی» ساختار دیتابیس و مسیر API آن‌ها از
          همین حالا آماده است؛ فرم‌ها و منطق کسب‌وکار در فازهای آینده فعال می‌شود.
        </p>
      </section>
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Package, Cog, Warehouse, Users, Wrench, AlertCircle, ClipboardList, Factory, TrendingUp, AlarmClock, PackageX, Layers, Boxes, Trash2, Gauge } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { faNumber, formatJalaliDate } from '../lib/jalali';
import { MODULES } from '../config/modules';
import { Badge } from '../components/ui';

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

interface OperationsDashboard {
  kpis: {
    activeCustomerOrders: { valueKind: string; count: number; openQuantity: string; unit: string };
    plannedProduction: { valueKind: string; quantity: string; planCount: number; unit: string };
    actualProduction: { valueKind: string; quantity: string; periodDays: number; unit: string };
    delayedOrders: { valueKind: string; lineCount: number; openQuantity: string; unit: string };
    materialShortages: { valueKind: string; count: number; missingBomCount: number; quantity: string; sourcePlanNumber: string | null; sourcePlanningRunAt: string | null; unit: string };
    wipQuantity: { valueKind: string; quantity: string; unit: string };
    finishedGoodsStock: { valueKind: string; owned: string; consignment: string; unit: string };
    scrap: { valueKind: string; quantity: string; periodDays: number; unit: string };
    machineUtilization: {
      valueKind: string;
      averagePct: number | null;
      reliableMachineCount: number;
      machines: { machineCode: string; machineNameFa: string; utilizationPct: number | null; capacityReliable: boolean; reasonFa: string | null }[];
      noteFa: string;
    };
  };
  period: { from: string; to: string; basisFa: string };
  generatedAt: string;
  generatedAtFa: string;
}

export function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [ops, setOps] = useState<OperationsDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, o] = await Promise.all([
        api<DashboardSummary>('/dashboard/summary'),
        api<OperationsDashboard>('/dashboard/operations').catch(() => null),
      ]);
      setSummary(s);
      setOps(o);
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
            اسکلت سامانه (فاز صفر)، طرح دیتابیس (فاز یک)، انبار (فاز ۲)، تولید و WIP (فاز ۳)، برنامه‌ریزی
            (فاز ۴) و گزارش‌های مدیریتی (فاز ۵) پیاده‌سازی شده است. شمارنده‌ها مستقیماً از PostgreSQL
            خوانده می‌شود.
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

      {/* ---- فاز ۵: مؤلفه‌های عملیاتی (رکوردهای واقعی دیتابیس) ---- */}
      {ops && (
        <section className="card kpi-section" aria-labelledby="ops-kpi-heading">
          <div className="card__head">
            <h3 id="ops-kpi-heading">مؤلفه‌های عملیاتی</h3>
            <span className="card__note">
              زمان تولید: {ops.generatedAtFa} — {ops.period.basisFa}
            </span>
          </div>
          <div className="kpi-grid">
            <div className="kpi-tile">
              <div className="kpi-tile__head">
                <span className="kpi-tile__label">سفارش‌های فعال مشتری</span>
                <Badge tone="ok">واقعی</Badge>
              </div>
              <div className="kpi-tile__value">{faNumber(ops.kpis.activeCustomerOrders.count)}</div>
              <div className="kpi-tile__sub">مقدار باز: {faNumber(Number(ops.kpis.activeCustomerOrders.openQuantity))}</div>
            </div>
            <div className="kpi-tile">
              <div className="kpi-tile__head">
                <span className="kpi-tile__label">تولید برنامه‌ای</span>
                <Badge tone="info">برنامه‌ای</Badge>
              </div>
              <div className="kpi-tile__value">{faNumber(Number(ops.kpis.plannedProduction.quantity))}</div>
              <div className="kpi-tile__sub">{faNumber(ops.kpis.plannedProduction.planCount)} برنامه تأییدشده/آزادشده</div>
            </div>
            <div className="kpi-tile">
              <div className="kpi-tile__head">
                <span className="kpi-tile__label">تولید واقعی (۳۰ روز)</span>
                <Badge tone="ok">واقعی</Badge>
              </div>
              <div className="kpi-tile__value">{faNumber(Number(ops.kpis.actualProduction.quantity))}</div>
              <div className="kpi-tile__sub">گزارش‌های تولید قطع‌بوش‌شده</div>
            </div>
            <div className="kpi-tile">
              <div className="kpi-tile__head">
                <span className="kpi-tile__label">سفارش‌های عقب‌افتاده</span>
                <Badge tone={ops.kpis.delayedOrders.lineCount > 0 ? 'danger' : 'muted'}>
                  {faNumber(ops.kpis.delayedOrders.lineCount)}
                </Badge>
              </div>
              <div className="kpi-tile__value">{faNumber(Number(ops.kpis.delayedOrders.openQuantity))}</div>
              <div className="kpi-tile__sub">مقدار باز با سررسید گذشته</div>
            </div>
            <div className="kpi-tile">
              <div className="kpi-tile__head">
                <span className="kpi-tile__label">کسری مواد</span>
                <Badge tone={ops.kpis.materialShortages.count > 0 ? 'warn' : 'muted'}>
                  {faNumber(ops.kpis.materialShortages.count)}
                </Badge>
              </div>
              <div className="kpi-tile__value">{faNumber(Number(ops.kpis.materialShortages.quantity))}</div>
              <div className="kpi-tile__sub">
                {ops.kpis.materialShortages.sourcePlanNumber
                  ? `آخرین اجرای برنامه‌ریزی: ${ops.kpis.materialShortages.sourcePlanNumber}`
                  : 'برنامه‌ای اجرا نشده است'}
                {ops.kpis.materialShortages.missingBomCount > 0
                  ? ` — ${faNumber(ops.kpis.materialShortages.missingBomCount)} قلم بدون BOM`
                  : ''}
              </div>
            </div>
            <div className="kpi-tile">
              <div className="kpi-tile__head">
                <span className="kpi-tile__label">قطعات در جریان ساخت (WIP)</span>
                <Badge tone="ok">واقعی</Badge>
              </div>
              <div className="kpi-tile__value">{faNumber(Number(ops.kpis.wipQuantity.quantity))}</div>
              <div className="kpi-tile__sub">جمع WIP دستور کارهای فعال</div>
            </div>
            <div className="kpi-tile">
              <div className="kpi-tile__head">
                <span className="kpi-tile__label">موجودی محصول تکمیلی</span>
                <Badge tone="ok">واقعی</Badge>
              </div>
              <div className="kpi-tile__value">{faNumber(Number(ops.kpis.finishedGoodsStock.owned))}</div>
              <div className="kpi-tile__sub">امانی: {faNumber(Number(ops.kpis.finishedGoodsStock.consignment))}</div>
            </div>
            <div className="kpi-tile">
              <div className="kpi-tile__head">
                <span className="kpi-tile__label">ضایعات (۳۰ روز)</span>
                <Badge tone="ok">واقعی</Badge>
              </div>
              <div className="kpi-tile__value">{faNumber(Number(ops.kpis.scrap.quantity))}</div>
              <div className="kpi-tile__sub">ثبت‌شده در گزارش‌های تولید</div>
            </div>
            <div className="kpi-tile">
              <div className="kpi-tile__head">
                <span className="kpi-tile__label">بهره‌وری ماشین‌آلات</span>
                <Badge tone="warn">تخمینی</Badge>
              </div>
              <div className="kpi-tile__value">
                {ops.kpis.machineUtilization.averagePct === null ? '—' : `${faNumber(ops.kpis.machineUtilization.averagePct)}٪`}
              </div>
              <div className="kpi-tile__sub">
                {ops.kpis.machineUtilization.reliableMachineCount > 0
                  ? `${faNumber(ops.kpis.machineUtilization.reliableMachineCount)} ماشین با داده ظرفیت قابل اتکا`
                  : 'داده ظرفیت قابل اتکا موجود نیست'}
              </div>
            </div>
          </div>
          <p className="kpi-note">{ops.kpis.machineUtilization.noteFa}</p>
          <div className="quick-links">
            <Link className="quick-link" to="/reports/plan-vs-actual"><Factory size={15} /> برنامه در مقابل عملکرد</Link>
            <Link className="quick-link" to="/reports/order-fulfillment"><ClipboardList size={15} /> اقلای سفارش‌ها</Link>
            <Link className="quick-link" to="/reports/wip-aging"><AlarmClock size={15} /> قداره WIP</Link>
            <Link className="quick-link" to="/reports/backlog"><PackageX size={15} /> Backlog تولید</Link>
            <Link className="quick-link" to="/reports/material-consumption"><Layers size={15} /> مصرف در مقابل سرانه</Link>
            <Link className="quick-link" to="/reports/inventory-valuation"><Boxes size={15} /> موجودی انبار</Link>
            <Link className="quick-link" to="/reports/scrap"><Trash2 size={15} /> گزارش ضایعات</Link>
            <Link className="quick-link" to="/reports/machine-workload"><Gauge size={15} /> بار ماشین‌آلات</Link>
            <Link className="quick-link" to="/reports"><TrendingUp size={15} /> همه گزارش‌ها</Link>
          </div>
        </section>
      )}

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

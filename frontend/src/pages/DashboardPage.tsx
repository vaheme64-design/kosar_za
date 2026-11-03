import { useCallback, useEffect, useState } from 'react';
import {
  RefreshCw, AlertCircle, FilePlus2, ArrowLeftRight, Factory, CalendarClock,
  FileText, Scale, TrendingUp, Wrench, ShieldAlert, type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { faNumber, formatJalaliDate } from '../lib/jalali';
import { MODULES } from '../config/modules';
import { Badge } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useAppSettings } from '../lib/appSettings';

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
  /** phase 8 — material shortage alert from the newest stored MRP snapshot */
  mrpAlert?: {
    available: boolean;
    stale: boolean;
    ageHours: number | null;
    ranAt: string | null;
    summary: { materialsConsidered: number; ok: number; contractCovered: number; hardShortages: number } | null;
    topShortages: { materialId: string; materialCode: string; materialNameFa: string; shortage: string; unitCode: string; severity: string }[];
    reasonFa?: string;
  };
  generatedAt: string;
  generatedAtFa: string;
}

interface NumberCard {
  label: string;
  value: string;
  sub: string;
  to: string;
  tone: 'primary' | 'ok' | 'warn' | 'danger' | 'info' | 'muted';
}

/**
 * Home dashboard — Odoo/ERPNext-style:
 * ۱) نوار خوش‌آمد با تاریخ جلالی  ۲) اقدامات سریع (ورود مستقیم به فرم‌ها)
 * ۳) کارت‌های عددی ERPNext (همه از رکوردهای واقعی دیتابیس)  ۴) شبکه ماژول‌ها (Odoo apps)
 * هیچ عدد ساختگی وجود ندارد؛ تخمینی‌ها با برچسب «تخمینی» مشخص‌اند.
 */
export function DashboardPage() {
  const { can } = useAuth();
  const { settings } = useAppSettings();
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

  const k = ops?.kpis;
  const mrpAlert = ops?.mrpAlert;
  const mrpShortageCount = mrpAlert?.summary ? mrpAlert.summary.hardShortages + mrpAlert.summary.contractCovered : 0;

  // ---- ERPNext number cards (all values from real records) ----
  const numberCards: NumberCard[] = k
    ? [
        { label: 'سفارش‌های فعال مشتری', value: faNumber(k.activeCustomerOrders.count), sub: `مقدار باز: ${faNumber(Number(k.activeCustomerOrders.openQuantity))}`, to: '/production-planning', tone: 'primary' },
        { label: 'تولید واقعی (۳۰ روز)', value: faNumber(Number(k.actualProduction.quantity)), sub: 'گزارش‌های قطع‌بوش‌شده', to: '/reports/plan-vs-actual', tone: 'ok' },
        { label: 'قطعات در جریان ساخت', value: faNumber(Number(k.wipQuantity.quantity)), sub: 'WIP دستور کارهای فعال', to: '/wip', tone: 'info' },
        { label: 'موجودی محصول تکمیلی', value: faNumber(Number(k.finishedGoodsStock.owned)), sub: `امانی: ${faNumber(Number(k.finishedGoodsStock.consignment))}`, to: '/inventory/inquiry', tone: 'ok' },
        { label: 'سفارش‌های عقب‌افتاده', value: faNumber(k.delayedOrders.lineCount), sub: 'ردیف با سررسید گذشته', to: '/reports/order-fulfillment', tone: k.delayedOrders.lineCount > 0 ? 'danger' : 'muted' },
        { label: 'کسری مواد', value: faNumber(k.materialShortages.count), sub: k.materialShortages.sourcePlanNumber ? `آخرین اجرا: ${k.materialShortages.sourcePlanNumber}` : 'برنامه‌ای اجرا نشده', to: '/production-planning', tone: k.materialShortages.count > 0 ? 'warn' : 'muted' },
        { label: 'ضایعات (۳۰ روز)', value: faNumber(Number(k.scrap.quantity)), sub: 'از گزارش‌های تولید', to: '/reports/scrap', tone: 'muted' },
        { label: 'بهره‌وری ماشین‌آلات', value: k.machineUtilization.averagePct === null ? '—' : `${faNumber(k.machineUtilization.averagePct)}٪`, sub: 'تخمینی — بر پایه زمان استاندارد', to: '/reports/machine-workload', tone: 'muted' },
      ]
    : [];

  // ---- Odoo quick actions (permission-aware, no fake routes) ----
  const actions: { to: string; label: string; icon: LucideIcon; permission: string; primary?: boolean }[] = [
    { to: '/inventory/receipts/new', label: 'رسید انبار', icon: FilePlus2, permission: 'inventory.manage', primary: true },
    { to: '/inventory/issues/new', label: 'حواله مصرف', icon: FileText, permission: 'inventory.manage' },
    { to: '/inventory/transfers/new', label: 'انتقال انبار', icon: ArrowLeftRight, permission: 'inventory.manage' },
    { to: '/inventory/adjustments/new', label: 'اصلاحیه انبار', icon: Scale, permission: 'inventory.manage' },
    { to: '/production', label: 'دستور کار جدید', icon: Factory, permission: 'production.manage' },
    { to: '/production/reports/new', label: 'گزارش تولید', icon: FileText, permission: 'production.manage' },
    { to: '/production-planning', label: 'سفارش مشتری / اجرای برنامه', icon: CalendarClock, permission: 'planning.manage' },
    { to: '/reports', label: 'گزارش‌های مدیریتی', icon: TrendingUp, permission: 'reports.view' },
  ];

  const factoryName = settings['factory.name'] || 'KPIMS';

  return (
    <div className="dashboard">
      {/* ---- welcome strip ---- */}
      <div className="dashboard__welcome card">
        <div>
          <h2>{factoryName}</h2>
          <p>
            سامانه مدیریت تولید و موجودی — همه شمارنده‌ها مستقیماً از PostgreSQL خوانده می‌شود.
            برای جستجوی سریع در همه بخش‌ها <b>Ctrl+K</b> را بزنید.
          </p>
        </div>
        <div className="dashboard__date" dir="ltr">
          <span className="dashboard__date-num">{summary.jalaliTodayFa}</span>
          <span className="dashboard__date-label">{formatJalaliDate(summary.generatedAt, false)} (جلالی)</span>
        </div>
      </div>

      {/* ---- phase 8: MRP material shortage alert ---- */}
      {mrpAlert?.available && mrpAlert.summary && mrpShortageCount > 0 && (
        <section className={`card${mrpAlert.summary.hardShortages > 0 ? ' dashboard__mrp-alert--danger' : ' dashboard__mrp-alert--warn'}`} aria-labelledby="mrp-alert-heading">
          <div className="card__head">
            <h3 id="mrp-alert-heading">
              <ShieldAlert size={16} aria-hidden style={{ verticalAlign: '-3px', marginLeft: 4 }} />
              هشدار کسری مواد (MRP)
            </h3>
            <span className="card__note">
              آخرین محاسبه: {mrpAlert.ranAt ? formatJalaliDate(mrpAlert.ranAt, true) : '—'}
              {mrpAlert.stale ? ' — قدیمی (بیش از ۲۴ ساعت)' : ''}
            </span>
          </div>
          <div className="number-cards">
            {mrpAlert.summary.hardShortages > 0 && (
              <Link className="number-card" to="/production-planning/mrp">
                <div className="number-card__value">{faNumber(mrpAlert.summary.hardShortages)}</div>
                <div className="number-card__label">کسری واقعی</div>
                <div className="number-card__sub">بدون پوشش قرارداد — اقدام فوری</div>
              </Link>
            )}
            {mrpAlert.summary.contractCovered > 0 && (
              <Link className="number-card" to="/production-planning/mrp">
                <div className="number-card__value">{faNumber(mrpAlert.summary.contractCovered)}</div>
                <div className="number-card__label">کسری با پوشش قرارداد</div>
                <div className="number-card__sub">با قرارداد باز تأمین‌کننده پوشش داده می‌شود</div>
              </Link>
            )}
          </div>
          {mrpAlert.topShortages.length > 0 && (
            <ul className="muted" style={{ margin: '0.5rem 0 0', paddingRight: '1.2rem' }}>
              {mrpAlert.topShortages.map((s) => (
                <li key={s.materialId}>
                  {s.materialCode} — {s.materialNameFa}: کسری {faNumber(Number(s.shortage))} {s.unitCode}
                  {s.severity === 'SHORTAGE_COVERED_BY_CONTRACT' ? ' (با قرارداد باز)' : ''}
                </li>
              ))}
            </ul>
          )}
          <p className="card__note">
            جزئیات کامل و رزرو مواد: <Link to="/production-planning/mrp">صفحه محاسبه نیاز مواد (MRP)</Link>
          </p>
        </section>
      )}

      {/* ---- Odoo-style quick actions ---- */}
      <section className="card" aria-labelledby="qa-heading">
        <div className="card__head">
          <h3 id="qa-heading">اقدامات سریع</h3>
          <span className="card__note">ورود مستقیم به فرم‌ها — بدون بستن صفحه فعلی</span>
        </div>
        <div className="quick-actions">
          {actions
            .filter((a) => can(a.permission))
            .map((a) => (
              <Link key={a.to + a.label} className={`quick-action${a.primary ? ' quick-action--primary' : ''}`} to={a.to}>
                <a.icon size={16} aria-hidden /> {a.label}
              </Link>
            ))}
        </div>
      </section>

      {/* ---- ERPNext number cards ---- */}
      {k && (
        <section className="card" aria-labelledby="nc-heading">
          <div className="card__head">
            <h3 id="nc-heading">نمای عملیاتی</h3>
            <span className="card__note">
              {ops!.generatedAtFa} — {ops!.period.basisFa}
            </span>
          </div>
          <div className="number-cards">
            {numberCards.map((c) => (
              <Link key={c.label} className="number-card" to={c.to}>
                <div className="number-card__value">{c.value}</div>
                <div className="number-card__label">{c.label}</div>
                <div className="number-card__sub">{c.sub}</div>
              </Link>
            ))}
          </div>
          <p className="kpi-note">
            <Wrench size={13} aria-hidden /> {k.machineUtilization.noteFa} — تفکیک «تخمینی/برنامه‌ای/واقعی» حفظ شده است.
          </p>
        </section>
      )}

      {/* ---- Odoo apps grid ---- */}
      <section className="card" aria-labelledby="apps-heading">
        <div className="card__head">
          <h3 id="apps-heading">ماژول‌ها</h3>
          <button className="btn btn--ghost btn--sm" onClick={() => void load()}>
            <RefreshCw size={14} aria-hidden /> به‌روزرسانی
          </button>
        </div>
        <div className="apps-grid">
          {MODULES.map((m) => (
            <Link key={m.key} className="app-tile" to={m.path} title={m.descriptionFa}>
              <span className="app-tile__icon" aria-hidden>
                <m.icon size={22} />
              </span>
              <span className="app-tile__label">{m.titleFa}</span>
              <span className="app-tile__en">{m.titleEn}</span>
            </Link>
          ))}
        </div>
        <p className="card__note">
          مستری‌ها (قطعه، ماده، انبار، واحد، مشتری، شیفت…) همه قابل ویرایش‌اند؛ پیش‌فرض‌ها (مانند نام تأمین‌کننده) از
          «تنظیمات سامانه» خوانده می‌شود و هر زمان قابل تغییر است.
        </p>
      </section>

      {/* ---- master data counters ---- */}
      <section className="card" aria-labelledby="md-heading">
        <div className="card__head">
          <h3 id="md-heading">اطلاعات پایه</h3>
          <Link className="see-all" to="/master-data">
            مدیریت اطلاعات پایه
          </Link>
        </div>
        <div className="number-cards">
          <Link className="number-card" to="/master-data/parts">
            <div className="number-card__value">{faNumber(summary.stats.activeParts)}</div>
            <div className="number-card__label">قطعات فعال</div>
          </Link>
          <Link className="number-card" to="/machines">
            <div className="number-card__value">{faNumber(summary.stats.activeMachines)}</div>
            <div className="number-card__label">ماشین‌آلات فعال</div>
          </Link>
          <Link className="number-card" to="/master-data/warehouses">
            <div className="number-card__value">{faNumber(summary.stats.warehouses)}</div>
            <div className="number-card__label">انبارهای فعال</div>
          </Link>
          <Link className="number-card" to="/master-data/operations">
            <div className="number-card__value">{faNumber(summary.stats.operations)}</div>
            <div className="number-card__label">عملیات تعریف‌شده</div>
          </Link>
          <Link className="number-card" to="/master-data/customers">
            <div className="number-card__value">{faNumber(summary.stats.customers)}</div>
            <div className="number-card__label">مشتریان فعال</div>
          </Link>
          <Link className="number-card" to="/master-data/units">
            <div className="number-card__value">{faNumber(summary.stats.units)}</div>
            <div className="number-card__label">واحدهای شمارش</div>
          </Link>
          <Link className="number-card" to="/settings/users">
            <div className="number-card__value">{faNumber(summary.stats.activeUsers)}</div>
            <div className="number-card__label">کاربران فعال</div>
          </Link>
        </div>
      </section>

      {k && (
        <section className="card" aria-labelledby="ops-detail-heading">
          <div className="card__head">
            <h3 id="ops-detail-heading">جزئیات شاخص‌ها</h3>
          </div>
          <div className="kpi-grid">
            <div className="kpi-tile">
              <div className="kpi-tile__head">
                <span className="kpi-tile__label">تولید برنامه‌ای</span>
                <Badge tone="info">برنامه‌ای</Badge>
              </div>
              <div className="kpi-tile__value">{faNumber(Number(k.plannedProduction.quantity))}</div>
              <div className="kpi-tile__sub">{faNumber(k.plannedProduction.planCount)} برنامه تأییدشده/آزادشده</div>
            </div>
            <div className="kpi-tile">
              <div className="kpi-tile__head">
                <span className="kpi-tile__label">سفارش‌های عقب‌افتاده</span>
                <Badge tone={k.delayedOrders.lineCount > 0 ? 'danger' : 'muted'}>{faNumber(k.delayedOrders.lineCount)}</Badge>
              </div>
              <div className="kpi-tile__value">{faNumber(Number(k.delayedOrders.openQuantity))}</div>
              <div className="kpi-tile__sub">مقدار باز با سررسید گذشته</div>
            </div>
            <div className="kpi-tile">
              <div className="kpi-tile__head">
                <span className="kpi-tile__label">کسری مواد</span>
                <Badge tone={k.materialShortages.count > 0 ? 'warn' : 'muted'}>{faNumber(k.materialShortages.count)}</Badge>
              </div>
              <div className="kpi-tile__value">{faNumber(Number(k.materialShortages.quantity))}</div>
              <div className="kpi-tile__sub">
                {k.materialShortages.sourcePlanNumber
                  ? `آخرین اجرای برنامه‌ریزی: ${k.materialShortages.sourcePlanNumber}`
                  : 'برنامه‌ای اجرا نشده است'}
                {k.materialShortages.missingBomCount > 0 ? ` — ${faNumber(k.materialShortages.missingBomCount)} قلم بدون BOM` : ''}
              </div>
            </div>
            <div className="kpi-tile">
              <div className="kpi-tile__head">
                <span className="kpi-tile__label">بهره‌وری ماشین‌آلات</span>
                <Badge tone="warn">تخمینی</Badge>
              </div>
              <div className="kpi-tile__value">
                {k.machineUtilization.averagePct === null ? '—' : `${faNumber(k.machineUtilization.averagePct)}٪`}
              </div>
              <div className="kpi-tile__sub">
                {k.machineUtilization.reliableMachineCount > 0
                  ? `${faNumber(k.machineUtilization.reliableMachineCount)} ماشین با داده ظرفیت قابل اتکا`
                  : 'داده ظرفیت قابل اتکا موجود نیست'}
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

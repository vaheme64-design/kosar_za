import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes } from 'react';
import { faNumber } from '../lib/jalali';
export { faNumber };

// ---------------------------------------------------------------------------
// layout primitives
// ---------------------------------------------------------------------------

export function Page({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="page">
      <div className="page__head">
        <div>
          <h2 className="page__title">{title}</h2>
          {subtitle && <p className="page__subtitle">{subtitle}</p>}
        </div>
        {actions && <div className="page__actions">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function Card({ title, note, actions, children, className }: { title?: string; note?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card${className ? ` ${className}` : ''}`}>
      {(title || actions) && (
        <div className="card__head">
          {title && <h3>{title}</h3>}
          {note && <span className="card__note">{note}</span>}
          {actions && <div className="card__actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return <div className="alert alert--error">{message}</div>;
}

export function SuccessBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return <div className="alert alert--ok">{message}</div>;
}

export function Loading({ label = 'در حال بارگذاری…' }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <span className="loading__dot" /> {label}
    </div>
  );
}

export function EmptyState({ icon, title, hint }: { icon?: ReactNode; title: string; hint?: string }) {
  return (
    <div className="empty">
      {icon && <div className="empty__icon">{icon}</div>}
      <div className="empty__title">{title}</div>
      {hint && <div className="empty__hint">{hint}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// data display
// ---------------------------------------------------------------------------

export function Badge({ tone = 'muted', children }: { tone?: 'ok' | 'warn' | 'danger' | 'info' | 'muted' | 'primary'; children: ReactNode }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

/** KPI card used across dashboards. */
export function StatCardLike({ icon, value, label, tone = 'primary' }: { icon: ReactNode; value: ReactNode; label: string; tone?: 'primary' | 'ok' | 'warn' | 'danger' | 'info' | 'muted' }) {
  return (
    <div className={`stat-card stat-card--${tone}`}>
      <div className="stat-card__icon" aria-hidden>{icon}</div>
      <div>
        <div className="stat-card__value">{value}</div>
        <div className="stat-card__label">{label}</div>
      </div>
    </div>
  );
}

const DOC_TYPE_FA: Record<string, string> = {
  RECEIPT: 'رسید',
  ISSUE: 'حواله',
  TRANSFER: 'انتقال',
  ADJUSTMENT: 'اصلاحیه',
  PRODUCTION_RECEIPT: 'رسید تولید',
  PRODUCTION_ISSUE: 'حواله تولید',
  SCRAP_DISPOSAL: 'اقامت ضایعات',
  OPENING_BALANCE: 'افتتاحیه',
  COUNT_CORRECTION: 'اصلاح شمارش',
  DAMAGE: 'آسیب',
  LOSS: 'کسری',
  FOUND: 'اضافه',
  QUALITY_RELEASE: 'آزادسازی کیفیت',
  OTHER: 'سایر',
  OWNED: 'مالی',
  SUPPLIER_CONSIGNMENT: 'امانی تأمین‌کننده',
  PENDING: 'در انتظار کنترل کیفیت',
  APPROVED: 'تأیید کیفیت',
  BLOCKED: 'مسدود کیفیت',
  DRAFT: 'پیش‌نویس',
  CONFIRMED: 'تأییدشده',
  CANCELLED: 'ابطال‌شده',
  UNPOSTED: 'قطع‌بوش‌نشده',
  POSTED: 'قطع‌بوش‌شده',
  REVERSED: 'ابطالی',
  PLANNED: 'برنامه‌ریزی‌شده',
  RELEASED: 'آزادشده',
  IN_PROGRESS: 'در جریان',
  COMPLETED: 'تکمیل‌شده',
  CLOSED: 'بسته‌شده',
  PENDING_OP: 'در انتظار',
  QUEUED: 'در صف',
  PAUSED: 'متوقف',
  LOW: 'کم',
  NORMAL: 'معمولی',
  HIGH: 'زیاد',
  URGENT: 'فوری',
  OPEN: 'باز',
  PARTIALLY_RECEIVED: 'دریافت جزئی',
  ACTIVE: 'فعال',
  CONSUMED: 'مصرف‌شده',
  TRANSFER_OUT: 'خروج انتقال',
  TRANSFER_IN: 'ورود انتقال',
  ADJUSTMENT_IN: 'افزایش اصلاحی',
  ADJUSTMENT_OUT: 'کاهش اصلاحی',
  SETUP_WASTE: 'ضایعات راه‌اندازی',
  MATERIAL_DEFECT: 'عیب مواد',
  DIE_DEFECT: 'عیب قالب',
  MACHINE_FAULT: 'خرابی ماشین',
  OPERATOR_ERROR: 'خطای اپراتور',
  QUALITY_REJECT: 'رد کیفیت',
  MATERIAL: 'ماده اولیه',
  PART: 'قطعه',
  // فاز ۴ — برنامه‌ریزی تولید
  SUPERSEDED: 'جاگزیده‌شده (نسخه قدیمی)',
  RELEASED_PLAN: 'آزادشده',
  OK: 'بدون کسری',
  SHORTAGE: 'کسری ماده',
  SHORTAGE_COVERED_BY_CONTRACT: 'کسری با پوشش قرارداد',
  MISSING_BOM: 'سرانه مصرف تعریف‌نشده',
  ROUTE_STEP: 'محاسبه‌شده از مسیر تولید',
  CAPABILITY: 'محاسبه‌شده از توانمندی ماشین',
  OPERATION_DEFAULT: 'محاسبه‌شده از زمان پیش‌فرض عملیات',
  MISSING: 'اطلاعات ناقص',
  NOT_DEFINED: 'تعریف‌نشده',
  ACTIVE_RESERVATION: 'رزرو فعال',
  PARTIALLY_DELIVERED: 'تحویل جزئی',
  DELIVERED: 'تحویل‌شده',
};

/** Persian label for any domain enum value (fallback = raw value). */
export function fa(value: string | null | undefined): string {
  if (!value) return '—';
  return DOC_TYPE_FA[value] ?? value;
}

export function Qty({ value, unit }: { value: string | number | null | undefined; unit?: string | null }) {
  const n = Number(value ?? 0);
  return (
    <>
      {faNumber(Math.round(n * 100) / 100)}
      {unit ? <span className="qty-unit"> {unit}</span> : null}
    </>
  );
}

export function Progress({ percent }: { percent: number }) {
  const p = Math.max(0, Math.min(100, percent));
  return (
    <div className="progress" role="progressbar" aria-valuenow={Math.round(p)} aria-valuemin={0} aria-valuemax={100}>
      <div className="progress__bar" style={{ width: `${p}%` }} />
      <span className="progress__label">{faNumber(Math.round(p))}٪</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// form primitives
// ---------------------------------------------------------------------------

export function Field({ label, children, hint, required, className }: { label: string; children: ReactNode; hint?: string; required?: boolean; className?: string }) {
  return (
    <label className={`field${className ? ` ${className}` : ''}`}>
      <span className="field__label">
        {label}
        {required && <b className="field__req">*</b>}
      </span>
      {children}
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="input" {...props} />;
}

export function Select({ children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <select className="input input--select" {...props}>
      {children}
    </select>
  );
}

type BtnVariant = 'primary' | 'ghost' | 'danger' | 'warn';
export function Button({ variant = 'primary', children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant }) {
  return (
    <button className={`btn btn--${variant}`} {...props}>
      {children}
    </button>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div className={`modal${wide ? ' modal--wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h3>{title}</h3>
          <button className="modal__close" onClick={onClose} aria-label="بستن">
            ✕
          </button>
        </div>
        <div className="modal__body">{children}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// tables
// ---------------------------------------------------------------------------

export function Table({ head, children, dense }: { head: string[]; children: ReactNode; dense?: boolean }) {
  return (
    <div className="table-wrap">
      <table className={`table${dense ? ' table--dense' : ''}`}>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

import { Link } from 'react-router-dom';
import { ArrowRight, HardHat } from 'lucide-react';
import { getModule } from '../config/modules';

interface PlaceholderPageProps {
  moduleKey: string;
}

/**
 * Honest placeholder: the module's database schema (Phase 1) and API path
 * already exist, but no fake data or fake transactions are shown.
 */
export function PlaceholderPage({ moduleKey }: PlaceholderPageProps) {
  const module = getModule(moduleKey);

  if (!module) {
    return (
      <div className="alert alert--error" role="alert">
        ماژول «{moduleKey}» تعریف نشده است.
      </div>
    );
  }

  return (
    <div className="placeholder">
      <div className="card placeholder__card">
        <div className="placeholder__icon" aria-hidden>
          <HardHat size={30} />
        </div>
        <h2>
          {module.titleFa} <span dir="ltr" className="placeholder__en">({module.titleEn})</span>
        </h2>
        <p>{module.descriptionFa}</p>

        {module.entities && (
          <ul className="chip-list" aria-label="موجودیت‌های این ماژول در دیتابیس">
            {module.entities.map((e) => (
              <li key={e} className="chip">
                {e}
              </li>
            ))}
          </ul>
        )}

        <div className="placeholder__notice">
          این ماژول در فازهای بعدی پیاده‌سازی می‌شود. ساختار جداول، کلیدهای خارجی و قیدهای
          یکپارچگی آن در طرح فعلی دیتابیس (فاز یک) آماده است — هیچ داده ساختگی نمایش داده نمی‌شود.
        </div>

        <Link to="/" className="btn btn--ghost">
          <ArrowRight size={15} aria-hidden />
          بازگشت به داشبورد
        </Link>
      </div>
    </div>
  );
}

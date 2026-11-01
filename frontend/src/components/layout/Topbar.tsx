import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { MODULES } from '../../config/modules';
import { formatClock, formatJalaliDate } from '../../lib/jalali';

interface TopbarProps {
  onMenu: () => void;
}

export function Topbar({ onMenu }: TopbarProps) {
  const location = useLocation();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const current = MODULES.find((m) => m.path === location.pathname);

  return (
    <header className="topbar">
      <div className="topbar__right">
        <button className="topbar__menu" onClick={onMenu} aria-label="باز کردن منو">
          <Menu size={20} />
        </button>
        <h1 className="topbar__title">{current ? current.titleFa : 'داشبورد'}</h1>
      </div>
      <div className="topbar__left" aria-label="تاریخ امروز">
        <span className="topbar__date">{formatJalaliDate(now)}</span>
        <span className="topbar__clock">{formatClock(now)}</span>
      </div>
    </header>
  );
}

import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Menu, Search } from 'lucide-react';
import { MODULES } from '../../config/modules';
import { formatClock, formatJalaliDate } from '../../lib/jalali';
import { globalSearch, groupTargetPath, type SearchResultGroup } from '../../lib/search';

interface TopbarProps {
  onMenu: () => void;
}

/**
 * Topbar with the global search box (جستجوی سراسری).
 * - Ctrl+K / Ctrl+/ focuses the search from anywhere
 * - debounced server search across every module the user may view
 * - Enter opens the first hit; Esc closes the panel
 */
export function Topbar({ onMenu }: TopbarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [now, setNow] = useState(() => new Date());
  const [query, setQuery] = useState('');
  const [groups, setGroups] = useState<SearchResultGroup[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Ctrl+K focus
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // click outside closes
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // debounced search
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setGroups([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await globalSearch(q, 5);
        setGroups(res.groups);
        setOpen(true);
      } catch {
        setGroups([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const go = (group: SearchResultGroup, index: number) => {
    const item = group.results[index];
    if (!item) return;
    setOpen(false);
    setQuery('');
    navigate(groupTargetPath(group, item));
  };

  const firstGroup = groups[0];
  const current =
    MODULES.filter((m) => m.path !== '/').find((m) => location.pathname.startsWith(m.path)) ??
    MODULES.find((m) => m.path === location.pathname);
  return (
    <header className="topbar">
      <div className="topbar__right">
        <button className="topbar__menu" onClick={onMenu} aria-label="باز کردن منو">
          <Menu size={20} />
        </button>
        <h1 className="topbar__title">{current ? current.titleFa : 'داشبورد'}</h1>
      </div>

      <div className="gsearch" ref={boxRef}>
        <div className="gsearch__box">
          <Search size={15} aria-hidden />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => query.trim().length >= 2 && setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && firstGroup) go(firstGroup, 0);
            }}
            placeholder="جستجوی سراسری: قطعه، کویل، قرارداد، سفارش، ماشین…"
            aria-label="جستجوی سراسری در همه ماژول‌ها"
          />
          <span className="gsearch__kbd" aria-hidden>
            Ctrl+K
          </span>
        </div>

        {open && query.trim().length >= 2 && (
          <div className="gsearch__panel" role="listbox" aria-label="نتایج جستجوی سراسری">
            {searching && groups.length === 0 && <div className="gsearch__empty">در حال جستجو…</div>}
            {!searching && groups.length === 0 && <div className="gsearch__empty">نتیجه‌ای یافت نشد — عبارت دیگری را امتحان کنید</div>}
            {groups.map((g) => (
              <div key={g.type}>
                <div className="gsearch__group-head">
                  {g.labelFa} ({g.results.length})
                </div>
                {g.results.map((item, idx) => (
                  <button key={item.id} className={`gsearch__item${g === firstGroup && idx === 0 ? ' gsearch__item--active' : ''}`} onClick={() => go(g, idx)}>
                    <span className="gsearch__item-title">{item.title}</span>
                    {item.subtitle && <span className="gsearch__item-sub">{item.subtitle}</span>}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="topbar__left" aria-label="تاریخ امروز">
        <span className="topbar__date">{formatJalaliDate(now)}</span>
        <span className="topbar__clock">{formatClock(now)}</span>
      </div>
    </header>
  );
}

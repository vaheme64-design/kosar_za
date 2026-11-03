import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CornerDownLeft, Menu, Search } from 'lucide-react';
import { MODULES } from '../../config/modules';
import { formatClock, formatJalaliDate } from '../../lib/jalali';
import { globalSearch, groupTargetPath, type SearchResultGroup } from '../../lib/search';

interface TopbarProps {
  onMenu: () => void;
}

interface FlatHit {
  key: string;
  group: SearchResultGroup;
  index: number;
  path: string;
  title: string;
  subtitle: string | null;
}

/**
 * Command-palette style global search (جستجوی سراسری — مثل Odoo/ERPNext):
 * - Ctrl+K / Ctrl+/ از هر جای برنامه
 * - با حروف، همهٔ لایه‌ها جستجو می‌شود: قطعه، کویل، قرارداد، سفارش،
 *   دستور کار، سند انبار، ماشین، قالب، مشتری، انبار، کاربر
 * - با کلیدهای ↑/↓ بین نتایج حرکت کنید و Enter بزنید — مستقیم به همان رکورد
 * - وقتی چیزی تایپ نشده، «برو به ماژول» همهٔ بخش‌ها را نشان می‌دهد
 */
export function Topbar({ onMenu }: TopbarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [now, setNow] = useState(() => new Date());
  const [query, setQuery] = useState('');
  const [groups, setGroups] = useState<SearchResultGroup[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const openPalette = useCallback(() => {
    inputRef.current?.focus();
    setOpen(true);
    setActive(0);
  }, []);

  // Ctrl+K / Ctrl+/ / F3 focus
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K' || e.key === '/')) {
        e.preventDefault();
        openPalette();
      }
      if (e.key === 'F3') {
        e.preventDefault();
        openPalette();
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [openPalette]);

  // click outside closes
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const trimmed = query.trim();

  // debounced server search (>=2 chars)
  useEffect(() => {
    if (trimmed.length < 2) {
      setGroups([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await globalSearch(trimmed, 5);
        setGroups(res.groups);
        setOpen(true);
      } catch {
        setGroups([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [trimmed]);

  /** module-navigation entries shown while the query is empty/short */
  const moduleHits = useMemo(
    () =>
      MODULES.filter((m) => m.path !== '/')
        .filter((m) => !trimmed || m.titleFa.includes(trimmed) || m.titleEn.toLowerCase().includes(trimmed.toLowerCase()))
        .map((m) => ({ key: `module:${m.key}`, path: m.path, titleFa: m.titleFa, titleEn: m.titleEn, icon: m.icon })),
    [trimmed],
  );

  /** flat hit list = module rows + every grouped server result */
  const flatHits: FlatHit[] = useMemo(() => {
    const hits: FlatHit[] = [];
    for (const m of moduleHits) {
      hits.push({ key: m.key, group: { type: 'module', labelFa: 'برو به ماژول', path: m.path, results: [] }, index: 0, path: m.path, title: m.titleFa, subtitle: m.titleEn });
    }
    for (const g of groups) {
      g.results.forEach((item, idx) => {
        hits.push({ key: `hit:${g.type}:${item.id}`, group: g, index: idx, path: groupTargetPath(g, item), title: item.title, subtitle: item.subtitle });
      });
    }
    return hits;
  }, [moduleHits, groups]);

  const go = (hit: FlatHit) => {
    setOpen(false);
    setQuery('');
    navigate(hit.path);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, Math.max(0, flatHits.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = flatHits[active];
      if (hit) go(hit);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const current =
    MODULES.filter((m) => m.path !== '/').find((m) => location.pathname.startsWith(m.path)) ??
    MODULES.find((m) => m.path === location.pathname);

  let flatIndex = -1;
  const renderGroup = (label: string, children: React.ReactNode) => {
    const items = Array.isArray(children) ? children : [children];
    if (items.length === 0) return null;
    return (
      <div key={label}>
        <div className="gsearch__group-head">{label}</div>
        {items}
      </div>
    );
  };

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
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder="جستجو یا برو به… (قطعه، کویل، قرارداد، سفارش، سند، ماشین، ماژول)"
            aria-label="جستجوی سراسری در همه ماژول‌ها"
            role="combobox"
            aria-expanded={open}
            aria-controls="gsearch-panel"
          />
          <span className="gsearch__kbd" aria-hidden>
            Ctrl+K
          </span>
        </div>

        {open && (
          <div className="gsearch__panel" role="listbox" id="gsearch-panel" aria-label="نتایج جستجوی سراسری">
            {trimmed.length >= 2 && searching && groups.length === 0 && (
              <div className="gsearch__empty">در حال جستجو…</div>
            )}
            {trimmed.length >= 2 && !searching && flatHits.length === 0 && (
              <div className="gsearch__empty">نتیجه‌ای یافت نشد — عبارت دیگری را امتحان کنید</div>
            )}

            {/* module navigation (Odoo-style «برو به») */}
            {moduleHits.length > 0 &&
              renderGroup(
                'برو به ماژول',
                moduleHits.map((m) => {
                  flatIndex += 1;
                  const idx = flatIndex;
                  return (
                    <button
                      key={m.key}
                      className={`gsearch__item${idx === active ? ' gsearch__item--active' : ''}`}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => go(flatHits[idx])}
                    >
                      <span className="gsearch__item-title">
                        <m.icon size={14} style={{ display: 'inline', verticalAlign: '-2px', marginLeft: 6 }} aria-hidden />
                        {m.titleFa}
                      </span>
                      <span className="gsearch__item-sub" dir="ltr">
                        {m.titleEn}
                      </span>
                    </button>
                  );
                }),
              )}

            {/* server result groups */}
            {groups.map((g) =>
              renderGroup(
                `${g.labelFa} (${g.results.length})`,
                g.results.map((item) => {
                  flatIndex += 1;
                  const idx = flatIndex;
                  return (
                    <button
                      key={item.id}
                      className={`gsearch__item${idx === active ? ' gsearch__item--active' : ''}`}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => go(flatHits[idx])}
                    >
                      <span className="gsearch__item-title">{item.title}</span>
                      {item.subtitle && <span className="gsearch__item-sub">{item.subtitle}</span>}
                    </button>
                  );
                }),
              ),
            )}

            {flatHits.length > 0 && (
              <div className="gsearch__footer">
                <span>
                  <CornerDownLeft size={11} aria-hidden /> انتخاب
                </span>
                <span>↑ / ↓ جابه‌جایی</span>
                <span>Esc بستن</span>
              </div>
            )}
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

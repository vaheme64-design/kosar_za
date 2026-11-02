import { useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { X, ShieldCheck } from 'lucide-react';
import { MODULES } from '../../config/modules';
import { useAuth } from '../../context/AuthContext';

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const { user, logout } = useAuth();
  const location = useLocation();

  // close the mobile sidebar after navigation
  useEffect(() => {
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  return (
    <>
      {open && <div className="sidebar-overlay" onClick={onClose} aria-hidden />}
      <aside className={`sidebar${open ? ' sidebar--open' : ''}`} aria-label="ناوبری اصلی">
        <div className="sidebar__brand">
          <div className="sidebar__logo" aria-hidden>
            KP
          </div>
          <div>
            <div className="sidebar__title">KPIMS</div>
            <div className="sidebar__subtitle">سامانه تولید و موجودی کوثر</div>
          </div>
          <button className="sidebar__close" onClick={onClose} aria-label="بستن منو">
            <X size={18} />
          </button>
        </div>

        <nav className="sidebar__nav">
          {MODULES.map((m) => (
            <NavLink
              key={m.key}
              to={m.path}
              end={m.path === '/'}
              className={({ isActive }) => `sidebar__link${isActive ? ' is-active' : ''}`}
            >
              <m.icon size={19} aria-hidden />
              <span className="sidebar__link-label">{m.titleFa}</span>
              {m.status === 'planned' && <span className="sidebar__pill">بعداً</span>}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar__footer">
          {user && (
            <div className="sidebar__user">
              <div className="sidebar__user-avatar" aria-hidden>
                {user.fullName.trim().charAt(0)}
              </div>
              <div className="sidebar__user-meta">
                <div className="sidebar__user-name">{user.fullName}</div>
                <div className="sidebar__user-role">
                  <ShieldCheck size={12} aria-hidden /> {user.role.nameFa}
                </div>
              </div>
              <button className="btn btn--ghost btn--sm" onClick={logout}>
                خروج
              </button>
            </div>
          )}
          <div className="sidebar__version">نسخه ۰٫۶٫۰ — فازهای ۰ تا ۶</div>
        </div>
      </aside>
    </>
  );
}

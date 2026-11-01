import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export interface SubNavItem {
  to: string;
  label: string;
  permission?: string;
}

/** Tab-like secondary navigation inside a module (permission-aware). */
export function SubNav({ items }: { items: SubNavItem[] }) {
  const { can } = useAuth();
  const visible = items.filter((i) => !i.permission || can(i.permission));
  if (visible.length === 0) return null;
  return (
    <nav className="subnav" aria-label="زیرمنو">
      {visible.map((i) => (
        <NavLink
          key={i.to}
          to={i.to}
          end
          className={({ isActive }) => `subnav__link${isActive ? ' is-active' : ''}`}
        >
          {i.label}
        </NavLink>
      ))}
    </nav>
  );
}

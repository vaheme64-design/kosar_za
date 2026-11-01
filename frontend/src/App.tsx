import { Routes, Route } from 'react-router-dom';
import { MODULES } from './config/modules';
import { RequireAuth } from './components/RequireAuth';
import { AppLayout } from './components/layout/AppLayout';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { PlaceholderPage } from './components/PlaceholderPage';
import { NotFoundPage } from './pages/NotFoundPage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<DashboardPage />} />
          {MODULES.filter((m) => m.status === 'planned').map((m) => (
            <Route
              key={m.key}
              path={m.path.slice(1)}
              element={<PlaceholderPage moduleKey={m.key} />}
            />
          ))}
        </Route>
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

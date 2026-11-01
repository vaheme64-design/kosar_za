import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Factory, Loader2, AlertCircle, Info } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { ApiClientError } from '../lib/api';

export function LoginPage() {
  const { login, token } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (token) return <Navigate to={from} replace />;

  const showDemoHint = String(import.meta.env.VITE_SHOW_DEMO_HINT ?? 'true') === 'true';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(username.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.messageFa ?? err.message);
      } else {
        setError('خطای غیرمنتظره رخ داد');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-card__head">
          <div className="login-card__logo" aria-hidden>
            <Factory size={26} />
          </div>
          <h1>KPIMS</h1>
          <p className="login-card__subtitle">سامانه برنامه‌ریزی تولید و مدیریت موجودی کوثر</p>
          <p className="login-card__hintline">کارخانه قطعات فلزی خودرویی</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form" noValidate>
          <div className="field">
            <label htmlFor="username">نام کاربری</label>
            <input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              dir="ltr"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={3}
              placeholder="admin"
            />
          </div>
          <div className="field">
            <label htmlFor="password">گذرواژه</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              dir="ltr"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="alert alert--error" role="alert">
              <AlertCircle size={16} aria-hidden />
              <span>{error}</span>
            </div>
          )}

          <button type="submit" className="btn btn--primary btn--block" disabled={busy}>
            {busy ? <Loader2 className="spin" size={18} aria-hidden /> : null}
            {busy ? 'در حال ورود…' : 'ورود به سامانه'}
          </button>
        </form>

        {showDemoHint && (
          <div className="alert alert--info login-demo" role="note">
            <Info size={16} aria-hidden />
            <div>
              <strong>حساب‌های نمونه (داده‌های seed):</strong>
              <code dir="ltr">admin / Kpims@1404</code>
              <code dir="ltr">planner / Kpims@1404</code>
              <code dir="ltr">keeper / Kpims@1404</code>
              <small>این راهنما فقط در محیط توسعه نمایش داده می‌شود.</small>
            </div>
          </div>
        )}
      </div>
      <footer className="login-footer">فاز صفر و یک — اسکلت سامانه و طرح دیتابیس</footer>
    </div>
  );
}

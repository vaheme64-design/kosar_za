import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="full-page-center">
      <div className="card notfound-card">
        <h1>۴۰۴</h1>
        <p>صفحه‌ای که به دنبال آن هستید وجود ندارد.</p>
        <Link to="/" className="btn btn--primary">
          بازگشت به داشبورد
        </Link>
      </div>
    </div>
  );
}

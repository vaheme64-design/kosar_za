import { useCallback, useEffect, useState } from 'react';
import { Download, Search } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { downloadCsvExport } from '../../lib/exportImport';
import { Badge, Button, Card, EmptyState, ErrorBanner, Loading, Page, Select, Table, TextInput } from '../../components/ui';

/* eslint-disable @typescript-eslint/no-explicit-any */

const ACTION_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'info' | 'muted'> = {
  LOGIN: 'info',
  LOGIN_FAILED: 'danger',
  LOGOUT: 'muted',
  CREATE: 'ok',
  UPDATE: 'warn',
  DELETE: 'danger',
  DEACTIVATE: 'warn',
  IMPORT: 'info',
  STATUS_CHANGE: 'warn',
};

export function AuditLogsPage() {
  const { can } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [applied, setApplied] = useState('');
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const pageSize = 50;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (applied) params.set('q', applied);
      if (action) params.set('action', action);
      if (entityType) params.set('entityType', entityType);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      const res = await api<{ rows: any[]; total: number }>(`/settings/audit-logs?${params.toString()}`);
      setRows(res.rows);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در دریافت لاگ‌ها');
    } finally {
      setLoading(false);
    }
  }, [applied, action, entityType, from, to, page]);

  useEffect(() => {
    const t = setTimeout(() => {
      setApplied(query);
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  const exportCsv = async () => {
    try {
      const params = new URLSearchParams();
      if (applied) params.set('q', applied);
      if (action) params.set('action', action);
      if (entityType) params.set('entityType', entityType);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      await downloadCsvExport(`/settings/audit-logs/export${params.toString() ? `?${params}` : ''}`, 'kpims-audit-logs.csv');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در خروجی');
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <Page
      title="لاگ حسابرسی"
      subtitle="تمام رویدادهای حساس سامانه — ورود، ایجاد، ویرایش، قطع‌بوش، ابطال، تغییر وضعیت ماشین و ورود فایل"
      actions={
        can('settings.view') && (
          <Button variant="ghost" onClick={exportCsv}>
            <Download size={15} /> خروجی اکسل
          </Button>
        )
      }
    >
      {error && <ErrorBanner message={error} />}
      <Card>
        <div className="crud-toolbar">
          <div className="crud-search">
            <Search size={15} aria-hidden />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="جستجو در رویداد/موجودیت/شناسه…" />
          </div>
          <label className="crud-filter">
            <span>رویداد</span>
            <Select value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}>
              <option value="">همه</option>
              {Object.keys(ACTION_TONE).map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </Select>
          </label>
          <label className="crud-filter">
            <span>موجودیت</span>
            <TextInput
              style={{ width: 130 }}
              value={entityType}
              placeholder="مثلاً parts"
              dir="ltr"
              onChange={(e) => { setEntityType(e.target.value); setPage(1); }}
            />
          </label>
          <label className="crud-filter">
            <span>از تاریخ</span>
            <TextInput type="date" dir="ltr" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
          </label>
          <label className="crud-filter">
            <span>تا تاریخ</span>
            <TextInput type="date" dir="ltr" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
          </label>
        </div>

        {loading ? (
          <Loading />
        ) : rows.length === 0 ? (
          <EmptyState title="رویدادی یافت نشد" />
        ) : (
          <Table head={['زمان', 'کاربر', 'رویداد', 'موجودیت', 'شناسه', 'تغییرات']} dense>
            {rows.map((row) => (
              <tr key={row.id}>
                <td dir="ltr">{new Date(row.occurredAt).toLocaleString('fa-IR')}</td>
                <td>{row.user ? `${row.user.fullName} (${row.user.username})` : '—'}</td>
                <td>
                  <Badge tone={ACTION_TONE[row.action] ?? 'muted'}>{row.action}</Badge>
                </td>
                <td dir="ltr">{row.entityType ?? '—'}</td>
                <td dir="ltr" className="audit-changes">
                  {row.entityId ?? '—'}
                </td>
                <td dir="ltr" className="audit-changes" title={row.changes ? JSON.stringify(row.changes) : ''}>
                  {row.changes ? JSON.stringify(row.changes) : '—'}
                </td>
              </tr>
            ))}
          </Table>
        )}

        {total > 0 && (
          <div className="crud-pager">
            <span className="crud-toolbar__count">مجموع: {total.toLocaleString('fa-IR')} رویداد</span>
            <div className="crud-pager__nav">
              <Button variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                ‹ قبلی
              </Button>
              <span className="crud-pager__page">
                صفحه {page} از {totalPages}
              </span>
              <Button variant="ghost" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                بعدی ›
              </Button>
            </div>
          </div>
        )}
      </Card>
    </Page>
  );
}

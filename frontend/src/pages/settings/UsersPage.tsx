import { useCallback, useEffect, useState } from 'react';
import { Pencil, Search, Trash2, UserPlus } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { downloadCsvExport } from '../../lib/exportImport';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Field,
  Loading,
  Modal,
  Page,
  Select,
  SuccessBanner,
  Table,
  TextInput,
} from '../../components/ui';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface UserRow {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  role: { id: string; name: string; nameFa: string };
}

export function UsersPage() {
  const { can } = useAuth();
  const canManage = can('settings.manage');

  const [rows, setRows] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      if (roleFilter) params.set('roleId', roleFilter);
      if (activeFilter) params.set('isActive', activeFilter);
      params.set('pageSize', '200');
      const [usersRes, rolesRes] = await Promise.all([
        api<{ rows: UserRow[] }>(`/settings/users?${params.toString()}`),
        api<{ roles: any[] }>('/settings/roles'),
      ]);
      setRows(usersRes.rows);
      setRoles(rolesRes.roles);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در دریافت کاربران');
    } finally {
      setLoading(false);
    }
  }, [query, roleFilter, activeFilter]);

  useEffect(() => {
    const t = setTimeout(() => void load(), query ? 350 : 0);
    return () => clearTimeout(t);
  }, [load, query]);

  const openCreate = () => {
    setEditingId(null);
    setForm({ isActive: true });
    setFormOpen(true);
  };

  const openEdit = (row: UserRow) => {
    setEditingId(row.id);
    setForm({ fullName: row.fullName, email: row.email ?? '', roleId: row.role.id, isActive: row.isActive, password: '' });
    setFormOpen(true);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (editingId) {
        const body: Record<string, any> = {
          fullName: form.fullName,
          email: form.email || null,
          roleId: form.roleId,
          isActive: Boolean(form.isActive),
        };
        if (form.password) body.password = form.password;
        await api(`/settings/users/${editingId}`, { method: 'PUT', body });
        setNotice('کاربر ویرایش شد');
      } else {
        await api('/settings/users', {
          method: 'POST',
          body: { username: form.username, fullName: form.fullName, email: form.email || null, password: form.password, roleId: form.roleId },
        });
        setNotice('کاربر جدید ایجاد شد');
      }
      setFormOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در ذخیره کاربر');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row: UserRow) => {
    if (!window.confirm(`غیرفعال‌سازی کاربر «${row.username}»؟ (کاربران دارای سابقه اسناد حذف نمی‌شوند)`)) return;
    setBusy(true);
    try {
      await api(`/settings/users/${row.id}`, { method: 'PUT', body: { isActive: false } });
      setNotice('کاربر غیرفعال شد');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا');
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = async () => {
    try {
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      if (roleFilter) params.set('roleId', roleFilter);
      if (activeFilter) params.set('isActive', activeFilter);
      await downloadCsvExport(`/settings/users/export${params.toString() ? `?${params}` : ''}`, 'kpims-users.csv');
      setNotice('خروجی اکسل کاربران تهیه شد (بدون گذرواژه)');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در خروجی');
    }
  };

  return (
    <Page
      title="کاربران سامانه"
      subtitle="ایجاد کاربر، تعیین نقش و فعال/غیرفعال‌سازی — گذرواژه‌ها هش‌شده ذخیره می‌شوند و در خروجی نمی‌آیند"
      actions={
        <div className="crud-actions">
          <Button variant="ghost" onClick={exportCsv}>
            خروجی اکسل
          </Button>
          {canManage && (
            <Button onClick={openCreate}>
              <UserPlus size={15} /> کاربر جدید
            </Button>
          )}
        </div>
      }
    >
      {error && <ErrorBanner message={error} />}
      {notice && <SuccessBanner message={notice} />}

      <Card>
        <div className="crud-toolbar">
          <div className="crud-search">
            <Search size={15} aria-hidden />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="جستجوی نام کاربری، نام، ایمیل…" />
          </div>
          <label className="crud-filter">
            <span>نقش</span>
            <Select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
              <option value="">همه</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.nameFa}
                </option>
              ))}
            </Select>
          </label>
          <label className="crud-filter">
            <span>وضعیت</span>
            <Select value={activeFilter} onChange={(e) => setActiveFilter(e.target.value)}>
              <option value="">همه</option>
              <option value="true">فعال</option>
              <option value="false">غیرفعال</option>
            </Select>
          </label>
        </div>

        {loading ? (
          <Loading />
        ) : rows.length === 0 ? (
          <EmptyState title="کاربری یافت نشد" />
        ) : (
          <Table head={['نام کاربری', 'نام و نام خانوادگی', 'ایمیل', 'نقش', 'آخرین ورود', 'وضعیت', 'عملیات']} dense>
            {rows.map((row) => (
              <tr key={row.id} className={row.isActive ? undefined : 'row-muted'}>
                <td dir="ltr">
                  <b>{row.username}</b>
                </td>
                <td>{row.fullName}</td>
                <td dir="ltr">{row.email ?? <span className="cell-empty">—</span>}</td>
                <td>
                  <Badge tone="info">{row.role.nameFa}</Badge>
                </td>
                <td>{row.lastLoginAt ? new Date(row.lastLoginAt).toLocaleString('fa-IR') : <span className="cell-empty">—</span>}</td>
                <td>
                  <Badge tone={row.isActive ? 'ok' : 'muted'}>{row.isActive ? 'فعال' : 'غیرفعال'}</Badge>
                </td>
                <td className="crud-row__actions">
                  {canManage && (
                    <>
                      <button className="icon-btn" onClick={() => openEdit(row)} title="ویرایش">
                        <Pencil size={14} />
                      </button>
                      {row.isActive && (
                        <button className="icon-btn icon-btn--danger" onClick={() => remove(row)} title="غیرفعال‌سازی">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {formOpen && (
        <Modal title={editingId ? 'ویرایش کاربر' : 'کاربر جدید'} onClose={() => setFormOpen(false)} wide>
          <form
            className="form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <Field label="نام کاربری" required>
              <TextInput dir="ltr" value={form.username ?? ''} required disabled={Boolean(editingId)} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} />
            </Field>
            <Field label="نام و نام خانوادگی" required>
              <TextInput value={form.fullName ?? ''} required onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} />
            </Field>
            <Field label="ایمیل">
              <TextInput dir="ltr" type="email" value={form.email ?? ''} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            </Field>
            <Field label="نقش" required>
              <Select value={form.roleId ?? ''} required onChange={(e) => setForm((f) => ({ ...f, roleId: e.target.value }))}>
                <option value="">— انتخاب نقش —</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.nameFa}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={editingId ? 'گذرواژه جدید (اختیاری)' : 'گذرواژه'} required={!editingId} hint="حداقل ۸ نویسه">
              <TextInput dir="ltr" type="password" value={form.password ?? ''} required={!editingId} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
            </Field>
            {editingId && (
              <Field label="وضعیت" className="checkbox-inline-wrap">
                <label className="checkbox-inline">
                  <input type="checkbox" checked={Boolean(form.isActive)} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
                  <span>کاربر فعال باشد</span>
                </label>
              </Field>
            )}
            <div className="modal__footer form-grid__item--wide">
              <Button type="button" variant="ghost" onClick={() => setFormOpen(false)}>
                انصراف
              </Button>
              <Button type="submit" disabled={busy}>
                ذخیره
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </Page>
  );
}

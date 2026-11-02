import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import {
  Badge,
  Button,
  Card,
  ErrorBanner,
  Field,
  Loading,
  Modal,
  Page,
  SuccessBanner,
  Table,
  TextInput,
} from '../../components/ui';

/* eslint-disable @typescript-eslint/no-explicit-any */

const MODULE_FA: Record<string, string> = {
  dashboard: 'داشبورد',
  masterdata: 'اطلاعات پایه',
  inventory: 'انبار',
  production: 'تولید',
  wip: 'WIP',
  planning: 'برنامه‌ریزی',
  capacity: 'ماشین‌آلات و ظرفیت',
  materials: 'مواد SAPCO',
  reports: 'گزارش‌ها',
  settings: 'کاربران و تنظیمات',
};
const ACTION_FA: Record<string, string> = { view: 'مشاهده', manage: 'ایجاد/ویرایش', post: 'قطع‌بوش/تأیید' };

export function RolesPage() {
  const { can } = useAuth();
  const canManage = can('settings.manage');

  const [roles, setRoles] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', nameFa: '', description: '' });
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rolesRes, permsRes] = await Promise.all([
        api<{ roles: any[] }>('/settings/roles'),
        api<{ groups: any[] }>('/settings/permissions'),
      ]);
      setRoles(rolesRes.roles);
      setGroups(permsRes.groups);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در دریافت نقش‌ها');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditingId(null);
    setForm({ name: '', nameFa: '', description: '' });
    setSelected(new Set());
    setEditorOpen(true);
  };

  const openEdit = (role: any) => {
    setEditingId(role.id);
    setForm({ name: role.name, nameFa: role.nameFa, description: role.description ?? '' });
    setSelected(new Set(role.permissions));
    setEditorOpen(true);
  };

  const toggle = (code: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const toggleModule = (module: string) => {
    const group = groups.find((g) => g.module === module);
    if (!group) return;
    const codes = group.permissions.map((p: any) => p.code);
    const allSelected = codes.every((c: string) => selected.has(c));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const c of codes) {
        if (allSelected) next.delete(c);
        else next.add(c);
      }
      return next;
    });
  };

  const submit = async () => {
    if (!form.nameFa.trim()) return setError('نام فارسی نقش الزامی است');
    setBusy(true);
    setError(null);
    try {
      if (editingId) {
        await api(`/settings/roles/${editingId}`, {
          method: 'PUT',
          body: { nameFa: form.nameFa, description: form.description || null, permissionCodes: [...selected] },
        });
        setNotice('نقش و مجوزهای آن ذخیره شد');
      } else {
        await api('/settings/roles', {
          method: 'POST',
          body: { name: form.name.toUpperCase().replace(/[^A-Z0-9_]/g, ''), nameFa: form.nameFa, description: form.description || null, permissionCodes: [...selected] },
        });
        setNotice('نقش جدید ایجاد شد');
      }
      setEditorOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در ذخیره نقش');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (role: any) => {
    if (!window.confirm(`حذف نقش «${role.nameFa}»؟`)) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/settings/roles/${role.id}`, { method: 'DELETE' });
      setNotice('نقش حذف شد');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در حذف نقش');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page
      title="نقش‌ها و مجوزها"
      subtitle="کنترل دسترسی بر مبنای نقش (RBAC) — هر نقش مجموعه‌ای از مجوزهای ماژول‌محور دارد"
      actions={
        canManage && (
          <Button onClick={openCreate}>
            <Plus size={15} /> نقش جدید
          </Button>
        )
      }
    >
      {error && <ErrorBanner message={error} />}
      {notice && <SuccessBanner message={notice} />}

      <Card>
        {loading ? (
          <Loading />
        ) : (
          <Table head={['نقش', 'کد', 'کاربران', 'تعداد مجوز', 'مجوزها', 'وضعیت', 'عملیات']} dense>
            {roles.map((role) => (
              <tr key={role.id}>
                <td>
                  <b>{role.nameFa}</b>
                  {role.description && <div className="cell-sub">{role.description}</div>}
                </td>
                <td dir="ltr">{role.name}</td>
                <td>{role.userCount}</td>
                <td>{role.permissions.length}</td>
                <td>
                  <div className="chip-row">
                    {Object.keys(MODULE_FA).map((m) => {
                      const perms = role.permissions.filter((p: string) => p.startsWith(`${m}.`));
                      if (perms.length === 0) return null;
                      return (
                        <span key={m} className="chip" title={perms.join('، ')}>
                          {MODULE_FA[m]}: {perms.length}
                        </span>
                      );
                    })}
                  </div>
                </td>
                <td>
                  <Badge tone={role.isActive ? 'ok' : 'muted'}>{role.isActive ? 'فعال' : 'غیرفعال'}</Badge>
                </td>
                <td className="crud-row__actions">
                  {canManage && (
                    <>
                      <button className="icon-btn" onClick={() => openEdit(role)} title="ویرایش نقش و مجوزها">
                        ✎
                      </button>
                      {role.userCount === 0 && (
                        <button className="icon-btn icon-btn--danger" onClick={() => remove(role)} title="حذف">
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

      {editorOpen && (
        <Modal title={editingId ? 'ویرایش نقش' : 'نقش جدید'} onClose={() => setEditorOpen(false)} wide>
          <div className="form-grid">
            <Field label="کد نقش (لاتین بزرگ)" required={!editingId} hint={editingId ? 'کد نقش پس از ایجاد تغییر نمی‌کند' : undefined}>
              <TextInput dir="ltr" value={form.name} required={!editingId} disabled={Boolean(editingId)} placeholder="PLANNER" onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </Field>
            <Field label="نام فارسی" required>
              <TextInput value={form.nameFa} required onChange={(e) => setForm((f) => ({ ...f, nameFa: e.target.value }))} />
            </Field>
            <Field label="توضیحات" className="form-grid__item--wide">
              <TextInput value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            </Field>
          </div>

          <h4 className="steps-title">مجوزها (به تفکیک ماژول)</h4>
          <div className="perm-matrix">
            {groups.map((g) => (
              <div key={g.module} className="perm-module">
                <h4>
                  <label>
                    <input
                      type="checkbox"
                      checked={g.permissions.every((p: any) => selected.has(p.code))}
                      ref={(el) => {
                        if (el) el.indeterminate = !g.permissions.every((p: any) => selected.has(p.code)) && g.permissions.some((p: any) => selected.has(p.code));
                      }}
                      onChange={() => toggleModule(g.module)}
                    />
                    <b>{MODULE_FA[g.module] ?? g.module}</b>
                  </label>
                </h4>
                {g.permissions.map((p: any) => (
                  <label key={p.code}>
                    <input type="checkbox" checked={selected.has(p.code)} onChange={() => toggle(p.code)} />
                    <span>{ACTION_FA[p.action] ?? p.action}</span>
                    <small dir="ltr" className="cell-sub">
                      {p.code}
                    </small>
                  </label>
                ))}
              </div>
            ))}
          </div>

          <div className="modal__footer">
            <Button variant="ghost" onClick={() => setEditorOpen(false)}>
              انصراف
            </Button>
            <Button onClick={submit} disabled={busy}>
              ذخیره
            </Button>
          </div>
        </Modal>
      )}
    </Page>
  );
}

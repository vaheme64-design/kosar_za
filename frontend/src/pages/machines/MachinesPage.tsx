import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Gauge, Pencil, Plus, Search, Trash2, Wrench } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useLookups } from '../../lib/lookups';
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
import { OPTION_SETS, faEx } from '../../lib/labels';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface MachineRow {
  id: string;
  code: string;
  nameFa: string;
  machineType: string;
  tonnage: string | null;
  status: string;
  location: string | null;
  manufacturer: string | null;
  _count: { capabilities: number; dieCompatibilities: number };
}

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'muted'> = {
  ACTIVE: 'ok',
  MAINTENANCE: 'warn',
  BREAKDOWN: 'danger',
  RETIRED: 'muted',
};

/**
 * Machines & capacity — machines CRUD + per-machine capabilities (توانمندی)
 * and die compatibility (سازگاری قالب) editors + quick status change.
 */
export function MachinesPage() {
  const { can } = useAuth();
  const { lookups } = useLookups();
  const canManage = can('capacity.manage');

  const [rows, setRows] = useState<MachineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});

  const [detail, setDetail] = useState<MachineRow | null>(null);
  const [, setCapabilities] = useState<any[]>([]);
  const [dies, setDies] = useState<any[]>([]);
  const [capDraft, setCapDraft] = useState<{ operationId: string; rate: string }[]>([]);
  const [dieDraft, setDieDraft] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      if (typeFilter) params.set('machineType', typeFilter);
      if (statusFilter) params.set('status', statusFilter);
      params.set('pageSize', '200');
      const res = await api<{ rows: MachineRow[] }>(`/master-data/machines?${params.toString()}`);
      setRows(res.rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در دریافت ماشین‌ها');
    } finally {
      setLoading(false);
    }
  }, [query, typeFilter, statusFilter]);

  useEffect(() => {
    const t = setTimeout(() => void load(), query ? 350 : 0);
    return () => clearTimeout(t);
  }, [load, query]);

  const openCreate = () => {
    setEditingId(null);
    setForm({ machineType: 'PRESS' });
    setFormOpen(true);
  };

  const openEdit = (row: MachineRow) => {
    setEditingId(row.id);
    setForm({
      code: row.code,
      nameFa: row.nameFa,
      machineType: row.machineType,
      tonnage: row.tonnage ?? '',
      manufacturer: row.manufacturer ?? '',
      location: row.location ?? '',
      status: row.status,
    });
    setFormOpen(true);
  };

  const submitForm = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = {
        code: form.code,
        nameFa: form.nameFa,
        machineType: form.machineType,
        tonnage: form.tonnage || null,
        manufacturer: form.manufacturer || null,
        location: form.location || null,
        status: form.status || 'ACTIVE',
      };
      if (editingId) {
        await api(`/master-data/machines/${editingId}`, { method: 'PUT', body });
        setNotice('ماشین ویرایش شد');
      } else {
        await api('/master-data/machines', { method: 'POST', body });
        setNotice('ماشین جدید ثبت شد');
      }
      setFormOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در ذخیره ماشین');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row: MachineRow) => {
    if (!window.confirm(`حذف/بازنشانی ماشین «${row.code}»؟ (ماشین‌های دارای سابقه بازنشسته می‌شوند)`)) return;
    setBusy(true);
    try {
      await api(`/master-data/machines/${row.id}`, { method: 'DELETE' });
      setNotice('ماشین حذف/بازنشسته شد');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در حذف');
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async (row: MachineRow, status: string) => {
    setBusy(true);
    try {
      await api(`/machines/${row.id}/status`, { method: 'POST', body: { status } });
      setNotice(`وضعیت ماشین ${row.code} به «${faEx(status)}» تغییر کرد`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در تغییر وضعیت');
    } finally {
      setBusy(false);
    }
  };

  const openDetail = async (row: MachineRow) => {
    setDetail(row);
    setError(null);
    try {
      const res = await api<any>(`/machines/${row.id}`);
      setCapabilities(res.machine.capabilities);
      setDies(res.machine.dieCompatibilities);
      setCapDraft(
        res.machine.capabilities.map((c: any) => ({
          operationId: c.operationId,
          rate: c.standardRatePerHour ? String(c.standardRatePerHour) : '',
        })),
      );
      setDieDraft(res.machine.dieCompatibilities.map((d: any) => d.dieId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در دریافت جزئیات ماشین');
    }
  };

  const saveCapabilities = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      const res = await api<any>(`/machines/${detail.id}/capabilities`, {
        method: 'PUT',
        body: {
          capabilities: capDraft
            .filter((c) => c.operationId)
            .map((c) => ({ operationId: c.operationId, standardRatePerHour: c.rate || null })),
        },
      });
      setCapabilities(res.capabilities);
      setNotice('توانمندی‌های ماشین ذخیره شد');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در ذخیره توانمندی‌ها');
    } finally {
      setBusy(false);
    }
  };

  const saveDies = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      const res = await api<any>(`/machines/${detail.id}/dies`, { method: 'PUT', body: { dieIds: dieDraft } });
      setDies(res.dies);
      setNotice('سازگاری قالب‌ها ذخیره شد');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در ذخیره قالب‌ها');
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = async () => {
    try {
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      if (typeFilter) params.set('machineType', typeFilter);
      if (statusFilter) params.set('status', statusFilter);
      await downloadCsvExport(`/master-data/machines/export${params.toString() ? `?${params}` : ''}`, 'kpims-machines.csv');
      setNotice('خروجی اکسل ماشین‌ها تهیه شد');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در خروجی');
    }
  };

  return (
    <Page
      title="ماشین‌آلات"
      subtitle="پرس‌ها و ایستگاه‌های برش/جوش/رنگ — وضعیت ماشین ورودی صلاحیت‌سنجی برنامه‌ریزی است"
      actions={
        <div className="crud-actions">
          <Link to="/machines/capacity" className="btn btn--ghost">
            <Gauge size={15} /> نمای ظرفیت
          </Link>
          <Link to="/machines/dies" className="btn btn--ghost">
            <Wrench size={15} /> قالب‌ها
          </Link>
          <Button variant="ghost" onClick={exportCsv}>
            <Download size={15} /> خروجی اکسل
          </Button>
          {canManage && (
            <>
              <Button
                variant="ghost"
                onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = '.csv,text/csv';
                  input.onchange = () => void importMachines(input.files?.[0]);
                  input.click();
                }}
              >
                ورود اکسل
              </Button>
              <Button onClick={openCreate}>
                <Plus size={15} /> ماشین جدید
              </Button>
            </>
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
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="جستجوی کد، نام، سازنده، محل…" />
          </div>
          <label className="crud-filter">
            <span>نوع</span>
            <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="">همه</option>
              {OPTION_SETS.machineType.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="crud-filter">
            <span>وضعیت</span>
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">همه</option>
              {OPTION_SETS.machineStatus.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </label>
        </div>

        {loading ? (
          <Loading />
        ) : rows.length === 0 ? (
          <EmptyState title="ماشینی یافت نشد" />
        ) : (
          <Table head={['کد', 'نام ماشین', 'نوع', 'تناژ', 'محل', 'توانمندی', 'قالب', 'وضعیت', 'عملیات']} dense>
            {rows.map((row) => (
              <tr key={row.id} className={row.status === 'RETIRED' ? 'row-muted' : undefined}>
                <td>
                  <b dir="ltr">{row.code}</b>
                </td>
                <td>{row.nameFa}</td>
                <td>{faEx(row.machineType)}</td>
                <td>{row.tonnage ? <span dir="ltr">{Number(row.tonnage).toLocaleString('fa-IR')}</span> : <span className="cell-empty">—</span>}</td>
                <td>{row.location ?? <span className="cell-empty">—</span>}</td>
                <td>{row._count.capabilities}</td>
                <td>{row._count.dieCompatibilities}</td>
                <td>
                  <Badge tone={STATUS_TONE[row.status] ?? 'muted'}>{faEx(row.status)}</Badge>
                </td>
                <td className="crud-row__actions">
                  <button className="icon-btn" onClick={() => openDetail(row)} title="توانمندی‌ها و قالب‌ها">
                    <Wrench size={14} />
                  </button>
                  {canManage && (
                    <>
                      {row.status !== 'ACTIVE' && (
                        <button className="icon-btn" onClick={() => changeStatus(row, 'ACTIVE')} title="فعال‌سازی">
                          ✓
                        </button>
                      )}
                      {row.status === 'ACTIVE' && (
                        <>
                          <button className="icon-btn" onClick={() => changeStatus(row, 'MAINTENANCE')} title="ارسال به تعمیرات">
                            🔧
                          </button>
                          <button className="icon-btn" onClick={() => changeStatus(row, 'BREAKDOWN')} title="ثبت خرابی">
                            ⚠
                          </button>
                        </>
                      )}
                      <button className="icon-btn" onClick={() => openEdit(row)} title="ویرایش">
                        <Pencil size={14} />
                      </button>
                      <button className="icon-btn icon-btn--danger" onClick={() => remove(row)} title="حذف/بازنشانی">
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {formOpen && (
        <Modal title={editingId ? 'ویرایش ماشین' : 'ماشین جدید'} onClose={() => setFormOpen(false)} wide>
          <form
            className="form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              void submitForm();
            }}
          >
            <Field label="کد ماشین" required>
              <TextInput dir="ltr" value={form.code ?? ''} required disabled={Boolean(editingId)} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} />
            </Field>
            <Field label="نام فارسی" required>
              <TextInput value={form.nameFa ?? ''} required onChange={(e) => setForm((f) => ({ ...f, nameFa: e.target.value }))} />
            </Field>
            <Field label="نوع ماشین" required>
              <Select value={form.machineType ?? 'PRESS'} onChange={(e) => setForm((f) => ({ ...f, machineType: e.target.value }))}>
                {OPTION_SETS.machineType.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="تناژ (تن)">
              <TextInput type="number" step="0.01" dir="ltr" value={form.tonnage ?? ''} onChange={(e) => setForm((f) => ({ ...f, tonnage: e.target.value }))} />
            </Field>
            <Field label="سازنده">
              <TextInput value={form.manufacturer ?? ''} onChange={(e) => setForm((f) => ({ ...f, manufacturer: e.target.value }))} />
            </Field>
            <Field label="محل استقرار">
              <TextInput value={form.location ?? ''} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} />
            </Field>
            <Field label="وضعیت">
              <Select value={form.status ?? 'ACTIVE'} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                {OPTION_SETS.machineStatus.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
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

      {detail && (
        <Modal title={`توانمندی و قالب‌های ماشین ${detail.code} — ${detail.nameFa}`} onClose={() => setDetail(null)} wide>
          <h4 className="steps-title">توانمندی عملیات (نرخ استاندارد ساعت)</h4>
          <div className="cap-list">
            {capDraft.map((c, idx) => (
              <div key={idx} className="cap-row">
                <Select
                  value={c.operationId}
                  onChange={(e) => setCapDraft((prev) => prev.map((p, i) => (i === idx ? { ...p, operationId: e.target.value } : p)))}
                >
                  <option value="">— انتخاب عملیات —</option>
                  {lookups.operations.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.code} — {o.nameFa}
                    </option>
                  ))}
                </Select>
                <TextInput
                  type="number"
                  step="0.01"
                  dir="ltr"
                  placeholder="قطعه در ساعت (نرخ استاندارد)"
                  value={c.rate}
                  onChange={(e) => setCapDraft((prev) => prev.map((p, i) => (i === idx ? { ...p, rate: e.target.value } : p)))}
                />
                <button className="icon-btn icon-btn--danger" onClick={() => setCapDraft((prev) => prev.filter((_, i) => i !== idx))}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {canManage && (
              <Button variant="ghost" onClick={() => setCapDraft((prev) => [...prev, { operationId: '', rate: '' }])}>
                <Plus size={14} /> افزودن توانمندی
              </Button>
            )}
            {canManage && (
              <Button onClick={saveCapabilities} disabled={busy}>
                ذخیره توانمندی‌ها
              </Button>
            )}
            <p className="steps-hint">
              نرخ استاندارد مبنای تخمین بار ماشین در برنامه‌ریزی است؛ اگر خالی بماند، بار آن عملیات «نامعلوم» گزارش می‌شود (بدون فرض ضمنی).
            </p>
          </div>

          <h4 className="steps-title">قالب‌های سازگار</h4>
          <div className="cap-list">
            {dies.length > 0 && (
              <Table head={['کد قالب', 'نام', 'وضعیت', '']} dense>
                {dies.map((d: any) => (
                  <tr key={d.dieId}>
                    <td dir="ltr">
                      <b>{d.die?.code}</b>
                    </td>
                    <td>{d.die?.nameFa}</td>
                    <td>{faEx(d.die?.status)}</td>
                    <td className="crud-row__actions">
                      {canManage && (
                        <button
                          className="icon-btn icon-btn--danger"
                          onClick={() => setDieDraft((prev) => prev.filter((id) => id !== d.dieId))}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </Table>
            )}
            {canManage && (
              <>
                <Field label="افزودن قالب">
                  <Select
                    value=""
                    onChange={(e) => {
                      if (e.target.value && !dieDraft.includes(e.target.value)) setDieDraft((prev) => [...prev, e.target.value]);
                    }}
                  >
                    <option value="">— انتخاب قالب —</option>
                    {lookups.dies.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.code} — {d.nameFa}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Button onClick={saveDies} disabled={busy}>
                  ذخیره قالب‌ها
                </Button>
              </>
            )}
          </div>
        </Modal>
      )}
    </Page>
  );

  async function importMachines(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const { parseCsvText, readFileAsText } = await import('../../lib/exportImport');
      const text = await readFileAsText(file);
      const parsed = parseCsvText(text);
      if (parsed.rows.length === 0) {
        setError('فایل خالی است');
        return;
      }
      const res = await api<any>('/master-data/machines/import', { method: 'POST', body: { rows: parsed.rows } });
      setNotice(`ورود ماشین‌ها: ${res.created} جدید، ${res.updated} به‌روزرسانی، ${res.failed} خطا`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در ورود فایل');
    } finally {
      setBusy(false);
    }
  }
}

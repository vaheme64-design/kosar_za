import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, Pencil, Plus, Search, Trash2, Upload } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { downloadCsvExport, parseCsvText, readFileAsText } from '../../lib/exportImport';
import { QuickCreateButton, type QuickCreateSpec } from '../quickcreate/QuickCreate';
import {
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
} from '../ui';

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface CrudColumn {
  key: string;
  label: string;
  render?: (row: any) => ReactNode;
  width?: string;
}

export interface CrudField {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'textarea' | 'select' | 'checkbox';
  options?: { value: string; label: string }[];
  required?: boolean;
  hint?: string;
  wide?: boolean;
  step?: string;
  placeholder?: string;
  /** inline quick-create (ایجاد سریع) — + button beside the select opens a modal that creates AND selects the record without closing this form */
  quickCreate?: QuickCreateSpec;
}

export interface CrudFilter {
  key: string;
  label: string;
  options: { value: string; label: string }[];
}

export interface CrudPageProps {
  title: string;
  subtitle?: string;
  labelSingular: string;
  resourcePath: string;
  permissionManage: string;
  columns: CrudColumn[];
  fields: CrudField[];
  filters?: CrudFilter[];
  searchPlaceholder?: string;
  rowToForm?: (row: any) => Record<string, any>;
  toolbarExtra?: ReactNode;
  extraRowAction?: (row: any) => ReactNode;
  emptyHint?: string;
  pageSizeDefault?: number;
  /** called after an inline quick-create so parents refresh their select options */
  reloadOptions?: () => unknown;
}

const PAGE_SIZES = [25, 50, 100, 200];

/** Get a nested value by dot path ('part.nameFa'). */
function pick(row: any, path: string): any {
  return path.split('.').reduce((acc, key) => (acc === null || acc === undefined ? undefined : acc[key]), row);
}

interface ImportState {
  headers: string[];
  rows: Record<string, string>[];
  fileName: string;
}

/**
 * Generic registry-driven CRUD page: server-side search + filters +
 * pagination, create/edit modal, deactivate, CSV export and CSV import —
 * the same interaction pattern on every master-data screen (جستجو، خروجی و
 * ورودی اکسل در همه‌جا).
 */
export function CrudPage({
  title,
  subtitle,
  labelSingular,
  resourcePath,
  permissionManage,
  columns,
  fields,
  filters = [],
  searchPlaceholder = 'جستجو…',
  rowToForm,
  toolbarExtra,
  extraRowAction,
  emptyHint,
  pageSizeDefault = 25,
  reloadOptions,
}: CrudPageProps) {
  const { can } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [query, setQuery] = useState(() => searchParams.get('q') ?? '');
  const [appliedQuery, setAppliedQuery] = useState(() => searchParams.get('q') ?? '');
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(pageSizeDefault);

  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});

  const [importOpen, setImportOpen] = useState(false);
  const [importState, setImportState] = useState<ImportState>({ headers: [], rows: [], fileName: '' });
  const [importResult, setImportResult] = useState<any>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canManage = can(permissionManage);

  // deep-link from global search (?q=) — sync when arriving
  useEffect(() => {
    const q = searchParams.get('q');
    if (q !== null && q !== appliedQuery) {
      setQuery(q);
      setAppliedQuery(q);
      setPage(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // debounced search
  useEffect(() => {
    if (query === appliedQuery) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setAppliedQuery(query);
      setPage(1);
      const next = new URLSearchParams(searchParams);
      if (query) next.set('q', query);
      else next.delete('q');
      setSearchParams(next, { replace: true });
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (appliedQuery) params.set('q', appliedQuery);
    for (const [key, value] of Object.entries(filterValues)) {
      if (value) params.set(key, value);
    }
    params.set('page', String(page));
    params.set('pageSize', String(pageSize));
    return params.toString();
  }, [appliedQuery, filterValues, page, pageSize]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ rows: any[]; total: number }>(`${resourcePath}?${queryString}`);
      setRows(res.rows);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در دریافت داده‌ها');
    } finally {
      setLoading(false);
    }
  }, [resourcePath, queryString]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditingId(null);
    setForm({});
    setError(null);
    setModalOpen(true);
  };

  const openEdit = (row: any) => {
    setEditingId(row.id);
    const values = rowToForm ? rowToForm(row) : {};
    const prefilled: Record<string, any> = {};
    for (const f of fields) {
      const v = values[f.key] ?? pick(row, f.key);
      prefilled[f.key] = v === null || v === undefined ? (f.type === 'checkbox' ? false : '') : v;
    }
    setForm(prefilled);
    setError(null);
    setModalOpen(true);
  };

  const submitForm = async () => {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, any> = {};
      for (const [key, value] of Object.entries(form)) {
        if (value === '' || value === undefined) body[key] = null;
        else body[key] = value;
      }
      if (editingId) {
        await api(`${resourcePath}/${editingId}`, { method: 'PUT', body });
        setNotice(`${labelSingular} ویرایش شد`);
      } else {
        await api(resourcePath, { method: 'POST', body });
        setNotice(`${labelSingular} جدید ثبت شد`);
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در ذخیره');
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async (row: any) => {
    const label = pick(row, columns[0]?.key ?? 'id') ?? row.id;
    if (
      !window.confirm(
        `آیا از حذف/غیرفعال‌سازی «${String(label)}» مطمئن هستید؟\nرکوردهای استفاده‌شده در اسناد حذف نمی‌شوند و غیرفعال می‌گردند.`,
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<any>(`${resourcePath}/${row.id}`, { method: 'DELETE' });
      setNotice(res.mode === 'deactivated' ? `${labelSingular} غیرفعال شد` : `${labelSingular} حذف شد`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در حذف');
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = async () => {
    setError(null);
    try {
      const params = new URLSearchParams();
      if (appliedQuery) params.set('q', appliedQuery);
      for (const [key, value] of Object.entries(filterValues)) {
        if (value) params.set(key, value);
      }
      await downloadCsvExport(
        `${resourcePath}/export${params.toString() ? `?${params.toString()}` : ''}`,
        `kpims-${resourcePath.split('/').pop()}.csv`,
      );
      setNotice('فایل اکسل (CSV) خروجی گرفته شد');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در خروجی گرفتن');
    }
  };

  const onImportFile = async (file: File | undefined) => {
    setImportResult(null);
    setError(null);
    if (!file) return;
    try {
      const text = await readFileAsText(file);
      const parsed = parseCsvText(text);
      if (parsed.rows.length === 0) {
        setError('فایل خالی است یا قالب آن خوانده نشد');
        return;
      }
      setImportState({ headers: parsed.headers, rows: parsed.rows, fileName: file.name });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در خواندن فایل');
    }
  };

  const submitImport = async () => {
    if (!importState.rows.length) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<any>(`${resourcePath}/import`, { method: 'POST', body: { rows: importState.rows } });
      setImportResult(res);
      setNotice(`ورود فایل انجام شد: ${res.created} ردیف جدید، ${res.updated} به‌روزرسانی، ${res.failed} خطا`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در ورود فایل');
    } finally {
      setBusy(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  return (
    <Page
      title={title}
      subtitle={subtitle}
      actions={
        <div className="crud-actions">
          {toolbarExtra}
          <Button variant="ghost" onClick={exportCsv} title="خروجی اکسل (CSV) با فیلترهای فعلی">
            <Download size={15} /> خروجی اکسل
          </Button>
          {canManage && (
            <Button
              variant="ghost"
              onClick={() => {
                setImportOpen(true);
                setImportResult(null);
                setImportState({ headers: [], rows: [], fileName: '' });
              }}
            >
              <Upload size={15} /> ورود اکسل
            </Button>
          )}
          {canManage && (
            <Button onClick={openCreate}>
              <Plus size={15} /> {labelSingular} جدید
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
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              aria-label={`جستجو در ${title}`}
            />
            {query && (
              <button className="crud-search__clear" onClick={() => setQuery('')} aria-label="پاک کردن جستجو">
                ×
              </button>
            )}
          </div>
          {filters.map((f) => (
            <label key={f.key} className="crud-filter">
              <span>{f.label}</span>
              <Select
                value={filterValues[f.key] ?? ''}
                onChange={(e) => {
                  setFilterValues((prev) => ({ ...prev, [f.key]: e.target.value }));
                  setPage(1);
                }}
              >
                <option value="">همه</option>
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </label>
          ))}
          <span className="crud-toolbar__count">{total > 0 ? `${from}–${to} از ${total}` : '—'}</span>
        </div>

        {loading ? (
          <Loading />
        ) : rows.length === 0 ? (
          <EmptyState
            title="رکوردی یافت نشد"
            hint={emptyHint ?? (appliedQuery ? 'عبارت جستجو یا فیلترها را تغییر دهید' : 'با دکمه «جدید» اولین رکورد را بسازید')}
          />
        ) : (
          <Table head={[...columns.map((c) => c.label), 'عملیات']} dense>
            {rows.map((row) => (
              <tr key={row.id} className="crud-row">
                {columns.map((c) => (
                  <td key={c.key} style={c.width ? { width: c.width } : undefined}>
                    {c.render ? c.render(row) : formatCell(pick(row, c.key))}
                  </td>
                ))}
                <td className="crud-row__actions">
                  {extraRowAction?.(row)}
                  {canManage && (
                    <>
                      <button className="icon-btn" onClick={() => openEdit(row)} title="ویرایش" aria-label="ویرایش">
                        <Pencil size={14} />
                      </button>
                      <button className="icon-btn icon-btn--danger" onClick={() => deactivate(row)} title="حذف/غیرفعال‌سازی" aria-label="حذف">
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}

        {total > 0 && (
          <div className="crud-pager">
            <div className="crud-pager__size">
              <span>تعداد در صفحه:</span>
              <Select
                value={String(pageSize)}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
              >
                {PAGE_SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </div>
            <div className="crud-pager__nav">
              <Button variant="ghost" disabled={page <= 1} onClick={() => setPage(1)}>
                « ابتدا
              </Button>
              <Button variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                ‹ قبلی
              </Button>
              <span className="crud-pager__page">
                صفحه {page} از {totalPages}
              </span>
              <Button variant="ghost" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                بعدی ›
              </Button>
              <Button variant="ghost" disabled={page >= totalPages} onClick={() => setPage(totalPages)}>
                انتها »
              </Button>
            </div>
          </div>
        )}
      </Card>

      {modalOpen && (
        <Modal title={editingId ? `ویرایش ${labelSingular}` : `${labelSingular} جدید`} onClose={() => setModalOpen(false)} wide>
          <form
            className="form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              void submitForm();
            }}
          >
            {fields.map((f) => (
              <Field key={f.key} label={f.label} required={f.required} hint={f.hint} className={f.wide ? 'form-grid__item--wide' : undefined}>
                {f.type === 'textarea' ? (
                  <textarea
                    className="input"
                    rows={2}
                    value={form[f.key] ?? ''}
                    required={f.required}
                    placeholder={f.placeholder}
                    onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  />
                ) : f.type === 'select' ? (
                  <div className="inline-controls">
                    <Select
                      value={form[f.key] ?? ''}
                      required={f.required}
                      onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                    >
                      <option value="">— انتخاب کنید —</option>
                      {(f.options ?? []).map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                    {f.quickCreate && (
                      <QuickCreateButton
                        spec={f.quickCreate}
                        onCreated={(id) => {
                          void reloadOptions?.();
                          if (id) setForm((prev) => ({ ...prev, [f.key]: id }));
                        }}
                      />
                    )}
                  </div>
                ) : f.type === 'checkbox' ? (
                  <label className="checkbox-inline">
                    <input
                      type="checkbox"
                      checked={Boolean(form[f.key])}
                      onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.checked }))}
                    />
                    <span>{f.hint ?? 'فعال'}</span>
                  </label>
                ) : (
                  <TextInput
                    type={f.type === 'number' ? 'number' : 'text'}
                    step={f.step}
                    value={form[f.key] ?? ''}
                    required={f.required}
                    placeholder={f.placeholder}
                    dir={f.type === 'number' ? 'ltr' : undefined}
                    onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  />
                )}
              </Field>
            ))}
            <div className="modal__footer">
              <Button type="button" variant="ghost" onClick={() => setModalOpen(false)}>
                انصراف
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? 'در حال ذخیره…' : 'ذخیره'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {importOpen && (
        <Modal title={`ورود گروهی ${labelSingular} از فایل اکسل/CSV`} onClose={() => setImportOpen(false)} wide>
          <div className="import-help">
            <p>
              فایل CSV (خروجی اکسل) را انتخاب کنید. ردیف‌ها بر اساس ستون کلید
              {fields[0] ? ` «${fields[0].label}» ` : ' '}
              ایجاد یا به‌روزرسانی می‌شوند (upsert). ستون‌های قابل قبول:
            </p>
            <div className="chip-row">
              {fields
                .filter((f) => f.required)
                .map((f) => (
                  <span key={f.key} className="chip chip--primary">
                    {f.label}
                  </span>
                ))}
              {fields
                .filter((f) => !f.required)
                .map((f) => (
                  <span key={f.key} className="chip">
                    {f.label}
                  </span>
                ))}
            </div>
          </div>

          <Field label="فایل CSV">
            <input type="file" accept=".csv,text/csv" onChange={(e) => void onImportFile(e.target.files?.[0])} />
          </Field>

          {importState.rows.length > 0 && (
            <div className="import-preview">
              <p className="import-preview__title">
                «{importState.fileName}»: {importState.rows.length} ردیف — پیش‌نمایش ۵ ردیف اول:
              </p>
              <div className="table-wrap">
                <Table head={importState.headers.slice(0, 6)} dense>
                  {importState.rows.slice(0, 5).map((r, i) => (
                    <tr key={i}>
                      {importState.headers.slice(0, 6).map((h) => (
                        <td key={h}>{r[h]}</td>
                      ))}
                    </tr>
                  ))}
                </Table>
              </div>
              {importResult && (
                <div className="import-result">
                  <div className="chip-row">
                    <span className="chip chip--ok">ایجاد: {importResult.created}</span>
                    <span className="chip chip--info">به‌روزرسانی: {importResult.updated}</span>
                    {importResult.failed > 0 && <span className="chip chip--danger">خطا: {importResult.failed}</span>}
                  </div>
                  {importResult.errors?.length > 0 && (
                    <ul className="import-errors">
                      {importResult.errors.slice(0, 10).map((e: any, i: number) => (
                        <li key={i}>
                          ردیف {e.row}: {e.messageFa ?? e.message}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="modal__footer">
            <Button variant="ghost" onClick={() => setImportOpen(false)}>
              بستن
            </Button>
            <Button onClick={submitImport} disabled={busy || importState.rows.length === 0}>
              {busy ? 'در حال ورود…' : `ورود ${importState.rows.length} ردیف`}
            </Button>
          </div>
        </Modal>
      )}
    </Page>
  );
}

function formatCell(value: any): ReactNode {
  if (value === null || value === undefined || value === '') return <span className="cell-empty">—</span>;
  if (typeof value === 'boolean') return value ? 'بله' : 'خیر';
  if (typeof value === 'string' && value.length > 60) return <span title={value}>{value.slice(0, 60)}…</span>;
  return String(value);
}

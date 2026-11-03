import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, Check, Pencil, Plus, Search, Trash2 } from 'lucide-react';
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
import { faEx } from '../../lib/labels';
import { QuickCreateButton } from '../../components/quickcreate/QuickCreate';
import { partQuickCreate, dieQuickCreate } from '../../lib/quickCreateSpecs';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface RouteStep {
  id?: string;
  sequence: number;
  operationId: string;
  machineId?: string | null;
  dieId?: string | null;
  setupTimeMin?: number | null;
  cycleTimeSec?: string | null;
  scrapFactorPct?: string;
  requiredTonnage?: string | null;
  description?: string | null;
  operation?: { code: string; nameFa: string };
  machine?: { code: string; nameFa: string } | null;
  die?: { code: string; nameFa: string } | null;
}

interface RouteRow {
  id: string;
  partId: string;
  version: number;
  name: string | null;
  status: string;
  description: string | null;
  part: { partNumber: string; nameFa: string };
  steps: RouteStep[];
  _count?: { manufacturingOrders: number };
}

const emptyStep: RouteStep = { sequence: 0, operationId: '', machineId: '', dieId: '', scrapFactorPct: '0' };

/**
 * Versioned production routes (مسیر تولید نسخه‌بندی‌شده).
 * Editing steps of a route that already has manufacturing orders is blocked
 * by the server — create a new version instead (rule 10 of Phase 3).
 */
export function RoutesPage() {
  const { can } = useAuth();
  const { lookups, reload } = useLookups();
  const canManage = can('masterdata.manage');

  const [rows, setRows] = useState<RouteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [head, setHead] = useState({ partId: '', name: '', description: '' });
  const [steps, setSteps] = useState<RouteStep[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      if (statusFilter) params.set('status', statusFilter);
      params.set('pageSize', '200');
      const res = await api<{ rows: RouteRow[] }>(`/master-data/routes?${params.toString()}`);
      setRows(res.rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در دریافت مسیرها');
    } finally {
      setLoading(false);
    }
  }, [query, statusFilter]);

  useEffect(() => {
    const t = setTimeout(() => void load(), query ? 350 : 0);
    return () => clearTimeout(t);
  }, [load, query]);

  const openCreate = () => {
    setEditingId(null);
    setHead({ partId: '', name: '', description: '' });
    setSteps([{ ...emptyStep, sequence: 1 }]);
    setError(null);
    setEditorOpen(true);
  };

  const openEdit = (row: RouteRow) => {
    if ((row._count?.manufacturingOrders ?? 0) > 0) {
      setError('این مسیر در دستور کارها استفاده شده است؛ برای تغییر، از «ایجاد نسخه جدید» استفاده کنید');
      return;
    }
    setEditingId(row.id);
    setHead({ partId: row.partId, name: row.name ?? '', description: row.description ?? '' });
    setSteps(
      row.steps.map((s) => ({
        ...s,
        machineId: s.machineId ?? '',
        dieId: s.dieId ?? '',
        scrapFactorPct: String(s.scrapFactorPct ?? '0'),
      })),
    );
    setError(null);
    setEditorOpen(true);
  };

  const duplicateAsNewVersion = async (row: RouteRow) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ row: RouteRow }>('/master-data/routes', {
        method: 'POST',
        body: {
          partId: row.partId,
          name: row.name ? `${row.name} (نسخه جدید)` : null,
          description: row.description,
          status: 'DRAFT',
          steps: row.steps.map((s, idx) => ({
            sequence: s.sequence ?? idx + 1,
            operationId: s.operationId,
            machineId: s.machineId ?? null,
            dieId: s.dieId ?? null,
            setupTimeMin: s.setupTimeMin ?? null,
            cycleTimeSec: s.cycleTimeSec ?? null,
            scrapFactorPct: String(s.scrapFactorPct ?? '0'),
            requiredTonnage: s.requiredTonnage ?? null,
            description: s.description ?? null,
          })),
        },
      });
      setNotice(`نسخهٔ جدید (v${res.row.version}) به‌صورت پیش‌نویس ساخته شد`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در ایجاد نسخه جدید');
    } finally {
      setBusy(false);
    }
  };

  const setStep = (idx: number, patch: Partial<RouteStep>) => {
    setSteps((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };

  const submitEditor = async () => {
    if (!head.partId) return setError('قطعه را انتخاب کنید');
    const validSteps = steps.filter((s) => s.operationId);
    if (validSteps.length === 0) return setError('حداقل یک مرحله با عملیات مشخص لازم است');
    setBusy(true);
    setError(null);
    try {
      const body = {
        partId: head.partId,
        name: head.name || null,
        description: head.description || null,
        steps: validSteps.map((s, idx) => ({
          sequence: idx + 1,
          operationId: s.operationId,
          machineId: s.machineId || null,
          dieId: s.dieId || null,
          setupTimeMin: s.setupTimeMin ? Number(s.setupTimeMin) : null,
          cycleTimeSec: s.cycleTimeSec || null,
          scrapFactorPct: String(s.scrapFactorPct ?? '0'),
          requiredTonnage: s.requiredTonnage || null,
          description: s.description || null,
        })),
      };
      if (editingId) {
        await api(`/master-data/routes/${editingId}`, { method: 'PUT', body });
        setNotice('مسیر تولید ویرایش شد');
      } else {
        await api('/master-data/routes', { method: 'POST', body });
        setNotice('مسیر تولید جدید (پیش‌نویس) ساخته شد');
      }
      setEditorOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در ذخیره مسیر');
    } finally {
      setBusy(false);
    }
  };

  const activate = async (row: RouteRow) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/master-data/routes/${row.id}`, { method: 'PUT', body: { status: 'ACTIVE' } });
      setNotice('مسیر تأیید و فعال شد');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در تأیید مسیر');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row: RouteRow) => {
    if (!window.confirm(`حذف مسیر نسخهٔ ${row.version} قطعه ${row.part.nameFa}؟`)) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/master-data/routes/${row.id}`, { method: 'DELETE' });
      setNotice('مسیر حذف شد');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در حذف');
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = async () => {
    try {
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      if (statusFilter) params.set('status', statusFilter);
      await downloadCsvExport(`/master-data/routes/export${params.toString() ? `?${params}` : ''}`, 'kpims-routes.csv');
      setNotice('خروجی اکسل مسیرها تهیه شد');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در خروجی');
    }
  };

  const partOptions = lookups.parts.map((p) => ({ value: p.id, label: `${p.partNumber} — ${p.nameFa}` }));
  const operationOptions = lookups.operations.map((o) => ({ value: o.id, label: `${o.code} — ${o.nameFa}` }));
  const machineOptions = lookups.machines.map((m) => ({ value: m.id, label: `${m.code} — ${m.nameFa}` }));
  const dieOptions = (lookups as any).dies?.map((d: any) => ({ value: d.id, label: `${d.code} — ${d.nameFa}` })) ?? [];

  return (
    <Page
      title="مسیرهای تولید"
      subtitle="نسخه‌بندی‌شده — ترتیب عملیات، ماشین و قالب هر مرحله؛ مسیرِ در حال استفاده قابل ویرایش نیست و نسخهٔ جدید می‌سازید"
      actions={
        <div className="crud-actions">
          <Button variant="ghost" onClick={exportCsv}>
            خروجی اکسل
          </Button>
          {canManage && (
            <Button onClick={openCreate}>
              <Plus size={15} /> مسیر جدید
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
              placeholder="جستجو بر اساس نام مسیر یا قطعه…"
            />
          </div>
          <label className="crud-filter">
            <span>وضعیت</span>
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">همه</option>
              <option value="DRAFT">پیش‌نویس</option>
              <option value="ACTIVE">فعال</option>
              <option value="RETIRED">بازنشسته</option>
            </Select>
          </label>
        </div>

        {loading ? (
          <Loading />
        ) : rows.length === 0 ? (
          <EmptyState title="مسیری یافت نشد" hint="برای هر قطعه یک مسیر تولید با ترتیب عملیات بسازید" />
        ) : (
          <Table head={['قطعه', 'نسخه', 'نام', 'مراحل', 'وضعیت', 'دستور کار', 'عملیات']} dense>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <b dir="ltr">{row.part.partNumber}</b>
                  <div className="cell-sub">{row.part.nameFa}</div>
                </td>
                <td>
                  <Badge tone="info">v{row.version}</Badge>
                </td>
                <td>{row.name ?? <span className="cell-empty">—</span>}</td>
                <td>
                  <ol className="route-steps-inline">
                    {row.steps.map((s) => (
                      <li key={`${row.id}-${s.id ?? s.sequence}`}>
                        {s.operation?.nameFa ?? '?'}
                        {s.machine ? ` — ${s.machine.code}` : ''}
                      </li>
                    ))}
                  </ol>
                </td>
                <td>
                  <Badge tone={row.status === 'ACTIVE' ? 'ok' : row.status === 'DRAFT' ? 'warn' : 'muted'}>{faEx(row.status)}</Badge>
                </td>
                <td>{row._count?.manufacturingOrders ?? 0}</td>
                <td className="crud-row__actions">
                  {canManage && (row._count?.manufacturingOrders ?? 0) === 0 && (
                    <>
                      <button className="icon-btn" onClick={() => openEdit(row)} title="ویرایش">
                        <Pencil size={14} />
                      </button>
                      {row.status === 'DRAFT' && (
                        <button className="icon-btn" onClick={() => activate(row)} title="تأیید و فعال‌سازی">
                          <Check size={14} />
                        </button>
                      )}
                      <button className="icon-btn icon-btn--danger" onClick={() => remove(row)} title="حذف">
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                  {canManage && (
                    <button className="icon-btn" onClick={() => duplicateAsNewVersion(row)} title="ایجاد نسخه جدید از این مسیر">
                      <Plus size={14} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {editorOpen && (
        <Modal title={editingId ? 'ویرایش مسیر تولید' : 'مسیر تولید جدید'} onClose={() => setEditorOpen(false)} wide>
          <div className="form-grid">
            <Field label="قطعه" required>
              <div className="inline-controls">
                <Select value={head.partId} disabled={Boolean(editingId)} onChange={(e) => setHead((h) => ({ ...h, partId: e.target.value }))}>
                  <option value="">— انتخاب قطعه —</option>
                  {partOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
                <QuickCreateButton
                  spec={partQuickCreate(lookups)}
                  onCreated={async (id) => {
                    await reload();
                    if (id) setHead((h) => ({ ...h, partId: id }));
                  }}
                />
              </div>
            </Field>
            <Field label="نام مسیر">
              <TextInput value={head.name} onChange={(e) => setHead((h) => ({ ...h, name: e.target.value }))} placeholder="مثلاً مسیر یراق درب" />
            </Field>
            <Field label="توضیحات" className="form-grid__item--wide">
              <TextInput value={head.description} onChange={(e) => setHead((h) => ({ ...h, description: e.target.value }))} />
            </Field>
          </div>

          <h4 className="steps-title">مراحل مسیر (به ترتیب اجرا)</h4>
          <div className="steps-editor">
            {steps.map((s, idx) => (
              <div key={idx} className="step-editor-row">
                <span className="step-editor-row__no">{idx + 1}</span>
                <div className="step-editor-row__fields">
                  <Field label="عملیات" required>
                    <Select value={s.operationId} onChange={(e) => setStep(idx, { operationId: e.target.value })}>
                      <option value="">— انتخاب —</option>
                      {operationOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="ماشین پیشنهادی">
                    <Select value={s.machineId ?? ''} onChange={(e) => setStep(idx, { machineId: e.target.value })}>
                      <option value="">— بدون پیشنهاد —</option>
                      {machineOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="قالب">
                    <div className="inline-controls">
                      <Select value={s.dieId ?? ''} onChange={(e) => setStep(idx, { dieId: e.target.value })}>
                        <option value="">— بدون قالب —</option>
                        {dieOptions.map((o: any) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </Select>
                      <QuickCreateButton
                        spec={dieQuickCreate()}
                        onCreated={async (id) => {
                          await reload();
                          if (id) setStep(idx, { dieId: id });
                        }}
                      />
                    </div>
                  </Field>
                  <Field label="دوره ضایعات ٪">
                    <TextInput
                      type="number"
                      step="0.01"
                      dir="ltr"
                      value={s.scrapFactorPct ?? '0'}
                      onChange={(e) => setStep(idx, { scrapFactorPct: e.target.value })}
                    />
                  </Field>
                </div>
                <button
                  className="icon-btn icon-btn--danger"
                  onClick={() => setSteps((prev) => prev.filter((_, i) => i !== idx))}
                  title="حذف مرحله"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <Button
              variant="ghost"
              onClick={() => setSteps((prev) => [...prev, { ...emptyStep, sequence: prev.length + 1 }])}
              type="button"
            >
              <Plus size={14} /> افزودن مرحله
            </Button>
            {steps.length > 1 && (
              <p className="steps-hint">
                <ArrowDown size={12} /> ترتیب مراحل همان ترتیب نمایش است؛ با حذف/افزودن جابه‌جا کنید.
              </p>
            )}
          </div>

          <div className="modal__footer">
            <Button variant="ghost" onClick={() => setEditorOpen(false)}>
              انصراف
            </Button>
            <Button onClick={submitEditor} disabled={busy}>
              {busy ? 'در حال ذخیره…' : 'ذخیره مسیر'}
            </Button>
          </div>
        </Modal>
      )}
    </Page>
  );
}

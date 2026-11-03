import { useState } from 'react';
import { Plus, Save } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { Button, ErrorBanner, Field, Modal, Select, TextInput } from '../ui';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Inline quick-create (ایجاد سریع درون فرم) — the anti-«بستن فرم» pattern:
 * whenever a form needs a record that does not exist yet (مشتری، واحد، انبار،
 * ماده، قطعه، شیفت، قرارداد…), the user clicks + next to the picker, fills a
 * small modal, and the new record is created AND selected — the outer form
 * and everything typed into it stays untouched.
 */

export interface QuickCreateField {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'textarea' | 'select' | 'date' | 'time';
  options?: { value: string; label: string }[];
  required?: boolean;
  hint?: string;
  placeholder?: string;
  step?: string;
  wide?: boolean;
  dir?: 'ltr' | 'rtl';
}

export interface QuickCreateSpec {
  /** POST target, e.g. '/master-data/customers' or '/inventory/contracts' */
  resourcePath: string;
  /** modal title, e.g. «مشتری جدید» */
  title: string;
  /** permission needed to create (passed through useAuth().can) */
  permission?: string;
  fields: QuickCreateField[];
  /** pre-filled values merged over the empty form (may be dynamic per row) */
  initialValues?: Record<string, any> | (() => Record<string, any>);
  /** body transform before POST (strip empties → null etc.) */
  toBody?: (values: Record<string, any>) => Record<string, any>;
  /** extract the new record's id from the POST response */
  pickId: (response: any) => string | undefined;
  /** optional toast-style success line shown after creation */
  successFa?: string;
}

export function quickCreateBody(values: Record<string, any>): Record<string, any> {
  const body: Record<string, any> = {};
  for (const [k, v] of Object.entries(values)) {
    body[k] = v === '' || v === undefined ? null : v;
  }
  return body;
}

export function QuickCreateButton({
  spec,
  onCreated,
  title = 'ایجاد سریع بدون خروج از فرم',
  compact = true,
}: {
  spec: QuickCreateSpec;
  onCreated: (id: string | undefined, created: any) => void;
  title?: string;
  compact?: boolean;
}) {
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (spec.permission && !can(spec.permission)) return null;

  const openModal = () => {
    const initial = typeof spec.initialValues === 'function' ? spec.initialValues() : (spec.initialValues ?? {});
    setValues({ ...initial });
    setError(null);
    setOpen(true);
  };

  const submit = async () => {
    for (const f of spec.fields) {
      if (f.required && (values[f.key] === undefined || values[f.key] === null || values[f.key] === '')) {
        setError(`${f.label} الزامی است`);
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      const body = spec.toBody ? spec.toBody(values) : quickCreateBody(values);
      const res = await api<any>(spec.resourcePath, { method: 'POST', body });
      const id = spec.pickId(res);
      setOpen(false);
      onCreated(id, res);
    } catch (err) {
      const faMsg = (err as { messageFa?: string }).messageFa;
      setError(faMsg ?? (err instanceof Error ? err.message : 'خطا در ایجاد'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className={compact ? 'icon-btn icon-btn--add' : 'btn btn--ghost btn--sm'}
        onClick={openModal}
        title={title}
        aria-label={title}
      >
        <Plus size={compact ? 14 : 15} />
        {!compact && <span>ایجاد سریع</span>}
      </button>

      {open && (
        <Modal title={`${spec.title} (سریع)`} onClose={() => setOpen(false)}>
          <p className="kpi-note">
            «{spec.title.replace(' جدید', '')}» همین‌جا ساخته می‌شود، بلافاصله در همین فیلد انتخاب می‌گردد و هیچ داده‌ای
            که تا الان در فرم وارد کرده‌اید از دست نمی‌رود.
          </p>
          <ErrorBanner message={error} />
          <div className="form-grid form-grid--wide">
            {spec.fields.map((f) => (
              <Field key={f.key} label={f.label} required={f.required} hint={f.hint} className={f.wide ? 'form-grid__item--wide' : undefined}>
                {f.type === 'textarea' ? (
                  <textarea
                    className="input"
                    rows={2}
                    value={values[f.key] ?? ''}
                    placeholder={f.placeholder}
                    onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  />
                ) : f.type === 'select' ? (
                  <Select value={values[f.key] ?? ''} onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}>
                    <option value="">— انتخاب کنید —</option>
                    {(f.options ?? []).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <TextInput
                    type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'time' ? 'time' : 'text'}
                    step={f.step}
                    dir={f.dir}
                    value={values[f.key] ?? ''}
                    required={f.required}
                    placeholder={f.placeholder}
                    onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  />
                )}
              </Field>
            ))}
          </div>
          <div className="form-actions">
            <Button type="button" onClick={() => void submit()} disabled={busy}>
              <Save size={15} /> {busy ? 'در حال ایجاد…' : 'ایجاد و انتخاب'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              انصراف
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}

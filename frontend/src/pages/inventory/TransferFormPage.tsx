import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, Save, Send } from 'lucide-react';
import { api } from '../../lib/api';
import { useLookups } from '../../lib/lookups';
import { QuickCreateButton } from '../../components/quickcreate/QuickCreate';
import { warehouseQuickCreate } from '../../lib/quickCreateSpecs';
import { Page, Card, Field, TextInput, Select, Button, ErrorBanner, Loading } from '../../components/ui';
import { SubNav } from '../../components/SubNav';

interface LineState {
  key: number;
  kind: 'MATERIAL' | 'PART';
  itemId: string;
  lotId: string;
  quantity: string;
  fromLocationId: string;
  toLocationId: string;
}

let lineKey = 1;
const todayStr = () => new Date().toISOString().slice(0, 10);

export function TransferFormPage() {
  const navigate = useNavigate();
  const { lookups, loading: lookupsLoading, reload } = useLookups();

  const [warehouseId, setWarehouseId] = useState('');
  const [documentDate, setDocumentDate] = useState(todayStr());
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState<LineState[]>([
    { key: lineKey++, kind: 'MATERIAL', itemId: '', lotId: '', quantity: '', fromLocationId: '', toLocationId: '' },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const patchLine = useCallback((key: number, patch: Partial<LineState>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }, []);

  const addLine = () =>
    setLines((prev) => [...prev, { key: lineKey++, kind: 'MATERIAL', itemId: '', lotId: '', quantity: '', fromLocationId: '', toLocationId: '' }]);

  const removeLine = (key: number) => setLines((prev) => prev.filter((l) => l.key !== key));

  const submit = async (post: boolean) => {
    if (!warehouseId) return setError('انبار مبدأ را انتخاب کنید');
    for (const [i, l] of lines.entries()) {
      if (!l.itemId) return setError(`ردیف ${i + 1}: قلم را انتخاب کنید`);
      if (!l.quantity || Number(l.quantity) <= 0) return setError(`ردیف ${i + 1}: مقدار نامعتبر است`);
      if (!l.fromLocationId || !l.toLocationId) return setError(`ردیف ${i + 1}: موقعیت مبدأ و مقصد الزامی است`);
      if (l.fromLocationId === l.toLocationId) return setError(`ردیف ${i + 1}: مبدأ و مقصد باید متفاوت باشند`);
      if (l.kind === 'MATERIAL' && !l.lotId) return setError(`ردیف ${i + 1}: برای ماده اولیه انتخاب لوت الزامی است`);
    }
    setError(null);
    setBusy(true);
    try {
      const res = await api<{ document: { id: string; documentNumber: string } }>('/inventory/documents', {
        method: 'POST',
        body: {
          documentType: 'TRANSFER',
          documentDate,
          warehouseId,
          description: description || null,
          lines: lines.map((l) => ({
            ...(l.kind === 'MATERIAL' ? { materialId: l.itemId } : { partId: l.itemId }),
            ...(l.kind === 'MATERIAL' ? { lotId: l.lotId } : {}),
            quantity: l.quantity,
            fromLocationId: l.fromLocationId,
            toLocationId: l.toLocationId,
          })),
        },
      });
      if (post) {
        await api(`/inventory/documents/${res.document.id}/post`, { method: 'POST' });
      }
      navigate('/inventory/documents', {
        state: { notice: post ? `سند انتقال ${res.document.documentNumber} قطع‌بوش شد` : `سند انتقال ${res.document.documentNumber} پیش‌نویس شد` },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در ثبت انتقال');
    } finally {
      setBusy(false);
    }
  };

  if (lookupsLoading) return <Loading label="در حال دریافت اطلاعات پایه…" />;

  const locLabel = (id: string) => {
    const loc = lookups.locations.find((l) => l.id === id);
    if (!loc) return '';
    const wh = lookups.warehouses.find((w) => w.id === loc.warehouseId);
    return `${wh?.code ?? ''} / ${loc.code} — ${loc.nameFa}`;
  };

  return (
    <Page title="انتقال موجودی" subtitle="جابه‌جایی بین موقعیت‌های یک انبار یا بین دو انبار (کشویی از موقعیت مقصد تعیین می‌شود)">
      <SubNav
        items={[
          { to: '/inventory', label: 'داشبورد' },
          { to: '/inventory/transfers/new', label: 'انتقال جدید' },
          { to: '/inventory/lots', label: 'رول‌ها و لوت‌ها' },
          { to: '/inventory/documents', label: 'سندها' },
        ]}
      />
      <ErrorBanner message={error} />

      <Card title="سربرگ سند">
        <div className="form-grid">
          <Field label="انبار مبدأ" required>
            <div className="inline-controls">
              <Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                <option value="">— انتخاب انبار —</option>
                {lookups.warehouses.map((w) => (
                  <option key={w.id} value={w.id}>{w.code} — {w.nameFa}</option>
                ))}
              </Select>
              <QuickCreateButton
                spec={warehouseQuickCreate()}
                onCreated={async (id) => {
                  await reload();
                  if (id) setWarehouseId(id);
                }}
              />
            </div>
          </Field>
          <Field label="تاریخ سند" required>
            <TextInput type="date" value={documentDate} onChange={(e) => setDocumentDate(e.target.value)} />
          </Field>
          <Field label="توضیحات">
            <TextInput value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </div>
      </Card>

      <Card
        title="ردیف‌های انتقال"
        actions={
          <Button variant="ghost" onClick={addLine} type="button">
            <Plus size={16} /> افزودن ردیف
          </Button>
        }
      >
        <div className="lines-editor">
          {lines.map((l, idx) => (
            <div className="line-row" key={l.key}>
              <div className="line-row__head">
                <strong>ردیف {idx + 1}</strong>
                {lines.length > 1 && (
                  <Button variant="danger" onClick={() => removeLine(l.key)} type="button" aria-label="حذف ردیف">
                    <Trash2 size={14} />
                  </Button>
                )}
              </div>
              <div className="form-grid form-grid--wide">
                <Field label="نوع قلم" required>
                  <Select value={l.kind} onChange={(e) => patchLine(l.key, { kind: e.target.value as LineState['kind'], itemId: '', lotId: '' })}>
                    <option value="MATERIAL">ماده اولیه</option>
                    <option value="PART">قطعه</option>
                  </Select>
                </Field>
                <Field label={l.kind === 'MATERIAL' ? 'ماده اولیه' : 'قطعه'} required>
                  <Select value={l.itemId} onChange={(e) => patchLine(l.key, { itemId: e.target.value, lotId: '' })}>
                    <option value="">— انتخاب —</option>
                    {(l.kind === 'MATERIAL' ? lookups.materials : lookups.parts).map((item) => (
                      <option key={item.id} value={item.id}>
                        {'materialCode' in item ? item.materialCode : (item as { partNumber: string }).partNumber} — {item.nameFa}
                      </option>
                    ))}
                  </Select>
                </Field>
                {l.kind === 'MATERIAL' && (
                  <Field label="لوت" required>
                    <Select value={l.lotId} onChange={(e) => patchLine(l.key, { lotId: e.target.value })}>
                      <option value="">— انتخاب لوت —</option>
                      {lookups.lots.filter((lot) => lot.materialId === l.itemId).map((lot) => (
                        <option key={lot.id} value={lot.id}>{lot.lotNumber}</option>
                      ))}
                    </Select>
                  </Field>
                )}
                <Field label="مقدار" required>
                  <TextInput type="number" min="0" step="0.001" value={l.quantity} onChange={(e) => patchLine(l.key, { quantity: e.target.value })} />
                </Field>
                <Field label="از موقعیت" required>
                  <Select value={l.fromLocationId} onChange={(e) => patchLine(l.key, { fromLocationId: e.target.value })}>
                    <option value="">— انتخاب —</option>
                    {lookups.locations
                      .filter((loc) => !warehouseId || loc.warehouseId === warehouseId)
                      .map((loc) => (
                        <option key={loc.id} value={loc.id}>{locLabel(loc.id)}</option>
                      ))}
                  </Select>
                </Field>
                <Field label="به موقعیت (هر انباری)" required>
                  <Select value={l.toLocationId} onChange={(e) => patchLine(l.key, { toLocationId: e.target.value })}>
                    <option value="">— انتخاب —</option>
                    {lookups.locations.map((loc) => (
                      <option key={loc.id} value={loc.id}>{locLabel(loc.id)}</option>
                    ))}
                  </Select>
                </Field>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="form-actions">
        <Button variant="ghost" onClick={() => submit(false)} disabled={busy} type="button">
          <Save size={16} /> ذخیره پیش‌نویس
        </Button>
        <Button onClick={() => submit(true)} disabled={busy} type="button">
          <Send size={16} /> ذخیره و قطع‌بوش
        </Button>
      </div>
    </Page>
  );
}

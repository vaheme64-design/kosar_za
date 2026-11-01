import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, Save, Send, ShieldCheck } from 'lucide-react';
import { api } from '../../lib/api';
import { useLookups } from '../../lib/lookups';
import { Page, Card, Field, TextInput, Select, Button, ErrorBanner, Loading, fa } from '../../components/ui';
import { SubNav } from '../../components/SubNav';

interface LineState {
  key: number;
  kind: 'MATERIAL' | 'PART';
  itemId: string;
  lotId: string;
  quantity: string; // منفی = کاهش
  locationId: string;
  qualityStatus: string;
}

let lineKey = 1;
const todayStr = () => new Date().toISOString().slice(0, 10);

const REASONS = ['OPENING_BALANCE', 'COUNT_CORRECTION', 'DAMAGE', 'LOSS', 'FOUND', 'OTHER'] as const;

export function AdjustmentFormPage() {
  const navigate = useNavigate();
  const { lookups, loading: lookupsLoading } = useLookups();

  const [warehouseId, setWarehouseId] = useState('');
  const [documentDate, setDocumentDate] = useState(todayStr());
  const [reasonCode, setReasonCode] = useState('COUNT_CORRECTION');
  const [reasonText, setReasonText] = useState('');
  const [lines, setLines] = useState<LineState[]>([
    { key: lineKey++, kind: 'MATERIAL', itemId: '', lotId: '', quantity: '', locationId: '', qualityStatus: 'APPROVED' },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const patchLine = useCallback((key: number, patch: Partial<LineState>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }, []);

  const addLine = () =>
    setLines((prev) => [...prev, { key: lineKey++, kind: 'MATERIAL', itemId: '', lotId: '', quantity: '', locationId: '', qualityStatus: 'APPROVED' }]);

  const removeLine = (key: number) => setLines((prev) => prev.filter((l) => l.key !== key));

  const submit = async (post: boolean) => {
    if (!warehouseId) return setError('انبار را انتخاب کنید');
    if (!reasonCode) return setError('علت اصلاحیه الزامی است');
    for (const [i, l] of lines.entries()) {
      if (!l.itemId) return setError(`ردیف ${i + 1}: قلم را انتخاب کنید`);
      if (!l.quantity || Number(l.quantity) === 0) return setError(`ردیف ${i + 1}: مقدار نمی‌تواند صفر باشد (منفی = کاهش)`);
      if (l.kind === 'MATERIAL' && !l.lotId) return setError(`ردیف ${i + 1}: برای ماده اولیه انتخاب لوت الزامی است`);
    }
    setError(null);
    setBusy(true);
    try {
      const res = await api<{ document: { id: string; documentNumber: string } }>('/inventory/documents', {
        method: 'POST',
        body: {
          documentType: 'ADJUSTMENT',
          documentDate,
          warehouseId,
          reasonCode,
          reasonText: reasonText || null,
          lines: lines.map((l) => ({
            ...(l.kind === 'MATERIAL' ? { materialId: l.itemId } : { partId: l.itemId }),
            ...(l.kind === 'MATERIAL' ? { lotId: l.lotId } : {}),
            quantity: l.quantity,
            locationId: l.locationId || null,
            ...(l.qualityStatus ? { qualityStatus: l.qualityStatus } : {}),
          })),
        },
      });
      if (post) {
        await api(`/inventory/documents/${res.document.id}/post`, { method: 'POST' });
      }
      navigate('/inventory/documents', {
        state: { notice: post ? `اصلاحیه ${res.document.documentNumber} قطع‌بوش شد` : `اصلاحیه ${res.document.documentNumber} پیش‌نویس شد` },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در ثبت اصلاحیه');
    } finally {
      setBusy(false);
    }
  };

  const releaseQuality = async () => {
    setError(null);
    setBusy(true);
    try {
      const lotId = lines[0]?.kind === 'MATERIAL' ? lines[0]?.lotId : '';
      if (!lotId) {
        setError('برای آزادسازی کیفیت، ابتدا در ردیف اول یک لوت انتخاب کنید');
        setBusy(false);
        return;
      }
      const lot = lookups.lots.find((l) => l.id === lotId);
      const res = await api<{ document: { documentNumber: string } }>('/inventory/quality/release', {
        method: 'POST',
        body: {
          lotId,
          warehouseId: lookups.warehouses.find((w) => w.id === warehouseId)?.id ?? warehouseId,
          ...(lines[0]?.locationId ? { locationId: lines[0].locationId } : {}),
          fromQualityStatus: lot?.status === 'BLOCKED' ? 'BLOCKED' : 'PENDING',
          quantity: lines[0]?.quantity || '0',
          notes: reasonText || null,
        },
      });
      navigate('/inventory/documents', { state: { notice: `آزادسازی کیفیت در سند ${res.document.documentNumber} ثبت شد` } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در آزادسازی کیفیت');
    } finally {
      setBusy(false);
    }
  };

  if (lookupsLoading) return <Loading label="در حال دریافت اطلاعات پایه…" />;

  return (
    <Page title="اصلاحیه انبار" subtitle="هر اصلاحیه دارای علت الزامی و رکورد حسابرسی است — مقدار منفی یعنی کاهش موجودی">
      <SubNav
        items={[
          { to: '/inventory', label: 'داشبورد' },
          { to: '/inventory/adjustments/new', label: 'اصلاحیه جدید' },
          { to: '/inventory/documents', label: 'سندها' },
        ]}
      />
      <ErrorBanner message={error} />

      <Card title="سربرگ اصلاحیه">
        <div className="form-grid">
          <Field label="انبار" required>
            <Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="">— انتخاب انبار —</option>
              {lookups.warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.code} — {w.nameFa}</option>
              ))}
            </Select>
          </Field>
          <Field label="تاریخ سند" required>
            <TextInput type="date" value={documentDate} onChange={(e) => setDocumentDate(e.target.value)} />
          </Field>
          <Field label="علت اصلاحیه" required>
            <Select value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
              {REASONS.map((r) => (
                <option key={r} value={r}>{fa(r)}</option>
              ))}
            </Select>
          </Field>
          <Field label="شرح علت">
            <TextInput value={reasonText} onChange={(e) => setReasonText(e.target.value)} placeholder="مثلاً کسری انبارشویی قفسه A" />
          </Field>
        </div>
      </Card>

      <Card
        title="ردیف‌های اصلاحیه"
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
                <Field label="مقدار (منفی = کاهش)" required>
                  <TextInput type="number" step="0.001" value={l.quantity} onChange={(e) => patchLine(l.key, { quantity: e.target.value })} />
                </Field>
                <Field label="موقعیت انبار">
                  <Select value={l.locationId} onChange={(e) => patchLine(l.key, { locationId: e.target.value })}>
                    <option value="">— کل انبار —</option>
                    {lookups.locations
                      .filter((loc) => !warehouseId || loc.warehouseId === warehouseId)
                      .map((loc) => (
                        <option key={loc.id} value={loc.id}>{loc.code} — {loc.nameFa}</option>
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
        <Button variant="warn" onClick={releaseQuality} disabled={busy} type="button" title="انتقال مقدار ردیف اول از وضعیت قرنطینه به تأییدشده">
          <ShieldCheck size={16} /> آزادسازی کیفیت لوت ردیف اول
        </Button>
      </div>
    </Page>
  );
}

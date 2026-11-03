import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, Save, Send } from 'lucide-react';
import { api } from '../../lib/api';
import { useLookups } from '../../lib/lookups';
import { QuickCreateButton } from '../../components/quickcreate/QuickCreate';
import { warehouseQuickCreate } from '../../lib/quickCreateSpecs';
import { Page, Card, Field, TextInput, Select, Button, ErrorBanner, Loading, Badge, faNumber } from '../../components/ui';
import { SubNav } from '../../components/SubNav';
import { AiSuggestBox } from '../../components/ai/AiSuggestBox';

interface LineState {
  key: number;
  kind: 'MATERIAL' | 'PART';
  itemId: string;
  lotId: string;
  quantity: string;
  fromLocationId: string;
  reservationId: string;
  docType: 'ISSUE' | 'PRODUCTION_ISSUE' | 'SCRAP_DISPOSAL';
}

interface MoOption {
  id: string;
  moNumber: string;
  partId: string;
  part: { partNumber: string; nameFa: string };
  status: string;
  quantity: string;
}

let lineKey = 1;
const todayStr = () => new Date().toISOString().slice(0, 10);

export function IssueFormPage() {
  const navigate = useNavigate();
  const { lookups, loading: lookupsLoading, reload } = useLookups();

  const [warehouseId, setWarehouseId] = useState('');
  const [documentDate, setDocumentDate] = useState(todayStr());
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState<LineState[]>([
    { key: lineKey++, kind: 'MATERIAL', itemId: '', lotId: '', quantity: '', fromLocationId: '', reservationId: '', docType: 'ISSUE' },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // مرجع اختیاری سند: دستور کار ساخت
  const [mos, setMos] = useState<MoOption[]>([]);
  const [mosLoading, setMosLoading] = useState(false);
  const [referenceId, setReferenceId] = useState('');

  useEffect(() => {
    let cancelled = false;
    setMosLoading(true);
    api<{ manufacturingOrders: MoOption[] }>('/production/mos?take=200')
      .then((res) => {
        if (!cancelled) setMos(res.manufacturingOrders);
      })
      .catch(() => {
        if (!cancelled) setMos([]); // the picker degrades to «— بدون دستور کار —»
      })
      .finally(() => {
        if (!cancelled) setMosLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const patchLine = useCallback((key: number, patch: Partial<LineState>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }, []);

  const addLine = () =>
    setLines((prev) => [...prev, { key: lineKey++, kind: 'MATERIAL', itemId: '', lotId: '', quantity: '', fromLocationId: '', reservationId: '', docType: 'ISSUE' }]);

  const removeLine = (key: number) => setLines((prev) => prev.filter((l) => l.key !== key));

  const materialLots = useMemo(() => new Map(lookups.lots.map((l) => [l.id, l])), [lookups.lots]);

  /** If exactly one part is chosen across PART lines, narrow the MO list to it. */
  const moOptions = useMemo(() => {
    const partIds = [...new Set(lines.filter((l) => l.kind === 'PART' && l.itemId).map((l) => l.itemId))];
    if (partIds.length !== 1) return mos;
    const pid = partIds[0];
    return mos.filter((m) => m.partId === pid);
  }, [mos, lines]);

  /** Draft for the AI document reviewer (advisory only — never posted). */
  const buildAiDraft = useCallback(
    () => ({
      documentType: 'ISSUE',
      documentDate,
      warehouseId,
      description: description || null,
      referenceType: referenceId ? 'MANUFACTURING_ORDER' : null,
      referenceId: referenceId || null,
      lines: lines.map((l) => ({
        documentType: l.docType,
        ...(l.kind === 'MATERIAL' ? { materialId: l.itemId } : { partId: l.itemId }),
        ...(l.kind === 'MATERIAL' ? { lotId: l.lotId } : {}),
        quantity: l.quantity,
        ...(l.fromLocationId ? { fromLocationId: l.fromLocationId } : {}),
        ...(l.reservationId ? { reservationId: l.reservationId } : {}),
      })),
    }),
    [documentDate, warehouseId, description, referenceId, lines],
  );

  const submit = async (post: boolean) => {
    if (!warehouseId) {
      setError('انبار را انتخاب کنید');
      return;
    }
    for (const [i, l] of lines.entries()) {
      if (!l.itemId) return setError(`ردیف ${i + 1}: قلم را انتخاب کنید`);
      if (!l.quantity || Number(l.quantity) <= 0) return setError(`ردیف ${i + 1}: مقدار نامعتبر است`);
      if (l.kind === 'MATERIAL' && !l.lotId) return setError(`ردیف ${i + 1}: برای ماده اولیه انتخاب لوت الزامی است`);
    }
    setError(null);
    setBusy(true);
    try {
      // سندها به‌تفکیک نوع ارسال می‌شوند (توسط سرگروه سربرگ یکسان‌اند)
      const byType = new Map<string, LineState[]>();
      for (const l of lines) {
        const arr = byType.get(l.docType) ?? [];
        arr.push(l);
        byType.set(l.docType, arr);
      }
      const numbers: string[] = [];
      for (const [docType, typeLines] of byType) {
        const res = await api<{ document: { id: string; documentNumber: string } }>('/inventory/documents', {
          method: 'POST',
          body: {
            documentType: docType,
            documentDate,
            warehouseId,
            description: description || null,
            ...(referenceId ? { referenceType: 'MANUFACTURING_ORDER', referenceId } : {}),
            lines: typeLines.map((l) => ({
              ...(l.kind === 'MATERIAL' ? { materialId: l.itemId } : { partId: l.itemId }),
              ...(l.kind === 'MATERIAL' ? { lotId: l.lotId } : {}),
              quantity: l.quantity,
              ...(l.fromLocationId ? { fromLocationId: l.fromLocationId } : {}),
              ...(l.reservationId ? { reservationId: l.reservationId } : {}),
            })),
          },
        });
        if (post) {
          await api(`/inventory/documents/${res.document.id}/post`, { method: 'POST' });
        }
        numbers.push(res.document.documentNumber);
      }
      navigate('/inventory/documents', {
        state: { notice: post ? `سند(های) ${numbers.join('، ')} قطع‌بوش شد` : `سند(های) ${numbers.join('، ')} پیش‌نویس شد` },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در ثبت حواله');
    } finally {
      setBusy(false);
    }
  };

  if (lookupsLoading) return <Loading label="در حال دریافت اطلاعات پایه…" />;

  return (
    <Page title="حواله انبار (خروج مواد / قطعات)" subtitle="برداشت از موجودی — موجودی منفی مجاز نیست؛ مواد باید از لوت مشخصی برداشت شوند">
      <SubNav
        items={[
          { to: '/inventory', label: 'داشبورد' },
          { to: '/inventory/issues/new', label: 'حواله جدید' },
          { to: '/inventory/lots', label: 'رول‌ها و لوت‌ها' },
          { to: '/inventory/documents', label: 'سندها' },
        ]}
      />
      <ErrorBanner message={error} />

      <Card title="سربرگ سند">
        <div className="form-grid">
          <Field label="انبار" required>
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
            <TextInput value={description} onChange={(e) => setDescription(e.target.value)} placeholder="مثلاً حواله تولید دستور کار …" />
          </Field>
          <Field
            label="مرجع: دستور کار (اختیاری)"
            hint={
              mosLoading
                ? 'در حال دریافت دستور کارها…'
                : moOptions.length !== mos.length
                  ? 'فهرست بر اساس قطعه‌ی ردیف‌ها محدود شده است'
                  : 'با انتخاب دستور کار، حواله به آن مرتبط می‌شود'
            }
          >
            <Select value={referenceId} onChange={(e) => setReferenceId(e.target.value)}>
              <option value="">— بدون دستور کار —</option>
              {moOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.moNumber} — {m.part.partNumber} ({m.part.nameFa})
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      <Card
        title="ردیف‌های حواله"
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
                <Field label="نوع حواله">
                  <Select value={l.docType} onChange={(e) => patchLine(l.key, { docType: e.target.value as LineState['docType'] })}>
                    <option value="ISSUE">حواله معمولی</option>
                    <option value="PRODUCTION_ISSUE">حواله به تولید</option>
                    <option value="SCRAP_DISPOSAL">اقامت ضایعات</option>
                  </Select>
                </Field>
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
                  <Field label="لوت" required hint="از لوت‌های دارای موجودی">
                    <Select value={l.lotId} onChange={(e) => patchLine(l.key, { lotId: e.target.value })}>
                      <option value="">— انتخاب لوت —</option>
                      {lookups.lots.filter((lot) => lot.materialId === l.itemId).map((lot) => (
                        <option key={lot.id} value={lot.id}>
                          {lot.lotNumber} — {faNumber(Math.round(Number(lot.weightRemainingKg) * 100) / 100)} kg ({lot.ownership === 'OWNED' ? 'مالی' : 'امانی'})
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                <Field label="مقدار" required>
                  <TextInput type="number" min="0" step="0.001" value={l.quantity} onChange={(e) => patchLine(l.key, { quantity: e.target.value })} />
                </Field>
                <Field label="موقعیت انبار (مبدأ)">
                  <Select value={l.fromLocationId} onChange={(e) => patchLine(l.key, { fromLocationId: e.target.value })}>
                    <option value="">— کل انبار —</option>
                    {lookups.locations
                      .filter((loc) => !warehouseId || loc.warehouseId === warehouseId)
                      .map((loc) => (
                        <option key={loc.id} value={loc.id}>{loc.code} — {loc.nameFa}</option>
                      ))}
                  </Select>
                </Field>
                <Field label="رزرو (اختیاری)" hint="در صورت انتخاب، رزرو مصرف می‌شود">
                  <Select value={l.reservationId} onChange={(e) => patchLine(l.key, { reservationId: e.target.value })}>
                    <option value="">— بدون رزرو —</option>
                    {l.itemId && <option disabled>رزروهای این قلم از صفحه رزروها قابل مشاهده است</option>}
                  </Select>
                </Field>
                <div className="line-summary">
                  {l.lotId && materialLots.get(l.lotId) && (
                    <span className="muted">
                      موجودی لوت: {faNumber(Math.round(Number(materialLots.get(l.lotId)!.weightRemainingKg) * 100) / 100)} kg
                    </span>
                  )}
                  {l.kind === 'MATERIAL' &&
                    l.lotId &&
                    (() => {
                      const lot = materialLots.get(l.lotId);
                      const m = lookups.materials.find((x) => x.id === l.itemId);
                      if (!lot || !m) return null;
                      if (m.materialType !== 'COIL' && m.materialType !== 'SHEET') return null;
                      if (!l.quantity || Number(l.quantity) <= 0) return null;
                      if (!m.unitWeightKg) {
                        return <Badge tone="muted">وزن مصرف از رول پس از قطع‌بوش محاسبه می‌شود (وزن واحد ماده ثبت نشده است)</Badge>;
                      }
                      const consumedKg = Number(l.quantity) * Number(m.unitWeightKg);
                      const remaining = Number(lot.weightRemainingKg) - consumedKg;
                      return (
                        <Badge tone={remaining < 0 ? 'danger' : 'info'}>
                          باقی‌مانده این رول پس از این مصرف: {faNumber(Math.round(remaining * 100) / 100)} کیلوگرم — باقی‌مانده به‌صورت رول ناقص در انبار می‌ماند
                        </Badge>
                      );
                    })()}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <AiSuggestBox documentType="ISSUE" buildDraft={() => buildAiDraft()} />

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

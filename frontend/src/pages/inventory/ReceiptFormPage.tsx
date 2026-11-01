import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, Save, Send } from 'lucide-react';
import { api } from '../../lib/api';
import { useLookups } from '../../lib/lookups';
import { faNumber } from '../../lib/jalali';
import { Page, Card, Field, TextInput, Select, Button, ErrorBanner, Loading, Badge, fa } from '../../components/ui';
import { SubNav } from '../../components/SubNav';

interface LineState {
  key: number;
  kind: 'MATERIAL' | 'PART';
  itemId: string;
  quantity: string;
  unitId: string;
  lotMode: 'NEW' | 'EXISTING';
  lotNumber: string;
  lotId: string;
  contractId: string;
  toLocationId: string;
  ownership: string;
  qualityStatus: string;
}

let lineKey = 1;
const todayStr = () => new Date().toISOString().slice(0, 10);

export function ReceiptFormPage() {
  const navigate = useNavigate();
  const { lookups, loading: lookupsLoading } = useLookups();

  const [warehouseId, setWarehouseId] = useState('');
  const [documentDate, setDocumentDate] = useState(todayStr());
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState<LineState[]>([
    { key: lineKey++, kind: 'MATERIAL', itemId: '', quantity: '', unitId: '', lotMode: 'NEW', lotNumber: '', lotId: '', contractId: '', toLocationId: '', ownership: '', qualityStatus: 'APPROVED' },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const unitById = useMemo(() => new Map(lookups.units.map((u) => [u.id, u])), [lookups.units]);

  const patchLine = useCallback((key: number, patch: Partial<LineState>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }, []);

  const addLine = () =>
    setLines((prev) => [
      ...prev,
      { key: lineKey++, kind: 'MATERIAL', itemId: '', quantity: '', unitId: '', lotMode: 'NEW', lotNumber: '', lotId: '', contractId: '', toLocationId: '', ownership: '', qualityStatus: 'APPROVED' },
    ]);

  const removeLine = (key: number) => setLines((prev) => prev.filter((l) => l.key !== key));

  const buildPayload = useCallback(() => {
    return {
      documentType: 'RECEIPT',
      documentDate,
      warehouseId,
      description: description || null,
      lines: lines.map((l) => ({
        ...(l.kind === 'MATERIAL' ? { materialId: l.itemId } : { partId: l.itemId }),
        quantity: l.quantity,
        ...(l.unitId ? { unitId: l.unitId } : {}),
        ...(l.kind === 'MATERIAL'
          ? l.lotMode === 'NEW'
            ? { lotNumber: l.lotNumber }
            : { lotId: l.lotId }
          : {}),
        ...(l.kind === 'MATERIAL' && l.contractId ? { contractId: l.contractId } : {}),
        ...(l.toLocationId ? { toLocationId: l.toLocationId } : {}),
        ...(l.ownership ? { ownership: l.ownership } : {}),
        ...(l.qualityStatus ? { qualityStatus: l.qualityStatus } : {}),
      })),
    };
  }, [documentDate, warehouseId, description, lines]);

  const validate = (): string | null => {
    if (!warehouseId) return 'انبار را انتخاب کنید';
    for (const [i, l] of lines.entries()) {
      if (!l.itemId) return `ردیف ${i + 1}: قلم را انتخاب کنید`;
      if (!l.quantity || Number(l.quantity) <= 0) return `ردیف ${i + 1}: مقدار باید بزرگ‌تر از صفر باشد`;
      if (l.kind === 'MATERIAL' && l.lotMode === 'NEW' && !l.lotNumber) return `ردیف ${i + 1}: شماره لوت را وارد کنید`;
      if (l.kind === 'MATERIAL' && l.lotMode === 'EXISTING' && !l.lotId) return `ردیف ${i + 1}: لوت را انتخاب کنید`;
    }
    return null;
  };

  const submit = async (post: boolean) => {
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ document: { id: string; documentNumber: string } }>('/inventory/documents', {
        method: 'POST',
        body: buildPayload(),
      });
      if (post) {
        await api(`/inventory/documents/${res.document.id}/post`, { method: 'POST' });
      }
      navigate('/inventory/documents', {
        state: { notice: post ? `سند ${res.document.documentNumber} قطع‌بوش شد` : `سند ${res.document.documentNumber} به‌صورت پیش‌نویس ذخیره شد` },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در ثبت سند');
    } finally {
      setBusy(false);
    }
  };

  if (lookupsLoading) return <Loading label="در حال دریافت اطلاعات پایه…" />;

  return (
    <Page title="رسید انبار (ورود مواد / قطعات)" subtitle="سند پیش‌نویس ساخته می‌شود و تنها پس از قطع‌بوش بر موجودی رسمی اثر می‌گذارد">
      <SubNav
        items={[
          { to: '/inventory', label: 'داشبورد' },
          { to: '/inventory/receipts/new', label: 'رسید جدید' },
          { to: '/inventory/documents', label: 'سندها' },
        ]}
      />
      <ErrorBanner message={error} />

      <Card title="سربرگ سند">
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
          <Field label="توضیحات">
            <TextInput value={description} onChange={(e) => setDescription(e.target.value)} placeholder="مثلاً رسید بار SAPCO شماره …" />
          </Field>
        </div>
      </Card>

      <Card
        title="ردیف‌های رسید"
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
                  <Select
                    value={l.kind}
                    onChange={(e) => patchLine(l.key, { kind: e.target.value as LineState['kind'], itemId: '', unitId: '', contractId: '' })}
                  >
                    <option value="MATERIAL">ماده اولیه</option>
                    <option value="PART">قطعه</option>
                  </Select>
                </Field>
                <Field label={l.kind === 'MATERIAL' ? 'ماده اولیه' : 'قطعه'} required>
                  <Select value={l.itemId} onChange={(e) => {
                    const id = e.target.value;
                    const item = l.kind === 'MATERIAL' ? lookups.materials.find((m) => m.id === id) : lookups.parts.find((p) => p.id === id);
                    patchLine(l.key, { itemId: id, unitId: item?.baseUnitId ?? '' });
                  }}>
                    <option value="">— انتخاب —</option>
                    {(l.kind === 'MATERIAL' ? lookups.materials : lookups.parts).map((item) => (
                      <option key={item.id} value={item.id}>
                        {l.kind === 'MATERIAL' ? (item as typeof lookups.materials[number]).materialCode : (item as typeof lookups.parts[number]).partNumber} — {item.nameFa}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="مقدار" required>
                  <TextInput type="number" min="0" step="0.001" value={l.quantity} onChange={(e) => patchLine(l.key, { quantity: e.target.value })} />
                </Field>
                <Field label="واحد" hint="پیش‌فرض: واحد پایه قلم">
                  <Select value={l.unitId} onChange={(e) => patchLine(l.key, { unitId: e.target.value })}>
                    <option value="">— واحد پایه —</option>
                    {lookups.units.map((u) => (
                      <option key={u.id} value={u.id}>{u.nameFa} ({u.code})</option>
                    ))}
                  </Select>
                </Field>
                {l.kind === 'MATERIAL' && (
                  <>
                    <Field label="لوت" required>
                      <div className="inline-controls">
                        <Select value={l.lotMode} onChange={(e) => patchLine(l.key, { lotMode: e.target.value as LineState['lotMode'] })}>
                          <option value="NEW">لوت جدید</option>
                          <option value="EXISTING">لوت موجود</option>
                        </Select>
                        {l.lotMode === 'NEW' ? (
                          <TextInput value={l.lotNumber} onChange={(e) => patchLine(l.key, { lotNumber: e.target.value })} placeholder="شماره لوت جدید" />
                        ) : (
                          <Select value={l.lotId} onChange={(e) => patchLine(l.key, { lotId: e.target.value })}>
                            <option value="">— انتخاب لوت —</option>
                            {lookups.lots.filter((lot) => lot.materialId === l.itemId).map((lot) => (
                              <option key={lot.id} value={lot.id}>
                                {lot.lotNumber} ({faNumber(Math.round(Number(lot.weightRemainingKg)))} kg {fa(lot.ownership)})
                              </option>
                            ))}
                          </Select>
                        )}
                      </div>
                    </Field>
                    <Field label="قرارداد SAPCO" hint="با انتخاب قرارداد، ورق به‌صورت امانی ثبت می‌شود">
                      <Select value={l.contractId} onChange={(e) => patchLine(l.key, { contractId: e.target.value, ownership: e.target.value ? 'SUPPLIER_CONSIGNMENT' : l.ownership })}>
                        <option value="">— بدون قرارداد —</option>
                        {lookups.contracts.filter((c) => c.materialId === l.itemId).map((c) => (
                          <option key={c.id} value={c.id}>{c.contractNumber} ({c.supplierName})</option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="مالکیت">
                      <Select value={l.ownership} onChange={(e) => patchLine(l.key, { ownership: e.target.value })}>
                        <option value="">— خودکار —</option>
                        <option value="OWNED">مالی (متعلق به کارخانه)</option>
                        <option value="SUPPLIER_CONSIGNMENT">امانی تأمین‌کننده</option>
                      </Select>
                    </Field>
                    <Field label="وضعیت کیفیت">
                      <Select value={l.qualityStatus} onChange={(e) => patchLine(l.key, { qualityStatus: e.target.value })}>
                        <option value="APPROVED">تأییدشده</option>
                        <option value="PENDING">در انتظار کنترل کیفیت</option>
                        <option value="BLOCKED">مسدود</option>
                      </Select>
                    </Field>
                  </>
                )}
                <Field label="موقعیت انبار (مقصد)">
                  <Select value={l.toLocationId} onChange={(e) => patchLine(l.key, { toLocationId: e.target.value })}>
                    <option value="">— کل انبار —</option>
                    {lookups.locations
                      .filter((loc) => !warehouseId || loc.warehouseId === warehouseId)
                      .map((loc) => (
                        <option key={loc.id} value={loc.id}>{loc.code} — {loc.nameFa}</option>
                      ))}
                  </Select>
                </Field>
                <div className="line-summary">
                  {l.itemId && l.quantity && (
                    <Badge tone="info">
                      {l.kind === 'MATERIAL' && (() => {
                        const m = lookups.materials.find((x) => x.id === l.itemId);
                        const u = unitById.get(l.unitId || m?.baseUnitId || '');
                        const kg = u?.kind === 'WEIGHT' ? Number(l.quantity) : m?.unitWeightKg ? Number(l.quantity) * Number(m.unitWeightKg) : null;
                        return kg != null ? `≈ ${faNumber(Math.round(kg * 100) / 100)} kg` : 'وزن دستی لازم است';
                      })()}
                      {l.kind === 'PART' && (() => {
                        const p = lookups.parts.find((x) => x.id === l.itemId);
                        return p?.standardWeightKg ? `≈ ${faNumber(Math.round(Number(l.quantity) * Number(p.standardWeightKg) * 100) / 100)} kg` : 'بدون وزن استاندارد';
                      })()}
                    </Badge>
                  )}
                </div>
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

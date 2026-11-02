import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FilePlus2, Plus, Trash2, Save, Send } from 'lucide-react';
import { api } from '../../lib/api';
import { useLookups } from '../../lib/lookups';
import { faNumber } from '../../lib/jalali';
import { Page, Card, Field, TextInput, Select, Button, ErrorBanner, Loading, Badge, Modal, fa } from '../../components/ui';
import { SubNav } from '../../components/SubNav';
import { AiSuggestBox } from '../../components/ai/AiSuggestBox';

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
  const { lookups, loading: lookupsLoading, reload } = useLookups();

  const [warehouseId, setWarehouseId] = useState('');
  const [documentDate, setDocumentDate] = useState(todayStr());
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState<LineState[]>([
    { key: lineKey++, kind: 'MATERIAL', itemId: '', quantity: '', unitId: '', lotMode: 'NEW', lotNumber: '', lotId: '', contractId: '', toLocationId: '', ownership: '', qualityStatus: 'APPROVED' },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // «قرارداد جدید (سریع)» modal — creates a contract without leaving the form
  const [contractModalFor, setContractModalFor] = useState<number | null>(null); // line key
  const [contractForm, setContractForm] = useState({ contractNumber: '', supplierName: 'SAPCO', materialId: '', orderDate: todayStr(), totalQuantity: '', totalWeightKg: '', description: '' });
  const [contractBusy, setContractBusy] = useState(false);
  const [contractError, setContractError] = useState<string | null>(null);

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

  // ------------------------------------------------------------- قرارداد جدید (سریع)
  /** Suggest a unique CT-YYYYMMDD-nn number from the contracts already loaded. */
  const suggestContractNumber = () => {
    const today = todayStr().replace(/-/g, '');
    let max = 0;
    for (const c of lookups.contracts) {
      const m = c.contractNumber.match(new RegExp(`^CT-${today}-(\\d+)$`));
      if (m) {
        const n = Number(m[1]);
        if (Number.isFinite(n) && n > max) max = n;
      }
    }
    return `CT-${today}-${String(max + 1).padStart(2, '0')}`;
  };

  const openContractModal = (line: LineState) => {
    setContractError(null);
    setContractForm({
      contractNumber: suggestContractNumber(),
      supplierName: 'SAPCO',
      materialId: line.kind === 'MATERIAL' ? line.itemId : '',
      orderDate: todayStr(),
      totalQuantity: line.quantity || '',
      totalWeightKg: '',
      description: '',
    });
    setContractModalFor(line.key);
  };

  const createContract = async () => {
    if (!contractForm.contractNumber.trim()) return setContractError('شماره قرارداد را وارد کنید');
    if (!contractForm.materialId) return setContractError('ماده اولیه قرارداد را انتخاب کنید');
    if (!contractForm.orderDate) return setContractError('تاریخ قرارداد را وارد کنید');
    if (!contractForm.totalQuantity || Number(contractForm.totalQuantity) <= 0) return setContractError('مقدار کل قرارداد باید بزرگ‌تر از صفر باشد');
    setContractBusy(true);
    setContractError(null);
    try {
      const res = await api<{ contract: { id: string; contractNumber: string } }>('/inventory/contracts', {
        method: 'POST',
        body: {
          contractNumber: contractForm.contractNumber.trim(),
          supplierName: contractForm.supplierName.trim() || 'SAPCO',
          materialId: contractForm.materialId,
          orderDate: contractForm.orderDate,
          totalQuantity: contractForm.totalQuantity,
          ...(contractForm.totalWeightKg ? { totalWeightKg: contractForm.totalWeightKg } : {}),
          ...(contractForm.description ? { description: contractForm.description } : {}),
        },
      });
      await reload(); // refresh the contract picker list
      if (contractModalFor != null) {
        patchLine(contractModalFor, { contractId: res.contract.id, ownership: 'SUPPLIER_CONSIGNMENT' });
      }
      setContractModalFor(null);
    } catch (err) {
      const faMsg = (err as { messageFa?: string }).messageFa;
      setContractError(faMsg ?? (err instanceof Error ? err.message : 'خطا در ایجاد قرارداد'));
    } finally {
      setContractBusy(false);
    }
  };

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
          { to: '/inventory/lots', label: 'رول‌ها و لوت‌ها' },
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
                    <Field label="قرارداد SAPCO" hint="با انتخاب قرارداد، ورق به‌صورت امانی ثبت می‌شود — اگر قرارداد ندارید همین‌جا بسازید">
                      <div className="inline-controls">
                        <Select value={l.contractId} onChange={(e) => patchLine(l.key, { contractId: e.target.value, ownership: e.target.value ? 'SUPPLIER_CONSIGNMENT' : l.ownership })}>
                          <option value="">— بدون قرارداد —</option>
                          {lookups.contracts.filter((c) => c.materialId === l.itemId).map((c) => (
                            <option key={c.id} value={c.id}>{c.contractNumber} ({c.supplierName})</option>
                          ))}
                        </Select>
                        <Button
                          variant="ghost"
                          onClick={() => openContractModal(l)}
                          disabled={!l.itemId}
                          title="قرارداد جدید (سریع) برای این ماده"
                          type="button"
                        >
                          <FilePlus2 size={14} /> قرارداد جدید
                        </Button>
                      </div>
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

      <AiSuggestBox documentType="RECEIPT" buildDraft={() => buildPayload()} />

      <div className="form-actions">
        <Button variant="ghost" onClick={() => submit(false)} disabled={busy} type="button">
          <Save size={16} /> ذخیره پیش‌نویس
        </Button>
        <Button onClick={() => submit(true)} disabled={busy} type="button">
          <Send size={16} /> ذخیره و قطع‌بوش
        </Button>
      </div>

      {contractModalFor != null && (
        <Modal title="قرارداد جدید (سریع)" onClose={() => setContractModalFor(null)}>
          <p className="kpi-note">
            قرارداد ماده اولیه بدون خروج از فرم رسید ساخته می‌شود و بلافاصله در همین ردیف انتخاب می‌گردد.
          </p>
          <ErrorBanner message={contractError} />
          <div className="form-grid form-grid--wide">
            <Field label="شماره قرارداد" required hint="شماره پیشنهادی را می‌توانید تغییر دهید">
              <TextInput dir="ltr" value={contractForm.contractNumber} onChange={(e) => setContractForm((f) => ({ ...f, contractNumber: e.target.value }))} />
            </Field>
            <Field label="تأمین‌کننده" hint="پیش‌فرض: SAPCO">
              <TextInput value={contractForm.supplierName} onChange={(e) => setContractForm((f) => ({ ...f, supplierName: e.target.value }))} />
            </Field>
            <Field label="ماده اولیه" required>
              <Select value={contractForm.materialId} onChange={(e) => setContractForm((f) => ({ ...f, materialId: e.target.value }))}>
                <option value="">— انتخاب ماده —</option>
                {lookups.materials.map((m) => (
                  <option key={m.id} value={m.id}>{m.materialCode} — {m.nameFa}</option>
                ))}
              </Select>
            </Field>
            <Field label="تاریخ قرارداد" required>
              <TextInput type="date" value={contractForm.orderDate} onChange={(e) => setContractForm((f) => ({ ...f, orderDate: e.target.value }))} />
            </Field>
            <Field label="مقدار کل" required>
              <TextInput type="number" min="0" step="0.001" value={contractForm.totalQuantity} onChange={(e) => setContractForm((f) => ({ ...f, totalQuantity: e.target.value }))} />
            </Field>
            <Field label="وزن کل (kg)" hint="در صورت داشتن وزن قراردادی">
              <TextInput type="number" min="0" step="0.001" value={contractForm.totalWeightKg} onChange={(e) => setContractForm((f) => ({ ...f, totalWeightKg: e.target.value }))} />
            </Field>
            <Field label="توضیحات">
              <TextInput value={contractForm.description} onChange={(e) => setContractForm((f) => ({ ...f, description: e.target.value }))} />
            </Field>
          </div>
          <div className="form-actions">
            <Button onClick={() => void createContract()} disabled={contractBusy} type="button">
              <Save size={15} /> {contractBusy ? 'در حال ایجاد…' : 'ایجاد و انتخاب قرارداد'}
            </Button>
            <Button variant="ghost" onClick={() => setContractModalFor(null)} disabled={contractBusy} type="button">
              انصراف
            </Button>
          </div>
        </Modal>
      )}
    </Page>
  );
}

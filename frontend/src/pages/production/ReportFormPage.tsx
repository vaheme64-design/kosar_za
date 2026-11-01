import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Trash2, Send } from 'lucide-react';
import { api } from '../../lib/api';
import { useLookups } from '../../lib/lookups';
import { Page, Card, Field, TextInput, Select, Button, ErrorBanner, Loading, fa } from '../../components/ui';
import { SubNav } from '../../components/SubNav';

interface ScrapRow {
  key: number;
  reason: string;
  quantity: string;
  weightKg: string;
  description: string;
}

interface OpRow {
  id: string;
  sequence: number;
  operation: { code: string; nameFa: string };
  moNumber: string;
  partNumber: string;
  received: number;
  input: number;
  rework: number;
  produced: number;
}

let scrapKey = 1;
const todayStr = () => new Date().toISOString().slice(0, 10);

export function ReportFormPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { lookups, loading: lookupsLoading } = useLookups();
  const [ops, setOps] = useState<OpRow[]>([]);
  const [operationId, setOperationId] = useState(params.get('operationId') ?? '');
  const [shiftId, setShiftId] = useState('');
  const [machineId, setMachineId] = useState('');
  const [reportDate, setReportDate] = useState(todayStr());
  const [inputQuantity, setInputQuantity] = useState('');
  const [producedQuantity, setProducedQuantity] = useState('');
  const [rejectedQuantity, setRejectedQuantity] = useState('0');
  const [reworkQuantity, setReworkQuantity] = useState('0');
  const [scraps, setScraps] = useState<ScrapRow[]>([{ key: scrapKey++, reason: 'SETUP_WASTE', quantity: '0', weightKg: '', description: '' }]);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadOps = useCallback(async () => {
    try {
      const mos = await api<{ manufacturingOrders: { id: string; moNumber: string; part: { partNumber: string }; status: string; operations: { id: string; sequence: number; operation: { code: string; nameFa: string }; receivedQuantity?: string; inputQuantity?: string; reworkQuantity?: string; producedQuantity?: string }[] }[] }>(
        '/production/mos?take=200',
      );
      const rows: OpRow[] = [];
      for (const mo of mos.manufacturingOrders) {
        if (!['RELEASED', 'IN_PROGRESS'].includes(mo.status)) continue;
        for (const op of mo.operations) {
          rows.push({
            id: op.id,
            sequence: op.sequence,
            operation: op.operation,
            moNumber: mo.moNumber,
            partNumber: mo.part.partNumber,
            received: Number((op as { receivedQuantity?: string }).receivedQuantity ?? 0),
            input: Number((op as { inputQuantity?: string }).inputQuantity ?? 0),
            rework: Number((op as { reworkQuantity?: string }).reworkQuantity ?? 0),
            produced: Number((op as { producedQuantity?: string }).producedQuantity ?? 0),
          });
        }
      }
      setOps(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در دریافت عملیات');
    }
  }, []);

  useEffect(() => {
    void loadOps();
  }, [loadOps]);

  const selectedOp = useMemo(() => ops.find((o) => o.id === operationId) ?? null, [ops, operationId]);

  const outputSum =
    Number(producedQuantity || 0) +
    Number(rejectedQuantity || 0) +
    Number(reworkQuantity || 0) +
    scraps.reduce((a, s) => a + Number(s.quantity || 0), 0);
  const balanced = outputSum === Number(inputQuantity || 0);

  const submit = async () => {
    if (!operationId) return setError('عملیات را انتخاب کنید');
    if (!inputQuantity || Number(inputQuantity) < 0) return setError('ورودی نامعتبر است');
    if (!balanced) {
      setError(`تساوی حفظ نشد: ورودی ${inputQuantity} ≠ تولید + مردود + بازکار + ضایعات = ${outputSum}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ report: { id: string; reportNumber: string } }>('/production/reports', {
        method: 'POST',
        body: {
          operationId,
          reportDate,
          inputQuantity,
          producedQuantity,
          rejectedQuantity: rejectedQuantity || '0',
          reworkQuantity: reworkQuantity || '0',
          ...(shiftId ? { shiftId } : {}),
          ...(machineId ? { machineId } : {}),
          scraps: scraps
            .filter((s) => Number(s.quantity) > 0)
            .map((s) => ({ reason: s.reason, quantity: s.quantity, ...(s.weightKg ? { weightKg: s.weightKg } : {}), ...(s.description ? { description: s.description } : {}) })),
          notes: notes || null,
        },
      });
      await api(`/production/reports/${res.report.id}/confirm`, { method: 'POST' });
      navigate('/production', { state: { notice: `گزارش ${res.report.reportNumber} ثبت و تأیید شد` } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در ثبت گزارش');
    } finally {
      setBusy(false);
    }
  };

  if (lookupsLoading) return <Loading />;

  return (
    <Page
      title="گزارش تولید"
      subtitle="ورودی = تولید سالم + مردود + بازکار + ضایعات (تساوی مقادیر الزامی است) — WIP به‌صورت خودکار جابه‌جا نمی‌شود"
    >
      <SubNav
        items={[
          { to: '/production', label: 'دستور کارها' },
          { to: '/production/transfers', label: 'انتقالات تولید' },
          { to: '/wip', label: 'داشبورد WIP' },
        ]}
      />
      <ErrorBanner message={error} />

      <Card title="اطلاعات گزارش">
        <div className="form-grid form-grid--wide">
          <Field label="عملیات" required hint="فقط عملیات دستور کارهای آزادشده/در جریان">
            <Select value={operationId} onChange={(e) => setOperationId(e.target.value)}>
              <option value="">— انتخاب عملیات —</option>
              {ops.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.moNumber} / مرحله {o.sequence} — {o.operation.nameFa} ({o.partNumber})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="تاریخ گزارش" required>
            <TextInput type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} />
          </Field>
          <Field label="شیفت">
            <Select value={shiftId} onChange={(e) => setShiftId(e.target.value)}>
              <option value="">— بدون شیفت —</option>
              {lookups.shifts.map((s) => (
                <option key={s.id} value={s.id}>{s.nameFa}</option>
              ))}
            </Select>
          </Field>
          <Field label="ماشین">
            <Select value={machineId} onChange={(e) => setMachineId(e.target.value)}>
              <option value="">— بدون ماشین —</option>
              {lookups.machines.map((m) => (
                <option key={m.id} value={m.id}>{m.code} — {m.nameFa}</option>
              ))}
            </Select>
          </Field>
        </div>
        {selectedOp && (
          <div className="op-hint">
            WIP عملیات: دریافتی {selectedOp.received} + بازکار {selectedOp.rework} − ورودی قبلی {selectedOp.input} ={' '}
            <b>{Math.round((selectedOp.received + selectedOp.rework - selectedOp.input) * 100) / 100}</b> قابل تغذیه
          </div>
        )}
      </Card>

      <Card title="مقادیر تولید">
        <div className="form-grid form-grid--wide">
          <Field label="ورودی (خوراک ماشین)" required>
            <TextInput type="number" min="0" step="1" value={inputQuantity} onChange={(e) => setInputQuantity(e.target.value)} />
          </Field>
          <Field label="تولید سالم" required>
            <TextInput type="number" min="0" step="1" value={producedQuantity} onChange={(e) => setProducedQuantity(e.target.value)} />
          </Field>
          <Field label="مردود (غیرقابل بازیابی)">
            <TextInput type="number" min="0" step="1" value={rejectedQuantity} onChange={(e) => setRejectedQuantity(e.target.value)} />
          </Field>
          <Field label="بازکار (قابل تغییر مجدد)">
            <TextInput type="number" min="0" step="1" value={reworkQuantity} onChange={(e) => setReworkQuantity(e.target.value)} />
          </Field>
        </div>

        <h4 className="modal-section-title">ضایعات (با علت)</h4>
        {scraps.map((s, i) => (
          <div className="form-grid form-grid--wide scrap-row" key={s.key}>
            <Field label={`علت ضایعات ${i + 1}`}>
              <Select value={s.reason} onChange={(e) => setScraps((prev) => prev.map((x) => (x.key === s.key ? { ...x, reason: e.target.value } : x)))}>
                {['SETUP_WASTE', 'MATERIAL_DEFECT', 'DIE_DEFECT', 'MACHINE_FAULT', 'OPERATOR_ERROR', 'QUALITY_REJECT', 'OTHER'].map((r) => (
                  <option key={r} value={r}>{fa(r)}</option>
                ))}
              </Select>
            </Field>
            <Field label="مقدار">
              <TextInput type="number" min="0" step="1" value={s.quantity} onChange={(e) => setScraps((prev) => prev.map((x) => (x.key === s.key ? { ...x, quantity: e.target.value } : x)))} />
            </Field>
            <Field label="وزن (kg) — اختیاری">
              <TextInput type="number" min="0" step="0.001" value={s.weightKg} onChange={(e) => setScraps((prev) => prev.map((x) => (x.key === s.key ? { ...x, weightKg: e.target.value } : x)))} />
            </Field>
            <Field label="شرح">
              <TextInput value={s.description} onChange={(e) => setScraps((prev) => prev.map((x) => (x.key === s.key ? { ...x, description: e.target.value } : x)))} />
            </Field>
            <div className="form-grid__action">
              {scraps.length > 1 && (
                <Button variant="danger" onClick={() => setScraps((prev) => prev.filter((x) => x.key !== s.key))} type="button">
                  <Trash2 size={14} />
                </Button>
              )}
            </div>
          </div>
        ))}
        <Button variant="ghost" onClick={() => setScraps((prev) => [...prev, { key: scrapKey++, reason: 'OTHER', quantity: '0', weightKg: '', description: '' }])} type="button">
          <Plus size={15} /> ردیف ضایعات
        </Button>

        <div className={`balance-check ${balanced ? 'balance-check--ok' : 'balance-check--bad'}`}>
          تساوی: ورودی {inputQuantity || 0} = تولید + مردود + بازکار + ضایعات = {outputSum} {balanced ? '✓' : '✗'}
        </div>
      </Card>

      <div className="form-grid">
        <Field label="یادداشت">
          <TextInput value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>

      <div className="form-actions">
        <Button onClick={() => void submit()} disabled={busy || !balanced} type="button">
          <Send size={16} /> ثبت و تأیید گزارش
        </Button>
      </div>
    </Page>
  );
}

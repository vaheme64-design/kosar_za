import { useCallback, useEffect, useState } from 'react';
import { Truck, RefreshCw } from 'lucide-react';
import { api } from '../../lib/api';
import { useLookups } from '../../lib/lookups';
import { Page, Card, Field, Select, TextInput, Button, Table, EmptyState, Loading, ErrorBanner, Badge, Qty, fa } from '../../components/ui';

interface AccountRow {
  materialId: string;
  materialCode: string;
  materialName: string;
  grade: string | null;
  thicknessMm: string | null;
  openingKg: string;
  receivedKg: string;
  ownedReceivedKg: string;
  consignmentReceivedKg: string;
  consumedKg: string;
  closingKg: string;
  contractMovements: {
    id: string;
    contractNumber: string;
    contractStatus: string;
    receivedDate: string;
    quantity: string;
    weightKg: string | null;
    isReversal: boolean;
    notes: string | null;
  }[];
}

interface ContractRow {
  id: string;
  contractNumber: string;
  supplierName: string;
  material: { materialCode: string; nameFa: string; baseUnit: { code: string } };
  orderDate: string;
  totalQuantity: string;
  totalWeightKg: string | null;
  receivedQuantity: string;
  receivedWeightKg: string;
  status: string;
}

export function SapcoMaterialsPage() {
  const { lookups } = useLookups();
  const [materialId, setMaterialId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [account, setAccount] = useState<AccountRow[]>([]);
  const [contracts, setContracts] = useState<ContractRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (materialId) params.set('materialId', materialId);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const [acc, con] = await Promise.all([
        api<{ account: AccountRow[] }>(`/inventory/sapco/account?${params.toString()}`),
        api<{ contracts: ContractRow[] }>('/inventory/contracts'),
      ]);
      setAccount(acc.account);
      setContracts(con.contracts);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در دریافت گزارش SAPCO');
    } finally {
      setLoading(false);
    }
  }, [materialId, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Page
      title="گزارش حساب مواد SAPCO"
      subtitle="افتتاحیه، دریافت، مصرف و پایان دوره به کیلوگرم — جداسازی ورق امانی تأمین‌کننده و دفتر کل قراردادها"
    >
      <Card title="دوره گزارش">
        <div className="form-grid">
          <Field label="ماده اولیه">
            <Select value={materialId} onChange={(e) => setMaterialId(e.target.value)}>
              <option value="">— همه مواد SAPCO —</option>
              {lookups.materials.filter((m) => m.supplierName === 'SAPCO').map((m) => (
                <option key={m.id} value={m.id}>{m.materialCode} — {m.nameFa}</option>
              ))}
            </Select>
          </Field>
          <Field label="از تاریخ">
            <TextInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="تا تاریخ">
            <TextInput type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <div className="form-grid__action">
            <Button onClick={() => void load()} disabled={loading} type="button">
              <RefreshCw size={16} /> به‌روزرسانی
            </Button>
          </div>
        </div>
      </Card>

      <ErrorBanner message={error} />
      {loading && <Loading />}

      {!loading && account.length === 0 && (
        <EmptyState icon={<Truck size={28} />} title="ماده اولیه SAPCO یافت نشد" />
      )}

      {account.length > 0 && (
        <Card title="حساب موجودی ورق (کیلوگرم)">
          <Table head={['ماده اولیه', 'گرید / ضخامت', 'افتتاحیه (kg)', 'دریافت (kg)', 'دریافت مالی', 'دریافت امانی', 'مصرف (kg)', 'پایان دوره (kg)']}>
            {account.map((r) => (
              <tr key={r.materialId}>
                <td>
                  <strong>{r.materialCode}</strong>
                  <div className="muted">{r.materialName}</div>
                </td>
                <td className="muted">{[r.grade, r.thicknessMm ? `t=${r.thicknessMm}` : null].filter(Boolean).join(' / ') || '—'}</td>
                <td><Qty value={r.openingKg} unit="kg" /></td>
                <td><Qty value={r.receivedKg} unit="kg" /></td>
                <td><Qty value={r.ownedReceivedKg} unit="kg" /></td>
                <td><Qty value={r.consignmentReceivedKg} unit="kg" /></td>
                <td><Qty value={r.consumedKg} unit="kg" /></td>
                <td><strong><Qty value={r.closingKg} unit="kg" /></strong></td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      {account.some((r) => r.contractMovements.length > 0) && (
        <Card title="دفتر کل حرکت قراردادها">
          <Table head={['قرارداد', 'ماده اولیه', 'تاریخ دریافت', 'مقدار', 'وزن (kg)', 'نوع', 'یادداشت']} dense>
            {account.flatMap((r) =>
              r.contractMovements.map((m) => (
                <tr key={m.id} className={m.isReversal ? 'row--reversal' : ''}>
                  <td>
                    {m.contractNumber}{' '}
                    <Badge tone={m.contractStatus === 'COMPLETED' ? 'ok' : m.contractStatus === 'PARTIALLY_RECEIVED' ? 'info' : 'muted'}>
                      {fa(m.contractStatus)}
                    </Badge>
                  </td>
                  <td>{r.materialCode}</td>
                  <td className="muted">{new Date(m.receivedDate).toLocaleDateString('fa-IR')}</td>
                  <td><Qty value={m.quantity} /></td>
                  <td><Qty value={m.weightKg} unit="kg" /></td>
                  <td>{m.isReversal ? <Badge tone="danger">ابطال</Badge> : <Badge tone="ok">دریافت</Badge>}</td>
                  <td className="muted">{m.notes ?? '—'}</td>
                </tr>
              )),
            )}
          </Table>
        </Card>
      )}

      {contracts.length > 0 && (
        <Card title="قراردادهای خرید ماده اولیه">
          <Table head={['شماره قرارداد', 'تأمین‌کننده', 'ماده اولیه', 'تاریخ سفارش', 'مقدار کل', 'وزن کل (kg)', 'دریافت‌شده', 'وزن دریافتی (kg)', 'وضعیت']}>
            {contracts.map((c) => (
              <tr key={c.id}>
                <td><strong>{c.contractNumber}</strong></td>
                <td>{c.supplierName}</td>
                <td>{c.material.materialCode}</td>
                <td className="muted">{new Date(c.orderDate).toLocaleDateString('fa-IR')}</td>
                <td><Qty value={c.totalQuantity} unit={c.material.baseUnit.code} /></td>
                <td><Qty value={c.totalWeightKg} unit="kg" /></td>
                <td><Qty value={c.receivedQuantity} /></td>
                <td><Qty value={c.receivedWeightKg} unit="kg" /></td>
                <td>
                  <Badge tone={c.status === 'COMPLETED' ? 'ok' : c.status === 'PARTIALLY_RECEIVED' ? 'info' : 'muted'}>{fa(c.status)}</Badge>
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </Page>
  );
}

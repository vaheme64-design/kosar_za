import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { FileText, Send, Undo2, XCircle } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { Page, Card, Modal, Table, EmptyState, Loading, ErrorBanner, SuccessBanner, Badge, Button, Qty, fa } from '../../components/ui';
import { SubNav } from '../../components/SubNav';

interface DocRow {
  id: string;
  documentNumber: string;
  documentType: string;
  status: string;
  postingStatus: string;
  documentDate: string;
  description: string | null;
  reasonCode: string | null;
  reasonText: string | null;
  warehouse: { code: string; nameFa: string };
  createdBy: { fullName: string } | null;
  reversalOfId: string | null;
  _count?: { lines: number };
}

interface DocDetail {
  document: DocRow & {
    postedBy: { fullName: string } | null;
    reversalOf?: { documentNumber: string } | null;
    reversals: { id: string; documentNumber: string }[];
    lines: {
      id: number | string;
      lineNo: number;
      part?: { partNumber: string; nameFa: string } | null;
      material?: { materialCode: string; nameFa: string } | null;
      lot?: { lotNumber: string } | null;
      quantity: string;
      unit: { code: string };
      weightKg: string | null;
      fromLocation?: { code: string } | null;
      toLocation?: { code: string } | null;
      contract?: { contractNumber: string } | null;
      transactions: { transactionNumber: string; type: string }[];
    }[];
  };
}

export function DocumentsPage() {
  const { can } = useAuth();
  const location = useLocation() as { state?: { notice?: string } };
  const [rows, setRows] = useState<DocRow[]>([]);
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(location.state?.notice ?? null);
  const [detail, setDetail] = useState<DocDetail | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (typeFilter) params.set('documentType', typeFilter);
      if (statusFilter) params.set('postingStatus', statusFilter);
      const res = await api<{ documents: DocRow[] }>(`/inventory/documents?${params.toString()}`);
      setRows(res.documents);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در دریافت سندها');
    } finally {
      setLoading(false);
    }
  }, [typeFilter, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = async (id: string) => {
    setError(null);
    try {
      const res = await api<DocDetail>(`/inventory/documents/${id}`);
      setDetail(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در دریافت جزئیات سند');
    }
  };

  const act = async (id: string, action: 'post' | 'reverse' | 'cancel') => {
    setBusy(true);
    setError(null);
    try {
      if (action === 'post') {
        await api(`/inventory/documents/${id}/post`, { method: 'POST' });
        setNotice('سند قطع‌بوش شد');
      } else if (action === 'reverse') {
        const reason = window.prompt('علت ابطال سند (الزامی):');
        if (!reason || reason.trim().length < 3) {
          setBusy(false);
          return;
        }
        await api(`/inventory/documents/${id}/reverse`, { method: 'POST', body: { reason } });
        setNotice('سند ابطال و موجودی‌ها اصلاح شد');
      } else {
        await api(`/inventory/documents/${id}/cancel`, { method: 'POST' });
        setNotice('سند پیش‌نویس ابطال شد');
      }
      setDetail(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در انجام عملیات');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page title="سندهای انبار" subtitle="سندهای قطع‌بوش‌شده تغییرناپذیرند؛ اصلاح فقط با سند ابطالی ممکن است">
      <SubNav
        items={[
          { to: '/inventory', label: 'داشبورد' },
          { to: '/inventory/documents', label: 'سندها' },
          { to: '/inventory/lots', label: 'رول‌ها و لوت‌ها' },
          { to: '/inventory/movements', label: 'دفتر کل حرکت' },
        ]}
      />
      <SuccessBanner message={notice} />
      <ErrorBanner message={error} />

      <Card title="فیلتر سندها">
        <div className="form-grid">
          <select className="input input--select" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="نوع سند">
            <option value="">همه انواع</option>
            {['RECEIPT', 'ISSUE', 'TRANSFER', 'ADJUSTMENT', 'PRODUCTION_RECEIPT', 'PRODUCTION_ISSUE', 'SCRAP_DISPOSAL'].map((t) => (
              <option key={t} value={t}>{fa(t)}</option>
            ))}
          </select>
          <select className="input input--select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="وضعیت قطع‌بوش">
            <option value="">همه وضعیت‌ها</option>
            {['UNPOSTED', 'POSTED', 'REVERSED'].map((t) => (
              <option key={t} value={t}>{fa(t)}</option>
            ))}
          </select>
        </div>
      </Card>

      {loading && <Loading />}
      {!loading && rows.length === 0 && <EmptyState icon={<FileText size={28} />} title="سندی یافت نشد" />}

      {rows.length > 0 && (
        <Card title={`${rows.length} سند`}>
          <Table head={['شماره سند', 'نوع', 'انبار', 'تاریخ', 'وضعیت', 'قطع‌بوش', 'علت', 'سازنده', '']}>
            {rows.map((d) => (
              <tr key={d.id}>
                <td><button className="link-btn" onClick={() => void openDetail(d.id)}>{d.documentNumber}</button></td>
                <td>{d.reversalOfId ? 'ابطال' : fa(d.documentType)}</td>
                <td>{d.warehouse.nameFa}</td>
                <td className="muted">{new Date(d.documentDate).toLocaleDateString('fa-IR')}</td>
                <td><Badge tone={d.status === 'CANCELLED' ? 'danger' : d.status === 'CONFIRMED' ? 'ok' : 'muted'}>{fa(d.status)}</Badge></td>
                <td><Badge tone={d.postingStatus === 'POSTED' ? 'ok' : d.postingStatus === 'REVERSED' ? 'danger' : 'warn'}>{fa(d.postingStatus)}</Badge></td>
                <td className="muted">{d.reasonCode ? `${fa(d.reasonCode)}${d.reasonText ? ` — ${d.reasonText}` : ''}` : '—'}</td>
                <td>{d.createdBy?.fullName ?? '—'}</td>
                <td>
                  {d.postingStatus === 'UNPOSTED' && d.status !== 'CANCELLED' && (
                    <div className="row-actions">
                      {can('inventory.post') && (
                        <button className="btn btn--sm" onClick={() => void act(d.id, 'post')} disabled={busy} title="قطع‌بوش">
                          <Send size={13} /> قطع‌بوش
                        </button>
                      )}
                      {can('inventory.manage') && (
                        <button className="btn btn--sm btn--danger" onClick={() => void act(d.id, 'cancel')} disabled={busy} title="ابطال پیش‌نویس">
                          <XCircle size={13} /> ابطال
                        </button>
                      )}
                    </div>
                  )}
                  {d.postingStatus === 'POSTED' && can('inventory.post') && (
                    <button className="btn btn--sm btn--warn" onClick={() => void act(d.id, 'reverse')} disabled={busy} title="سند ابطالی">
                      <Undo2 size={13} /> ابطالی
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      {detail && (
        <Modal title={`سند ${detail.document.documentNumber}`} onClose={() => setDetail(null)} wide>
          <div className="detail-grid">
            <div><span className="muted">نوع:</span> {fa(detail.document.documentType)}</div>
            <div><span className="muted">انبار:</span> {detail.document.warehouse.nameFa}</div>
            <div><span className="muted">تاریخ:</span> {new Date(detail.document.documentDate).toLocaleDateString('fa-IR')}</div>
            <div><span className="muted">وضعیت:</span> {fa(detail.document.status)} / {fa(detail.document.postingStatus)}</div>
            {detail.document.reasonCode && (
              <div><span className="muted">علت:</span> {fa(detail.document.reasonCode)} {detail.document.reasonText}</div>
            )}
            {detail.document.description && <div className="span-2"><span className="muted">توضیحات:</span> {detail.document.description}</div>}
            {detail.document.reversalOf && <div><span className="muted">ابطال سند:</span> {detail.document.reversalOf.documentNumber}</div>}
          </div>

          <h4 className="modal-section-title">ردیف‌ها</h4>
          <Table head={['#', 'قلم', 'لوت', 'مقدار', 'وزن (kg)', 'مبدأ', 'مقصد', 'قرارداد', 'تراکنش‌ها']} dense>
            {detail.document.lines.map((l) => (
              <tr key={l.id}>
                <td>{l.lineNo}</td>
                <td>{l.part ? `${l.part.partNumber} — ${l.part.nameFa}` : l.material ? `${l.material.materialCode} — ${l.material.nameFa}` : '—'}</td>
                <td>{l.lot?.lotNumber ?? '—'}</td>
                <td><Qty value={l.quantity} unit={l.unit.code} /></td>
                <td><Qty value={l.weightKg} unit="kg" /></td>
                <td>{l.fromLocation?.code ?? '—'}</td>
                <td>{l.toLocation?.code ?? '—'}</td>
                <td>{l.contract?.contractNumber ?? '—'}</td>
                <td className="muted">{l.transactions.map((t) => t.transactionNumber).join('، ') || '—'}</td>
              </tr>
            ))}
          </Table>

          <div className="form-actions">
            {detail.document.postingStatus === 'UNPOSTED' && detail.document.status !== 'CANCELLED' && (
              <>
                {can('inventory.post') && (
                  <Button onClick={() => void act(detail.document.id, 'post')} disabled={busy} type="button">
                    <Send size={15} /> قطع‌بوش سند
                  </Button>
                )}
                {can('inventory.manage') && (
                  <Button variant="danger" onClick={() => void act(detail.document.id, 'cancel')} disabled={busy} type="button">
                    <XCircle size={15} /> ابطال پیش‌نویس
                  </Button>
                )}
              </>
            )}
            {detail.document.postingStatus === 'POSTED' && can('inventory.post') && (
              <Button variant="warn" onClick={() => void act(detail.document.id, 'reverse')} disabled={busy} type="button">
                <Undo2 size={15} /> ثبت سند ابطالی
              </Button>
            )}
          </div>
        </Modal>
      )}
    </Page>
  );
}

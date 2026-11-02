import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { Badge, Button, Card, ErrorBanner, Loading, Page, SuccessBanner, Table, TextInput } from '../../components/ui';

/* eslint-disable @typescript-eslint/no-explicit-any */

export function SequencesPage() {
  const { can } = useAuth();
  const canManage = can('settings.manage');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, any>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<{ sequences: any[] }>('/settings/sequences');
      setRows(res.sequences);
      setDrafts({});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در دریافت دنباله‌ها');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (row: any) => {
    const draft = drafts[row.id] ?? {};
    setBusyId(row.id);
    setError(null);
    try {
      await api(`/settings/sequences/${row.id}`, {
        method: 'PUT',
        body: {
          ...(draft.prefix !== undefined ? { prefix: draft.prefix } : {}),
          ...(draft.padLength !== undefined ? { padLength: Number(draft.padLength) } : {}),
        },
      });
      setNotice(`دنباله «${row.key}» ذخیره شد — شماره بعدی: ${row.nextNumber}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در ذخیره');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Page
      title="شماره‌گذاری اسناد"
      subtitle="پیشوند و طول شماره هر نوع سند — شماره‌گذاری یکتا و خودکار است؛ شماره بعدی فقط جلو می‌رود"
    >
      {error && <ErrorBanner message={error} />}
      {notice && <SuccessBanner message={notice} />}
      <Card>
        {loading ? (
          <Loading />
        ) : (
          <Table head={['کلید', 'عنوان', 'پیشوند', 'شماره بعدی', 'طول (رقم)', '']} dense>
            {rows.map((row) => {
              const draft = drafts[row.id] ?? {};
              const prefix = draft.prefix ?? row.prefix;
              const padLength = draft.padLength ?? row.padLength;
              return (
                <tr key={row.id}>
                  <td dir="ltr">
                    <b>{row.key}</b>
                  </td>
                  <td>{row.title ?? '—'}</td>
                  <td>
                    {canManage ? (
                      <TextInput
                        dir="ltr"
                        style={{ maxWidth: 110 }}
                        value={prefix}
                        onChange={(e) => setDrafts((d) => ({ ...d, [row.id]: { ...draft, prefix: e.target.value } }))}
                      />
                    ) : (
                      <span dir="ltr">{row.prefix}</span>
                    )}
                  </td>
                  <td dir="ltr">
                    <Badge tone="info">
                      {prefix}
                      {String(row.nextNumber).padStart(padLength, '0')}
                    </Badge>
                  </td>
                  <td>
                    {canManage ? (
                      <TextInput
                        type="number"
                        dir="ltr"
                        style={{ maxWidth: 80 }}
                        min={2}
                        max={12}
                        value={padLength}
                        onChange={(e) => setDrafts((d) => ({ ...d, [row.id]: { ...draft, padLength: e.target.value } }))}
                      />
                    ) : (
                      row.padLength
                    )}
                  </td>
                  <td>
                    {canManage && (draft.prefix !== undefined || draft.padLength !== undefined) && (
                      <Button onClick={() => save(row)} disabled={busyId === row.id}>
                        ذخیره
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
    </Page>
  );
}

export function SystemSettingsPage() {
  const { can } = useAuth();
  const canManage = can('settings.manage');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<{ settings: any[] }>('/settings/system');
      setRows(res.settings);
      setDrafts({});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در دریافت تنظیمات');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (row: any) => {
    setError(null);
    try {
      await api(`/settings/system/${row.id}`, { method: 'PUT', body: { value: drafts[row.id] ?? row.value } });
      setNotice(`تنظیم «${row.key}» ذخیره شد`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در ذخیره تنظیم');
    }
  };

  return (
    <Page title="تنظیمات سامانه" subtitle="پیکربندی کلی سامانه — مقادیر محرمانه نمایش داده نمی‌شوند">
      {error && <ErrorBanner message={error} />}
      {notice && <SuccessBanner message={notice} />}
      <Card>
        {loading ? (
          <Loading />
        ) : rows.length === 0 ? (
          <p className="kpi-note">تنظیمی ثبت نشده است.</p>
        ) : (
          <Table head={['کلید', 'مقدار', 'نوع', 'توضیح', '']} dense>
            {rows.map((row) => (
              <tr key={row.id}>
                <td dir="ltr">
                  <b>{row.key}</b>
                </td>
                <td>
                  {canManage && !row.isSecret ? (
                    <TextInput
                      dir="ltr"
                      value={drafts[row.id] ?? row.value}
                      onChange={(e) => setDrafts((d) => ({ ...d, [row.id]: e.target.value }))}
                    />
                  ) : (
                    <span dir="ltr">{row.value}</span>
                  )}
                </td>
                <td>{row.valueType}</td>
                <td>{row.description ?? '—'}</td>
                <td>
                  {canManage && !row.isSecret && drafts[row.id] !== undefined && drafts[row.id] !== row.value && (
                    <Button onClick={() => save(row)}>ذخیره</Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </Page>
  );
}

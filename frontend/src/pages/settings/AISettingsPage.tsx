import { useCallback, useEffect, useState } from 'react';
import { PlugZap, RefreshCw, Save, Sparkles } from 'lucide-react';
import { api } from '../../lib/api';
import { getAiStatus, type AiStatus } from '../../lib/ai';
import { useAuth } from '../../context/AuthContext';
import { faNumber } from '../../lib/jalali';
import { Badge, Button, Card, ErrorBanner, Field, Loading, Page, Select, SuccessBanner, TextInput } from '../../components/ui';
import { SubNav } from '../../components/SubNav';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * پیکربندی دستیار هوش مصنوعی — مقادیر از طریق همان تنظیمات سامانه
 * (GET/POST/PUT /settings/system) به‌صورت get-or-create برای هر کلید ذخیره می‌شوند.
 */

interface SettingRow {
  id: string;
  key: string;
  value: string;
  valueType: string;
  description: string | null;
  isSecret: boolean;
}

interface AiFieldDef {
  key: string;
  labelFa: string;
  descriptionFa: string;
  valueType: 'STRING' | 'NUMBER' | 'BOOLEAN';
  kind: 'text' | 'number' | 'select';
  options?: { value: string; label: string }[];
  placeholder?: string;
  isSecret?: boolean;
  /** secrets are stored masked — empty input means «keep as is» */
  keepIfEmpty?: boolean;
}

const AI_FIELDS: AiFieldDef[] = [
  {
    key: 'ai.enabled',
    labelFa: 'فعال‌سازی دستیار',
    descriptionFa: 'فعال/غیرفعال بودن کل قابلیت‌های هوش مصنوعی',
    valueType: 'BOOLEAN',
    kind: 'select',
    options: [
      { value: 'true', label: 'فعال' },
      { value: 'false', label: 'غیرفعال' },
    ],
  },
  {
    key: 'ai.provider',
    labelFa: 'سرویس‌دهنده',
    descriptionFa: 'Ollama محلی یا هر سرویس سازگار با OpenAI',
    valueType: 'STRING',
    kind: 'select',
    options: [
      { value: 'ollama', label: 'Ollama (محلی و رایگان)' },
      { value: 'openai-compatible', label: 'سرویس سازگار با OpenAI' },
    ],
  },
  {
    key: 'ai.baseUrl',
    labelFa: 'آدرس پایه (Base URL)',
    descriptionFa: 'آدرس سرویس مدل — پیش‌فرض Ollama محلی',
    valueType: 'STRING',
    kind: 'text',
    placeholder: 'http://127.0.0.1:11434/v1',
  },
  {
    key: 'ai.model',
    labelFa: 'نام مدل',
    descriptionFa: 'مثلاً qwen2.5:7b برای Ollama محلی',
    valueType: 'STRING',
    kind: 'text',
    placeholder: 'qwen2.5:7b',
  },
  {
    key: 'ai.apiKey',
    labelFa: 'کلید API (محرمانه)',
    descriptionFa: 'فقط برای سرویس‌های خارجی — برای Ollama خالی بماند؛ برای حفظ مقدار فعلی خالی بگذارید',
    valueType: 'STRING',
    kind: 'text',
    isSecret: true,
    keepIfEmpty: true,
    placeholder: 'برای تغییر، کلید جدید را وارد کنید',
  },
  {
    key: 'ai.temperature',
    labelFa: 'دما (Temperature)',
    descriptionFa: 'میان ۰ تا ۱ — عدد کمتر = پاسخ دقیق‌تر و کم‌خلاق‌تر',
    valueType: 'NUMBER',
    kind: 'number',
    placeholder: '0.2',
  },
  {
    key: 'ai.timeoutMs',
    labelFa: 'مهلت پاسخ (میلی‌ثانیه)',
    descriptionFa: 'حداکثر زمان انتظار برای پاسخ مدل',
    valueType: 'NUMBER',
    kind: 'number',
    placeholder: '60000',
  },
];

const SOURCE_FA: Record<string, string> = {
  database: 'تنظیمات پایگاه داده',
  environment: 'متغیر محیطی',
  defaults: 'پیش‌فرض سامانه',
};

const SECRET_MASK = '••••••••';

export function AISettingsPage() {
  const { can } = useAuth();
  const canView = can('settings.view');
  const canManage = can('settings.manage');

  const [status, setStatus] = useState<AiStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [rows, setRows] = useState<Record<string, SettingRow>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    setStatusError(null);
    try {
      setStatus(await getAiStatus());
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'خطا در بررسی وضعیت دستیار');
    } finally {
      setStatusLoading(false);
    }
  }, []);

  const loadSettings = useCallback(async () => {
    if (!canView && !canManage) {
      setSettingsLoading(false);
      return;
    }
    setSettingsLoading(true);
    setSettingsError(null);
    try {
      const res = await api<{ settings: any[] }>('/settings/system');
      const map: Record<string, SettingRow> = {};
      const nextDraft: Record<string, string> = {};
      for (const row of res.settings as SettingRow[]) {
        map[row.key] = row;
        const def = AI_FIELDS.find((f) => f.key === row.key);
        if (def) {
          // secrets arrive masked — never put the mask into the draft
          nextDraft[row.key] = row.isSecret ? '' : row.value;
        }
      }
      setRows(map);
      setDraft(nextDraft);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : 'خطا در دریافت تنظیمات');
    } finally {
      setSettingsLoading(false);
    }
  }, [canView, canManage]);

  useEffect(() => {
    void loadStatus();
    void loadSettings();
  }, [loadStatus, loadSettings]);

  /** get-or-create: existing key → PUT, missing key → POST */
  const saveSettings = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      let changed = 0;
      for (const field of AI_FIELDS) {
        const raw = draft[field.key];
        if (raw === undefined) continue;
        const value = raw.trim();
        if (field.keepIfEmpty && value === '') continue; // keep stored secret
        const existing = rows[field.key];
        if (existing && !existing.isSecret && existing.value === value) continue; // unchanged
        if (existing) {
          await api(`/settings/system/${existing.id}`, { method: 'PUT', body: { value } });
        } else {
          await api('/settings/system', {
            method: 'POST',
            body: {
              key: field.key,
              value,
              valueType: field.valueType,
              description: field.descriptionFa,
              ...(field.isSecret ? { isSecret: true } : {}),
            },
          });
        }
        changed++;
      }
      setNotice(changed > 0 ? `${faNumber(changed)} تنظیم ذخیره شد` : 'تغییری برای ذخیره وجود نداشت');
      await Promise.all([loadSettings(), loadStatus()]);
    } catch (err) {
      const fa = (err as { messageFa?: string }).messageFa;
      setError(fa ?? (err instanceof Error ? err.message : 'خطا در ذخیره تنظیمات'));
    } finally {
      setSaving(false);
    }
  };

  const reachable = Boolean(status?.enabled && status?.reachable);

  return (
    <Page
      title="تنظیمات هوش مصنوعی"
      subtitle="پیکربندی دستیار هوشمند — پیشنهاد: Ollama محلی (رایگان، آفلاین و بدون عبور داده از سازمان)"
    >
      <SubNav
        items={[
          { to: '/settings', label: 'خانه تنظیمات' },
          { to: '/settings/system', label: 'تنظیمات سامانه', permission: 'settings.view' },
          { to: '/settings/ai', label: 'هوش مصنوعی' },
        ]}
      />

      {statusError && <ErrorBanner message={statusError} />}
      {error && <ErrorBanner message={error} />}
      {notice && <SuccessBanner message={notice} />}

      {/* ---------------- live status probe ---------------- */}
      <Card
        title="وضعیت فعلی"
        note="نتیجه آزمایش واقعی سرویس مدل"
        actions={
          <Button variant="ghost" onClick={() => void loadStatus()} disabled={statusLoading} type="button">
            <RefreshCw size={15} /> آزمایش اتصال
          </Button>
        }
      >
        {statusLoading && <Loading label="در حال آزمایش اتصال…" />}
        {!statusLoading && status && (
          <div className="detail-grid">
            <div>
              <span className="muted">فعال بودن:</span>{' '}
              <Badge tone={status.enabled ? 'ok' : 'muted'}>{status.enabled ? 'فعال' : 'غیرفعال'}</Badge>
            </div>
            <div>
              <span className="muted">اتصال:</span>{' '}
              <span className={`chip ${reachable ? 'chip--ok' : 'chip--danger'}`}>{reachable ? 'متصل' : 'قطع'}</span>
            </div>
            <div>
              <span className="muted">سرویس‌دهنده:</span> <span dir="ltr">{status.provider}</span>
            </div>
            <div>
              <span className="muted">مدل:</span> <b dir="ltr">{status.model}</b>
            </div>
            <div className="span-2">
              <span className="muted">آدرس پایه:</span> <span dir="ltr">{status.baseUrl}</span>
            </div>
            <div>
              <span className="muted">منبع تنظیم:</span> {SOURCE_FA[status.source] ?? status.source}
            </div>
            <div>
              <span className="muted">زمان پاسخ:</span>{' '}
              {reachable && status.latencyMs != null ? `${faNumber(status.latencyMs)} ms` : '—'}
            </div>
            {status.errorFa && (
              <div className="span-2 text-danger">
                <span className="muted">پیام:</span> {status.errorFa}
              </div>
            )}
            {reachable && status.models.length > 0 && (
              <div className="span-2">
                <span className="muted">مدل‌های قابل استفاده:</span>{' '}
                <span className="chip-row" style={{ display: 'inline-flex' }}>
                  {status.models.map((m) => (
                    <span key={m} className="chip chip--info" dir="ltr">{m}</span>
                  ))}
                </span>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* ---------------- guidance (static) ---------------- */}
      <Card title="راهنمای راه‌اندازی — مدل محلی و رایگان با Ollama">
        <div className="ai-guide">
          <p>
            <b>چرا Ollama محلی؟</b> رایگان است، آفلاین کار می‌کند، داده‌های کارخانه از سازمان خارج نمی‌شود و برخلاف
            سرویس‌های خارجی، فیلترینگ و تحریم آن را متوقف نمی‌کند. سرویس‌های میزبانی خارجی (OpenAI و مانند آن) برای
            IPهای ایران معمولاً مسدود هستند؛ به همین دلیل Ollama محلی گزینه پیش‌فرض سامانه است.
          </p>
          <ol>
            <li>Ollama را از سایت رسمی <span dir="ltr">ollama.com</span> نصب کنید.</li>
            <li>سرویس را اجرا کنید: <code dir="ltr">ollama serve</code></li>
            <li>یک مدل فارسی‌پسند بگیرید: <code dir="ltr">ollama pull qwen2.5:7b</code></li>
            <li>
              گزینه‌های فارسی‌پسند دیگر: <span dir="ltr">qwen2.5:7b</span>، <span dir="ltr">gemma2:9b</span>،{' '}
              <span dir="ltr">llama3.1:8b</span>، <span dir="ltr">aya-expanse:8b</span>
            </li>
            <li>
              آدرس پیش‌فرض در همین صفحه: <span dir="ltr">http://127.0.0.1:11434/v1</span> — سپس «آزمایش اتصال» را بزنید.
            </li>
          </ol>
          <p>
            <b>سرویس سازگار با OpenAI:</b> اگر دروازه‌ای ایرانی (مثلاً AvalAI) یا هر endpoint سازگار با OpenAI در
            اختیار دارید، کافی است «سرویس‌دهنده» را <span dir="ltr">openai-compatible</span> بگذارید و «آدرس پایه»،
            «نام مدل» و «کلید API» را تغییر دهید.
          </p>
        </div>
      </Card>

      {/* ---------------- settings form (permission-aware) ---------------- */}
      <Card
        title="تنظیمات ذخیره‌شونده"
        note="مقادیر از طریق تنظیمات سامانه (کلیدهای ai.*) ذخیره می‌شوند"
        actions={
          canManage && (
            <Button onClick={() => void saveSettings()} disabled={saving || settingsLoading} type="button">
              <Save size={15} /> {saving ? 'در حال ذخیره…' : 'ذخیره تنظیمات'}
            </Button>
          )
        }
      >
        {!canView && !canManage ? (
          <div className="alert alert--info">
            برای مشاهده یا ویرایش تنظیمات هوش مصنوعی مجوز کافی ندارید (نیازمند مجوز «settings.view» یا «settings.manage»). وضعیت اتصال در بالا نمایش داده شد.
          </div>
        ) : (
          <>
            {settingsError && <ErrorBanner message={settingsError} />}
            {settingsLoading && <Loading />}
            {!settingsLoading && (
              <div className="form-grid form-grid--wide">
                {AI_FIELDS.map((field) => {
                  const stored = rows[field.key];
                  const value = draft[field.key] ?? '';
                  return (
                    <Field key={field.key} label={field.labelFa} hint={field.descriptionFa}>
                      {field.kind === 'select' ? (
                        <Select
                          value={value}
                          disabled={!canManage}
                          onChange={(e) => setDraft((d) => ({ ...d, [field.key]: e.target.value }))}
                        >
                          <option value="">— انتخاب —</option>
                          {(field.options ?? []).map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </Select>
                      ) : (
                        <TextInput
                          dir="ltr"
                          type={field.kind === 'number' ? 'number' : field.isSecret ? 'password' : 'text'}
                          step={field.kind === 'number' ? 'any' : undefined}
                          placeholder={field.placeholder}
                          value={value}
                          disabled={!canManage}
                          onChange={(e) => setDraft((d) => ({ ...d, [field.key]: e.target.value }))}
                        />
                      )}
                      {stored && (
                        <span className="field__hint" dir="ltr">
                          stored: {stored.isSecret ? SECRET_MASK : stored.value}
                        </span>
                      )}
                    </Field>
                  );
                })}
              </div>
            )}
            {canManage && !settingsLoading && (
              <p className="kpi-note">
                <Sparkles size={12} aria-hidden /> کلیدهای تازه پس از ذخیره به‌صورت خودکار ساخته می‌شوند (get-or-create). پس از ذخیره، «آزمایش اتصال» را بزنید.
              </p>
            )}
          </>
        )}
      </Card>

      <p className="kpi-note">
        <PlugZap size={12} aria-hidden /> همه پاسخ‌های دستیار «صرفاً پیشنهاد» هستند؛ هیچ تصمیم انباری بدون تأیید انسان ثبت نمی‌شود.
      </p>
    </Page>
  );
}
